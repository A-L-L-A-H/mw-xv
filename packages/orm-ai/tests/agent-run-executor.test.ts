import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Job } from '@moonwitness/jobs';
import {
  Agent,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  ProviderProfile,
  WorkContract,
} from '../src/models.js';
import {
  ApprovalRequiredError,
  EXECUTION_FINGERPRINT_VERSION,
  StaleFencingError,
  computeExecutionFingerprint,
  loadTrustedRunSnapshot,
  runDurableAgentRun,
  type TrustedRunSnapshot,
} from '../src/agent-run-executor.js';
import { sha256Canonical } from '@moonwitness/ai-runtime/canonical-json.js';
import { setCloudAgentEffect } from '../src/cloud-agent-effect-factory.js';
import { ensureAiJobHandlersRegistered } from '../src/ai-http-helpers.js';

const baseInput = {
  contract: { id: 1, code: 'contract-a', revision: 2 },
  agent: { id: 2, code: 'builder' },
  grant: { id: 3, policyVersion: 4, expiresAt: '2027-01-01T00:00:00.000Z' },
  provider: { id: 4, code: 'freellmapi_default', kind: 'freellmapi' },
  model: { id: 5, modelId: 'real-gateway-model' },
  policy: { id: 6, version: 4, maxRiskTier: 'R3' },
  repository: { snapshotId: 'snap-1', baseCommit: 'a'.repeat(40), allowedPaths: ['src'] },
  classification: 'cloud_eligible',
  limits: { maxSteps: 16, maxTokens: 64000, maxCostMicros: 0 },
  secretRefName: 'MW_AI_FREELLM_KEY',
} as const;

interface CapturedHandler {
  readonly name: string;
  readonly version: number;
  readonly parse: (raw: unknown) => unknown;
  readonly run: (payload: unknown, context: unknown) => Promise<unknown>;
}

const captured = vi.hoisted(() => ({
  handlers: new Map<string, CapturedHandler>(),
}));

vi.mock('@moonwitness/jobs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    registerJobHandler: (handler: CapturedHandler) => {
      captured.handlers.set(handler.name, handler);
      return () => {};
    },
  };
});

type Row = Record<string, unknown>;
type FakeFilter = Row | ((row: Row) => boolean);
type FakeWhere = Row | ((builder: FakeQueryBuilder) => void);
type FakeCondition =
  [FakeWhere] | [key: string, value: unknown] | [key: string, operator: '<', value: unknown];

interface FakeQueryBuilder {
  where(...args: FakeCondition): FakeQueryBuilder;
  orWhere(...args: FakeCondition): FakeQueryBuilder;
}

interface PatchRecord {
  readonly table: string;
  readonly where: FakeFilter | undefined;
  readonly patch: Row;
}

const rows: Record<string, Row[]> = {
  AgentRun: [],
  ArtifactManifest: [],
  Agent: [],
  WorkContract: [],
  CapabilityGrant: [],
  ProviderProfile: [],
  ModelProfile: [],
  ExecutionPolicy: [],
  Job: [],
};
const patches: PatchRecord[] = [];

