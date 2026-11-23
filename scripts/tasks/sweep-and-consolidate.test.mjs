import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { mapEvolutionStatus, sweepAndConsolidate } from './sweep-and-consolidate.mjs';
import { validateTaskRegistryData } from './validate-tasks.mjs';

test('sweepAndConsolidate aggregates all sources and produces schema-valid tasks.json', async () => {
  const generatedAt = '2026-11-23T00:00:00.000Z';
  const result = await sweepAndConsolidate({ generatedAt });
  const secondProjection = await sweepAndConsolidate({ generatedAt });
  assert.deepEqual(secondProjection, result, 'Same source snapshot and timestamp must produce identical output.');
  assert.ok(result);
  assert.equal(result.schemaVersion, '2.0.0');
  assert.equal(result.format, 'moonwitness-tasks/v2');
  assert.ok(Array.isArray(result.projects));
  assert.ok(Array.isArray(result.tasks));

  const candidateValidation = await validateTaskRegistryData(result);
  assert.equal(
    candidateValidation.valid,
    true,
    candidateValidation.errors.join('\n')
  );
  assert.equal(candidateValidation.taskCount, 627);

  // Source inventory: 239 roadmap + 14 audit + 112 WhatsApp + 7 legacy MW
  // + 14 promotion lifecycle + 128 desktop + 4 evolution + 109 Visual Universe records.
  assert.equal(result.tasks.length, 627, `Expected 627 source-backed tasks, got ${result.tasks.length}`);
  const statusCounts = Object.fromEntries(
    ['done', 'doing', 'todo', 'blocked'].map((status) => [
      status,
      result.tasks.filter((task) => task.status === status).length,
    ])
  );
  assert.deepEqual(statusCounts, { done: 468, doing: 49, todo: 89, blocked: 21 });

  const sourceCounts = Object.fromEntries(
    [...new Set(result.tasks.map((task) => task.sourceRef.file))]
      .sort()
      .map((source) => [source, result.tasks.filter((task) => task.sourceRef.file === source).length])
  );
  assert.deepEqual(sourceCounts, {
    'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/legacy/task-source-2026-11-23.json': 109,
    'docs/archive/todos/todo.md': 7,
    'docs/roadmap/tasks.json': 239,
    'evolution/backlog.json': 4,
    'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md': 14,
    'scripts/tasks/sources/audit-tasks.mjs': 14,
    'todo-desktop.md': 128,
    'todo-wa.md': 112,
  });


  // Reconcile every old root-todo record by stable code against the archived checklist.
  // The checked items remain historical evidence; only the seven unchecked items are re-imported as blocked.
  const legacyRegistry = JSON.parse(await readFile('docs/tasks/tasks.json', 'utf8'));
  const archivedTodoText = await readFile('docs/archive/todos/todo.md', 'utf8');
  const archivedRows = archivedTodoText
    .split(/\r?\n/)
    .map((line) => /^\s*-\s*\[([ xX])\]\s+\*\*(MW-[A-Za-z0-9_.-]+)\*\*/.exec(line))
    .filter(Boolean);
  const legacyRootTodo = legacyRegistry.tasks.filter((task) => task.sourceRef?.file === 'todo.md');
  const legacyDoneCodes = legacyRootTodo.filter((task) => task.status === 'done').map((task) => task.code).sort();
  const legacyOpenCodes = legacyRootTodo.filter((task) => task.status === 'todo').map((task) => task.code).sort();
  const archivedCheckedCodes = archivedRows.filter((row) => row[1].toLowerCase() === 'x').map((row) => row[2]).sort();
  const archivedOpenCodes = archivedRows.filter((row) => row[1] === ' ').map((row) => row[2]).sort();

  assert.equal(legacyRootTodo.length, 861);
  assert.equal(legacyDoneCodes.length, 854);
  assert.equal(legacyOpenCodes.length, 7);
  assert.equal(archivedRows.length, 861);
  assert.deepEqual(legacyDoneCodes, archivedCheckedCodes);
  assert.deepEqual(legacyOpenCodes, archivedOpenCodes);

  const importedLegacyOpen = result.tasks
    .filter((task) => task.sourceRef.file === 'docs/archive/todos/todo.md')
    .map((task) => task.code)
    .sort();
  assert.deepEqual(importedLegacyOpen, archivedOpenCodes);
  assert.ok(
    result.tasks
      .filter((task) => task.sourceRef.file === 'docs/archive/todos/todo.md')
      .every((task) => task.status === 'blocked'),
    'Open archived legacy tasks must be retained as blocked pending re-triage.'
  );

  // Check specific task codes
  const taskByCode = new Map(result.tasks.map((t) => [t.code, t]));
  assert.ok(taskByCode.has('M0.01'), 'Must include M0.01');
  assert.ok(taskByCode.has('K0-001'), 'Must include K0-001');
  assert.ok(taskByCode.has('AUD-001'), 'Must include AUD-001');
  assert.ok(taskByCode.has('WA-P0-01'), 'Must include WA-P0-01');
  assert.ok(taskByCode.has('EVO-002'), 'Must include EVO-002');
  assert.ok(taskByCode.has('DSK-0.12'), 'Must include DSK-0.12');
  assert.ok(taskByCode.has('MW-CFG-003.3'), 'Must include MW-CFG-003.3 from the archived legacy checklist.');
  assert.ok(taskByCode.has('PR.14'), 'Must include the explicit human promotion approval gate.');
  assert.ok(taskByCode.has('W0-001'), 'Must include delegated Visual Universe work.');

  // Verify status mapping: M0.01 is complete in ROADMAP.md, so it must be 'done'
  assert.equal(taskByCode.get('M0.01').status, 'done');
  assert.equal(taskByCode.get('MW-CFG-003.3').status, 'blocked');
  assert.equal(taskByCode.get('PR.14').status, 'blocked');
  assert.equal(taskByCode.get('PR.14').human, true);
  assert.equal(taskByCode.get('DSK-0.12').status, 'done');
  assert.equal(taskByCode.get('EVO-002').status, 'doing');
  const visualTasks = result.tasks.filter((task) => task.project === 'visual-universe');
  assert.equal(visualTasks.length, 109);
  assert.equal(visualTasks.filter((task) => task.status === 'blocked').length, 13);
  assert.equal(visualTasks.filter((task) => task.status === 'done').length, 96);
  assert.equal(visualTasks.filter((task) => task.tags.includes('status:skipped')).length, 3);
  assert.ok(visualTasks.every((task) => task.metadata?.id === task.code));
  assert.deepEqual(taskByCode.get('W1-001').metadata.legacyCardNotes, {
    text: 'Human approval required only for canonical style lock. Continue other independent audit work while waiting.',
    sourceFile: 'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tasks/W1/W1-001.md',
    sourceBlobSha: '74b510d170dd12c640f1ffb1e734ae5293187dcc',
  });
  assert.deepEqual(taskByCode.get('W5-012').metadata.legacyCardNotes, {
    text: 'May be skipped with documented reason; do not block the baseline world runtime.',
    sourceFile: 'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tasks/W5/W5-012.md',
    sourceBlobSha: 'fe2364614cf7ddfe550e26bbbcea2dcc8a5cf79f',
  });
  assert.equal(taskByCode.get('W1-002').metadata.legacyCardNotes, null);
});

