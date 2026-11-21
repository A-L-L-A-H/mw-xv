import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findApiAddonBoundaryViolations } from './check-api-addon-boundary.mjs';
import { findBoardUiViolations } from './check-board-shared-ui.mjs';
import {
  findBoardRuntimeImportViolations,
  findDesktopNonOverlapViolations,
} from './check-desktop-non-overlap.mjs';
import { expandWorkspaceDependencies, readWorkspaceProjects } from './select-affected.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CACHE_RELATIVE_PATH = 'node_modules/.cache/moonwitness/preflight-contract.json';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listFilesRecursive(baseDir, predicate) {
  if (!existsSync(baseDir)) return [];
  const entries = await readdir(baseDir, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await listFilesRecursive(fullPath, predicate)));
    } else if (entry.isFile() && predicate(fullPath, entry.name)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

/**
 * Collects all contract-defining files (root package.json, .env.example, workspace manifests,
 * API route declarations, and ORM addon manifests/models) and computes a deterministic SHA-256 digest.
 */
export async function computeWorkspaceContractDigest(workspaceRoot = defaultRoot) {
  const contractFiles = [];
  for (const rootFile of ['package.json', '.env.example', 'scripts/architecture/flows.json']) {
    const candidate = path.join(workspaceRoot, rootFile);
    if (existsSync(candidate)) contractFiles.push(candidate);
  }

  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(workspaceRoot, group);
    if (!existsSync(groupDir)) continue;
    const entries = await readdir(groupDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(groupDir, entry.name, 'package.json');
      if (existsSync(manifestPath)) contractFiles.push(manifestPath);

      if (
        group === 'packages' &&
        (entry.name.startsWith('orm-') || entry.name === 'auth' || entry.name === 'jobs')
      ) {
        const srcDir = path.join(groupDir, entry.name, 'src');
        const ormSourceFiles = await listFilesRecursive(srcDir, (_full, name) =>
          name.endsWith('.ts')
        );
        contractFiles.push(...ormSourceFiles);
      }
    }
  }

  const routesDir = path.join(workspaceRoot, 'apps/api/src/routes');
  const routeFiles = await listFilesRecursive(routesDir, (_full, name) => name.endsWith('.ts'));
  contractFiles.push(...routeFiles);

  const normalizedEntries = await Promise.all(
    contractFiles.map(async (fullPath) => {
      const relativePath = path.relative(workspaceRoot, fullPath).replaceAll('\\', '/');
      const content = (await readFile(fullPath, 'utf8')).replace(/\r\n?/gu, '\n');
      const fileSha256 = createHash('sha256').update(content, 'utf8').digest('hex');
      return { path: relativePath, sha256: fileSha256 };
    })
  );

  normalizedEntries.sort((a, b) => compareText(a.path, b.path));

  const hash = createHash('sha256');
  for (const item of normalizedEntries) {
    hash.update(item.path);
    hash.update('\0');
    hash.update(item.sha256);
    hash.update('\0');
  }

  return {
    contractSha256: hash.digest('hex'),
    fileCount: normalizedEntries.length,
    files: normalizedEntries,
  };
}

/**
 * Parses `git status --porcelain` lines into normalized repo-relative paths.
 */
export function parseGitPorcelainPaths(porcelainOutput) {
  const paths = new Set();
  for (const rawLine of String(porcelainOutput ?? '').split(/\r?\n/u)) {
    if (rawLine.length < 4) continue;
    let payload = rawLine.slice(3).trim();
    if (!payload) continue;
    if (payload.includes(' -> ')) {
      const parts = payload.split(' -> ');
      payload = parts[parts.length - 1].trim();
    }
    if (payload.startsWith('"') && payload.endsWith('"')) {
      payload = payload.slice(1, -1);
    }
    const normalized = payload.replaceAll('\\', '/').replace(/\/+$/u, '');
    if (normalized) paths.add(normalized);
  }
  return [...paths].sort(compareText);
}

