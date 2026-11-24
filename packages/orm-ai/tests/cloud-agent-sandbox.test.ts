import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CapabilityGateway,
  WORKSPACE_CONTRACT_VERSION,
  buildEphemeralSandboxManifest,
  type WorkspaceCheckResult,
  type WorkspaceCreateParams,
  type WorkspaceEvidenceBundle,
  type WorkspaceInfo,
  type WorkspaceSandboxClient,
} from '@moonwitness/ai-runtime';
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
import { LocalFileAttachmentStorage, manifest as storageManifest } from '@moonwitness/orm-storage';
import { manifest as notificationManifest } from '../../orm-notification/dist/index.js';
import { manifest as requestManifest } from '../../orm-request/dist/index.js';
import { manifest as integrationManifest } from '../../orm-integration/dist/index.js';
import { manifest as knowledgeManifest } from '../../orm-knowledge/dist/index.js';
import {
  Agent,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  ProviderProfile,
  WorkContract,
  manifest as aiManifest,
} from '../src/index.js';
import {
  buildAndVerifyWorkspaceEvidence,
  persistEvidenceBundle,
  setupCloudAgentSandbox,
} from '../src/cloud-agent-sandbox.js';
import { CLOUD_AGENT_MANIFEST_COMMAND } from '../src/cloud-agent-defaults.js';
import { ARTIFACT_VERIFICATION_STATUSES } from '../src/models/constants.js';

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

const PINNED_IMAGE_REF = `registry.example.com/mw/sandbox@sha256:${'b'.repeat(64)}`;
const BASE_COMMIT = 'a'.repeat(40);

let db: Knex;
let storageDir: string;

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'mw-cloud-agent-'));
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
  await rm(storageDir, { recursive: true, force: true });
});

async function createCoreStack(suffix: string) {
  const company = await Company.query().insertAndFetch({ name: `Cloud ${suffix}` });
  const partner = await Partner.query().insertAndFetch({
    name: `Partner ${suffix}`,
    company_id: company.id,
    active: true,
  });
  const user = await User.query().insertAndFetch({
    login: `user_${suffix}_${randomUUID().slice(0, 8).replaceAll('-', '')}`,
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
    objective: 'Verify cloud agent sandbox evidence persistence',
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
    issued_at: '2026-11-24T00:00:00.000Z',
    expires_at: '2027-11-24T00:00:00.000Z',
    status: 'active',
  });
  const job = await Job.query().insertAndFetch({
    company_id: company.id,
    handler: 'ai.agent_run.inspect',
    payload: JSON.stringify({ workContractId: contract.id }),
    idempotency_key: `job-${suffix}-${randomUUID().slice(0, 8)}`,
    status: 'queued',
    available_at: '2026-11-24T00:00:00.000Z',
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
    idempotency_key: `run-${suffix}-${randomUUID().slice(0, 8)}`,
    correlation_id: `corr-${suffix}`,
    status: 'running',
    fencing_token: 7,
  });
  return { company, user, grant, run };
}

