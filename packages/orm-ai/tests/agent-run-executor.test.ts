import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Job } from '@moonwitness/jobs';
import {
  Agent,
  AgentRun,
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
  sha256Canonical,
} from '../src/agent-run-executor.js';
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
interface PatchRecord {
  readonly table: string;
  readonly where: Row;
  readonly patch: Row;
}

const rows: Record<string, Row[]> = {
  AgentRun: [],
  Agent: [],
  WorkContract: [],
  CapabilityGrant: [],
  ProviderProfile: [],
  ModelProfile: [],
  ExecutionPolicy: [],
  Job: [],
};
const patches: PatchRecord[] = [];

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

/** Minimal Objection-style query stub: enough for the executor's reads/writes. */
function fakeQuery(table: string, list: Row[]) {
  let filters: Row[] = [];
  const query = {
    findOne: async (where: Row) => list.find((row) => matches(row, where)) ?? undefined,
    findById: async (id: unknown) => list.find((row) => Number(row.id) === Number(id)) ?? undefined,
    where(where: Row) {
      filters.push(where);
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
      patches.push({ table, where: { ...filters.at(-1) }, patch: { ...patch } });
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
          return { executedBy: 'test' };
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
        return { executedBy: 'test' };
      },
    });

    expect(result.status).toBe('completed');
    expect(rows.AgentRun[0]!.execution_fingerprint).toBe(snapshot!.fingerprint);
  });
});

describe('runDurableAgentRun effect status mapping', () => {
  it('treats an effect with no status as completed (backward compatible)', async () => {
    const result = await runDurableAgentRun(payload, context, {
      async execute() {
        return { executedBy: 'test' };
      },
    });

    expect(result.status).toBe('completed');
    expect(
      patches.some((entry) => entry.table === 'AgentRun' && entry.patch.status === 'completed')
    ).toBe(true);
  });

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