export function readGitStatusPaths(workspaceRoot = defaultRoot) {
  try {
    const stdout = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitPorcelainPaths(stdout);
  } catch {
    return [];
  }
}

/**
 * Maps changed repo-relative file paths to directly changed and transitive affected `@moonwitness/*` packages.
 */
export function mapChangedFilesToPackages(changedFiles, workspaceProjects) {
  const normalizedFiles = changedFiles.map((file) => file.replaceAll('\\', '/'));
  const directPackages = new Set();
  for (const project of workspaceProjects) {
    const prefix = `${project.path.replaceAll('\\', '/')}/`;
    if (
      normalizedFiles.some(
        (file) =>
          file === project.path ||
          file.startsWith(prefix) ||
          (file.includes('/') && !file.includes('.') && prefix.startsWith(`${file}/`))
      )
    ) {
      directPackages.add(project.name);
    }
  }
  const affectedPackages = expandWorkspaceDependencies([...directPackages], workspaceProjects);
  const contractTouched = normalizedFiles.some(
    (file) =>
      file === 'package.json' ||
      file === '.env.example' ||
      file === 'scripts/architecture/flows.json' ||
      /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(file) ||
      file.startsWith('apps/api/src/routes/') ||
      /^packages\/(?:orm-[^/]+|auth|jobs)\/src\//u.test(file)
  );

  return {
    changedFiles: [...normalizedFiles].sort(compareText),
    directPackages: [...directPackages].sort(compareText),
    affectedPackages: [...affectedPackages].sort(compareText),
    contractTouched,
  };
}

/**
 * Runs the 3 fast AST/source boundary gates across `apps/api/src`, `apps/board/src`, and `apps/desktop/src`.
 */
