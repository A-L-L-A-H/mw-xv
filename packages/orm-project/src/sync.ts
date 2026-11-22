import {
  ProjectTask,
  type Project,
  type ProjectMilestone,
  type TaskDependencyKind,
  type TaskPriority,
  type TaskStatus,
} from './models.js';

export type ProjectPolymorphicModel =
  typeof Project.modelName | typeof ProjectMilestone.modelName | typeof ProjectTask.modelName;

/** Polymorphic target envelope compatible with `base.activity`, `base.tag_link`, `base.attachment`, and `workflow.instance`. */
export interface PolymorphicResourceRef {
  readonly resource_model: ProjectPolymorphicModel;
  readonly resource_id: number;
}

/** Source correlation envelope compatible with `ai.work_contract` (`source_model` / `source_id`) without circular addon dependencies. */
export interface WorkContractSourceRef {
  readonly source_model: typeof ProjectTask.modelName;
  readonly source_id: number;
}

/** Local-first TaskOS (`apps/todo`) task snapshot mapped 1:1 to `project.task` via `code` / `external_ref`. */
export interface LocalTodoTaskSnapshot {
  readonly code: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly priority?: string | null;
  readonly status?: string | null;
  readonly blocked_reason?: string | null;
  readonly due_date?: string | null;
}

export interface ProjectTaskSyncFields {
  readonly code: string;
  readonly external_ref: string;
  readonly title: string;
  readonly description?: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly blocked_reason?: string;
  readonly due_date?: string;
}

const TODO_PRIORITY_MAP: Readonly<Record<string, TaskPriority>> = {
  p0: 'urgent',
  critical: 'urgent',
  urgent: 'urgent',
  p1: 'high',
  high: 'high',
  p2: 'normal',
  medium: 'normal',
  normal: 'normal',
  p3: 'low',
  low: 'low',
};

const TODO_STATUS_MAP: Readonly<Record<string, TaskStatus>> = {
  open: 'backlog',
  todo: 'backlog',
  backlog: 'backlog',
  doing: 'in_progress',
  in_progress: 'in_progress',
  active: 'in_progress',
  blocked: 'blocked',
  waiting: 'blocked',
  review: 'review',
  in_review: 'review',
  done: 'done',
  closed: 'done',
  completed: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/u;

export function toPolymorphicResource(
  model: ProjectPolymorphicModel,
  recordId: number
): PolymorphicResourceRef {
  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    throw new Error(`Invalid record ID for ${model}: ${recordId}`);
  }
  return { resource_model: model, resource_id: recordId };
}

export function toWorkContractSource(taskId: number): WorkContractSourceRef {
  if (!Number.isSafeInteger(taskId) || taskId < 1) {
    throw new Error(`Invalid project.task ID for WorkContract source: ${taskId}`);
  }
  return { source_model: ProjectTask.modelName, source_id: taskId };
}

export function normalizeTodoPriority(value: string | null | undefined): TaskPriority {
  if (!value) return 'normal';
  return TODO_PRIORITY_MAP[value.trim().toLowerCase()] ?? 'normal';
}

export function normalizeTodoStatus(value: string | null | undefined): TaskStatus {
  if (!value) return 'backlog';
  return TODO_STATUS_MAP[value.trim().toLowerCase()] ?? 'backlog';
}

export function mapTodoTaskToProjectTaskFields(
  snapshot: LocalTodoTaskSnapshot
): ProjectTaskSyncFields {
  const trimmedCode = snapshot.code.trim();
  const trimmedTitle = snapshot.title.trim();
  if (!trimmedCode || !/^[A-Za-z][A-Za-z0-9_-]{1,63}$/u.test(trimmedCode)) {
    throw new Error(`Invalid TaskOS code for project.task sync: ${snapshot.code}`);
  }
  if (!trimmedTitle) {
    throw new Error('TaskOS title must not be empty');
  }
  const dueDate = snapshot.due_date?.trim();
  return {
    code: trimmedCode,
    external_ref: trimmedCode,
    title: trimmedTitle,
    ...(snapshot.summary?.trim() ? { description: snapshot.summary.trim() } : {}),
    priority: normalizeTodoPriority(snapshot.priority),
    status: normalizeTodoStatus(snapshot.status),
    ...(snapshot.blocked_reason?.trim() ? { blocked_reason: snapshot.blocked_reason.trim() } : {}),
    ...(dueDate && ISO_DATE_REGEX.test(dueDate) ? { due_date: dueDate } : {}),
  };
}

