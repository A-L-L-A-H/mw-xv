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
  const deliverables = !Object.hasOwn(task, 'proposedSolution')
    ? originalDeliverables
    : task.proposedSolution === originalDeliverables.join('; ')
      ? originalDeliverables
      : typeof task.proposedSolution === 'string' && task.proposedSolution.trim()
        ? [task.proposedSolution]
        : [];
  const originalEvidence = Array.isArray(source.evidence) ? source.evidence : [];
  const originalEvidenceByPath = new Map(
    originalEvidence
      .filter((entry) => typeof entry?.artifact === 'string')
      .map((entry) => [entry.artifact, entry])
  );
  const canonicalEvidencePaths = task.evidence?.paths ?? originalEvidence.map((entry) => entry.artifact);
  const evidence = canonicalEvidencePaths.map((artifact) => {
    const existing = originalEvidenceByPath.get(artifact);
    return existing ?? {
      artifact,
      command: 'Evidence path recorded in canonical TaskOS; execution metadata not recorded.',
      exit_code: null,
    };
  });

  return {
    ...source,
    id: task.code,
    phase: task.series,
    title: task.title,
    status,
    priority: task.priority.toUpperCase(),
    role: task.owner ?? null,
    depends_on: [...(task.dependsOn ?? [])],
    objective: task.problem ?? task.summary ?? '',
    scope_hints: [...(task.scope?.files ?? [])],
    deliverables,
    acceptance_criteria: (task.acceptanceCriteria ?? []).map((criterion) => criterion.text),
    verification: [...(task.validation?.commands ?? [])],
    evidence,
    risk: task.risk ?? null,
    human_approval_required: task.human === true,
    notes: task.blockedReason ?? '',
    commit: task.evidence?.commitSha ?? null,
  };
}
