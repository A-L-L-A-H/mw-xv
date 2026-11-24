import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignedA2AEnvelope } from '@moonwitness/ai-runtime';
import type { AddonHttpApp, AddonHttpReply, AddonHttpRequest } from '@moonwitness/orm';
import { Agent } from '@moonwitness/orm-ai';
import { AuditLog, Company } from '@moonwitness/orm-base';
import {
  A2aIngestionThrottle,
  DEFAULT_A2A_INGESTION_BACKPRESSURE,
  DEFAULT_A2A_INBOX_RETENTION,
  createA2aPeerIdentityRegistry,
  a2aApiRoutes,
  type A2aReceiverServices,
  type A2aTransportIdentityConfig,
} from '../src/index.js';

const A2A_SECRET = 'receiver-gate-test-company-signing-secret-2026';
const KEY_SECRET = 'registered-peer-key-secret-0123456789abcdef';
const RECEIVER_ENDPOINT = 'http://100.64.0.20:3000';
const SOURCE_IP = '100.64.0.10';
const SOURCE_ENDPOINT = `http://${SOURCE_IP}:3003`;
const COMPANY_ID = 77;
const NOW = 1_763_865_600_000;
const CERT_FINGERPRINT = 'ab'.repeat(32);
const CERT_IDENTITY = 'spiffe://mesh/company/77/agent_source';

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

function applyWhere(
  rows: readonly StoredAuditRow[],
  columnOrCriteria: unknown,
  operator?: unknown,
  value?: unknown
): StoredAuditRow[] {
  if (typeof columnOrCriteria === 'object' && columnOrCriteria !== null) {
    const criteria = columnOrCriteria as Partial<StoredAuditRow>;
    return rows.filter(
      (row) =>
        (criteria.model === undefined || row.model === criteria.model) &&
        (criteria.record_id === undefined || row.record_id === criteria.record_id) &&
        (criteria.operation === undefined || row.operation === criteria.operation)
    );
  }
  const column = String(columnOrCriteria);
  return rows.filter((row) => {
    if (column === 'id' && operator === '<') return row.id < Number(value);
    if (column === 'create_date' && operator === '>=') return row.create_date >= String(value);
    return true;
  });
}

