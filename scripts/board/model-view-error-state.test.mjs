import assert from 'node:assert/strict';
import test from 'node:test';
import { modelViewErrorState } from '../../apps/board/src/lib/model-view-error-state.mjs';

test('model view distinguishes forbidden, unavailable, and transient failures', () => {
  assert.equal(modelViewErrorState({ status: 403 }).title, 'Access denied');
  assert.equal(modelViewErrorState({ status: 404 }).title, 'Model unavailable');
  assert.equal(modelViewErrorState(new Error('offline')).title, 'Failed to load model views');
});
