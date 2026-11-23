import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Knex } from 'knex';
import {
  mapTodoTaskToProjectTaskFields,
  type LocalTodoTaskSnapshot,
  type TaskStatus,
} from '@moonwitness/orm-project';
import { ValidationError } from '@moonwitness/types';

export interface DesktopImportOptions {
  readonly db: Knex;
  readonly companyId: number;
  readonly userId: number;
  readonly sourcePath: string;
}

export interface DesktopImportSummary {
  readonly sourcePath: string;
  readonly format: 'moonwitness-tasks/v2' | 'legacy-board-sqlite';
  readonly projectsCreated: number;
  readonly projectsUpdated: number;
  readonly stagesCreated: number;
  readonly tasksCreated: number;
  readonly tasksUpdated: number;
  readonly dependenciesCreated: number;
  readonly skipped: number;
}

interface TasksV2Project {
  readonly slug?: string;
  readonly name?: string;
  readonly statuses?: readonly string[];
}

interface TasksV2Task {
  readonly code?: string;
  readonly project?: string;
  readonly title?: string;
  readonly summary?: string | null;
  readonly problem?: string | null;
  readonly priority?: string | null;
  readonly status?: string | null;
  readonly blockedReason?: string | null;
  readonly blocked_reason?: string | null;
  readonly dueDate?: string | null;
  readonly due_date?: string | null;
  readonly dependsOn?: readonly string[];
  readonly blocks?: readonly string[];
}

interface TasksV2Document {
  readonly format?: string;
  readonly projects?: readonly TasksV2Project[];
  readonly tasks?: readonly TasksV2Task[];
}

interface LegacyBoardProjectRow {
  readonly id?: number;
  readonly slug?: string;
  readonly name?: string;
}

interface LegacyBoardTaskRow {
  readonly id?: number;
  readonly code?: string;
  readonly project_slug?: string;
  readonly project_id?: number;
  readonly title?: string;
  readonly summary?: string | null;
  readonly description?: string | null;
  readonly priority?: string | null;
  readonly status?: string | null;
  readonly blocked_reason?: string | null;
  readonly due_date?: string | null;
}

interface LegacyBoardDependencyRow {
  readonly task_code?: string;
  readonly depends_on_code?: string;
  readonly kind?: string;
}

interface NormalizedProjectInput {
  readonly code: string;
  readonly name: string;
}

interface NormalizedTaskInput {
  readonly projectCode: string;
  readonly externalRef: string;
  readonly snapshot: LocalTodoTaskSnapshot;
  readonly dependsOnRefs: readonly string[];
}

const DEFAULT_STAGES: readonly {
  readonly code: string;
  readonly name: string;
  readonly sequence: number;
  readonly isClosed: boolean;
}[] = [
  { code: 'backlog', name: 'Backlog', sequence: 10, isClosed: false },
  { code: 'in_progress', name: 'In Progress', sequence: 20, isClosed: false },
  { code: 'review', name: 'Review', sequence: 30, isClosed: false },
  { code: 'done', name: 'Done', sequence: 40, isClosed: true },
];

function sanitizeSlug(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^[^a-z]+/u, 'p_')
    .slice(0, 64);
  return cleaned.length >= 2 ? cleaned : fallback;
}

function sanitizeTaskCode(raw: string, fallbackIndex: number): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, '_')
    .replace(/^[^A-Za-z]+/u, 'T_')
    .slice(0, 64);
  if (/^[A-Za-z][A-Za-z0-9_-]{1,63}$/u.test(cleaned)) {
    return cleaned;
  }
  return `TASK_${fallbackIndex}`;
}

function stageCodeForStatus(status: TaskStatus): string {
  switch (status) {
    case 'in_progress':
    case 'blocked':
      return 'in_progress';
    case 'review':
      return 'review';
    case 'done':
    case 'cancelled':
      return 'done';
    case 'backlog':
    default:
      return 'backlog';
  }
}

