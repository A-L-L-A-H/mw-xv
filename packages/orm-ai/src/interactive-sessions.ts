import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { cancelJob, enqueueJob, Job, OutboxEvent, registerOutboxConsumer } from '@moonwitness/jobs';
import { sha256Canonical } from '@moonwitness/ai-runtime/canonical-json.js';
import { computeExecutionFingerprint, isActiveCapabilityGrant } from './agent-run-executor.js';
import { hasCompanyAccess } from './company-access.js';
import {
  Agent,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  ProviderProfile,
  WorkContract,
} from './models.js';
import {
  InteractiveSession,
  InteractiveSessionApproval,
  InteractiveSessionCommand,
  InteractiveSessionEvent,
  type InteractiveCommandType,
  type InteractiveSessionStatus,
} from './models/interactive-sessions.js';

export const INTERACTIVE_EXECUTE_INTENT = 'ai.interactive_session.execute' as const;
export const INTERACTIVE_PAUSE_INTENT = 'ai.interactive_session.pause' as const;
export const INTERACTIVE_MAX_PROMPT_BYTES = 8_192;
export const INTERACTIVE_MAX_EVENTS = 200;
export const INTERACTIVE_APPROVAL_TTL_MS = 15 * 60_000;
const INTERACTIVE_COMPLETION_CAPABILITY = 'session.complete@v1';
const TERMINAL = new Set<InteractiveSessionStatus>(['completed', 'failed', 'cancelled']);
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const SECRET_PATTERN = /\b(?:sk-[a-z0-9_-]{8,}|Bearer\s+[a-z0-9._~+/-]+|MW_AI_[A-Z0-9_]+)\b/giu;

export class InteractiveSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409
  ) {
    super(message);
    this.name = 'InteractiveSessionError';
  }
}

export interface InteractiveScope {
  readonly companyId: number;
  readonly userId: number;
}

export interface InteractiveCommandInput {
  readonly idempotencyKey: string;
  readonly type: InteractiveCommandType;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface InteractiveCreateInput extends InteractiveScope {
  readonly agentId: number;
  readonly workContractId: number;
  readonly initialPrompt: string;
  readonly idempotencyKey: string;
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InteractiveSessionError('INVALID_INPUT', `${label} is required`, 422);
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > INTERACTIVE_MAX_PROMPT_BYTES) {
    throw new InteractiveSessionError('INPUT_TOO_LARGE', `${label} exceeds 8192 bytes`, 413);
  }
  if (SECRET_PATTERN.test(value)) {
    SECRET_PATTERN.lastIndex = 0;
    throw new InteractiveSessionError(
      'SECRET_INPUT_REJECTED',
      `${label} must not contain secrets`,
      422
    );
  }
  SECRET_PATTERN.lastIndex = 0;
  return value.trim();
}

function requireKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{8,128}$/u.test(value)) {
    throw new InteractiveSessionError('INVALID_INPUT', 'idempotencyKey is invalid', 422);
  }
  return value;
}

function parseCursor(value: unknown): number {
  const cursor = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new InteractiveSessionError(
      'INVALID_CURSOR',
      'afterSequence must be a non-negative integer',
      422
    );
  }
  return cursor;
}

export function nextInteractiveTransition(
  current: InteractiveSessionStatus,
  target: InteractiveSessionStatus,
  approved = false
): InteractiveSessionStatus {
  const legal =
    (current === 'created' && (target === 'running' || target === 'cancelled')) ||
    (current === 'running' && target === 'waiting_approval') ||
    (current === 'waiting_approval' && (target === 'completed' || target === 'failed')) ||
    (current === 'waiting_approval' && target === 'running' && approved) ||
    (!TERMINAL.has(current) && target === 'cancelled') ||
    (current === 'running' && target === 'failed');
  if (!legal || TERMINAL.has(current)) {
    throw new InteractiveSessionError(
      'ILLEGAL_TRANSITION',
      `${current} -> ${target} is not permitted`
    );
  }
  return target;
}

function supportsRowLock(db: Knex): boolean {
  const client = String(db.client.config.client);
  return client.includes('pg') || client.includes('postgres') || client.includes('mysql');
}

