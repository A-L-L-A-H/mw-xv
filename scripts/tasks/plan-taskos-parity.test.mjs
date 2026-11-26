/**
 * T43 — Parity gate between Plan-TaskOS projections and the repository's
 * canonical TaskOS validator / GitHub managed-block sync contract.
 *
 * The SDK is loaded from its built output because scripts/ run on plain Node.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateTaskRegistryData } from './validate-tasks.mjs';
import { planIssueSync } from '../roadmap/sync-issues.mjs';

const sdk = await import(
  pathToFileURL(path.resolve('packages/plan-taskos/dist/index.js')).href
);
const {
  MANAGED_BEGIN,
  MANAGED_END,
  mergeTaskosV2Patch,
  planGitHubOperations,
  projectBundleToTaskosV2,
  splitManagedBlock,
} = sdk;

const PLAN_ID = 'parity-demo';
const WAVE_ID = `${PLAN_ID}:W1`;
const TASK_CODE = 'M0.01';
const TASK_URN = `urn:mw:work:demo/repo:${PLAN_ID}:W1/${TASK_CODE}`;
const repoId = '123456789';
const sourceSha = 'a'.repeat(40);

function createBundle() {
  const task = {
    urn: TASK_URN,
    code: TASK_CODE,
    kind: 'task',
    title: 'Verify parity gate',
    lifecycle: {
      status: 'done',
      delivery_stage: 'in_main',
      attempts: 1,
      model_tier: 'flash',
    },
    governance: { owner_files: ['scripts/tasks/plan-taskos-parity.test.mjs'], owner_globs: [] },
    graph: { depends_on: [] },
    verification: {
      commands: [{ cmd: 'node --test scripts/tasks/plan-taskos-parity.test.mjs' }],
      acceptance_criteria: ['Parity gate passes'],
    },
    projections: { taskos_code: TASK_CODE },
  };
  return {
    format: 'plan-taskos/v1',
    source_path: 'scripts/tasks/plan-taskos-parity.test.mjs',
    manifest: {
      schema_version: '1.0.0',
      plan_id: PLAN_ID,
      title: 'Plan-TaskOS parity demo',
      repo: { org: 'demo', name: 'repo', target_branch: 'dev' },
      adr_file: `.plan/${PLAN_ID}/ADR.md`,
      execution_policy: {
        max_attempts_per_task: 3,
        default_model_tier: 'flash',
        escalation_chain: ['flash'],
        require_clean_scope: true,
        auto_commit: true,
      },
      projections: {
        github_fold_mode: 'task',
        taskos_project: PLAN_ID,
        orm_project_code: PLAN_ID,
      },
      waves: [{ id: WAVE_ID, title: 'Wave 1', wave_file: 'waves/w1.json', depends_on: [] }],
      documents: [],
    },
    waves: [{ wave_id: WAVE_ID, title: 'Wave 1', tasks: [task] }],
    documents: [],
  };
}

test('projectBundleToTaskosV2 output validates against the canonical TaskOS v2 contract', async () => {
  const bundle = createBundle();
  const projection = projectBundleToTaskosV2(bundle, { foldMode: 'task' });

  assert.equal(projection.tasks.length, 1);
  assert.equal(projection.tasks[0]?.code, TASK_CODE);
  assert.equal(projection.tasks[0]?.metadata.plan_urn, TASK_URN);

  // Validate the projection against the real registry contract: the canonical
  // registry supplies every roadmap task, and the projected records replace
  // the records carrying the same TaskOS code.
  const registry = JSON.parse(await readFile('docs/tasks/tasks.json', 'utf8'));
  // Use the SDK's own merge adapter to enforce the reciprocal edge contract.
  const merged = mergeTaskosV2Patch(registry, projection.tasks);
  const result = await validateTaskRegistryData(
    {
      schemaVersion: '2.0.0',
      format: 'moonwitness-tasks/v2',
      generatedAt: '2026-01-01T00:00:00.000Z',
      projects: [{ slug: projection.projectSlug, name: 'Plan-TaskOS parity demo' }, ...registry.projects],
      tasks: merged.tasks,
      documents: [...registry.documents ?? [], ...projection.documents],
    },
    { checkRoadmapParity: false }
  );

  assert.equal(result.valid, true, `Projected TaskOS v2 records failed validation: ${result.errors.join('; ')}`);
  assert.equal(result.taskCount, registry.tasks.length);
  assert.equal(result.errors.length, 0);
});

test('GitHub adapter managed blocks match the sync-issues managed-block contract', () => {
  const bundle = createBundle();
  const [operation] = planGitHubOperations({
    bundle,
    context: { repoId, foldMode: 'task' },
  });

  assert.equal(operation?.operation, 'create');
  assert.ok(operation.body.includes(MANAGED_BEGIN));
  assert.ok(operation.body.includes(MANAGED_END));
  const { managed, human } = splitManagedBlock(operation.body);
  assert.ok(managed?.startsWith(MANAGED_BEGIN));
  assert.ok(managed.endsWith(MANAGED_END));
  // The task marker deliberately sits before the managed block in the
  // sync-issues contract; preserve it as human-prefix parity content.
  assert.equal(human, `<!-- moonwitness-task: ${repoId}:${TASK_CODE} -->`);

  const existing = {
    number: 17,
    title: operation.title,
    body: `${operation.body}\n\n## Catatan maintainer\nKeep this note.`,
    state: 'open',
    labels: (operation.labels ?? []).map((name) => ({ name })),
  };
  const sync = planIssueSync({
    tasks: [
      {
        id: TASK_CODE,
        title: 'Verify parity gate drift',
        milestone: WAVE_ID,
        dependsOn: [],
        detailFile: 'scripts/tasks/plan-taskos-parity.test.mjs',
        output: 'Parity gate',
      },
    ],
    issues: [existing],
    repositoryId: repoId,
    sourceSha,
  });
  const syncOperation = sync.operations[0];
  assert.equal(syncOperation.operation, 'update');
  assert.ok(
    syncOperation.body.endsWith('\n\n## Catatan maintainer\nKeep this note.'),
    'sync-issues must preserve maintainer notes byte-for-byte outside the managed fence'
  );
  assert.match(syncOperation.body, /## Catatan maintainer\nKeep this note\./u);
  const syncBlock = syncOperation.body.slice(
    syncOperation.body.indexOf(MANAGED_BEGIN),
    syncOperation.body.indexOf(MANAGED_END) + MANAGED_END.length
  );
  assert.ok(syncBlock.startsWith(MANAGED_BEGIN));
  assert.ok(syncBlock.endsWith(MANAGED_END));
  assert.match(managed, /<!-- moonwitness-hash: [0-9a-f]{64} -->/u);

  const driftedBundle = {
    ...bundle,
    waves: [
      {
        ...bundle.waves[0],
        tasks: [{ ...bundle.waves[0].tasks[0], title: 'Verify parity gate drift' }],
      },
    ],
  };
  const updated = planGitHubOperations({
    bundle: driftedBundle,
    context: { repoId, foldMode: 'task' },
    remoteIssues: [existing],
  })[0];

  assert.equal(updated.operation, 'update');
  assert.ok(updated.body.includes(MANAGED_BEGIN));
  assert.ok(updated.body.includes(MANAGED_END));
  assert.ok(updated.body.includes('## Catatan maintainer'));
  assert.ok(updated.body.includes('Keep this note.'));
  const preserved = splitManagedBlock(updated.body);
  assert.ok(preserved.human.startsWith(`<!-- moonwitness-task: ${repoId}:${TASK_CODE} -->`));
  assert.ok(preserved.human.includes('## Catatan maintainer'));
  assert.ok(preserved.human.endsWith('Keep this note.'));
  assert.notEqual(preserved.managed, managed);

  const unchanged = planGitHubOperations({
    bundle,
    context: { repoId, foldMode: 'task' },
    remoteIssues: [
      {
        number: 18,
        title: operation.title,
        body: `${operation.body}\n\n## Catatan maintainer\nKeep this note.`,
        state: 'open',
        labels: existing.labels,
      },
    ],
  })[0];
  assert.equal(unchanged.operation, 'noop');

  const conflict = planGitHubOperations({
    bundle,
    context: { repoId, foldMode: 'task' },
    remoteIssues: [
      existing,
      {
        number: 19,
        title: operation.title,
        body: operation.body,
        state: 'open',
        labels: existing.labels,
      },
    ],
  })[0];
  assert.equal(conflict.operation, 'conflict');
});
