import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  findStaleRecoveryNarrative,
  parseTasksRegistry,
  toRoadmapTaskStatus,
  validateTasks,
} from './validate-tasks.mjs';

const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

test('tasks.schema.json is a valid Draft-07 JSON Schema and accepts valid v2 tasks payload', async () => {
  const schemaRaw = await fs.readFile('docs/tasks/tasks.schema.json', 'utf8');
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const sample = {
    schemaVersion: '2.0.0',
    format: 'moonwitness-tasks/v2',
    generatedAt: new Date().toISOString(),
    projects: [
      {
        slug: 'moonwitness',
        name: 'MoonWitness Platform',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'blue',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done'],
      },
    ],
    tasks: [
      {
        code: 'AUD-002',
        project: 'moonwitness',
        series: 'AUD',
        milestone: 'AUDIT-NOW',
        horizon: 'now',
        title: 'Integrate AI and Desktop packages to CI gate',
        summary: 'Short summary for card view',
        problem: '5 AI packages omitted from test runners',
        proposedSolution: 'Add packages to test:unit:built and ci.yml',
        category: 'dx',
        type: 'infrastructure',
        priority: 'p0',
        status: 'todo',
        human: false,
        owner: 'dev-team',
        assignee: null,
        risk: 'low',
        effort: 'm',
        scores: { impact: 5, confidence: 5, strategicValue: 5, effort: 3, priorityScore: 41.7 },
        dependsOn: [],
        blocks: ['AUD-005'],
        tags: ['ci', 'ai', 'conformance'],
        scope: {
          packages: ['@moonwitness/orm-ai'],
          files: ['package.json'],
        },
        acceptanceCriteria: [
          { id: 'ac-1', text: 'All packages run in test:unit:built', done: false },
        ],
        validation: {
          commands: ['pnpm verify'],
          expected: 'Pass 100%',
        },
        evidence: {
          paths: [],
          detailFile: null,
          commitSha: null,
        },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'audit', legacyId: null },
        url: '',
        comments: [],
      },
    ],
  };

  const valid = validate(sample);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});

test('TaskOS registry parser fails with recovery guidance on empty input', () => {
  assert.throws(() => parseTasksRegistry(''), /TaskOS registry.*empty.*Recovery mode is active/i);
});

test('TaskOS registry parser fails with recovery guidance on whitespace-only input', () => {
  assert.throws(
    () => parseTasksRegistry('  ' + String.fromCharCode(10, 9)),
    /TaskOS registry.*empty.*Recovery mode is active/i
  );
});

test('TaskOS registry parser reports invalid JSON clearly', () => {
  assert.throws(() => parseTasksRegistry('{ invalid'), /TaskOS registry.*invalid JSON/i);
});

test('TaskOS registry parser accepts syntactically valid JSON', () => {
  assert.deepEqual(parseTasksRegistry('{"tasks":[]}'), { tasks: [] });
});

test('TaskOS statuses map consistently to the roadmap projection', () => {
  assert.equal(toRoadmapTaskStatus('done'), 'complete');
  assert.equal(toRoadmapTaskStatus('doing'), 'in_progress');
  assert.equal(toRoadmapTaskStatus('review'), 'in_progress');
  assert.equal(toRoadmapTaskStatus('blocked'), 'blocked');
  assert.equal(toRoadmapTaskStatus('backlog'), 'todo');
  assert.equal(toRoadmapTaskStatus('todo'), 'todo');
  assert.equal(toRoadmapTaskStatus('unknown'), null);
});

test('stale recovery claims are rejected only for a non-empty registry', () => {
  const stale = [
    'Recovery status: BLOCKED',
    'currently zero-byte',
    'Do not resume autonomous implementation',
    'while TaskOS remains unavailable',
  ].join('\n');
  assert.equal(findStaleRecoveryNarrative(stale, 0).length, 0);
  assert.deepEqual(findStaleRecoveryNarrative(stale, 627), [
    'docs/tasks/sources/todo.md still declares recovery BLOCKED',
    'docs/tasks/sources/todo.md still describes the registry as zero-byte',
    'docs/tasks/sources/todo.md still contains a do-not-resume recovery instruction',
    'docs/tasks/sources/todo.md still says TaskOS is unavailable',
  ]);
  assert.deepEqual(findStaleRecoveryNarrative('Registry status: RECOVERED / ACTIVE', 627), []);
});

test('committed docs/tasks/sources/todo.md recovery narrative matches the valid registry', async () => {
  const result = await validateTasks();
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.ok(result.taskCount > 0);
});
