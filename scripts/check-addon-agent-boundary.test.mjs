import assert from 'node:assert/strict';
import test from 'node:test';
import { findAgentBoundaryViolations } from './check-addon-agent-boundary.mjs';

test('blocks defineModel and defineAddon in agent-owned surfaces', () => {
  const modelViolations = findAgentBoundaryViolations(
    `import { defineModel, fields } from '@moonwitness/orm';\nexport const Foo = defineModel('custom.foo', { fields: { name: fields.string() } });`,
    'packages/mcp-moonwitness/src/models.ts'
  );
  assert.equal(modelViolations.length, 1);
  assert.match(modelViolations[0], /defineModel is forbidden/u);

  const addonViolations = findAgentBoundaryViolations(
    `import { defineAddon } from '@moonwitness/orm';\nexport const addon = defineAddon({ name: 'custom', version: '1.0.0', models: [] });`,
    'plugins/moonwitness/skills/mw-addon-dev/helper.ts'
  );
  assert.equal(addonViolations.length, 1);
  assert.match(addonViolations[0], /defineAddon is forbidden/u);
});

test('blocks INSERT, UPDATE SET, and DELETE FROM statements in TS sources', () => {
  const insertViolations = findAgentBoundaryViolations(
    "const sql = 'INSERT INTO users (name) VALUES ($1)';",
    'packages/mcp-moonwitness/src/writer.ts'
  );
  assert.equal(insertViolations.length, 1);
  assert.match(insertViolations[0], /Database write SQL is forbidden/u);

  const updateViolations = findAgentBoundaryViolations(
    'const q = `UPDATE tasks SET status = ${status}`;',
    'packages/mcp-moonwitness/src/updater.ts'
  );
  assert.equal(updateViolations.length, 1);
  assert.match(updateViolations[0], /Database write SQL is forbidden/u);

  const deleteViolations = findAgentBoundaryViolations(
    'const purge = `DELETE FROM audit_log WHERE id = ${id}`;',
    'plugins/moonwitness/skills/mw-taskos/purge.ts'
  );
  assert.equal(deleteViolations.length, 1);
  assert.match(deleteViolations[0], /Database write SQL is forbidden/u);
});

test('allows read-only SELECT queries and plain prose without write SQL', () => {
  const selectOnly = findAgentBoundaryViolations(
    "const query = 'SELECT id, name FROM users WHERE id = $1';",
    'packages/mcp-moonwitness/src/query.ts'
  );
  assert.deepEqual(selectOnly, []);

  const prose = findAgentBoundaryViolations(
    'The mw_query tool never mutates rows; it runs SELECT statements only.',
    'plugins/moonwitness/skills/mw-boundaries/SKILL.md'
  );
  assert.deepEqual(prose, []);
});

test('UPDATE without SET is not flagged as write SQL', () => {
  const noFalsePositive = findAgentBoundaryViolations(
    "const doc = 'UPDATE the registry documentation before release';",
    'plugins/moonwitness/rules/never-define-models-outside-packages.md'
  );
  assert.deepEqual(noFalsePositive, []);
});