async function lockSession(
  trx: Knex,
  sessionId: number,
  scope: InteractiveScope,
  allowCompanyReviewer = false
): Promise<InstanceType<typeof InteractiveSession>> {
  let query = InteractiveSession.query(trx).findOne({ id: sessionId, company_id: scope.companyId });
  if (supportsRowLock(trx)) query = query.forUpdate();
  const session = await query;
  if (!session || (!allowCompanyReviewer && session.owner_id !== scope.userId)) {
    throw new InteractiveSessionError('NOT_FOUND', 'Interactive session not found', 404);
  }
  return session;
}

async function appendEvent(
  trx: Knex,
  session: InstanceType<typeof InteractiveSession>,
  scope: InteractiveScope,
  type: string,
  payload: Record<string, unknown>,
  patch: Record<string, unknown> = {},
  intent?: string
): Promise<InstanceType<typeof InteractiveSessionEvent>> {
  const sequence = session.last_sequence + 1;
  const now = new Date().toISOString();
  const event = await InteractiveSessionEvent.query(trx).insertAndFetch({
    session_id: session.id,
    company_id: scope.companyId,
    sequence,
    event_uuid: randomUUID(),
    type,
    actor_id: scope.userId,
    payload_json: JSON.stringify(payload),
  });
  await InteractiveSession.query(trx)
    .findById(session.id)
    .patch({ ...patch, last_sequence: sequence, version: session.version + 1 });
  if (intent) {
    await OutboxEvent.query(trx).insert({
      event_type: intent,
      aggregate_model: InteractiveSession.modelName,
      aggregate_id: session.id,
      company_id: scope.companyId,
      actor_id: scope.userId,
      payload: JSON.stringify({ sessionId: session.id, sequence }),
      available_at: now,
    });
  }
  return event;
}

async function replayCommand(
  trx: Knex,
  session: InstanceType<typeof InteractiveSession>,
  scope: InteractiveScope,
  input: InteractiveCommandInput,
  fingerprint: string
) {
  const existing = await InteractiveSessionCommand.query(trx).findOne({
    session_id: session.id,
    idempotency_key: input.idempotencyKey,
  });
  if (!existing) return null;
  if (
    existing.actor_id !== scope.userId ||
    existing.command_type !== input.type ||
    existing.payload_sha256 !== fingerprint
  ) {
    throw new InteractiveSessionError('IDEMPOTENCY_CONFLICT', 'Command key was already used');
  }
  return { replayed: true, sequence: existing.result_sequence };
}

async function resolveRunAuthority(input: InteractiveCreateInput, trx: Knex) {
  const [agent, contract] = await Promise.all([
    Agent.query(trx).findOne({ id: input.agentId, company_id: input.companyId, active: true }),
    WorkContract.query(trx).findOne({ id: input.workContractId, company_id: input.companyId }),
  ]);
  if (!agent || agent.status !== 'active' || agent.is_emergency_stopped || !contract) {
    throw new InteractiveSessionError('INVALID_AUTHORITY', 'Agent or work contract not found', 404);
  }
  if (contract.assigned_agent_id !== agent.id || contract.status === 'cancelled') {
    throw new InteractiveSessionError(
      'INVALID_AUTHORITY',
      'Agent is not assigned to this contract'
    );
  }
  const grants = await CapabilityGrant.query(trx).where({
    company_id: input.companyId,
    agent_id: agent.id,
    work_contract_id: contract.id,
    status: 'active',
  });
  const grant = grants.find((candidate) =>
    isActiveCapabilityGrant(candidate, {
      companyId: input.companyId,
      agentId: agent.id,
      workContractId: contract.id,
      capability: candidate.capability,
      expectedPolicyVersion: candidate.policy_version,
    })
  );
  const policy = await ExecutionPolicy.query(trx).findOne({
    id: contract.execution_policy_id,
    company_id: input.companyId,
  });
  if (!grant || !policy) {
    throw new InteractiveSessionError('INVALID_AUTHORITY', 'Active grant and policy are required');
  }
  const provider = await ProviderProfile.query(trx)
    .findOne({
      company_id: input.companyId,
      active: true,
      enabled: true,
    })
    .orderBy('id', 'asc');
  if (!provider) throw new InteractiveSessionError('INVALID_AUTHORITY', 'Provider is unavailable');
  const model = await ModelProfile.query(trx)
    .findOne({
      company_id: input.companyId,
      provider_profile_id: provider.id,
      active: true,
      enabled: true,
    })
    .orderBy('id', 'asc');
  if (!model) throw new InteractiveSessionError('INVALID_AUTHORITY', 'Model is unavailable');
  return { agent, contract, grant, policy, provider, model };
}

