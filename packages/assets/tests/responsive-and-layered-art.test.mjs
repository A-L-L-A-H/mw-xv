import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RESPONSIVE_DERIVATIVE_PRESETS,
  planResponsiveDerivatives,
  verifyMasterImmutability,
  verifyResponsiveDerivatives,
} from '../scripts/responsive-derivatives.mjs';
import { MOON_CITY_LAYERS, validateLayeredArtStack } from '../scripts/layered-art-pipeline.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('W2-006 responsive derivative presets protect masters, budgets, and AVIF policy', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const immutability = verifyMasterImmutability(manifest);
  assert.ok(immutability.sourceCount >= 4);
  assert.ok(immutability.artworkCount >= 9);

  const planned = planResponsiveDerivatives(manifest, RESPONSIVE_DERIVATIVE_PRESETS);
  assert.equal(planned.length, immutability.artworkCount);

  const measured = await verifyResponsiveDerivatives(packageRoot);
  for (const item of measured) {
    assert.ok(item.bytes <= item.maxBytes, `${item.path} exceeds preset budget`);
  }

  assert.throws(
    () =>
      planResponsiveDerivatives({
        assets: [
          { path: 'source/artwork/home-hero-master.png', kind: 'source' },
          {
            path: 'illustrations/home-hero-desktop.avif',
            source: 'source/artwork/home-hero-master.png',
            kind: 'artwork',
            variant: 'desktop',
            format: 'avif',
            width: 1800,
            height: 900,
          },
        ],
      }),
    /Unconditional AVIF derivative/u
  );
});

test('W2-007 layered art stack preserves alpha channels, 2048x1152 alignment, and z-order', async () => {
  const report = await validateLayeredArtStack(packageRoot, MOON_CITY_LAYERS);
  assert.equal(report.layerCount, 6);
  assert.equal(report.width, 2048);
  assert.equal(report.height, 1152);
  assert.equal(report.layers.find((layer) => layer.id === 'moon')?.hasAlpha, true);
  assert.equal(report.layers.find((layer) => layer.id === 'skyline')?.hasAlpha, true);

  await assert.rejects(
    () =>
      validateLayeredArtStack(packageRoot, [
        MOON_CITY_LAYERS[0],
        { ...MOON_CITY_LAYERS[1], zIndex: 0 },
      ]),
    /must strictly increase/u
  );
});
