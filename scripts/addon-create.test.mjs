import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAddonFiles, scaffoldAddon, toPascalCase } from './addon-create.mjs';

test('toPascalCase converts kebab-case slugs cleanly', () => {
  assert.equal(toPascalCase('inventory-ops'), 'InventoryOps');
  assert.equal(toPascalCase('sales'), 'Sales');
});

test('buildAddonFiles rejects invalid addon slugs', () => {
  assert.throws(() => buildAddonFiles('Bad_Slug'), /Invalid addon slug/u);
  assert.throws(() => buildAddonFiles('1bad'), /Invalid addon slug/u);
});

test('scaffoldAddon writes production-ready package files into target workspace', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mw-addon-create-'));
  try {
    const res = await scaffoldAddon('inventory-ops', { targetRoot: tmpDir });
    assert.equal(res.files.length, 4);
    const pkg = JSON.parse(await readFile(path.join(res.addonDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@moonwitness/orm-inventory-ops');
    assert.equal(pkg.moonwitnessAddon.name, 'inventory-ops');

    const src = await readFile(path.join(res.addonDir, 'src', 'index.ts'), 'utf8');
    assert.match(src, /defineModel/u);
    assert.match(src, /defineAddon/u);
    assert.doesNotMatch(src, /\bany\b/u);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
