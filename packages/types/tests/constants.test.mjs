import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASIS_POINTS_TOTAL,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
} from '../dist/index.js';

test('BASIS_POINTS_TOTAL equals 10_000', () => {
  assert.equal(BASIS_POINTS_TOTAL, 10_000);
});

test('MILLISECONDS_PER_MINUTE equals 60_000', () => {
  assert.equal(MILLISECONDS_PER_MINUTE, 60_000);
});

test('MILLISECONDS_PER_HOUR equals 3_600_000', () => {
  assert.equal(MILLISECONDS_PER_HOUR, 3_600_000);
});
