/**
 * T37 — Plan-TaskOS -> ORM projection for `project.*` models.
 *
 * The JSON payload shape is produced by `buildPlanSyncPayload` in
 * `@moonwitness/plan-taskos`; this module is the ORM-side consumer. It maps
 * waves to milestones, tasks to tasks (with parent-first insert ordering),
 * and dependency edges to `project.task_dependency`. Human-owned Kanban
 * fields (`stage_id`, `assignee_id`, `reviewer_id`) are never overwritten —
 * Split-Authority is preserved.
 */

import { normalizeOrmTaskCode } from '@moonwitness/plan-taskos';
import type {
  MilestoneStatus,
  TaskPriority,
  TaskStatus,
} from './models.js';

export interface PlanSyncWavePayload {
  readonly code: string;
  readonly name: string;
  readonly external_ref: string;
  readonly status?: string;
  readonly due_date?: string | null;
}

export interface PlanSyncTaskPayload {
  /** Dotted ORM code (e.g. `plan.W0_01`); normalized to a column-safe code. */
  readonly code: string;
  readonly title: string;
  readonly parent_code: string | null;
  readonly milestone_code: string | null;
  /** Canonical URN, stored verbatim in `external_ref`. */
  readonly external_ref: string;
  readonly status: string;
  readonly priority?: string;
  readonly summary?: string | null;
  readonly blocked_reason?: string | null;
  readonly estimate_minutes?: number | null;
  readonly owner_files?: readonly string[];
  readonly verify_commands?: readonly string[];
  readonly acceptance_criteria?: readonly { readonly text: string; readonly done?: boolean }[];
  readonly depends_on?: readonly string[];
}

export interface PlanSyncPayload {
  readonly project: {
    readonly code?: string;
    readonly name?: string;
    readonly external_ref?: string;
  };
  readonly waves: readonly PlanSyncWavePayload[];
  readonly tasks: readonly PlanSyncTaskPayload[];
  readonly dependencies?: readonly {
    readonly code: string;
    readonly depends_on: string;
  }[];
}

export interface PlanSyncMigration {
  readonly code: string;
  readonly externalRef: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly description?: string;
  readonly blockedReason?: string;
  readonly estimateMinutes?: number;
  readonly milestoneCode: string | null;
  readonly parentCode: string | null;
  readonly dependsOn: readonly string[];
}

export interface PlanSyncResult {
  readonly milestonesImported: number;
  readonly milestonesUpdated: number;
  readonly tasksImported: number;
  readonly tasksUpdated: number;
  readonly dependenciesImported: number;
  readonly codeByRaw: Readonly<Record<string, string>>;
}

