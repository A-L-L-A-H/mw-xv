import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildContactSheetGroups,
  buildContactSheetHtml,
  generateContactSheets,
} from '../scripts/generate-contact-sheets.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('buildContactSheetGroups deterministically groups manifest assets with stable IDs and variants', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const first = buildContactSheetGroups(manifest);
  const second = buildContactSheetGroups(manifest);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 5, 'groups cover multiple asset packs');
  const allItems = first.flatMap((group) => group.items);
  assert.ok(allItems.length > 100, 'covers canonical visual assets');
  for (const item of allItems) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0, 'stable ID present');
    assert.ok(typeof item.variant === 'string' && item.variant.length > 0, 'variant present');
  }
});

test('buildContactSheetHtml embeds stable IDs and variants deterministically', () => {
  const group = {
    name: 'world-characters',
    slug: 'world-characters',
    count: 1,
    items: [
      {
        id: 'crew-01-sheet',
        path: 'source/world/characters/crew-01-sheet.svg',
        variant: 'neutral',
        format: 'svg',
        width: 512,
        height: 512,
      },
    ],
  };
  const html = buildContactSheetHtml(group, [
    { item: group.items[0], dataUrl: 'data:image/svg+xml;base64,AA==' },
  ]);
  assert.match(html, /data-asset-id="crew-01-sheet"/u);
  assert.match(html, /neutral · svg · 512x512/u);
});

test('generateContactSheets writes deterministic index without touching repo when outputDir is temp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mw-contact-sheets-'));
  try {
    const { index, indexPath } = await generateContactSheets({
      rootDir: packageRoot,
      outputDir: dir,
      renderPng: false,
    });
    const persisted = JSON.parse(await readFile(indexPath, 'utf8'));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.totalGroups, index.totalGroups);
    assert.equal(persisted.totalVisualAssets, index.totalVisualAssets);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
