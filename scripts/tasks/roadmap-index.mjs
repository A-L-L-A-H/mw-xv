import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const CANONICAL_TASKS_RELATIVE_PATH = 'docs/tasks/tasks.json';
export const LEGACY_ROADMAP_TASKS_RELATIVE_PATH = 'docs/roadmap/tasks.json';
export const ROADMAP_CODE_PATTERN = /^(?:M\d+\.\d+|K\d+-\d+)$/u;

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

export function isRoadmapTaskCode(code) {
  return typeof code === 'string' && ROADMAP_CODE_PATTERN.test(code);
}

export function projectRoadmapTaskFromTaskos(task) {
  const seriesPrefix = typeof task.series === 'string' ? task.series.toLowerCase() : '';
  const labels = Array.isArray(task.tags)
    ? task.tags.filter((tag, idx) => !(idx === 0 && tag === seriesPrefix))
    : [];
  const detailFile = task.evidence?.detailFile ?? undefined;
  const evidencePath = Array.isArray(task.evidence?.paths) ? task.evidence.paths[0] : undefined;
  const output = task.proposedSolution ?? task.acceptanceCriteria?.[0]?.text ?? '';

  const projected = {
    id: task.code,
    title: task.title,
    milestone: task.milestone ?? '',
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    output,
    ...(detailFile ? { detailFile } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.assignee ? { assignee: task.assignee } : {}),
    status: toRoadmapTaskStatus(task.status) ?? 'todo',
    ...(evidencePath ? { evidence: evidencePath } : {}),
  };
  return projected;
}

export function projectRoadmapIndexFromTaskos(registry) {
  if (!registry || !Array.isArray(registry.tasks)) {
    throw new Error('Canonical TaskOS registry must contain a tasks array.');
  }
  const tasks = registry.tasks
    .filter((task) => isRoadmapTaskCode(task?.code))
    .map(projectRoadmapTaskFromTaskos);
  return {
    schemaVersion: 1,
    description: 'Projected in-memory from canonical docs/tasks/tasks.json.',
    tasks,
  };
}

export async function loadCanonicalRoadmapIndex(repositoryRoot) {
  const canonicalPath = path.join(repositoryRoot, CANONICAL_TASKS_RELATIVE_PATH);
  const sourceText = await readFile(canonicalPath, 'utf8');
  const parsed = JSON.parse(sourceText);
  return {
    sourceText,
    index: projectRoadmapIndexFromTaskos(parsed),
  };
}

export function loadRoadmapIndexFromRevision(readAtRevision) {
  try {
    const canonicalRaw = readAtRevision(CANONICAL_TASKS_RELATIVE_PATH);
    const parsed = JSON.parse(canonicalRaw);
    if (
      Array.isArray(parsed?.tasks) &&
      parsed.tasks.some((task) => isRoadmapTaskCode(task?.code))
    ) {
      return projectRoadmapIndexFromTaskos(parsed);
    }
  } catch {
    // Fall back to historical docs/roadmap/tasks.json on pre-consolidation commits.
  }
  const legacyRaw = readAtRevision(LEGACY_ROADMAP_TASKS_RELATIVE_PATH);
  const legacyParsed = JSON.parse(legacyRaw);
  if (!legacyParsed || !Array.isArray(legacyParsed.tasks)) {
    throw new Error('Promotion source task index is invalid.');
  }
  return legacyParsed;
}
