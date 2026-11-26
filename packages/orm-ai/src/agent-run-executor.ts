import { createHash } from 'node:crypto';
import type { JobContext } from '@moonwitness/jobs';
import { Job } from '@moonwitness/jobs';
import {
  startWorkflow,
  transitionWorkflow,
  WorkflowInstance,
  type WorkflowRole,
} from '@moonwitness/orm-workflow';
import type { Knex } from 'knex';
import {
  Agent,
  AgentRun,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  ProviderProfile,
  WorkContract,
} from './models.js';
import { AgentRunEffect, ArtifactManifest } from './models/runs.js';
import { isAgentOperational, isActiveCapabilityGrant } from './validation.js';
import {
  sha256Canonical,
  toCanonicalJson as canonical,
} from '@moonwitness/ai-runtime/canonical-json.js';

export const EXECUTION_FINGERPRINT_VERSION = 1 as const;
export const AGENT_RUN_APPROVAL_WORKFLOW = 'ai.agent_run_approval' as const;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

export interface ExecutionFingerprintInput {
  readonly contract: { readonly id: number; readonly code: string; readonly revision?: number };
  readonly agent: { readonly id: number; readonly code: string };
  readonly grant: {
    readonly id: number;
    readonly policyVersion: number;
    readonly expiresAt?: string;
  };
  readonly provider: { readonly id: number; readonly code: string; readonly kind: string };
  readonly model: { readonly id: number; readonly modelId: string };
  readonly policy: { readonly id: number; readonly version: number; readonly maxRiskTier: string };
  readonly repository?: {
    readonly snapshotId?: string;
    readonly baseCommit?: string;
    readonly allowedPaths?: readonly string[];
  };
  readonly classification: string;
  readonly limits: Readonly<Record<string, number | string>>;
  readonly secretRefName: string;
  readonly promptSchema?: string;
  readonly toolVersions?: readonly string[];
}

/** Immutable, secret-free fingerprint covering every authority input. */
export function computeExecutionFingerprint(input: ExecutionFingerprintInput): string {
  return sha256Canonical({
    version: EXECUTION_FINGERPRINT_VERSION,
    contract: input.contract,
    agent: input.agent,
    grant: input.grant,
    provider: input.provider,
    model: input.model,
    policy: input.policy,
    repository: input.repository ?? {},
    classification: input.classification,
    limits: input.limits,
    secretRefName: input.secretRefName,
    promptSchema: input.promptSchema ?? 'default-v1',
    toolVersions: [...(input.toolVersions ?? ['workspace-tools@v1'])].sort(),
  });
}

export class StaleFencingError extends Error {
  readonly code = 'STALE_FENCING_TOKEN' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StaleFencingError';
  }
}

