import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  auditAssetInventory,
  compareAssetInventory,
  listInventoryMedia,
  queryAssetInventory,
} from '../scripts/asset-inventory.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('tracked asset media exactly matches the canonical manifest inventory', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const files = await listInventoryMedia(packageRoot, [
    'brand',
    'fonts',
    'icons',
    'illustrations',
    'materials',
    'sounds',
    'source',
    'animation',
  ]);
  assert.deepEqual(
    compareAssetInventory(
      manifest.assets.map(({ path }) => path),
      files
    ),
    {
      unlistedFiles: [],
      missingFiles: [],
    }
  );
});

test('inventory comparison reports unlisted files and missing manifest files separately', () => {
  assert.deepEqual(
    compareAssetInventory(
      ['brand/logo.svg', 'fonts/display.woff2'],
      ['brand/logo.svg', 'icons/new.svg']
    ),
    {
      unlistedFiles: ['icons/new.svg'],
      missingFiles: ['fonts/display.woff2'],
    }
  );
});

test('queries canonical records by pack/category/domain/format/status and classifies sources', () => {
  const manifest = { assets: [
    { path: 'source/moon.svg', kind: 'source', pack: 'moon-city', domain: 'homepage', format: 'svg', status: 'review' },
    { path: 'illustrations/card.webp', kind: 'artwork', pack: 'moon-city', domain: 'board', format: 'webp', status: 'approved' },
  ] };
  const result = queryAssetInventory(manifest, { pack: 'moon-city', category: 'source', format: 'svg' }, {
    sourceAssets: [{ path: 'source/moon.svg', license: 'unverified', status: 'blocked' }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].distribution, 'blocked');
  assert.equal(queryAssetInventory(manifest, { domain: 'board' })[0].path, 'illustrations/card.webp');
});

test('inventory audit reports orphans and broken canonical references', () => {
  const audit = auditAssetInventory({ assets: [
    { path: 'illustrations/one.webp', sourceAsset: 'source/missing.png', variants: ['illustrations/absent.webp'] },
  ] }, ['illustrations/one.webp', 'source/orphan.png']);
  assert.deepEqual(audit, {
    unlistedFiles: ['source/orphan.png'],
    missingFiles: [],
    brokenReferences: [
      { asset: 'illustrations/one.webp', reference: 'source/missing.png' },
      { asset: 'illustrations/one.webp', reference: 'illustrations/absent.webp' },
    ],
  });
});