function createHarness(clock: () => number = () => Date.now()) {
  const auditRows: StoredAuditRow[] = [];
  let nextId = 1;
  const agents = new Map([
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

  const auditQuery = () => {
    let filtered: StoredAuditRow[] = auditRows;
    const chain = {
      where: (columnOrCriteria: unknown, operator?: unknown, value?: unknown) => {
        filtered = applyWhere(filtered, columnOrCriteria, operator, value);
        return chain;
      },
      orderBy: (_column: string, direction: 'asc' | 'desc') => {
        filtered = [...filtered].sort((left, right) =>
          direction === 'desc' ? right.id - left.id : left.id - right.id
        );
        return chain;
      },
      limit: async (n: number) => filtered.slice(0, n),
      first: async () => filtered[0],
      insert: async (row: Omit<StoredAuditRow, 'id' | 'create_date'>) => {
        const created: StoredAuditRow = {
          ...row,
          id: nextId++,
          create_date: new Date(clock()).toISOString(),
        };
        auditRows.push(created);
        return created;
      },
    };
    return chain;
  };
  vi.spyOn(AuditLog, 'query').mockImplementation((() =>
    auditQuery()) as unknown as typeof AuditLog.query);

  return { auditRows };
}

function createReply() {
  let statusCode = 200;
  let payload: unknown;
  const headers: Record<string, string> = {};
  const reply: AddonHttpReply = {
    code(code: number) {
      statusCode = code;
      return reply;
    },
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
    send(data: unknown) {
      payload = data;
      return data;
    },
  };
  return {
    reply,
    outcome: (result: unknown) => ({
      statusCode,
      body: (payload ?? result ?? {}) as Record<string, unknown>,
      headers,
    }),
  };
}

describe('A2A receiver CF-017/018/019 gates', () => {
  let postHandler: RouteHandler;
  let getHandler: RouteHandler;
  let auditRows: StoredAuditRow[];
  let currentNow: number;
  let nextFencingToken: number;
  let app: AddonHttpApp;

  beforeEach(async () => {
    currentNow = NOW;
    const harness = createHarness(() => currentNow);
    auditRows = harness.auditRows;
    nextFencingToken = 1;

    process.env.MW_A2A_API_ENABLED = 'true';
    process.env.MW_A2A_SIGNING_SECRET = A2A_SECRET;
    process.env.MW_A2A_COMPANY_ID = String(COMPANY_ID);
    process.env.MW_A2A_API_ENDPOINT = RECEIVER_ENDPOINT;
    delete process.env.MW_A2A_PEER_KEYS_JSON;
    delete process.env.MW_A2A_PEER_IDENTITY_ENABLED;
    delete process.env.MW_A2A_TRANSPORT_PEERS_JSON;
    delete process.env.MW_A2A_TRANSPORT_IDENTITY_ENABLED;

    app = {
      get: (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        if (path === '/api/ai/a2a/inbox') {
          getHandler = (maybeHandler ?? optsOrHandler) as RouteHandler;
        }
      },
      post: (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        if (path === '/a2a/delegate') {
          postHandler = (maybeHandler ?? optsOrHandler) as RouteHandler;
        }
      },
      put: () => {},
      patch: () => {},
      delete: () => {},
    } as unknown as AddonHttpApp;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MW_A2A_API_ENABLED;
    delete process.env.MW_A2A_SIGNING_SECRET;
    delete process.env.MW_A2A_COMPANY_ID;
    delete process.env.MW_A2A_API_ENDPOINT;
    delete process.env.MW_A2A_PEER_KEYS_JSON;
    delete process.env.MW_A2A_PEER_IDENTITY_ENABLED;
    delete process.env.MW_A2A_TRANSPORT_PEERS_JSON;
    delete process.env.MW_A2A_TRANSPORT_IDENTITY_ENABLED;
  });

  async function register(services: A2aReceiverServices = {}): Promise<void> {
    await a2aApiRoutes(
      app,
      { hasCompanyAccess: async () => true },
      { now: () => currentNow, ...services }
    );
  }

  function envelope(
    messageId: string,
    overrides: {
      readonly nonce?: string;
      readonly keyId?: string;
      readonly secret?: string;
      readonly sourceAgentId?: string;
      readonly nowMs?: number;
      readonly fencingToken?: number;
    } = {}
  ) {
    return createSignedA2AEnvelope(
      {
        messageId,
        ...(overrides.keyId !== undefined ? { keyId: overrides.keyId } : {}),
        sourceAgentId: overrides.sourceAgentId ?? 'agent_source',
        targetAgentId: 'agent_target',
        sourceEndpoint: SOURCE_ENDPOINT,
        targetEndpoint: RECEIVER_ENDPOINT,
        companyId: COMPANY_ID,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken: overrides.fencingToken ?? nextFencingToken++,
        ttlMs: 60_000,
        nowMs: overrides.nowMs ?? NOW,
        ...(overrides.nonce !== undefined ? { nonce: overrides.nonce } : {}),
        payload: { task: 'gate-check', nested: { a: 1 } },
      },
      overrides.secret ?? A2A_SECRET
    );
  }

  async function invokePost(
    body: unknown,
    options: {
      readonly socket?: Record<string, unknown>;
      readonly headers?: Record<string, string>;
    } = {}
  ) {
    const { reply, outcome } = createReply();
    const request = {
      body,
      headers: { 'x-a2a-protocol': 'a2a.v1', ...(options.headers ?? {}) },
      params: {},
      query: {},
      raw: { socket: { remoteAddress: SOURCE_IP, ...(options.socket ?? {}) } },
    } as unknown as AddonHttpRequest;
    const result = await postHandler(request, reply);
    return outcome(result);
  }

  async function invokeGet(query: { limit?: string; cursor?: string }) {
    const { reply, outcome } = createReply();
    const request = {
      headers: {},
      params: {},
      query,
      auth: { userId: 1, companyId: COMPANY_ID, role: 'superadmin' },
      raw: {},
    } as unknown as AddonHttpRequest;
    const result = await getHandler(request, reply);
    return outcome(result);
  }

  const registry = () =>
    createA2aPeerIdentityRegistry([
      {
        keyId: 'peer-key-1',
        companyId: COMPANY_ID,
        agentCode: 'agent_source',
        secret: KEY_SECRET,
        activatedAt: NOW,
      },
    ]);

  const tlsSocket = () => ({
    authorized: true,
    getProtocol: () => 'TLSv1.3',
    getPeerCertificate: () => ({
      subject: { CN: CERT_IDENTITY },
      subjectaltname: `URI:${CERT_IDENTITY}`,
      fingerprint256: CERT_FINGERPRINT,
      valid_from: 'Jan 01 12:00:00 2024 GMT',
      valid_to: 'Jan 01 12:00:00 2027 GMT',
    }),
  });

  const transportConfig = (): A2aTransportIdentityConfig => ({
    enabled: true,
    peers: [
      {
        identity: CERT_IDENTITY,
        companyId: COMPANY_ID,
        agentCode: 'agent_source',
        keyId: 'peer-key-1',
        allowedFingerprints: [CERT_FINGERPRINT],
      },
    ],
  });

  it('resolves a signed envelope to a registered peer key and audits only its fingerprint', async () => {
    await register({ peerIdentityRegistry: registry() });

    const accepted = await invokePost(
      envelope('peer-key-ok', { keyId: 'peer-key-1', secret: KEY_SECRET })
    );
    expect(accepted.statusCode, JSON.stringify(accepted.body)).toBe(202);
    const receipt = auditRows.find((row) => row.model === 'ai.a2a_message');
    expect(JSON.parse(receipt!.changes)).toMatchObject({
      peerKeyId: 'peer-key-1',
      peerKeyFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(auditRows)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(auditRows)).not.toContain(A2A_SECRET);

    const replay = await invokePost(
      envelope('peer-key-replay', {
        keyId: 'peer-key-1',
        secret: KEY_SECRET,
        nonce: 'peer_key_replay_nonce_001',
      })
    );
    expect(
      (
        await invokePost(
          envelope('peer-key-replay-2', {
            keyId: 'peer-key-1',
            secret: KEY_SECRET,
            nonce: 'peer_key_replay_nonce_001',
          })
        )
      ).body.reasonCode
    ).toBe('REPLAY_NONCE_DETECTED');
    expect(replay.statusCode).toBe(202);

    const unknown = await invokePost(
      envelope('peer-key-unknown', { keyId: 'ghost-key', secret: KEY_SECRET })
    );
    expect(unknown.statusCode).toBe(401);
    expect(unknown.body.reasonCode).toBe('PEER_KEY_UNKNOWN');

    const missing = await invokePost(envelope('peer-key-missing', { secret: KEY_SECRET }));
    expect(missing.body.reasonCode).toBe('PEER_KEY_ID_REQUIRED');

    const mismatch = await invokePost(
      envelope('peer-key-mismatch', {
        keyId: 'peer-key-1',
        secret: KEY_SECRET,
        sourceAgentId: 'agent_target',
      })
    );
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.body.reasonCode).toBe('PEER_KEY_AGENT_MISMATCH');

    const pinned = registry();
    pinned.revoke('peer-key-1', NOW + 1);
    await register({ peerIdentityRegistry: pinned, now: () => NOW + 2 });
    currentNow = NOW + 2;
    const revoked = await invokePost(
      envelope('peer-key-revoked', { keyId: 'peer-key-1', secret: KEY_SECRET, nowMs: NOW + 2 })
    );
    expect(revoked.body.reasonCode).toBe('PEER_KEY_REVOKED');
  });

  it('enforces transport identity from the socket and ignores forwarded headers', async () => {
    await register({ transportIdentityConfig: transportConfig() });

    const transportOk = await invokePost(envelope('transport-ok'), { socket: tlsSocket() });
    expect(transportOk.statusCode, JSON.stringify(transportOk.body)).toBe(202);
    expect(
      (
        await invokePost(envelope('transport-missing'), {
          headers: {
            'x-forwarded-client-cert': CERT_FINGERPRINT,
            'x-ssl-client-verify': 'SUCCESS',
          },
        })
      ).body.reasonCode
    ).toBe('TRANSPORT_TLS_REQUIRED');
    expect(
      (
        await invokePost(envelope('transport-untrusted'), {
          socket: { ...tlsSocket(), authorized: false },
        })
      ).body.reasonCode
    ).toBe('TRANSPORT_CERT_UNTRUSTED');

    const mismatchedConfig: A2aTransportIdentityConfig = {
      enabled: true,
      peers: [
        {
          identity: CERT_IDENTITY,
          companyId: COMPANY_ID + 1,
          agentCode: 'agent_target',
          allowedFingerprints: [CERT_FINGERPRINT],
        },
      ],
    };
    await register({ transportIdentityConfig: mismatchedConfig });
    const mismatched = await invokePost(envelope('transport-mismatch'), { socket: tlsSocket() });
    expect(mismatched.statusCode).toBe(403);
    expect(mismatched.body.reasonCode).toBe('TRANSPORT_IDENTITY_MISMATCH');
  });

  it('applies explicit ingestion backpressure with a Retry-After response', async () => {
    const throttle = new A2aIngestionThrottle(
      { ...DEFAULT_A2A_INGESTION_BACKPRESSURE, maxRequestsPerWindow: 1 },
      () => NOW
    );
    await register({ ingestionThrottle: throttle });

    const firstThrottled = await invokePost(
      envelope('throttle-1', { nonce: 'throttle_nonce_000001' })
    );
    expect(firstThrottled.statusCode, JSON.stringify(firstThrottled.body)).toBe(202);
    const limited = await invokePost(envelope('throttle-2', { nonce: 'throttle_nonce_000002' }));
    expect(limited.statusCode).toBe(429);
    expect(limited.body.reasonCode).toBe('A2A_RATE_LIMITED');
    expect(limited.headers['Retry-After']).toBeDefined();

    const tinyLimitThrottle = new A2aIngestionThrottle(
      { ...DEFAULT_A2A_INGESTION_BACKPRESSURE, maxEnvelopeBytes: 64 },
      () => NOW
    );
    await register({ ingestionThrottle: tinyLimitThrottle });
    const tooLarge = await invokePost(envelope('throttle-too-large'));
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.body.reasonCode).toBe('ENVELOPE_TOO_LARGE');
  });

  it('paginates inbox reads with stable cursors and minimizes expired payloads', async () => {
    await register();
    for (let i = 1; i <= 3; i += 1) {
      const result = await invokePost(
        envelope(`inbox-msg-${i}`, { nonce: `inbox_nonce_${String(i).padStart(6, '0')}` })
      );
      expect(result.statusCode).toBe(202);
    }

    const firstPage = await invokeGet({ limit: '2' });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.page).toMatchObject({ limit: 2, hasMore: true });
    const firstIds = (firstPage.body.data as Array<{ id: number }>).map((row) => row.id);
    expect(firstIds[0]!).toBeGreaterThan(firstIds[1]!);

    const secondPage = await invokeGet({
      limit: '2',
      cursor: firstPage.body.page.nextCursor as string,
    });
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.page).toMatchObject({ hasMore: false, nextCursor: null });
    const allIds = [
      ...firstIds,
      ...(secondPage.body.data as Array<{ id: number }>).map((row) => row.id),
    ];
    expect(new Set(allIds).size).toBe(3);

    const invalidLimit = await invokeGet({ limit: '201' });
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidLimit.body.reasonCode).toBe('INVALID_INBOX_LIMIT');
    const invalidCursor = await invokeGet({ cursor: 'not-a-number' });
    expect(invalidCursor.body.reasonCode).toBe('INVALID_INBOX_CURSOR');

    currentNow = NOW + DEFAULT_A2A_INBOX_RETENTION.payloadRetentionMs + 1;
    const minimized = await invokeGet({ limit: '1' });
    const row = (minimized.body.data as Array<Record<string, unknown>>)[0]!;
    expect(row.payload).toBeUndefined();
    expect(row.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(row.auditLogId).toBe(firstIds[0]);
    expect(row.retention).toMatchObject({
      auditMetadata: 'retained_indefinitely',
      payload: 'minimized',
      digestPreserved: true,
      auditReferencePreserved: true,
    });
  });
});
