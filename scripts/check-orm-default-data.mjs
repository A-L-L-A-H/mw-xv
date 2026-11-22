import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');

function resolveManifestExport(mod, pkgName) {
  const candidates = [mod.manifest, mod.whatsappManifest, mod.storageManifest, mod.jobsManifest];
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
  const { assertAddonDefaultDataPolicy } = await import(pathToFileURL(ormEntry).href);

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const ormAddonDirs = entries
    .filter((entry) => entry.isDirectory() && /^orm-/u.test(entry.name))
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

  assertAddonDefaultDataPolicy(inspected.map((entry) => entry.manifest));

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
