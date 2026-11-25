import { createHash } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAddons, type Addon } from '@moonwitness/orm';
import {
  Company,
  CompanyMembership,
  Partner,
  User,
  manifest as baseManifest,
} from '@moonwitness/orm-base';
import { Job, jobsManifest } from '@moonwitness/jobs';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import { manifest as storageManifest } from '@moonwitness/orm-storage';
import { manifest as notificationManifest } from '../../orm-notification/dist/index.js';
import { manifest as requestManifest } from '../../orm-request/dist/index.js';
import { manifest as integrationManifest } from '../../orm-integration/dist/index.js';
import { manifest as knowledgeManifest } from '../../orm-knowledge/dist/index.js';
import {
  Agent,
  AgentRun,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  ProviderProfile,
  WorkContract,
  manifest as aiManifest,
} from '../src/index.js';
import {
  TOOL_AUDIT_MODEL,
  createDurableAgentRunStateStore,
  createDurableCapabilityGrantStore,
  createDurableToolAuditSink,
  createDurableToolEffectStore,
  createDurableToolQuotaStore,
} from '../src/durable-ports.js';

const ADDONS: readonly Addon[] = [
  baseManifest,
  organizationManifest,
  jobsManifest,
  notificationManifest,
  workflowManifest,
  requestManifest,
  integrationManifest,
  storageManifest,
  knowledgeManifest,
  aiManifest,
];

let db: Knex;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function createCoreStack(suffix: string) {
  const company = await Company.query().insertAndFetch({ name: `Durable ${suffix}` });
  const partner = await Partner.query().insertAndFetch({
    name: `Partner ${suffix}`,
    company_id: company.id,
    active: true,
  });
  const user = await User.query().insertAndFetch({
    login: `user_${suffix}`,
    role: 'user',
    partner_id: partner.id,
    active: true,
  });
  await CompanyMembership.query().insert({
    user_id: user.id,
    company_id: company.id,
    is_default: true,
  });
  const provider = await ProviderProfile.query().insertAndFetch({
    company_id: company.id,
    code: `provider_${suffix}`,
    name: `Provider ${suffix}`,
    kind: 'ollama',
    endpoint_url: 'http://127.0.0.1:11434',
    secret_ref: 'MW_AI_LOCAL_UNUSED',
    data_classification: 'local_only',
    enabled: true,
  });
  const model = await ModelProfile.query().insertAndFetch({
    company_id: company.id,
    provider_profile_id: provider.id,
    code: `model_${suffix}`,
    name: `Model ${suffix}`,
    model_id: 'qwen2.5:7b',
    supports_tools: true,
    supports_structured_output: true,
    enabled: true,
  });
  const policy = await ExecutionPolicy.query().insertAndFetch({
    company_id: company.id,
    code: `policy_${suffix}`,
    policy_version: 1,
    name: `Policy ${suffix}`,
    default_risk_tier: 'R0',
    max_risk_tier: 'R1',
    allowed_classification: 'local_only',
    allow_cloud_fallback: false,
    require_independent_review: true,
    max_delegation_depth: 2,
    enabled: true,
  });
  const agent = await Agent.query().insertAndFetch({
    company_id: company.id,
    code: `agent_${suffix}`,
    status: 'active',
    role_template: 'researcher',
    is_emergency_stopped: false,
  });
  const contract = await WorkContract.query().insertAndFetch({
    company_id: company.id,
    code: `contract_${suffix}`,
    title: `Contract ${suffix}`,
    objective: 'Verify durable tool ports',
    execution_policy_id: policy.id,
    requested_by_id: user.id,
    assigned_agent_id: agent.id,
    risk_tier: 'R0',
    data_classification: 'local_only',
    status: 'draft',
  });
  const grant = await CapabilityGrant.query().insertAndFetch({
    company_id: company.id,
    agent_id: agent.id,
    work_contract_id: contract.id,
    execution_policy_id: policy.id,
    capability: 'repo.read@v1',
    scope_json: JSON.stringify({ allowedPaths: ['src'], allowWrite: false }),
    policy_version: 1,
    issued_by_id: user.id,
    issued_at: '2026-11-22T00:00:00.000Z',
    expires_at: '2027-11-22T00:00:00.000Z',
    status: 'active',
  });
  const job = await Job.query().insertAndFetch({
    company_id: company.id,
    handler: 'ai.agent_run.inspect',
    payload: JSON.stringify({ workContractId: contract.id }),
    idempotency_key: `job-${suffix}`,
    status: 'running',
    fencing_token: 7,
    available_at: '2026-11-22T00:00:00.000Z',
  });
  const run = await AgentRun.query().insertAndFetch({
    company_id: company.id,
    work_contract_id: contract.id,
    agent_id: agent.id,
    capability_grant_id: grant.id,
    provider_profile_id: provider.id,
    model_profile_id: model.id,
    execution_policy_id: policy.id,
    job_id: job.id,
    idempotency_key: `run-${suffix}`,
    correlation_id: `corr-${suffix}`,
    status: 'running',
    fencing_token: 7,
  });
  return { company, user, grant, run };
}

beforeEach(async () => {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      afterCreate(
        connection: { pragma(sql: string): unknown },
        done: (error: Error | null, connection: unknown) => void
      ) {
        connection.pragma('foreign_keys = ON');
        done(null, connection);
      },
    },
  });
  Model.knex(db);
  await installAddons(db, ADDONS);
});

afterEach(async () => {
  await db.destroy();
});

