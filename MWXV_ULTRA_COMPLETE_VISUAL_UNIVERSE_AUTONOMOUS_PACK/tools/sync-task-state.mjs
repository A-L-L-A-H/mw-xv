import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTasksRegistry } from '../../scripts/tasks/validate-tasks.mjs';
import { projectVisualUniverseTask } from '../../scripts/tasks/visual-universe-projection.mjs';

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packRoot, '..');
const planPath = path.join(packRoot, 'task.json');
const boardPath = path.join(packRoot, 'TASKS.md');
const registryPath = path.join(repositoryRoot, 'docs/tasks/tasks.json');
const planTemplate = JSON.parse(await readFile(planPath, 'utf8'));
const registry = parseTasksRegistry(await readFile(registryPath, 'utf8'));
assert.ok(Array.isArray(registry.tasks), 'Canonical TaskOS registry must contain a tasks array.');
const visualUniverseRecords = registry.tasks.filter((task) => task.project === 'visual-universe');
assert.equal(
  visualUniverseRecords.length,
  planTemplate.task_count,
  'Canonical TaskOS registry must contain every Visual Universe task before projecting the work package.'
);
const plan = {
  ...planTemplate,
  tasks: visualUniverseRecords.map(projectVisualUniverseTask),
  task_count: visualUniverseRecords.length,
};
const taskFiles = new Map();

