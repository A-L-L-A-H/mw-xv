import assert from 'node:assert/strict';
import test from 'node:test';
import { BASIS_POINTS_TOTAL } from '../dist/index.js';

test('BASIS_POINTS_TOTAL equals 10_000', () => {
  assert.equal(BASIS_POINTS_TOTAL, 10_000);
});