async function createSessionRecord(input: InteractiveCreateInput) {
  const prompt = boundedText(input.initialPrompt, 'initialPrompt');
  return InteractiveSession.transaction(async (trx) => {
    const existing = await InteractiveSession.query(trx).findOne({
      company_id: input.companyId,
      idempotency_key: input.idempotencyKey,
    });
    if (existing) {
      if (existing.owner_id !== input.userId)
        throw new InteractiveSessionError('NOT_FOUND', 'Session not found', 404);
      const run = await AgentRun.query(trx).findById(existing.agent_run_id);
      if (existing.initial_prompt !== prompt || run?.agent_id !== input.agentId || run?.work_contract_id !== input.workContractId)
        throw new InteractiveSessionError('IDEMPOTENCY_CONFLICT', 'Session key was already used');
      return { session: existing, replayed: true };
    }
    const authority = await resolveRunAuthority(input, trx);
    const fingerprint = computeExecutionFingerprint({
      contract: { id: authority.contract.id, code: String(authority.contract.code) },
      agent: { id: authority.agent.id, code: String(authority.agent.code) },
      grant: {
        id: authority.grant.id,
        policyVersion: authority.grant.policy_version,
        expiresAt: authority.grant.expires_at,
      },
      provider: {
        id: authority.provider.id,
        code: String(authority.provider.code),
        kind: String(authority.provider.kind),
      },
      model: { id: authority.model.id, modelId: String(authority.model.model_id) },
      policy: {
        id: authority.policy.id,
        version: authority.policy.policy_version,
        maxRiskTier: String(authority.policy.max_risk_tier),
      },
      classification: String(authority.contract.data_classification),
      limits: {
        maxSteps: authority.policy.max_steps,
        maxTokens: authority.policy.max_tokens_per_run,
        maxCostMicros: authority.policy.max_cost_micros_per_run,
      },
      secretRefName: String(authority.provider.secret_ref ?? ''),
    });
    const run = await AgentRun.query(trx).insertAndFetch({
      company_id: input.companyId,
      work_contract_id: authority.contract.id,
      agent_id: authority.agent.id,
      capability_grant_id: authority.grant.id,
      provider_profile_id: authority.provider.id,
      model_profile_id: authority.model.id,
      execution_policy_id: authority.policy.id,
      idempotency_key: `interactive:${digest({ company: input.companyId, key: input.idempotencyKey })}`,
      correlation_id: randomUUID(),
      execution_fingerprint: fingerprint,
      checkpoint_json: JSON.stringify({ interactivePrompt: prompt }),
    });
    const session = await InteractiveSession.query(trx).insertAndFetch({
      company_id: input.companyId,
      owner_id: input.userId,
      agent_run_id: run.id,
      idempotency_key: input.idempotencyKey,
      initial_prompt: prompt,
      checkpoint_json: JSON.stringify({ prompt, fingerprint }),
    });
    await InteractiveSessionCommand.query(trx).insert({
      session_id: session.id,
      company_id: input.companyId,
      actor_id: input.userId,
      idempotency_key: input.idempotencyKey,
      command_type: 'prompt',
      payload_sha256: digest({ prompt }),
      payload_json: JSON.stringify({ prompt }),
      result_sequence: 1,
    });
    await appendEvent(
      trx,
      session,
      input,
      'session.created',
      { agentRunId: run.id },
      {},
      INTERACTIVE_EXECUTE_INTENT
    );
    return { session, replayed: false };
  });
}

export async function createInteractiveSession(input: InteractiveCreateInput) {
  requireKey(input.idempotencyKey);
  const result = await createSessionRecord(input);
  return { session: result.session, replayed: result.replayed };
}

