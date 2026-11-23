import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNormalizedPoint, isBoundedParallax, isLayerDefinition } from '../dist/index.js';

test('isNormalizedPoint accepts valid points and rejects out-of-range', () => {
  assert.equal(isNormalizedPoint({ x: 0.5, y: 0.5 }), true);
  assert.equal(isNormalizedPoint({ x: 0, y: 0 }), true);
  assert.equal(isNormalizedPoint({ x: 1, y: 1 }), true);
  assert.equal(isNormalizedPoint({ x: 1.1, y: 0.5 }), false);
  assert.equal(isNormalizedPoint({ x: -0.1, y: 0.5 }), false);
  assert.equal(isNormalizedPoint(null), false);
  assert.equal(isNormalizedPoint({ x: 0.5 }), false);
});

test('isBoundedParallax accepts values within -1..1', () => {
  assert.equal(isBoundedParallax({ x: 0.2, y: 0 }), true);
  assert.equal(isBoundedParallax({ x: -1, y: 1 }), true);
  assert.equal(isBoundedParallax({ x: 1.1, y: 0 }), false);
  assert.equal(isBoundedParallax(null), false);
});

test('isLayerDefinition validates well-formed layer descriptors', () => {
  assert.equal(
    isLayerDefinition({
      id: 'sky',
      asset: 'source/sky.svg',
      order: 0,
      position: { x: 0.5, y: 0.5 },
      parallax: { x: 0.1, y: 0 },
    }),
    true
  );
  assert.equal(
    isLayerDefinition({
      id: 'sky',
      asset: 'source/sky.svg',
      order: 0,
      position: { x: 0.5, y: 0.5 },
    }),
    true
  );
  assert.equal(
    isLayerDefinition({ id: '', asset: 'source/sky.svg', order: 0, position: { x: 0.5, y: 0.5 } }),
    false
  );
  assert.equal(isLayerDefinition(null), false);
});
