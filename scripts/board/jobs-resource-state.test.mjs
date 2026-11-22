import assert from 'node:assert/strict';
import test from 'node:test';
import { jobsResourceState } from '../../apps/board/src/lib/jobs-resource-state.mjs';

test('admin job resources distinguish loading, API failure, absence, zero, and real data', () => {
  assert.equal(jobsResourceState({ isLoading: true, isError: false, hasData: false }), 'loading');
  assert.equal(jobsResourceState({ isLoading: false, isError: true, hasData: false }), 'error');
  assert.equal(
    jobsResourceState({ isLoading: false, isError: false, hasData: false }),
    'unavailable'
  );
  assert.equal(
    jobsResourceState({ isLoading: false, isError: false, hasData: true, isEmpty: true }),
    'empty'
  );
  assert.equal(jobsResourceState({ isLoading: false, isError: false, hasData: true }), 'ready');
});
