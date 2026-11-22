import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';

export async function listInventoryMedia(packageRoot, directories) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        const assetPath = relative(packageRoot, fullPath).split(sep).join('/');
        if (/^fonts\/OFL-[^/]+\.txt$/u.test(assetPath)) continue;
        files.push(assetPath);
      }
    }
  }

  for (const directory of directories) await visit(resolve(packageRoot, directory));
  return files.sort();
}

export function compareAssetInventory(manifestPaths, packageFiles) {
  const listed = new Set(manifestPaths);
  const present = new Set(packageFiles);
  return {
    unlistedFiles: packageFiles.filter((path) => !listed.has(path)).sort(),
    missingFiles: manifestPaths.filter((path) => !present.has(path)).sort(),
  };
}

const FILTER_FIELDS = Object.freeze({
  pack: 'pack',
  category: 'kind',
  subject: 'subject',
  domain: 'domain',
  format: 'format',
  status: 'status',
});

export function queryAssetInventory(manifest, filters = {}, licenses = {}) {
  const sourceProvenance = new Map((licenses.sourceAssets ?? []).map((entry) => [entry.path, entry]));
  return manifest.assets
    .filter((asset) => Object.entries(FILTER_FIELDS).every(([filter, field]) => {
      const expected = filters[filter];
      return expected === undefined || asset[field] === expected;
    }))
    .map((asset) => {
      const provenance = sourceProvenance.get(asset.path);
      return {
        ...asset,
        distribution: provenance?.status === 'blocked' || provenance?.license === 'unverified'
          ? 'blocked'
          : asset.kind === 'source' ? 'source-only' : 'runtime',
      };
    });
}

export function auditAssetInventory(manifest, packageFiles) {
  const inventory = compareAssetInventory(manifest.assets.map(({ path }) => path), packageFiles);
  const assetPaths = new Set(manifest.assets.map(({ path }) => path));
  const brokenReferences = [];
  for (const asset of manifest.assets) {
    for (const reference of [asset.sourceAsset, ...(asset.variants ?? [])]) {
      if (reference && !assetPaths.has(reference)) {
        brokenReferences.push({ asset: asset.path, reference });
      }
    }
  }
  return { ...inventory, brokenReferences };
}

function parseFilters(argumentsList) {
  const filters = {};
  for (const argument of argumentsList) {
    const match = /^--(pack|category|subject|domain|format|status)=([^=]+)$/u.exec(argument);
    if (!match) throw new Error(`Unsupported inventory argument: ${argument}`);
    filters[match[1]] = match[2];
  }
  return filters;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const [manifest, licenses] = await Promise.all([
    readFile(resolve(packageRoot, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(resolve(packageRoot, 'licenses.json'), 'utf8').then(JSON.parse),
  ]);
  const filters = parseFilters(process.argv.slice(2));
  const entries = queryAssetInventory(manifest, filters, licenses);
  const files = await listInventoryMedia(packageRoot, [
    'brand', 'fonts', 'icons', 'illustrations', 'materials', 'sounds', 'source',
  ]);
  const audit = auditAssetInventory(manifest, files);
  process.stdout.write(`${JSON.stringify({ entries, audit }, null, 2)}\n`);
  if (audit.unlistedFiles.length || audit.missingFiles.length || audit.brokenReferences.length) process.exitCode = 1;
}
