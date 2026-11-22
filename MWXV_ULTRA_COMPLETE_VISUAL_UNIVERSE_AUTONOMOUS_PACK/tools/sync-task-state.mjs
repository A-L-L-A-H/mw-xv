import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTasksRegistry, validateTaskRegistryData } from '../../scripts/tasks/validate-tasks.mjs';
import { projectVisualUniverseTask } from '../../scripts/tasks/visual-universe-projection.mjs';
import {
  renderVisualUniverseBoard,
  renderVisualUniverseTaskCard,
  validateVisualUniverseTaskGraph,
} from '../../scripts/tasks/visual-universe-renderers.mjs';

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packRoot, '..');
const planPath = path.join(packRoot, 'task.json');
const manifestPath = path.join(packRoot, 'pack-manifest.json');
const boardPath = path.join(packRoot, 'TASKS.md');
const registryPath = path.join(repositoryRoot, 'docs/tasks/tasks.json');
const packManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const registry = parseTasksRegistry(await readFile(registryPath, 'utf8'));
assert.ok(Array.isArray(registry.tasks), 'Canonical TaskOS registry must contain a tasks array.');
const registryValidation = await validateTaskRegistryData(registry);
assert.equal(
  registryValidation.valid,
  true,
  `Canonical TaskOS registry failed validation:\n${registryValidation.errors.join('\n')}`
);
const visualUniverseRecords = registry.tasks.filter((task) => task.project === 'visual-universe');
assert.ok(
  visualUniverseRecords.length > 0,
  'Canonical TaskOS registry has no Visual Universe records; do not use the pack-local task snapshot as a fallback.'
);
const plan = {
  ...packManifest,
  tasks: visualUniverseRecords.map(projectVisualUniverseTask),
  task_count: visualUniverseRecords.length,
};
const taskFiles = new Map();

async function readText(filePath) {
  return (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n');
}

const checkOnly = process.argv.includes('--check');
for (const task of plan.tasks) {
  if (typeof task.deliverables === 'string') task.deliverables = [task.deliverables];
  assert.ok(Array.isArray(task.deliverables), `${task.id} deliverables must be an array`);
  assert.ok(Array.isArray(task.acceptance_criteria), `${task.id} acceptance_criteria must be an array`);
  assert.ok(Array.isArray(task.acceptance_criteria_state), `${task.id} acceptance_criteria_state must be an array`);
  assert.equal(
    task.acceptance_criteria_state.length,
    task.acceptance_criteria.length,
    `${task.id} acceptance criterion text/state lengths must match`
  );
  const phaseDirectory = path.join(packRoot, 'tasks', task.phase);
  const taskPath = path.join(phaseDirectory, `${task.id}.md`);
  taskFiles.set(taskPath, renderVisualUniverseTaskCard(task));
}
validateVisualUniverseTaskGraph(plan.tasks);
const normalizedPlan = `${JSON.stringify(plan, null, 2)}\n`;
const normalizedBoard = renderVisualUniverseBoard(plan.tasks);

if (checkOnly) {
  assert.equal(await readText(planPath), normalizedPlan, 'task.json is not normalized');
  assert.equal(await readText(boardPath), normalizedBoard, 'TASKS.md is stale');
  for (const [taskPath, content] of taskFiles) assert.equal(await readText(taskPath), content, `${path.basename(taskPath)} is stale`);
  console.log(`Validated ${plan.tasks.length} task records, dependencies, task documents, and TASKS.md.`);
} else {
  await writeFile(planPath, normalizedPlan);
  await writeFile(boardPath, normalizedBoard);
  for (const [taskPath, content] of taskFiles) {
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(taskPath, content);
  }
  console.log(`Synchronized ${plan.tasks.length} task records, individual task documents, and TASKS.md.`);
}