export class ApprovalRequiredError extends Error {
  readonly code = 'APPROVAL_REQUIRED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

export interface TrustedRunSnapshot {
  readonly runId: number;
  readonly companyId: number;
  readonly run: Record<string, unknown>;
  readonly fingerprint: string;
  readonly providerKind: string;
  readonly classification: string;
  readonly maxRiskTier: string;
  readonly allowedPaths: readonly string[];
  readonly secretRefName: string;
}

/**
 * Reconstructs the trusted execution snapshot from ORM rows. The queue payload
 * stays minimal ({ agentRunId, companyId }); no client-supplied configuration
 * is trusted for execution.
 */
export async function loadTrustedRunSnapshot(
  agentRunId: number,
  companyId: number
): Promise<TrustedRunSnapshot | null> {
  const run = await AgentRun.query().findOne({ id: agentRunId, company_id: companyId });
  if (!run) return null;
  const record = run as unknown as Record<string, unknown>;
  const resolved = await Promise.all([
    Agent.query().findOne({ id: run.agent_id, company_id: companyId }),
    // Reconstruct all authority inputs from the immutable run row; fail closed
    // if any related row is missing.
    WorkContract.query().findOne({ id: run.work_contract_id, company_id: companyId }),
    CapabilityGrant.query().findOne({ id: run.capability_grant_id, company_id: companyId }),
    ProviderProfile.query().findOne({ id: run.provider_profile_id, company_id: companyId }),
    ModelProfile.query().findOne({ id: run.model_profile_id, company_id: companyId }),
    ExecutionPolicy.query().findOne({ id: run.execution_policy_id, company_id: companyId }),
  ]);
  const [agent, contract, grant, provider, model, policyRow] = resolved;
  if (!agent || !contract || !grant || !provider || !model || !policyRow) return null;

  const scope = (grant as unknown as Record<string, unknown>).scope_json;
  let allowedPaths: string[] = [];
  if (typeof scope === 'string') {
    try {
      const parsed = JSON.parse(scope) as { allowedPaths?: unknown };
      if (Array.isArray(parsed.allowedPaths)) {
        allowedPaths = parsed.allowedPaths.filter((p): p is string => typeof p === 'string');
      }
    } catch {
      allowedPaths = [];
    }
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
    model: { id: model.id, modelId: String(model.model_id) },
    policy: {
      id: policyRow.id,
      version: Number(policyRow.policy_version ?? 0),
      maxRiskTier: String(policyRow.max_risk_tier ?? 'R0'),
    },
    repository: {
      snapshotId: typeof record.snapshot_id === 'string' ? record.snapshot_id : undefined,
      baseCommit: typeof record.base_commit === 'string' ? record.base_commit : undefined,
      allowedPaths,
    },
    classification: String(contract.data_classification ?? 'local_only'),
    limits: {
      maxSteps: Number(policyRow.max_steps ?? 0),
      maxTokens: Number(policyRow.max_tokens_per_run ?? 0),
      maxCostMicros: Number(policyRow.max_cost_micros_per_run ?? 0),
    },
    secretRefName: String(provider.secret_ref ?? ''),
  });
  return {
    runId: run.id,
    companyId: companyId,
    run: record,
    fingerprint,
    providerKind: String(provider.kind),
    classification: String(contract.data_classification ?? 'local_only'),
    maxRiskTier: String(policyRow.max_risk_tier ?? 'R0'),
    allowedPaths,
    secretRefName: String(provider.secret_ref ?? ''),
  };
}

/** Verifies the job lease/fencing authority before any run state change. */
export async function assertCurrentFencing(params: {
  readonly run: Record<string, unknown>;
  readonly jobId: number | undefined;
  readonly companyId: number;
  readonly expectedFencingToken?: number;
  readonly db?: Knex;
}): Promise<number> {
  const runJobId = Number(params.run.job_id ?? 0);
  if (!Number.isSafeInteger(runJobId) || runJobId < 1 || runJobId !== params.jobId) {
    throw new StaleFencingError('Job identifier does not match the run lease');
  }
  const jobQuery = Job.query(params.db);
  if (params.db) jobQuery.forUpdate();
  const job = await jobQuery.findById(runJobId);
  if (!job || job.company_id !== params.companyId) {
    throw new StaleFencingError('Job lease is missing or belongs to another company');
  }
  const runToken = Number(params.run.fencing_token ?? 0);
  const expectedFencingToken = params.expectedFencingToken ?? runToken;
  const jobToken = Number((job as unknown as Record<string, unknown>).fencing_token ?? 0);
  if (
    !Number.isSafeInteger(runToken) ||
    runToken < 0 ||
    !Number.isSafeInteger(expectedFencingToken) ||
    expectedFencingToken < 0 ||
    runToken > expectedFencingToken ||
    !Number.isSafeInteger(jobToken) ||
    jobToken !== expectedFencingToken
  ) {
    throw new StaleFencingError('Job fencing token does not exactly match the claimed lease');
  }
  return jobToken;
}

