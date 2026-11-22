import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepAndConsolidate } from './sweep-and-consolidate.mjs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

test('sweepAndConsolidate aggregates all sources and produces schema-valid tasks.json', async () => {
  const result = await sweepAndConsolidate();
  assert.ok(result);
  assert.equal(result.schemaVersion, '2.0.0');
  assert.equal(result.format, 'moonwitness-tasks/v2');
  assert.ok(Array.isArray(result.projects));
  assert.ok(Array.isArray(result.tasks));

  // Should have at least 227 roadmap tasks + WhatsApp + Audit + Evolution tasks
  assert.ok(result.tasks.length >= 300, `Expected >= 300 tasks, got ${result.tasks.length}`);

  // Check specific task codes
  const taskByCode = new Map(result.tasks.map((t) => [t.code, t]));
  assert.ok(taskByCode.has('M0.01'), 'Must include M0.01');
  assert.ok(taskByCode.has('K0-001'), 'Must include K0-001');
  assert.ok(taskByCode.has('AUD-001'), 'Must include AUD-001');
  assert.ok(taskByCode.has('WA-P0-01'), 'Must include WA-P0-01');
  assert.ok(taskByCode.has('EVO-002'), 'Must include EVO-002');
  assert.ok(taskByCode.has('DSK-0.12'), 'Must include DSK-0.12');
  assert.ok(taskByCode.has('MW-CFG-003.3'), 'Must include MW-CFG-003.3');

  // Verify status mapping: M0.01 is complete in ROADMAP.md, so it must be 'done'
  assert.equal(taskByCode.get('M0.01').status, 'done');

  // Validate against docs/tasks/tasks.schema.json
  const schemaRaw = await fs.readFile('docs/tasks/tasks.schema.json', 'utf8');
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(result);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});
