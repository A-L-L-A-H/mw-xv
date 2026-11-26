import { randomUUID } from 'node:crypto';
import {
  Registry,
  type AddonHttpHostContext,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
} from '@moonwitness/orm';
import { AuditLog, Company, CompanyMembership } from '@moonwitness/orm-base';
import { isRecord } from '@moonwitness/types';
import {
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
} from './models.js';
import {
  buildProjectDependencyGraph,
  mapProjectTaskToTodoSnapshot,
  mapTodoTaskToProjectTaskFields,
  toWorkContractSource,
  type LocalTodoTaskSnapshot,
} from './sync.js';
import {
  buildPlanSyncMigration,
  hasPlanSyncTaskDelta,
  normalizeMilestoneStatus,
  parsePlanSyncPayload,
  toOrmMilestoneCode,
  toOrmTaskCode,
  type PlanSyncResult,
} from './plan-sync.js';

interface TodoSyncBody {
  readonly default_stage_id?: number;
  readonly tasks?: readonly LocalTodoTaskSnapshot[];
}

interface IdParams {
  [key: string]: string;
  id: string;
}

type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
type ProjectRole = 'system' | 'superadmin' | 'user';

interface CompanyContext {
  userId: number;
  companyId: number;
  role: ProjectRole;
}

interface DynamicModelRecord {
  id: number;
  code?: string;
  status?: string;
  max_risk_tier?: string;
  [key: string]: unknown;
}

interface DynamicModelQuery {
  findOne(
    clause: Record<string, unknown>
  ): DynamicModelQuery & PromiseLike<DynamicModelRecord | undefined>;
  findById(id: number): DynamicModelQuery & PromiseLike<DynamicModelRecord | undefined>;
  where(clause: Record<string, unknown>): DynamicModelQuery;
  orderBy(column: string, direction: 'asc' | 'desc'): DynamicModelQuery;
  first(): Promise<DynamicModelRecord | undefined>;
  withGraphFetched(expr: string): Promise<DynamicModelRecord | undefined>;
  insert(payload: Record<string, unknown>): Promise<unknown>;
  insertAndFetch(payload: Record<string, unknown>): Promise<DynamicModelRecord>;
}

interface DynamicModelClass {
  query(trx?: unknown): DynamicModelQuery;
}

function parsePositiveIntId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeSlugCode(raw: unknown, fallbackPrefix: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/gu, '_')
      .replace(/^[^a-z]+/u, 'a');
    if (cleaned.length >= 2) return cleaned.slice(0, 120);
  }
  return `${fallbackPrefix}_${randomUUID().slice(0, 8)}`;
}

async function defaultHasCompanyAccess(
  userId: number,
  companyId: number,
  role: string
): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId < 1) return false;
  if (!Number.isSafeInteger(companyId) || companyId < 1) return false;
  const company = await Company.query().findOne({ id: companyId, active: true });
  if (!company) return false;
  const membership = await CompanyMembership.query().findOne({
    user_id: userId,
    company_id: companyId,
    active: true,
  });
  if (membership) return true;
  if (role === 'system') return true;
  return false;
}

async function defaultRecordAudit(
  userId: number,
  model: string,
  recordId: number,
  operation: string,
  changes: Record<string, unknown>
): Promise<void> {
  await AuditLog.query().insert({
    model,
    record_id: recordId,
    operation,
    actor_id: userId,
    changes: JSON.stringify(changes),
  });
}

