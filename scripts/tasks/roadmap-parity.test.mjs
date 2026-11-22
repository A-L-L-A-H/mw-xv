import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTasks } from './validate-tasks.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('validateTasks reports zero errors on canonical docs/tasks/tasks.json and matches ROADMAP.md parity', async () => {
  const result = await validateTasks();
  assert.equal(result.valid, true, `Validation failed with errors: ${result.errors.join('; ')}`);
  assert.equal(result.errors.length, 0);

  // Parity assertions
  const roadmapRaw = await fs.readFile(path.join(rootDir, 'docs/roadmap/tasks.json'), 'utf8');
  const roadmapTasks = JSON.parse(roadmapRaw).tasks;
  const canonicalRaw = await fs.readFile(path.join(rootDir, 'docs/tasks/tasks.json'), 'utf8');
  const canonicalTasks = JSON.parse(canonicalRaw).tasks;

  const canonicalMap = new Map(canonicalTasks.map((t) => [t.code, t]));

  for (const rt of roadmapTasks) {
    const ct = canonicalMap.get(rt.id);
    assert.ok(ct, `Task ${rt.id} must be present in canonical tasks.json`);
    assert.equal(ct.series, rt.id.startsWith('M') ? 'M' : 'K');
  }
});