function parseTasksV2Json(sourcePath: string): {
  readonly projects: readonly NormalizedProjectInput[];
  readonly tasks: readonly NormalizedTaskInput[];
} {
  const rawText = readFileSync(sourcePath, 'utf8');
  const parsed = JSON.parse(rawText) as TasksV2Document;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new ValidationError(
      `Invalid moonwitness-tasks/v2 JSON file at '${sourcePath}': missing 'tasks' array`
    );
  }

  const projectMap = new Map<string, NormalizedProjectInput>();
  for (const proj of parsed.projects ?? []) {
    if (!proj.slug) continue;
    const code = sanitizeSlug(proj.slug, 'default');
    projectMap.set(code, {
      code,
      name: (proj.name?.trim() || proj.slug.trim()).slice(0, 200),
    });
  }

  const tasks: NormalizedTaskInput[] = [];
  let index = 0;
  for (const rawTask of parsed.tasks) {
    index += 1;
    const rawCode = rawTask.code?.trim();
    const rawTitle = rawTask.title?.trim();
    if (!rawCode || !rawTitle) continue;

    const projectCode = sanitizeSlug(rawTask.project ?? 'default', 'default');
    if (!projectMap.has(projectCode)) {
      projectMap.set(projectCode, {
        code: projectCode,
        name: rawTask.project?.trim() || 'Local Workspace',
      });
    }

    const sanitizedCode = sanitizeTaskCode(rawCode, index);
    const summaryParts = [rawTask.summary?.trim(), rawTask.problem?.trim()].filter(
      (part): part is string => Boolean(part && part.length > 0)
    );

    tasks.push({
      projectCode,
      externalRef: rawCode,
      snapshot: {
        code: sanitizedCode,
        title: rawTitle,
        summary: summaryParts.length > 0 ? summaryParts.join('\n\n') : null,
        priority: rawTask.priority ?? null,
        status: rawTask.status ?? null,
        blocked_reason: rawTask.blockedReason ?? rawTask.blocked_reason ?? null,
        due_date: rawTask.dueDate ?? rawTask.due_date ?? null,
      },
      dependsOnRefs: Array.isArray(rawTask.dependsOn)
        ? rawTask.dependsOn.filter((dep: unknown): dep is string => typeof dep === 'string' && dep.trim().length > 0)
        : [],
    });
  }

  return {
    projects: [...projectMap.values()],
    tasks,
  };
}

function readLegacyBoardSqlite(sourcePath: string): {
  readonly projects: readonly NormalizedProjectInput[];
  readonly tasks: readonly NormalizedTaskInput[];
} {
  const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as unknown as readonly { readonly name: string }[];
    const tableNames = new Set(tables.map((t) => t.name));

    const projectMap = new Map<string, NormalizedProjectInput>();
    const projectIdToSlug = new Map<number, string>();

    if (tableNames.has('projects')) {
      const rows = sqlite
        .prepare('SELECT id, slug, name FROM projects')
        .all() as unknown as readonly LegacyBoardProjectRow[];
      for (const row of rows) {
        const code = sanitizeSlug(row.slug ?? row.name ?? 'default', 'default');
        projectMap.set(code, {
          code,
          name: (row.name?.trim() || row.slug?.trim() || 'Local Workspace').slice(0, 200),
        });
        if (typeof row.id === 'number') {
          projectIdToSlug.set(row.id, code);
        }
      }
    }

    const depMap = new Map<string, string[]>();
    if (tableNames.has('task_dependencies')) {
      const depRows = sqlite
        .prepare('SELECT task_code, depends_on_code FROM task_dependencies')
        .all() as unknown as readonly LegacyBoardDependencyRow[];
      for (const dep of depRows) {
        if (!dep.task_code || !dep.depends_on_code) continue;
        const list = depMap.get(dep.task_code) ?? [];
        list.push(dep.depends_on_code);
        depMap.set(dep.task_code, list);
      }
    }

    const tasks: NormalizedTaskInput[] = [];
    if (tableNames.has('tasks')) {
      const rows = sqlite
        .prepare('SELECT * FROM tasks')
        .all() as unknown as readonly LegacyBoardTaskRow[];
      let index = 0;
      for (const row of rows) {
        index += 1;
        const rawCode = row.code?.trim() || (row.id !== undefined ? `LEGACY_${row.id}` : '');
        const rawTitle = row.title?.trim();
        if (!rawCode || !rawTitle) continue;

        const rawProjectCode =
          row.project_slug ??
          (row.project_id !== undefined ? projectIdToSlug.get(row.project_id) : undefined) ??
          'default';
        const projectCode = sanitizeSlug(rawProjectCode, 'default');
        if (!projectMap.has(projectCode)) {
          projectMap.set(projectCode, { code: projectCode, name: rawProjectCode });
        }

        tasks.push({
          projectCode,
          externalRef: rawCode,
          snapshot: {
            code: sanitizeTaskCode(rawCode, index),
            title: rawTitle,
            summary: row.summary ?? row.description ?? null,
            priority: row.priority ?? null,
            status: row.status ?? null,
            blocked_reason: row.blocked_reason ?? null,
            due_date: row.due_date ?? null,
          },
          dependsOnRefs: depMap.get(rawCode) ?? [],
        });
      }
    }

    return {
      projects: [...projectMap.values()],
      tasks,
    };
  } finally {
    sqlite.close();
  }
}