export async function runBoundaryGates(workspaceRoot = defaultRoot) {
  const apiDir = path.join(workspaceRoot, 'apps/api/src');
  const boardDir = path.join(workspaceRoot, 'apps/board/src');
  const desktopDir = path.join(workspaceRoot, 'apps/desktop/src');

  const [apiFiles, boardFiles, desktopFiles] = await Promise.all([
    listFilesRecursive(apiDir, (_full, name) => /\.[jt]sx?$/u.test(name)),
    listFilesRecursive(boardDir, (_full, name) => /\.[cm]?[jt]sx?$/u.test(name)),
    listFilesRecursive(desktopDir, (_full, name) => /\.[cm]?[jt]s$/u.test(name)),
  ]);

  const apiAddonViolations = [];
  for (const file of apiFiles) {
    const relativePath = path.relative(workspaceRoot, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    apiAddonViolations.push(...findApiAddonBoundaryViolations(source, relativePath));
  }

  const boardUiViolations = [];
  const desktopNonOverlapViolations = [];
  for (const file of boardFiles) {
    const relativePath = path.relative(workspaceRoot, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    if (/\.[jt]sx?$/u.test(file)) {
      boardUiViolations.push(...findBoardUiViolations(source, relativePath));
    }
    desktopNonOverlapViolations.push(...findBoardRuntimeImportViolations(source, relativePath));
  }

  for (const file of desktopFiles) {
    const relativePath = path.relative(workspaceRoot, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    desktopNonOverlapViolations.push(...findDesktopNonOverlapViolations(source, relativePath));
  }

  const gates = {
    apiAddonBoundary: {
      passed: apiAddonViolations.length === 0,
      scannedFiles: apiFiles.length,
      violations: apiAddonViolations,
    },
    boardSharedUi: {
      passed: boardUiViolations.length === 0,
      scannedFiles: boardFiles.length,
      violations: boardUiViolations,
    },
    desktopNonOverlap: {
      passed: desktopNonOverlapViolations.length === 0,
      scannedFiles: desktopFiles.length + boardFiles.length,
      violations: desktopNonOverlapViolations,
    },
  };

  return {
    passed:
      gates.apiAddonBoundary.passed && gates.boardSharedUi.passed && gates.desktopNonOverlap.passed,
    gates,
  };
}

async function runDefaultGenerators() {
  const [{ generateReference }, { updateReadme }, { generateArchitectureDiagrams }] =
    await Promise.all([
      import('./docs/generate-reference.mjs'),
      import('./docs/update-readme.mjs'),
      import('./architecture/generate-diagrams.mjs'),
    ]);
  await generateReference({ check: false });
  await updateReadme({ check: false });
  await generateArchitectureDiagrams({ check: false });
  return [
    'docs/generate-reference.mjs',
    'docs/update-readme.mjs',
    'architecture/generate-diagrams.mjs',
  ];
}

export async function runPreflightFast(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : defaultRoot;
  const sync = options.sync === true;
  const forceSync = options.forceSync === true;
  const cachePath = options.cachePath
    ? path.resolve(options.cachePath)
    : path.join(workspaceRoot, DEFAULT_CACHE_RELATIVE_PATH);

  let workspaceProjects;
  try {
    workspaceProjects = await readWorkspaceProjects(workspaceRoot);
  } catch {
    workspaceProjects = [];
  }

  const changedFiles = options.changedFiles ?? readGitStatusPaths(workspaceRoot);
  const affectedSummary = mapChangedFilesToPackages(changedFiles, workspaceProjects);
  const digest = await computeWorkspaceContractDigest(workspaceRoot);

  let cachedSha256 = null;
  if (existsSync(cachePath)) {
    try {
      const parsedCache = JSON.parse(await readFile(cachePath, 'utf8'));
      cachedSha256 =
        typeof parsedCache?.contractSha256 === 'string' ? parsedCache.contractSha256 : null;
    } catch {
      cachedSha256 = null;
    }
  }

  const contractChanged = cachedSha256 !== digest.contractSha256;
  const boundaryResult = await runBoundaryGates(workspaceRoot);

  let syncedGenerators = [];
  if (sync && (contractChanged || affectedSummary.contractTouched || forceSync)) {
    const syncRunner = options.syncGenerators ?? runDefaultGenerators;
    syncedGenerators = await syncRunner(workspaceRoot);
  }

  if (!cachedSha256 || sync) {
    try {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(
        cachePath,
        `${JSON.stringify(
          {
            format: 'moonwitness-preflight-contract-cache/v1',
            contractSha256: digest.contractSha256,
            fileCount: digest.fileCount,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    } catch {
      // non-fatal if cache dir is read-only
    }
  }

  return {
    format: 'moonwitness-preflight-fast/v1',
    passed: boundaryResult.passed,
    contractSha256: digest.contractSha256,
    contractFileCount: digest.fileCount,
    cachedContractSha256: cachedSha256,
    contractChanged,
    contractTouchedInDiff: affectedSummary.contractTouched,
    syncRequested: sync,
    syncedGenerators,
    changedFiles: affectedSummary.changedFiles,
    directPackages: affectedSummary.directPackages,
    affectedPackages: affectedSummary.affectedPackages,
    gates: boundaryResult.gates,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const sync = args.includes('--sync');
  const forceSync = args.includes('--force-sync');
  const report = await runPreflightFast({ sync, forceSync });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `MoonWitness Fast Preflight: ${report.passed ? 'PASSED' : 'FAILED'} · contract=${report.contractSha256.slice(0, 12)} (${report.contractFileCount} files) · affected=${report.affectedPackages.length} package(s)\n`
    );
    if (report.syncedGenerators.length > 0) {
      process.stdout.write(`  Synced generators: ${report.syncedGenerators.join(', ')}\n`);
    }
    for (const [gateName, gate] of Object.entries(report.gates)) {
      process.stdout.write(
        `  - ${gateName}: ${gate.passed ? 'ok' : 'FAIL'} (${gate.scannedFiles} files)\n`
      );
      for (const violation of gate.violations) {
        process.stderr.write(`    ${violation}\n`);
      }
    }
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