export async function submitInteractiveCommand(
  sessionId: number,
  scope: InteractiveScope,
  input: InteractiveCommandInput
) {
  requireKey(input.idempotencyKey);
  return InteractiveSession.transaction(async (trx) => {
    const session = await lockSession(
      trx,
      sessionId,
      scope,
      input.type === 'approve' || input.type === 'deny'
    );
    const payload = input.payload ?? {};
    const fingerprint = digest({ type: input.type, payload });
    const replay = await replayCommand(trx, session, scope, input, fingerprint);
    if (replay) return replay;
    if (TERMINAL.has(session.status)) {
      throw new InteractiveSessionError('TERMINAL_SESSION', 'Session is terminal');
    }
    const prompt = input.type === 'prompt' ? boundedText(payload.prompt, 'prompt') : undefined;
    let target: InteractiveSessionStatus = session.status;
    let type = `command.${input.type}`;
    let eventPayload: Record<string, unknown> = {};
    let patch: Record<string, unknown> = {};
    let intent: string | undefined;
    if (input.type === 'prompt') {
      if (session.status === 'waiting_approval') {
        throw new InteractiveSessionError('APPROVAL_PENDING', 'Resolve approval before steering');
      }
      target =
        session.status === 'created'
          ? nextInteractiveTransition(session.status, 'running')
          : session.status;
      type = session.status === 'created' ? 'session.running' : 'prompt.accepted';
      eventPayload = { prompt };
      patch = { status: target };
      intent = INTERACTIVE_EXECUTE_INTENT;
      const run = await AgentRun.query(trx).findById(session.agent_run_id);
      await AgentRun.query(trx)
        .where({ id: session.agent_run_id, company_id: scope.companyId })
        .patch({
          checkpoint_json: JSON.stringify({
            interactivePrompt: prompt,
            fingerprint: JSON.parse(session.checkpoint_json).fingerprint,
          }),
          ...(run?.status === 'pending' ? { status: 'pending' } : {}),
        });
    }
    if (input.type === 'request_approval') {
      const capability = boundedText(payload.capability, 'capability');
      const args = payload.arguments ?? {};
      if (JSON.stringify(args).length > 4_096)
        throw new InteractiveSessionError(
          'INPUT_TOO_LARGE',
          'Approval arguments exceed 4096 bytes',
          413
        );
      if (SECRET_PATTERN.test(JSON.stringify(args)))
        throw new InteractiveSessionError(
          'SECRET_INPUT_REJECTED',
          'Approval arguments contain secrets',
          422
        );
      SECRET_PATTERN.lastIndex = 0;
      const expiresAt = new Date(Date.now() + INTERACTIVE_APPROVAL_TTL_MS).toISOString();
      const approvalFingerprint = digest({
        runId: session.agent_run_id,
        executionFingerprint: JSON.parse(session.checkpoint_json).fingerprint,
        capability,
        arguments: args,
        expiresAt,
      });
      const approval = await InteractiveSessionApproval.query(trx).insertAndFetch({
        session_id: session.id,
        company_id: scope.companyId,
        requested_by_id: scope.userId,
        fingerprint_sha256: approvalFingerprint,
        capability,
        arguments_json: JSON.stringify(args),
        expires_at: expiresAt,
      });
      target = nextInteractiveTransition(session.status, 'waiting_approval');
      type = 'approval.requested';
      eventPayload = {
        approvalId: approval.id,
        fingerprint: approvalFingerprint,
        capability,
        expiresAt,
      };
      patch = { status: target, pending_approval_id: approval.id };
      intent = INTERACTIVE_PAUSE_INTENT;
      const activeRun = await AgentRun.query(trx).findById(session.agent_run_id);
      if (!activeRun || TERMINAL_RUN_STATUSES.has(String(activeRun.status)))
        throw new InteractiveSessionError('TERMINAL_RUN', 'Agent run is already terminal');
      await AgentRun.query(trx)
        .where({ id: session.agent_run_id, company_id: scope.companyId })
        .patch({
          status: 'pending',
          fencing_token: Number(activeRun?.fencing_token ?? 0) + 1,
          error_code: null,
          error_summary: null,
          finished_at: null,
        });
    }
    if (input.type === 'approve' || input.type === 'deny') {
      const approval = await InteractiveSessionApproval.query(trx).findOne({
        id: session.pending_approval_id ?? 0,
        session_id: session.id,
        company_id: scope.companyId,
        status: 'pending',
      });
      if (!approval)
        throw new InteractiveSessionError('APPROVAL_NOT_PENDING', 'No pending approval');
      if (session.owner_id === scope.userId || approval.requested_by_id === scope.userId) {
        throw new InteractiveSessionError(
          'SELF_APPROVAL_FORBIDDEN',
          'Session owner or requester cannot decide approval',
          403
        );
      }
      if (Date.parse(approval.expires_at) <= Date.now()) {
        await approval.$query(trx).patch({ status: 'expired' });
        const expiredAt = new Date().toISOString();
        target = nextInteractiveTransition(session.status, 'cancelled');
        type = 'session.cancelled';
        eventPayload = { approvalId: approval.id, reason: 'approval_expired' };
        patch = { status: target, pending_approval_id: null, terminal_at: expiredAt };
        intent = INTERACTIVE_PAUSE_INTENT;
        await AgentRun.query(trx)
          .where({ id: session.agent_run_id, company_id: scope.companyId })
          .whereNotIn('status', [...TERMINAL_RUN_STATUSES])
          .patch({ status: 'cancelled', finished_at: expiredAt });
      } else {
        const expected = payload.fingerprint;
        const run = await AgentRun.query(trx).findById(session.agent_run_id);
        if (
          typeof expected !== 'string' ||
          expected !== approval.fingerprint_sha256 ||
          run?.execution_fingerprint !== JSON.parse(session.checkpoint_json).fingerprint
        ) {
          throw new InteractiveSessionError(
            'APPROVAL_FINGERPRINT_MISMATCH',
            'Approval fingerprint mismatch'
          );
        }
        await approval.$query(trx).patch({
          status: input.type === 'approve' ? 'approved' : 'denied',
          decided_by_id: scope.userId,
          decided_at: new Date().toISOString(),
        });
        const completionApproval = approval.capability === INTERACTIVE_COMPLETION_CAPABILITY;
        if (completionApproval && input.type === 'approve') {
          if (!run || run.status !== 'completed')
            throw new InteractiveSessionError('EVIDENCE_REQUIRED', 'Run is not completed');
          const evidence = await ArtifactManifest.query(trx).findOne({
            company_id: scope.companyId,
            work_contract_id: run.work_contract_id,
            agent_run_id: run.id,
            artifact_kind: 'evidence_bundle',
            stale_at: null,
            sha256: (JSON.parse(approval.arguments_json) as { evidenceSha256?: unknown }).evidenceSha256,
            verification_status: 'accepted',
          });
          if (!evidence)
            throw new InteractiveSessionError('EVIDENCE_REQUIRED', 'Accepted completion evidence is required');
          target = nextInteractiveTransition(session.status, 'completed');
          const checkpoint = { status: target, evidence: { id: evidence.id, sha256: evidence.sha256 } };
          eventPayload = { approvalId: approval.id, fingerprint: approval.fingerprint_sha256, evidence: checkpoint.evidence };
          patch = { status: target, pending_approval_id: null, terminal_at: new Date().toISOString(), checkpoint_json: JSON.stringify(checkpoint) };
        } else {
          target = input.type === 'approve'
            ? nextInteractiveTransition(session.status, 'running', true)
            : nextInteractiveTransition(session.status, 'cancelled');
          eventPayload = { approvalId: approval.id, fingerprint: approval.fingerprint_sha256 };
          patch = {
            status: target,
            pending_approval_id: null,
            ...(TERMINAL.has(target) ? { terminal_at: new Date().toISOString() } : {}),
          };
          if (input.type === 'approve') intent = INTERACTIVE_EXECUTE_INTENT;
          if (input.type === 'deny') {
            intent = INTERACTIVE_PAUSE_INTENT;
            if (!run || !TERMINAL_RUN_STATUSES.has(String(run.status))) {
              await AgentRun.query(trx)
                .where({ id: session.agent_run_id, company_id: scope.companyId })
                .patch({ status: 'cancelled', finished_at: new Date().toISOString() });
            }
          }
        }
        type = `approval.${input.type}`;
      }
    }
    if (input.type === 'cancel') {
      target = nextInteractiveTransition(session.status, 'cancelled');
      type = 'session.cancelled';
      patch = { status: target, terminal_at: new Date().toISOString(), pending_approval_id: null };
      intent = INTERACTIVE_PAUSE_INTENT;
      await AgentRun.query(trx)
        .where({ id: session.agent_run_id, company_id: scope.companyId })
        .whereNotIn('status', [...TERMINAL_RUN_STATUSES])
        .patch({ status: 'cancelled', finished_at: new Date().toISOString() });
    }
    const event = await appendEvent(trx, session, scope, type, eventPayload, patch, intent);
    await InteractiveSessionCommand.query(trx).insert({
      session_id: session.id,
      company_id: scope.companyId,
      actor_id: scope.userId,
      idempotency_key: input.idempotencyKey,
      command_type: input.type,
      payload_sha256: fingerprint,
      payload_json: JSON.stringify(payload),
      result_sequence: event.sequence,
    });
    return { replayed: false, sequence: event.sequence };
  });
}