export interface ProjectDependencyGraphNode {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly stage_id: number | null;
  readonly blocked_by_ids: readonly number[];
  readonly blocks_ids: readonly number[];
  readonly is_ready: boolean;
}

export interface ProjectDependencyGraphSummary {
  readonly nodes: readonly ProjectDependencyGraphNode[];
  readonly blocked_task_ids: readonly number[];
  readonly ready_task_ids: readonly number[];
}

const REVERSE_TODO_PRIORITY_MAP: Readonly<Record<TaskPriority, string>> = {
  urgent: 'p0',
  high: 'p1',
  normal: 'p2',
  low: 'p3',
};

const REVERSE_TODO_STATUS_MAP: Readonly<Record<TaskStatus, string>> = {
  backlog: 'todo',
  in_progress: 'doing',
  blocked: 'blocked',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
};

export function mapProjectTaskToTodoSnapshot(task: {
  readonly code: string;
  readonly external_ref?: string | null;
  readonly title: string;
  readonly description?: string | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly blocked_reason?: string | null;
  readonly due_date?: string | null;
}): LocalTodoTaskSnapshot {
  const code = task.external_ref?.trim() || task.code.trim();
  const title = task.title.trim();
  return {
    code,
    title,
    ...(task.description?.trim() ? { summary: task.description.trim() } : {}),
    priority: REVERSE_TODO_PRIORITY_MAP[task.priority] ?? 'p2',
    status: REVERSE_TODO_STATUS_MAP[task.status] ?? 'todo',
    ...(task.blocked_reason?.trim() ? { blocked_reason: task.blocked_reason.trim() } : {}),
    ...(task.due_date?.trim() ? { due_date: task.due_date.trim() } : {}),
  };
}

export function buildProjectDependencyGraph(
  tasks: ReadonlyArray<{
    readonly id: number;
    readonly code: string;
    readonly title: string;
    readonly status: TaskStatus;
    readonly priority: TaskPriority;
    readonly stage_id?: number | null;
  }>,
  dependencies: ReadonlyArray<{
    readonly id?: number;
    readonly task_id: number;
    readonly depends_on_id: number;
    readonly kind: TaskDependencyKind;
    readonly active?: boolean;
  }>
): ProjectDependencyGraphSummary {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blockedByMap = new Map<number, number[]>();
  const blocksMap = new Map<number, number[]>();

  for (const edge of dependencies) {
    if (edge.active === false || edge.kind !== 'blocks') continue;
    const target = byId.get(edge.task_id);
    const blocker = byId.get(edge.depends_on_id);
    if (!target || !blocker) continue;
    if (blocker.status !== 'done' && blocker.status !== 'cancelled') {
      const blockedList = blockedByMap.get(target.id) ?? [];
      if (!blockedList.includes(blocker.id)) blockedList.push(blocker.id);
      blockedByMap.set(target.id, blockedList);

      const blocksList = blocksMap.get(blocker.id) ?? [];
      if (!blocksList.includes(target.id)) blocksList.push(target.id);
      blocksMap.set(blocker.id, blocksList);
    }
  }

  const nodes: ProjectDependencyGraphNode[] = [];
  const blockedTaskIds: number[] = [];
  const readyTaskIds: number[] = [];

  for (const task of tasks) {
    const blockedBy = blockedByMap.get(task.id) ?? [];
    const blocks = blocksMap.get(task.id) ?? [];
    const isTerminalOrExplicitBlocked =
      task.status === 'done' || task.status === 'cancelled' || task.status === 'blocked';
    const isBlocked = !['done', 'cancelled'].includes(task.status) && blockedBy.length > 0;
    const isReady = !isTerminalOrExplicitBlocked && blockedBy.length === 0;

    if (isBlocked || task.status === 'blocked') blockedTaskIds.push(task.id);
    if (isReady) readyTaskIds.push(task.id);

    nodes.push({
      id: task.id,
      code: task.code,
      title: task.title,
      status: task.status,
      priority: task.priority,
      stage_id: task.stage_id ?? null,
      blocked_by_ids: blockedBy,
      blocks_ids: blocks,
      is_ready: isReady,
    });
  }

  return {
    nodes,
    blocked_task_ids: blockedTaskIds,
    ready_task_ids: readyTaskIds,
  };
}
