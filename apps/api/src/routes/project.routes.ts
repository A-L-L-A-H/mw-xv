import type { FastifyPluginAsync } from 'fastify';
import {
  AcceptanceCriterion,
  isValidAiMutation,
  WorkContract,
  type RiskTier,
} from '@moonwitness/orm-ai';
import {
  buildProjectDependencyGraph,
  mapProjectTaskToTodoSnapshot,
  mapTodoTaskToProjectTaskFields,
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
  toWorkContractSource,
  type LocalTodoTaskSnapshot,
} from '@moonwitness/orm-project';
import { isRecord } from '@moonwitness/types';
import { canAccess } from '../auth/policy.js';
import {
  ensureDefaultExecutionPolicy,
  normalizeSlugCode,
  recordAiAudit,
  requireAiCompanyContext,
} from '../ai-corporation/route-helpers.js';

interface TodoSyncBody {
  readonly default_stage_id?: number;
  readonly tasks?: readonly LocalTodoTaskSnapshot[];
}

function parsePositiveIntId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const projectRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>('/projects/:id/board', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    if (!canAccess(ctx.role, ProjectTask.modelName, 'read', req.auth?.groupPermissions)) {
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

  fastify.post<{ Params: { id: string } }>('/projects/:id/todo-sync', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    if (
      !canAccess(ctx.role, ProjectTask.modelName, 'create', req.auth?.groupPermissions) ||
      !canAccess(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)
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

  fastify.post<{ Params: { id: string } }>(
    '/projects/tasks/:id/work-contract',
    async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      if (!canAccess(ctx.role, ProjectTask.modelName, 'write', req.auth?.groupPermissions)) {
        return reply.code(403).send({ success: false, error: 'WorkContract dispatch denied' });
      }
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) {
        return reply.code(400).send({ success: false, error: 'Invalid project task ID' });
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

      const policy = await ensureDefaultExecutionPolicy(ctx.companyId);
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
      const mutation = {
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

      if (!(await isValidAiMutation(WorkContract.modelName, mutation))) {
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

      const loaded = await WorkContract.query().findById(contract.id).withGraphFetched('criteria');
      await recordAiAudit(ctx.userId, WorkContract.modelName, contract.id, 'create', {
        code: contract.code,
        source_model: sourceRef.source_model,
        source_id: sourceRef.source_id,
      });

      return reply.code(201).send({ success: true, data: loaded, created: true });
    }
  );
};

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(projectRoutesPlugin);
  await fastify.register(projectRoutesPlugin, { prefix: '/api' });
};