/** Minimal, independent-review projection; never exposes prompts, events or arguments. */
export async function readPendingInteractiveApproval(
  sessionId: number,
  scope: InteractiveScope
) {
  if (!(await hasCompanyAccess(scope.userId, scope.companyId, 'user'))) {
    throw new InteractiveSessionError('FORBIDDEN', 'Active company membership required', 403);
  }
  return InteractiveSession.transaction(async (trx) => {
    const session = await lockSession(trx, sessionId, scope, true);
    const approval = await InteractiveSessionApproval.query(trx).findOne({
      id: session.pending_approval_id ?? 0,
      session_id: session.id,
      company_id: scope.companyId,
      status: 'pending',
    });
    if (!approval || session.status !== 'waiting_approval') {
      throw new InteractiveSessionError('APPROVAL_NOT_PENDING', 'No pending approval');
    }
    if (session.owner_id === scope.userId || approval.requested_by_id === scope.userId) {
      throw new InteractiveSessionError(
        'SELF_APPROVAL_FORBIDDEN',
        'Session owner or requester cannot review this approval',
        403
      );
    }
    return {
      approval: {
        id: approval.id,
        fingerprint: approval.fingerprint_sha256,
        capability: approval.capability,
        expiresAt: approval.expires_at,
      },
      session: {
        id: session.id,
        status: session.status,
        ownerId: session.owner_id,
        requestedById: approval.requested_by_id,
      },
    };
  });
}