function matches(row: Row, filter: FakeFilter): boolean {
  if (typeof filter === 'function') return filter(row);
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function compileCondition(args: FakeCondition): FakeFilter {
  if (typeof args[0] === 'string') {
    if (args.length === 3) {
      const [key, , value] = args as [string, '<', unknown];
      return (row) => Number(row[key]) < Number(value);
    }
    const [key, value] = args as [string, unknown];
    return (row) => row[key] === value;
  }
  const where = args[0];
  if (typeof where !== 'function') return where;

  const clauses: Array<{ filter: FakeFilter; or: boolean }> = [];
  const builder: FakeQueryBuilder = {
    where(...condition) {
      clauses.push({ filter: compileCondition(condition), or: false });
      return builder;
    },
    orWhere(...condition) {
      clauses.push({ filter: compileCondition(condition), or: true });
      return builder;
    },
  };
  where(builder);
  return (row) => {
    let matched = false;
    clauses.forEach((clause, index) => {
      const clauseMatches = matches(row, clause.filter);
      matched =
        index === 0
          ? clauseMatches
          : clause.or
            ? matched || clauseMatches
            : matched && clauseMatches;
    });
    return matched;
  };
}

/** Minimal Objection-style query stub: enough for the executor's reads/writes. */
function fakeQuery(table: string, list: Row[]) {
  let filters: FakeFilter[] = [];
  const query = {
    findOne: async (where: Row) => list.find((row) => matches(row, where)) ?? undefined,
    findById: async (id: unknown) => list.find((row) => Number(row.id) === Number(id)) ?? undefined,
    where(...args: FakeCondition) {
      filters.push(compileCondition(args));
      return query;
    },
    andWhere(key: string, value: unknown) {
      filters.push({ [key]: value });
      return query;
    },
    orderBy() {
      return query;
    },
    first: async () =>
      list.find((row) => filters.every((filter) => matches(row, filter))) ?? undefined,
    patch: async (patch: Row) => {
      const matched = list.filter((row) => filters.every((filter) => matches(row, filter)));
      for (const row of matched) Object.assign(row, patch);
      patches.push({ table, where: filters.at(-1), patch: { ...patch } });
      filters = [];
      return matched.length;
    },
  };
  return query;
}

function replaceRows(table: string, ...data: Row[]): void {
  rows[table]!.splice(0, rows[table]!.length, ...data);
}

function resetRows(): void {
  patches.length = 0;
  replaceRows('AgentRun', {
    id: 42,
    company_id: 3,
    agent_id: 11,
    work_contract_id: 7,
    capability_grant_id: 8,
    provider_profile_id: 9,
    model_profile_id: 10,
    execution_policy_id: 12,
    job_id: 99,
    fencing_token: 7,
    status: 'pending',
    step_count: 0,
    checkpoint_json: null,
    correlation_id: 'corr-executor',
  });
  replaceRows('ArtifactManifest', {
    id: 1,
    company_id: 3,
    work_contract_id: 7,
    agent_run_id: 42,
    artifact_kind: 'evidence_bundle',
    sha256: 'a'.repeat(64),
    verification_status: 'checked',
    stale_at: null,
  });
  replaceRows('Agent', {
    id: 11,
    company_id: 3,
    code: 'builder',
    status: 'active',
    is_emergency_stopped: false,
  });
  replaceRows('WorkContract', {
    id: 7,
    company_id: 3,
    code: 'contract-a',
    data_classification: 'local_only',
  });
  replaceRows('CapabilityGrant', {
    id: 8,
    company_id: 3,
    policy_version: 1,
    expires_at: '2099-01-01T00:00:00.000Z',
    scope_json: JSON.stringify({ allowedPaths: ['src'] }),
  });
  replaceRows('ProviderProfile', {
    id: 9,
    company_id: 3,
    code: 'mock-provider',
    kind: 'mock',
    secret_ref: 'MW_AI_UNUSED_REFERENCE',
  });
  replaceRows('ModelProfile', { id: 10, company_id: 3, model_id: 'mock-model' });
  replaceRows('ExecutionPolicy', {
    id: 12,
    company_id: 3,
    policy_version: 1,
    max_risk_tier: 'R1',
    max_steps: 8,
    max_tokens_per_run: 100,
    max_cost_micros_per_run: 1,
  });
  replaceRows('Job', { id: 99, company_id: 3, fencing_token: 8 });
  setCloudAgentEffect(null);
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetRows();
  vi.spyOn(AgentRun, 'query').mockImplementation(
    () => fakeQuery('AgentRun', rows.AgentRun!) as never
  );
  vi.spyOn(ArtifactManifest, 'query').mockImplementation(
    () => fakeQuery('ArtifactManifest', rows.ArtifactManifest!) as never
  );
  vi.spyOn(Agent, 'query').mockImplementation(() => fakeQuery('Agent', rows.Agent!) as never);
  vi.spyOn(WorkContract, 'query').mockImplementation(
    () => fakeQuery('WorkContract', rows.WorkContract!) as never
  );
  vi.spyOn(CapabilityGrant, 'query').mockImplementation(
    () => fakeQuery('CapabilityGrant', rows.CapabilityGrant!) as never
  );
  vi.spyOn(ProviderProfile, 'query').mockImplementation(
    () => fakeQuery('ProviderProfile', rows.ProviderProfile!) as never
  );
  vi.spyOn(ModelProfile, 'query').mockImplementation(
    () => fakeQuery('ModelProfile', rows.ModelProfile!) as never
  );
  vi.spyOn(ExecutionPolicy, 'query').mockImplementation(
    () => fakeQuery('ExecutionPolicy', rows.ExecutionPolicy!) as never
  );
  vi.spyOn(Job, 'query').mockImplementation(() => fakeQuery('Job', rows.Job!) as never);
});