describe('durable ai-runtime ports (orm-ai)', () => {
  it('shares tool effect idempotency across two store instances', async () => {
    const { company, run } = await createCoreStack('effects');
    const scope = {
      companyId: company.id,
      agentRunId: run.id,
      fencingToken: 7,
    };
    const writer = createDurableToolEffectStore(scope);
    const reader = createDurableToolEffectStore(scope);
    const key = `repo.read@v1:${digest('key-1')}`;
    const argsDigest = digest('args-1');

    await writer.acknowledge({
      key,
      argsDigest,
      output: { ok: true, value: 'first' },
      auditRef: 'audit-1',
    });

    const found = await reader.find(key);
    expect(found?.argsDigest).toBe(argsDigest);
    expect(found?.output).toEqual({ ok: true, value: 'first' });

    // Replaying the same key with the same arguments is a no-op.
    await expect(
      reader.acknowledge({ key, argsDigest, output: { ok: true, value: 'ignored' }, auditRef: 'x' })
    ).resolves.toBeUndefined();
    expect((await reader.find(key))?.output).toEqual({ ok: true, value: 'first' });

    // Reusing the key with different arguments is rejected (durable conflict).
    await expect(
      reader.acknowledge({
        key,
        argsDigest: digest('different-args'),
        output: {},
        auditRef: 'y',
      })
    ).rejects.toThrow(/idempotency key/i);
  });

  it('shares harness checkpoints and committed results across two state stores', async () => {
    const { company, run } = await createCoreStack('state');
    const scope = { companyId: company.id, agentRunId: run.id, fencingToken: 7 };
    const writer = createDurableAgentRunStateStore(scope);
    const reader = createDurableAgentRunStateStore(scope);

    const checkpoint = {
      runId: String(run.id),
      companyId: company.id,
      idempotencyKey: 'idem-state',
      fencingToken: 7,
      stepIndex: 2,
      nextStepIndex: 3,
      toolCallsCount: 1,
      messages: [],
      steps: [],
      accumulatedUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      savedAt: '2026-11-22T00:00:00.000Z',
      checkpointSha256: digest('checkpoint-2'),
    } as const;

    await writer.saveCheckpoint(checkpoint);
    expect((await reader.loadCheckpoint(String(run.id)))?.checkpointSha256).toBe(
      checkpoint.checkpointSha256
    );

    const record = {
      runId: String(run.id),
      companyId: company.id,
      idempotencyKey: 'idem-state',
      fencingToken: 7,
      envelope: {
        runId: String(run.id),
        correlationId: 'corr-state',
        workContractId: String(run.work_contract_id),
        status: 'completed',
        summary: 'done',
        findings: [],
        evidenceReferences: [],
        limitations: [],
        providerMetadata: {
          providerId: 'p',
          providerKind: 'ollama',
          modelName: 'm',
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
        stepsExecuted: 2,
        resumedFromCheckpoint: false,
        artifactSha256: digest('artifact'),
      },
      committedAt: '2026-11-22T00:00:01.000Z',
      artifactSha256: digest('artifact'),
    } as const;

    await writer.commitRunResult(record);
    expect(
      (await reader.getCommittedByIdempotencyKey(company.id, 'idem-state'))?.artifactSha256
    ).toBe(record.artifactSha256);

    expect(await reader.verifyLease(String(run.id), 7)).toEqual({ valid: true, fencingToken: 7 });
    expect(await reader.verifyLease(String(run.id), 6)).toMatchObject({
      valid: false,
      reason: 'stale_fencing_token',
    });
  });

  it('resolves capability grants and active policy versions', async () => {
    const { company, grant } = await createCoreStack('grants');
    const store = createDurableCapabilityGrantStore();

    const grants = await store.resolveGrantsForExecution({
      companyId: company.id,
      agentId: grant.agent_id,
      capability: 'repo.read@v1',
      workContractId: String(grant.work_contract_id),
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope.allowedPaths).toEqual(['src']);
    expect(grants[0]?.policyVersion).toBe(1);
    expect(await store.getCurrentPolicyVersion(company.id)).toBe(1);
  });

  it('derives per-run quota from the append-only tool audit trail', async () => {
    const { company, grant, run } = await createCoreStack('audit');
    const sink = createDurableToolAuditSink();
    const quota = createDurableToolQuotaStore();
    const runId = String(run.id);
    const grantId = String(grant.id);
    const entry = {
      auditRef: 'audit-ref',
      timestamp: '2026-11-22T00:00:00.000Z',
      allowed: true,
      companyId: company.id,
      actorType: 'agent' as const,
      actorId: grant.agent_id,
      runId,
      correlationId: 'corr-audit',
      toolName: 'workspace.read',
      capability: 'workspace.read@v1',
      riskTier: 'R0' as const,
      grantId,
      policyVersion: 1,
      reasonCode: 'ALLOWED',
      idempotentReplay: false,
    };

    expect(await quota.getRunUsage(runId, grantId)).toBe(0);
    await sink.record(entry);
    await sink.record({ ...entry, auditRef: 'audit-ref-2' });
    expect(await quota.getRunUsage(runId, grantId)).toBe(2);
    expect(await quota.getRunUsage(runId, 'other-grant')).toBe(0);

    const deniedCount = await db<{ count: number | string }>('audit_logs')
      .where({ model: TOOL_AUDIT_MODEL, operation: 'tool.denied' })
      .count<{ count: number | string }[]>('id as count');
    expect(Number(deniedCount[0]?.count ?? 0)).toBe(0);
  });
});