export async function readInteractiveSession(
  sessionId: number,
  scope: InteractiveScope,
  afterSequence: unknown = 0
) {
  const cursor = parseCursor(afterSequence);
  return InteractiveSession.transaction(async (trx) => {
    const session = await InteractiveSession.query(trx).findOne({
      id: sessionId,
      company_id: scope.companyId,
    });
    if (!session || session.owner_id !== scope.userId)
      throw new InteractiveSessionError('NOT_FOUND', 'Session not found', 404);
    const events = await InteractiveSessionEvent.query(trx)
      .where({ session_id: session.id, company_id: scope.companyId })
      .where('sequence', '>', cursor)
      .orderBy('sequence', 'asc')
      .limit(INTERACTIVE_MAX_EVENTS);
    const nextSequence = events.length > 0 ? events[events.length - 1]!.sequence + 1 : cursor + 1;
    const gap = cursor + 1 < session.last_sequence - events.length + 1;
    return {
      session,
      snapshot: {
        status: session.status,
        version: session.version,
        lastSequence: session.last_sequence,
        checkpoint: JSON.parse(session.checkpoint_json) as unknown,
      },
      events,
      nextSequence: Math.min(nextSequence, session.last_sequence + 1),
      gap,
      retryAfterMs: gap ? 1000 : 250,
    };
  });
}

const INTERACTIVE_LIST_CURSOR_VERSION = 1;
const INTERACTIVE_LIST_CURSOR_MAX_LENGTH = 256;

function encodeListCursor(scope: InteractiveScope, id: number): string {
  return Buffer.from(
    JSON.stringify({
      v: INTERACTIVE_LIST_CURSOR_VERSION,
      c: scope.companyId,
      u: scope.userId,
      id,
    }),
    'utf8'
  ).toString('base64url');
}

function invalidListCursor(): InteractiveSessionError {
  return new InteractiveSessionError('INVALID_INPUT', 'Invalid pagination cursor', 422);
}