const payload = { agentRunId: 42, companyId: 3 };
const context = {
  jobId: 99,
  fencingToken: 8,
  companyId: 3,
  attempt: 1,
  idempotencyKey: 'idem-1',
  signal: new AbortController().signal,
};

describe('durable agent run fingerprints', () => {
  it('is deterministic, versioned and a SHA-256 digest', () => {
    const first = computeExecutionFingerprint(baseInput);
    expect(first).toBe(computeExecutionFingerprint(baseInput));
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(EXECUTION_FINGERPRINT_VERSION).toBe(1);
  });

  it('changes when any authority input changes', () => {
    const baseline = computeExecutionFingerprint(baseInput);
    expect(
      computeExecutionFingerprint({ ...baseInput, policy: { ...baseInput.policy, version: 5 } })
    ).not.toBe(baseline);
    expect(
      computeExecutionFingerprint({
        ...baseInput,
        repository: { ...baseInput.repository, allowedPaths: ['src', 'tests'] },
      })
    ).not.toBe(baseline);
    expect(
      computeExecutionFingerprint({ ...baseInput, toolVersions: ['workspace-tools@v2'] })
    ).not.toBe(baseline);
  });

  it('includes the secret reference name only, never a raw credential', () => {
    const withRef = computeExecutionFingerprint(baseInput);
    const withDifferentRef = computeExecutionFingerprint({
      ...baseInput,
      secretRefName: 'MW_AI_OTHER_KEY',
    });
    expect(withRef).not.toBe(withDifferentRef);
    expect(sha256Canonical({ a: 1, b: 2 })).toBe(sha256Canonical({ b: 2, a: 1 }));
  });

  it('exposes typed fail-closed errors for fencing and approval gating', () => {
    expect(new StaleFencingError('stale').code).toBe('STALE_FENCING_TOKEN');
    expect(new ApprovalRequiredError('needed').code).toBe('APPROVAL_REQUIRED');
  });
});

describe('runDurableAgentRun approval fingerprint', () => {
  it('throws when the stored fingerprint changed after approval and never overwrites it', async () => {
    const staleFingerprint = '0'.repeat(64);
    rows.AgentRun[0]!.execution_fingerprint = staleFingerprint;

    await expect(
      runDurableAgentRun(payload, context, {
        async execute() {
          return { executedBy: 'test', evidenceSha256: 'a'.repeat(64) };
        },
      })
    ).rejects.toMatchObject({
      name: 'StaleFencingError',
      code: 'STALE_FENCING_TOKEN',
      message: 'Execution fingerprint changed after approval',
    });

    expect(patches).toEqual([]);
    expect(rows.AgentRun[0]!.execution_fingerprint).toBe(staleFingerprint);
  });

  it('accepts a stored fingerprint that matches the recomputed value', async () => {
    const snapshot = await loadTrustedRunSnapshot(payload.agentRunId, payload.companyId);
    expect(snapshot).not.toBeNull();
    rows.AgentRun[0]!.execution_fingerprint = snapshot!.fingerprint;

    const result = await runDurableAgentRun(payload, context, {
      async execute() {
        return { executedBy: 'test', evidenceSha256: 'a'.repeat(64) };
      },
    });

    expect(result.status).toBe('completed');
    expect(rows.AgentRun[0]!.execution_fingerprint).toBe(snapshot!.fingerprint);
  });
});

