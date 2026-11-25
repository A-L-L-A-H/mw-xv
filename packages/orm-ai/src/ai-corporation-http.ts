import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { Registry } from '@moonwitness/orm';
import { runOfflineEvaluationGates } from '@moonwitness/ai-evaluation';
import { isProviderCloudEgress, validateDiffScope } from '@moonwitness/ai-runtime';
import { cancelJob, enqueueJob, Job } from '@moonwitness/jobs';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import {
  startWorkflow,
  transitionWorkflow,
  WorkflowError,
  WorkflowInstance,
} from '@moonwitness/orm-workflow';
import {
  AcceptanceCriterion,
  Agent,
  AgentProfile,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
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
} from './models.js';
import {
  assertValidProviderSecretRef,
  isActiveCapabilityGrant,
  isAllowedClassificationRoute,
  isValidAiMutation,
} from './validation.js';
import {
  ensureAiJobHandlersRegistered,
  ensureDefaultExecutionPolicy,
  evaluateProofGateV2,
  isRecord,
  normalizeSlugCode,
  recordAiAudit,
  requireAiCompanyContext,
  toStringArray,
} from './ai-http-helpers.js';
import {
  computeExecutionFingerprint,
  enqueueApprovedAgentRun,
  startAgentRunApproval,
} from './agent-run-executor.js';
import {
  discoverGatewayModels,
  DiscoveryError,
  selectCodingAgentModel,
  upsertDiscoveredModels,
} from './freellmapi-discovery.js';

export const AI_CORPORATION_ROUTE_PREFIXES = ['/api/ai', '/ai'] as const;

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/iu;
/** Static gate definitions only; never a verdict. Verdicts come from the evaluation contract. */
const AI_EVAL_GATE_LABELS: Readonly<Record<string, string>> = {
  G0: 'Governed Assistant',
  G1: 'Bounded Actor',
  G2: 'Persistent Worker',
  G3: 'Coordinated Team',
  G4: 'Adaptive Organization',
  G5: 'Experience-Driven Improvement',
  G6: 'Cross-Domain Transfer Research',
};
const PROJECT_TASK_MODEL = 'project.task';
const PROJECT_STAGE_MODEL = 'project.stage';
const PROJECT_TASK_DEPENDENCY_MODEL = 'project.task_dependency';

interface ProjectTaskLike {
  id: number;
  code: string;
  project_id: number;
  status: string;
}

interface ProjectTaskDependencyLike {
  task_id: number;
  depends_on_id: number;
}

