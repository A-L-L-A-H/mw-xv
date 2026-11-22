import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

export async function validateTasks() {
  const errors = [];
  const tasksFilePath = path.join(rootDir, 'docs/tasks/tasks.json');
  const schemaFilePath = path.join(rootDir, 'docs/tasks/tasks.schema.json');
  const roadmapTasksPath = path.join(rootDir, 'docs/roadmap/tasks.json');
  const roadmapMdPath = path.join(rootDir, 'ROADMAP.md');

  // 1. JSON Schema validation
  const schemaRaw = await fs.readFile(schemaFilePath, 'utf8');
  const tasksRaw = await fs.readFile(tasksFilePath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const tasksData = JSON.parse(tasksRaw);

  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const isValid = validate(tasksData);

  if (!isValid) {
    for (const err of validate.errors ?? []) {
      errors.push(`Schema Error at ${err.instancePath}: ${err.message}`);
    }
  }

  // 2. Uniqueness of task codes
  const codeSet = new Set();
  const taskMap = new Map();
  for (const t of tasksData.tasks ?? []) {
    if (codeSet.has(t.code)) {
      errors.push(`Duplicate task code: "${t.code}"`);
    }
    codeSet.add(t.code);
    taskMap.set(t.code, t);
  }

  // 3. Cycle-free DAG validation on dependsOn
  const visiting = new Set();
  const visited = new Set();
  function checkCycle(code) {
    if (visiting.has(code)) {
      errors.push(`Dependency cycle detected involving task "${code}"`);
      return;
    }
    if (visited.has(code)) return;
    visiting.add(code);
    const deps = taskMap.get(code)?.dependsOn ?? [];
    for (const dep of deps) {
      if (taskMap.has(dep)) {
        checkCycle(dep);
      }
    }
    visiting.delete(code);
    visited.add(code);
  }
  for (const code of taskMap.keys()) {
    checkCycle(code);
  }

  // 4. Parity with ROADMAP.md and docs/roadmap/tasks.json
  try {
    const roadmapTasksRaw = await fs.readFile(roadmapTasksPath, 'utf8');
    const roadmapTasks = JSON.parse(roadmapTasksRaw).tasks;
    const roadmapText = await fs.readFile(roadmapMdPath, 'utf8');

    const roadmapCheckState = new Map();
    for (const line of roadmapText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+([A-Za-z0-9_.-]+)\b/.exec(line);
      if (match) {
        roadmapCheckState.set(match[2], match[1].toLowerCase() === 'x');
      }
    }

    for (const rt of roadmapTasks) {
      const canonical = taskMap.get(rt.id);
      if (!canonical) {
        errors.push(`Roadmap task "${rt.id}" is missing from canonical docs/tasks/tasks.json`);
        continue;
      }
      const isRoadmapDone = roadmapCheckState.get(rt.id) ?? false;
      const isCanonicalDone = canonical.status === 'done';
      if (isRoadmapDone !== isCanonicalDone) {
        errors.push(
          `Status mismatch on "${rt.id}": ROADMAP.md is ${isRoadmapDone ? '[x]' : '[ ]'}, but tasks.json status is "${canonical.status}"`
        );
      }
    }
  } catch (err) {
    errors.push(`Failed reading roadmap files for parity check: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    taskCount: tasksData.tasks?.length ?? 0,
    errors
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateTasks().then((res) => {
    if (res.valid) {
      console.log(`TaskOS Validation PASSED: ${res.taskCount} tasks verified zero-drift and schema-valid.`);
      process.exit(0);
    } else {
      console.error(`TaskOS Validation FAILED with ${res.errors.length} error(s):`);
      for (const err of res.errors) console.error(` - ${err}`);
      process.exit(1);
    }
  }).catch((err) => {
    console.error('TaskOS validation execution error:', err);
    process.exit(1);
  });
}
