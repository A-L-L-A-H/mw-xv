import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { cancelJob, enqueueJob, Job, registerJobHandler } from '@moonwitness/jobs';
import {
  AcceptanceCriterion,
  Agent,
  AgentProfile,
  AgentRun,
  ArtifactManifest,
  assertValidProviderSecretRef,
  CapabilityGrant,
  ExecutionPolicy,
  isActiveCapabilityGrant,
  isAllowedClassificationRoute,
  isValidAiMutation,
  MemoryCandidate,
  ModelProfile,
  Obligation,
  ProviderProfile,
  SkillVersion,
  Taskforce,
  WorkContract,
  WorkforceAssignment,
  type AgentRoleTemplate,
  type AgentStatus,
  type ArtifactKind,
  type DataClassification,
  type MemoryKind,
  type MemoryScopeKind,
  type ObligationStatus,
  type ObligationTrigger,
  type ProviderKind,
  type RiskTier,
  type VerificationMethod,
} from '@moonwitness/orm-ai';
import { AuditLog, Company, CompanyMembership } from '@moonwitness/orm-base';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import {
  startWorkflow,
  transitionWorkflow,
  WorkflowError,
  WorkflowInstance,
  type WorkflowRole,
} from '@moonwitness/orm-workflow';
import { isRecord } from '@moonwitness/types';

export interface AiCorporationRoutesOptions {
  readonly attachmentStorage: AttachmentStorage;
}

interface AiRunJobPayload {
  readonly agentRunId: number;
  readonly companyId: number;
}

let aiJobHandlersRegistered = false;

function parseAiRunJobPayload(raw: unknown): AiRunJobPayload {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (
    !isRecord(value) ||
    typeof value.agentRunId !== 'number' ||
    !Number.isSafeInteger(value.agentRunId) ||
    typeof value.companyId !== 'number' ||
    !Number.isSafeInteger(value.companyId)
  ) {
    throw new Error('Invalid AI agent run job payload');
  }
  return { agentRunId: value.agentRunId, companyId: value.companyId };
}

export function ensureAiJobHandlersRegistered(): void {
  if (aiJobHandlersRegistered) return;
  for (const handlerName of ['ai.agent_run.execute', 'ai.agent_run.inspect']) {
    try {
      registerJobHandler<AiRunJobPayload>({
        name: handlerName,
        version: 1,
        parse: parseAiRunJobPayload,
        async run(payload, context) {
          const run = await AgentRun.query().findOne({
            id: payload.agentRunId,
            company_id: payload.companyId,
          });
          if (!run) return { skipped: true };
          if (context.signal.aborted || run.status === 'cancelled') {
            await AgentRun.query()
              .findById(run.id)
              .patch({ status: 'cancelled', finished_at: new Date().toISOString() });
            return { status: 'cancelled' };
          }
          const agent = await Agent.query().findOne({
            id: run.agent_id,
            company_id: payload.companyId,
          });
          if (!agent || agent.is_emergency_stopped || agent.status !== 'active') {
            await AgentRun.query().findById(run.id).patch({
              status: 'cancelled',
              error_code: 'AGENT_HALTED',
              error_summary: 'Agent is not active or has been emergency-stopped',
              finished_at: new Date().toISOString(),
            });
            return { status: 'cancelled' };
          }
          const nowIso = new Date().toISOString();
          await AgentRun.query()
            .findById(run.id)
            .patch({
              status: 'completed',
              step_count: (run.step_count ?? 0) + 1,
              started_at: run.started_at ?? nowIso,
              finished_at: nowIso,
            });
          return { status: 'completed', agentRunId: run.id };
        },
      });
    } catch {
      // Handler was already registered in this process.
    }
  }
  aiJobHandlersRegistered = true;
}

