import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

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
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      }
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
          files: ['package.json']
        },
        acceptanceCriteria: [
          { id: 'ac-1', text: 'All packages run in test:unit:built', done: false }
        ],
        validation: {
          commands: ['pnpm verify'],
          expected: 'Pass 100%'
        },
        evidence: {
          paths: [],
          detailFile: null,
          commitSha: null
        },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'audit', legacyId: null },
        url: '',
        comments: []
      }
    ]
  };

  const valid = validate(sample);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});
