import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignedA2AEnvelope } from '@moonwitness/ai-runtime';
import type { AddonHttpApp, AddonHttpReply, AddonHttpRequest } from '@moonwitness/orm';
import { Agent } from '@moonwitness/orm-ai';
import { AuditLog, Company } from '@moonwitness/orm-base';
import { a2aApiRoutes } from '../src/index.js';

const A2A_SECRET = 'wire-compat-test-a2a-signing-secret-2026';
const RECEIVER_ENDPOINT = 'http://100.64.0.20:3000';
const SOURCE_MESH_IP = '100.64.0.10';
const SOURCE_ENDPOINT = `http://${SOURCE_MESH_IP}:3003`;
const COMPANY_ID = 77;

interface StoredAuditRow {
  id: number;
  model: string;
  record_id: number;
  operation: string;
  actor_id: number | null;
  changes: string;
  create_date: string;
}

type RouteHandler = (request: AddonHttpRequest, reply: AddonHttpReply) => Promise<unknown>;

function createInMemoryOrmHarness() {
  const auditRows: StoredAuditRow[] = [];
  let nextId = 1;

  const agents = new Map<
    string,
    {
      id: number;
      company_id: number;
      code: string;
      active: boolean;
      status: string;
      is_emergency_stopped: boolean;
      service_user_id: number | null;
    }
  >([
    [
      'agent_source',
      {
        id: 101,
        company_id: COMPANY_ID,
        code: 'agent_source',
        active: true,
        status: 'active',
        is_emergency_stopped: false,
        service_user_id: null,
      },
    ],
    [
      'agent_target',
      {
        id: 102,
        company_id: COMPANY_ID,
        code: 'agent_target',
        active: true,
        status: 'active',
        is_emergency_stopped: false,
        service_user_id: null,
      },
    ],
  ]);

  vi.spyOn(Company, 'transaction').mockImplementation((async (
    callback: (trx: unknown) => Promise<unknown>
  ) => callback({})) as unknown as typeof Company.transaction);

  vi.spyOn(Company, 'query').mockImplementation((() => ({
    findById: (id: number) => ({
      forUpdate: async () => (id === COMPANY_ID ? { id: COMPANY_ID, active: true } : undefined),
    }),
  })) as unknown as typeof Company.query);

  vi.spyOn(Agent, 'query').mockImplementation((() => ({
    findOne: (criteria: { company_id: number; code: string; active: boolean }) => ({
      forUpdate: async () => {
        const candidate = agents.get(criteria.code);
        if (!candidate || candidate.company_id !== criteria.company_id || !candidate.active) {
          return undefined;
        }
        return candidate;
      },
    }),
  })) as unknown as typeof Agent.query);

  vi.spyOn(AuditLog, 'query').mockImplementation((() => ({
    insert: async (row: Omit<StoredAuditRow, 'id' | 'create_date'>) => {
      const created: StoredAuditRow = {
        ...row,
        id: nextId++,
        create_date: new Date().toISOString(),
      };
      auditRows.push(created);
      return created;
    },
    where: (criteria: Partial<StoredAuditRow>) => {
      const match = (r: StoredAuditRow) =>
        (criteria.model === undefined || r.model === criteria.model) &&
        (criteria.record_id === undefined || r.record_id === criteria.record_id) &&
        (criteria.operation === undefined || r.operation === criteria.operation);
      let filtered = auditRows.filter(match);
      const chain = {
        where: (_col: string, _op: string, cutoff: string) => {
          filtered = filtered.filter((r) => r.create_date >= cutoff);
          return chain;
        },
        orderBy: (_col: string, dir: 'asc' | 'desc') => {
          filtered = [...filtered].sort((a, b) => (dir === 'desc' ? b.id - a.id : a.id - b.id));
          return chain;
        },
        limit: async (n: number) => filtered.slice(0, n),
        first: async () => filtered[0],
      };
      return chain;
    },
  })) as unknown as typeof AuditLog.query);

  return { auditRows };
}

