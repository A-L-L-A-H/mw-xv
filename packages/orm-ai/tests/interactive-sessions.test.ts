import { randomUUID } from 'node:crypto';
import type { AddonHttpApp, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAddons, type Addon } from '@moonwitness/orm';
import {
  Company,
  CompanyMembership,
  Partner,
  User,
  manifest as baseManifest,
} from '@moonwitness/orm-base';
import {
  dispatchOneOutboxEvent,
  Job,
  jobsManifest,
  runOneJob,
} from '@moonwitness/jobs';
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
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  InteractiveSession,
  InteractiveSessionEvent,
  listInteractiveSessions,
  loadTrustedRunSnapshot,
  ModelProfile,
  ProviderProfile,
  WorkContract,
  manifest as aiManifest,
  acknowledgeToolEffect,
  createInteractiveSession,
  createDurableAgentRunStateStore,
  ensureInteractiveSessionConsumer,
  ensureAiJobHandlersRegistered,
  nextInteractiveTransition,
  readInteractiveSession,
  readPendingInteractiveApproval,
  runDurableAgentRun,
  setCloudAgentEffect,
  reconcileInteractiveSession,
  interactiveSessionsHttpPlugin,
  submitInteractiveCommand,
} from '../src/index.js';

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

async function stack(suffix: string) {
  const company = await Company.query().insertAndFetch({ name: `Interactive ${suffix}` });
  const partner = await Partner.query().insertAndFetch({
    name: `Partner ${suffix}`,
    company_id: company.id,
  });
  const user = await User.query().insertAndFetch({
    login: `interactive_${suffix}`,
    role: 'user',
    partner_id: partner.id,
  });
  const reviewerPartner = await Partner.query().insertAndFetch({
    name: `Reviewer ${suffix}`,
    company_id: company.id,
  });
  const reviewer = await User.query().insertAndFetch({
    login: `reviewer_${suffix}`,
    role: 'user',
    partner_id: reviewerPartner.id,
  });
  await CompanyMembership.query().insert({ user_id: user.id, company_id: company.id });
  await CompanyMembership.query().insert({ user_id: reviewer.id, company_id: company.id });
  const provider = await ProviderProfile.query().insertAndFetch({
    company_id: company.id,
    code: `provider_${suffix}`,
    name: 'Provider',
    kind: 'mock',
    secret_ref: 'MW_AI_MOCK_UNUSED',
    data_classification: 'local_only',
    enabled: true,
  });
  const model = await ModelProfile.query().insertAndFetch({
    company_id: company.id,
    provider_profile_id: provider.id,
    code: `model_${suffix}`,
    name: 'Model',
    model_id: 'mock-v1',
    enabled: true,
  });
  const policy = await ExecutionPolicy.query().insertAndFetch({
    company_id: company.id,
    code: `policy_${suffix}`,
    policy_version: 1,
    name: 'Policy',
    max_risk_tier: 'R1',
    enabled: true,
  });
  const agent = await Agent.query().insertAndFetch({
    company_id: company.id,
    code: `agent_${suffix}`,
    status: 'active',
    role_template: 'builder',
    is_emergency_stopped: false,
  });
  const contract = await WorkContract.query().insertAndFetch({
    company_id: company.id,
    code: `contract_${suffix}`,
    title: 'Contract',
    objective: 'Bounded work',
    execution_policy_id: policy.id,
    requested_by_id: user.id,
    assigned_agent_id: agent.id,
  });
  const grant = await CapabilityGrant.query().insertAndFetch({
    company_id: company.id,
    agent_id: agent.id,
    work_contract_id: contract.id,
    execution_policy_id: policy.id,
    capability: 'repo.read@v1',
    policy_version: 1,
    issued_by_id: user.id,
    issued_at: new Date().toISOString(),
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  return {
    company,
    user,
    reviewer,
    agent,
    contract,
    scope: { companyId: company.id, userId: user.id },
  };
}

type Stack = Awaited<ReturnType<typeof stack>>;

async function dispatchSessionIntent(sessionId: number, eventType: string): Promise<void> {
  ensureInteractiveSessionConsumer();
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const event = await db('outbox_events')
      .where({ aggregate_id: sessionId, event_type: eventType, status: 'pending' })
      .first();
    if (!event) return;
    expect(await dispatchOneOutboxEvent(`interactive-test-${event.id}`)).toBe(true);
  }
  throw new Error(`Outbox intent did not settle: ${eventType}`);
}

async function create(s?: Stack) {
  const fixture = s ?? (await stack('create'));
  const result = await createInteractiveSession({
    ...fixture.scope,
    agentId: fixture.agent.id,
    workContractId: fixture.contract.id,
    initialPrompt: 'inspect the repository',
    idempotencyKey: 'create-key-001',
  });
  return { ...fixture, ...result };
}

async function seedListSessions(fixture: Stack, count: number, scope = fixture.scope) {
  const sessions = [];
  for (let index = 0; index < count; index += 1) {
    const result = await createInteractiveSession({
      ...scope,
      agentId: fixture.agent.id,
      workContractId: fixture.contract.id,
      initialPrompt: `inspect page ${index}`,
      idempotencyKey: `list-key-${scope.userId}-${index}-001`,
    });
    sessions.push(result.session);
  }
  return sessions;
}

function listCursor(scope: { companyId: number; userId: number }, id: number): string {
  return Buffer.from(JSON.stringify({ v: 1, c: scope.companyId, u: scope.userId, id })).toString(
    'base64url'
  );
}

beforeEach(async () => {
  const postgresUrl = process.env.INTERACTIVE_POSTGRES_TEST_URL;
  const postgresSchema = `interactive_${randomUUID().replaceAll('-', '')}`;
  db = knex(postgresUrl
    ? {
        client: 'pg',
        connection: postgresUrl,
        pool: {
          min: 1,
          max: 4,
          afterCreate(connection, done) {
            connection.query(
              `SET search_path TO "${postgresSchema}"`,
              (error) => done(error, connection)
            );
          },
        },
      }
    : {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: {
          min: 1,
          max: 1,
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
  if (postgresUrl) await db.raw('CREATE SCHEMA ??', [postgresSchema]);
  await installAddons(db, [...ADDONS].reverse());
  ensureAiJobHandlersRegistered();
});
afterEach(async () => {
  setCloudAgentEffect(null);
  await db.destroy();
});

describe('interactive session authority and lifecycle', () => {
  it('IS-009 permits exactly the reviewed state machine and rejects reopening terminals', () => {
    expect(nextInteractiveTransition('created', 'running')).toBe('running');
    expect(nextInteractiveTransition('running', 'waiting_approval')).toBe('waiting_approval');
    expect(nextInteractiveTransition('waiting_approval', 'running', true)).toBe('running');
    for (const from of ['created', 'running', 'waiting_approval'] as const)
      expect(nextInteractiveTransition(from, 'cancelled')).toBe('cancelled');
    expect(nextInteractiveTransition('running', 'failed')).toBe('failed');
    expect(() => nextInteractiveTransition('waiting_approval', 'running')).toThrow(
      /not permitted/u
    );
    expect(() => nextInteractiveTransition('created', 'completed')).toThrow(/not permitted/u);
    for (const from of ['completed', 'failed', 'cancelled'] as const)
      expect(() => nextInteractiveTransition(from, 'running', true)).toThrow(/not permitted/u);
  });

  it('IS-006 replays creation only for identical input and rejects key reuse', async () => {
    const fixture = await stack('create-idempotency');
    const input = {
      ...fixture.scope,
      agentId: fixture.agent.id,
      workContractId: fixture.contract.id,
      initialPrompt: 'inspect the repository',
      idempotencyKey: 'create-key-001',
    };
    const first = await createInteractiveSession(input);
    const replay = await createInteractiveSession(input);
    expect(replay.replayed).toBe(true);
    expect(replay.session.id).toBe(first.session.id);
    await expect(
      createInteractiveSession({ ...input, initialPrompt: 'changed prompt' })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      await InteractiveSession.query()
        .where({ company_id: fixture.company.id, idempotency_key: input.idempotencyKey })
        .resultSize()
    ).toBe(1);
  });

  it('IS-005/006 sequences concurrent commands and replays a key without a second transition', async () => {
    const fixture = await create();
    const results = await Promise.all(
      ['one', 'two', 'three'].map((prompt) =>
        submitInteractiveCommand(fixture.session.id, fixture.scope, {
          idempotencyKey: `command-${prompt}-001`,
          type: 'prompt',
          payload: { prompt: `inspect ${prompt}` },
        })
      )
    );
    expect(new Set(results.map((result) => result.sequence)).size).toBe(3);
    const replay = await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'command-one-001',
      type: 'prompt',
      payload: { prompt: 'inspect one' },
    });
    expect(replay).toEqual({ replayed: true, sequence: results[0]!.sequence });
    await expect(
      submitInteractiveCommand(fixture.session.id, fixture.scope, {
        idempotencyKey: 'command-one-001',
        type: 'prompt',
        payload: { prompt: 'changed' },
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const read = await readInteractiveSession(fixture.session.id, fixture.scope);
    expect(read.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(read.session.last_sequence).toBe(4);
    expect(
      await InteractiveSessionEvent.query().where({ session_id: fixture.session.id }).resultSize()
    ).toBe(4);
    await expect(
      InteractiveSessionEvent.query().findById(read.events[0]!.id).patch({ type: 'forged' })
    ).rejects.toThrow(/immutable/u);
  });

  it('IS-009 binds approval to exact fingerprint, independent actor and expiry', async () => {
    const fixture = await create();
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'start-before-approval',
      type: 'prompt',
      payload: { prompt: 'start' },
    });
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'approval-request-01',
      type: 'request_approval',
      payload: { capability: 'repo.write@v1', arguments: { path: 'src/a.ts' } },
    });
    const session = await InteractiveSession.query().findById(fixture.session.id);
    const approval = await db('ai_interactive_session_approvals')
      .where({ session_id: session.id })
      .first();
    expect(session.status).toBe('waiting_approval');
    await expect(
      submitInteractiveCommand(session.id, fixture.scope, {
        idempotencyKey: 'approval-decide-01',
        type: 'approve',
        payload: { fingerprint: approval.fingerprint_sha256 },
      })
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    await expect(
      submitInteractiveCommand(
        session.id,
        { companyId: fixture.company.id, userId: fixture.reviewer.id },
        {
          idempotencyKey: 'approval-decide-02',
          type: 'approve',
          payload: { fingerprint: '0'.repeat(64) },
        }
      )
    ).rejects.toMatchObject({ code: 'APPROVAL_FINGERPRINT_MISMATCH' });
    const approved = await submitInteractiveCommand(
      session.id,
      { companyId: fixture.company.id, userId: fixture.reviewer.id },
      {
        idempotencyKey: 'approval-decide-03',
        type: 'approve',
        payload: { fingerprint: approval.fingerprint_sha256 },
      }
    );
    expect(approved.replayed).toBe(false);
    expect((await InteractiveSession.query().findById(session.id)).status).toBe('running');
    await expect(
      submitInteractiveCommand(session.id, fixture.scope, {
        idempotencyKey: 'approval-decide-04',
        type: 'approve',
        payload: { fingerprint: approval.fingerprint_sha256 },
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
  });

  it('IS-008 cancellation dominates stale effect acknowledgement and terminal leases', async () => {
    const fixture = await create();
    const run = await AgentRun.query().findOne({ id: fixture.session.agent_run_id });
    const job = await Job.query().insertAndFetch({
      company_id: fixture.company.id,
      handler: 'ai.agent_run.execute',
      payload: '{}',
      idempotency_key: 'fencing-job-001',
      available_at: new Date().toISOString(),
      status: 'running',
      fencing_token: 4,
    });
    await AgentRun.query()
      .findById(run.id)
      .patch({ job_id: job.id, status: 'running', fencing_token: 4 });
    await expect(
      acknowledgeToolEffect({
        companyId: fixture.company.id,
        agentRunId: run.id,
        effectKey: 'tool:one',
        argsDigest: 'a'.repeat(64),
        output: {},
        fencingToken: 3,
      })
    ).rejects.toMatchObject({ code: 'STALE_FENCING_TOKEN' });
    expect(
      await createDurableAgentRunStateStore({
        companyId: fixture.company.id,
        agentRunId: run.id,
        fencingToken: 4,
      }).verifyLease(String(run.id), 4)
    ).toMatchObject({ valid: true });
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'cancel-command-001',
      type: 'cancel',
    });
    await expect(
      acknowledgeToolEffect({
        companyId: fixture.company.id,
        agentRunId: run.id,
        effectKey: 'tool:one',
        argsDigest: 'a'.repeat(64),
        output: {},
        fencingToken: 4,
      })
    ).rejects.toThrow(/terminal/u);
    expect(
      (
        await createDurableAgentRunStateStore({
          companyId: fixture.company.id,
          agentRunId: run.id,
          fencingToken: 4,
        }).verifyLease(String(run.id), 4)
      ).valid
    ).toBe(false);
    await expect(
      InteractiveSession.query().findById(fixture.session.id).patch({ status: 'running' })
    ).rejects.toThrow(/terminal/u);
  });

  it('IS-005 reconnect reports a stale cursor gap and a bounded fresh snapshot', async () => {
    const fixture = await create();
    const current = await readInteractiveSession(fixture.session.id, fixture.scope, 0);
    expect(current.gap).toBe(false);
    expect(current.nextSequence).toBe(2);
    const stale = await readInteractiveSession(fixture.session.id, fixture.scope, 0);
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'reconnect-command-1',
      type: 'prompt',
      payload: { prompt: 'continue' },
    });
    expect(stale.events).toHaveLength(1);
    const future = await readInteractiveSession(fixture.session.id, fixture.scope, 99);
    expect(future.gap).toBe(false);
    expect(future.snapshot.lastSequence).toBe(2);
    await db('ai_interactive_session_events').insert(
      Array.from({ length: 203 }, (_, index) => ({
        session_id: fixture.session.id,
        company_id: fixture.company.id,
        sequence: index + 3,
        event_uuid: randomUUID(),
        type: 'prompt.accepted',
        actor_id: fixture.user.id,
        payload_json: '{}',
      }))
    );
    await InteractiveSession.query()
      .findById(fixture.session.id)
      .patch({ status: 'running', last_sequence: 205, version: 2 });
    const bounded = await readInteractiveSession(fixture.session.id, fixture.scope, 0);
    expect(bounded.events).toHaveLength(200);
    expect(bounded.gap).toBe(true);
    expect(bounded.nextSequence).toBe(201);
    expect(bounded.snapshot.lastSequence).toBe(205);
    expect(bounded.retryAfterMs).toBe(1000);
  });

  it('IS-009 denial and expiry cancel the run and write durable outbox intents', async () => {
    for (const outcome of ['deny', 'expire'] as const) {
      const fixture = await create(await stack(outcome));
      await submitInteractiveCommand(fixture.session.id, fixture.scope, {
        idempotencyKey: `start-${outcome}`,
        type: 'prompt',
        payload: { prompt: 'start' },
      });
      await submitInteractiveCommand(fixture.session.id, fixture.scope, {
        idempotencyKey: `request-${outcome}`,
        type: 'request_approval',
        payload: { capability: 'repo.write@v1', arguments: { path: 'src/a.ts' } },
      });
      const approval = await db('ai_interactive_session_approvals')
        .where({ session_id: fixture.session.id })
        .first();
      if (outcome === 'expire') {
        await db('ai_interactive_session_approvals')
          .where({ id: approval.id })
          .update({ expires_at: new Date(Date.now() - 1_000).toISOString() });
      }
      await submitInteractiveCommand(
        fixture.session.id,
        { companyId: fixture.company.id, userId: fixture.reviewer.id },
        {
          idempotencyKey: `decide-${outcome}`,
          type: outcome === 'deny' ? 'deny' : 'approve',
          payload: { fingerprint: approval.fingerprint_sha256 },
        }
      );
      expect((await InteractiveSession.query().findById(fixture.session.id)).status).toBe(
        'cancelled'
      );
      expect((await AgentRun.query().findById(fixture.session.agent_run_id)).status).toBe(
        'cancelled'
      );
      const outbox = await db('outbox_events').where({
        aggregate_id: fixture.session.id,
        event_type: 'ai.interactive_session.pause',
      });
      expect(outbox.length).toBeGreaterThan(0);
      if (outcome === 'expire') {
        expect(
          (await db('ai_interactive_session_approvals').where({ id: approval.id }).first()).status
        ).toBe('expired');
      }
    }
  });

  it('IS-011 rejects secrets and unbounded prompt/approval content', async () => {
    const fixture = await stack('bounds');
    await expect(
      createInteractiveSession({
        ...fixture.scope,
        agentId: fixture.agent.id,
        workContractId: fixture.contract.id,
        initialPrompt: 'x'.repeat(8193),
        idempotencyKey: 'large-create-0001',
      })
    ).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    await expect(
      createInteractiveSession({
        ...fixture.scope,
        agentId: fixture.agent.id,
        workContractId: fixture.contract.id,
        initialPrompt: 'Bearer supersecrettoken',
        idempotencyKey: 'secret-create-001',
      })
    ).rejects.toMatchObject({ code: 'SECRET_INPUT_REJECTED' });
    const created = await create(fixture);
    await expect(
      submitInteractiveCommand(created.session.id, created.scope, {
        idempotencyKey: 'secret-command-01',
        type: 'prompt',
        payload: { prompt: 'MW_AI_OPENAI_API_KEY' },
      })
    ).rejects.toMatchObject({ code: 'SECRET_INPUT_REJECTED' });
    const read = await readInteractiveSession(created.session.id, created.scope);
    expect(JSON.stringify(read)).not.toContain('MW_AI_OPENAI_API_KEY');
  });

  it('IS-012 refuses completed without accepted matching-run evidence and keeps terminal immutable', async () => {
    const fixture = await create();
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'start-before-complete',
      type: 'prompt',
      payload: { prompt: 'start' },
    });
    const run = await AgentRun.query().findById(fixture.session.agent_run_id);
    await AgentRun.query().findById(run.id).patch({ status: 'completed' });
    await expect(
      reconcileInteractiveSession(fixture.session.id, fixture.company.id)
    ).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    await ArtifactManifest.query().insert({
      company_id: fixture.company.id,
      work_contract_id: fixture.contract.id,
      acceptance_criterion_id: null,
      agent_run_id: run.id,
      artifact_kind: 'evidence_bundle',
      storage_key: randomUUID(),
      sha256: 'b'.repeat(64),
      size_bytes: 8,
      verification_status: 'accepted',
    });
    await reconcileInteractiveSession(fixture.session.id, fixture.company.id);
    const pending = await InteractiveSession.query().findById(fixture.session.id);
    expect(pending.status).toBe('waiting_approval');
    expect((await AgentRun.query().findById(run.id)).status).toBe('completed');
    const approval = await db('ai_interactive_session_approvals')
      .where({ id: pending.pending_approval_id })
      .first();
    await submitInteractiveCommand(
      pending.id,
      { companyId: fixture.company.id, userId: fixture.reviewer.id },
      { idempotencyKey: 'complete-evidence-01', type: 'approve', payload: { fingerprint: approval.fingerprint_sha256 } }
    );
    expect((await InteractiveSession.query().findById(pending.id)).status).toBe('completed');
    expect((await AgentRun.query().findById(run.id)).status).toBe('completed');
    await reconcileInteractiveSession(fixture.session.id, fixture.company.id);
    expect(
      await InteractiveSessionEvent.query().where({ session_id: fixture.session.id }).resultSize()
    ).toBe(4);
  });

  it('does not invoke effects for a waiting-approval or terminal linked session', async () => {
    ensureInteractiveSessionConsumer();
    for (const status of ['waiting_approval', 'cancelled'] as const) {
      const fixture = await create(await stack(`blocked-${status}`));
      await submitInteractiveCommand(fixture.session.id, fixture.scope, {
        idempotencyKey: `start-${status}`,
        type: 'prompt',
        payload: { prompt: 'start' },
      });
      if (status === 'waiting_approval') {
        await submitInteractiveCommand(fixture.session.id, fixture.scope, {
          idempotencyKey: `request-${status}`,
          type: 'request_approval',
          payload: { capability: 'repo.write@v1', arguments: { path: 'src/a.ts' } },
        });
      } else {
        await submitInteractiveCommand(fixture.session.id, fixture.scope, {
          idempotencyKey: `cancel-${status}`,
          type: 'cancel',
        });
      }
      const run = await AgentRun.query().findById(fixture.session.agent_run_id);
      const job = await Job.query().insertAndFetch({
        company_id: fixture.company.id,
        handler: 'ai.agent_run.execute',
        handler_version: 1,
        payload: JSON.stringify({ agentRunId: run.id, companyId: fixture.company.id }),
        idempotency_key: `blocked-job-${status}`,
        available_at: new Date().toISOString(),
        status: 'queued',
      });
      await AgentRun.query().findById(run.id).patch({
        status: status === 'cancelled' ? 'cancelled' : 'pending',
        job_id: job.id,
      });
      const execute = vi.fn();
      setCloudAgentEffect({ execute });
      expect(await runOneJob({ workerId: `blocked-${status}` })).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      expect((await Job.query().findById(job.id)).status).toBe('succeeded');
    }
  });

  it('pause cancels and clears only the old job, approval requeues once, and stale workers cannot commit', async () => {
    const fixture = await create(await stack('pause-resume'));
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'start-pause-resume',
      type: 'prompt',
      payload: { prompt: 'start' },
    });
    const run = await AgentRun.query().findById(fixture.session.agent_run_id);
    const oldJob = await Job.query().insertAndFetch({
      company_id: fixture.company.id,
      handler: 'ai.agent_run.execute',
      handler_version: 1,
      payload: JSON.stringify({ agentRunId: run.id, companyId: fixture.company.id }),
      idempotency_key: 'old-interactive-job',
      available_at: new Date().toISOString(),
      status: 'running',
      fencing_token: 4,
    });
    const trusted = await loadTrustedRunSnapshot(run.id, fixture.company.id);
    await InteractiveSession.query().findById(fixture.session.id).patch({
      checkpoint_json: JSON.stringify({ interactivePrompt: 'start', fingerprint: trusted!.fingerprint }),
    });
    await AgentRun.query().findById(run.id).patch({
      status: 'pending',
      job_id: oldJob.id,
      fencing_token: 3,
      execution_fingerprint: trusted!.fingerprint,
    });
    let releaseEffect!: (value: Record<string, unknown>) => void;
    const effectResult = new Promise<Record<string, unknown>>((resolve) => {
      releaseEffect = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const staleExecution = runDurableAgentRun(
      { agentRunId: run.id, companyId: fixture.company.id },
      { jobId: oldJob.id, fencingToken: 4, companyId: fixture.company.id, signal: new AbortController().signal },
      { execute: async () => { markStarted(); return effectResult; } }
    );
    await started;
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'request-pause-resume',
      type: 'request_approval',
      payload: { capability: 'repo.write@v1', arguments: { path: 'src/a.ts' } },
    });
    const approval = await db('ai_interactive_session_approvals')
      .where({ session_id: fixture.session.id })
      .first();
    expect((await AgentRun.query().findById(run.id)).fencing_token).toBe(5);
    await dispatchSessionIntent(fixture.session.id, 'ai.interactive_session.pause');
    expect((await Job.query().findById(oldJob.id)).cancel_requested).toBe(true);
    expect(await AgentRun.query().findById(run.id)).toMatchObject({
      status: 'pending',
      job_id: null,
      fencing_token: 5,
    });

    const reviewerScope = { companyId: fixture.company.id, userId: fixture.reviewer.id };
    await submitInteractiveCommand(fixture.session.id, reviewerScope, {
      idempotencyKey: 'approve-pause-resume',
      type: 'approve',
      payload: { fingerprint: approval.fingerprint_sha256 },
    });
    await dispatchSessionIntent(fixture.session.id, 'ai.interactive_session.execute');
    const resumed = await AgentRun.query().findById(run.id);
    expect(resumed).toMatchObject({ status: 'pending', fencing_token: 1 });
    expect(resumed.job_id).not.toBe(oldJob.id);
    expect(
      await Job.query().where({ handler: 'ai.agent_run.execute', company_id: fixture.company.id }).resultSize()
    ).toBe(2);
    const staleCommit = expect(staleExecution).rejects.toMatchObject({ code: 'STALE_FENCING_TOKEN' });
    releaseEffect({ status: 'failed', error: { code: 'STALE_TEST', message: 'stale result' } });
    await staleCommit;
    expect(await AgentRun.query().findById(run.id)).toMatchObject({
      status: 'pending',
      job_id: resumed.job_id,
      fencing_token: 1,
    });
  });

  it('exposes only the minimal pending approval to an independent reviewer', async () => {
    const fixture = await create(await stack('review-projection'));
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'start-review-projection',
      type: 'prompt',
      payload: { prompt: 'private prompt marker' },
    });
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'request-review-projection',
      type: 'request_approval',
      payload: { capability: 'repo.write@v1', arguments: { path: 'private/path.ts' } },
    });
    const reviewerScope = { companyId: fixture.company.id, userId: fixture.reviewer.id };
    const pending = await readPendingInteractiveApproval(fixture.session.id, reviewerScope);
    expect(Object.keys(pending.approval).sort()).toEqual([
      'capability', 'expiresAt', 'fingerprint', 'id',
    ]);
    expect(Object.keys(pending.session).sort()).toEqual([
      'id', 'ownerId', 'requestedById', 'status',
    ]);
    expect(JSON.stringify(pending)).not.toContain('private');
    await expect(readInteractiveSession(fixture.session.id, reviewerScope)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(listInteractiveSessions(reviewerScope)).resolves.toEqual({ sessions: [], nextCursor: null });
    await expect(
      readPendingInteractiveApproval(fixture.session.id, fixture.scope)
    ).rejects.toMatchObject({ statusCode: 403 });
    await db('ai_interactive_session_approvals')
      .where({ id: pending.approval.id })
      .update({ requested_by_id: fixture.reviewer.id });
    await expect(
      submitInteractiveCommand(fixture.session.id, fixture.scope, {
        idempotencyKey: 'owner-cannot-decide-for-reviewer',
        type: 'approve',
        payload: { fingerprint: pending.approval.fingerprint },
      })
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN', statusCode: 403 });
    const outsider = await stack('review-outsider');
    await expect(
      readPendingInteractiveApproval(fixture.session.id, outsider.scope)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('paginates owner/company sessions by a stable keyset cursor', async () => {
    const fixture = await stack('list-pagination');
    const sessions = await seedListSessions(fixture, 5);
    const reviewerScope = { companyId: fixture.company.id, userId: fixture.reviewer.id };
    await seedListSessions(fixture, 1, reviewerScope);
    const other = await stack('list-pagination-other');
    await seedListSessions(other, 1);
    const ids = sessions.map((session) => session.id).reverse();

    const first = await listInteractiveSessions(fixture.scope, 2);
    expect(first.sessions.map((session) => session.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toBe(listCursor(fixture.scope, ids[1]!));
    const second = await listInteractiveSessions(fixture.scope, 2, first.nextCursor);
    expect(second.sessions.map((session) => session.id)).toEqual(ids.slice(2, 4));
    expect(second.nextCursor).toBe(listCursor(fixture.scope, ids[3]!));
    const last = await listInteractiveSessions(fixture.scope, 2, second.nextCursor);
    expect(last.sessions.map((session) => session.id)).toEqual(ids.slice(4));
    expect(last.nextCursor).toBeNull();
    await expect(listInteractiveSessions(reviewerScope)).resolves.toEqual({
      sessions: [expect.objectContaining({ owner_id: fixture.reviewer.id })],
      nextCursor: null,
    });
    await expect(
      listInteractiveSessions(reviewerScope, 2, first.nextCursor)
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', statusCode: 422 });
    await expect(
      listInteractiveSessions(other.scope, 2, first.nextCursor)
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', statusCode: 422 });
  });

  it('rejects malformed and unsafe pagination cursors', async () => {
    const fixture = await stack('list-cursor-validation');
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const invalid = [
      '',
      'not+base64url',
      'e30',
      encode(null),
      encode([]),
      encode({ v: 2, c: fixture.company.id, u: fixture.user.id, id: 1 }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: 0 }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: -1 }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: 1.5 }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: Number.MAX_SAFE_INTEGER + 1 }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: '1' }),
      encode({ v: 1, c: fixture.company.id, u: fixture.user.id, id: 1, extra: true }),
      'A'.repeat(257),
      42,
    ];
    for (const cursor of invalid) {
      await expect(listInteractiveSessions(fixture.scope, 25, cursor)).rejects.toMatchObject({
        name: 'InteractiveSessionError',
        code: 'INVALID_INPUT',
        statusCode: 422,
      });
    }
  });

  it('enforces company and owner isolation on all reads and commands', async () => {
    const fixture = await create();
    const other = await stack('other');
    await expect(readInteractiveSession(fixture.session.id, other.scope)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      submitInteractiveCommand(
        fixture.session.id,
        { companyId: fixture.company.id, userId: fixture.reviewer.id },
        { idempotencyKey: 'not-owner-command1', type: 'cancel' }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('HTTP lane returns the stable replay contract and enforces company/owner access', async () => {
    const fixture = await create();
    const other = await stack('http-other');
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'http-start-before-review',
      type: 'prompt',
      payload: { prompt: 'private HTTP prompt' },
    });
    await submitInteractiveCommand(fixture.session.id, fixture.scope, {
      idempotencyKey: 'http-request-review',
      type: 'request_approval',
      payload: { capability: 'repo.write@v1', arguments: { path: 'private/http.ts' } },
    });
    const approval = await db('ai_interactive_session_approvals')
      .where({ session_id: fixture.session.id })
      .first();
    const routes = new Map<
      string,
      (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown
    >();
    const register =
      (method: string) =>
      (
        path: string,
        handler: (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown
      ) =>
        routes.set(`${method} ${path}`, handler);
    await interactiveSessionsHttpPlugin(
      { get: register('GET'), post: register('POST') } as unknown as AddonHttpApp,
      {}
    );
    const makeReply = () => {
      let status = 200;
      let body: unknown;
      const headers: Record<string, string> = {};
      const reply: AddonHttpReply = {
        code(value: number) {
          status = value;
          return reply;
        },
        send(value: unknown) {
          body = value;
          return reply;
        },
        header(name: string, value: string) {
          headers[name] = value;
          return reply;
        },
      };
      return {
        reply,
        headers,
        get status() {
          return status;
        },
        get body() {
          return body;
        },
      };
    };
    const route = routes.get('GET /api/ai/interactive-sessions/:id')!;
    const owner = makeReply();
    const result = await route(
      {
        params: { id: String(fixture.session.id) },
        query: { afterSequence: '0' },
        body: undefined,
        auth: { userId: fixture.user.id, companyId: fixture.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      owner.reply
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        session: { id: fixture.session.id },
        events: expect.any(Array),
        nextSequence: 4,
        gap: false,
      },
    });
    expect(owner.headers['Cache-Control']).toBe('private, no-store');
    const nonOwner = makeReply();
    await route(
      {
        params: { id: String(fixture.session.id) },
        query: {},
        body: undefined,
        auth: { userId: fixture.reviewer.id, companyId: fixture.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      nonOwner.reply
    );
    expect(nonOwner.status).toBe(404);
    const crossCompany = makeReply();
    await route(
      {
        params: { id: String(fixture.session.id) },
        query: {},
        body: undefined,
        auth: { userId: other.user.id, companyId: other.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      crossCompany.reply
    );
    expect(crossCompany.status).toBe(404);
    const events = routes.get('GET /api/ai/interactive-sessions/:id/events')!;
    const stream = makeReply();
    await events(
      {
        params: { id: String(fixture.session.id) },
        query: { afterSequence: '0' },
        body: undefined,
        auth: { userId: fixture.user.id, companyId: fixture.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      stream.reply
    );
    expect(String(stream.body)).toContain('retry: 250');
    expect(String(stream.body)).toContain('"replay":[');
    expect(stream.headers['Content-Type']).toBe('text/event-stream');

    for (const prefix of ['/api/ai', '/ai']) {
      const approvalRoute = routes.get(`GET ${prefix}/interactive-sessions/:id/approval`)!;
      const review = makeReply();
      const reviewResult = await approvalRoute(
        {
          params: { id: String(fixture.session.id) },
          query: {},
          body: undefined,
          auth: { userId: fixture.reviewer.id, companyId: fixture.company.id, role: 'user' },
        } as unknown as AddonHttpRequestBase,
        review.reply
      );
      expect(review.status).toBe(200);
      expect(reviewResult).toMatchObject({
        success: true,
        data: {
          approvalId: approval.id,
          fingerprint: approval.fingerprint_sha256,
          capability: approval.capability,
          expiresAt: approval.expires_at,
          sessionId: fixture.session.id,
          status: 'waiting_approval',
          ownerId: fixture.user.id,
          requestedById: approval.requested_by_id,
        },
      });
      expect(JSON.stringify(reviewResult)).not.toContain('private');
      const selfReview = makeReply();
      await approvalRoute(
        {
          params: { id: String(fixture.session.id) },
          query: {},
          body: undefined,
          auth: { userId: fixture.user.id, companyId: fixture.company.id, role: 'user' },
        } as unknown as AddonHttpRequestBase,
        selfReview.reply
      );
      expect(selfReview.status).toBe(403);
    }
    const commands = routes.get('POST /api/ai/interactive-sessions/:id/commands')!;
    const decision = makeReply();
    await commands(
      {
        params: { id: String(fixture.session.id) },
        query: {},
        body: {
          idempotencyKey: 'http-reviewer-decision',
          type: 'approve',
          payload: { fingerprint: approval.fingerprint_sha256 },
        },
        auth: { userId: fixture.reviewer.id, companyId: fixture.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      decision.reply
    );
    expect(decision.status).toBe(200);
    expect((await InteractiveSession.query().findById(fixture.session.id)).status).toBe('running');
    const stillPrivate = makeReply();
    await route(
      {
        params: { id: String(fixture.session.id) },
        query: {},
        body: undefined,
        auth: { userId: fixture.reviewer.id, companyId: fixture.company.id, role: 'user' },
      } as unknown as AddonHttpRequestBase,
      stillPrivate.reply
    );
    expect(stillPrivate.status).toBe(404);
  });

  it('HTTP list forwards the cursor, ends on the last page, and enforces scope', async () => {
    const fixture = await stack('http-list-pagination');
    const sessions = await seedListSessions(fixture, 3);
    const reviewerScope = { companyId: fixture.company.id, userId: fixture.reviewer.id };
    const reviewerSessions = await seedListSessions(fixture, 2, reviewerScope);
    const other = await stack('http-list-other');
    await seedListSessions(other, 1);
    const routes = new Map<
      string,
      (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown
    >();
    const register =
      (method: string) =>
      (path: string, handler: (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown) =>
        routes.set(`${method} ${path}`, handler);
    await interactiveSessionsHttpPlugin(
      { get: register('GET'), post: register('POST') } as unknown as AddonHttpApp,
      {}
    );
    const list = routes.get('GET /api/ai/interactive-sessions')!;
    const request = async (query: Record<string, string>, auth = {
      userId: fixture.user.id,
      companyId: fixture.company.id,
      role: 'user',
    }) => {
      let status = 200;
      let body: unknown;
      const reply = {
        code(value: number) { status = value; return reply; },
        send(value: unknown) { body = value; return reply; },
        header() { return reply; },
      } as AddonHttpReply;
      const result = await list(
        { query, body: undefined, auth } as unknown as AddonHttpRequestBase,
        reply
      );
      return { result, status, body };
    };

    const first = await request({ limit: '2' });
    expect(first).toMatchObject({
      status: 200,
      result: {
        success: true,
        data: [{ id: sessions[2]!.id }, { id: sessions[1]!.id }],
        nextCursor: expect.any(String),
      },
    });
    const cursor = (first.result as { nextCursor: string }).nextCursor;
    expect(cursor).not.toBe(String(sessions[1]!.id));
    const next = await request({ limit: '2', cursor });
    expect(next).toMatchObject({
      result: {
        success: true,
        data: [{ id: sessions[0]!.id }],
        nextCursor: null,
      },
    });
    const invalid = await request({ cursor: 'not+base64url' });
    expect(invalid).toMatchObject({
      status: 422,
      body: { success: false, code: 'INVALID_INPUT' },
    });
    const nonOwner = await request({ cursor }, {
      userId: fixture.reviewer.id,
      companyId: fixture.company.id,
      role: 'user',
    });
    expect(nonOwner).toMatchObject({ status: 422, body: { code: 'INVALID_INPUT' } });
    const crossCompany = await request({ cursor }, {
      userId: other.user.id,
      companyId: other.company.id,
      role: 'user',
    });
    expect(crossCompany).toMatchObject({ status: 422, body: { code: 'INVALID_INPUT' } });
    const reviewer = await request({}, {
      userId: fixture.reviewer.id,
      companyId: fixture.company.id,
      role: 'user',
    });
    expect(reviewer).toMatchObject({
      result: {
        success: true,
        data: [{ id: reviewerSessions[1]!.id }, { id: reviewerSessions[0]!.id }],
        nextCursor: null,
      },
    });
    expect(JSON.stringify(reviewer.result)).not.toContain(`"id":${sessions[0]!.id}`);
  });
});
