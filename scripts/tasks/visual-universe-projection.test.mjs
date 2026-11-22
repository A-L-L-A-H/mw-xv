import test from 'node:test';
import assert from 'node:assert/strict';
import { projectVisualUniverseTask } from './visual-universe-projection.mjs';

function sampleTask(overrides = {}) {
  const metadata = {
    id: 'W0-001',
    phase: 'W0',
    title: 'Original title',
    status: 'done',
    priority: 'P0',
    role: 'auditor',
    parallel_group: 'serial',
    depends_on: [],
    objective: 'Original objective',
    scope_hints: ['repository root'],
    deliverables: ['Baseline report'],
    acceptance_criteria: ['Verify the branch'],
    verification: ['git status --short --branch'],
    risk: 'low',
    human_approval_required: false,
    notes: 'Original note',
    evidence: [{ artifact: 'evidence/W0-001.md', command: 'git status', exit_code: 0 }],
    commit: 'a'.repeat(40),
  };
  return {
    code: metadata.id,
    project: 'visual-universe',
    series: 'W0',
    title: metadata.title,
    summary: metadata.objective,
    problem: metadata.objective,
    proposedSolution: metadata.deliverables.join('; '),
    priority: 'p0',
    status: 'done',
    human: false,
    owner: 'auditor',
    risk: 'low',
    dependsOn: [],
    tags: ['visual-universe', 'W0', 'auditor'],
    scope: { packages: [], files: ['repository root'] },
    acceptanceCriteria: [{ id: 'W0-001-ac-1', text: 'Verify the branch', done: true }],
    validation: { commands: ['git status --short --branch'], expected: 'Pass' },
    evidence: { paths: ['evidence/W0-001.md'], detailFile: 'tasks/W0/W0-001.md', commitSha: 'a'.repeat(40) },
    metadata,
    ...overrides,
  };
}

test('Visual Universe task projection is lossless for delegated metadata', () => {
  const source = sampleTask();
  const projected = projectVisualUniverseTask(source);
  assert.equal(projected.id, source.code);
  assert.equal(projected.status, 'done');
  assert.equal(projected.phase, 'W0');
  assert.deepEqual(projected.depends_on, []);
  assert.deepEqual(projected.acceptance_criteria, ['Verify the branch']);
  assert.deepEqual(projected.verification, ['git status --short --branch']);
  assert.deepEqual(projected.evidence, source.metadata.evidence);
  assert.equal(projected.commit, 'a'.repeat(40));
  assert.equal(projected.parallel_group, 'serial');
});

test('Visual Universe skipped tasks remain distinguishable from completed tasks', () => {
  const source = sampleTask({
    status: 'done',
    tags: ['visual-universe', 'W0', 'auditor', 'status:skipped'],
    metadata: { ...sampleTask().metadata, status: 'skipped' },
  });
  const projected = projectVisualUniverseTask(source);
  assert.equal(projected.status, 'skipped');
});

test('Visual Universe task projection follows canonical blocked state and dependencies', () => {
  const source = sampleTask({
    status: 'blocked',
    blockedReason: 'Needs an approved asset license.',
    dependsOn: ['W0-002'],
    acceptanceCriteria: [{ id: 'W0-001-ac-1', text: 'Verify the branch', done: false }],
  });
  const projected = projectVisualUniverseTask(source);
  assert.equal(projected.status, 'blocked');
  assert.equal(projected.notes, 'Needs an approved asset license.');
  assert.deepEqual(projected.depends_on, ['W0-002']);
});

test('Visual Universe projection rejects records without recoverable metadata', () => {
  assert.throws(
    () => projectVisualUniverseTask({ ...sampleTask(), metadata: null }),
    /no lossless Visual Universe metadata payload/u
  );
});

test('Visual Universe projection uses canonical TaskOS evidence paths without inventing execution results', () => {
  const source = sampleTask({
    evidence: {
      paths: ['evidence/W0-001.md', 'evidence/W0-001-follow-up.md'],
      detailFile: 'tasks/W0/W0-001.md',
      commitSha: null,
    },
    validation: { commands: ['pnpm test:taskos'], expected: 'Pass' },
  });
  const projected = projectVisualUniverseTask(source);
  assert.deepEqual(
    projected.evidence.map(({ artifact, exit_code }) => ({ artifact, exit_code })),
    [
      { artifact: 'evidence/W0-001.md', exit_code: 0 },
      { artifact: 'evidence/W0-001-follow-up.md', exit_code: null },
    ]
  );
  assert.match(projected.evidence[1].command, /not recorded/u);
  assert.deepEqual(projected.verification, ['pnpm test:taskos']);
});