const PRIORITY_MAP: Readonly<Record<string, TaskPriority>> = {
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

const STATUS_MAP: Readonly<Record<string, TaskStatus>> = {
  todo: 'backlog',
  backlog: 'backlog',
  open: 'backlog',
  planned: 'backlog',
  doing: 'in_progress',
  active: 'in_progress',
  in_progress: 'in_progress',
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

const MILESTONE_STATUS_MAP: Readonly<Record<string, MilestoneStatus>> = {
  open: 'open',
  active: 'open',
  planned: 'open',
  reached: 'reached',
  done: 'reached',
  completed: 'reached',
  missed: 'missed',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Canonical ORM code; dotted codes from the SDK become underscores. */
export function toOrmTaskCode(raw: string): string {
  return normalizeOrmTaskCode(raw);
}

/** Wave/milestone codes use the ORM slug pattern: lowercase, dots/colon collapsed. */
export function toOrmMilestoneCode(raw: string): string {
  const code = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, 'a');
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(code)) {
    throw new Error(`Cannot normalize plan sync milestone code: ${raw}`);
  }
  return code;
}

export function normalizePlanPriority(raw: string | undefined): TaskPriority {
  return (raw && PRIORITY_MAP[raw.trim().toLowerCase()]) || 'normal';
}

export function normalizePlanStatus(raw: string): TaskStatus {
  return STATUS_MAP[raw.trim().toLowerCase()] ?? 'backlog';
}

export function normalizeMilestoneStatus(raw: string | undefined): MilestoneStatus {
  return (raw && MILESTONE_STATUS_MAP[raw.trim().toLowerCase()]) || 'open';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plan sync ${field} must be a non-empty string`);
  }
  return value.trim();
}

/** Validate and normalize the incoming payload before any database writes. */
export function parsePlanSyncPayload(value: unknown): PlanSyncPayload {
  const root = asRecord(value);
  if (!root) throw new Error('Plan sync payload must be an object');
  const project = asRecord(root.project) ?? {};
  const wavesRaw = Array.isArray(root.waves) ? root.waves : [];
  const tasksRaw = Array.isArray(root.tasks) ? root.tasks : [];

  const waves: PlanSyncWavePayload[] = wavesRaw.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) throw new Error(`Plan sync wave ${index} must be an object`);
    const code = requireString(item.code, `wave ${index} code`);
    const dueDate = typeof item.due_date === 'string' && ISO_DATE.test(item.due_date)
      ? item.due_date
      : null;
    return {
      code,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : code,
      external_ref: typeof item.external_ref === 'string'
        ? item.external_ref
        : `urn:plan-sync:wave:${code}`,
      ...(typeof item.status === 'string' ? { status: item.status } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
    };
  });

  const tasks: PlanSyncTaskPayload[] = tasksRaw.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) throw new Error(`Plan sync task ${index} must be an object`);
    const code = requireString(item.code, `task ${index} code`);
    const title = requireString(item.title, `task ${index} title`);
    const externalRef = requireString(item.external_ref, `task ${index} external_ref`);
    const acceptanceCriteria = Array.isArray(item.acceptance_criteria)
      ? item.acceptance_criteria.flatMap((criterion) => {
          const entry = asRecord(criterion);
          if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) return [];
          return [{ text: entry.text.trim(), done: entry.done === true }];
        })
      : [];
    const ownerFiles = Array.isArray(item.owner_files)
      ? item.owner_files.filter((file): file is string => typeof file === 'string')
      : [];
    const verifyCommands = Array.isArray(item.verify_commands)
      ? item.verify_commands.filter((cmd): cmd is string => typeof cmd === 'string')
      : [];
    const dependsOn = Array.isArray(item.depends_on)
      ? item.depends_on.filter((dep): dep is string => typeof dep === 'string')
      : [];
    return {
      code,
      title,
      external_ref: externalRef,
      parent_code: typeof item.parent_code === 'string' && item.parent_code.trim()
        ? item.parent_code.trim()
        : null,
      milestone_code: typeof item.milestone_code === 'string' && item.milestone_code.trim()
        ? item.milestone_code.trim()
        : null,
      status: typeof item.status === 'string' ? item.status : 'todo',
      ...(typeof item.priority === 'string' ? { priority: item.priority } : {}),
      ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
      ...(typeof item.blocked_reason === 'string' ? { blocked_reason: item.blocked_reason } : {}),
      ...(typeof item.estimate_minutes === 'number' && Number.isSafeInteger(item.estimate_minutes)
        ? { estimate_minutes: item.estimate_minutes }
        : {}),
      owner_files: ownerFiles,
      verify_commands: verifyCommands,
      acceptance_criteria: acceptanceCriteria,
      depends_on: dependsOn,
    };
  });

  const dependenciesRaw = Array.isArray(root.dependencies) ? root.dependencies : [];
  const dependencies = dependenciesRaw.flatMap((raw, index) => {
    const item = asRecord(raw);
    if (!item) throw new Error(`Plan sync dependency ${index} must be an object`);
    return [{
      code: requireString(item.code, `dependency ${index} code`),
      depends_on: requireString(item.depends_on, `dependency ${index} depends_on`),
    }];
  });

  return {
    project: {
      ...(typeof project.code === 'string' ? { code: project.code } : {}),
      ...(typeof project.name === 'string' ? { name: project.name } : {}),
      ...(typeof project.external_ref === 'string' ? { external_ref: project.external_ref } : {}),
    },
    waves,
    tasks,
    dependencies,
  };
}

/**
 * Build the parent-first migration plan. Raw codes are kept for dependency
 * resolution; ORM-safe codes are stored on each migration entry.
 */
export function buildPlanSyncMigration(payload: PlanSyncPayload): readonly PlanSyncMigration[] {
  const codeByRaw = new Map<string, string>();
  for (const task of payload.tasks) {
    codeByRaw.set(task.code, toOrmTaskCode(task.code));
  }

  const byCode = new Map(payload.tasks.map((task) => [task.code, task]));
  const visiting = new Set<string>();
  const ordered: PlanSyncTaskPayload[] = [];
  const done = new Set<PlanSyncTaskPayload>();

  const visit = (task: PlanSyncTaskPayload): void => {
    if (done.has(task)) return;
    if (visiting.has(task.code)) {
      throw new Error(`Plan sync task graph contains a parent cycle at ${task.code}`);
    }
    visiting.add(task.code);
    if (task.parent_code && byCode.has(task.parent_code)) {
      visit(byCode.get(task.parent_code)!);
    }
    visiting.delete(task.code);
    done.add(task);
    ordered.push(task);
  };
  for (const task of payload.tasks) visit(task);

  const dependsOnByCode = new Map<string, string[]>();
  for (const task of payload.tasks) {
    const deps = new Set<string>(task.depends_on ?? []);
    for (const dep of (payload.dependencies ?? [])) {
      if (dep.code === task.code) deps.add(dep.depends_on);
    }
    dependsOnByCode.set(task.code, [...deps]);
  }

  return ordered.map((task) => {
    const milestoneCode = task.milestone_code
      ? toOrmMilestoneCode(task.milestone_code)
      : null;
    return {
      code: codeByRaw.get(task.code)!,
      externalRef: task.external_ref,
      title: task.title,
      status: normalizePlanStatus(task.status),
      priority: normalizePlanPriority(task.priority),
      ...(task.summary?.trim() ? { description: task.summary.trim() } : {}),
      ...(task.blocked_reason?.trim() ? { blockedReason: task.blocked_reason.trim() } : {}),
      ...(typeof task.estimate_minutes === 'number'
        ? { estimateMinutes: task.estimate_minutes }
        : {}),
      milestoneCode,
      parentCode: task.parent_code
        ? (codeByRaw.get(task.parent_code) ?? toOrmTaskCode(task.parent_code))
        : null,
      dependsOn: (dependsOnByCode.get(task.code) ?? []).map(
        (dep) => codeByRaw.get(dep) ?? toOrmTaskCode(dep)
      ),
    };
  });
}

/** No-op delta detector used by the route to avoid needless patches. */
export function hasPlanSyncTaskDelta(
  existing: {
    readonly title?: string | null;
    readonly description?: string | null;
    readonly priority?: string | null;
    readonly status?: string | null;
    readonly blocked_reason?: string | null;
    readonly estimate_minutes?: number | null;
    readonly milestone_id?: number | null;
    readonly parent_id?: number | null;
    readonly external_ref?: string | null;
  },
  migration: PlanSyncMigration,
  milestoneId: number | null,
  parentId: number | null
): boolean {
  return (
    existing.title !== migration.title ||
    (existing.description ?? null) !== (migration.description ?? null) ||
    existing.priority !== migration.priority ||
    existing.status !== migration.status ||
    (existing.blocked_reason ?? null) !== (migration.blockedReason ?? null) ||
    (existing.estimate_minutes ?? null) !== (migration.estimateMinutes ?? null) ||
    (existing.milestone_id ?? null) !== milestoneId ||
    (existing.parent_id ?? null) !== parentId ||
    (existing.external_ref ?? null) !== migration.externalRef
  );
}