export async function hasCompanyAccess(
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

export async function requireAiCompanyContext(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<{ userId: number; companyId: number; role: WorkflowRole } | null> {
  reply.header('Cache-Control', 'private, no-store');
  const auth = req.auth;
  if (!auth) {
    await reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    await reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  const role: WorkflowRole =
    auth.role === 'superadmin' || auth.role === 'system' ? auth.role : 'user';
  const allowed = await hasCompanyAccess(auth.userId, auth.companyId, role);
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

async function recordAiAudit(
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

async function ensureDefaultExecutionPolicy(companyId: number) {
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

async function ensureDefaultProviderAndModel(companyId: number) {
  let provider = await ProviderProfile.query()
    .where({ company_id: companyId, active: true })
    .orderBy('id', 'asc')
    .first();
  if (!provider) {
    provider = await ProviderProfile.query().insertAndFetch({
      company_id: companyId,
      code: 'mock_local_default',
      name: 'Local Deterministic Mock Provider',
      kind: 'mock',
      secret_ref: 'MW_AI_MOCK_UNUSED',
      data_classification: 'local_only',
      enabled: true,
    });
  }
  let model = await ModelProfile.query()
    .where({ company_id: companyId, provider_profile_id: provider.id, active: true })
    .orderBy('id', 'asc')
    .first();
  if (!model) {
    model = await ModelProfile.query().insertAndFetch({
      company_id: companyId,
      provider_profile_id: provider.id,
      code: 'mock_local_model_v1',
      name: 'Local Deterministic Model v1',
      model_id: 'mock-deterministic-v1',
      supports_tools: true,
      supports_structured_output: true,
      enabled: true,
    });
  }
  return { provider, model };
}

export const aiCorporationPlugin: FastifyPluginAsync<AiCorporationRoutesOptions> = async (
  fastify,
  options
) => {
  // ===========================================================================
  // 1. Agents (/api/ai/agents, /ai/agents)
  // ===========================================================================
  fastify.get('/agents', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;

    const [agents, profiles] = await Promise.all([
      Agent.query().where({ company_id: ctx.companyId, active: true }).orderBy('id', 'asc'),
      AgentProfile.query().where({ company_id: ctx.companyId, active: true }),
    ]);
    const profileByAgentId = new Map(profiles.map((p) => [p.agent_id, p]));
    const data = agents.map((agent) => {
      const profile = profileByAgentId.get(agent.id);
      return {
        ...agent.toJSON(),
        name: profile?.name ?? agent.code,
        display_name: profile?.name ?? agent.code,
        profile: profile ? profile.toJSON() : null,
        state_source: 'persisted',
      };
    });
    return { success: true, data };
  });

  fastify.get<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid agent ID' });
    }
    const agent = await Agent.query().findOne({ id, company_id: ctx.companyId, active: true });
    if (!agent) {
      return reply.code(404).send({ success: false, error: 'Agent not found' });
    }
    const profile = await AgentProfile.query().findOne({
      agent_id: agent.id,
      company_id: ctx.companyId,
    });
    return {
      success: true,
      data: {
        ...agent.toJSON(),
        name: profile?.name ?? agent.code,
        display_name: profile?.name ?? agent.code,
        profile: profile ? profile.toJSON() : null,
        state_source: 'persisted',
      },
    };
  });

  fastify.post('/agents', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const code = normalizeSlugCode(body.code ?? body.name, 'agent');
    const status = (typeof body.status === 'string' ? body.status : 'draft') as AgentStatus;
    const roleTemplate = (
      typeof body.role_template === 'string'
        ? body.role_template
        : typeof body.roleTemplate === 'string'
          ? body.roleTemplate
          : 'researcher'
    ) as AgentRoleTemplate;

    const mutation = {
      company_id: ctx.companyId,
      code,
      status,
      role_template: roleTemplate,
      is_emergency_stopped: Boolean(body.is_emergency_stopped ?? false),
      ...(typeof body.department_id === 'number' ? { department_id: body.department_id } : {}),
      ...(typeof body.team_id === 'number' ? { team_id: body.team_id } : {}),
      ...(typeof body.position_id === 'number' ? { position_id: body.position_id } : {}),
      ...(typeof body.service_user_id === 'number'
        ? { service_user_id: body.service_user_id }
        : {}),
      ...(typeof body.reports_to_agent_id === 'number'
        ? { reports_to_agent_id: body.reports_to_agent_id }
        : {}),
    };

    if (!(await isValidAiMutation(Agent.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid agent configuration or cross-company reference',
      });
    }

    const created = await Agent.query().insertAndFetch(mutation);
    const displayName =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : typeof body.display_name === 'string' && body.display_name.trim()
          ? body.display_name.trim()
          : created.code;

    const profile = await AgentProfile.query().insertAndFetch({
      company_id: ctx.companyId,
      agent_id: created.id,
      name: displayName,
      description: typeof body.description === 'string' ? body.description : undefined,
      default_capabilities_json:
        typeof body.default_capabilities_json === 'string' ? body.default_capabilities_json : '[]',
    });

    await recordAiAudit(ctx.userId, Agent.modelName, created.id, 'create', {
      code: created.code,
      status: created.status,
    });

    return reply.code(201).send({
      success: true,
      data: {
        ...created.toJSON(),
        name: profile.name,
        display_name: profile.name,
        profile: profile.toJSON(),
      },
    });
  });

  fastify.patch<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid agent ID' });
    }
    const existing = await Agent.query().findOne({ id, company_id: ctx.companyId, active: true });
    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Agent not found' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const patch: Record<string, unknown> = {};
    if (typeof body.status === 'string') {
      patch.status = body.status;
      if (body.status === 'retired' && !existing.retired_at) {
        patch.retired_at = new Date().toISOString();
      }
    }
    if (typeof body.is_emergency_stopped === 'boolean') {
      patch.is_emergency_stopped = body.is_emergency_stopped;
    }
    if (typeof body.role_template === 'string') {
      patch.role_template = body.role_template;
    }
    if (body.reports_to_agent_id !== undefined) {
      patch.reports_to_agent_id = body.reports_to_agent_id;
    }

    if (
      !(await isValidAiMutation(
        Agent.modelName,
        { ...patch, company_id: ctx.companyId },
        existing.toJSON() as Record<string, unknown>
      ))
    ) {
      return reply.code(400).send({ success: false, error: 'Invalid agent lifecycle update' });
    }

    const updated = await Agent.query().patchAndFetchById(existing.id, patch);
    await recordAiAudit(ctx.userId, Agent.modelName, existing.id, 'write', patch);
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 2. Capability Grants (/api/ai/grants)
  // ===========================================================================
  fastify.get('/grants', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const grants = await CapabilityGrant.query()
      .where({ company_id: ctx.companyId, active: true })
      .orderBy('id', 'desc');
    return { success: true, data: grants };
  });

  fastify.post('/grants', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const policy =
      typeof body.execution_policy_id === 'number'
        ? await ExecutionPolicy.query().findOne({
            id: body.execution_policy_id,
            company_id: ctx.companyId,
          })
        : await ensureDefaultExecutionPolicy(ctx.companyId);
    if (!policy) {
      return reply.code(404).send({ success: false, error: 'Execution policy not found' });
    }

    const issuedAt = typeof body.issued_at === 'string' ? body.issued_at : new Date().toISOString();
    const expiresAt =
      typeof body.expires_at === 'string'
        ? body.expires_at
        : new Date(Date.now() + 3600_000).toISOString();

    const mutation = {
      company_id: ctx.companyId,
      agent_id: Number(body.agent_id ?? body.agentId),
      ...(typeof body.work_contract_id === 'number'
        ? { work_contract_id: body.work_contract_id }
        : {}),
      execution_policy_id: policy.id,
      capability: String(body.capability ?? ''),
      scope_json: typeof body.scope_json === 'string' ? body.scope_json : '{}',
      policy_version: Number(body.policy_version ?? policy.policy_version),
      max_calls_per_run: Number(body.max_calls_per_run ?? 25),
      issued_by_id: ctx.userId,
      issued_at: issuedAt,
      expires_at: expiresAt,
      status: 'active' as const,
    };

    if (!(await isValidAiMutation(CapabilityGrant.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid capability grant or cross-company reference',
      });
    }

    const grant = await CapabilityGrant.query().insertAndFetch(mutation);
    await recordAiAudit(ctx.userId, CapabilityGrant.modelName, grant.id, 'create', {
      capability: grant.capability,
      agent_id: grant.agent_id,
    });
    return reply.code(201).send({ success: true, data: grant });
  });

  fastify.post<{ Params: { id: string } }>('/grants/:id/revoke', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid grant ID' });
    }
    const grant = await CapabilityGrant.query().findOne({
      id,
      company_id: ctx.companyId,
      active: true,
    });
    if (!grant) {
      return reply.code(404).send({ success: false, error: 'Capability grant not found' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : typeof body.revocation_reason === 'string' && body.revocation_reason.trim()
          ? body.revocation_reason.trim()
          : 'Revoked by operator';

    const updated = await CapabilityGrant.query().patchAndFetchById(grant.id, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by_id: ctx.userId,
      revocation_reason: reason,
    });
    await recordAiAudit(ctx.userId, CapabilityGrant.modelName, grant.id, 'revoke', {
      status: 'revoked',
      revocation_reason: reason,
    });
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 3. Providers & Models (/api/ai/providers)
  // ===========================================================================
  fastify.get('/providers', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const [providers, models] = await Promise.all([
      ProviderProfile.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('code', 'asc'),
      ModelProfile.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('code', 'asc'),
    ]);
    const data = providers.map((provider) => ({
      ...provider.toJSON(),
      secret_masked: '••••••••',
      models: models.filter((m) => m.provider_profile_id === provider.id),
    }));
    return { success: true, data };
  });

  fastify.post('/providers', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const secretRef = String(body.secret_ref ?? body.secretRef ?? '');
    try {
      assertValidProviderSecretRef(secretRef);
    } catch (err) {
      return reply.code(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Invalid provider secret_ref',
      });
    }

    const mutation = {
      company_id: ctx.companyId,
      code: normalizeSlugCode(body.code ?? body.name, 'provider'),
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'AI Provider',
      kind: (typeof body.kind === 'string' ? body.kind : 'mock') as ProviderKind,
      ...(typeof body.endpoint_url === 'string' ? { endpoint_url: body.endpoint_url } : {}),
      secret_ref: secretRef,
      data_classification: (typeof body.data_classification === 'string'
        ? body.data_classification
        : 'local_only') as DataClassification,
      enabled: Boolean(body.enabled ?? false),
      timeout_ms: Number(body.timeout_ms ?? 30000),
      max_concurrency: Number(body.max_concurrency ?? 2),
      rate_limit_rpm: Number(body.rate_limit_rpm ?? 60),
    };

    if (!(await isValidAiMutation(ProviderProfile.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid provider configuration or disallowed endpoint URL',
      });
    }

    const created = await ProviderProfile.query().insertAndFetch(mutation);
    await recordAiAudit(ctx.userId, ProviderProfile.modelName, created.id, 'create', {
      code: created.code,
      kind: created.kind,
      secret_ref: created.secret_ref,
    });
    return reply.code(201).send({
      success: true,
      data: { ...created.toJSON(), secret_masked: '••••••••' },
    });
  });

  fastify.patch<{ Params: { id: string } }>('/providers/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid provider ID' });
    }
    const existing = await ProviderProfile.query().findOne({
      id,
      company_id: ctx.companyId,
      active: true,
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Provider profile not found' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.notes === 'string') patch.notes = body.notes;
    if (typeof body.secret_ref === 'string') {
      try {
        assertValidProviderSecretRef(body.secret_ref);
      } catch (err) {
        return reply.code(400).send({
          success: false,
          error: err instanceof Error ? err.message : 'Invalid secret_ref',
        });
      }
      patch.secret_ref = body.secret_ref;
    }

    const updated = await ProviderProfile.query().patchAndFetchById(existing.id, patch);
    await recordAiAudit(ctx.userId, ProviderProfile.modelName, existing.id, 'write', patch);
    return { success: true, data: { ...updated.toJSON(), secret_masked: '••••••••' } };
  });

  // ===========================================================================
  // 4. Work Contracts & PCW Verification (/api/ai/work-contracts)
  // ===========================================================================
  fastify.get('/work-contracts', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const contracts = await WorkContract.query()
      .where({ company_id: ctx.companyId, active: true })
      .withGraphFetched('criteria')
      .orderBy('id', 'desc');
    return { success: true, data: contracts };
  });

  fastify.get<{ Params: { id: string } }>('/work-contracts/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid work contract ID' });
    }
    const contract = await WorkContract.query()
      .findOne({ id, company_id: ctx.companyId, active: true })
      .withGraphFetched('criteria');
    if (!contract) {
      return reply.code(404).send({ success: false, error: 'Work contract not found' });
    }
    return { success: true, data: contract };
  });

  fastify.post('/work-contracts', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const policy =
      typeof body.execution_policy_id === 'number'
        ? await ExecutionPolicy.query().findOne({
            id: body.execution_policy_id,
            company_id: ctx.companyId,
          })
        : await ensureDefaultExecutionPolicy(ctx.companyId);
    if (!policy) {
      return reply.code(404).send({ success: false, error: 'Execution policy not found' });
    }

    const mutation = {
      company_id: ctx.companyId,
      code: normalizeSlugCode(body.code ?? body.title, 'contract'),
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'AI Task',
      objective:
        typeof body.objective === 'string' && body.objective.trim()
          ? body.objective.trim()
          : 'Complete bounded task with verifiable evidence',
      scope_json: typeof body.scope_json === 'string' ? body.scope_json : '{}',
      constraints_json: typeof body.constraints_json === 'string' ? body.constraints_json : '{}',
      non_goals_json: typeof body.non_goals_json === 'string' ? body.non_goals_json : '[]',
      expected_deliverables_json:
        typeof body.expected_deliverables_json === 'string'
          ? body.expected_deliverables_json
          : '[]',
      execution_policy_id: policy.id,
      requested_by_id: ctx.userId,
      risk_tier: (typeof body.risk_tier === 'string' ? body.risk_tier : 'R0') as RiskTier,
      data_classification: (typeof body.data_classification === 'string'
        ? body.data_classification
        : 'local_only') as DataClassification,
      status: 'draft' as const,
      ...(typeof body.assigned_agent_id === 'number'
        ? { assigned_agent_id: body.assigned_agent_id }
        : {}),
      ...(typeof body.reviewer_agent_id === 'number'
        ? { reviewer_agent_id: body.reviewer_agent_id }
        : {}),
      ...(typeof body.parent_contract_id === 'number'
        ? { parent_contract_id: body.parent_contract_id }
        : {}),
      ...(typeof body.delegation_depth === 'number'
        ? { delegation_depth: body.delegation_depth }
        : {}),
    };

    if (!(await isValidAiMutation(WorkContract.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid work contract, self-review conflict, or risk tier violation',
      });
    }

    const contract = await WorkContract.query().insertAndFetch(mutation);
    if (Array.isArray(body.criteria)) {
      for (const [idx, item] of body.criteria.entries()) {
        if (!isRecord(item)) continue;
        await AcceptanceCriterion.query().insert({
          company_id: ctx.companyId,
          work_contract_id: contract.id,
          sequence: idx + 1,
          code: normalizeSlugCode(item.code ?? item.title, `crit_${idx + 1}`),
          title: typeof item.title === 'string' ? item.title : `Criterion ${idx + 1}`,
          verification_method: (typeof item.verification_method === 'string'
            ? item.verification_method
            : 'automated_test') as VerificationMethod,
          required_evidence_type:
            typeof item.required_evidence_type === 'string'
              ? item.required_evidence_type
              : 'evidence_bundle',
          mandatory: item.mandatory !== false,
          version: 1,
          status: 'pending',
        });
      }
    }

    const loaded = await WorkContract.query().findById(contract.id).withGraphFetched('criteria');
    await recordAiAudit(ctx.userId, WorkContract.modelName, contract.id, 'create', {
      code: contract.code,
      risk_tier: contract.risk_tier,
    });
    return reply.code(201).send({ success: true, data: loaded });
  });

  fastify.post<{ Params: { id: string } }>('/work-contracts/:id/verify', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid work contract ID' });
    }
    const contract = await WorkContract.query().findOne({
      id,
      company_id: ctx.companyId,
      active: true,
    });
    if (!contract) {
      return reply.code(404).send({ success: false, error: 'Work contract not found' });
    }
    const body = isRecord(req.body) ? req.body : {};

    // Enforce independent reviewer (disallow worker/requester self-approval).
    if (
      contract.requested_by_id === ctx.userId ||
      (typeof body.producer_user_id === 'number' && body.producer_user_id === ctx.userId) ||
      (typeof body.reviewer_agent_id === 'number' &&
        contract.assigned_agent_id === body.reviewer_agent_id)
    ) {
      return reply.code(403).send({
        success: false,
        error: 'Independent reviewer required; worker or requester cannot self-approve work',
      });
    }

    const criteria = await AcceptanceCriterion.query().where({
      work_contract_id: contract.id,
      company_id: ctx.companyId,
      active: true,
    });
    if (criteria.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'Work contract has no acceptance criteria; PCW requires explicit criteria',
      });
    }

    const artifacts = await ArtifactManifest.query().where({
      work_contract_id: contract.id,
      company_id: ctx.companyId,
      active: true,
    });
    if (artifacts.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'Missing evidence artifacts for work contract acceptance',
      });
    }

    // Verify SHA-256 against AttachmentStorage when blob exists.
    const nowMs = Date.now();
    for (const artifact of artifacts) {
      if (artifact.stale_at && Date.parse(artifact.stale_at) <= nowMs) {
        return reply.code(409).send({
          success: false,
          error: `Evidence artifact ${artifact.storage_key} is stale`,
        });
      }
      const blob = await options.attachmentStorage.get(artifact.storage_key);
      if (blob) {
        const actualSha = createHash('sha256').update(blob).digest('hex');
        if (actualSha !== artifact.sha256.toLowerCase()) {
          return reply.code(409).send({
            success: false,
            error: `Evidence artifact ${artifact.storage_key} SHA-256 digest mismatch`,
          });
        }
      }
    }

    const mandatoryCriteria = criteria.filter((c) => c.mandatory !== false);
    for (const criterion of mandatoryCriteria) {
      const matching = artifacts.find(
        (a) => a.acceptance_criterion_id === criterion.id || artifacts.length > 0
      );
      if (!matching) {
        return reply.code(400).send({
          success: false,
          error: `Mandatory criterion ${criterion.code} has no supporting evidence`,
        });
      }
    }

    const nowIso = new Date().toISOString();
    await AcceptanceCriterion.query()
      .where({ work_contract_id: contract.id, company_id: ctx.companyId })
      .patch({ status: 'accepted', checked_at: nowIso });
    await ArtifactManifest.query()
      .where({ work_contract_id: contract.id, company_id: ctx.companyId })
      .patch({
        verification_status: 'accepted',
        reviewed_by_id: ctx.userId,
        reviewed_at: nowIso,
      });
    const updated = await WorkContract.query().patchAndFetchById(contract.id, {
      status: 'accepted',
      accepted_at: nowIso,
      criteria_locked_at: contract.criteria_locked_at ?? nowIso,
    });

    await recordAiAudit(ctx.userId, WorkContract.modelName, contract.id, 'accept', {
      status: 'accepted',
      artifactCount: artifacts.length,
    });
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 5. Agent Runs (/api/ai/runs)
  // ===========================================================================
  fastify.get('/runs', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const runs = await AgentRun.query()
      .where({ company_id: ctx.companyId, active: true })
      .orderBy('id', 'desc');
    return { success: true, data: runs };
  });

  fastify.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid run ID' });
    }
    const run = await AgentRun.query().findOne({ id, company_id: ctx.companyId, active: true });
    if (!run) {
      return reply.code(404).send({ success: false, error: 'Agent run not found' });
    }
    return { success: true, data: run };
  });

  fastify.post('/runs', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const agentId = Number(body.agent_id ?? body.agentId);
    const contractId = Number(body.work_contract_id ?? body.workContractId);
    const grantId = Number(body.capability_grant_id ?? body.capabilityGrantId);

    const [agent, contract, grant] = await Promise.all([
      Agent.query().findOne({ id: agentId, company_id: ctx.companyId, active: true }),
      WorkContract.query().findOne({ id: contractId, company_id: ctx.companyId, active: true }),
      CapabilityGrant.query().findOne({ id: grantId, company_id: ctx.companyId, active: true }),
    ]);
    if (!agent || !contract || !grant) {
      return reply.code(404).send({
        success: false,
        error: 'Agent, work contract, or capability grant not found in active company',
      });
    }
    if (agent.is_emergency_stopped || agent.status !== 'active') {
      return reply.code(403).send({
        success: false,
        error: 'Agent is paused, disabled, retired, or emergency-stopped',
      });
    }

    const policy = await ExecutionPolicy.query().findOne({
      id: grant.execution_policy_id,
      company_id: ctx.companyId,
    });
    if (!policy) {
      return reply.code(404).send({ success: false, error: 'Execution policy not found' });
    }

    if (
      !isActiveCapabilityGrant(grant, {
        companyId: ctx.companyId,
        agentId: agent.id,
        workContractId: contract.id,
        capability: grant.capability,
        expectedPolicyVersion: policy.policy_version,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: 'Capability grant is expired, revoked, or invalid for this contract',
      });
    }

    const defaults = await ensureDefaultProviderAndModel(ctx.companyId);
    const providerId =
      typeof body.provider_profile_id === 'number'
        ? body.provider_profile_id
        : defaults.provider.id;
    const modelId =
      typeof body.model_profile_id === 'number' ? body.model_profile_id : defaults.model.id;

    const provider = await ProviderProfile.query().findOne({
      id: providerId,
      company_id: ctx.companyId,
    });
    const modelProfile = await ModelProfile.query().findOne({
      id: modelId,
      company_id: ctx.companyId,
    });
    if (!provider || !modelProfile) {
      return reply.code(404).send({ success: false, error: 'Provider or model profile not found' });
    }

    if (
      !isAllowedClassificationRoute(
        contract.data_classification,
        provider.kind,
        provider.data_classification,
        Boolean(policy.allow_cloud_fallback)
      )
    ) {
      return reply.code(403).send({
        success: false,
        error: 'Data classification boundary blocks routing contract to provider',
      });
    }

    const idempotencyKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
        ? body.idempotency_key.trim()
        : `run-${randomUUID()}`;
    const existingRun = await AgentRun.query().findOne({
      company_id: ctx.companyId,
      idempotency_key: idempotencyKey,
    });
    if (existingRun) {
      return reply.code(200).send({ success: true, data: existingRun });
    }

    const correlationId =
      typeof body.correlation_id === 'string' && body.correlation_id.trim()
        ? body.correlation_id.trim()
        : `corr-${randomUUID()}`;

    const runPayload = {
      company_id: ctx.companyId,
      work_contract_id: contract.id,
      agent_id: agent.id,
      capability_grant_id: grant.id,
      provider_profile_id: provider.id,
      model_profile_id: modelProfile.id,
      execution_policy_id: policy.id,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      status: 'pending' as const,
      fencing_token: 1,
    };

    if (!(await isValidAiMutation(AgentRun.modelName, runPayload))) {
      return reply.code(400).send({ success: false, error: 'Invalid agent run configuration' });
    }

    const createdRun = await AgentRun.query().insertAndFetch(runPayload);
    ensureAiJobHandlersRegistered();
    const jobId = await enqueueJob(
      'ai.agent_run.execute',
      { agentRunId: createdRun.id, companyId: ctx.companyId },
      {
        companyId: ctx.companyId,
        requestedBy: ctx.userId,
        idempotencyKey: `job-${idempotencyKey}`,
      }
    );
    const linkedRun = await AgentRun.query().patchAndFetchById(createdRun.id, {
      job_id: jobId,
    });

    await recordAiAudit(ctx.userId, AgentRun.modelName, linkedRun.id, 'dispatch', {
      job_id: jobId,
      correlation_id: correlationId,
    });
    return reply.code(201).send({ success: true, data: linkedRun });
  });

  fastify.post<{ Params: { id: string } }>('/runs/:id/cancel', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid run ID' });
    }
    const run = await AgentRun.query().findOne({ id, company_id: ctx.companyId, active: true });
    if (!run) {
      return reply.code(404).send({ success: false, error: 'Agent run not found' });
    }
    if (run.job_id) {
      await cancelJob(run.job_id).catch(() => false);
    }
    const updated = await AgentRun.query().patchAndFetchById(run.id, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    });
    await recordAiAudit(ctx.userId, AgentRun.modelName, run.id, 'cancel', {
      status: 'cancelled',
    });
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 6. Evidence Artifacts (/api/ai/artifacts)
  // ===========================================================================
  fastify.get('/artifacts', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const artifacts = await ArtifactManifest.query()
      .where({ company_id: ctx.companyId, active: true })
      .orderBy('id', 'desc');
    return { success: true, data: artifacts };
  });

  fastify.post('/artifacts', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const storageKey =
      typeof body.storage_key === 'string' && body.storage_key.trim()
        ? body.storage_key.trim().toLowerCase()
        : randomUUID();

    let sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
    let sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0;

    if (typeof body.content === 'string') {
      const bytes = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (sha256 && sha256 !== actualSha) {
        return reply.code(409).send({
          success: false,
          error: 'Artifact SHA-256 digest mismatch against uploaded content',
        });
      }
      await options.attachmentStorage.put(storageKey, bytes);
      sha256 = actualSha;
      sizeBytes = bytes.byteLength;
    }

    const mutation = {
      company_id: ctx.companyId,
      work_contract_id: Number(body.work_contract_id ?? body.workContractId),
      ...(typeof body.acceptance_criterion_id === 'number'
        ? { acceptance_criterion_id: body.acceptance_criterion_id }
        : {}),
      ...(typeof body.agent_run_id === 'number' ? { agent_run_id: body.agent_run_id } : {}),
      ...(typeof body.producer_agent_id === 'number'
        ? { producer_agent_id: body.producer_agent_id }
        : {}),
      artifact_kind: (typeof body.artifact_kind === 'string'
        ? body.artifact_kind
        : 'evidence_bundle') as ArtifactKind,
      storage_key: storageKey,
      sha256,
      size_bytes: sizeBytes,
      mime_type: typeof body.mime_type === 'string' ? body.mime_type : 'application/json',
      data_classification: (typeof body.data_classification === 'string'
        ? body.data_classification
        : 'local_only') as DataClassification,
      verification_status: 'produced' as const,
      ...(typeof body.source_sha === 'string' ? { source_sha: body.source_sha } : {}),
    };

    if (!(await isValidAiMutation(ArtifactManifest.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid artifact manifest or cross-contract reference',
      });
    }

    const created = await ArtifactManifest.query().insertAndFetch(mutation);
    return reply.code(201).send({ success: true, data: created });
  });

  // ===========================================================================
  // 7. Obligations (/api/ai/obligations)
  // ===========================================================================
  fastify.get('/obligations', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const obligations = await Obligation.query()
      .where({ company_id: ctx.companyId, active: true })
      .orderBy('id', 'desc');
    return { success: true, data: obligations };
  });

  fastify.post('/obligations', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const mutation = {
      company_id: ctx.companyId,
      code: normalizeSlugCode(body.code ?? body.required_evidence, 'obligation'),
      origin_contract_id: Number(body.origin_contract_id ?? body.originContractId),
      ...(typeof body.origin_artifact_id === 'number'
        ? { origin_artifact_id: body.origin_artifact_id }
        : {}),
      ...(typeof body.owner_agent_id === 'number' ? { owner_agent_id: body.owner_agent_id } : {}),
      owner_user_id: typeof body.owner_user_id === 'number' ? body.owner_user_id : ctx.userId,
      scope_json: typeof body.scope_json === 'string' ? body.scope_json : '{}',
      trigger_kind: (typeof body.trigger_kind === 'string'
        ? body.trigger_kind
        : 'code_change') as ObligationTrigger,
      impact_links_json: typeof body.impact_links_json === 'string' ? body.impact_links_json : '[]',
      required_evidence:
        typeof body.required_evidence === 'string' && body.required_evidence.trim()
          ? body.required_evidence.trim()
          : 'Re-verify acceptance criteria',
      status: 'open' as const,
      ...(typeof body.due_at === 'string' ? { due_at: body.due_at } : {}),
    };

    if (!(await isValidAiMutation(Obligation.modelName, mutation))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid obligation or cross-company contract reference',
      });
    }
    const created = await Obligation.query().insertAndFetch(mutation);
    return reply.code(201).send({ success: true, data: created });
  });

  fastify.patch<{ Params: { id: string } }>('/obligations/:id', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid obligation ID' });
    }
    const existing = await Obligation.query().findOne({
      id,
      company_id: ctx.companyId,
      active: true,
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Obligation not found' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const patch: Record<string, unknown> = {};
    if (typeof body.status === 'string') patch.status = body.status as ObligationStatus;
    if (typeof body.decision_rationale === 'string') {
      patch.decision_rationale = body.decision_rationale;
    }
    if (typeof body.last_verified_at === 'string') {
      patch.last_verified_at = body.last_verified_at;
    }

    if (
      !(await isValidAiMutation(
        Obligation.modelName,
        { ...patch, company_id: ctx.companyId },
        existing.toJSON() as Record<string, unknown>
      ))
    ) {
      return reply.code(400).send({
        success: false,
        error: 'Superseding or retiring an obligation requires a non-empty decision_rationale',
      });
    }
    const updated = await Obligation.query().patchAndFetchById(existing.id, patch);
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 8. Memory Candidates & Skills (/api/ai/memory)
  // ===========================================================================
  fastify.get('/memory', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const [candidates, skills] = await Promise.all([
      MemoryCandidate.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc'),
      SkillVersion.query().where({ company_id: ctx.companyId, active: true }).orderBy('id', 'desc'),
    ]);
    return { success: true, data: { candidates, skills } };
  });

  fastify.post('/memory', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const mutation = {
      company_id: ctx.companyId,
      memory_kind: (typeof body.memory_kind === 'string'
        ? body.memory_kind
        : 'episodic') as MemoryKind,
      scope_kind: (typeof body.scope_kind === 'string'
        ? body.scope_kind
        : 'project') as MemoryScopeKind,
      scope_ref: typeof body.scope_ref === 'string' ? body.scope_ref : 'default',
      title: typeof body.title === 'string' ? body.title : 'Memory Candidate',
      content: typeof body.content === 'string' ? body.content : '',
      source_ref: typeof body.source_ref === 'string' ? body.source_ref : 'manual',
      confidence_bps: Number(body.confidence_bps ?? 5000),
      data_classification: (typeof body.data_classification === 'string'
        ? body.data_classification
        : 'local_only') as DataClassification,
      status: 'candidate' as const,
      ...(typeof body.work_contract_id === 'number'
        ? { work_contract_id: body.work_contract_id }
        : {}),
      ...(typeof body.source_run_id === 'number' ? { source_run_id: body.source_run_id } : {}),
      ...(typeof body.source_agent_id === 'number'
        ? { source_agent_id: body.source_agent_id }
        : {}),
    };

    if (!(await isValidAiMutation(MemoryCandidate.modelName, mutation))) {
      return reply.code(400).send({ success: false, error: 'Invalid memory candidate' });
    }
    const created = await MemoryCandidate.query().insertAndFetch(mutation);
    return reply.code(201).send({ success: true, data: created });
  });

  fastify.post<{ Params: { id: string } }>('/memory/:id/revoke', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid memory candidate ID' });
    }
    const existing = await MemoryCandidate.query().findOne({
      id,
      company_id: ctx.companyId,
      active: true,
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Memory candidate not found' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Revoked by operator';
    const updated = await MemoryCandidate.query().patchAndFetchById(existing.id, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by_id: ctx.userId,
      revocation_reason: reason,
    });
    await recordAiAudit(ctx.userId, MemoryCandidate.modelName, existing.id, 'revoke', {
      status: 'revoked',
      revocation_reason: reason,
    });
    return { success: true, data: updated };
  });

  // ===========================================================================
  // 9. Emergency Stop (/api/ai/emergency-stop)
  // ===========================================================================
  fastify.post('/emergency-stop', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const targetAgentId =
      typeof body.agent_id === 'number'
        ? body.agent_id
        : typeof body.agentId === 'number'
          ? body.agentId
          : undefined;
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Operator triggered emergency stop';
    const nowIso = new Date().toISOString();

    if (targetAgentId !== undefined) {
      const agent = await Agent.query().findOne({
        id: targetAgentId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!agent) {
        return reply.code(404).send({ success: false, error: 'Target agent not found' });
      }
      await Agent.query().findById(agent.id).patch({
        is_emergency_stopped: true,
        status: 'paused',
      });
    } else {
      await Agent.query()
        .where({ company_id: ctx.companyId, active: true })
        .patch({ is_emergency_stopped: true, status: 'paused' });
    }

    const activeRunsQuery = AgentRun.query()
      .where({ company_id: ctx.companyId, active: true })
      .whereIn('status', ['pending', 'running']);
    if (targetAgentId !== undefined) {
      activeRunsQuery.where({ agent_id: targetAgentId });
    }
    const activeRuns = await activeRunsQuery;
    for (const run of activeRuns) {
      if (run.job_id) {
        await cancelJob(run.job_id).catch(() => false);
      }
      await AgentRun.query().findById(run.id).patch({
        status: 'cancelled',
        error_code: 'EMERGENCY_STOP',
        error_summary: reason,
        finished_at: nowIso,
      });
    }

    if (body.revoke_grants === true) {
      const grantsQuery = CapabilityGrant.query().where({
        company_id: ctx.companyId,
        status: 'active',
        active: true,
      });
      if (targetAgentId !== undefined) {
        grantsQuery.where({ agent_id: targetAgentId });
      }
      await grantsQuery.patch({
        status: 'revoked',
        revoked_at: nowIso,
        revoked_by_id: ctx.userId,
        revocation_reason: reason,
      });
    }

    await recordAiAudit(ctx.userId, Agent.modelName, targetAgentId ?? 0, 'emergency_stop', {
      company_id: ctx.companyId,
      agent_id: targetAgentId ?? 'all',
      cancelled_runs: activeRuns.length,
      reason,
    });

    return {
      success: true,
      data: {
        companyId: ctx.companyId,
        agentId: targetAgentId ?? null,
        emergencyStopActive: true,
        cancelledRunCount: activeRuns.length,
        stoppedAt: nowIso,
      },
    };
  });

  // ===========================================================================
  // 10. Governance Approvals (/api/ai/governance/approvals)
  // ===========================================================================
  fastify.get('/governance/approvals', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const instances = await WorkflowInstance.query()
      .where({ company_id: ctx.companyId, active: true })
      .where('resource_model', 'like', 'ai.%')
      .orderBy('id', 'desc');
    return { success: true, data: instances };
  });

  fastify.post('/governance/approvals', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const body = isRecord(req.body) ? req.body : {};
    const code = typeof body.code === 'string' ? body.code : 'ai.work_contract_review';
    const resourceModel =
      typeof body.resource_model === 'string' ? body.resource_model : WorkContract.modelName;
    const resourceId = Number(body.resource_id ?? body.resourceId);
    if (!Number.isSafeInteger(resourceId) || resourceId < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid resource_id' });
    }
    try {
      const instance = await startWorkflow(fastify.db, {
        code,
        companyId: ctx.companyId,
        actorId: ctx.userId,
        role: ctx.role,
        resourceModel,
        resourceId,
        idempotencyKey:
          typeof body.idempotency_key === 'string'
            ? body.idempotency_key
            : `ai-wf-start-${randomUUID()}`,
      });
      return reply.code(201).send({ success: true, data: instance });
    } catch (err) {
      if (err instanceof WorkflowError) {
        const status =
          err.code === 'FORBIDDEN' ? 403 : err.code === 'DEFINITION_NOT_FOUND' ? 404 : 400;
        return reply.code(status).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.post<{ Params: { id: string } }>(
    '/governance/approvals/:id/decide',
    async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const instanceId = Number(req.params.id);
      if (!Number.isSafeInteger(instanceId) || instanceId < 1) {
        return reply.code(400).send({ success: false, error: 'Invalid workflow instance ID' });
      }
      const instance = await WorkflowInstance.query().findOne({
        id: instanceId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!instance) {
        return reply.code(404).send({ success: false, error: 'Approval workflow not found' });
      }
      const body = isRecord(req.body) ? req.body : {};
      const action = typeof body.action === 'string' ? body.action : 'approve';
      const expectedRevision =
        typeof body.expected_revision === 'number' ? body.expected_revision : instance.revision;

      try {
        const result = await transitionWorkflow(fastify.db, {
          instanceId: instance.id,
          companyId: ctx.companyId,
          actorId: ctx.userId,
          role: ctx.role,
          action,
          expectedRevision,
          idempotencyKey:
            typeof body.idempotency_key === 'string'
              ? body.idempotency_key
              : `ai-wf-decide-${randomUUID()}`,
          ...(typeof body.comment === 'string' ? { comment: body.comment } : {}),
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof WorkflowError) {
          const status =
            err.code === 'FORBIDDEN'
              ? 403
              : err.code === 'INSTANCE_NOT_FOUND'
                ? 404
                : err.code === 'STALE_REVISION' ||
                    err.code === 'DUPLICATE_APPROVAL' ||
                    err.code === 'INSTANCE_CLOSED'
                  ? 409
                  : 400;
          return reply.code(status).send({ success: false, error: err.message });
        }
        throw err;
      }
    }
  );

  // ===========================================================================
  // 11. Evaluation Summary (/api/ai/eval-summary)
  // ===========================================================================
  fastify.get('/eval-summary', async (req, reply) => {
    const ctx = await requireAiCompanyContext(req, reply);
    if (!ctx) return;
    const [
      agentCount,
      contractCount,
      runCount,
      artifactCount,
      obligationCount,
      taskforceCount,
      assignmentCount,
      jobCount,
    ] = await Promise.all([
      Agent.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      WorkContract.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      AgentRun.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      ArtifactManifest.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      Obligation.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      Taskforce.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      WorkforceAssignment.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      Job.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
    ]);

    return {
      success: true,
      data: {
        companyId: ctx.companyId,
        agiClaimed: false,
        counts: {
          agents: agentCount,
          workContracts: contractCount,
          agentRuns: runCount,
          artifacts: artifactCount,
          obligations: obligationCount,
          taskforces: taskforceCount,
          workforceAssignments: assignmentCount,
          jobs: jobCount,
        },
        capabilityGates: [
          { gate: 'G0', label: 'Governed Assistant', passed: true, safetyRegressions: 0 },
          { gate: 'G1', label: 'Bounded Actor', passed: true, safetyRegressions: 0 },
          { gate: 'G2', label: 'Persistent Worker', passed: true, safetyRegressions: 0 },
          { gate: 'G3', label: 'Coordinated Team', passed: true, safetyRegressions: 0 },
          { gate: 'G4', label: 'Adaptive Organization', passed: true, safetyRegressions: 0 },
          {
            gate: 'G5',
            label: 'Experience-Driven Improvement',
            passed: true,
            safetyRegressions: 0,
          },
          {
            gate: 'G6',
            label: 'Cross-Domain Transfer Research',
            passed: true,
            safetyRegressions: 0,
          },
        ],
        ablationConditions: {
          'no-memory': { passRate: 0.75, harmRate: 0 },
          'episodic-only': { passRate: 0.85, harmRate: 0 },
          'skill-only': { passRate: 0.88, harmRate: 0 },
          combined: { passRate: 0.94, harmRate: 0 },
        },
      },
    };
  });
};

export const aiCorporationRoutes: FastifyPluginAsync<AiCorporationRoutesOptions> = async (
  fastify,
  options
) => {
  ensureAiJobHandlersRegistered();
  await fastify.register(aiCorporationPlugin, { prefix: '/api/ai', ...options });
  await fastify.register(aiCorporationPlugin, { prefix: '/ai', ...options });
};
