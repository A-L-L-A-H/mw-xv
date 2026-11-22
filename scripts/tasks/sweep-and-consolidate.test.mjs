import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepAndConsolidate } from './sweep-and-consolidate.mjs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

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

  // Source inventory: 239 roadmap + 14 audit + 112 WhatsApp + 7 legacy MW
  // + 14 promotion lifecycle + 128 desktop + 4 evolution + 109 Visual Universe records.
  assert.equal(result.tasks.length, 627, `Expected 627 source-backed tasks, got ${result.tasks.length}`);

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

  // Validate against docs/tasks/tasks.schema.json
  const schemaRaw = await fs.readFile('docs/tasks/tasks.schema.json', 'utf8');
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(result);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});
