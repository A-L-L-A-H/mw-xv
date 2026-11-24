import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL as NodeURL } from 'node:url';

const repositoryRoot = fileURLToPath(new NodeURL('../', import.meta.url));
const githubDirectory = join(repositoryRoot, '.github');
const immutableSha = /^[0-9a-f]{40}$/;
const versionComment = /^v?\d+(?:\.\d+){0,2}(?:[-+][A-Za-z0-9.-]+)?$/;

export function findBunVersionDrift(sources, expectedBunVersion) {
  const findings = [];
  for (const source of sources) {
    const content = source.content;
    // Check setup-bun action default version
    const setupBunMatch = content.match(/default:\s*'([^']+)'/);
    if (setupBunMatch && source.path.includes('setup-bun/action.yml')) {
      const version = setupBunMatch[1];
      if (version !== expectedBunVersion) {
        findings.push({
          path: source.path,
          reference: version,
          reason: `must match the root packageManager bun@${expectedBunVersion}`,
        });
      }
    }
    // Check workflow uses of setup-bun
    const workflowMatches = content.matchAll(/bun-version:\s*'([^']+)'/g);
    for (const match of workflowMatches) {
      const version = match[1];
      if (version !== expectedBunVersion) {
        findings.push({
          path: source.path,
          reference: version,
          reason: `must match the root packageManager bun@${expectedBunVersion}`,
        });
      }
    }
  }
  return findings;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (/\.(?:yml|yaml)$/.test(entry.name)) files.push(path);
  }
  return files;
}

export function findUnpinnedActions(sources) {
  const findings = [];
  for (const source of sources) {
    const lines = source.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\s*(?:-\s*)?uses:\s*(?<value>.*?)\s*$/.exec(lines[index]);
      if (!match?.groups) continue;
      const [reference, commentText = ''] = match.groups.value.split(/\s+#\s*/, 2);
      if (reference.startsWith('./')) continue;
      const [action, revision] = reference.split('@');
      const comment = commentText.trim();
      if (!action.includes('/') || !revision || !immutableSha.test(revision)) {
        findings.push({
          path: source.path,
          line: index + 1,
          reference,
          reason: 'must pin a full 40-character commit SHA',
        });
        continue;
      }
      if (!versionComment.test(comment)) {
        findings.push({
          path: source.path,
          line: index + 1,
          reference,
          reason: 'must include the human-readable action version after the SHA',
        });
      }
    }
  }
  return findings;
}

export function pnpmSetupOrderValid(actionSource) {
  if (actionSource.includes('uses: oven-sh/setup-bun@')) {
    const nodeSetup = actionSource.indexOf('uses: actions/setup-node@');
    const bunSetup = actionSource.indexOf('uses: oven-sh/setup-bun@');
    return nodeSetup >= 0 && bunSetup > nodeSetup;
  }
  if (actionSource.includes('uses: pnpm/setup@')) {
    return (
      /runtime:\s*node@\$\{\{\s*inputs\.node-version\s*\}\}/u.test(actionSource) &&
      /install:\s*false/u.test(actionSource) &&
      !/run:\s*pnpm install/u.test(actionSource)
    );
  }
  const nodeSetup = actionSource.indexOf('uses: actions/setup-node@');
  const pnpmActionSetup = actionSource.indexOf('uses: pnpm/action-setup@');
  const pnpmCliInstall = actionSource.indexOf(
    'npm install --global --no-audit --no-fund "pnpm@${{ inputs.pnpm-version }}"'
  );
  if (nodeSetup >= 0 && pnpmCliInstall > nodeSetup) {
    return !/run:\s*pnpm install/u.test(actionSource);
  }
  return nodeSetup >= 0 && pnpmActionSetup > nodeSetup;
}

export function workflowInstallsFrozenWorkspaceAfterSetup(source, path) {
  const lines = source.split(/\r?\n/u);
  const ciPlanOnly = path === '.github/workflows/ci.yml';
  let inPlanJob = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index] ?? '')) {
      inPlanJob = ciPlanOnly && lines[index].trim() === 'plan:';
    }
    if (inPlanJob) continue;
    if (!/^\s*- uses: \.\/\.github\/actions\/setup-(?:bun|pnpm)\s*$/u.test(lines[index] ?? ''))
      continue;
    const setupIndent = (lines[index]?.match(/^\s*/u)?.[0] ?? '').length;
    const nextStep = lines.findIndex(
      (line, lineIndex) => lineIndex > index && /^\s*-\s/u.test(line)
    );
    if (nextStep < 0) return false;
    const expectedIndent = ' '.repeat(setupIndent);
    if (lines[nextStep]?.trim() !== '- name: Install frozen workspace dependencies') return false;
    if (lines[nextStep]?.slice(0, setupIndent) !== expectedIndent) return false;
    const followingStep = lines.findIndex(
      (line, lineIndex) => lineIndex > nextStep && /^\s*-\s/u.test(line)
    );
    const stepLines = lines.slice(nextStep, followingStep < 0 ? undefined : followingStep);
    if (
      !stepLines.some((line) =>
        /run:\s*(?:bun install --frozen-lockfile|pnpm install --frozen-lockfile --no-runtime)\s*$/u.test(
          line
        )
      )
    )
      return false;
  }
  return true;
}

