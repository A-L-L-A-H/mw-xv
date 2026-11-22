import { randomUUID } from 'node:crypto';
import {
  Registry,
  type AddonHttpHostContext,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
} from '@moonwitness/orm';
import { AuditLog, Company, CompanyMembership } from '@moonwitness/orm-base';
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
  query(): DynamicModelQuery;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  companyId: number
): Promise<DynamicModelRecord> {
  const existing = await ExecutionPolicy.query()
    .where({ company_id: companyId, active: true })
    .orderBy('id', 'asc')
    .first();
  if (existing) return existing;
  return ExecutionPolicy.query().insertAndFetch({
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

        // M13.06 Task Deck Blocker Gate: block dispatch if any active 'blocks' dependency is incomplete.
        const blockingDeps = await ProjectTaskDependency.query()
          .where({
            company_id: ctx.companyId,
            task_id: task.id,
            kind: 'blocks',
            active: true,
          })
          .orderBy('id', 'asc');
        if (blockingDeps.length > 0) {
          const blockerIds = [...new Set(blockingDeps.map((dep) => dep.depends_on_id))];
          const blockerTasks = await ProjectTask.query()
            .where({ company_id: ctx.companyId, active: true })
            .whereIn('id', blockerIds);
          const blockerById = new Map(blockerTasks.map((t) => [t.id, t]));
          const incompleteBlockers: Array<{
            id: number;
            code: string;
            title: string;
            status: string;
          }> = [];
          for (const dep of blockingDeps) {
            const blocker = blockerById.get(dep.depends_on_id);
            if (!blocker) {
              incompleteBlockers.push({
                id: dep.depends_on_id,
                code: `TASK-${dep.depends_on_id}`,
                title: 'Missing or inactive dependency',
                status: 'missing',
              });
            } else if (blocker.status !== 'done' && blocker.status !== 'cancelled') {
              incompleteBlockers.push({
                id: blocker.id,
                code: blocker.code,
                title: blocker.title,
                status: blocker.status,
              });
            }
          }
          if (incompleteBlockers.length > 0) {
            return reply.code(409).send({
              success: false,
              error: `Task ${task.code} is blocked by incomplete dependencies`,
              blockers: incompleteBlockers,
            });
          }
        }

        const policy = await ensureDefaultExecutionPolicy(ExecutionPolicy, ctx.companyId);
        const body = isRecord(req.body) ? req.body : {};
        const riskOrder: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };
        const desiredTier: RiskTier =
          task.priority === 'urgent' ? 'R2' : task.priority === 'high' ? 'R1' : 'R0';
        const maxPolicyTier = (policy.max_risk_tier as RiskTier | undefined) ?? 'R0';
        const riskTier: RiskTier =
          typeof body.risk_tier === 'string' && body.risk_tier in riskOrder
            ? (body.risk_tier as RiskTier)
            : riskOrder[desiredTier] <= riskOrder[maxPolicyTier]
              ? desiredTier
              : maxPolicyTier;
        const mutation: Record<string, unknown> = {
          company_id: ctx.companyId,
          code: normalizeSlugCode(`wc_${task.code}`, `wc_task_${task.id}`),
          title: task.title,
          objective: task.description?.trim() || task.title,
          scope_json: JSON.stringify({
            project_id: task.project_id,
            task_id: task.id,
            task_code: task.code,
            external_ref: task.external_ref ?? null,
          }),
          constraints_json: '{}',
          non_goals_json: '[]',
          expected_deliverables_json: JSON.stringify([task.title]),
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
          !(await options.validateModelMutation('ai.work_contract', mutation))
        ) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid work contract payload for project task',
          });
        }

        const contract = await WorkContract.query().insertAndFetch(mutation);
        await AcceptanceCriterion.query().insert({
          company_id: ctx.companyId,
          work_contract_id: contract.id,
          sequence: 1,
          code: 'task_completion',
          title: `Verify ${task.code} completion`,
          verification_method: 'automated_test',
          required_evidence_type: 'evidence_bundle',
          mandatory: true,
          version: 1,
          status: 'pending',
        });

        const loaded = await WorkContract.query()
          .findById(contract.id)
          .withGraphFetched('criteria');
        await recordAudit(ctx.userId, 'ai.work_contract', contract.id, 'create', {
          code: contract.code,
          source_model: sourceRef.source_model,
          source_id: sourceRef.source_id,
        });

        return reply.code(201).send({ success: true, data: loaded, created: true });
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
