import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowActionState } from '../../apps/board/src/lib/workflow-action-state.mjs';

test('workflow panel distinguishes finished, misconfigured, unauthorized, and available actions', () => {
  assert.equal(
    workflowActionState({
      isActive: false,
      configuredTransitionCount: 1,
      allowedTransitionCount: 0,
    }),
    'not_applicable'
  );
  assert.equal(
    workflowActionState({
      isActive: true,
      configuredTransitionCount: 0,
      allowedTransitionCount: 0,
    }),
    'unconfigured'
  );
  assert.equal(
    workflowActionState({
      isActive: true,
      configuredTransitionCount: 1,
      allowedTransitionCount: 0,
    }),
    'permission_denied'
  );
  assert.equal(
    workflowActionState({
      isActive: true,
      configuredTransitionCount: 2,
      allowedTransitionCount: 1,
    }),
    'available'
  );
});
