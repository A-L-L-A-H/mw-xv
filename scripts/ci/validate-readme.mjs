import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectMarkdownAnchors, stripFencedCode } from '../check-docs.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const linkPattern = /!?\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/gu;
const forbiddenCopyPatterns = [
  {
    label: 'shell command',
    matcher: /^\s*(?:sudo\s+)?(?:bun|npm|pnpm|yarn|docker|kubectl|helm|curl|wget|git\s+clone)\s/imu,
    example: 'bun install',
  },
  {
    label: 'environment assignment',
    matcher: /(?:^|\n)\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=/u,
    example: 'export API_KEY=value',
  },
  {
    label: 'private key block',
    matcher: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/u,
    example: '-----BEGIN PRIVATE KEY-----',
  },
  {
    label: 'Docker registry credential',
    matcher: /docker\s+login\b[^\n]*(?:--password|\b-u\b)/iu,
    example: 'docker login --username USER --password SECRET',
  },
];

export function extractReadmeLinks(markdown) {
  const source = stripFencedCode(markdown);
  return [...source.matchAll(linkPattern)].map((match) => ({
    label: match[1],
    target: match[2].replace(/^<|>$/gu, ''),
    line: source.slice(0, match.index).split('\n').length,
  }));
}

export function findCopyPasteViolations(markdown) {
  const source = stripFencedCode(markdown);
  return forbiddenCopyPatterns
    .filter(({ matcher }) => matcher.test(source))
    .map(({ label, example }) => `copy-paste ${label}; use a fenced code block (e.g. ${example})`);
}

export async function findBrokenReadmeLinks(markdown, sourcePath, root = repositoryRoot) {
  const failures = [];
  for (const link of extractReadmeLinks(markdown)) {
    if (!link.target || link.target.startsWith('#')) {
      failures.push(`README.md:${link.line}: empty or fragment-only link`);
      continue;
    }
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(link.target)) {
      const allowedExternal = /^https:\/\/github\.com\/A-L-L-A-H\/mw-xv(?:\/|#|$)/iu.test(
        link.target
      );
      if (!allowedExternal) {
        failures.push(`README.md:${link.line}: external link rejected ${link.target}`);
      }
      continue;
    }
    const [rawPath = '', rawFragment = ''] = link.target.split('#', 2);
    let localPath;
    let fragment;
    try {
      localPath = decodeURIComponent(rawPath.split('?')[0] ?? '');
      fragment = decodeURIComponent(rawFragment);
    } catch {
      failures.push(`README.md:${link.line}: malformed link ${link.target}`);
      continue;
    }
    const targetPath = localPath
      ? path.resolve(path.dirname(sourcePath), localPath)
      : sourcePath;
    const targetRelativePath = path.relative(root, targetPath).replaceAll('\\', '/');
    if (
      targetRelativePath === '..' ||
      targetRelativePath.startsWith('../') ||
      path.isAbsolute(targetRelativePath)
    ) {
      failures.push(`README.md:${link.line}: target escapes repository ${link.target}`);
      continue;
    }
    let targetStat;
    try {
      targetStat = await stat(targetPath);
    } catch {
      failures.push(`README.md:${link.line}: missing target ${link.target}`);
      continue;
    }
    if (
      fragment &&
      targetStat.isFile() &&
      path.extname(targetPath).toLowerCase() === '.md'
    ) {
      const targetSource =
        targetPath === sourcePath ? markdown : await readFile(targetPath, 'utf8');
      if (!collectMarkdownAnchors(targetSource).has(fragment)) {
        failures.push(`README.md:${link.line}: missing anchor ${link.target}`);
      }
    }
  }
  return failures;
}

export async function checkExternalReadmeLinks(markdown, fetchImpl = globalThis.fetch) {
  const failures = [];
  for (const { target, line } of extractReadmeLinks(markdown)) {
    if (!/^https?:\/\//iu.test(target)) continue;
    let lastError;
    for (const method of ['HEAD', 'GET']) {
      try {
        const response = await fetchImpl(target, {
          method,
          redirect: 'manual',
          signal: globalThis.AbortSignal.timeout(12000),
          headers: { 'user-agent': 'MoonWitness-README-Link-Guard/1.0' },
        });
        if (response.status >= 200 && response.status < 300) {
          lastError = undefined;
          break;
        }
        if ((response.status === 403 || response.status === 405) && method === 'HEAD') {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        lastError =
          response.status >= 300 && response.status < 400
            ? `redirect ${response.headers?.get?.('location') ?? 'without location'}`
            : `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (lastError) failures.push(`README.md:${line}: unreachable ${target} (${lastError})`);
  }
  return failures;
}

export async function validateReadme({
  root = repositoryRoot,
  fetchImpl = globalThis.fetch,
} = {}) {
  const readme = path.join(root, 'README.md');
  const markdown = await readFile(readme, 'utf8');
  const failures = [
    ...findCopyPasteViolations(markdown),
    ...(await findBrokenReadmeLinks(markdown, readme, root)),
    ...(await checkExternalReadmeLinks(markdown, fetchImpl)),
  ];
  if (failures.length) {
    throw new Error(`README validation failed (${failures.length}):\n${failures.join('\n')}`);
  }
  return {
    links: extractReadmeLinks(markdown).length,
    external: extractReadmeLinks(markdown).filter(({ target }) =>
      /^https?:\/\//iu.test(target)
    ).length,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  validateReadme()
    .then(({ links, external }) =>
      process.stdout.write(`README validated: ${links} link(s), ${external} external.\n`)
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'README validation failed'}\n`
      );
      process.exitCode = 1;
    });
}