function createFakeSandboxClient(): {
  readonly client: WorkspaceSandboxClient;
  readonly createCalls: WorkspaceCreateParams[];
} {
  const createCalls: WorkspaceCreateParams[] = [];
  const defaultCheck: WorkspaceCheckResult = {
    runId: 'run-fake',
    check: 'node-test',
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: false,
    stdout: 'ok',
    stderr: '',
    stdoutBytes: 2,
    stderrBytes: 0,
    totalOutputBytes: 2,
  };

  const workspaceInfo = (params: {
    readonly runId: string;
    readonly snapshotId?: string;
    readonly baseCommit?: string;
    readonly imageRef?: string;
    readonly allowedPaths?: readonly string[];
    readonly cpuCores?: number;
    readonly memoryMb?: number;
    readonly pidsLimit?: number;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
  }): WorkspaceInfo => ({
    contractVersion: WORKSPACE_CONTRACT_VERSION,
    runId: params.runId,
    workspaceId: `ws-${params.runId}`,
    snapshotId: params.snapshotId ?? 'snap-1',
    baseCommit: params.baseCommit ?? BASE_COMMIT,
    imageRef: params.imageRef ?? PINNED_IMAGE_REF,
    engine: 'rootless-docker',
    status: 'active',
    allowedPaths: params.allowedPaths ?? ['src'],
    limits: {
      cpuCores: params.cpuCores ?? 0.5,
      memoryMb: params.memoryMb ?? 512,
      pidsLimit: params.pidsLimit ?? 64,
      timeoutMs: params.timeoutMs ?? 30_000,
      maxOutputBytes: params.maxOutputBytes ?? 1_048_576,
    },
    manifestSha256: 'e'.repeat(64),
    headCommit: params.baseCommit ?? BASE_COMMIT,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  });

  const client: WorkspaceSandboxClient = {
    createWorkspace: async (params) => {
      createCalls.push(params);
      return workspaceInfo(params);
    },
    snapshotWorkspace: async (params) => ({
      runId: params.runId,
      snapshotId: params.label ?? 'snap-1',
      base: false,
      treeSha256: 'f'.repeat(64),
      sizeBytes: 0,
      createdAt: '2026-11-24T00:00:00.000Z',
    }),
    executeCheck: async (params) => ({
      ...defaultCheck,
      runId: params.runId,
      check: params.check,
    }),
    listWorkspace: async (params) => ({
      runId: params.runId,
      paths: ['src/app.ts'],
      truncated: false,
    }),
    readWorkspaceFile: async (params) => ({
      runId: params.runId,
      path: params.path,
      content: 'export const ok = true;\n',
      sizeBytes: 23,
      truncated: false,
    }),
    applyWorkspacePatch: async (params) => ({
      runId: params.runId,
      files: params.operations.map((operation) => operation.path),
    }),
    diffWorkspace: async (params) => ({
      runId: params.runId,
      headCommit: BASE_COMMIT,
      clean: false,
      scopeClean: true as const,
      files: [{ path: 'src/app.ts', status: 'M' }],
      unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts\n+export const ok = true;\n',
      diffSha256: 'c'.repeat(64),
      sizeBytes: 64,
      truncated: false as const,
    }),
    commitLocal: async (params) => ({
      runId: params.runId,
      commitSha: 'd'.repeat(40),
      branch: 'local-work',
      files: [],
      message: params.message,
      pushed: false as const,
    }),
    rollbackWorkspace: async (params) => workspaceInfo({ runId: params.runId }),
    cancelWorkspace: async (params) => ({
      runId: params.runId,
      status: 'cancelled' as const,
      cancelledAt: '2026-11-24T00:00:00.000Z',
    }),
    destroyWorkspace: async (params) => ({
      runId: params.runId,
      status: 'destroyed' as const,
      destroyedAt: '2026-11-24T00:00:00.000Z',
    }),
    getWorkspace: async (params) => workspaceInfo({ runId: params.runId }),
    reconcileWorkspaces: async () => ({
      removedWorkspaceIds: [],
      removedContainerIds: [],
      retainedWorkspaceIds: [],
    }),
  };
  return { client, createCalls };
}

function makeBundle(runId: string): WorkspaceEvidenceBundle {
  return {
    runId,
    check: 'node-test',
    passed: true,
    exitCode: 0,
    diffSha256: 'c'.repeat(64),
    verificationSha256: 'f'.repeat(64),
    evidenceSha256: '9'.repeat(64),
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  };
}

describe('setupCloudAgentSandbox', () => {
  it('creates a workspace with a pinned image and bounded default limits and registers tools', async () => {
    const gateway = new CapabilityGateway();
    const { client, createCalls } = createFakeSandboxClient();

    const setup = await setupCloudAgentSandbox({
      client,
      gateway,
      runId: 'run-cloud-1',
      allowedPaths: ['src', 'tests'],
      baseCommit: BASE_COMMIT,
      snapshotId: 'snap-base',
      imageRef: PINNED_IMAGE_REF,
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      runId: 'run-cloud-1',
      snapshotId: 'snap-base',
      imageRef: PINNED_IMAGE_REF,
      baseCommit: BASE_COMMIT,
      allowedPaths: ['src', 'tests'],
      cpuCores: 0.5,
      memoryMb: 512,
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
    });
    expect(setup.client).toBe(client);
    expect(setup.workspace.workspaceId).toBe('ws-run-cloud-1');
    expect(setup.manifest.imageRef).toBe(PINNED_IMAGE_REF);
    expect(setup.manifest.command).toEqual(CLOUD_AGENT_MANIFEST_COMMAND);
    expect(setup.tools).toContain('workspace.read');
    expect(setup.tools).toContain('workspace.list');
    expect(gateway.listRegisteredTools().map((tool) => tool.name)).toContain('workspace.read');
  });

  it('fails closed when the image reference is not pinned to a sha256 digest', async () => {
    const { client, createCalls } = createFakeSandboxClient();
    await expect(
      setupCloudAgentSandbox({
        client,
        gateway: new CapabilityGateway(),
        runId: 'run-cloud-2',
        allowedPaths: ['src'],
        baseCommit: BASE_COMMIT,
        snapshotId: 'snap-base',
        imageRef: 'registry.example.com/mw/sandbox:latest',
      })
    ).rejects.toThrow(/pinned/u);
    expect(createCalls).toHaveLength(0);
  });

  it('clamps out-of-range limits to the workspace contract bounds', async () => {
    const { client, createCalls } = createFakeSandboxClient();
    await setupCloudAgentSandbox({
      client,
      gateway: new CapabilityGateway(),
      runId: 'run-cloud-3',
      allowedPaths: ['src'],
      baseCommit: BASE_COMMIT,
      snapshotId: 'snap-base',
      imageRef: PINNED_IMAGE_REF,
      limits: {
        cpuCores: 99,
        memoryMb: 99_999,
        timeoutMs: 9_999_999,
        maxOutputBytes: 99_999_999,
      },
    });
    expect(createCalls[0]).toMatchObject({
      cpuCores: 4,
      memoryMb: 4096,
      timeoutMs: 120_000,
      maxOutputBytes: 1_048_576,
    });
  });

  it('passes the owner addon through to registered tools', async () => {
    const gateway = new CapabilityGateway();
    const { client } = createFakeSandboxClient();
    await setupCloudAgentSandbox({
      client,
      gateway,
      runId: 'run-cloud-4',
      allowedPaths: ['src'],
      baseCommit: BASE_COMMIT,
      snapshotId: 'snap-base',
      imageRef: PINNED_IMAGE_REF,
      ownerAddon: 'orm-ai',
    });
    expect(gateway.getTool('workspace.read')?.ownerAddon).toBe('orm-ai');
  });
});

