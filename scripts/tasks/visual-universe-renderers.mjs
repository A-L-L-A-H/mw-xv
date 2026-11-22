import assert from 'node:assert/strict';

const allowedStatuses = new Set(['todo', 'in_progress', 'blocked', 'done', 'skipped']);

function statusLabel(task) {
  if (task.status === 'skipped') return 'SKIPPED';
  if (task.status === 'blocked') return 'BLOCKED';
  if (task.status === 'in_progress') return 'IN PROGRESS';
  return task.status.toUpperCase();
}

export function validateVisualUniverseTaskGraph(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  assert.equal(byId.size, tasks.length, 'Task IDs must be unique');
  const remaining = new Map();
  const dependents = new Map();

  for (const task of tasks) {
    assert.ok(typeof task.id === 'string' && task.id.trim(), 'Task ID is required');
    assert.ok(allowedStatuses.has(task.status), `${task.id} has unsupported status "${task.status}"`);
    assert.ok(Array.isArray(task.depends_on), `${task.id} depends_on must be an array`);
    assert.ok(Array.isArray(task.deliverables), `${task.id} deliverables must be an array`);
    assert.ok(Array.isArray(task.acceptance_criteria), `${task.id} acceptance_criteria must be an array`);
    assert.ok(Array.isArray(task.acceptance_criteria_state), `${task.id} acceptance_criteria_state must be an array`);
    assert.equal(
      task.acceptance_criteria_state.length,
      task.acceptance_criteria.length,
      `${task.id} acceptance criterion text/state lengths must match`
    );

    const criterionIds = new Set();
    for (let i = 0; i < task.acceptance_criteria_state.length; i += 1) {
      const criterion = task.acceptance_criteria_state[i];
      assert.ok(typeof criterion.id === 'string' && criterion.id.trim(), `${task.id} acceptance criterion ID is required`);
      assert.ok(!criterionIds.has(criterion.id), `${task.id} has duplicate acceptance criterion "${criterion.id}"`);
      criterionIds.add(criterion.id);
      assert.equal(criterion.text, task.acceptance_criteria[i], `${task.id} acceptance criterion text projection drift`);
      assert.equal(typeof criterion.done, 'boolean', `${task.id} acceptance criterion done state must be boolean`);
    }

    assert.equal(
      new Set(task.depends_on).size,
      task.depends_on.length,
      `${task.id} contains duplicate dependency references`
    );
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
}

export function renderVisualUniverseBoard(tasks) {
  const phases = [...new Set(tasks.map((task) => task.phase))];
  const counts = new Map();
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  const lines = [
    '# Atomic Task Board',
    '',
    `**Total: ${tasks.length} tasks.** Canonical lifecycle state is ` + '`docs/tasks/tasks.json`' + ` + ` (project ` + '`visual-universe`' + `); this file is generated from it.`,
    '',
    `Status counts: ${['done', 'skipped', 'in_progress', 'blocked', 'todo'].map((status) => `${status} ${counts.get(status) ?? 0}`).join(' · ')}.`,
    '',
  ];
  for (const phase of phases) {
    lines.push(`## ${phase}`, '');
    for (const task of tasks.filter((entry) => entry.phase === phase)) {
      const box = task.status === 'done' || task.status === 'skipped' ? 'x' : ' ';
      const detail = task.status === 'blocked' || task.status === 'skipped'
        ? ` — **${statusLabel(task)}:** ${task.notes || 'See task evidence.'}`
        : task.status === 'in_progress' ? ' — **IN PROGRESS**' : '';
      lines.push(`- [${box}] **${task.id} — ${task.title}**${detail}`);
      lines.push(`  - Goal: ${task.objective}`);
      lines.push(`  - Depends on: ${task.depends_on.length ? task.depends_on.join(', ') : 'none'}`);
      lines.push(`  - Deliverables: ${task.deliverables.join('; ')}`);
      const criteriaProgress = `${task.acceptance_criteria_state.filter((criterion) => criterion.done).length}/${task.acceptance_criteria_state.length}`;
      lines.push(`  - Acceptance (${criteriaProgress} complete): ${task.acceptance_criteria_state.map((criterion) => `[${criterion.done ? 'x' : ' '}] ${criterion.text}`).join('; ')}`);
      lines.push(`  - Verify: ${task.verification.join('; ')}`);
      if (task.evidence.length) {
        lines.push(`  - Evidence: ${task.evidence.map((entry) => `\`${entry.command}\` (${entry.exit_code ?? 'not recorded'}) → \`${entry.artifact}\``).join('; ')}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\\n').trimEnd()}\\n`;
}

export function renderVisualUniverseTaskCard(task) {
  const notes = task.notes ?? '';
  const legacyNote = task.legacyCardNotes;
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
    ...task.acceptance_criteria_state.map((criterion) => `- [${criterion.done ? 'x' : ' '}] ${criterion.text}`),
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
    for (const evidence of task.evidence) {
      lines.push(`  - \`${evidence.command}\` — exit ${evidence.exit_code ?? 'not recorded'}`);
    }
    lines.push('- Evidence paths:');
    for (const evidencePath of [...new Set(task.evidence.map((entry) => entry.artifact))]) {
      lines.push(`  - \`${evidencePath}\``);
    }
    lines.push(`- Commit SHA: ${task.commit ?? 'pending commit'}`);
    lines.push(`- Reviewer decision: ${task.status === 'skipped' ? `Existing capability verified; ${task.notes}` : 'Acceptance evidence recorded.'}`);
    lines.push(`- Residual issues: ${task.notes || 'None recorded.'}`);
  } else {
    lines.push('- Commands / exit codes:');
    lines.push('- Evidence paths:');
    lines.push(`- Commit SHA: ${task.commit ?? 'pending'}`);
    lines.push('- Reviewer decision:');
    lines.push(`- Residual issues:${task.notes ? ` ${task.notes}` : ''}`);
  }

  if (legacyNote?.text) {
    lines.push(
      '',
      '## Archived task-card note (historical context; not lifecycle state)',
      '',
      legacyNote.text,
      '',
      `- Source: \`${legacyNote.sourceFile}\``,
      `- Git blob SHA: \`${legacyNote.sourceBlobSha}\``,
    );
  }
  lines.push('', '## Notes', '', notes, '');
  return lines.join('\\n');
}