async function readText(filePath) {
  return (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n');
}

function validateGraph(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  assert.equal(byId.size, tasks.length, 'Task IDs must be unique');
  const remaining = new Map();
  const dependents = new Map();
  for (const task of tasks) {
    remaining.set(task.id, task.depends_on.length);
    for (const dependency of task.depends_on) {
      assert.ok(byId.has(dependency), `${task.id} references unknown dependency ${dependency}`);
      const list = dependents.get(dependency) ?? [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    visited += 1;
    for (const child of dependents.get(id) ?? []) {
      const count = remaining.get(child) - 1;
      remaining.set(child, count);
      if (count === 0) ready.push(child);
    }
  }
  assert.equal(visited, tasks.length, 'Task dependencies must be acyclic');
  for (const task of tasks) {
    assert.ok(['todo', 'in_progress', 'blocked', 'done', 'skipped'].includes(task.status));
    assert.ok(Array.isArray(task.deliverables), `${task.id} deliverables must be an array`);
  }
}

function statusLabel(task) {
  if (task.status === 'skipped') return 'SKIPPED';
  if (task.status === 'blocked') return 'BLOCKED';
  if (task.status === 'in_progress') return 'IN PROGRESS';
  return task.status.toUpperCase();
}

function renderBoard(tasks) {
  const phases = [...new Set(tasks.map((task) => task.phase))];
  const counts = new Map();
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  const lines = [
    '# Atomic Task Board',
    '',
    `**Total: ${tasks.length} tasks.** Canonical lifecycle state is \`docs/tasks/tasks.json\` (project \`visual-universe\`); this file is generated from it.`,
    '',
    `Status counts: ${['done', 'skipped', 'in_progress', 'blocked', 'todo'].map((status) => `${status} ${counts.get(status) ?? 0}`).join(' · ')}.`,
    '',
  ];
  for (const phase of phases) {
    lines.push(`## ${phase}`,'');
    for (const task of tasks.filter((entry) => entry.phase === phase)) {
      const box = task.status === 'done' || task.status === 'skipped' ? 'x' : ' ';
      const detail = task.status === 'blocked' || task.status === 'skipped'
        ? ` — **${statusLabel(task)}:** ${task.notes || 'See task evidence.'}`
        : task.status === 'in_progress' ? ' — **IN PROGRESS**' : '';
      lines.push(`- [${box}] **${task.id} — ${task.title}**${detail}`);
      lines.push(`  - Goal: ${task.objective}`);
      lines.push(`  - Depends on: ${task.depends_on.length ? task.depends_on.join(', ') : 'none'}`);
      lines.push(`  - Deliverables: ${task.deliverables.join('; ')}`);
      lines.push(`  - Acceptance: ${task.acceptance_criteria.join('; ')}`);
      lines.push(`  - Verify: ${task.verification.join('; ')}`);
      if (task.evidence.length) {
        lines.push(`  - Evidence: ${task.evidence.map((entry) => `\`${entry.command}\` (${entry.exit_code ?? 'not recorded'}) → \`${entry.artifact}\``).join('; ')}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderTask(task, original) {
  const notes = original.match(/## Notes\n([\s\S]*)$/)?.[1]?.trim() ?? '';
  const lines = [
    `# ${task.id} — ${task.title}`,
    '',
    `- Phase: ${task.phase}`,
    `- Status: \`${task.status}\``,
    `- Priority: ${task.priority ?? 'unset'}`,
    `- Role: ${task.role ?? 'unset'}`,
    `- Dependencies: ${task.depends_on.length ? task.depends_on.join(', ') : 'none'}`,
    `- Parallel group: ${task.parallel_group ?? 'unset'}`,
    `- Risk: ${task.risk ?? 'unset'}`,
    `- Human approval required: ${task.human_approval_required ?? false}`,
    '',
    '## Objective',
    '',
    task.objective,
    '',
    '## Scope hints',
    '',
    ...(task.scope_hints.length ? task.scope_hints.map((hint) => `- \`${hint}\``) : ['- None specified.']),
    '',
    '## Deliverables',
    '',
    ...task.deliverables.map((deliverable) => `- ${deliverable}`),
    '',
    '## Acceptance criteria',
    '',
    ...task.acceptance_criteria.map((criterion) => `- [${task.status === 'done' || task.status === 'skipped' ? 'x' : ' '}] ${criterion}`),
    '',
    '## Verification',
    '',
    ...task.verification.map((command) => `- \`${command}\``),
    '',
    '## Completion record',
    '',
  ];
  if (task.status === 'done' || task.status === 'skipped') {
    lines.push('- Commands / exit codes:');
    for (const evidence of task.evidence) lines.push(`  - \`${evidence.command}\` — exit ${evidence.exit_code ?? 'not recorded'}`);
    lines.push('- Evidence paths:');
    for (const evidencePath of [...new Set(task.evidence.map((entry) => entry.artifact))]) lines.push(`  - \`${evidencePath}\``);
    lines.push(`- Commit SHA: ${task.commit ?? 'pending commit'}`);
    lines.push(`- Reviewer decision: ${task.status === 'skipped' ? `Existing capability verified; ${task.notes}` : 'Acceptance evidence recorded.'}`);
    lines.push(`- Residual issues: ${task.notes || 'None recorded.'}`);
  } else {
    lines.push('- Commands / exit codes:');
    lines.push('- Evidence paths:');
    lines.push(`- Commit SHA: ${task.commit ?? 'pending'}`);
    lines.push('- Reviewer decision:');
    const residual = task.status === 'blocked' ? task.notes : '';
    lines.push(`- Residual issues:${residual ? ` ${residual}` : ''}`);
  }
  lines.push('', '## Notes', '', notes, '');
  return lines.join('\n');
}

const checkOnly = process.argv.includes('--check');
for (const task of plan.tasks) {
  if (typeof task.deliverables === 'string') task.deliverables = [task.deliverables];
  assert.ok(Array.isArray(task.deliverables), `${task.id} deliverables must be an array`);
  const phaseDirectory = path.join(packRoot, 'tasks', task.phase);
  const taskPath = path.join(phaseDirectory, `${task.id}.md`);
  const original = await readText(taskPath);
  taskFiles.set(taskPath, renderTask(task, original));
}
validateGraph(plan.tasks);
const normalizedPlan = `${JSON.stringify(plan, null, 2)}\n`;
const normalizedBoard = renderBoard(plan.tasks);

if (checkOnly) {
  assert.equal(await readText(planPath), normalizedPlan, 'task.json is not normalized');
  assert.equal(await readText(boardPath), normalizedBoard, 'TASKS.md is stale');
  for (const [taskPath, content] of taskFiles) assert.equal(await readText(taskPath), content, `${path.basename(taskPath)} is stale`);
  console.log(`Validated ${plan.tasks.length} task records, dependencies, task documents, and TASKS.md.`);
} else {
  await writeFile(planPath, normalizedPlan);
  await writeFile(boardPath, normalizedBoard);
  for (const [taskPath, content] of taskFiles) await writeFile(taskPath, content);
  console.log(`Synchronized ${plan.tasks.length} task records, individual task documents, and TASKS.md.`);
}