export async function importDesktopTasks(
  options: DesktopImportOptions
): Promise<DesktopImportSummary> {
  const resolvedPath = path.resolve(options.sourcePath);
  if (!existsSync(resolvedPath)) {
    throw new ValidationError(`Import source file not found: '${resolvedPath}'`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const format: DesktopImportSummary['format'] =
    ext === '.db' || ext === '.sqlite' || ext === '.sqlite3'
      ? 'legacy-board-sqlite'
      : 'moonwitness-tasks/v2';

  const parsed =
    format === 'legacy-board-sqlite'
      ? readLegacyBoardSqlite(resolvedPath)
      : parseTasksV2Json(resolvedPath);

  const { db, companyId, userId } = options;
  const now = new Date().toISOString();

  let projectsCreated = 0;
  let projectsUpdated = 0;
  let stagesCreated = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let dependenciesCreated = 0;
  let skipped = 0;

  const projectIdByCode = new Map<string, number>();
  const stageIdByProjectAndCode = new Map<string, number>();
  const taskIdByExternalRef = new Map<string, number>();

  await db.transaction(async (trx) => {
    for (const proj of parsed.projects) {
      const existing = (await trx('project_projects')
        .where({ company_id: companyId, code: proj.code })
        .first()) as { id: number; name: string } | undefined;

      let projectId: number;
      if (existing) {
        projectId = existing.id;
        if (existing.name !== proj.name) {
          await trx('project_projects').where({ id: projectId }).update({
            name: proj.name,
            write_uid: userId,
            write_date: now,
          });
          projectsUpdated += 1;
        }
      } else {
        const inserted = (await trx('project_projects')
          .insert({
            company_id: companyId,
            code: proj.code,
            name: proj.name,
            status: 'active',
            sequence: 10,
            active: true,
            create_uid: userId,
            write_uid: userId,
            create_date: now,
            write_date: now,
          })
          .returning('id')) as Array<{ id: number } | number>;
        const first = inserted[0];
        projectId = typeof first === 'number' ? first : (first?.id ?? 0);
        if (!projectId) {
          const fetched = (await trx('project_projects')
            .where({ company_id: companyId, code: proj.code })
            .first()) as { id: number };
          projectId = fetched.id;
        }
        projectsCreated += 1;
      }
      projectIdByCode.set(proj.code, projectId);

      for (const stage of DEFAULT_STAGES) {
        const existingStage = (await trx('project_stages')
          .where({ company_id: companyId, project_id: projectId, code: stage.code })
          .first()) as { id: number } | undefined;
        let stageId: number;
        if (existingStage) {
          stageId = existingStage.id;
        } else {
          const insertedStage = (await trx('project_stages')
            .insert({
              company_id: companyId,
              project_id: projectId,
              code: stage.code,
              name: stage.name,
              sequence: stage.sequence,
              is_closed: stage.isClosed,
              fold: false,
              active: true,
              create_uid: userId,
              write_uid: userId,
              create_date: now,
              write_date: now,
            })
            .returning('id')) as Array<{ id: number } | number>;
          const first = insertedStage[0];
          stageId = typeof first === 'number' ? first : (first?.id ?? 0);
          if (!stageId) {
            const fetched = (await trx('project_stages')
              .where({ company_id: companyId, project_id: projectId, code: stage.code })
              .first()) as { id: number };
            stageId = fetched.id;
          }
          stagesCreated += 1;
        }
        stageIdByProjectAndCode.set(`${projectId}:${stage.code}`, stageId);
      }
    }

    let position = 100;
    for (const item of parsed.tasks) {
      const projectId = projectIdByCode.get(item.projectCode);
      if (!projectId) {
        skipped += 1;
        continue;
      }

      let mapped;
      try {
        mapped = mapTodoTaskToProjectTaskFields(item.snapshot);
      } catch {
        skipped += 1;
        continue;
      }

      const stageCode = stageCodeForStatus(mapped.status);
      const stageId = stageIdByProjectAndCode.get(`${projectId}:${stageCode}`);
      if (!stageId) {
        skipped += 1;
        continue;
      }

      const existingTask = (await trx('project_tasks')
        .where({ company_id: companyId, external_ref: item.externalRef })
        .first()) as { id: number; code: string } | undefined;

      if (existingTask) {
        await trx('project_tasks').where({ id: existingTask.id }).update({
          project_id: projectId,
          stage_id: stageId,
          title: mapped.title,
          description: mapped.description ?? null,
          priority: mapped.priority,
          status: mapped.status,
          blocked_reason: mapped.blocked_reason ?? null,
          due_date: mapped.due_date ?? null,
          write_uid: userId,
          write_date: now,
        });
        taskIdByExternalRef.set(item.externalRef, existingTask.id);
        tasksUpdated += 1;
      } else {
        // Ensure unique (company_id, code)
        let candidateCode = mapped.code;
        const codeConflict = (await trx('project_tasks')
          .where({ company_id: companyId, code: candidateCode })
          .first()) as { id: number } | undefined;
        if (codeConflict) {
          candidateCode = `${candidateCode.slice(0, 56)}_${position}`;
        }

        const insertedTask = (await trx('project_tasks')
          .insert({
            company_id: companyId,
            project_id: projectId,
            stage_id: stageId,
            code: candidateCode,
            external_ref: item.externalRef,
            title: mapped.title,
            description: mapped.description ?? null,
            priority: mapped.priority,
            status: mapped.status,
            blocked_reason: mapped.blocked_reason ?? null,
            due_date: mapped.due_date ?? null,
            position,
            active: true,
            create_uid: userId,
            write_uid: userId,
            create_date: now,
            write_date: now,
          })
          .returning('id')) as Array<{ id: number } | number>;
        const first = insertedTask[0];
        let taskId = typeof first === 'number' ? first : (first?.id ?? 0);
        if (!taskId) {
          const fetched = (await trx('project_tasks')
            .where({ company_id: companyId, external_ref: item.externalRef })
            .first()) as { id: number };
          taskId = fetched.id;
        }
        taskIdByExternalRef.set(item.externalRef, taskId);
        tasksCreated += 1;
      }
      position += 10;
    }

    for (const item of parsed.tasks) {
      const taskId = taskIdByExternalRef.get(item.externalRef);
      if (!taskId || item.dependsOnRefs.length === 0) continue;
      for (const depRef of item.dependsOnRefs) {
        const dependsOnId = taskIdByExternalRef.get(depRef);
        if (!dependsOnId || dependsOnId === taskId) continue;

        const existingDep = (await trx('project_task_dependencies')
          .where({ task_id: taskId, depends_on_id: dependsOnId })
          .first()) as { id: number } | undefined;
        if (existingDep) continue;

        await trx('project_task_dependencies').insert({
          company_id: companyId,
          task_id: taskId,
          depends_on_id: dependsOnId,
          kind: 'blocks',
          active: true,
          create_uid: userId,
          write_uid: userId,
          create_date: now,
          write_date: now,
        });
        dependenciesCreated += 1;
      }
    }
  });

  return {
    sourcePath: resolvedPath,
    format,
    projectsCreated,
    projectsUpdated,
    stagesCreated,
    tasksCreated,
    tasksUpdated,
    dependenciesCreated,
    skipped,
  };
}
