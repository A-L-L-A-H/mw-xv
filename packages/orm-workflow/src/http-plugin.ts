import {
  Registry,
  applyDomain,
  type AddonHttpHostContext,
  type AddonHttpPlugin,
  type AddonHttpRequestBase,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  listAvailableWorkflowDefinitions,
  startWorkflow,
  transitionWorkflow,
  WorkflowError,
  type WorkflowRole,
} from './runtime.js';
import {
  evaluateApprovalQuorum,
  validateSagaDag,
  planSagaCompensation,
  type ApprovalQuorumPolicy,
  type ApprovalVote,
  type SagaStepDefinition,
} from './saga-engine.js';

interface StartBody {
  code: string;
  resource_model: string;
  resource_id: number;
  idempotency_key: string;
}

interface TransitionBody {
  action: string;
  expected_revision: number;
  idempotency_key: string;
  comment?: string;
}

interface IdParams {
  [key: string]: string;
  id: string;
}

interface WorkflowListQuery {
  [key: string]: string | undefined;
  limit?: string;
  resource_model?: string;
  resource_id?: string;
}

function parseStart(value: unknown): StartBody | null {
  const body = isRecord(value) ? value : null;
  if (
    !body ||
    Object.keys(body).some(
      (key) => !['code', 'resource_model', 'resource_id', 'idempotency_key'].includes(key)
    ) ||
    typeof body.code !== 'string' ||
    typeof body.resource_model !== 'string' ||
    !Number.isSafeInteger(body.resource_id) ||
    Number(body.resource_id) < 1 ||
    typeof body.idempotency_key !== 'string'
  )
    return null;
  return {
    code: body.code,
    resource_model: body.resource_model,
    resource_id: Number(body.resource_id),
    idempotency_key: body.idempotency_key,
  };
}

function parseTransition(value: unknown): TransitionBody | null {
  const body = isRecord(value) ? value : null;
  if (
    !body ||
    Object.keys(body).some(
      (key) => !['action', 'expected_revision', 'idempotency_key', 'comment'].includes(key)
    ) ||
    typeof body.action !== 'string' ||
    !Number.isSafeInteger(body.expected_revision) ||
    Number(body.expected_revision) < 0 ||
    typeof body.idempotency_key !== 'string' ||
    (body.comment !== undefined && typeof body.comment !== 'string') ||
    (typeof body.comment === 'string' && body.comment.length > 2000)
  )
    return null;
  return {
    action: body.action,
    expected_revision: Number(body.expected_revision),
    idempotency_key: body.idempotency_key,
    ...(typeof body.comment === 'string' ? { comment: body.comment } : {}),
  };
}

function isWorkflowRole(role: string | undefined): role is WorkflowRole {
  return role === 'system' || role === 'superadmin' || role === 'user';
}

function workflowFailure(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof WorkflowError)) return null;
  const status =
    error.code === 'FORBIDDEN'
      ? 403
      : error.code === 'INSTANCE_NOT_FOUND' || error.code === 'DEFINITION_NOT_FOUND'
        ? 404
        : error.code === 'STALE_REVISION' ||
            error.code === 'DUPLICATE_APPROVAL' ||
            error.code === 'INSTANCE_CLOSED'
          ? 409
          : 400;
  return { status, message: error.message };
}

interface EnvQueryLike {
  where(clause: Record<string, unknown>): EnvQueryLike;
  first(): Promise<unknown>;
}

async function canReadResource(
  req: AddonHttpRequestBase,
  options: AddonHttpHostContext,
  resourceModel: string,
  resourceId: number
): Promise<boolean> {
  const auth = req.auth;
  if (!auth?.companyId) return false;
  if (!options.canAccess || !options.getRecordRuleDomain || !req.env) return false;
  if (
    !Registry.has(resourceModel) ||
    !options.canAccess(auth.role, resourceModel, 'read', auth.groupPermissions)
  )
    return false;
  const Model = req.env.get(resourceModel);
  const fields = Model.fields;
  const hasCompany = Boolean(fields && ('company' in fields || 'company_id' in fields));
  const query = (req.env.get(resourceModel).query() as EnvQueryLike).where({
    id: resourceId,
    active: true,
  });
  if (hasCompany) query.where({ company_id: auth.companyId });
  const domain = await options.getRecordRuleDomain(req, resourceModel);
  const resource = await (applyDomain(query as never, domain) as unknown as EnvQueryLike).first();
  return resource !== undefined;
}