export function findPnpmVersionDrift(sources, packageManager) {
  const expected = /^(?:bun|pnpm)@(?<version>\d+\.\d+\.\d+)$/u.exec(packageManager)?.groups
    ?.version;
  if (!expected) {
    return [
      {
        path: 'package.json',
        line: 1,
        reference: packageManager,
        reason: 'must pin bun with an exact version',
      },
    ];
  }
  const findings = [];
  for (const source of sources) {
    const lines = source.content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const references = [
        ...lines[index].matchAll(/(?:bun|pnpm)-version:\s*['"]([^'"]+)['"]/gu),
        ...lines[index].matchAll(/bun\.sh\/install \| bash -s "bun-v([^"]+)"/gu),
        ...lines[index].matchAll(/default:\s*['"](\d+\.\d+\.\d+)['"]/gu),
        ...lines[index].matchAll(/corepack prepare pnpm@([\d.]+)/gu),
      ];
      for (const match of references) {
        const actual = match[1];
        if (actual !== expected) {
          findings.push({
            path: source.path,
            line: index + 1,
            reference: actual,
            reason: `must match the root packageManager ${packageManager}`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * The root `engines.node` value is the one place the runtime line is declared, so
 * every workflow pin and every image tag has to agree with it.
 */
export function findNodeVersionDrift(sources, enginesNode) {
  const expected = /^(\d+)\.x$/u.exec(enginesNode ?? '')?.[1];
  if (expected === undefined) {
    return [
      {
        path: 'package.json',
        line: 1,
        reference: String(enginesNode ?? ''),
        reason: 'engines.node must pin one exact major such as "24.x"',
      },
    ];
  }
  const findings = [];
  for (const source of sources) {
    const lines = source.content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const references = [
        ...lines[index].matchAll(/node-version:\s*['"]([^'"\s]+)['"]/gu),
        ...(source.path === 'Dockerfile'
          ? [...lines[index].matchAll(/^FROM\s+node:(?<tag>[A-Za-z0-9._-]+)/giu)]
          : []),
      ];
      for (const match of references) {
        const actual = match[1];
        if (/^\$\{\{/u.test(actual)) continue;
        const major = /^\d+/u.exec(actual)?.[0];
        if (major === expected) continue;
        findings.push({
          path: source.path,
          line: index + 1,
          reference: actual,
          reason: `must use the Node ${expected}.x line pinned by the root engines field`,
        });
      }
    }
  }
  return findings;
}

async function main() {
  const paths = await collectFiles(githubDirectory);
  const sources = await Promise.all(
    paths.map(async (path) => ({
      path: relative(repositoryRoot, path).replaceAll('\\', '/'),
      content: await readFile(path, 'utf8'),
    }))
  );
  const findings = findUnpinnedActions(sources);
  for (const source of sources) {
    if (
      source.path.startsWith('.github/workflows/') &&
      (source.content.includes('uses: ./.github/actions/setup-bun') ||
        source.content.includes('uses: ./.github/actions/setup-pnpm')) &&
      !workflowInstallsFrozenWorkspaceAfterSetup(source.content, source.path)
    ) {
      findings.push({
        path: source.path,
        line: 1,
        reference: 'setup-bun',
        reason: 'must install frozen workspace dependencies in a separate visible step',
      });
    }
  }
  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const toolchainSources = [
    ...sources,
    { path: 'Dockerfile', content: await readFile(join(repositoryRoot, 'Dockerfile'), 'utf8') },
  ];
  findings.push(...findPnpmVersionDrift(toolchainSources, packageManifest.packageManager ?? ''));
  findings.push(...findNodeVersionDrift(toolchainSources, packageManifest.engines?.node));
  const toolchainSetup = sources.find(
    (source) =>
      source.path === '.github/actions/setup-bun/action.yml' ||
      source.path === '.github/actions/setup-pnpm/action.yml'
  );
  if (toolchainSetup && !pnpmSetupOrderValid(toolchainSetup.content)) {
    findings.push({
      path: toolchainSetup.path,
      line: 15,
      reference: 'setup-bun',
      reason: 'Node must be selected before Bun is installed',
    });
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `${finding.path}:${finding.line}: ${finding.reference} ${finding.reason}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Validated immutable external action references in ${paths.length} GitHub workflow/composite files.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