describe('runDurableAgentRun fencing and recovery', () => {
  it('fails closed without a valid claimed job fencing token', async () => {
    const execute = vi.fn(async () => ({ executedBy: 'test', evidenceSha256: 'a'.repeat(64) }));

    for (const fencingToken of [undefined, 0, -1, 1.5, Number.NaN, '8']) {
      const invalidContext = {
        ...context,
        fencingToken,
      } as unknown as typeof context;
      await expect(runDurableAgentRun(payload, invalidContext, { execute })).rejects.toMatchObject({
        name: 'StaleFencingError',
        code: 'STALE_FENCING_TOKEN',
      });
    }

    expect(execute).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('rejects a newer job token or a run token newer than the claim', async () => {
    const execute = vi.fn(async () => ({ executedBy: 'test', evidenceSha256: 'a'.repeat(64) }));
    rows.Job[0]!.fencing_token = 9;

    await expect(runDurableAgentRun(payload, context, { execute })).rejects.toMatchObject({
      name: 'StaleFencingError',
      code: 'STALE_FENCING_TOKEN',
    });

    rows.Job[0]!.fencing_token = 8;
    rows.AgentRun[0]!.fencing_token = 9;
    await expect(runDurableAgentRun(payload, context, { execute })).rejects.toMatchObject({
      name: 'StaleFencingError',
      code: 'STALE_FENCING_TOKEN',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('preserves terminal replay without executing effects', async () => {
    rows.AgentRun[0]!.status = 'completed';
    rows.Job[0]!.fencing_token = 99;
    const execute = vi.fn(async () => ({ executedBy: 'test', evidenceSha256: 'a'.repeat(64) }));

    await expect(runDurableAgentRun(payload, context, { execute })).resolves.toMatchObject({
      status: 'replayed',
      agentRunId: payload.agentRunId,
      fingerprint: expect.any(String),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('reclaims a crashed running claim with the higher token and executes that snapshot', async () => {
    const originalStartedAt = '2026-11-01T10:00:00.000Z';
    const approved = await loadTrustedRunSnapshot(payload.agentRunId, payload.companyId);
    Object.assign(rows.AgentRun[0]!, {
      status: 'running',
      fencing_token: 7,
      started_at: originalStartedAt,
      execution_fingerprint: approved!.fingerprint,
    });
    const execute = vi.fn(async (claimed: TrustedRunSnapshot) => {
      expect(claimed.run).toMatchObject({
        status: 'running',
        fencing_token: 8,
        started_at: originalStartedAt,
        execution_fingerprint: claimed.fingerprint,
      });
      return { executedBy: 'recovery', evidenceSha256: 'a'.repeat(64) };
    });

    await expect(runDurableAgentRun(payload, context, { execute })).resolves.toMatchObject({
      status: 'completed',
      agentRunId: payload.agentRunId,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(rows.AgentRun[0]).toMatchObject({
      status: 'completed',
      fencing_token: 8,
      started_at: originalStartedAt,
      execution_fingerprint: approved!.fingerprint,
      step_count: 1,
    });
    expect(
      patches.find((entry) => entry.table === 'AgentRun' && entry.patch.status === 'running')?.patch
    ).toMatchObject({ fencing_token: 8, started_at: originalStartedAt });
  });

  it('does not re-execute a running claim that already has the same token', async () => {
    Object.assign(rows.AgentRun[0]!, { status: 'running', fencing_token: 8 });
    const execute = vi.fn(async () => ({
      executedBy: 'duplicate',
      evidenceSha256: 'a'.repeat(64),
    }));

    await expect(runDurableAgentRun(payload, context, { execute })).resolves.toMatchObject({
      status: 'replayed',
      agentRunId: payload.agentRunId,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(rows.AgentRun[0]).toMatchObject({ status: 'running', fencing_token: 8 });
  });

  it.each(['completed', 'failed'] as const)(
    'prevents a stale lower-token %s from overwriting a recovered run',
    async (effectStatus) => {
      const recovered: Row = {
        status: 'running',
        fencing_token: 9,
        started_at: '2026-11-01T11:00:00.000Z',
        checkpoint_json: '{"recovery":"newer-claim"}',
        finished_at: null,
      };
      const execute = vi.fn(async () => {
        rows.Job[0]!.fencing_token = 9;
        Object.assign(rows.AgentRun[0]!, recovered);
        if (effectStatus === 'failed') throw new Error('stale effect failed');
        return { status: 'completed', evidenceSha256: 'a'.repeat(64) };
      });

      await expect(runDurableAgentRun(payload, context, { execute })).rejects.toThrow();
      expect(execute).toHaveBeenCalledOnce();
      expect(rows.AgentRun[0]).toMatchObject(recovered);
      expect(rows.Job[0]!.fencing_token).toBe(9);
    }
  );
});

describe('runDurableAgentRun effect status mapping', () => {
  it('treats an effect with no status as completed (backward compatible)', async () => {
    const result = await runDurableAgentRun(payload, context, {
      async execute() {
        return { executedBy: 'test', evidenceSha256: 'a'.repeat(64) };
      },
    });

    expect(result.status).toBe('completed');
    expect(
      patches.some((entry) => entry.table === 'AgentRun' && entry.patch.status === 'completed')
    ).toBe(true);
  });

  it('rejects provider success without persisted evidence', async () => {
    await expect(
      runDurableAgentRun(payload, context, {
        async execute() {
          return { status: 'completed' };
        },
      })
    ).rejects.toThrow('Completion requires');
    expect(rows.AgentRun[0]!.status).toBe('failed');
  });

  it.each([
    ['missing', undefined],
    ['produced', 'produced'],
    ['rejected', 'rejected'],
  ] as const)(
    'rejects %s evidence instead of trusting provider success',
    async (_label, status) => {
      if (status === undefined) replaceRows('ArtifactManifest');
      else rows.ArtifactManifest[0]!.verification_status = status;

      await expect(
        runDurableAgentRun(payload, context, {
          async execute() {
            return { executedBy: 'test', evidenceSha256: 'a'.repeat(64) };
          },
        })
      ).rejects.toThrow('Completion requires matching checked persisted evidence');
      expect(rows.AgentRun[0]!.status).toBe('failed');
    }
  );

  it('marks the run failed when the effect reports failed', async () => {
    const result = await runDurableAgentRun(payload, context, {
      async execute() {
        return {
          executedBy: 'test',
          status: 'failed',
          error: { code: 'HARNESS_FAILURE', message: 'no' },
        };
      },
    });

    expect(result.status).toBe('failed');
    const terminal = patches.find((entry) => entry.patch.status === 'failed');
    expect(terminal).toBeDefined();
    expect(terminal!.patch.error_code).toBe('HARNESS_FAILURE');
    expect(terminal!.patch.error_summary).toBe('no');
  });

  it('marks the run cancelled when the effect reports cancelled', async () => {
    const result = await runDurableAgentRun(payload, context, {
      async execute() {
        return { executedBy: 'test', status: 'cancelled' };
      },
    });

    expect(result.status).toBe('cancelled');
    expect(
      patches.some((entry) => entry.table === 'AgentRun' && entry.patch.status === 'cancelled')
    ).toBe(true);
  });
});

describe('ai job handler fail-closed configuration', () => {
  it('fails when no cloud coding-agent effect is configured', async () => {
    setCloudAgentEffect(null);
    ensureAiJobHandlersRegistered();
    const handler = captured.handlers.get('ai.agent_run.execute');
    expect(handler).toBeDefined();

    await expect(handler!.run(payload, context)).rejects.toThrow(
      'Cloud coding-agent effect is not configured'
    );
  });
});