export const workflowHttpPlugin: AddonHttpPlugin = async (app, options) => {
  app.get<{ Querystring: WorkflowListQuery }>('/workflows/definitions', async (req, reply) => {
    if (!req.auth)
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    if (!req.auth.companyId)
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    if (!app.db || !options.canAccess)
      return reply.code(403).send({ success: false, error: 'Workflow access unavailable' });
    const resourceModel = req.query.resource_model;
    if (
      !resourceModel ||
      !Registry.has(resourceModel) ||
      !options.canAccess(req.auth.role, resourceModel, 'read', req.auth.groupPermissions)
    )
      return reply.code(404).send({ success: false, error: 'Resource not found' });
    const role = req.auth.role;
    if (!isWorkflowRole(role))
      return reply.code(403).send({ success: false, error: 'Unsupported workflow role' });
    const data = (await listAvailableWorkflowDefinitions(app.db, resourceModel, role)).filter(
      (definition) => definition.code !== 'research.review'
    );
    return { success: true, data };
  });

  app.get<{ Querystring: WorkflowListQuery }>('/workflows/instances', async (req, reply) => {
    if (!req.auth)
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    if (!req.auth.companyId)
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    if (!app.db)
      return reply.code(403).send({ success: false, error: 'Workflow database unavailable' });
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return reply.code(400).send({ success: false, error: 'limit must be between 1 and 100' });
    const { resource_model: resourceModel, resource_id: resourceIdValue } = req.query;
    if ((resourceModel === undefined) !== (resourceIdValue === undefined))
      return reply
        .code(400)
        .send({ success: false, error: 'resource_model and resource_id are required together' });
    if (resourceModel === undefined || resourceIdValue === undefined)
      return reply
        .code(400)
        .send({ success: false, error: 'resource_model and resource_id are required' });
    const resourceId = Number(resourceIdValue);
    if (
      !Number.isSafeInteger(resourceId) ||
      resourceId < 1 ||
      !(await canReadResource(req, options, resourceModel, resourceId))
    )
      return reply.code(404).send({ success: false, error: 'Resource not found' });
    const data = await app
      .db('workflow_instances')
      .leftJoin(
        'workflow_definitions',
        'workflow_definitions.id',
        'workflow_instances.definition_id'
      )
      .where({ 'workflow_instances.company_id': req.auth.companyId })
      .where({
        'workflow_instances.resource_model': resourceModel,
        'workflow_instances.resource_id': resourceId,
      })
      .whereNot('workflow_definitions.code', 'research.review')
      .orderBy('workflow_instances.create_date', 'desc')
      .limit(limit)
      .select(
        'workflow_instances.id',
        'workflow_definitions.code as definition_code',
        'workflow_instances.definition_id',
        'workflow_instances.definition_version',
        'workflow_instances.resource_model',
        'workflow_instances.resource_id',
        'workflow_instances.started_by_id',
        'workflow_instances.current_state',
        'workflow_instances.status',
        'workflow_instances.revision',
        'workflow_instances.due_at',
        'workflow_instances.completed_at',
        'workflow_instances.create_date'
      );
    return { success: true, data };
  });

  app.post<{ Body: unknown }>('/workflows/instances', async (req, reply) => {
    if (!req.auth)
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    if (!req.auth.companyId)
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    if (!app.db)
      return reply.code(403).send({ success: false, error: 'Workflow database unavailable' });
    const body = parseStart(req.body);
    if (!body)
      return reply.code(400).send({ success: false, error: 'Invalid workflow start request' });
    if (body.code === 'research.review')
      return reply.code(404).send({ success: false, error: 'Workflow not found' });
    if (!(await canReadResource(req, options, body.resource_model, body.resource_id)))
      return reply.code(404).send({ success: false, error: 'Resource not found' });
    const role = req.auth.role;
    if (!isWorkflowRole(role))
      return reply.code(403).send({ success: false, error: 'Unsupported workflow role' });
    try {
      const data = await startWorkflow(app.db, {
        code: body.code,
        companyId: req.auth.companyId,
        actorId: req.auth.userId,
        role,
        resourceModel: body.resource_model,
        resourceId: body.resource_id,
        idempotencyKey: body.idempotency_key,
      });
      return reply.code(201).send({ success: true, data });
    } catch (error) {
      const failure = workflowFailure(error);
      if (failure)
        return reply.code(failure.status).send({ success: false, error: failure.message });
      throw error;
    }
  });

  app.get<{ Params: IdParams }>('/workflows/instances/:id', async (req, reply) => {
    if (!req.auth)
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    if (!req.auth.companyId)
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    if (!app.db)
      return reply.code(403).send({ success: false, error: 'Workflow database unavailable' });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return reply.code(400).send({ success: false, error: 'Invalid workflow ID' });
    const data = await app
      .db('workflow_instances as instance')
      .leftJoin('workflow_definitions as definition', 'definition.id', 'instance.definition_id')
      .where({ 'instance.id': id, 'instance.company_id': req.auth.companyId })
      .first(
        'instance.id',
        'instance.definition_id',
        'instance.definition_version',
        'instance.resource_model',
        'instance.resource_id',
        'instance.started_by_id',
        'instance.current_state',
        'instance.status',
        'instance.revision',
        'instance.due_at',
        'instance.completed_at',
        'instance.create_date',
        'definition.code as definition_code'
      );
    if (!data || data.definition_code === 'research.review')
      return reply.code(404).send({ success: false, error: 'Workflow not found' });
    const publicData = { ...data };
    delete publicData.definition_code;
    if (!(await canReadResource(req, options, data.resource_model, data.resource_id)))
      return reply.code(404).send({ success: false, error: 'Workflow not found' });
    const [events, approvals] = await Promise.all([
      app
        .db('workflow_events')
        .where({ instance_id: id })
        .orderBy('sequence', 'asc')
        .select(
          'sequence',
          'actor_id',
          'action',
          'from_state',
          'to_state',
          'revision',
          'comment',
          'created_at'
        ),
      app
        .db('workflow_approvals')
        .where({ instance_id: id })
        .orderBy('decided_at', 'asc')
        .select('action', 'actor_id', 'decision', 'comment', 'decided_at'),
    ]);
    return { success: true, data: { ...publicData, events, approvals } };
  });

  app.post<{ Params: IdParams; Body: unknown }>(
    '/workflows/instances/:id/actions',
    async (req, reply) => {
      if (!req.auth)
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      if (!req.auth.companyId)
        return reply.code(403).send({ success: false, error: 'Active company is required' });
      if (!app.db)
        return reply.code(403).send({ success: false, error: 'Workflow database unavailable' });
      const id = Number(req.params.id);
      const body = parseTransition(req.body);
      if (!Number.isSafeInteger(id) || id < 1 || !body)
        return reply.code(400).send({ success: false, error: 'Invalid workflow action request' });
      const instance = await app
        .db('workflow_instances as instance')
        .leftJoin('workflow_definitions as definition', 'definition.id', 'instance.definition_id')
        .where({ 'instance.id': id, 'instance.company_id': req.auth.companyId })
        .first(
          'instance.resource_model',
          'instance.resource_id',
          'definition.code as definition_code'
        );
      if (
        !instance ||
        instance.definition_code === 'research.review' ||
        !(await canReadResource(req, options, instance.resource_model, instance.resource_id))
      )
        return reply.code(404).send({ success: false, error: 'Workflow not found' });
      const role = req.auth.role;
      if (!isWorkflowRole(role))
        return reply.code(403).send({ success: false, error: 'Unsupported workflow role' });
      try {
        const data = await transitionWorkflow(app.db, {
          instanceId: id,
          companyId: req.auth.companyId,
          actorId: req.auth.userId,
          role,
          action: body.action,
          expectedRevision: body.expected_revision,
          idempotencyKey: body.idempotency_key,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
        });
        return { success: true, data };
      } catch (error) {
        const failure = workflowFailure(error);
        if (failure)
          return reply.code(failure.status).send({ success: false, error: failure.message });
        throw error;
      }
    }
  );

  app.post<{ Body: unknown }>('/api/workflow/saga/plan', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (!req.auth.companyId) {
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    }

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid saga plan payload' });
    }

    if (!Array.isArray(req.body.steps)) {
      return reply.code(400).send({ success: false, error: 'steps array is required' });
    }

    const steps: SagaStepDefinition<Record<string, unknown>, unknown>[] = [];
    for (const rawStep of req.body.steps) {
      if (!isRecord(rawStep) || typeof rawStep.id !== 'string' || !rawStep.id.trim()) {
        return reply
          .code(400)
          .send({ success: false, error: 'Each step must have a non-empty string id' });
      }
      if (rawStep.dependsOn !== undefined) {
        if (
          !Array.isArray(rawStep.dependsOn) ||
          !rawStep.dependsOn.every((dep) => typeof dep === 'string')
        ) {
          return reply
            .code(400)
            .send({ success: false, error: 'dependsOn must be an array of strings' });
        }
      }
      const hasCompensator = Boolean(rawStep.hasCompensator);
      steps.push({
        id: rawStep.id,
        ...(Array.isArray(rawStep.dependsOn) ? { dependsOn: rawStep.dependsOn } : {}),
        ...(typeof rawStep.idempotencyScope === 'string'
          ? { idempotencyScope: rawStep.idempotencyScope }
          : {}),
        execute: () => ({}),
        ...(hasCompensator ? { compensate: () => {} } : {}),
      });
    }

    try {
      const validated = validateSagaDag(steps);
      const compensationPlan = planSagaCompensation(
        validated.executionOrder.map((stepId) => ({ stepId, idempotencyKey: `mock:${stepId}` })),
        validated.stepsById
      );
      return reply.code(200).send({
        success: true,
        data: {
          executionOrder: validated.executionOrder,
          stepCount: validated.executionOrder.length,
          compensationPlan,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ success: false, error: errorMessage });
    }
  });

  app.post<{ Body: unknown }>('/api/workflow/quorum/evaluate', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (!req.auth.companyId) {
      return reply.code(403).send({ success: false, error: 'Active company is required' });
    }

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid quorum evaluation payload' });
    }

    if (!isRecord(req.body.policy)) {
      return reply.code(400).send({ success: false, error: 'policy object is required' });
    }
    if (!Array.isArray(req.body.votes)) {
      return reply.code(400).send({ success: false, error: 'votes array is required' });
    }

    const rawPolicy = req.body.policy;
    if (
      typeof rawPolicy.requiredApprovals !== 'number' ||
      !Array.isArray(rawPolicy.eligibleApproverIds) ||
      !rawPolicy.eligibleApproverIds.every((id) => typeof id === 'string') ||
      typeof rawPolicy.requesterId !== 'string'
    ) {
      return reply.code(400).send({ success: false, error: 'Invalid quorum policy fields' });
    }

    const policy: ApprovalQuorumPolicy = {
      requiredApprovals: rawPolicy.requiredApprovals,
      eligibleApproverIds: rawPolicy.eligibleApproverIds,
      requesterId: rawPolicy.requesterId,
      ...(typeof rawPolicy.allowSelfApproval === 'boolean'
        ? { allowSelfApproval: rawPolicy.allowSelfApproval }
        : {}),
      ...(Array.isArray(rawPolicy.requiredRoles) &&
      rawPolicy.requiredRoles.every((r) => typeof r === 'string')
        ? { requiredRoles: rawPolicy.requiredRoles }
        : {}),
      ...(typeof rawPolicy.enforceDistinctRoles === 'boolean'
        ? { enforceDistinctRoles: rawPolicy.enforceDistinctRoles }
        : {}),
      ...(typeof rawPolicy.rejectOnAnyRejection === 'boolean'
        ? { rejectOnAnyRejection: rawPolicy.rejectOnAnyRejection }
        : {}),
    };

    const votes: ApprovalVote[] = [];
    for (const rawVote of req.body.votes) {
      if (
        !isRecord(rawVote) ||
        typeof rawVote.approverId !== 'string' ||
        typeof rawVote.role !== 'string' ||
        !['approve', 'reject'].includes(String(rawVote.decision)) ||
        (typeof rawVote.decidedAt !== 'string' && !(rawVote.decidedAt instanceof Date))
      ) {
        return reply.code(400).send({ success: false, error: 'Invalid approval vote structure' });
      }
      votes.push({
        approverId: rawVote.approverId,
        role: rawVote.role,
        decision: rawVote.decision as 'approve' | 'reject',
        decidedAt: rawVote.decidedAt,
        ...(typeof rawVote.reason === 'string' ? { reason: rawVote.reason } : {}),
      });
    }

    const result = evaluateApprovalQuorum(policy, votes);
    return reply.code(200).send({ success: true, data: result });
  });
};