interface DynamicModelQuery {
  where(clause: Record<string, unknown>): DynamicModelQuery;
  andWhere(
    cb: (qb: { where(c: Record<string, unknown>): { orWhereNull(col: string): void } }) => void
  ): DynamicModelQuery;
  whereIn(col: string, values: readonly number[]): DynamicModelQuery;
  orderBy(col: string, dir: 'asc' | 'desc'): DynamicModelQuery;
  findOne(clause: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
  patchAndFetchById(id: number, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  first(): Promise<Record<string, unknown> | undefined>;
  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
}

interface DynamicModelCtor {
  query(): DynamicModelQuery;
}

function getOptionalModel(modelName: string): DynamicModelCtor | null {
  if (!Registry.has(modelName)) return null;
  return Registry.get(modelName) as unknown as DynamicModelCtor;
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

export const aiCorporationHttpPlugin: AddonHttpPlugin = async (app, options) => {
  ensureAiJobHandlersRegistered();
  const attachmentStorage = options?.attachmentStorage as AttachmentStorage | undefined;
  const appDb = (app as unknown as { db?: Knex }).db;

  for (const prefix of AI_CORPORATION_ROUTE_PREFIXES) {
    // =========================================================================
    // 1. Agents (/api/ai/agents, /ai/agents)
    // =========================================================================
    app.get(`${prefix}/agents`, async (req, reply) => {
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

    app.get<{ Params: { id: string } }>(`${prefix}/agents/:id`, async (req, reply) => {
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

    app.post(`${prefix}/agents`, async (req, reply) => {
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
          typeof body.default_capabilities_json === 'string'
            ? body.default_capabilities_json
            : '[]',
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

    app.patch<{ Params: { id: string } }>(`${prefix}/agents/:id`, async (req, reply) => {
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

    // =========================================================================
    // 2. Capability Grants (/api/ai/grants)
    // =========================================================================
    app.get(`${prefix}/grants`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const grants = await CapabilityGrant.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc');
      return { success: true, data: grants };
    });

    app.post(`${prefix}/grants`, async (req, reply) => {
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

      const issuedAt =
        typeof body.issued_at === 'string' ? body.issued_at : new Date().toISOString();
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

    app.post<{ Params: { id: string } }>(`${prefix}/grants/:id/revoke`, async (req, reply) => {
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

    // =========================================================================
    // 3. Providers & Models (/api/ai/providers)
    // =========================================================================
    app.get(`${prefix}/providers`, async (req, reply) => {
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

    app.post(`${prefix}/providers`, async (req, reply) => {
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

    app.patch<{ Params: { id: string } }>(`${prefix}/providers/:id`, async (req, reply) => {
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

    // Operator-only FreeLLMAPI model discovery. Never returns a raw key and
    // never invents a model id: rows come from the gateway's real /v1/models.
    app.get<{ Params: { id: string } }>(
      `${prefix}/providers/:id/discovered-models`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        if (ctx.role !== 'superadmin') {
          return reply
            .code(403)
            .send({ success: false, error: 'Operator role required for gateway discovery' });
        }
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
          return reply.code(400).send({ success: false, error: 'Invalid provider ID' });
        }
        const provider = await ProviderProfile.query().findOne({
          id,
          company_id: ctx.companyId,
          active: true,
        });
        if (!provider || provider.kind !== 'freellmapi') {
          return reply.code(404).send({ success: false, error: 'FreeLLMAPI provider not found' });
        }
        try {
          const models = await discoverGatewayModels({ secretRef: provider.secret_ref });
          const persisted = await upsertDiscoveredModels({
            companyId: ctx.companyId,
            providerId: provider.id,
            models,
          });
          await recordAiAudit(ctx.userId, ProviderProfile.modelName, provider.id, 'discover', {
            modelCount: models.length,
          });
          return {
            success: true,
            data: persisted.map((item) => ({ ...item, secret_reference: provider.secret_ref })),
          };
        } catch (error) {
          if (error instanceof DiscoveryError) {
            return reply
              .code(error.statusCode)
              .send({ success: false, code: error.code, error: error.message });
          }
          throw error;
        }
      }
    );

    app.post<{ Params: { id: string } }>(
      `${prefix}/providers/:id/select-default-model`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        if (ctx.role !== 'superadmin') {
          return reply
            .code(403)
            .send({ success: false, error: 'Operator role required to select a gateway model' });
        }
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
          return reply.code(400).send({ success: false, error: 'Invalid provider ID' });
        }
        const body = isRecord(req.body) ? req.body : {};
        if (typeof body.model_id !== 'string' || body.model_id.trim() === '') {
          return reply.code(400).send({ success: false, error: 'model_id is required' });
        }
        try {
          const selected = await selectCodingAgentModel({
            companyId: ctx.companyId,
            providerId: id,
            modelId: body.model_id.trim(),
          });
          await recordAiAudit(
            ctx.userId,
            ProviderProfile.modelName,
            id,
            'select_default_model',
            selected
          );
          return { success: true, data: selected };
        } catch (error) {
          if (error instanceof DiscoveryError) {
            return reply
              .code(error.statusCode)
              .send({ success: false, code: error.code, error: error.message });
          }
          throw error;
        }
      }
    );

    // =========================================================================
    // 4. Work Contracts & PCW Verification (/api/ai/work-contracts)
    // =========================================================================
    app.get(`${prefix}/work-contracts`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const contracts = await WorkContract.query()
        .where({ company_id: ctx.companyId, active: true })
        .withGraphFetched('criteria')
        .orderBy('id', 'desc');
      return { success: true, data: contracts };
    });

    app.get<{ Params: { id: string } }>(`${prefix}/work-contracts/:id`, async (req, reply) => {
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

    app.post(`${prefix}/work-contracts`, async (req, reply) => {
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

    app.post<{ Params: { id: string } }>(
      `${prefix}/work-contracts/:id/verify`,
      async (req, reply) => {
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

        const nowMs = Date.now();
        for (const artifact of artifacts) {
          if (artifact.stale_at && Date.parse(artifact.stale_at) <= nowMs) {
            return reply.code(409).send({
              success: false,
              error: `Evidence artifact ${artifact.storage_key} is stale`,
            });
          }
          if (attachmentStorage) {
            const blob = await attachmentStorage.get(artifact.storage_key);
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

        const proofGateError = evaluateProofGateV2(body, contract.scope_json, 'acceptance');
        if (proofGateError) {
          return reply.code(proofGateError.statusCode).send({
            success: false,
            code: proofGateError.code,
            error: proofGateError.error,
            ...(proofGateError.details ? proofGateError.details : {}),
          });
        }

        const rawFencingToken = body.fencing_token ?? body.fencingToken;
        if (rawFencingToken !== undefined) {
          const fencingToken = Number(rawFencingToken);
          if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
            return reply.code(400).send({
              success: false,
              code: 'INVALID_FENCING_TOKEN',
              error: 'fencing_token must be a positive integer',
            });
          }
          const latestRun = await AgentRun.query()
            .where({
              company_id: ctx.companyId,
              work_contract_id: contract.id,
              active: true,
            })
            .orderBy('fencing_token', 'desc')
            .first();
          if (latestRun && latestRun.fencing_token > fencingToken) {
            return reply.code(409).send({
              success: false,
              code: 'STALE_FENCING_TOKEN',
              error: `Stale fencing token ${fencingToken} < current ${latestRun.fencing_token}`,
              currentFencingToken: latestRun.fencing_token,
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

        const ProjectTaskModel = getOptionalModel(PROJECT_TASK_MODEL);
        const ProjectStageModel = getOptionalModel(PROJECT_STAGE_MODEL);
        if (
          ProjectTaskModel &&
          updated.source_model === PROJECT_TASK_MODEL &&
          typeof updated.source_id === 'number' &&
          updated.source_id > 0
        ) {
          const linkedTask = (await ProjectTaskModel.query().findOne({
            id: updated.source_id,
            company_id: ctx.companyId,
          })) as ProjectTaskLike | undefined;
          if (linkedTask) {
            let doneStageId: number | undefined;
            if (ProjectStageModel) {
              const doneStage = (await ProjectStageModel.query()
                .where({ company_id: ctx.companyId, code: 'done' })
                .andWhere((qb) => {
                  qb.where({ project_id: linkedTask.project_id }).orWhereNull('project_id');
                })
                .orderBy('project_id', 'desc')
                .first()) as { id?: number } | undefined;
              if (typeof doneStage?.id === 'number') doneStageId = doneStage.id;
            }
            await ProjectTaskModel.query().patchAndFetchById(linkedTask.id, {
              status: 'done',
              ...(doneStageId !== undefined ? { stage_id: doneStageId } : {}),
            });
          }
        }

        await recordAiAudit(ctx.userId, WorkContract.modelName, contract.id, 'accept', {
          status: 'accepted',
          artifactCount: artifacts.length,
        });
        return { success: true, data: updated };
      }
    );

    // =========================================================================
    // 5. Agent Runs (/api/ai/runs)
    // =========================================================================
    app.get(`${prefix}/runs`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const runs = await AgentRun.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc');
      return { success: true, data: runs };
    });

    app.get<{ Params: { id: string } }>(`${prefix}/runs/:id`, async (req, reply) => {
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

    app.post(`${prefix}/runs`, async (req, reply) => {
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

      if (
        contract.status === 'accepted' ||
        contract.status === 'rejected' ||
        contract.status === 'cancelled'
      ) {
        return reply.code(409).send({
          success: false,
          code: 'WORK_CONTRACT_NOT_EXECUTABLE',
          error: `Work contract '${contract.code}' is in terminal status '${contract.status}' and cannot start a new run`,
        });
      }

      const explicitTaskId = body.project_task_id ?? body.projectTaskId;
      const targetTaskId =
        explicitTaskId !== undefined
          ? Number(explicitTaskId)
          : contract.source_model === PROJECT_TASK_MODEL &&
              typeof contract.source_id === 'number' &&
              contract.source_id > 0
            ? contract.source_id
            : null;

      if (targetTaskId !== null) {
        if (!Number.isSafeInteger(targetTaskId) || targetTaskId < 1) {
          return reply.code(400).send({
            success: false,
            code: 'INVALID_PROJECT_TASK_ID',
            error: 'Invalid project_task_id for run start gate',
          });
        }
        const ProjectTaskModel = getOptionalModel(PROJECT_TASK_MODEL);
        const ProjectTaskDependencyModel = getOptionalModel(PROJECT_TASK_DEPENDENCY_MODEL);
        if (ProjectTaskModel) {
          const linkedTask = (await ProjectTaskModel.query().findOne({
            id: targetTaskId,
            company_id: ctx.companyId,
            active: true,
          })) as ProjectTaskLike | undefined;
          if (!linkedTask) {
            return reply.code(404).send({
              success: false,
              code: 'PROJECT_TASK_NOT_FOUND',
              error: 'Linked project task not found in active company',
            });
          }
          const projectTasks = (await ProjectTaskModel.query()
            .where({ company_id: ctx.companyId, project_id: linkedTask.project_id, active: true })
            .orderBy('id', 'asc')) as unknown as ProjectTaskLike[];
          const taskById = new Map(projectTasks.map((t) => [t.id, t]));
          const dependencies = ProjectTaskDependencyModel
            ? ((await ProjectTaskDependencyModel.query()
                .where({ company_id: ctx.companyId, active: true, task_id: linkedTask.id })
                .orderBy('id', 'asc')) as unknown as ProjectTaskDependencyLike[])
            : [];
          const blockedByTaskIds = dependencies
            .map((dep) => dep.depends_on_id)
            .filter((depId) => taskById.get(depId)?.status !== 'done');
          const isReady =
            linkedTask.status !== 'done' &&
            linkedTask.status !== 'cancelled' &&
            blockedByTaskIds.length === 0;
          if (!isReady) {
            return reply.code(409).send({
              success: false,
              code: 'PROJECT_TASK_NOT_READY',
              error: `Project task '${linkedTask.code}' is not ready for execution`,
              taskId: linkedTask.id,
              status: linkedTask.status,
              blockedByTaskIds,
            });
          }
        }
      }

      const rawExecutionPacket = body.execution_packet ?? body.executionPacket;
      if (rawExecutionPacket !== undefined) {
        if (!isRecord(rawExecutionPacket)) {
          return reply.code(422).send({
            success: false,
            code: 'INVALID_EXECUTION_PACKET',
            error: 'execution_packet must be an object',
          });
        }
        const packetSha = String(
          rawExecutionPacket.contentSha256 ?? rawExecutionPacket.content_sha256 ?? ''
        );
        if (!SHA256_HEX_REGEX.test(packetSha)) {
          return reply.code(422).send({
            success: false,
            code: 'INVALID_EXECUTION_PACKET',
            error: 'execution_packet requires a valid 64-character hex contentSha256',
          });
        }
        const packetContractId =
          rawExecutionPacket.workContractId ?? rawExecutionPacket.work_contract_id;
        if (packetContractId !== undefined && Number(packetContractId) !== contract.id) {
          return reply.code(422).send({
            success: false,
            code: 'INVALID_EXECUTION_PACKET',
            error: 'execution_packet workContractId does not match target work contract',
          });
        }
      }

      let runFencingToken = 1;
      const rawWorktreeLease = body.worktree_lease ?? body.worktreeLease;
      if (rawWorktreeLease !== undefined) {
        if (!isRecord(rawWorktreeLease)) {
          return reply.code(422).send({
            success: false,
            code: 'INVALID_WORKTREE_LEASE',
            error: 'worktree_lease must be an object',
          });
        }
        const leaseCompanyId = rawWorktreeLease.companyId ?? rawWorktreeLease.company_id;
        if (leaseCompanyId !== undefined && Number(leaseCompanyId) !== ctx.companyId) {
          return reply.code(403).send({
            success: false,
            code: 'WORKTREE_LEASE_COMPANY_MISMATCH',
            error: 'worktree_lease companyId does not match active company',
          });
        }
        const leaseToken = Number(rawWorktreeLease.fencingToken ?? rawWorktreeLease.fencing_token);
        if (!Number.isSafeInteger(leaseToken) || leaseToken < 1) {
          return reply.code(422).send({
            success: false,
            code: 'INVALID_WORKTREE_LEASE',
            error: 'worktree_lease requires a positive integer fencingToken',
          });
        }
        const leaseExpiresAt = rawWorktreeLease.expiresAt ?? rawWorktreeLease.expires_at;
        if (typeof leaseExpiresAt === 'string') {
          const expiresMs = Date.parse(leaseExpiresAt);
          if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
            return reply.code(409).send({
              success: false,
              code: 'WORKTREE_LEASE_EXPIRED',
              error: 'worktree_lease is expired',
            });
          }
        }
        const rawAllowedPaths = rawWorktreeLease.allowedPaths ?? rawWorktreeLease.allowed_paths;
        if (rawAllowedPaths !== undefined) {
          const leaseAllowedPaths = toStringArray(rawAllowedPaths);
          if (leaseAllowedPaths.length === 0) {
            return reply.code(422).send({
              success: false,
              code: 'INVALID_WORKTREE_LEASE_SCOPE',
              error: 'worktree_lease allowedPaths must be a non-empty array of relative paths',
            });
          }
          const scopeCheck = validateDiffScope(leaseAllowedPaths, leaseAllowedPaths);
          if (!scopeCheck.scopeClean) {
            return reply.code(422).send({
              success: false,
              code: 'INVALID_WORKTREE_LEASE_SCOPE',
              error: 'worktree_lease allowedPaths contains unsafe or disallowed paths',
              unsafePaths: scopeCheck.unsafePaths,
            });
          }
        }
        const highestRun = await AgentRun.query()
          .where({
            company_id: ctx.companyId,
            work_contract_id: contract.id,
            active: true,
          })
          .orderBy('fencing_token', 'desc')
          .first();
        if (highestRun && highestRun.fencing_token > leaseToken) {
          return reply.code(409).send({
            success: false,
            code: 'STALE_FENCING_TOKEN',
            error: `Stale worktree lease fencing token ${leaseToken} < current ${highestRun.fencing_token}`,
            currentFencingToken: highestRun.fencing_token,
          });
        }
        runFencingToken = leaseToken;
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
        return reply
          .code(404)
          .send({ success: false, error: 'Provider or model profile not found' });
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
        fencing_token: runFencingToken,
      };

      if (!(await isValidAiMutation(AgentRun.modelName, runPayload))) {
        return reply.code(400).send({ success: false, error: 'Invalid agent run configuration' });
      }

      const fingerprint = computeExecutionFingerprint({
        contract: { id: contract.id, code: String(contract.code) },
        agent: { id: agent.id, code: String(agent.code) },
        grant: {
          id: grant.id,
          policyVersion: Number(grant.policy_version ?? 0),
          expiresAt: grant.expires_at ?? undefined,
        },
        provider: { id: provider.id, code: String(provider.code), kind: String(provider.kind) },
        model: { id: modelProfile.id, modelId: String(modelProfile.model_id) },
        policy: {
          id: policy.id,
          version: Number(policy.policy_version ?? 0),
          maxRiskTier: String(policy.max_risk_tier ?? 'R0'),
        },
        repository: {
          snapshotId:
            typeof rawExecutionPacket === 'object' && rawExecutionPacket !== null
              ? String(rawExecutionPacket.contentSha256 ?? '')
              : undefined,
          allowedPaths: toStringArray(
            rawWorktreeLease?.allowedPaths ?? rawWorktreeLease?.allowed_paths
          ),
        },
        classification: String(contract.data_classification ?? 'local_only'),
        limits: {
          maxSteps: Number(policy.max_steps ?? 0),
          maxTokens: Number(policy.max_tokens_per_run ?? 0),
          maxCostMicros: Number(policy.max_cost_micros_per_run ?? 0),
        },
        secretRefName: String(provider.secret_ref ?? ''),
      });

      const requiresApproval =
        isProviderCloudEgress(provider as never) &&
        (String(policy.max_risk_tier) === 'R3' || String(contract.risk_tier) === 'R3');
      const createdRun = await AgentRun.query().insertAndFetch({
        ...runPayload,
        execution_fingerprint: fingerprint,
      });
      ensureAiJobHandlersRegistered();

      if (requiresApproval) {
        if (!appDb) {
          return reply.code(500).send({ success: false, error: 'Database handle unavailable' });
        }
        const approval = await startAgentRunApproval({
          db: appDb,
          companyId: ctx.companyId,
          actorId: ctx.userId,
          role: ctx.role,
          runId: createdRun.id,
          fingerprint,
        });
        const pendingRun = await AgentRun.query().patchAndFetchById(createdRun.id, {
          approval_workflow_id: approval.id,
        });
        await recordAiAudit(ctx.userId, AgentRun.modelName, createdRun.id, 'approval_requested', {
          approval_workflow_id: approval.id,
          execution_fingerprint: fingerprint,
        });
        return reply.code(202).send({
          success: true,
          data: pendingRun,
          approval: { id: approval.id, currentState: approval.currentState },
          executionFingerprint: fingerprint,
        });
      }

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
        execution_fingerprint: fingerprint,
      });
      return reply.code(201).send({ success: true, data: linkedRun });
    });

    app.post<{ Params: { id: string } }>(`${prefix}/runs/:id/approve`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      if (!appDb) {
        return reply.code(500).send({ success: false, error: 'Database handle unavailable' });
      }
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return reply.code(400).send({ success: false, error: 'Invalid run ID' });
      }
      const run = await AgentRun.query().findOne({ id, company_id: ctx.companyId, active: true });
      if (!run || run.approval_workflow_id === null || run.approval_workflow_id === undefined) {
        return reply.code(404).send({ success: false, error: 'Run has no approval workflow' });
      }
      if (run.job_id !== null && run.job_id !== undefined) {
        return reply.code(409).send({ success: false, error: 'Run was already dispatched' });
      }
      const approval = await WorkflowInstance.query().findOne({
        id: run.approval_workflow_id,
        company_id: ctx.companyId,
        active: true,
      });
      if (!approval || String(approval.status) !== 'active') {
        return reply.code(409).send({ success: false, error: 'Approval is not active' });
      }
      const body = isRecord(req.body) ? req.body : {};
      if (
        typeof body.execution_fingerprint === 'string' &&
        body.execution_fingerprint !== run.execution_fingerprint
      ) {
        return reply.code(409).send({ success: false, error: 'Execution fingerprint mismatch' });
      }
      try {
        const result = await enqueueApprovedAgentRun({
          db: appDb,
          instanceId: approval.id,
          companyId: ctx.companyId,
          actorId: ctx.userId,
          role: ctx.role,
          expectedRevision:
            typeof body.expected_revision === 'number' ? body.expected_revision : approval.revision,
          idempotencyKey: `run-${run.id}-${String(run.execution_fingerprint ?? '').slice(0, 32)}`,
          runId: run.id,
          async enqueue(runId, companyId, idempotencyKey) {
            return enqueueJob(
              'ai.agent_run.execute',
              { agentRunId: runId, companyId },
              {
                companyId,
                requestedBy: ctx.userId,
                idempotencyKey: `job-${idempotencyKey}`,
              }
            );
          },
        });
        const linkedRun = await AgentRun.query().patchAndFetchById(run.id, {
          job_id: result.jobId,
        });
        await recordAiAudit(ctx.userId, AgentRun.modelName, run.id, 'approval_dispatch', {
          job_id: result.jobId,
          approval_workflow_id: approval.id,
        });
        return { success: true, data: linkedRun };
      } catch (err) {
        if (err instanceof WorkflowError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    });

    app.post<{ Params: { id: string } }>(`${prefix}/runs/:id/cancel`, async (req, reply) => {
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

    // =========================================================================
    // 6. Evidence Artifacts (/api/ai/artifacts)
    // =========================================================================
    app.get(`${prefix}/artifacts`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const artifacts = await ArtifactManifest.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc');
      return { success: true, data: artifacts };
    });

    app.post(`${prefix}/artifacts`, async (req, reply) => {
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
        if (attachmentStorage) {
          await attachmentStorage.put(storageKey, bytes);
        }
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

    // =========================================================================
    // 7. Obligations (/api/ai/obligations)
    // =========================================================================
    app.get(`${prefix}/obligations`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const obligations = await Obligation.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc');
      return { success: true, data: obligations };
    });

    app.post(`${prefix}/obligations`, async (req, reply) => {
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
        impact_links_json:
          typeof body.impact_links_json === 'string' ? body.impact_links_json : '[]',
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

    app.patch<{ Params: { id: string } }>(`${prefix}/obligations/:id`, async (req, reply) => {
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

    // =========================================================================
    // 8. Memory Candidates & Skills (/api/ai/memory)
    // =========================================================================
    app.get(`${prefix}/memory`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const [candidates, skills] = await Promise.all([
        MemoryCandidate.query()
          .where({ company_id: ctx.companyId, active: true })
          .orderBy('id', 'desc'),
        SkillVersion.query()
          .where({ company_id: ctx.companyId, active: true })
          .orderBy('id', 'desc'),
      ]);
      return { success: true, data: { candidates, skills } };
    });

    app.post(`${prefix}/memory`, async (req, reply) => {
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

    app.post<{ Params: { id: string } }>(`${prefix}/memory/:id/revoke`, async (req, reply) => {
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

    // =========================================================================
    // 9. Emergency Stop (/api/ai/emergency-stop)
    // =========================================================================
    app.post(`${prefix}/emergency-stop`, async (req, reply) => {
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

    // =========================================================================
    // 10. Governance Approvals (/api/ai/governance/approvals)
    // =========================================================================
    app.get(`${prefix}/governance/approvals`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const instances = await WorkflowInstance.query()
        .where({ company_id: ctx.companyId, active: true })
        .where('resource_model', 'like', 'ai.%')
        .orderBy('id', 'desc');
      return { success: true, data: instances };
    });

    app.post(`${prefix}/governance/approvals`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      if (!appDb) {
        return reply.code(500).send({ success: false, error: 'Database handle unavailable' });
      }
      const body = isRecord(req.body) ? req.body : {};
      const code = typeof body.code === 'string' ? body.code : 'ai.work_contract_review';
      const resourceModel =
        typeof body.resource_model === 'string' ? body.resource_model : WorkContract.modelName;
      const resourceId = Number(body.resource_id ?? body.resourceId);
      if (!Number.isSafeInteger(resourceId) || resourceId < 1) {
        return reply.code(400).send({ success: false, error: 'Invalid resource_id' });
      }
      try {
        const instance = await startWorkflow(appDb, {
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

    app.post<{ Params: { id: string } }>(
      `${prefix}/governance/approvals/:id/decide`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        if (!appDb) {
          return reply.code(500).send({ success: false, error: 'Database handle unavailable' });
        }
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
          const result = await transitionWorkflow(appDb, {
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

    // =========================================================================
    // 11. Evaluation Summary (/api/ai/eval-summary)
    // =========================================================================
    app.get(`${prefix}/eval-summary`, async (req, reply) => {
      // Operator authorization: authentication, active company membership and
      // cross-tenant guards are enforced by requireAiCompanyContext.
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
      const counts = {
        agents: agentCount,
        workContracts: contractCount,
        agentRuns: runCount,
        artifacts: artifactCount,
        obligations: obligationCount,
        taskforces: taskforceCount,
        workforceAssignments: assignmentCount,
        jobs: jobCount,
      };

      // The only evaluation source is the deterministic, offline contract. It
      // validates provenance, replay determinism and gate coverage internally;
      // a failed or unverified report must never turn into a readiness claim.
      let report: Awaited<ReturnType<typeof runOfflineEvaluationGates>> | null = null;
      let capturedAt: string | null = null;
      let noDataReason = 'offline-evaluation-unavailable';
      try {
        const candidate = await runOfflineEvaluationGates();
        const hasProvenance =
          Boolean(candidate.corpus.sourceSha?.trim()) &&
          Boolean(candidate.corpus.fixtureHash?.trim()) &&
          SHA256_HEX_REGEX.test(candidate.corpus.reportSha256) &&
          SHA256_HEX_REGEX.test(candidate.gates.reportSha256) &&
          SHA256_HEX_REGEX.test(candidate.ablation.reportSha256) &&
          candidate.corpus.runCount > 0 &&
          candidate.gates.gateIds.length > 0 &&
          candidate.ablation.arms.length > 0;
        if (!candidate.ok || candidate.checks.some((check) => !check.passed)) {
          noDataReason = 'offline-evaluation-gates-failed';
        } else if (!hasProvenance) {
          noDataReason = 'offline-evaluation-provenance-invalid';
        } else {
          capturedAt = new Date().toISOString();
          // Persist the provenance of the report served to this operator.
          await recordAiAudit(ctx.userId, 'ai.eval_summary', ctx.companyId, 'read', {
            sourceSha: candidate.corpus.sourceSha,
            fixtureHash: candidate.corpus.fixtureHash,
            reportSha256: candidate.corpus.reportSha256,
            gatesReportSha256: candidate.gates.reportSha256,
            ablationReportSha256: candidate.ablation.reportSha256,
            capturedAt,
            mode: candidate.mode,
            syntheticFixture: candidate.syntheticFixture,
            realModelUsed: candidate.realModelUsed,
            checksPassed: candidate.checks.filter((check) => check.passed).length,
            checksTotal: candidate.checks.length,
          });
          report = candidate;
        }
      } catch {
        // Fail closed: no report means no verdicts, rates, or regression totals.
        noDataReason = 'offline-evaluation-unavailable';
      }

      if (!report || !capturedAt) {
        return {
          success: true,
          data: null,
          meta: { reason: noDataReason, companyId: ctx.companyId, counts },
        };
      }

      return {
        success: true,
        data: {
          companyId: ctx.companyId,
          agiClaimed: report.gates.agiClaimed,
          counts,
          // The offline contract verifies the evaluation harness against
          // deterministic fixtures. It does NOT evaluate a live model or a
          // production deployment, so no PASS verdict, pass rate, readiness
          // level or regression total is inferred from fixture output.
          reportAvailable: true,
          sourceSha: report.corpus.sourceSha,
          fixtureHash: report.corpus.fixtureHash,
          reportSha256: report.corpus.reportSha256,
          capturedAt,
          offlineGate: {
            mode: report.mode,
            syntheticFixture: report.syntheticFixture,
            realModelUsed: report.realModelUsed,
            ok: report.ok,
            checks: report.checks,
            corpus: report.corpus,
            gatesReportSha256: report.gates.reportSha256,
            gateIds: report.gates.gateIds,
            ablationArms: report.ablation.arms,
            ablationReportSha256: report.ablation.reportSha256,
          },
          capabilityGates: report.gates.gateIds.map((gate) => ({
            gate,
            label: AI_EVAL_GATE_LABELS[gate] ?? gate,
            passed: null,
            safetyRegressions: null,
          })),
          ablationConditions: Object.fromEntries(
            report.ablation.arms.map((arm) => [arm, { passRate: null, harmRate: null }])
          ),
        },
      };
    });
  }
};
