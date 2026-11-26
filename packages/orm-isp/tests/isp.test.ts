import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import {
  assertAddonDefaultDataPolicy,
  installAddons,
  resolveViews,
  validateViews,
} from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as projectManifest } from '@moonwitness/orm-project';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import {
  manifest as subscriptionManifest,
  Subscription,
  SubscriptionInvoiceLine,
} from '@moonwitness/orm-subscription';
import { AuditLog } from '@moonwitness/orm-base';
import { Cron, enqueueJob, jobsManifest, runOneJob } from '@moonwitness/jobs';
import {
  ISPBandwidthProfile,
  ISPNAS,
  ISPPool,
  ISPRadiusOutbox,
  ISPRadiusSession,
  ISPSubscriber,
  ISPType,
  ISP_INTERNAL_AUTH_DOMAIN,
  createIspHttpPlugin,
  dispatchIspDisconnect,
  ensureIspCrons,
  manifest,
  parseDisconnectOutcome,
  processIspRadiusOutbox,
  registerIspJobHandlers,
  resolveIspAdminToken,
  selectHealthyNas,
  syncIspRuntimeSessions,
} from '../src/index.js';

function expectedAdminToken(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret).update(ISP_INTERNAL_AUTH_DOMAIN).digest('hex');
}

describe('@moonwitness/orm-isp addon', () => {
  let db: Knex;

  beforeEach(() => {
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
  });

  afterEach(async () => db.destroy());

  it('installs ISP models linked to partner, project, and subscription with valid views and seeds', async () => {
    const deps = [
      baseManifest,
      jobsManifest,
      notificationManifest,
      organizationManifest,
      workflowManifest,
      projectManifest,
      crmManifest,
      salesManifest,
      subscriptionManifest,
    ];
    await installAddons(db, [...deps, manifest]);
    await installAddons(db, [manifest, ...deps]);

    expect(manifest.depends).toEqual(['base', 'project', 'subscription']);
    expect(() => assertAddonDefaultDataPolicy([manifest])).not.toThrow();

    expect(await db(ISPType.tableName).count({ count: '*' }).first()).toMatchObject({ count: 3 });
    expect(await db(ISPNAS.tableName).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(ISPBandwidthProfile.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 2,
    });
    expect(await db(ISPPool.tableName).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(ISPSubscriber.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });

    const subscriber = await ISPSubscriber.query().first();
    expect(subscriber).toMatchObject({
      status: 'active',
      type: 'pppoe',
    });
    expect(subscriber?.partner_id).toBeGreaterThan(0);
    expect(subscriber?.subscription_id).toBeGreaterThan(0);
    expect(subscriber?.project_id).toBeGreaterThan(0);

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
    expect(ISPRadiusSession.modelName).toBe('isp.radius_session');

    const failoverNas = selectHealthyNas([
      { id: 1, name: 'core-1', ha_priority: 10, health_status: 'offline', is_active: true },
      { id: 2, name: 'core-2', ha_priority: 20, health_status: 'healthy', is_active: true },
    ]);
    expect(failoverNas?.name).toBe('core-2');
  });

  describe('resolveIspAdminToken', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
      delete process.env.MW_ISP_ADMIN_TOKEN;
      delete process.env.MW_INTERNAL_SECRET;
      delete process.env.JWT_SECRET;
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('returns explicit adminToken verbatim', () => {
      expect(resolveIspAdminToken({ adminToken: '  explicit-token  ' })).toBe('explicit-token');
      expect(resolveIspAdminToken({ adminToken: 'x', jwtSecret: 'ignored' })).toBe('x');
    });

    it('derives an HMAC-SHA256 token from the jwt secret matching the ISP auth domain', () => {
      expect(resolveIspAdminToken({ jwtSecret: 'unit-test-secret' })).toBe(
        expectedAdminToken('unit-test-secret')
      );
    });

    it('prefers MW_ISP_ADMIN_TOKEN over derived HMAC secrets', () => {
      process.env.MW_ISP_ADMIN_TOKEN = 'env-admin-token';
      process.env.MW_INTERNAL_SECRET = 'internal-secret';
      expect(resolveIspAdminToken()).toBe('env-admin-token');
    });

    it('derives from MW_INTERNAL_SECRET / JWT_SECRET when no explicit token exists', () => {
      process.env.JWT_SECRET = 'jwt-env-secret';
      expect(resolveIspAdminToken()).toBe(expectedAdminToken('jwt-env-secret'));

      delete process.env.JWT_SECRET;
      process.env.MW_INTERNAL_SECRET = 'internal-env-secret';
      expect(resolveIspAdminToken()).toBe(expectedAdminToken('internal-env-secret'));
    });

    it('returns undefined when no token or secret is available', () => {
      expect(resolveIspAdminToken()).toBeUndefined();
      expect(resolveIspAdminToken({ adminToken: '   ', jwtSecret: '  ' })).toBeUndefined();
    });
  });

  describe('ispHttpPlugin with Bearer auth forwarding', () => {
    interface CapturedRequest {
      url: string;
      method: string;
      authorization?: string;
      body?: string;
    }

    let requests: CapturedRequest[];
    let app: ReturnType<typeof Fastify>;
    let currentAuth: {
      userId: number;
      role: string;
      companyId?: number;
      groupPermissions?: Array<{
        model_name: string;
        read: boolean;
        create: boolean;
        write: boolean;
        unlink: boolean;
      }>;
    } | null;

    const allDeps = [
      baseManifest,
      jobsManifest,
      notificationManifest,
      organizationManifest,
      workflowManifest,
      projectManifest,
      crmManifest,
      salesManifest,
      subscriptionManifest,
      manifest,
    ];

    beforeEach(async () => {
      requests = [];
      await installAddons(db, allDeps);

      const JWT_SECRET = 'unit-test-jwt-secret';
      const runtimeSessionsPayload = [
        {
          session_id: 'runtime-sess-001',
          username: 'acme-fiber-01',
          nas_ip: '127.0.0.1',
          nas_port: '6',
          framed_ip: '100.64.0.10',
          calling_station_id: 'AA:BB:CC:DD:EE:FF',
          acct_input_octets: 2_147_483_648,
          acct_output_octets: 1_073_741_824,
          acct_session_time: 5400,
          started_at: '2026-11-22T01:00:00',
          stopped_at: '2026-11-22T02:30:00',
          status: 'stopped',
          terminate_cause: 'User-Request',
        },
        {
          session_id: 'unknown-sess-002',
          username: 'ghost-user',
          status: 'active',
        },
      ];

      app = Fastify({ logger: false });
      currentAuth = { userId: 2, role: 'superadmin', companyId: 1 };
      app.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await app.register(
        createIspHttpPlugin({
          ispServiceUrl: 'http://isp.local:3002',
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async (input, init) => {
            const url = String(input);
            const headers = (init?.headers ?? {}) as Record<string, string>;
            requests.push({
              url,
              method: init?.method ?? 'GET',
              authorization: headers.authorization,
              body: init?.body ? String(init.body) : undefined,
            });
            if (url.endsWith('/health')) {
              return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
            }
            if (url.endsWith('/api/clients')) {
              return new Response(JSON.stringify({ id: 9, name: 'MikroTik Core' }), {
                status: 200,
              });
            }
            if (url.includes('/rotate-secret')) {
              return new Response(JSON.stringify({ id: 9, name: 'MikroTik Core' }), {
                status: 200,
              });
            }
            if (url.endsWith('/api/subscribers')) {
              return new Response(JSON.stringify({ id: 1, username: 'acme-fiber-01' }), {
                status: 200,
              });
            }
            if (url.endsWith('/suspend')) {
              return new Response(JSON.stringify({ username: 'acme-fiber-01' }), { status: 200 });
            }
            if (url.endsWith('/api/sessions/disconnect')) {
              return new Response(JSON.stringify({ sent: true, ack: true }), { status: 200 });
            }
            if (url.endsWith('/api/sessions')) {
              return new Response(JSON.stringify(runtimeSessionsPayload), { status: 200 });
            }
            return new Response('{}', { status: 404 });
          },
        })
      );
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('sends the derived Bearer token on every runtime call, including sync, rotate-secret, subscriber sync, live sessions, suspend, and CoA disconnect', async () => {
      const expectedToken = expectedAdminToken('unit-test-jwt-secret');
      const nas = await ISPNAS.query().first();
      const subscriber = await ISPSubscriber.query().first();
      expect(nas).toBeDefined();
      expect(subscriber).toBeDefined();

      const nasSyncRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/sync`,
      });
      expect(nasSyncRes.statusCode).toBe(200);
      const nasSyncCall = requests.find((r) => r.url === 'http://isp.local:3002/api/clients');
      expect(nasSyncCall?.authorization).toBe(`Bearer ${expectedToken}`);

      const rotateRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
        payload: { reason: 'bearer_test' },
      });
      expect(rotateRes.statusCode).toBe(200);
      const rotateCall = requests.find((r) => r.url.includes('/rotate-secret'));
      expect(rotateCall?.authorization).toBe(`Bearer ${expectedToken}`);

      const subSyncRes = await app.inject({
        method: 'POST',
        url: `/api/isp/subscribers/${subscriber!.id}/sync`,
      });
      expect(subSyncRes.statusCode).toBe(200);
      const subSyncCall = requests.find(
        (r) => r.url === 'http://isp.local:3002/api/subscribers' && r.method === 'POST'
      );
      expect(subSyncCall?.authorization).toBe(`Bearer ${expectedToken}`);

      const liveRes = await app.inject({ method: 'GET', url: '/api/isp/sessions/live' });
      expect(liveRes.statusCode).toBe(200);
      const liveCall = requests.find(
        (r) => r.url === 'http://isp.local:3002/api/sessions' && r.method === 'GET'
      );
      expect(liveCall?.authorization).toBe(`Bearer ${expectedToken}`);

      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/isp/subscribers/${subscriber!.id}/suspend`,
      });
      expect(suspendRes.statusCode).toBe(200);
      expect(suspendRes.json()).toMatchObject({
        success: true,
        data: { status: 'suspended', dispatched: true },
      });
      const suspendCall = requests.find((r) => r.url.endsWith('/suspend'));
      const disconnectCall = requests.find((r) => r.url.endsWith('/api/sessions/disconnect'));
      expect(suspendCall?.authorization).toBe(`Bearer ${expectedToken}`);
      expect(disconnectCall?.authorization).toBe(`Bearer ${expectedToken}`);
      const disconnectPayload = JSON.parse(disconnectCall!.body!) as Record<string, unknown>;
      expect(disconnectPayload).toMatchObject({ username: subscriber!.username });
      expect(disconnectPayload.framed_ip).toBeUndefined();

      const outboxRow = await ISPRadiusOutbox.query().first();
      expect(outboxRow).toMatchObject({ status: 'acknowledged', username: subscriber!.username });
    });

    it('keeps the outbox row pending when the runtime suspend dispatch fails', async () => {
      const subscriber = await ISPSubscriber.query().first();
      expect(subscriber).toBeDefined();

      requests.length = 0;
      // Re-register a plugin whose runtime is offline.
      await app.close();
      const offlineApp = Fastify({ logger: false });
      offlineApp.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await offlineApp.register(
        createIspHttpPlugin({
          ispServiceUrl: 'http://isp.local:3002',
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async () => {
            throw new Error('runtime offline');
          },
        })
      );
      await offlineApp.ready();
      try {
        const res = await offlineApp.inject({
          method: 'POST',
          url: `/api/isp/subscribers/${subscriber!.id}/suspend`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.dispatched).toBe(false);
        const outboxRow = await ISPRadiusOutbox.query().first();
        expect(outboxRow).toMatchObject({ status: 'pending', username: subscriber!.username });
      } finally {
        await offlineApp.close();
      }
    });

    it('syncs runtime sessions into ISPRadiusSession and meters them into SubscriptionInvoiceLine idempotently', async () => {
      const subscriber = await ISPSubscriber.query().first();
      expect(subscriber).toBeDefined();

      const syncRes = await app.inject({
        method: 'POST',
        url: '/api/isp/sessions/sync',
        payload: {},
      });
      expect(syncRes.statusCode).toBe(200);
      expect(syncRes.json()).toMatchObject({
        success: true,
        data: {
          fetchedSessions: 2,
          upsertedSessions: 1,
          createdInvoiceLines: 1,
          totalAmountMinor: 300,
        },
      });

      const syncedSession = await ISPRadiusSession.query().findOne({
        session_id: 'runtime-sess-001',
      });
      expect(syncedSession).toMatchObject({
        company_id: 1,
        subscriber_id: subscriber!.id,
        username: subscriber!.username,
        nas_ip: '127.0.0.1',
        nas_port: '6',
        framed_ip_address: '100.64.0.10',
        calling_station_id: 'AA:BB:CC:DD:EE:FF',
        acct_input_octets: 2_147_483_648,
        acct_output_octets: 1_073_741_824,
        acct_session_time: 5400,
        stop_time: '2026-11-22T02:30:00',
        session_end_reason: 'User-Request',
      });
      expect(
        await db(ISPRadiusSession.tableName)
          .where({ session_id: 'unknown-sess-002' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 0 });

      const line = await db(SubscriptionInvoiceLine.tableName)
        .where({ name: 'ISP Usage · runtime-sess-001' })
        .first();
      expect(line).toMatchObject({
        quantity: 3,
        unit_price_minor: 100,
        subtotal_minor: 300,
      });

      const reSyncRes = await app.inject({ method: 'POST', url: '/api/isp/sessions/sync' });
      expect(reSyncRes.statusCode).toBe(200);
      expect(reSyncRes.json()).toMatchObject({
        success: true,
        data: {
          fetchedSessions: 2,
          upsertedSessions: 1,
          createdInvoiceLines: 0,
          totalAmountMinor: 0,
        },
      });
      expect(
        await db(SubscriptionInvoiceLine.tableName)
          .where({ name: 'ISP Usage · runtime-sess-001' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 1 });

      const liveRes = await app.inject({ method: 'GET', url: '/api/isp/sessions/live' });
      expect(liveRes.statusCode).toBe(200);
      expect(liveRes.json().data.dbSessions).toHaveLength(1);
    });

    it('processes pending and failed outbox rows only after a verified ACK', async () => {
      const subscriber = await ISPSubscriber.query().first();
      expect(subscriber).toBeDefined();

      await ISPRadiusOutbox.query().insert({
        company_id: 1,
        username: subscriber!.username,
        type: 'disconnect',
        status: 'pending',
        nas_ip: '127.0.0.1',
        acct_session_id: 'sess-abc',
        framed_ip_address: '100.64.0.10',
      });
      await ISPRadiusOutbox.query().insert({
        company_id: 1,
        username: subscriber!.username,
        type: 'disconnect',
        status: 'retryable_failure',
        error_message: 'previous runtime outage',
      });

      const res = await app.inject({ method: 'POST', url: '/api/isp/outbox/process' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        success: true,
        data: { processed: 2, sent: 0, acknowledged: 2, failed: 0 },
      });

      const rows = await ISPRadiusOutbox.query().orderBy('id', 'asc');
      for (const row of rows) {
        expect(row.status).toBe('acknowledged');
        expect(row.sent_at).toBeTruthy();
        expect(row.acknowledged_at).toBeTruthy();
        expect(row.claim_token).toBeNull();
        expect(row.error_message).toBeNull();
      }
      const disconnectCalls = requests.filter((r) => r.url.endsWith('/api/sessions/disconnect'));
      expect(disconnectCalls).toHaveLength(2);
      expect(JSON.parse(disconnectCalls[0]!.body!)).toMatchObject({
        username: subscriber!.username,
        nas_ip: '127.0.0.1',
        acct_session_id: 'sess-abc',
        framed_ip: '100.64.0.10',
      });
    });

    it('probes NAS health and fails selectHealthyNas over to the backup NAS', async () => {
      const primary = await ISPNAS.query().first();
      expect(primary).toBeDefined();
      const backup = await ISPNAS.query()
        .insert({
          company_id: primary!.company_id,
          name: 'Backup MikroTik Gateway',
          ip_address: '127.0.0.2',
          secret: 'backup-secret',
          vendor: 'MikroTik',
          ha_group: primary!.ha_group,
          ha_priority: 200,
          health_status: 'healthy',
          is_active: true,
        })
        .catch(async () =>
          ISPNAS.query().insertAndFetch({
            company_id: 1,
            name: 'Backup MikroTik Gateway',
            ip_address: '10.10.0.2',
            secret: 'backup-secret',
            vendor: 'MikroTik',
            ha_group: primary!.ha_group,
            ha_priority: 200,
            health_status: 'healthy',
            is_active: true,
          })
        );

      const probeRes = await app.inject({
        method: 'POST',
        url: '/api/isp/nas/probe',
        payload: {},
      });
      expect(probeRes.statusCode).toBe(200);
      expect(probeRes.json()).toMatchObject({
        success: true,
        data: { probed: 2, healthy: 0, degraded: 0, offline: 2 },
      });

      const probedPrimary = await ISPNAS.query().findById(primary!.id);
      const probedBackup = await ISPNAS.query().findById(backup.id);
      expect(probedPrimary?.health_status).toBe('offline');
      expect(probedBackup?.health_status).toBe('offline');

      expect(selectHealthyNas([probedPrimary!, probedBackup!])).toBeUndefined();

      // Restore primary health through the runtime-driven probe path.
      requests.length = 0;
      await app.close();
      const recoveryApp = Fastify({ logger: false });
      recoveryApp.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await recoveryApp.register(
        createIspHttpPlugin({
          ispServiceUrl: 'http://isp.local:3002',
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes(encodeURIComponent(primary!.ip_address))) {
              return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
          },
        })
      );
      await recoveryApp.ready();
      try {
        const recoverRes = await recoveryApp.inject({ method: 'POST', url: '/api/isp/nas/probe' });
        expect(recoverRes.statusCode).toBe(200);
        expect(recoverRes.json()).toMatchObject({
          success: true,
          data: { probed: 2, healthy: 1, degraded: 0, offline: 1 },
        });
        const recoveredPrimary = await ISPNAS.query().findById(primary!.id);
        const stillOfflineBackup = await ISPNAS.query().findById(backup.id);
        expect(recoveredPrimary?.health_status).toBe('healthy');
        expect(stillOfflineBackup?.health_status).toBe('offline');

        const failoverTarget = selectHealthyNas([recoveredPrimary!, stillOfflineBackup!]);
        expect(failoverTarget?.id).toBe(primary!.id);
      } finally {
        await recoveryApp.close();
      }
    });

    it('enforces model-level access on the new operational endpoints', async () => {
      currentAuth = { userId: 98, role: 'user', companyId: 1 };
      const deniedSessions = await app.inject({
        method: 'POST',
        url: '/api/isp/sessions/sync',
      });
      expect(deniedSessions.statusCode).toBe(403);

      const deniedOutbox = await app.inject({ method: 'POST', url: '/api/isp/outbox/process' });
      expect(deniedOutbox.statusCode).toBe(403);

      const deniedProbe = await app.inject({ method: 'POST', url: '/api/isp/nas/probe' });
      expect(deniedProbe.statusCode).toBe(403);

      currentAuth = {
        userId: 98,
        role: 'user',
        companyId: 1,
        groupPermissions: [
          { model_name: 'isp.nas', read: true, create: false, write: true, unlink: false },
          {
            model_name: 'isp.radius_session',
            read: true,
            create: false,
            write: true,
            unlink: false,
          },
        ],
      };
      const grantedSessions = await app.inject({
        method: 'POST',
        url: '/api/isp/sessions/sync',
      });
      expect(grantedSessions.statusCode).toBe(200);
      const grantedProbe = await app.inject({ method: 'POST', url: '/api/isp/nas/probe' });
      expect(grantedProbe.statusCode).toBe(200);

      currentAuth = null;
      const unauthRes = await app.inject({ method: 'POST', url: '/api/isp/outbox/process' });
      expect(unauthRes.statusCode).toBe(401);
    });

    it('preserves NAS secret rotation audit, metering idempotency, subscription enforcement, and tenant isolation', async () => {
      const nas = await ISPNAS.query().first();
      const subscriber = await ISPSubscriber.query().first();
      expect(nas).toBeDefined();
      expect(subscriber).toBeDefined();

      const healthRes = await app.inject({ method: 'GET', url: '/api/isp/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toMatchObject({ success: true, data: { runtime: 'connected' } });

      const rotateRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
      });
      expect(rotateRes.statusCode).toBe(200);
      expect(JSON.stringify(rotateRes.json())).not.toContain('secret');
      const updatedNas = await ISPNAS.query().findById(nas!.id);
      expect(updatedNas?.secret).not.toBe('testing123');
      expect(
        await db(AuditLog.tableName)
          .where({ model: ISPNAS.modelName, operation: 'rotate_secret' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 1 });

      await ISPRadiusSession.query().insert({
        company_id: 1,
        subscriber_id: subscriber!.id,
        session_id: 'closed-meter-001',
        username: subscriber!.username,
        acct_input_octets: 1_500_000_000,
        acct_output_octets: 500_000_000,
        acct_session_time: 7200,
        start_time: '2026-11-22T01:00:00',
        stop_time: '2026-11-22T03:00:00',
      });
      const meterRes = await app.inject({ method: 'POST', url: '/api/isp/metering/run' });
      expect(meterRes.statusCode).toBe(200);
      expect(meterRes.json()).toMatchObject({
        success: true,
        data: { createdInvoiceLines: 1, totalAmountMinor: 200 },
      });
      const meterSecond = await app.inject({ method: 'POST', url: '/api/isp/metering/run' });
      expect(meterSecond.json()).toMatchObject({
        success: true,
        data: { createdInvoiceLines: 0 },
      });

      await Subscription.query().findById(subscriber!.subscription_id!).patch({ state: 'expired' });
      const enforceRes = await app.inject({
        method: 'POST',
        url: `/api/isp/subscriptions/${subscriber!.subscription_id}/enforce`,
      });
      expect(enforceRes.statusCode).toBe(200);
      expect(enforceRes.json()).toMatchObject({ success: true, data: { suspendedCount: 1 } });
      const blockedSubSync = await app.inject({
        method: 'POST',
        url: `/api/isp/subscribers/${subscriber!.id}/sync`,
      });
      expect(blockedSubSync.statusCode).toBe(402);

      currentAuth = { userId: 99, role: 'superadmin', companyId: 999 };
      const foreignRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/sync`,
      });
      expect(foreignRes.statusCode).toBe(404);

      currentAuth = null;
      const unauthHealth = await app.inject({ method: 'GET', url: '/api/isp/health' });
      expect(unauthHealth.statusCode).toBe(401);
    });

    it('keeps the database unchanged when the ISP runtime rejects or times out during secret rotation', async () => {
      const nas = await ISPNAS.query().first();
      expect(nas).toBeDefined();
      const secretBefore = nas!.secret;
      let rotationAttempts = 0;

      const failingApp = Fastify({ logger: false });
      currentAuth = { userId: 2, role: 'superadmin', companyId: 1 };
      failingApp.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await failingApp.register(
        createIspHttpPlugin({
          ispServiceUrl: 'http://isp.local:3002',
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async (input, init) => {
            const url = String(input);
            if (url.includes('/rotate-secret')) {
              rotationAttempts += 1;
              void init;
              if (rotationAttempts === 1) {
                throw new Error('simulated runtime timeout');
              }
              return new Response(JSON.stringify({ error: 'nas busy' }), { status: 500 });
            }
            if (url.endsWith('/health')) {
              return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
          },
        })
      );
      await failingApp.ready();

      // Runtime unreachable: DB must stay untouched.
      const timeoutRes = await failingApp.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
        payload: { reason: 'runtime_down' },
      });
      expect(timeoutRes.statusCode).toBe(502);
      expect(timeoutRes.json()).toMatchObject({ success: false });
      const afterTimeout = await ISPNAS.query().findById(nas!.id);
      expect(afterTimeout?.secret).toBe(secretBefore);
      expect(
        await db(AuditLog.tableName)
          .where({ model: ISPNAS.modelName, operation: 'rotate_secret' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 0 });

      // Runtime rejects: DB must also stay untouched.
      const rejectRes = await failingApp.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
        payload: { reason: 'runtime_rejects' },
      });
      expect(rejectRes.statusCode).toBe(502);
      const afterReject = await ISPNAS.query().findById(nas!.id);
      expect(afterReject?.secret).toBe(secretBefore);
      expect(
        await db(AuditLog.tableName)
          .where({ model: ISPNAS.modelName, operation: 'rotate_secret' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 0 });

      await failingApp.close();
    });

    it('persists the new secret only after the runtime accepted it', async () => {
      const nas = await ISPNAS.query().first();
      expect(nas).toBeDefined();
      const secretBefore = nas!.secret;
      const callOrder: string[] = [];

      const orderedApp = Fastify({ logger: false });
      currentAuth = { userId: 2, role: 'superadmin', companyId: 1 };
      orderedApp.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await orderedApp.register(
        createIspHttpPlugin({
          ispServiceUrl: 'http://isp.local:3002',
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes('/rotate-secret')) {
              callOrder.push('runtime');
              return new Response(JSON.stringify({ id: 9 }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
          },
        })
      );
      await orderedApp.ready();

      const res = await orderedApp.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
        payload: { reason: 'ordered_rotation' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        success: true,
        data: { rotated: true, runtimeSynced: true },
      });
      expect(callOrder).toEqual(['runtime']);
      const after = await ISPNAS.query().findById(nas!.id);
      expect(after?.secret).not.toBe(secretBefore);
      expect(
        await db(AuditLog.tableName)
          .where({ model: ISPNAS.modelName, operation: 'rotate_secret' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 1 });

      await orderedApp.close();
    });

    it('trims repeated trailing slashes from ispServiceUrl in HTTP plugin and reconcile sync', async () => {
      const seenUrls: string[] = [];
      const slashedUrl = `http://isp.local:3002${'/'.repeat(20_000)}`;
      const slashApp = Fastify({ logger: false });
      currentAuth = { userId: 2, role: 'superadmin', companyId: 1 };
      slashApp.addHook('onRequest', async (req) => {
        (req as { auth?: typeof currentAuth }).auth = currentAuth;
      });
      await slashApp.register(
        createIspHttpPlugin({
          ispServiceUrl: slashedUrl,
          jwtSecret: 'unit-test-jwt-secret',
          fetchImpl: async (input) => {
            seenUrls.push(String(input));
            return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
          },
        })
      );
      await slashApp.ready();

      try {
        const res = await slashApp.inject({ method: 'GET', url: '/api/isp/health' });
        expect(res.statusCode).toBe(200);
        expect(seenUrls).toEqual(['http://isp.local:3002/health']);
      } finally {
        await slashApp.close();
      }

      const syncUrls: string[] = [];
      await syncIspRuntimeSessions({
        ispServiceUrl: slashedUrl,
        jwtSecret: 'unit-test-jwt-secret',
        fetchImpl: async (input) => {
          syncUrls.push(String(input));
          return new Response(JSON.stringify([]), { status: 200 });
        },
      });
      expect(syncUrls).toEqual(['http://isp.local:3002/api/sessions']);
    });
  });

  describe('M19.08 verified NAS ACK outbox', () => {
    const allDeps = [
      baseManifest,
      jobsManifest,
      notificationManifest,
      organizationManifest,
      workflowManifest,
      projectManifest,
      crmManifest,
      salesManifest,
      subscriptionManifest,
      manifest,
    ];

    beforeEach(async () => {
      await installAddons(db, allDeps);
    });

    function response(status: number, body: unknown): Response {
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }

    async function createOutbox(status: string, attemptCount = 0) {
      return ISPRadiusOutbox.query().insertAndFetch({
        company_id: 1,
        username: 'ack-subscriber',
        type: 'disconnect',
        status,
        nas_ip: '127.0.0.1',
        acct_session_id: `sess-${status}-${attemptCount}`,
        attempt_count: attemptCount,
      });
    }

    it('parses verified ACK, NAK, timeout, no-session, and malformed responses', () => {
      expect(parseDisconnectOutcome(200, JSON.stringify({ sent: true, ack: true }))).toBe(
        'acknowledged'
      );
      expect(parseDisconnectOutcome(200, JSON.stringify({ sent: true, ack: false }))).toBe(
        'rejected'
      );
      expect(parseDisconnectOutcome(200, JSON.stringify({ disconnected: true }))).toBe(
        'retryable_failure'
      );
      expect(parseDisconnectOutcome(504, JSON.stringify({ sent: false, ack: false }))).toBe(
        'timed_out'
      );
      expect(
        parseDisconnectOutcome(
          200,
          JSON.stringify({ sent: false, ack: false, error: 'no active session or nas_ip provided' })
        )
      ).toBe('no_session');
      expect(parseDisconnectOutcome(200, 'not-json')).toBe('retryable_failure');
      expect(parseDisconnectOutcome(500, '{}')).toBe('retryable_failure');
    });

    it('never reports success for HTTP 200 without sent=true and ack=true', async () => {
      const dispatch = await dispatchIspDisconnect({
        baseUrl: 'http://isp.local:3002',
        token: 'test-token',
        fetchImpl: (async () => response(200, { sent: false, ack: false })) as typeof fetch,
        username: 'ack-subscriber',
      });
      expect(dispatch).toMatchObject({ ok: false, outcome: 'rejected' });
    });

    it('keeps ack=false rows retryable and does not mark them sent or acknowledged', async () => {
      const row = await createOutbox('pending');
      const result = await processIspRadiusOutbox({
        companyId: 1,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith('/suspend')) return response(200, {});
          return response(200, { sent: true, ack: false, error: 'Disconnect-NAK' });
        }) as typeof fetch,
        maxAttempts: 3,
        retryDelayMs: 60_000,
      });

      expect(result).toMatchObject({ processed: 1, sent: 1, acknowledged: 0, failed: 0 });
      const updated = await ISPRadiusOutbox.query().findById(row.id);
      expect(updated).toMatchObject({
        status: 'rejected',
        attempt_count: 1,
        sent_at: null,
        acknowledged_at: null,
        claim_token: null,
      });
      expect(updated?.next_attempt_at).toBeTruthy();
    });

    it('classifies timeout and no-session responses without completing the row', async () => {
      const timedOut = await createOutbox('pending');
      const noSession = await createOutbox('pending');
      const outcomes = [
        response(504, { sent: false, ack: false }),
        response(200, { sent: false, ack: false, error: 'no active session or nas_ip provided' }),
      ];
      let call = 0;
      const result = await processIspRadiusOutbox({
        companyId: 1,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith('/suspend')) return response(200, {});
          return outcomes[call++]!;
        }) as typeof fetch,
        retryDelayMs: 60_000,
      });

      expect(result).toMatchObject({ processed: 2, acknowledged: 0 });
      await expect(ISPRadiusOutbox.query().findById(timedOut.id)).resolves.toMatchObject({
        status: 'timed_out',
        acknowledged_at: null,
      });
      await expect(ISPRadiusOutbox.query().findById(noSession.id)).resolves.toMatchObject({
        status: 'no_session',
        acknowledged_at: null,
      });
    });

    it('bounds retry attempts and only acknowledges after a later verified ACK', async () => {
      const exhausted = await createOutbox('pending', 2);
      await ISPRadiusOutbox.query().findById(exhausted.id).patch({ next_attempt_at: '2020-01-01 00:00:00' });
      const laterAck = await createOutbox('pending', 1);

      const exhaustedResult = await processIspRadiusOutbox({
        companyId: 1,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith('/suspend')) return response(200, {});
          return response(200, 'not-json');
        }) as typeof fetch,
        maxAttempts: 2,
        retryDelayMs: -1,
        limit: 1,
      });
      expect(exhaustedResult).toMatchObject({ processed: 1, acknowledged: 0, failed: 1, sent: 0 });
      const failedRow = await ISPRadiusOutbox.query().findById(exhausted.id);
      expect(failedRow).toMatchObject({ status: 'failed', attempt_count: 3 });

      await ISPRadiusOutbox.query().findById(exhausted.id).patch({
        status: 'pending',
        attempt_count: 1,
        next_attempt_at: '2020-01-01 00:00:00',
      });

      const ackResult = await processIspRadiusOutbox({
        companyId: 1,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith('/suspend')) return response(200, {});
          return response(200, { sent: true, ack: true });
        }) as typeof fetch,
        maxAttempts: 2,
        retryDelayMs: -1,
        limit: 2,
      });
      expect(ackResult).toMatchObject({ processed: 2, acknowledged: 2, failed: 0 });
      const recovered = await ISPRadiusOutbox.query().findById(laterAck.id);
      expect(recovered).toMatchObject({ status: 'acknowledged', attempt_count: 2 });
    });

    it('atomically claims one outbox row for concurrent workers', async () => {
      const row = await createOutbox('pending');
      let claims = 0;
      const blockingFetch = (async () => {
        claims += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return response(200, { sent: true, ack: true });
      }) as typeof fetch;

      const [first, second] = await Promise.all([
        processIspRadiusOutbox({ companyId: 1, fetchImpl: blockingFetch }),
        processIspRadiusOutbox({ companyId: 1, fetchImpl: blockingFetch }),
      ]);
      expect(claims).toBe(2);
      expect(first.processed + second.processed).toBe(1);
      expect(first.acknowledged + second.acknowledged).toBe(1);
      const updated = await ISPRadiusOutbox.query().findById(row.id);
      expect(updated).toMatchObject({ status: 'acknowledged', claim_token: null });
    });
  });

  describe('ISP job handlers & crons', () => {
    interface JobRequest {
      url: string;
      authorization?: string;
      body?: string;
    }

    it('registers and runs the three ISP job handlers cleanly against the jobs runtime', async () => {
      await installAddons(db, [
        baseManifest,
        jobsManifest,
        notificationManifest,
        organizationManifest,
        workflowManifest,
        projectManifest,
        crmManifest,
        salesManifest,
        subscriptionManifest,
        manifest,
      ]);

      const jobRequests: JobRequest[] = [];
      const runtimeSessions = [
        {
          session_id: 'job-sess-001',
          username: 'acme-fiber-01',
          acct_input_octets: 1_073_741_824,
          acct_output_octets: 0,
          acct_session_time: 600,
          started_at: '2026-11-22T01:00:00',
          stopped_at: '2026-11-22T01:10:00',
          status: 'stopped',
        },
      ];
      const dispose = registerIspJobHandlers({
        ispServiceUrl: 'http://isp.local:3002',
        jwtSecret: 'jobs-test-secret',
        fetchImpl: (async (input, init) => {
          const url = String(input);
          const headers = (init?.headers ?? {}) as Record<string, string>;
          jobRequests.push({
            url,
            authorization: headers.authorization,
            body: init?.body ? String(init.body) : undefined,
          });
          if (url.endsWith('/api/sessions')) {
            return new Response(JSON.stringify(runtimeSessions), { status: 200 });
          }
          if (url.endsWith('/suspend')) {
            return new Response(JSON.stringify({}), { status: 200 });
          }
          if (url.endsWith('/api/sessions/disconnect')) {
            return new Response(JSON.stringify({ sent: true, ack: true }), { status: 200 });
          }
          return new Response('{}', { status: 404 });
        }) as typeof fetch,
        probeFn: async () => 'healthy',
      });

      try {
        const reconcileJobId = await enqueueJob('isp.sessions.reconcile', {}, { companyId: 1 });
        expect(await runOneJob({ workerId: 'isp-test-worker' })).toBe(true);
        const reconcileJob = await db('jobs').where({ id: reconcileJobId }).first();
        expect(reconcileJob).toMatchObject({ status: 'succeeded' });
        const synced = await ISPRadiusSession.query().findOne({ session_id: 'job-sess-001' });
        expect(synced).toBeDefined();
        expect(jobRequests[0]?.authorization).toBe(
          `Bearer ${expectedAdminToken('jobs-test-secret')}`
        );

        const outboxJobId = await enqueueJob('isp.outbox.process', { companyId: 1 });
        expect(await runOneJob({ workerId: 'isp-test-worker' })).toBe(true);
        const outboxJob = await db('jobs').where({ id: outboxJobId }).first();
        expect(outboxJob).toMatchObject({ status: 'succeeded' });

        const probeJobId = await enqueueJob('isp.nas.probe', {});
        expect(await runOneJob({ workerId: 'isp-test-worker' })).toBe(true);
        const probeJob = await db('jobs').where({ id: probeJobId }).first();
        expect(probeJob).toMatchObject({ status: 'succeeded' });
        const nas = await ISPNAS.query().first();
        expect(nas?.health_status).toBe('healthy');

        await expect(enqueueJob('isp.sessions.reconcile', { companyId: 'oops' })).rejects.toThrow(
          'ISP job payload companyId must be a positive integer'
        );
      } finally {
        dispose();
      }
    });

    it('upserts disabled-or-enabled ISP cron rows idempotently via ensureIspCrons', async () => {
      await installAddons(db, [
        baseManifest,
        jobsManifest,
        notificationManifest,
        organizationManifest,
        workflowManifest,
        projectManifest,
        crmManifest,
        salesManifest,
        subscriptionManifest,
        manifest,
      ]);

      await ensureIspCrons(db, { enabled: false });
      const firstPass = await Cron.query().whereIn('code', [
        'isp.sessions.reconcile',
        'isp.outbox.process',
        'isp.nas.probe',
      ]);
      expect(firstPass).toHaveLength(3);
      expect(firstPass.map((row) => row.cron_expression).sort()).toEqual(
        ['* * * * *', '*/2 * * * *', '*/2 * * * *'].sort()
      );
      expect(firstPass.every((row) => row.enabled === false)).toBe(true);
      expect(firstPass.every((row) => row.handler_version === 1)).toBe(true);
      expect(firstPass.every((row) => row.active === true)).toBe(true);

      const originalNextRun = firstPass.find(
        (row) => row.code === 'isp.outbox.process'
      )?.next_run_at;
      await ensureIspCrons(db);
      const secondPass = await Cron.query().whereIn('code', [
        'isp.sessions.reconcile',
        'isp.outbox.process',
        'isp.nas.probe',
      ]);
      expect(secondPass).toHaveLength(3);
      expect(secondPass.find((row) => row.code === 'isp.outbox.process')?.next_run_at).toBe(
        originalNextRun
      );
    });
  });
});
