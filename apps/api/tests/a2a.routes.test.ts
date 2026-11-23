import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignedA2AEnvelope } from '@moonwitness/ai-runtime';
import { Agent } from '@moonwitness/orm-ai';
import { Company, CompanyMembership, Partner, User } from '@moonwitness/orm-base';
import { LocalFileAttachmentStorage } from '@moonwitness/orm-storage';
import { buildApp } from '../src/app.js';

const USER_PASSWORD = 'test-operator-password-123';
const JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123';
const A2A_SECRET = 'test-moonwitness-a2a-signing-secret-2026';

describe('A2A API durable mesh inbox', () => {
  let db: Knex;
  let app: FastifyInstance;
  let storageDir: string;
  let attachmentStorage: LocalFileAttachmentStorage;
  let operator: {
    company: InstanceType<typeof Company>;
    headers: { authorization: string; 'x-company-id': string };
  };
  let sourceAgent: InstanceType<typeof Agent>;
  let targetAgent: InstanceType<typeof Agent>;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_TO_FILE = 'false';
    process.env.MW_A2A_API_ENABLED = 'false';
    delete process.env.MW_A2A_SIGNING_SECRET;
    delete process.env.MW_A2A_COMPANY_ID;
    delete process.env.MW_A2A_API_ENDPOINT;

    storageDir = await mkdtemp(join(tmpdir(), 'mw-api-a2a-routes-'));
    attachmentStorage = new LocalFileAttachmentStorage(storageDir);
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          conn: { pragma(sql: string): unknown },
          done: (err: Error | null, conn: unknown) => void
        ) {
          conn.pragma('foreign_keys = ON');
          done(null, conn);
        },
      },
    });

    app = await buildApp({
      db,
      superadminPassword: 'test-superadmin-password-123',
      jwtSecret: JWT_SECRET,
      loginRateMax: 1000,
      attachmentStorage,
      attachmentScanner: null,
      checkWhatsAppGateway: async () => true,
    });
    await app.ready();

    operator = await createTenantOperator('A2A Integration Co', 'a2a_operator');
    sourceAgent = await Agent.query().insertAndFetch({
      company_id: operator.company.id,
      code: 'peer_source',
      status: 'active',
      role_template: 'researcher',
    });
    targetAgent = await Agent.query().insertAndFetch({
      company_id: operator.company.id,
      code: 'peer_target',
      status: 'active',
      role_template: 'builder',
    });

    process.env.MW_A2A_API_ENABLED = 'true';
    process.env.MW_A2A_SIGNING_SECRET = A2A_SECRET;
    process.env.MW_A2A_COMPANY_ID = String(operator.company.id);
    process.env.MW_A2A_API_ENDPOINT = 'http://100.64.0.20:3000';
  });

  afterEach(async () => {
    await app?.close();
    await db?.destroy();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    delete process.env.MW_A2A_API_ENABLED;
    delete process.env.MW_A2A_SIGNING_SECRET;
    delete process.env.MW_A2A_COMPANY_ID;
    delete process.env.MW_A2A_API_ENDPOINT;
  });

  async function createTenantOperator(companyName: string, login: string) {
    const company = await Company.query().insertAndFetch({ name: companyName });
    const partner = await Partner.query().insertAndFetch({
      name: companyName + ' ' + login,
      company_id: company.id,
    });
    const user = await User.query().insertAndFetch({
      login,
      password: USER_PASSWORD,
      role: 'superadmin',
      partner_id: partner.id,
    });
    await CompanyMembership.query().insert({
      user_id: user.id,
      company_id: company.id,
      is_default: true,
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login, password: USER_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const token = (loginRes.json() as { data: { access_token: string } }).data.access_token;
    return {
      company,
      headers: {
        authorization: 'Bearer ' + token,
        'x-company-id': String(company.id),
      },
    };
  }

  function signedEnvelope(
    messageId: string,
    fencingToken: number,
    overrides: {
      readonly nonce?: string;
      readonly sourceEndpoint?: string;
      readonly targetEndpoint?: string;
      readonly omitSourceEndpoint?: boolean;
    } = {}
  ) {
    return createSignedA2AEnvelope(
      {
        messageId,
        sourceAgentId: sourceAgent.code,
        targetAgentId: targetAgent.code,
        ...(overrides.omitSourceEndpoint === true
          ? {}
          : { sourceEndpoint: overrides.sourceEndpoint ?? 'http://100.64.0.10:3003' }),
        targetEndpoint: overrides.targetEndpoint ?? process.env.MW_A2A_API_ENDPOINT!,
        companyId: operator.company.id,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken,
        ttlMs: 60_000,
        ...(overrides.nonce !== undefined ? { nonce: overrides.nonce } : {}),
        payload: { task: 'run-tests', target: 'apps/api' },
      },
      A2A_SECRET
    );
  }

  async function postEnvelope(
    envelope: ReturnType<typeof signedEnvelope>,
    remoteAddress = '100.64.0.10'
  ) {
    return app.inject({
      method: 'POST',
      url: '/a2a/delegate',
      remoteAddress,
      headers: { 'x-a2a-protocol': 'a2a.v1' },
      payload: envelope,
    });
  }

  it('keeps the receiver disabled by default', async () => {
    process.env.MW_A2A_API_ENABLED = 'false';
    const response = await postEnvelope(signedEnvelope('disabled-message', 1));
    expect(response.statusCode).toBe(404);
  });

  it('accepts a signed private-mesh envelope and stores a durable inbox receipt', async () => {
    const response = await postEnvelope(signedEnvelope('message-accepted', 1));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'queued',
      messageId: 'message-accepted',
      companyId: operator.company.id,
      delegationDepth: 1,
      fencingToken: 1,
    });

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/ai/a2a/inbox?limit=20',
      headers: operator.headers,
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data).toHaveLength(1);
    expect(inbox.json().data[0]).toMatchObject({
      messageId: 'message-accepted',
      sourceAgentId: 'peer_source',
      targetAgentId: 'peer_target',
      fencingToken: 1,
      sourcePeerAddress: '100.64.0.10',
      status: 'queued',
    });
    expect(JSON.stringify(inbox.json())).not.toContain(A2A_SECRET);
  });

  it('accepts an omitted sourceEndpoint and a bare private mesh target address', async () => {
    process.env.MW_A2A_API_ENDPOINT = 'http://100.64.0.20';
    const response = await postEnvelope(
      signedEnvelope('optional-source-endpoint', 1, {
        omitSourceEndpoint: true,
        targetEndpoint: '100.64.0.20',
      })
    );
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'queued',
      messageId: 'optional-source-endpoint',
    });

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/ai/a2a/inbox',
      headers: operator.headers,
    });
    expect(inbox.json().data[0]).toMatchObject({
      sourcePeerAddress: '100.64.0.10',
    });
  });

  it('rejects nonce replay and duplicate message IDs', async () => {
    const first = signedEnvelope('message-replay', 1, { nonce: 'replay_nonce_0001' });
    const accepted = await postEnvelope(first);
    expect(accepted.statusCode).toBe(202);

    // Advance fencing while reusing the consumed nonce, so this assertion exercises
    // the persistent nonce ledger rather than the earlier stale-fencing guard.
    const nonceReplay = await postEnvelope(
      signedEnvelope('message-replay-nonce-reuse', 2, { nonce: 'replay_nonce_0001' })
    );
    expect(nonceReplay.statusCode).toBe(409);
    expect(nonceReplay.json().reasonCode).toBe('REPLAY_NONCE_DETECTED');

    const duplicateId = await postEnvelope(
      signedEnvelope('message-replay', 3, { nonce: 'replay_nonce_0003' })
    );
    expect(duplicateId.statusCode).toBe(409);
    expect(duplicateId.json().reasonCode).toBe('DUPLICATE_MESSAGE_ID');
  });

  it('enforces persistent monotonic fencing per source agent', async () => {
    expect((await postEnvelope(signedEnvelope('fence-one', 7))).statusCode).toBe(202);
    const stale = await postEnvelope(signedEnvelope('fence-stale', 7));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().reasonCode).toBe('STALE_FENCING_TOKEN');

    const next = await postEnvelope(signedEnvelope('fence-next', 8));
    expect(next.statusCode).toBe(202);
  });

  it('binds the source endpoint to the direct socket and rejects non-mesh senders', async () => {
    const mismatch = await postEnvelope(
      signedEnvelope('source-mismatch', 1, { sourceEndpoint: 'http://100.64.0.11:3003' })
    );
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().reasonCode).toBe('SOURCE_ENDPOINT_MISMATCH');

    const publicPeer = await postEnvelope(signedEnvelope('public-peer', 1), '8.8.8.8');
    expect(publicPeer.statusCode).toBe(403);
    expect(publicPeer.json().reasonCode).toBe('PUBLIC_ENDPOINT_FORBIDDEN');
  });

  it('rejects self-acceptance claims and unauthenticated inbox reads', async () => {
    const valid = signedEnvelope('self-accept', 1);
    const forged = { ...valid, claimedStatus: 'accepted' };
    const rejected = await postEnvelope(forged);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().reasonCode).toBe('SERVER_ONLY_ACCEPTED_AUTHORITY');

    const unauthenticatedInbox = await app.inject({
      method: 'GET',
      url: '/api/ai/a2a/inbox',
    });
    expect(unauthenticatedInbox.statusCode).toBe(401);
  });

  it('rejects messages for another company before persisting them', async () => {
    const forged = { ...signedEnvelope('wrong-company', 1), companyId: operator.company.id + 10 };
    const response = await postEnvelope(forged);
    expect(response.statusCode).toBe(403);
    expect(response.json().reasonCode).toBe('COMPANY_ISOLATION_VIOLATION');

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/ai/a2a/inbox',
      headers: operator.headers,
    });
    expect(inbox.json().data).toHaveLength(0);
  });
});