describe('persistEvidenceBundle', () => {
  it('stores a deterministic bundle and a non-proposed ArtifactManifest row', async () => {
    const { company, run } = await createCoreStack('evidence');
    const storage = new LocalFileAttachmentStorage(storageDir);

    const result = await persistEvidenceBundle({
      storage,
      companyId: company.id,
      workContractId: run.work_contract_id,
      agentRunId: run.id,
      bundle: makeBundle(String(run.id)),
      dataClassification: 'cloud_eligible',
    });

    const stored = await storage.get(result.storageKey);
    expect(stored).not.toBeNull();
    expect(createHash('sha256').update(stored!).digest('hex')).toBe(result.sha256);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);

    const row = await ArtifactManifest.query().findOne({ storage_key: result.storageKey });
    expect(row).toBeDefined();
    expect(row?.artifact_kind).toBe('evidence_bundle');
    expect(row?.sha256).toBe(result.sha256);
    expect(row?.size_bytes).toBe(stored?.byteLength);
    expect(row?.mime_type).toBe('application/json');
    expect(row?.data_classification).toBe('cloud_eligible');
    expect(row?.verification_status).not.toBe('proposed');
    expect(ARTIFACT_VERIFICATION_STATUSES).toContain(row!.verification_status);
    expect(row?.company_id).toBe(company.id);
    expect(row?.work_contract_id).toBe(run.work_contract_id);
    expect(row?.agent_run_id).toBe(run.id);
  });

  it('produces the same digest for the same bundle with a fresh storage key', async () => {
    const { company, run } = await createCoreStack('determinism');
    const storage = new LocalFileAttachmentStorage(storageDir);
    const bundle = makeBundle(String(run.id));
    const options = {
      storage,
      companyId: company.id,
      workContractId: run.work_contract_id,
      agentRunId: run.id,
      bundle,
      dataClassification: 'cloud_eligible' as const,
    };

    const first = await persistEvidenceBundle(options);
    const second = await persistEvidenceBundle(options);

    expect(second.sha256).toBe(first.sha256);
    expect(second.storageKey).not.toBe(first.storageKey);
    expect(await storage.get(second.storageKey)).toEqual(await storage.get(first.storageKey));
  });
});

describe('buildAndVerifyWorkspaceEvidence', () => {
  it('delegates to the ai-runtime evidence builder', async () => {
    const { client } = createFakeSandboxClient();
    const manifest = buildEphemeralSandboxManifest({
      runId: 'run-cloud-5',
      imageRef: PINNED_IMAGE_REF,
      command: CLOUD_AGENT_MANIFEST_COMMAND,
      cpuCores: 0.5,
      memoryMb: 512,
      timeoutMs: 30_000,
    });
    const bundle = await buildAndVerifyWorkspaceEvidence({
      client,
      manifest,
      runId: 'run-cloud-5',
      check: 'node-test',
    });
    expect(bundle.passed).toBe(true);
    expect(bundle.automatedPromotionAllowed).toBe(false);
    expect(bundle.automatedSelfMerge).toBe(false);
  });
});
