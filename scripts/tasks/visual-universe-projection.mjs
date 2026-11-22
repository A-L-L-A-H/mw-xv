const packStatusByTaskOsStatus = {
  backlog: 'todo',
  todo: 'todo',
  doing: 'in_progress',
  review: 'in_progress',
  blocked: 'blocked',
  done: 'done',
};

export function projectVisualUniverseTask(task) {
  if (!task || typeof task.code !== 'string' || !task.code.trim()) {
    throw new Error('Visual Universe TaskOS record is missing its stable code.');
  }
  if (task.project !== 'visual-universe') {
    throw new Error(`Task "${task.code}" does not belong to the visual-universe project.`);
  }
  const source = task.metadata;
  if (!source || typeof source !== 'object' || source.id !== task.code) {
    throw new Error(`Task "${task.code}" has no lossless Visual Universe metadata payload.`);
  }

  let status;
  if (task.status === 'done' && task.tags?.includes('status:skipped')) {
    status = 'skipped';
  } else if (task.status === 'doing') {
    status = 'in_progress';
  } else {
    status = packStatusByTaskOsStatus[task.status];
  }
  if (!status) {
    throw new Error(`Task "${task.code}" has unsupported TaskOS status "${task.status}".`);
  }

  const originalDeliverables = Array.isArray(source.deliverables) ? source.deliverables : [];
  const deliverables = task.proposedSolution
    && task.proposedSolution !== originalDeliverables.join('; ')
    ? [task.proposedSolution]
    : originalDeliverables;

  return {
    ...source,
    id: task.code,
    phase: task.series,
    title: task.title,
    status,
    priority: task.priority.toUpperCase(),
    role: task.owner ?? source.role ?? null,
    depends_on: [...(task.dependsOn ?? [])],
    objective: task.problem || task.summary || source.objective,
    scope_hints: [...(task.scope?.files ?? source.scope_hints ?? [])],
    deliverables,
    acceptance_criteria: (task.acceptanceCriteria ?? []).map((criterion) => criterion.text),
    verification: [...(task.validation?.commands ?? [])],
    risk: task.risk ?? source.risk ?? 'medium',
    human_approval_required: task.human === true,
    notes: task.blockedReason ?? source.notes ?? '',
    commit: task.evidence?.commitSha ?? source.commit ?? null,
  };
}
