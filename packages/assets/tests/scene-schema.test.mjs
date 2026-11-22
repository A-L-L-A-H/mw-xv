import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSceneBundle } from '../scripts/scene-schema.mjs';

const manifest = { assets: [
  { path: 'source/sky.svg' },
  { path: 'source/city.svg' },
  { path: 'source/static.png' },
  { path: 'source/frame-01.png' },
] };

const validBundle = () => ({
  scenes: [
    {
      id: 'moon-city',
      layers: [
        { id: 'sky', asset: 'source/sky.svg', order: 0, position: { x: 0.5, y: 0.5 }, parallax: { x: 0.1, y: 0 } },
        { id: 'city', asset: 'source/city.svg', order: 1, position: { x: 0.5, y: 0.8 }, opacity: 0.92 },
      ],
      staticFallback: 'source/static.png',
      includes: ['night-sky'],
      clips: ['cloud-idle'],
    },
    {
      id: 'night-sky',
      layers: [{ id: 'sky', asset: 'source/sky.svg', order: 0, position: { x: 0.5, y: 0.5 } }],
      staticFallback: 'source/static.png',
    },
  ],
  clips: [{
    id: 'cloud-idle', loop: true, direction: 'forward', pivot: { x: 0.5, y: 0.5 },
    frames: [{ asset: 'source/frame-01.png', durationMs: 120 }],
  }],
});

test('validates scene layers and animation clips against canonical assets', () => {
  assert.deepEqual(validateSceneBundle(validBundle(), manifest), { sceneCount: 2, clipCount: 1 });
});

test('rejects unresolved assets and clips and cyclic scene includes', () => {
  const missingAsset = validBundle();
  missingAsset.scenes[0].layers[0].asset = 'missing.png';
  assert.throws(() => validateSceneBundle(missingAsset, manifest), /must reference a canonical manifest asset/u);

  const missingClip = validBundle();
  missingClip.scenes[0].clips = ['unknown'];
  assert.throws(() => validateSceneBundle(missingClip, manifest), /references missing clip unknown/u);

  const cyclic = validBundle();
  cyclic.scenes[1].includes = ['moon-city'];
  assert.throws(() => validateSceneBundle(cyclic, manifest), /creates a cyclic scene reference/u);
});

test('rejects business records, duplicate layer orders, and unbounded parallax', () => {
  const leakedRecord = validBundle();
  leakedRecord.scenes[0].permissions = ['admin'];
  assert.throws(() => validateSceneBundle(leakedRecord, manifest), /outside the presentation-only scene contract/u);

  const duplicateOrder = validBundle();
  duplicateOrder.scenes[0].layers[1].order = 0;
  assert.throws(() => validateSceneBundle(duplicateOrder, manifest), /order: must be a unique integer/u);

  const unbounded = validBundle();
  unbounded.scenes[0].layers[0].parallax.x = 1.1;
  assert.throws(() => validateSceneBundle(unbounded, manifest), /must be bounded between -1 and 1/u);

  const secretLikePayload = validBundle();
  secretLikePayload.scenes[0].title = 'Bearer production-secret-value';
  assert.throws(() => validateSceneBundle(secretLikePayload, manifest), /title: is not supported by the presentation-only schema/u);
});