async function requireCompanyContext(
  req: AddonHttpRequestBase,
  reply: AddonHttpReply,
  options: AddonHttpHostContext
): Promise<CompanyContext | null> {
  reply.header?.('Cache-Control', 'private, no-store');
  const auth = req.auth;
  if (!auth) {
    await reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    await reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  const role: ProjectRole =
    auth.role === 'superadmin' || auth.role === 'system' ? auth.role : 'user';
  const checkCompany = options.hasCompanyAccess ?? defaultHasCompanyAccess;
  const allowed = await checkCompany(auth.userId, auth.companyId, role);
  if (!allowed) {
    await reply.code(403).send({ success: false, error: 'Company access denied' });
    return null;
  }

  const queryRecord = isRecord(req.query) ? req.query : null;
  if (queryRecord && queryRecord.company_id !== undefined) {
    const requestedCompanyId = Number(queryRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  if (queryRecord && queryRecord.companyId !== undefined) {
    const requestedCompanyId = Number(queryRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  const bodyRecord = isRecord(req.body) ? req.body : null;
  if (bodyRecord && bodyRecord.company_id !== undefined) {
    const requestedCompanyId = Number(bodyRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
      return null;
    }
  }
  if (bodyRecord && bodyRecord.companyId !== undefined) {
    const requestedCompanyId = Number(bodyRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
      return null;
    }
  }

  return { userId: auth.userId, companyId: auth.companyId, role };
}

function resolveDynamicModel(modelName: string): DynamicModelClass | null {
  if (!Registry.has(modelName)) return null;
  return Registry.get(modelName) as unknown as DynamicModelClass;
}

async function ensureDefaultExecutionPolicy(
  ExecutionPolicy: DynamicModelClass,
  companyId: number,
  trx?: unknown
): Promise<DynamicModelRecord> {
  const existing = await ExecutionPolicy.query(trx)
    .where({ company_id: companyId, active: true })
    .orderBy('id', 'asc')
    .first();
  if (existing) return existing;
  return ExecutionPolicy.query(trx).insertAndFetch({
    company_id: companyId,
    code: 'default_r0_policy',
    policy_version: 1,
    name: 'Default R0 Read-Only Policy',
    default_risk_tier: 'R0',
    max_risk_tier: 'R2',
    allowed_classification: 'local_only',
    allow_cloud_fallback: false,
    require_independent_review: true,
    require_human_signoff: false,
    max_steps: 8,
    max_wall_clock_seconds: 120,
    max_tokens_per_run: 32000,
    max_cost_micros_per_run: 100000,
    max_delegation_depth: 2,
    max_concurrent_runs: 2,
    enabled: true,
  });
}

export const projectHttpPlugin: AddonHttpPlugin = async (app, options) => {
  const canAccess = options.canAccess;
  const recordAudit = options.recordAudit ?? defaultRecordAudit;

  for (const prefix of ['', '/api'] as const) {
    app.get<{ Params: IdParams }>(`${prefix}/projects/:id/board`, async (req, reply) => {
      const ctx = await requireCompanyContext(req, reply, options);
      if (!ctx) return;
      if (!canAccess?.(ctx.role, ProjectTask.modelName, 'read', req.auth?.groupPermissions)) {
        return reply.code(403).send({ success: false, error: 'Project board access denied' });
      }
      const projectId = parsePositiveIntId(req.params.id);
      if (!projectId) {
        return reply.code(400).send({ success: false, error: 'Invalid project ID' });
      }

      const project = await Project.query().findOne({
        id: projectId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!project) {
        return reply.code(404).send({ success: false, error: 'Project not found' });
      }

      const [stages, milestones, tasks] = await Promise.all([
        ProjectStage.query()
          .where({ company_id: ctx.companyId, active: true })
          .andWhere((qb) => qb.where({ project_id: projectId }).orWhereNull('project_id'))
          .orderBy('sequence', 'asc')
          .orderBy('id', 'asc'),
        ProjectMilestone.query()
          .where({ project_id: projectId, company_id: ctx.companyId, active: true })
          .orderBy('due_date', 'asc')
          .orderBy('id', 'asc'),
        ProjectTask.query()
          .where({ project_id: projectId, company_id: ctx.companyId, active: true })
          .orderBy('position', 'asc')
          .orderBy('id', 'asc'),
      ]);

      const taskIds = tasks.map((task) => task.id);
      const dependencies =
        taskIds.length > 0
          ? await ProjectTaskDependency.query()
              .where({ company_id: ctx.companyId, active: true })
              .whereIn('task_id', taskIds)
              .orderBy('id', 'asc')
          : [];

      const dag = buildProjectDependencyGraph(tasks, dependencies);
      return {
        success: true,
        data: {
          project,
          stages,
          milestones,
          tasks,
          dependencies,
          dag,
        },
      };
    });

    app.post<{ Params: IdParams }>(`${prefix}/projects/:id/todo-sync`, async (req, reply) => {
      const ctx = await requireCompanyContext(req, reply, options);
      if (!ctx) return;
      if (
        !canAccess?.(ctx.role, ProjectTask.modelName, 'create', req.auth?.groupPermissions) ||
        !canAccess?.(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)
      ) {
        return reply.code(403).send({ success: false, error: 'Project task sync access denied' });
      }
      const projectId = parsePositiveIntId(req.params.id);
      if (!projectId) {
        return reply.code(400).send({ success: false, error: 'Invalid project ID' });
      }

      const project = await Project.query().findOne({
        id: projectId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!project) {
        return reply.code(404).send({ success: false, error: 'Project not found' });
      }

      const body = (isRecord(req.body) ? req.body : {}) as TodoSyncBody;
      let defaultStage =
        typeof body.default_stage_id === 'number' && Number.isSafeInteger(body.default_stage_id)
          ? await ProjectStage.query().findOne({
              id: body.default_stage_id,
              company_id: ctx.companyId,
              active: true,
            })
          : undefined;
      if (!defaultStage) {
        defaultStage = await ProjectStage.query()
          .where({ company_id: ctx.companyId, active: true })
          .andWhere((qb) => qb.where({ project_id: projectId }).orWhereNull('project_id'))
          .orderBy('is_closed', 'asc')
          .orderBy('sequence', 'asc')
          .orderBy('id', 'asc')
          .first();
      }
      if (!defaultStage) {
        return reply.code(400).send({ success: false, error: 'No active project stage available' });
      }

      const incomingTasks = Array.isArray(body.tasks) ? body.tasks : [];
      let imported = 0;
      let updated = 0;

      for (const rawItem of incomingTasks) {
        if (
          !isRecord(rawItem) ||
          typeof rawItem.code !== 'string' ||
          typeof rawItem.title !== 'string'
        ) {
          return reply.code(400).send({
            success: false,
            error: 'Each TaskOS snapshot requires string code and title fields',
          });
        }
        let mapped: ReturnType<typeof mapTodoTaskToProjectTaskFields>;
        try {
          mapped = mapTodoTaskToProjectTaskFields({
            code: rawItem.code,
            title: rawItem.title,
            summary: typeof rawItem.summary === 'string' ? rawItem.summary : undefined,
            priority: typeof rawItem.priority === 'string' ? rawItem.priority : undefined,
            status: typeof rawItem.status === 'string' ? rawItem.status : undefined,
            blocked_reason:
              typeof rawItem.blocked_reason === 'string' ? rawItem.blocked_reason : undefined,
            due_date: typeof rawItem.due_date === 'string' ? rawItem.due_date : undefined,
          });
        } catch (err) {
          return reply.code(400).send({
            success: false,
            error: err instanceof Error ? err.message : 'Invalid TaskOS snapshot payload',
          });
        }

        const existing = await ProjectTask.query()
          .where({ company_id: ctx.companyId, project_id: projectId, active: true })
          .andWhere((qb) => qb.where({ code: mapped.code }).orWhere({ external_ref: mapped.code }))
          .first();

        if (existing) {
          await ProjectTask.query()
            .findById(existing.id)
            .patch({
              title: mapped.title,
              description: mapped.description ?? existing.description,
              priority: mapped.priority,
              status: mapped.status,
              blocked_reason: mapped.blocked_reason ?? existing.blocked_reason,
              due_date: mapped.due_date ?? existing.due_date,
              external_ref: mapped.external_ref,
            });
          updated += 1;
        } else {
          await ProjectTask.query().insert({
            company_id: ctx.companyId,
            project_id: projectId,
            stage_id: defaultStage.id,
            code: mapped.code,
            external_ref: mapped.external_ref,
            title: mapped.title,
            description: mapped.description ?? null,
            priority: mapped.priority,
            status: mapped.status,
            blocked_reason: mapped.blocked_reason ?? null,
            due_date: mapped.due_date ?? null,
          });
          imported += 1;
        }
      }

      const currentTasks = await ProjectTask.query()
        .where({ project_id: projectId, company_id: ctx.companyId, active: true })
        .orderBy('position', 'asc')
        .orderBy('id', 'asc');
      const snapshots = currentTasks.map((task) => mapProjectTaskToTodoSnapshot(task));

      return {
        success: true,
        data: {
          project_id: projectId,
          imported,
          updated,
          snapshots,
        },
      };
    });

    app.post<{ Params: IdParams }>(
      `${prefix}/projects/:id/plan-sync`,
      async (req, reply) => {
        const ctx = await requireCompanyContext(req, reply, options);
        if (!ctx) return;
        if (
          !canAccess?.(ctx.role, ProjectTask.modelName, 'create', req.auth?.groupPermissions) ||
          !canAccess?.(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)
        ) {
          return reply.code(403).send({ success: false, error: 'Plan sync access denied' });
        }
        const projectId = parsePositiveIntId(req.params.id);
        if (!projectId) {
          return reply.code(400).send({ success: false, error: 'Invalid project ID' });
        }

        const project = await Project.query().findOne({
          id: projectId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!project) {
          return reply.code(404).send({ success: false, error: 'Project not found' });
        }

        let payload;
        try {
          payload = parsePlanSyncPayload(req.body);
        } catch (err) {
          return reply.code(400).send({
            success: false,
            error: err instanceof Error ? err.message : 'Invalid plan sync payload',
          });
        }

        const defaultStage = await ProjectStage.query()
          .where({ company_id: ctx.companyId, active: true })
          .andWhere((qb) => qb.where({ project_id: projectId }).orWhereNull('project_id'))
          .orderBy('is_closed', 'asc')
          .orderBy('sequence', 'asc')
          .orderBy('id', 'asc')
          .first();
        if (!defaultStage) {
          return reply.code(400).send({ success: false, error: 'No active project stage available' });
        }

        const milestoneIdByCode = new Map<string, number>();
        const taskIdByCode = new Map<string, number>();
        const counters: { -readonly [K in keyof PlanSyncResult]: PlanSyncResult[K] } = {
          milestonesImported: 0,
          milestonesUpdated: 0,
          tasksImported: 0,
          tasksUpdated: 0,
          dependenciesImported: 0,
          codeByRaw: {},
        };

        try {
          await ProjectTask.transaction(async (trx) => {
            // 1. Upsert milestones per Wave (open / reached / missed).
            for (const wave of payload.waves) {
              const code = toOrmMilestoneCode(wave.code);
              const existing = await ProjectMilestone.query(trx).findOne({
                company_id: ctx.companyId,
                project_id: projectId,
                code,
                active: true,
              });
              const status = normalizeMilestoneStatus(wave.status);
              if (existing) {
                await ProjectMilestone.query(trx)
                  .findById(existing.id)
                  .patch({
                    name: wave.name,
                    status,
                    ...(wave.due_date ? { due_date: wave.due_date } : {}),
                  });
                counters.milestonesUpdated += 1;
                milestoneIdByCode.set(code, existing.id);
              } else {
                const created = await ProjectMilestone.query(trx).insertAndFetch({
                  company_id: ctx.companyId,
                  project_id: projectId,
                  code,
                  name: wave.name,
                  status,
                  ...(wave.due_date ? { due_date: wave.due_date } : {}),
                });
                counters.milestonesImported += 1;
                milestoneIdByCode.set(code, created.id);
              }
            }

            // 2. Upsert tasks parent-first (topological insert order).
            const migration = buildPlanSyncMigration(payload);
            for (const item of migration) {
              const milestoneId = item.milestoneCode
                ? (milestoneIdByCode.get(item.milestoneCode) ?? null)
                : null;
              const parentId = item.parentCode
                ? (taskIdByCode.get(item.parentCode) ?? null)
                : null;
              const existing = await ProjectTask.query(trx)
                .where({ company_id: ctx.companyId, project_id: projectId, active: true })
                .andWhere((qb) =>
                  qb.where({ code: item.code }).orWhere({ external_ref: item.externalRef })
                )
                .first();

              // Human-owned stage_id / assignee_id / reviewer_id are never patched.
              if (existing) {
                const changed = hasPlanSyncTaskDelta(existing, item, milestoneId, parentId);
                if (changed) {
                  await ProjectTask.query(trx).findById(existing.id).patch({
                    title: item.title,
                    description: item.description ?? existing.description,
                    priority: item.priority,
                    status: item.status,
                    blocked_reason: item.blockedReason ?? existing.blocked_reason,
                    estimate_minutes: item.estimateMinutes ?? existing.estimate_minutes,
                    milestone_id: milestoneId,
                    parent_id: parentId,
                    external_ref: item.externalRef,
                  });
                }
                counters.tasksUpdated += 1;
                taskIdByCode.set(item.code, existing.id);
              } else {
                const created = await ProjectTask.query(trx).insertAndFetch({
                  company_id: ctx.companyId,
                  project_id: projectId,
                  stage_id: defaultStage.id,
                  code: item.code,
                  external_ref: item.externalRef,
                  title: item.title,
                  description: item.description ?? null,
                  priority: item.priority,
                  status: item.status,
                  blocked_reason: item.blockedReason ?? null,
                  estimate_minutes: item.estimateMinutes ?? null,
                  milestone_id: milestoneId,
                  parent_id: parentId,
                });
                counters.tasksImported += 1;
                taskIdByCode.set(item.code, created.id);
              }
            }

            // 3. Upsert acyclic dependency edges (kind: 'blocks').
            for (const item of migration) {
              const taskId = taskIdByCode.get(item.code);
              if (!taskId) continue;
              for (const depCode of item.dependsOn) {
                const dependsOnId = taskIdByCode.get(depCode);
                if (!dependsOnId || dependsOnId === taskId) continue;
                const existingEdge = await ProjectTaskDependency.query(trx).findOne({
                  company_id: ctx.companyId,
                  task_id: taskId,
                  depends_on_id: dependsOnId,
                  active: true,
                });
                if (!existingEdge) {
                  await ProjectTaskDependency.query(trx).insert({
                    company_id: ctx.companyId,
                    task_id: taskId,
                    depends_on_id: dependsOnId,
                    kind: 'blocks',
                  });
                  counters.dependenciesImported += 1;
                }
              }
            }
          });
        } catch (err) {
          return reply.code(409).send({
            success: false,
            error: err instanceof Error ? err.message : 'Plan sync transaction failed',
          });
        }

        return {
          success: true,
          data: {
            project_id: projectId,
            ...counters,
          },
        };
      }
    );

    app.post<{ Params: IdParams }>(
      `${prefix}/projects/tasks/:id/work-contract`,
      async (req, reply) => {
        const ctx = await requireCompanyContext(req, reply, options);
        if (!ctx) return;
        if (!canAccess?.(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)) {
          return reply.code(403).send({ success: false, error: 'WorkContract dispatch denied' });
        }
        const taskId = parsePositiveIntId(req.params.id);
        if (!taskId) {
          return reply.code(400).send({ success: false, error: 'Invalid project task ID' });
        }

        const WorkContract = resolveDynamicModel('ai.work_contract');
        const AcceptanceCriterion = resolveDynamicModel('ai.acceptance_criterion');
        const ExecutionPolicy = resolveDynamicModel('ai.execution_policy');
        if (!WorkContract || !AcceptanceCriterion || !ExecutionPolicy) {
          return reply.code(503).send({
            success: false,
            error: 'AI work contract addon is not installed',
          });
        }

        const task = await ProjectTask.query().findOne({
          id: taskId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!task) {
          return reply.code(404).send({ success: false, error: 'Project task not found' });
        }

        const sourceRef = toWorkContractSource(task.id);
        const existing = await WorkContract.query()
          .findOne({
            company_id: ctx.companyId,
            source_model: sourceRef.source_model,
            source_id: sourceRef.source_id,
            active: true,
          })
          .withGraphFetched('criteria');
        if (existing) {
          return reply.code(200).send({ success: true, data: existing, created: false });
        }

        const body = isRecord(req.body) ? req.body : {};
        const rawOwnerFiles = Array.isArray(body.owner_files)
          ? body.owner_files.filter((f): f is string => typeof f === 'string' && f.length > 0)
          : [];
        const riskOrder: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

        type TransactionOutcome =
          | {
              readonly kind: 'error';
              readonly status: 400 | 404 | 409;
              readonly body: Record<string, unknown>;
            }
          | { readonly kind: 'existing'; readonly data: DynamicModelRecord | undefined }
          | {
              readonly kind: 'created';
              readonly data: DynamicModelRecord | undefined;
              readonly contractId: number;
              readonly contractCode: string;
            };

        const outcome: TransactionOutcome = await ProjectTask.transaction(async (trx) => {
          const freshTask = await ProjectTask.query(trx).findOne({
            id: taskId,
            company_id: ctx.companyId,
            active: true,
          });
          if (!freshTask) {
            return {
              kind: 'error',
              status: 404,
              body: { success: false, error: 'Project task not found' },
            };
          }

          const existingInTrx = await WorkContract.query(trx)
            .findOne({
              company_id: ctx.companyId,
              source_model: sourceRef.source_model,
              source_id: sourceRef.source_id,
              active: true,
            })
            .withGraphFetched('criteria');
          if (existingInTrx) {
            return { kind: 'existing', data: existingInTrx };
          }

          // M13.05: Reuse canonical buildProjectDependencyGraph within company scope before inserting.
          const projectTasks = await ProjectTask.query(trx)
            .where({ project_id: freshTask.project_id, company_id: ctx.companyId, active: true })
            .orderBy('id', 'asc');
          const projectTaskIds = projectTasks.map((item) => item.id);
          const projectDependencies =
            projectTaskIds.length > 0
              ? await ProjectTaskDependency.query(trx)
                  .where({ company_id: ctx.companyId, active: true })
                  .whereIn('task_id', projectTaskIds)
                  .orderBy('id', 'asc')
              : [];

          const knownTaskIdSet = new Set(projectTaskIds);
          const externalBlockerIds = [
            ...new Set(
              projectDependencies
                .filter((dep) => dep.kind === 'blocks' && !knownTaskIdSet.has(dep.depends_on_id))
                .map((dep) => dep.depends_on_id)
            ),
          ];
          const externalBlockers =
            externalBlockerIds.length > 0
              ? await ProjectTask.query(trx)
                  .where({ company_id: ctx.companyId, active: true })
                  .whereIn('id', externalBlockerIds)
              : [];

          const scopedTasks = [...projectTasks, ...externalBlockers];
          const dag = buildProjectDependencyGraph(scopedTasks, projectDependencies);
          const taskNode = dag.nodes.find((node) => node.id === freshTask.id);
          if (!taskNode || !taskNode.is_ready) {
            const byId = new Map(scopedTasks.map((item) => [item.id, item]));
            const blockers = (taskNode?.blocked_by_ids ?? [])
              .map((blockerId) => byId.get(blockerId))
              .filter((blocker): blocker is NonNullable<typeof blocker> => blocker !== undefined)
              .map((blocker) => ({
                id: blocker.id,
                code: blocker.code,
                title: blocker.title,
                status: blocker.status,
              }));
            const error =
              freshTask.status === 'blocked' ||
              freshTask.status === 'done' ||
              freshTask.status === 'cancelled'
                ? `Task ${freshTask.code} is in status "${freshTask.status}" and is not ready for a new WorkContract`
                : `Task ${freshTask.code} is blocked by incomplete dependencies`;
            return {
              kind: 'error',
              status: 409,
              body: {
                success: false,
                code: 'TASK_NOT_READY',
                error,
                task_status: freshTask.status,
                blockers,
              },
            };
          }

          const policy = await ensureDefaultExecutionPolicy(ExecutionPolicy, ctx.companyId, trx);
          const desiredTier: RiskTier =
            freshTask.priority === 'urgent' ? 'R2' : freshTask.priority === 'high' ? 'R1' : 'R0';
          const maxPolicyTier = (policy.max_risk_tier as RiskTier | undefined) ?? 'R0';
          const riskTier: RiskTier =
            typeof body.risk_tier === 'string' && body.risk_tier in riskOrder
              ? (body.risk_tier as RiskTier)
              : riskOrder[desiredTier] <= riskOrder[maxPolicyTier]
                ? desiredTier
                : maxPolicyTier;
          const mutation: Record<string, unknown> = {
            company_id: ctx.companyId,
            code: normalizeSlugCode(`wc_${freshTask.code}`, `wc_task_${freshTask.id}`),
            title: freshTask.title,
            objective: freshTask.description?.trim() || freshTask.title,
            scope_json: JSON.stringify({
              project_id: freshTask.project_id,
              task_id: freshTask.id,
              task_code: freshTask.code,
              external_ref: freshTask.external_ref ?? null,
              ...(rawOwnerFiles.length > 0 ? { owner_files: rawOwnerFiles } : {}),
            }),
            constraints_json: '{}',
            non_goals_json: '[]',
            expected_deliverables_json: JSON.stringify([freshTask.title]),
            source_model: sourceRef.source_model,
            source_id: sourceRef.source_id,
            execution_policy_id: policy.id,
            requested_by_id: ctx.userId,
            risk_tier: riskTier,
            data_classification: 'local_only' as const,
            status: 'draft' as const,
            ...(typeof body.assigned_agent_id === 'number'
              ? { assigned_agent_id: body.assigned_agent_id }
              : {}),
          };

          if (
            options.validateModelMutation &&
            !(await options.validateModelMutation('ai.work_contract', mutation, trx))
          ) {
            return {
              kind: 'error',
              status: 400,
              body: {
                success: false,
                error: 'Invalid work contract payload for project task',
              },
            };
          }

          const contract = await WorkContract.query(trx).insertAndFetch(mutation);

          // T37: hydrate 1 ai.acceptance_criterion row per binary AC when the
          // caller supplies them (Plan-TaskOS tasks carry acceptance_criteria).
          // Fall back to the legacy single `task_completion` row so existing
          // work-contract callers remain 100% compatible.
          interface HydratedCriterion {
            readonly code: string;
            readonly title: string;
            readonly verification_method: string;
            readonly required_evidence_type: string;
            readonly mandatory: boolean;
            readonly version: number;
            readonly status: string;
          }
          const rawCriteria = Array.isArray(body.acceptance_criteria)
            ? body.acceptance_criteria
            : [];
          const criteria: HydratedCriterion[] = rawCriteria.length > 0
            ? rawCriteria.flatMap((raw, index) => {
                const entry: Record<string, unknown> = isRecord(raw) ? raw : { text: raw };
                const text = typeof entry.text === 'string' && entry.text.trim()
                  ? entry.text.trim()
                  : null;
                if (!text) return [];
                return [{
                  code: `ac_${index + 1}`,
                  title: text.slice(0, 255),
                  verification_method:
                    typeof entry.verification_method === 'string'
                      ? entry.verification_method
                      : 'automated_test',
                  required_evidence_type:
                    typeof entry.required_evidence_type === 'string'
                      ? entry.required_evidence_type
                      : 'evidence_bundle',
                  mandatory: entry.mandatory !== false,
                  version: 1,
                  status: entry.done === true ? 'accepted' : 'pending',
                }];
              })
            : [];
          const hydrated: readonly HydratedCriterion[] = criteria.length > 0
            ? criteria
            : [{
                code: 'task_completion',
                title: `Verify ${freshTask.code} completion`,
                verification_method: 'automated_test',
                required_evidence_type: 'evidence_bundle',
                mandatory: true,
                version: 1,
                status: 'pending',
              }];
          for (const [index, criterion] of hydrated.entries()) {
            await AcceptanceCriterion.query(trx).insert({
              company_id: ctx.companyId,
              work_contract_id: contract.id,
              sequence: index + 1,
              ...criterion,
            });
          }

          const loaded = await WorkContract.query(trx)
            .findById(contract.id)
            .withGraphFetched('criteria');
          return {
            kind: 'created',
            data: loaded,
            contractId: contract.id,
            contractCode: String(contract.code ?? mutation.code),
          };
        });

        if (outcome.kind === 'error') {
          return reply.code(outcome.status).send(outcome.body);
        }
        if (outcome.kind === 'existing') {
          return reply.code(200).send({ success: true, data: outcome.data, created: false });
        }

        await recordAudit(ctx.userId, 'ai.work_contract', outcome.contractId, 'create', {
          code: outcome.contractCode,
          source_model: sourceRef.source_model,
          source_id: sourceRef.source_id,
        });

        return reply.code(201).send({ success: true, data: outcome.data, created: true });
      }
    );

    app.post<{ Params: IdParams }>(
      `${prefix}/projects/tasks/:id/work-contract/sync-stage`,
      async (req, reply) => {
        const ctx = await requireCompanyContext(req, reply, options);
        if (!ctx) return;
        if (!canAccess?.(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)) {
          return reply.code(403).send({ success: false, error: 'Project task stage sync denied' });
        }
        const taskId = parsePositiveIntId(req.params.id);
        if (!taskId) {
          return reply.code(400).send({ success: false, error: 'Invalid project task ID' });
        }

        const WorkContract = resolveDynamicModel('ai.work_contract');
        if (!WorkContract) {
          return reply.code(503).send({
            success: false,
            error: 'AI work contract addon is not installed',
          });
        }

        const task = await ProjectTask.query().findOne({
          id: taskId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!task) {
          return reply.code(404).send({ success: false, error: 'Project task not found' });
        }

        const sourceRef = toWorkContractSource(task.id);
        const contract = await WorkContract.query().findOne({
          company_id: ctx.companyId,
          source_model: sourceRef.source_model,
          source_id: sourceRef.source_id,
          active: true,
        });
        if (!contract) {
          return reply.code(404).send({
            success: false,
            error: 'No linked WorkContract found for this project task',
          });
        }

        const targetStatusMap: Record<
          string,
          { status: 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done'; stageCode: string }
        > = {
          draft: { status: 'backlog', stageCode: 'backlog' },
          queued: { status: 'in_progress', stageCode: 'in_progress' },
          running: { status: 'in_progress', stageCode: 'in_progress' },
          in_review: { status: 'review', stageCode: 'review' },
          accepted: { status: 'done', stageCode: 'done' },
          rejected: { status: 'blocked', stageCode: 'in_progress' },
          failed: { status: 'blocked', stageCode: 'in_progress' },
        };
        const target = targetStatusMap[String(contract.status)];
        if (!target) {
          return { success: true, data: { task, work_contract: contract, advanced: false } };
        }

        const targetStage = await ProjectStage.query()
          .where({ company_id: ctx.companyId, code: target.stageCode, active: true })
          .andWhere((qb) => qb.where({ project_id: task.project_id }).orWhereNull('project_id'))
          .orderBy('project_id', 'desc')
          .first();

        const nextStageId = targetStage?.id ?? task.stage_id;
        const advanced = task.status !== target.status || task.stage_id !== nextStageId;
        const updatedTask = advanced
          ? await ProjectTask.query().patchAndFetchById(task.id, {
              status: target.status,
              stage_id: nextStageId,
            })
          : task;

        return {
          success: true,
          data: {
            task: updatedTask,
            work_contract: contract,
            advanced,
          },
        };
      }
    );
  }
};