export interface DurableRunEffects {
  /** Called at most once per run; its compact result is checkpointed on AgentRun. */
  execute(snapshot: TrustedRunSnapshot, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export interface DurableRunResult {
  readonly status: 'completed' | 'cancelled' | 'failed' | 'replayed';
  readonly agentRunId: number;
  readonly fingerprint?: string;
}

function parseCheckpoint(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Durable, idempotent, fenced agent-run executor. A completed-run replay
 * performs no inference, no tool effect and no artifact write.
 */
export async function runDurableAgentRun(
  payload: { agentRunId: number; companyId: number },
  context: Pick<JobContext, 'jobId' | 'fencingToken' | 'companyId' | 'signal'>,
  effects: DurableRunEffects
): Promise<DurableRunResult> {
  if (context.companyId !== payload.companyId) {
    throw new StaleFencingError('Job company does not match run company');
  }
  const snapshot = await loadTrustedRunSnapshot(payload.agentRunId, payload.companyId);
  if (!snapshot) return { status: 'replayed', agentRunId: payload.agentRunId };

  // The fingerprint was approved at creation time with repository inputs. A
  // mismatch here means the execution authority changed after approval: fail
  // closed and leave the stored value untouched (never silently overwrite it).
  const storedFingerprint = snapshot.run.execution_fingerprint;
  if (
    typeof storedFingerprint === 'string' &&
    FINGERPRINT_PATTERN.test(storedFingerprint) &&
    storedFingerprint !== snapshot.fingerprint
  ) {
    throw new StaleFencingError('Execution fingerprint changed after approval');
  }

  const status = String(snapshot.run.status ?? 'pending');
  if (TERMINAL_STATUSES.has(status)) {
    return {
      status: 'replayed',
      agentRunId: payload.agentRunId,
      fingerprint: snapshot.fingerprint,
    };
  }
  const expectedFencingToken = context.fencingToken;
  if (!Number.isSafeInteger(expectedFencingToken) || expectedFencingToken < 1) {
    throw new StaleFencingError('A valid claimed job fencing token is required');
  }
  await assertCurrentFencing({
    run: snapshot.run,
    jobId: context.jobId,
    companyId: payload.companyId,
    expectedFencingToken,
  });

  if (context.signal.aborted || status === 'cancelled') {
    await AgentRun.query()
      .where({ id: snapshot.runId, company_id: payload.companyId })
      .patch({ status: 'cancelled', finished_at: new Date().toISOString() });
    return { status: 'cancelled', agentRunId: snapshot.runId, fingerprint: snapshot.fingerprint };
  }
  const agent = await Agent.query().findOne({
    id: snapshot.run.agent_id,
    company_id: payload.companyId,
  });
  if (!agent || !isAgentOperational(agent as never)) {
    await AgentRun.query().where({ id: snapshot.runId, company_id: payload.companyId }).patch({
      status: 'cancelled',
      error_code: 'AGENT_HALTED',
      error_summary: 'Agent is not active or has been emergency-stopped',
      finished_at: new Date().toISOString(),
    });
    return { status: 'cancelled', agentRunId: snapshot.runId, fingerprint: snapshot.fingerprint };
  }

  const startedAt =
    typeof snapshot.run.started_at === 'string'
      ? snapshot.run.started_at
      : new Date().toISOString();
  const claimed = await AgentRun.query()
    .where({ id: snapshot.runId, company_id: payload.companyId })
    .where((query) =>
      query
        .where({ status: 'pending' })
        .orWhere((running) =>
          running.where({ status: 'running' }).where('fencing_token', '<', expectedFencingToken)
        )
    )
    .patch({
      status: 'running',
      fencing_token: expectedFencingToken,
      started_at: startedAt,
      execution_fingerprint: snapshot.fingerprint,
    });
  if (claimed !== 1) {
    return { status: 'replayed', agentRunId: snapshot.runId, fingerprint: snapshot.fingerprint };
  }
  const claimedSnapshot: TrustedRunSnapshot = {
    ...snapshot,
    run: {
      ...snapshot.run,
      status: 'running',
      fencing_token: expectedFencingToken,
      started_at: startedAt,
      execution_fingerprint: snapshot.fingerprint,
    },
  };

  try {
    await assertCurrentFencing({
      run: claimedSnapshot.run,
      jobId: context.jobId,
      companyId: payload.companyId,
      expectedFencingToken,
    });
    const effectResult = await effects.execute(claimedSnapshot, context.signal);
    // Effects may report a non-throwing terminal status. Only an explicit
    // failure/cancellation (or an exhausted budget) is terminal-failure; an
    // effect with no status stays backward compatible as 'completed'.
    const reportedStatus =
      typeof effectResult?.status === 'string' ? effectResult.status : undefined;
    const terminalStatus: 'completed' | 'failed' | 'cancelled' =
      reportedStatus === 'cancelled'
        ? 'cancelled'
        : reportedStatus === 'failed' || reportedStatus === 'budget_exhausted'
          ? 'failed'
          : 'completed';
    if (terminalStatus === 'completed') {
      if (
        typeof effectResult.evidenceSha256 !== 'string' ||
        !FINGERPRINT_PATTERN.test(effectResult.evidenceSha256)
      ) {
        throw new Error('Completion requires a valid persisted evidence SHA-256');
      }
      const evidence = await ArtifactManifest.query().findOne({
        company_id: payload.companyId,
        work_contract_id: claimedSnapshot.run.work_contract_id,
        agent_run_id: snapshot.runId,
        sha256: effectResult.evidenceSha256,
        artifact_kind: 'evidence_bundle',
      });
      if (
        evidence === undefined ||
        (evidence.verification_status !== 'checked' &&
          evidence.verification_status !== 'accepted') ||
        evidence.stale_at !== null
      ) {
        throw new Error('Completion requires matching checked persisted evidence');
      }
    }
    const effectError =
      typeof effectResult?.error === 'object' && effectResult.error !== null
        ? (effectResult.error as Record<string, unknown>)
        : undefined;
    const checkpoint = {
      ...parseCheckpoint(claimedSnapshot.run.checkpoint_json),
      fingerprint: snapshot.fingerprint,
      lastEffect: effectResult,
    };
    const patch: {
      status: 'completed' | 'failed' | 'cancelled';
      finished_at: string;
      step_count: number;
      checkpoint_json: string;
      checkpoint_cursor: string;
      error_code?: string;
      error_summary?: string;
    } = {
      status: terminalStatus,
      finished_at: new Date().toISOString(),
      step_count: Number(claimedSnapshot.run.step_count ?? 0) + 1,
      checkpoint_json: JSON.stringify(checkpoint),
      checkpoint_cursor: snapshot.fingerprint,
    };
    if (terminalStatus !== 'completed') {
      patch.error_code = String(effectError?.code ?? reportedStatus ?? terminalStatus).slice(0, 64);
      patch.error_summary = String(
        effectError?.message ?? `Effect reported status ${String(reportedStatus)}`
      ).slice(0, 2_000);
    }
    const committed = await AgentRun.query()
      .where({
        id: snapshot.runId,
        company_id: payload.companyId,
        status: 'running',
        fencing_token: expectedFencingToken,
      })
      .patch(patch);
    if (committed !== 1) {
      throw new StaleFencingError('Run changed while effects were executing');
    }
    return {
      status: terminalStatus,
      agentRunId: snapshot.runId,
      fingerprint: snapshot.fingerprint,
    };
  } catch (error) {
    const code = error instanceof Error ? error.name : 'EXECUTION_FAILED';
    await AgentRun.query()
      .where({
        id: snapshot.runId,
        company_id: payload.companyId,
        status: 'running',
        fencing_token: expectedFencingToken,
      })
      .patch({
        status: 'failed',
        error_code: code.slice(0, 64),
        error_summary: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        finished_at: new Date().toISOString(),
      });
    throw error;
  }
}

/** Durable, idempotent acknowledgement of a side-effecting tool call. */
export async function acknowledgeToolEffect(params: {
  readonly companyId: number;
  readonly agentRunId: number;
  readonly effectKey: string;
  readonly argsDigest: string;
  readonly output: unknown;
  readonly fencingToken: number;
  readonly db?: Knex;
}): Promise<{ readonly replayed: boolean; readonly output: unknown }> {
  const values = {
    company_id: params.companyId,
    agent_run_id: params.agentRunId,
    effect_key: params.effectKey,
    args_sha256: params.argsDigest,
    output_json: JSON.stringify(params.output ?? null),
    fencing_token: params.fencingToken,
  };
  return AgentRun.transaction(async (trx) => {
    const runQuery = AgentRun.query(trx).forUpdate();
    const run = await runQuery.findOne({
      id: params.agentRunId,
      company_id: params.companyId,
    });
    if (!run || TERMINAL_STATUSES.has(String(run.status))) {
      throw new StaleFencingError('Run is missing or terminal; effects cannot be acknowledged');
    }
    const currentToken = Number(run.fencing_token ?? -1);
    if (
      !Number.isSafeInteger(params.fencingToken) ||
      params.fencingToken < 1 ||
      currentToken !== params.fencingToken ||
      Number(run.job_id ?? 0) < 1
    ) {
      throw new StaleFencingError('Effect fencing token is stale');
    }
    await assertCurrentFencing({
      run: run as unknown as Record<string, unknown>,
      jobId: Number(run.job_id),
      companyId: params.companyId,
      expectedFencingToken: params.fencingToken,
      db: trx,
    });
    const existing = await AgentRunEffect.query(trx).findOne({
      company_id: params.companyId,
      agent_run_id: params.agentRunId,
      effect_key: params.effectKey,
    });
    if (existing) {
      if (existing.args_sha256 !== params.argsDigest) {
        throw new StaleFencingError('Effect idempotency key was reused with different arguments');
      }
      return {
        replayed: true,
        output: existing.output_json ? JSON.parse(existing.output_json) : null,
      };
    }
    try {
      await AgentRunEffect.query(trx).insert(values);
    } catch {
      const raced = await AgentRunEffect.query(trx).findOne({
        company_id: params.companyId,
        agent_run_id: params.agentRunId,
        effect_key: params.effectKey,
      });
      if (!raced || raced.args_sha256 !== params.argsDigest) {
        throw new StaleFencingError('Effect conflict');
      }
      return {
        replayed: true,
        output: raced.output_json ? JSON.parse(raced.output_json) : null,
      };
    }
    return { replayed: false, output: params.output };
  });
}

/** Atomically gate enqueueing on a durable, single-use R3 workflow approval. */
export async function enqueueApprovedAgentRun(params: {
  readonly db: Knex;
  readonly instanceId: number;
  readonly companyId: number;
  readonly actorId: number;
  readonly role: WorkflowRole;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly runId: number;
  readonly enqueue: (runId: number, companyId: number, idempotencyKey: string) => Promise<number>;
}): Promise<{ readonly jobId: number; readonly instance: unknown }> {
  const state = await transitionWorkflow(params.db, {
    instanceId: params.instanceId,
    companyId: params.companyId,
    actorId: params.actorId,
    role: params.role,
    action: 'approve',
    expectedRevision: params.expectedRevision,
    idempotencyKey: `run-approval-${params.idempotencyKey}`.slice(0, 127),
    payload: { runId: params.runId, fingerprintRef: params.idempotencyKey },
  });
  const finalStates = new Set(['approved', 'accepted', 'completed']);
  if (!finalStates.has(String(state.currentState)) || String(state.status) !== 'completed') {
    throw new ApprovalRequiredError('Approval transition did not reach an approved terminal state');
  }
  const jobId = await params.enqueue(params.runId, params.companyId, params.idempotencyKey);
  return { jobId, instance: state };
}

export async function startAgentRunApproval(params: {
  readonly db: Knex;
  readonly companyId: number;
  readonly actorId: number;
  readonly role: WorkflowRole;
  readonly runId: number;
  readonly fingerprint: string;
}): Promise<Awaited<ReturnType<typeof startWorkflow>>> {
  const instance = await startWorkflow(params.db, {
    code: AGENT_RUN_APPROVAL_WORKFLOW,
    companyId: params.companyId,
    actorId: params.actorId,
    role: params.role,
    resourceModel: AgentRun.modelName,
    resourceId: params.runId,
    idempotencyKey: `run-approval-start-${params.fingerprint}`.slice(0, 127),
  });
  return instance;
}

export { isActiveCapabilityGrant };