function isListCursorPayload(value: unknown, scope: InteractiveScope): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 4 &&
    record.v === INTERACTIVE_LIST_CURSOR_VERSION &&
    Number.isSafeInteger(record.c) &&
    Number.isSafeInteger(record.u) &&
    Number.isSafeInteger(record.id) &&
    (record.id as number) >= 1 &&
    record.c === scope.companyId &&
    record.u === scope.userId
  );
}

function decodeListCursor(value: unknown, scope: InteractiveScope): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > INTERACTIVE_LIST_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw invalidListCursor();
  }

  let cursor: unknown;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw invalidListCursor();
    cursor = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalidListCursor();
  }
  if (!isListCursorPayload(cursor, scope)) throw invalidListCursor();
  return cursor.id as number;
}

export async function listInteractiveSessions(
  scope: InteractiveScope,
  limitInput: unknown = 25,
  cursorInput?: unknown
) {
  const limit = Math.min(100, Math.max(1, Number(limitInput) || 25));
  const cursor = decodeListCursor(cursorInput, scope);
  const query = InteractiveSession.query()
    .where({ company_id: scope.companyId, owner_id: scope.userId })
    .orderBy('id', 'desc')
    .limit(limit + 1);
  if (cursor !== undefined) query.where('id', '<', cursor);
  const rows = await query;
  const sessions = rows.slice(0, limit);
  return {
    sessions,
    nextCursor:
      rows.length > limit ? encodeListCursor(scope, sessions[sessions.length - 1]!.id) : null,
  };
}

/** Fail closed before resolving or invoking any externally visible effect. */
export async function isInteractiveRunBlocked(agentRunId: number, companyId: number): Promise<boolean> {
  const session = await InteractiveSession.query().findOne({
    company_id: companyId,
    agent_run_id: agentRunId,
  });
  return Boolean(session && (session.status === 'waiting_approval' || TERMINAL.has(session.status)));
}

async function requeueRun(sessionId: number) {
  const session = await InteractiveSession.query().findById(sessionId);
  if (!session || TERMINAL.has(session.status) || session.status === 'waiting_approval') return;
  const run = await AgentRun.query().findOne({
    id: session.agent_run_id,
    company_id: session.company_id,
  });
  if (!run || TERMINAL_RUN_STATUSES.has(String(run.status))) return;
  if (run.job_id) {
    const job = await Job.query().findById(run.job_id);
    if (job && (job.status === 'queued' || job.status === 'running')) return;
    if (job) await cancelJob(job.id).catch(() => false);
  }
  const jobId = await enqueueJob(
    'ai.agent_run.execute',
    { agentRunId: run.id, companyId: run.company_id },
    {
      companyId: run.company_id,
      requestedBy: session.owner_id,
      idempotencyKey: `interactive:${session.id}:${session.last_sequence}`,
    }
  );
  // A fresh job starts its own fencing epoch at 1. Only the owner of the
  // unchanged pending lease may install it; stale dispatch workers cannot.
  const claimed = await AgentRun.query()
    .where({ id: run.id, company_id: run.company_id, status: 'pending' })
    .where('fencing_token', run.fencing_token)
    .where('job_id', run.job_id ?? null)
    .patch({ job_id: jobId, fencing_token: 1 });
  if (claimed !== 1) await cancelJob(jobId).catch(() => false);
}

async function pauseInteractiveRun(sessionId: number): Promise<void> {
  await InteractiveSession.transaction(async (trx) => {
    const sessionQuery = InteractiveSession.query(trx).findById(sessionId);
    if (supportsRowLock(trx)) sessionQuery.forUpdate();
    const session = await sessionQuery;
    if (!session || (!TERMINAL.has(session.status) && session.status !== 'waiting_approval')) return;
    const runQuery = AgentRun.query(trx).findOne({
      id: session.agent_run_id,
      company_id: session.company_id,
    });
    if (supportsRowLock(trx)) runQuery.forUpdate();
    const run = await runQuery;
    if (!run?.job_id) return;
    const jobId = run.job_id;
    await cancelJob(jobId, trx);
    await AgentRun.query(trx)
      .where({ id: run.id, company_id: session.company_id, job_id: jobId })
      .whereNotIn('status', [...TERMINAL_RUN_STATUSES])
      .patch({ status: 'pending', job_id: null });
  });
}

