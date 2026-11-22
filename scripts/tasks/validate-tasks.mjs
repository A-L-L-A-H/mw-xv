import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

export function parseTasksRegistry(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      'TaskOS registry docs/tasks/tasks.json is empty. Recovery mode is active; do not run sync or rebuild from counts. Restore from provenance-verified sources.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`TaskOS registry docs/tasks/tasks.json is invalid JSON: ${error.message}`);
  }
}

export function toRoadmapTaskStatus(status) {
  const statusMap = {
    done: 'complete',
    doing: 'in_progress',
    review: 'in_progress',
    blocked: 'blocked',
    backlog: 'todo',
    todo: 'todo',
  };
  return statusMap[status] ?? null;
}

export async function validateTaskRegistryData(tasksData) {
  const errors = [];
  const schemaFilePath = path.join(rootDir, 'docs/tasks/tasks.schema.json');
  const roadmapTasksPath = path.join(rootDir, 'docs/roadmap/tasks.json');
  const roadmapMdPath = path.join(rootDir, 'ROADMAP.md');

  // 1. Validate the complete candidate before any registry write.
  const schemaRaw = await fs.readFile(schemaFilePath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const isValid = validate(tasksData);
  if (!isValid) {
    for (const err of validate.errors ?? []) {
      errors.push(`Schema Error at ${err.instancePath}: ${err.message}`);
    }
    return { valid: false, taskCount: tasksData?.tasks?.length ?? 0, errors };
  }

  // 2. Project slugs, task codes and project ownership are unique and resolvable.
  const projectSlugs = new Set();
  for (const project of tasksData.projects) {
    if (projectSlugs.has(project.slug)) {
      errors.push(`Duplicate project slug: "${project.slug}"`);
    }
    projectSlugs.add(project.slug);
  }

  const taskMap = new Map();
  for (const task of tasksData.tasks) {
    if (taskMap.has(task.code)) {
      errors.push(`Duplicate task code: "${task.code}"`);
    }
    taskMap.set(task.code, task);
    if (!projectSlugs.has(task.project)) {
      errors.push(`Task "${task.code}" references unknown project "${task.project}".`);
    }
  }

  // 3. Require known, unique and reciprocal dependency/block relationships.
  for (const task of tasksData.tasks) {
    const dependencies = task.dependsOn ?? [];
    const blockedTasks = task.blocks ?? [];
    if (new Set(dependencies).size !== dependencies.length) {
      errors.push(`Task "${task.code}" contains duplicate dependency references.`);
    }
    if (new Set(blockedTasks).size !== blockedTasks.length) {
      errors.push(`Task "${task.code}" contains duplicate blocked-task references.`);
    }
    for (const dependency of dependencies) {
      const dependencyTask = taskMap.get(dependency);
      if (!dependencyTask) {
        errors.push(`Task "${task.code}" references unknown dependency "${dependency}".`);
      } else if (!(dependencyTask.blocks ?? []).includes(task.code)) {
        errors.push(`Dependency edge "${task.code}" -> "${dependency}" is missing its reciprocal blocks reference.`);
      }
    }
    for (const blockedTask of blockedTasks) {
      const target = taskMap.get(blockedTask);
      if (!target) {
        errors.push(`Task "${task.code}" references unknown blocked task "${blockedTask}".`);
      } else if (!(target.dependsOn ?? []).includes(task.code)) {
        errors.push(`Blocks edge "${task.code}" -> "${blockedTask}" has no reciprocal dependency reference.`);
      }
    }
  }

  // 4. Every task must point to an existing repository-local provenance source.
  const sourceFiles = new Set(tasksData.tasks.map((task) => task.sourceRef.file));
  for (const sourceFile of sourceFiles) {
    if (
      path.isAbsolute(sourceFile) ||
      sourceFile.split(/[\\/]+/u).includes('..') ||
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(sourceFile)
    ) {
      errors.push(`Task source reference must be a repository-relative path: "${sourceFile}".`);
      continue;
    }
    try {
      await fs.access(path.resolve(rootDir, sourceFile));
    } catch {
      errors.push(`Task source reference does not exist: "${sourceFile}".`);
    }
  }

  // 5. Validate the dependency DAG.
  const visiting = new Set();
  const visited = new Set();
  function checkCycle(code) {
    if (visiting.has(code)) {
      errors.push(`Dependency cycle detected involving task "${code}"`);
      return;
    }
    if (visited.has(code)) return;
    visiting.add(code);
    const task = taskMap.get(code);
    for (const dependency of task?.dependsOn ?? []) {
      if (taskMap.has(dependency)) checkCycle(dependency);
    }
    visiting.delete(code);
    visited.add(code);
  }
  for (const code of taskMap.keys()) checkCycle(code);

  // 6. Exact lifecycle parity with roadmap index plus completion checkbox mirror.
  try {
    const roadmapTasksRaw = await fs.readFile(roadmapTasksPath, 'utf8');
    const roadmapData = JSON.parse(roadmapTasksRaw);
    if (!Array.isArray(roadmapData.tasks)) {
      throw new Error('docs/roadmap/tasks.json must contain a tasks array.');
    }
    const roadmapById = new Map();
    for (const roadmapTask of roadmapData.tasks) {
      if (roadmapById.has(roadmapTask.id)) {
        errors.push(`Duplicate roadmap task ID "${roadmapTask.id}".`);
      }
      roadmapById.set(roadmapTask.id, roadmapTask);
    }

    const roadmapText = await fs.readFile(roadmapMdPath, 'utf8');
    const roadmapCheckState = new Map();
    for (const line of roadmapText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+([A-Za-z0-9_.-]+)\b/.exec(line);
      if (match) {
        if (roadmapCheckState.has(match[2])) {
          errors.push(`Duplicate ROADMAP.md checkbox ID "${match[2]}".`);
        }
        roadmapCheckState.set(match[2], match[1].toLowerCase() === 'x');
      }
    }

    for (const roadmapId of roadmapById.keys()) {
      if (!roadmapCheckState.has(roadmapId)) {
        errors.push(`Roadmap task "${roadmapId}" is missing its ROADMAP.md checkbox entry.`);
      }
    }
    for (const checkboxId of roadmapCheckState.keys()) {
      if (!roadmapById.has(checkboxId)) {
        errors.push(`ROADMAP.md contains task "${checkboxId}" that is missing from docs/roadmap/tasks.json.`);
      }
    }

    for (const roadmapTask of roadmapData.tasks) {
      const canonical = taskMap.get(roadmapTask.id);
      if (!canonical) {
        errors.push(`Roadmap task "${roadmapTask.id}" is missing from canonical TaskOS.`);
        continue;
      }
      const expectedStatus = toRoadmapTaskStatus(canonical.status);
      if (expectedStatus === null) {
        errors.push(`Task "${canonical.code}" has status "${canonical.status}" with no roadmap projection mapping.`);
      } else if (roadmapTask.status !== expectedStatus) {
        errors.push(
          `Status mismatch on "${roadmapTask.id}": roadmap index is "${roadmapTask.status}", but TaskOS maps to "${expectedStatus}".`
        );
      }

      const isRoadmapDone = roadmapCheckState.get(roadmapTask.id) ?? false;
      const isCanonicalDone = canonical.status === 'done';
      if (isRoadmapDone !== isCanonicalDone) {
        errors.push(
          `Checkbox mismatch on "${roadmapTask.id}": ROADMAP.md is ${isRoadmapDone ? '[x]' : '[ ]'}, but TaskOS status is "${canonical.status}".`
        );
      }
    }

    for (const canonical of tasksData.tasks) {
      if (/^(?:M\d+\.\d+|K\d+-\d+)$/u.test(canonical.code) && !roadmapById.has(canonical.code)) {
        errors.push(`TaskOS roadmap task "${canonical.code}" is missing from docs/roadmap/tasks.json.`);
      }
    }
  } catch (err) {
    errors.push(`Failed reading roadmap files for parity check: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    taskCount: tasksData.tasks.length,
    errors
  };
}

export async function validateTasks() {
  const tasksFilePath = path.join(rootDir, 'docs/tasks/tasks.json');
  let tasksData;
  try {
    const tasksRaw = await fs.readFile(tasksFilePath, 'utf8');
    tasksData = parseTasksRegistry(tasksRaw);
  } catch (error) {
    return { valid: false, taskCount: 0, errors: [error.message] };
  }
  return validateTaskRegistryData(tasksData);
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