test('candidate validator rejects unknown graph edges before registry writes', async () => {
  const candidate = await sweepAndConsolidate({ generatedAt: '2026-11-23T00:00:00.000Z' });
  candidate.tasks[0].dependsOn.push('UNKNOWN-TASK');
  const validation = await validateTaskRegistryData(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('unknown dependency "UNKNOWN-TASK"')));
});

test('candidate validator rejects invalid provenance before registry writes', async () => {
  const candidate = await sweepAndConsolidate({ generatedAt: '2026-11-23T00:00:00.000Z' });
  candidate.tasks[0].sourceRef.file = '../outside-repository.json';
  const validation = await validateTaskRegistryData(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('repository-relative path')));
});

test('candidate validator rejects roadmap lifecycle drift before registry writes', async () => {
  const candidate = await sweepAndConsolidate({ generatedAt: '2026-11-23T00:00:00.000Z' });
  const roadmapTask = candidate.tasks.find((task) => task.code === 'M0.01');
  roadmapTask.status = 'todo';
  const validation = await validateTaskRegistryData(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('Status mismatch on "M0.01"')));
  assert.ok(validation.errors.some((error) => error.includes('Checkbox mismatch on "M0.01"')));
});

test('evolution status import accepts only explicit lifecycle states', () => {
  assert.equal(mapEvolutionStatus('completed'), 'done');
  assert.equal(mapEvolutionStatus('active'), 'doing');
  assert.throws(
    () => mapEvolutionStatus('planned'),
    /Unsupported evolution backlog status "planned"/u
  );
});

test('registry integrity validation can run before roadmap projection repair', async () => {
  const candidate = await sweepAndConsolidate({ generatedAt: '2026-11-23T00:00:00.000Z' });
  const roadmapTask = candidate.tasks.find((task) => task.code === 'M0.01');
  roadmapTask.status = 'todo';

  const integrityOnly = await validateTaskRegistryData(candidate, { checkRoadmapParity: false });
  assert.equal(integrityOnly.valid, true, integrityOnly.errors.join('\\n'));

  const fullValidation = await validateTaskRegistryData(candidate);
  assert.equal(fullValidation.valid, false);
  assert.ok(fullValidation.errors.some((error) => error.includes('Status mismatch on "M0.01"')));
  assert.ok(fullValidation.errors.some((error) => error.includes('Checkbox mismatch on "M0.01"')));
});


test('isolated recovery candidate mode writes validated output without touching the canonical registry', async () => {
  const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const canonicalPath = path.join(repositoryRoot, 'docs/tasks/tasks.json');
  const canonicalBefore = await readFile(canonicalPath, 'utf8');
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-taskos-candidate-'));
  const candidatePath = path.join(tempRoot, 'candidate.json');

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/tasks/sweep-and-consolidate.mjs', '--candidate', candidatePath],
      { cwd: repositoryRoot, encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1795392000' } }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
    const validation = await validateTaskRegistryData(candidate);
    assert.equal(validation.valid, true, validation.errors.join('\n'));
    assert.equal(candidate.tasks.length, 627);
    assert.equal(await readFile(canonicalPath, 'utf8'), canonicalBefore);
    assert.equal((await stat(candidatePath)).isFile(), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('candidate output mode refuses paths inside the repository', async () => {
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const insidePath = path.join(repositoryRoot, 'docs/tasks/recovery-candidate.json');
  const result = spawnSync(
    process.execPath,
    ['scripts/tasks/sweep-and-consolidate.mjs', '--candidate', insidePath],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /candidate output must be outside the repository/u);
});
