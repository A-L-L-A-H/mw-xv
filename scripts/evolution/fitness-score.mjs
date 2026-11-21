import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function walkFiles(dirPath, predicate) {
  if (!existsSync(dirPath)) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await walkFiles(full, predicate)));
    } else if (entry.isFile() && predicate(entry.name, full)) {
      collected.push(full);
    }
  }
  return collected;
}

/**
 * Computes deterministic architectural, testing, and AI-readiness fitness metrics.
 */
export async function computeRepositoryFitness(options = {}) {
  const repositoryRoot = options.repositoryRoot
    ? path.resolve(options.repositoryRoot)
    : defaultRoot;

  const routeFiles = await walkFiles(path.join(repositoryRoot, 'apps/api/src/routes'), (name) =>
    name.endsWith('.ts')
  );
  let apiRouteMaxLoc = 0;
  let apiRouteTotalLoc = 0;
  for (const routeFile of routeFiles) {
    const content = await readFile(routeFile, 'utf8');
    const lines = content.split(/\r?\n/u).length;
    apiRouteTotalLoc += lines;
    if (lines > apiRouteMaxLoc) apiRouteMaxLoc = lines;
  }

  const packagesDir = path.join(repositoryRoot, 'packages');
  const pkgEntries = existsSync(packagesDir)
    ? await readdir(packagesDir, { withFileTypes: true })
    : [];
  const addonPackageCount = pkgEntries.filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith('orm-') || entry.name === 'auth' || entry.name === 'jobs')
  ).length;

  let legacyAllowlistCount = 0;
  const boundaryFile = path.join(repositoryRoot, 'scripts/check-api-addon-boundary.mjs');
  if (existsSync(boundaryFile)) {
    const boundarySrc = await readFile(boundaryFile, 'utf8');
    for (const constName of ['LEGACY_MODEL_ALLOWLIST', 'LEGACY_ADDON_ALLOWLIST']) {
      const match = new RegExp(
        `const\\s+${constName}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\)`,
        'u'
      ).exec(boundarySrc);
      if (match && match[1]) {
        const items = match[1]
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean);
        legacyAllowlistCount += items.length;
      }
    }
  }

  const testFiles = [
    ...(await walkFiles(path.join(repositoryRoot, 'packages'), (name) =>
      /\.test\.[cm]?[jt]s$/u.test(name)
    )),
    ...(await walkFiles(path.join(repositoryRoot, 'apps'), (name) =>
      /\.test\.[cm]?[jt]s$/u.test(name)
    )),
    ...(await walkFiles(path.join(repositoryRoot, 'scripts'), (name) =>
      /\.test\.[cm]?[jt]s$/u.test(name)
    )),
  ];

  const workflowsDir = path.join(repositoryRoot, '.github/workflows');
  const workflowCount = existsSync(workflowsDir)
    ? (await readdir(workflowsDir)).filter(
        (name) => name.endsWith('.yml') || name.endsWith('.yaml')
      ).length
    : 0;

  const docsPresent =
    existsSync(path.join(repositoryRoot, 'README.md')) &&
    existsSync(path.join(repositoryRoot, 'docs/guide/reference/generated-platform.json'));

  const compositeScore =
    addonPackageCount * 100 +
    testFiles.length * 10 +
    workflowCount * 20 -
    legacyAllowlistCount * 500 -
    Math.floor(apiRouteMaxLoc / 100);

  const metrics = {
    format: 'moonwitness-fitness-snapshot/v1',
    generatedAt: new Date().toISOString(),
    addonPackageCount,
    apiRouteCount: routeFiles.length,
    apiRouteMaxLoc,
    apiRouteTotalLoc,
    legacyAllowlistCount,
    testFileCount: testFiles.length,
    workflowCount,
    docsPresent,
    compositeScore,
  };

  if (options.write) {
    const evolutionDir = path.join(repositoryRoot, 'evolution');
    await mkdir(evolutionDir, { recursive: true });
    const snapshotPath = path.join(evolutionDir, 'fitness-snapshot.json');
    const historyPath = path.join(evolutionDir, 'fitness-history.jsonl');
    await writeFile(snapshotPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    await appendFile(historyPath, `${JSON.stringify(metrics)}\n`, 'utf8');
  }

  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const snapshot = await computeRepositoryFitness({ write });
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}
