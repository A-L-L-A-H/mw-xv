import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTaskRegistryValid } from './sync-roadmap.mjs';

test('TaskOS sync refuses an invalid or unavailable registry', () => {
  assert.throws(
    () => assertTaskRegistryValid({
      valid: false,
      taskCount: 0,
      errors: ['TaskOS registry docs/tasks/tasks.json is empty. Recovery mode is active.'],
    }),
    /Refusing TaskOS sync: canonical registry has not passed validation[\s\S]*TaskOS registry/u
  );
});

test('TaskOS sync refuses a valid-shaped but empty registry', () => {
  assert.throws(
    () => assertTaskRegistryValid({ valid: true, taskCount: 0, errors: [] }),
    /canonical registry contains no task records/u
  );
});

test('TaskOS sync accepts a validated non-empty registry', () => {
  assert.doesNotThrow(() =>
    assertTaskRegistryValid({ valid: true, taskCount: 239, errors: [] })
  );
});
