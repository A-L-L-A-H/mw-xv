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
import { manifest as subscriptionManifest, Subscription, SubscriptionInvoiceLine } from '@moonwitness/orm-subscription';
import { AuditLog } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import {
  ISPBandwidthProfile,
  ISPNAS,
  ISPPool,
  ISPRadiusOutbox,
  ISPRadiusSession,
  ISPSubscriber,
  ISPType,
  createIspHttpPlugin,
  manifest,
  selectHealthyNas,
} from '../src/index.js';

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

  it('mounts ispHttpPlugin routes for NAS sync and subscriber suspension with company isolation', async () => {
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

    const syncedRequests: Array<{ url: string; body?: string }> = [];
    const app = Fastify({ logger: false });
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
    } | null = {
      userId: 2,
      role: 'superadmin',
      companyId: 1,
    };
    app.addHook('onRequest', async (req) => {
      (req as { auth?: typeof currentAuth }).auth = currentAuth;
    });
    await app.register(
      createIspHttpPlugin({
        ispServiceUrl: 'http://isp.local:3002',
        fetchImpl: async (input, init) => {
          const url = String(input);
          syncedRequests.push({ url, body: init?.body ? String(init.body) : undefined });
          if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
          if (url.endsWith('/api/clients')) {
            return new Response(JSON.stringify({ id: 9, name: 'MikroTik Core' }), { status: 200 });
          }
          if (url.includes('/rotate-secret')) {
            return new Response(JSON.stringify({ id: 9, name: 'MikroTik Core' }), { status: 200 });
          }
          if (url.endsWith('/api/subscribers')) {
            return new Response(JSON.stringify({ id: 1, username: 'acme-fiber-01' }), { status: 200 });
          }
          if (url.endsWith('/api/sessions')) {
            return new Response(
              JSON.stringify([{ session_id: 'live-sess-1', username: 'acme-fiber-01', status: 'active' }]),
              { status: 200 }
            );
          }
          return new Response('{}', { status: 404 });
        },
      })
    );
    await app.ready();

    try {
      const nas = await ISPNAS.query().first();
      const subscriber = await ISPSubscriber.query().first();
      expect(nas).toBeDefined();
      expect(subscriber).toBeDefined();

      const healthRes = await app.inject({ method: 'GET', url: '/api/isp/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toMatchObject({ success: true, data: { runtime: 'connected' } });

      const syncRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/sync`,
      });
      expect(syncRes.statusCode).toBe(200);
      expect(syncedRequests.some((r) => r.url === 'http://isp.local:3002/api/clients')).toBe(true);
      expect(JSON.stringify(syncRes.json())).not.toContain(nas!.secret);

      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/isp/subscribers/${subscriber!.id}/suspend`,
      });
      expect(suspendRes.statusCode).toBe(200);
      expect(suspendRes.json()).toMatchObject({ success: true, data: { status: 'suspended' } });
      expect(await db(ISPRadiusOutbox.tableName).count({ count: '*' }).first()).toMatchObject({
        count: 1,
      });

      currentAuth = { userId: 98, role: 'user', companyId: 1 };
      const userRes = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/sync`,
      });
      expect(userRes.statusCode).toBe(403);

      currentAuth = {
        userId: 98,
        role: 'user',
        companyId: 1,
        groupPermissions: [
          { model_name: 'isp.nas', read: true, create: false, write: true, unlink: false },
          { model_name: 'isp.subscriber', read: true, create: false, write: true, unlink: false },
          { model_name: 'isp.radius_session', read: true, create: false, write: true, unlink: false },
        ],
      };
      const grantedUserRotate = await app.inject({
        method: 'POST',
        url: `/api/isp/nas/${nas!.id}/rotate-secret`,
      });
      expect(grantedUserRotate.statusCode).toBe(200);
      expect(grantedUserRotate.json()).toMatchObject({ success: true, data: { rotated: true } });
      expect(JSON.stringify(grantedUserRotate.json())).not.toContain('secret');
      const updatedNas = await ISPNAS.query().findById(nas!.id);
      expect(updatedNas?.secret).not.toBe('testing123');
      expect(await db(AuditLog.tableName).where({ model: ISPNAS.modelName, operation: 'rotate_secret' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });

      const subSyncOk = await app.inject({
        method: 'POST',
        url: `/api/isp/subscribers/${subscriber!.id}/sync`,
      });
      expect(subSyncOk.statusCode).toBe(200);

      const liveSessions = await app.inject({
        method: 'GET',
        url: '/api/isp/sessions/live',
      });
      expect(liveSessions.statusCode).toBe(200);
      expect(liveSessions.json().data.runtimeSessions).toHaveLength(1);

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
      const meterRes = await app.inject({
        method: 'POST',
        url: '/api/isp/metering/run',
      });
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
      expect(
        await db(SubscriptionInvoiceLine.tableName)
          .where({ name: 'ISP Usage · closed-meter-001' })
          .count({ count: '*' })
          .first()
      ).toMatchObject({ count: 1 });

      await ISPSubscriber.query().findById(subscriber!.id).patch({ status: 'active' });
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
      const unauthRes = await app.inject({ method: 'GET', url: '/api/isp/health' });
      expect(unauthRes.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
