import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderVisualUniverseBoard,
  renderVisualUniverseTaskCard,
  validateVisualUniverseTaskGraph,
} from './visual-universe-renderers.mjs';

function makeTask(overrides = {}) {
  return {
    id: 'W0-001',
    phase: 'W0',
    title: 'Example task',
    status: 'in_progress',
    priority: 'P1',
    role: 'auditor',
    depends_on: [],
    objective: 'Verify the renderer uses the canonical TaskOS projection.',
    scope_hints: ['scripts/tasks'],
    deliverables: ['Task card'],
    acceptance_criteria: ['Inspect branch', 'Run tests'],
    acceptance_criteria_state: [
      { id: 'W0-001-ac-1', text: 'Inspect branch', done: true },
      { id: 'W0-001-ac-2', text: 'Run tests', done: false },
    ],
    verification: ['pnpm test:taskos'],
    risk: 'low',
    human_approval_required: false,
    notes: 'Canonical task note.',
    evidence: [{ command: 'pnpm test:taskos', exit_code: null, artifact: 'evidence/W0-001.md' }],
    commit: null,
    parallel_group: 'serial',
    legacyCardNotes: {
      text: 'Legacy note preserved from the archived card.',
      sourceFile: 'legacy/W0-001.md',
      sourceBlobSha: 'a'.repeat(40),
    },
    ...overrides,
  };
}

test('Task card renderer is driven by canonical TaskOS state, not prior card contents', () => {
  const rendered = renderVisualUniverseTaskCard(makeTask());
  assert.match(rendered, /Status: `in_progress`/u);
  assert.match(rendered, /- \[x\] Inspect branch/u);
  assert.match(rendered, /- \[ \] Run tests/u);
  assert.match(rendered, /Canonical task note\./u);
  assert.match(rendered, /Legacy note preserved from the archived card\./u);
  assert.match(rendered, /historical context; not lifecycle state/u);
  assert.match(rendered, /Git blob SHA: `a{40}`/u);
  assert.doesNotMatch(
    rendered,
    /exit not recorded/u,
    'in-progress work must not render a completion exit code'
  );
  assert.doesNotMatch(
    rendered,
    /evidence\/W0-001\.md/u,
    'in-progress work must not render completion evidence paths'
  );
});

test('completed task cards mark missing execution exit codes as not recorded', () => {
  const rendered = renderVisualUniverseTaskCard(makeTask({ status: 'done' }));
  assert.match(rendered, /Commands \/ exit codes:/u);
  assert.match(rendered, /exit not recorded/u);
  assert.match(rendered, /Evidence paths:/u);
  assert.ok(rendered.includes('evidence/W0-001.md'));
});

test('board renderer reports partial acceptance completion accurately', () => {
  const rendered = renderVisualUniverseBoard([makeTask()]);
  assert.match(rendered, /Acceptance \(1\/2 complete\)/u);
  assert.match(rendered, /\[x\] Inspect branch/u);
  assert.match(rendered, /\[ \] Run tests/u);
  assert.match(rendered, /Canonical lifecycle state is `docs\/tasks\/tasks\.json`/u);
});

test('task graph validator accepts a valid dependency chain', () => {
  assert.doesNotThrow(() =>
    validateVisualUniverseTaskGraph([
      makeTask({ id: 'W0-001', depends_on: [] }),
      makeTask({
        id: 'W0-002',
        depends_on: ['W0-001'],
        acceptance_criteria: [],
        acceptance_criteria_state: [],
      }),
    ])
  );
});

test('task graph validator rejects duplicate IDs, unknown dependencies and cycles', () => {
  assert.throws(
    () => validateVisualUniverseTaskGraph([makeTask(), makeTask()]),
    /Task IDs must be unique/u
  );
  assert.throws(
    () => validateVisualUniverseTaskGraph([makeTask({ depends_on: ['W9-999'] })]),
    /references unknown dependency/u
  );
  assert.throws(
    () =>
      validateVisualUniverseTaskGraph([
        makeTask({ id: 'W0-001', depends_on: ['W0-002'] }),
        makeTask({
          id: 'W0-002',
          depends_on: ['W0-001'],
          acceptance_criteria: [],
          acceptance_criteria_state: [],
        }),
      ]),
    /must be acyclic/u
  );
});

test('task graph validator rejects acceptance text/state drift and duplicate criterion IDs', () => {
  assert.throws(
    () =>
      validateVisualUniverseTaskGraph([
        makeTask({
          acceptance_criteria_state: [
            { id: 'W0-001-ac-1', text: 'Different text', done: true },
            { id: 'W0-001-ac-2', text: 'Run tests', done: false },
          ],
        }),
      ]),
    /acceptance criterion text projection drift/u
  );
  assert.throws(
    () =>
      validateVisualUniverseTaskGraph([
        makeTask({
          acceptance_criteria_state: [
            { id: 'duplicate', text: 'Inspect branch', done: true },
            { id: 'duplicate', text: 'Run tests', done: false },
          ],
        }),
      ]),
    /duplicate acceptance criterion/u
  );
});