describe('orm-a2a wire-compatibility with @moonwitness/ai-runtime', () => {
  let postDelegate: RouteHandler;
  let auditRows: StoredAuditRow[];

  beforeEach(async () => {
    const harness = createInMemoryOrmHarness();
    auditRows = harness.auditRows;

    process.env.MW_A2A_API_ENABLED = 'true';
    process.env.MW_A2A_SIGNING_SECRET = A2A_SECRET;
    process.env.MW_A2A_COMPANY_ID = String(COMPANY_ID);
    process.env.MW_A2A_API_ENDPOINT = RECEIVER_ENDPOINT;

    const fakeApp: AddonHttpApp = {
      get: () => {},
      post: (path, optsOrHandler, maybeHandler) => {
        if (path === '/a2a/delegate') {
          postDelegate = (maybeHandler ?? optsOrHandler) as RouteHandler;
        }
      },
      put: () => {},
      patch: () => {},
      delete: () => {},
    };

    await a2aApiRoutes(fakeApp, {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MW_A2A_API_ENABLED;
    delete process.env.MW_A2A_SIGNING_SECRET;
    delete process.env.MW_A2A_COMPANY_ID;
    delete process.env.MW_A2A_API_ENDPOINT;
  });

  async function invokeDelegate(
    body: unknown,
    options: { readonly remoteAddress?: string; readonly protocolHeader?: string } = {}
  ): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
    let statusCode = 200;
    let payload: unknown;
    const reply: AddonHttpReply = {
      code(code: number) {
        statusCode = code;
        return reply;
      },
      header() {
        return reply;
      },
      send(data: unknown) {
        payload = data;
        return data;
      },
    };
    const request = {
      body,
      headers: {
        'x-a2a-protocol': options.protocolHeader ?? 'a2a.v1',
      },
      params: {},
      query: {},
      raw: {
        socket: {
          remoteAddress: options.remoteAddress ?? SOURCE_MESH_IP,
        },
      },
    } as unknown as AddonHttpRequest;

    const result = await postDelegate(request, reply);
    return {
      statusCode,
      body: (payload ?? result) as Record<string, unknown>,
    };
  }

  function buildEnvelope(
    messageId: string,
    fencingToken: number,
    overrides: {
      readonly nonce?: string;
      readonly companyId?: number;
      readonly sourceEndpoint?: string;
      readonly targetEndpoint?: string;
      readonly payload?: Record<string, unknown>;
      readonly secret?: string;
    } = {}
  ) {
    return createSignedA2AEnvelope(
      {
        messageId,
        sourceAgentId: 'agent_source',
        targetAgentId: 'agent_target',
        sourceEndpoint: overrides.sourceEndpoint ?? SOURCE_ENDPOINT,
        targetEndpoint: overrides.targetEndpoint ?? RECEIVER_ENDPOINT,
        companyId: overrides.companyId ?? COMPANY_ID,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken,
        ttlMs: 60_000,
        ...(overrides.nonce !== undefined ? { nonce: overrides.nonce } : {}),
        payload: overrides.payload ?? { task: 'wire-compat-check', nested: { z: 1, a: 2 } },
      },
      overrides.secret ?? A2A_SECRET
    );
  }

  it('accepts signed envelopes produced by @moonwitness/ai-runtime and persists durable receipt', async () => {
    const res = await invokeDelegate(buildEnvelope('wire-msg-1', 1));
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      status: 'queued',
      messageId: 'wire-msg-1',
      companyId: COMPANY_ID,
      delegationDepth: 1,
      fencingToken: 1,
    });
    expect(auditRows.filter((r) => r.model === 'ai.a2a_message')).toHaveLength(1);
    expect(auditRows.filter((r) => r.model === 'ai.a2a_fencing')).toHaveLength(1);
  });

  it('rejects replayed nonces and duplicate message IDs with 409', async () => {
    const sharedNonce = 'wire_compat_replay_nonce_0001';
    expect(
      (await invokeDelegate(buildEnvelope('wire-replay-1', 1, { nonce: sharedNonce }))).statusCode
    ).toBe(202);

    const replayRes = await invokeDelegate(
      buildEnvelope('wire-replay-2', 2, { nonce: sharedNonce })
    );
    expect(replayRes.statusCode).toBe(409);
    expect(replayRes.body.reasonCode).toBe('REPLAY_NONCE_DETECTED');

    const dupRes = await invokeDelegate(
      buildEnvelope('wire-replay-1', 3, { nonce: 'wire_compat_replay_nonce_0003' })
    );
    expect(dupRes.statusCode).toBe(409);
    expect(dupRes.body.reasonCode).toBe('DUPLICATE_MESSAGE_ID');
  });

  it('rejects stale fencing tokens with 409 and accepts strictly higher tokens', async () => {
    expect((await invokeDelegate(buildEnvelope('wire-fence-1', 10))).statusCode).toBe(202);

    const staleRes = await invokeDelegate(buildEnvelope('wire-fence-stale', 10));
    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.body.reasonCode).toBe('STALE_FENCING_TOKEN');

    const higherRes = await invokeDelegate(buildEnvelope('wire-fence-next', 11));
    expect(higherRes.statusCode).toBe(202);
  });

  it('rejects forged signatures and tampered payloads with 401 INVALID_SIGNATURE', async () => {
    const wrongSecretRes = await invokeDelegate(
      buildEnvelope('wire-forged-secret', 1, {
        secret: 'different-signing-secret-that-is-long-enough',
      })
    );
    expect(wrongSecretRes.statusCode).toBe(401);
    expect(wrongSecretRes.body.reasonCode).toBe('INVALID_SIGNATURE');

    const valid = buildEnvelope('wire-tampered', 2);
    const tamperedRes = await invokeDelegate({ ...valid, payload: { task: 'tampered-payload' } });
    expect(tamperedRes.statusCode).toBe(401);
    expect(tamperedRes.body.reasonCode).toBe('INVALID_SIGNATURE');
  });

  it('rejects scope, protocol header, and endpoint mismatches fail-closed', async () => {
    const valid = buildEnvelope('wire-scope-header', 1);

    const badHeaderRes = await invokeDelegate(valid, { protocolHeader: 'a2a.v0' });
    expect(badHeaderRes.statusCode).toBe(400);
    expect(badHeaderRes.body.reasonCode).toBe('INVALID_PROTOCOL_VERSION');

    const companyRes = await invokeDelegate(
      buildEnvelope('wire-scope-company', 2, { companyId: COMPANY_ID + 99 })
    );
    expect(companyRes.statusCode).toBe(403);
    expect(companyRes.body.reasonCode).toBe('COMPANY_ISOLATION_VIOLATION');

    const targetRes = await invokeDelegate(
      buildEnvelope('wire-scope-target', 3, { targetEndpoint: 'http://100.64.0.99:3000' })
    );
    expect(targetRes.statusCode).toBe(403);
    expect(targetRes.body.reasonCode).toBe('TARGET_ENDPOINT_MISMATCH');

    const publicPeerRes = await invokeDelegate(valid, { remoteAddress: '1.1.1.1' });
    expect(publicPeerRes.statusCode).toBe(403);
    expect(publicPeerRes.body.reasonCode).toBe('PUBLIC_ENDPOINT_FORBIDDEN');
  });
});
