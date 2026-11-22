import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateSceneBundle } from '../scripts/scene-schema.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('canonical moon-city-scene.json validates against manifest and scene-schema', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const bundle = JSON.parse(await readFile(resolve(packageRoot, 'scenes/moon-city-scene.json'), 'utf8'));
  const result = validateSceneBundle(bundle, manifest, 'packages/assets/scenes/moon-city-scene.json');
  assert.equal(result.sceneCount, 1);
  assert.equal(result.clipCount, 3);
  const hero = bundle.scenes[0];
  assert.equal(hero.id, 'moon-city-hero');
  assert.ok(hero.layers.length >= 8, 'scene separates sky, moon, clouds, skylines, foreground, and props');
  assert.ok(hero.breakpoints.some((bp) => bp.name === 'mobile'), 'declares mobile composition breakpoint');
  assert.ok(hero.breakpoints.some((bp) => bp.name === 'desktop'), 'declares desktop composition breakpoint');
  for (const clip of bundle.clips) {
    assert.ok(clip.frames.length >= 1, `${clip.id} defines at least one frame`);
    for (const frame of clip.frames) {
      assert.ok(frame.durationMs >= 100 && frame.durationMs <= 60000, `${clip.id} frame timing is bounded`);
    }
  }
});

test('environment-kit.json references canonical environment assets with zero embedded copy', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const known = new Set(manifest.assets.map((asset) => asset.path));
  const kit = JSON.parse(
    await readFile(resolve(packageRoot, 'source/world/environments/environment-kit.json'), 'utf8')
  );
  assert.equal(kit.schemaVersion, 1);
  assert.equal(kit.license, 'ISC');
  assert.ok(kit.depthOrder.length >= 9);
  assert.equal(kit.alternateEnvironments.length, 4);
  for (const entry of [...kit.depthOrder, ...kit.alternateEnvironments]) {
    assert.ok(known.has(entry.asset), `${entry.asset} is registered in manifest.json`);
    const svg = await readFile(resolve(packageRoot, entry.asset), 'utf8');
    assert.doesNotMatch(svg, /<text\b/iu, `${entry.asset} must not embed interface text`);
  }
});
