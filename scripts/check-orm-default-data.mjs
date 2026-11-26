import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');

// orm-identity is a data-model-only package: it must never register models with
// the business addon registry, so it has no Addon manifest to validate.
const EXCLUDED_DIRS = new Set(['orm-base', 'orm-cli', 'orm-automation-core', 'orm-identity']);

// Identity-owned packages are data-model-only: importing them must not register
// models with the business addon registry, so they intentionally export no
// Addon manifest and carry no seed data.
const MANIFEST_EXEMPT_DIRS = new Set(['orm-identity']);

function resolveManifestExport(mod, pkgName) {
  const candidates = [
    mod.manifest,
    mod.whatsappManifest,
    mod.storageManifest,
    mod.jobsManifest,
    mod.simAddon,
  ];
  const found = candidates.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof entry.name === 'string' &&
      Array.isArray(entry.models)
  );
  if (found) return found;
  throw new Error(
    `Package '${pkgName}' must export an Addon manifest (e.g. manifest) from its built entrypoint`
  );
}

async function main() {
  const ormEntry = path.join(packagesDir, 'orm/dist/index.js');
  if (!existsSync(ormEntry)) {
    throw new Error('Built @moonwitness/orm entrypoint is missing. Run `pnpm build` first.');
  }
  const { DEFAULT_DATA_EXEMPT_ADDONS, assertAddonDefaultDataPolicy } = await import(
    pathToFileURL(ormEntry).href
  );

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const ormAddonDirs = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^orm-/u.test(entry.name) &&
        !EXCLUDED_DIRS.has(entry.name) &&
        existsSync(path.join(packagesDir, entry.name, 'package.json'))
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

  const inspected = [];
  for (const dirName of ormAddonDirs) {
    const pkgDir = path.join(packagesDir, dirName);
    const pkgJson = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
    const entryRelative = pkgJson.exports?.['.']?.import ?? pkgJson.main ?? './dist/index.js';
    const entryPath = path.resolve(pkgDir, entryRelative);
    if (!existsSync(entryPath)) {
      throw new Error(
        `Built entrypoint missing for packages/${dirName} (${entryRelative}). Run \`pnpm build\` first.`
      );
    }
    if (MANIFEST_EXEMPT_DIRS.has(dirName)) {
      continue;
    }
    const mod = await import(pathToFileURL(entryPath).href);
    const manifest = resolveManifestExport(mod, pkgJson.name ?? dirName);
    const ownModelNames = new Set(manifest.models.map((model) => model.modelName));
    const seeds = manifest.data ?? [];
    const ownSeeds = seeds.filter((record) => ownModelNames.has(record.model.modelName));
    inspected.push({
      dirName,
      addonName: manifest.name,
      modelsCount: manifest.models.length,
      totalSeeds: seeds.length,
      ownSeeds: ownSeeds.length,
      manifest,
    });
  }

  // Sensor and sim tables intentionally stay empty until their seed manifests are explicitly enabled.
  // bot-orchestrator/ecommerce_sync/rnd are infrastructure/research addons whose
  // records are created by operators at runtime; they have no safe demo records.
  // observability stores runtime telemetry (spans/logs/metrics); seeded rows
  // would fabricate operational signal, so its tables stay empty by design.
  const exemptAddons = new Set([
    ...DEFAULT_DATA_EXEMPT_ADDONS,
    'sensor',
    'sim',
    'bot-orchestrator',
    'ecommerce_sync',
    'rnd',
    'observability',
  ]);
  assertAddonDefaultDataPolicy(
    inspected.map((entry) => entry.manifest),
    { exemptAddons }
  );

  for (const entry of inspected) {
    process.stdout.write(
      `[orm:check:seeds] packages/${entry.dirName} (${entry.addonName}): ${entry.modelsCount} model(s), ${entry.ownSeeds} own seed(s), ${entry.totalSeeds} total seed(s)\n`
    );
  }
  process.stdout.write(
    `Verified mandatory default data across ${inspected.length} orm-* addon packages.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