let consumerRegistered = false;
export function ensureInteractiveSessionConsumer(): void {
  if (consumerRegistered) return;
  try {
    registerOutboxConsumer(INTERACTIVE_PAUSE_INTENT, async (raw) => {
      const payload = raw as { sessionId?: unknown };
      if (typeof payload.sessionId !== 'number')
        throw new Error('Invalid interactive pause intent');
      await pauseInteractiveRun(payload.sessionId);
    });
    registerOutboxConsumer(INTERACTIVE_EXECUTE_INTENT, async (raw) => {
      const payload = raw as { sessionId?: unknown };
      if (typeof payload.sessionId !== 'number')
        throw new Error('Invalid interactive dispatch intent');
      await requeueRun(payload.sessionId);
    });
  } catch {
    // Already registered by the hosting process.
  }
  consumerRegistered = true;
}

/** Reconcile compact evidence from the existing run after the normal execute job settles. */
export async function reconcileInteractiveSession(
  sessionId: number,
  companyId: number
): Promise<void> {
  await InteractiveSession.transaction(async (trx) => {
    const session = await InteractiveSession.query(trx).findOne({
      id: sessionId,
      company_id: companyId,
    });
    if (!session || TERMINAL.has(session.status) || session.status === 'waiting_approval') return;
    const run = await AgentRun.query(trx).findOne({
      id: session.agent_run_id,
      company_id: companyId,
    });
    if (!run || !TERMINAL_RUN_STATUSES.has(String(run.status))) return;
    const executionCheckpoint = JSON.parse(run.checkpoint_json ?? '{}') as {
      readonly lastEffect?: { readonly evidenceSha256?: unknown };
    };
    const evidenceQuery = ArtifactManifest.query(trx).where({
      company_id: companyId,
      work_contract_id: run.work_contract_id,
      agent_run_id: run.id,
      artifact_kind: 'evidence_bundle',
      stale_at: null,
    });
    if (typeof executionCheckpoint.lastEffect?.evidenceSha256 === 'string') {
      evidenceQuery.where('sha256', executionCheckpoint.lastEffect.evidenceSha256);
    }
    const evidence = await evidenceQuery.where('verification_status', 'accepted').first();
    if (run.status === 'completed' && !evidence) {
      throw new InteractiveSessionError(
        'EVIDENCE_REQUIRED',
        'Run completion has no accepted evidence'
      );
    }
    const target: InteractiveSessionStatus =
      run.status === 'cancelled'
        ? 'cancelled'
        : run.status === 'completed'
          ? 'completed'
          : 'failed';
    if (target === 'completed' && session.status === 'running') {
      const expiresAt = new Date(Date.now() + INTERACTIVE_APPROVAL_TTL_MS).toISOString();
      const approvalFingerprint = digest({
        runId: run.id,
        executionFingerprint: run.execution_fingerprint,
        capability: INTERACTIVE_COMPLETION_CAPABILITY,
        evidenceSha256: evidence!.sha256,
        expiresAt,
      });
      const approval = await InteractiveSessionApproval.query(trx).insertAndFetch({
        session_id: session.id,
        company_id: companyId,
        requested_by_id: session.owner_id,
        fingerprint_sha256: approvalFingerprint,
        capability: INTERACTIVE_COMPLETION_CAPABILITY,
        arguments_json: JSON.stringify({ evidenceSha256: evidence!.sha256 }),
        expires_at: expiresAt,
      });
      await appendEvent(
        trx,
        session,
        { companyId, userId: session.owner_id },
        'approval.requested',
        { approvalId: approval.id, fingerprint: approvalFingerprint, capability: INTERACTIVE_COMPLETION_CAPABILITY, reason: 'evidence_review', expiresAt },
        { status: 'waiting_approval', pending_approval_id: approval.id }
      );
      return;
    }
    nextInteractiveTransition(session.status, target);
    const checkpoint = {
      status: target,
      evidence: evidence ? { id: evidence.id, sha256: evidence.sha256 } : null,
    };
    await appendEvent(
      trx,
      session,
      { companyId, userId: session.owner_id },
      `session.${target}`,
      checkpoint,
      {
        status: target,
        terminal_at: new Date().toISOString(),
        checkpoint_json: JSON.stringify(checkpoint),
      }
    );
  });
}
