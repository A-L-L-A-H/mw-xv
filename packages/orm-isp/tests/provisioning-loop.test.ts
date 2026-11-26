import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { assertAddonDefaultDataPolicy, installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as projectManifest } from '@moonwitness/orm-project';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import {
  Subscription,
  SubscriptionInvoiceLine,
  manifest as subscriptionManifest,
} from '@moonwitness/orm-subscription';
import { ISPRadiusOutbox, ISPRadiusSession, ISPSubscriber, manifest } from '../src/index.js';
import {
  buildInitialIspSeedBundle,
  enforceOverdueSubscriberSuspensions,
} from '../src/provisioning-loop.js';

const TEST_JWT_SECRET = 'provisioning-loop-jwt-secret';
const TEST_ADMIN_TOKEN = createHmac('sha256', TEST_JWT_SECRET)
  .update('moonwitness-isp-admin-v1')
  .digest('hex');

function createTestDb(): Knex {
  return knex({
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
}

async function installTestAddons(db: Knex): Promise<void> {
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
}

describe('orm-isp provisioning loop', () => {
  it('builds a deterministic production-grade initial ISP seed bundle', () => {
    const bundle = buildInitialIspSeedBundle();
    expect(bundle).toEqual(buildInitialIspSeedBundle());
    expect(bundle.types.map((entry) => entry.code)).toEqual(['pppoe', 'hotspot', 'static']);
    expect(bundle.bandwidthProfiles.map((entry) => entry.name)).toEqual([
      'Nusantara FTTx 30M',
      'Nusantara FTTx 100M',
      'Nusantara Dedicated 500M',
      'Nusantara Dedicated 1G',
    ]);
    expect(bundle.pools.map((entry) => entry.network)).toEqual([
      '100.64.0.0/22',
      '103.21.118.0/24',
    ]);
    expect(bundle.nasDevices.map((entry) => entry.vendor)).toEqual([
      'MikroTik',
      'MikroTik',
      'MikroTik',
    ]);
    expect(bundle.subscribers.map((entry) => entry.username)).toEqual([
      'nusantara-fttx-001',
      'nusantara-dedicated-001',
    ]);
    expect(bundle.accessRules.length).toBe(5);
    expect(() => assertAddonDefaultDataPolicy([manifest])).not.toThrow();
  });

  it('applies tenant overrides and redacts secrets in the generated bundle options', () => {
    const bundle = buildInitialIspSeedBundle({
      companyKey: 'base.company_nusantara',
      userGroupKey: 'base.group_isp_operator',
      projectKey: 'project.nusantara_access_network',
      partnerKey: 'base.partner_nusantara_fttx',
      subscriptionKey: 'subscription.nusantara_fttx_001',
    });
    expect(bundle.subscribers).toHaveLength(2);
    for (const subscriber of bundle.subscribers) {
      expect(subscriber.projectKey).toBe('project.nusantara_access_network');
      expect(subscriber.partnerKey).toBe('base.partner_nusantara_fttx');
      expect(subscriber.subscriptionKey).toBe('subscription.nusantara_fttx_001');
    }
    for (const rule of bundle.accessRules) {
      expect(rule.companyKey).toBe('base.company_nusantara');
      expect(rule.userGroupKey).toBe('base.group_isp_operator');
    }
  });

  it('suspends overdue subscribers, dispatches disconnect, and stays idempotent', async () => {
    const db = createTestDb();
    try {
      await installTestAddons(db);
      await Subscription.query().insert({
        name: 'Nusantara FTTx 30M Monthly',
        partner_id: 1,
        company_id: 1,
        plan_id: 1,
        state: 'active',
        currency: 'IDR',
        amount_minor: 329_000,
        start_date: '2026-06-15',
        next_invoice_date: '2026-10-15',
      });
      await SubscriptionInvoiceLine.query().insert({
        name: 'FTTx 30M October 2026',
        subscription_id: 1,
        product: 'Nusantara FTTx 30M',
        quantity: 1,
        unit_price_minor: 329_000,
        subtotal_minor: 329_000,
        sequence: 10,
        invoice_date: '2026-10-15',
      });
      await ISPSubscriber.query().patch({ is_active: false });
      const subscriber = await ISPSubscriber.query().insert({
        company_id: 1,
        partner_id: 1,
        subscription_id: 1,
        project_id: 1,
        username: 'nusantara-fttx-001',
        password: 'radius-secret',
        type: 'pppoe',
        start_date: '2026-06-15',
        expiry_date: '2027-06-15',
        monthly_price_minor: 329_000,
        currency: 'IDR',
        status: 'active',
      });
      await ISPRadiusSession.query().insert({
        company_id: 1,
        subscriber_id: subscriber.id,
        session_id: 'sess-provisioning-001',
        nas_ip: '10.10.0.1',
        username: 'nusantara-fttx-001',
        framed_ip_address: '100.64.0.10',
        start_time: '2026-11-01T00:00:00',
      });

      const requestedUrls: string[] = [];
      const disconnectBodies: unknown[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requestedUrls.push(String(url));
        if (String(url).includes('/api/subscribers/nusantara-fttx-001/suspend')) {
          return new Response('{}', { status: 200 });
        }
        if (String(url).includes('/api/sessions/disconnect')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
          disconnectBodies.push(body);
          return new Response(JSON.stringify({ sent: true, ack: true }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      };

      const first = await enforceOverdueSubscriberSuspensions({
        asOfDate: '2026-11-23',
        jwtSecret: TEST_JWT_SECRET,
        ispServiceUrl: `http://127.0.0.1:3102/base${'/'.repeat(50_000)}`,
        fetchImpl,
      });
      expect(first).toMatchObject({
        evaluated: 1,
        suspended: 1,
        dispatched: 1,
        dispatchFailures: 0,
      });
      expect(first.suspensions[0]).toMatchObject({
        username: 'nusantara-fttx-001',
        subscriberId: expect.any(Number),
        companyId: 1,
        subscriptionId: 1,
        disconnectDispatched: true,
      });
      expect(requestedUrls).toEqual([
        'http://127.0.0.1:3102/base/api/subscribers/nusantara-fttx-001/suspend',
        'http://127.0.0.1:3102/base/api/sessions/disconnect',
      ]);
      expect(disconnectBodies).toHaveLength(1);
      expect(disconnectBodies[0]).toMatchObject({
        username: 'nusantara-fttx-001',
        nas_ip: '10.10.0.1',
        acct_session_id: 'sess-provisioning-001',
        framed_ip: '100.64.0.10',
      });
      expect(await ISPSubscriber.query().findById(subscriber.id).select('status')).toMatchObject({
        status: 'suspended',
      });
      expect(await ISPRadiusOutbox.query().where({ company_id: 1 }).orderBy('id')).toHaveLength(1);
      expect(await ISPRadiusOutbox.query().first()).toMatchObject({
        status: 'acknowledged',
        type: 'disconnect',
        username: 'nusantara-fttx-001',
        nas_ip: '10.10.0.1',
      });
      expect((await ISPRadiusOutbox.query().first())?.response).not.toContain('radius-secret');

      const second = await enforceOverdueSubscriberSuspensions({
        asOfDate: '2026-11-23',
        jwtSecret: TEST_JWT_SECRET,
        fetchImpl,
      });
      expect(second).toMatchObject({
        evaluated: 1,
        suspended: 0,
        dispatched: 0,
        dispatchFailures: 0,
      });
      expect(requestedUrls).toHaveLength(2);
      expect(await ISPRadiusOutbox.query().orderBy('id')).toHaveLength(1);
    } finally {
      await db.destroy();
    }
  });

  it('skips non-overdue invoices and records failed disconnect dispatch', async () => {
    const db = createTestDb();
    try {
      await installTestAddons(db);
      await Subscription.query().insert({
        name: 'Nusantara Dedicated 500M Monthly',
        partner_id: 1,
        company_id: 1,
        plan_id: 1,
        state: 'pending',
        currency: 'IDR',
        amount_minor: 2_450_000,
      });
      await SubscriptionInvoiceLine.query().insert({
        name: 'Dedicated 500M November 2026',
        subscription_id: 1,
        product: 'Nusantara Dedicated 500M',
        quantity: 1,
        unit_price_minor: 2_450_000,
        subtotal_minor: 2_450_000,
        sequence: 10,
        invoice_date: '2026-11-15',
      });
      await ISPSubscriber.query().patch({ is_active: false });
      await ISPSubscriber.query().insert({
        company_id: 1,
        partner_id: 1,
        subscription_id: 1,
        username: 'nusantara-dedicated-001',
        password: 'dedicated-secret',
        type: 'static',
        currency: 'IDR',
        status: 'active',
      });

      const noOverdue = await enforceOverdueSubscriberSuspensions({
        asOfDate: '2026-11-23',
      });
      expect(noOverdue).toMatchObject({
        evaluated: 0,
        suspended: 0,
        dispatched: 0,
        dispatchFailures: 0,
      });

      const failedFetch: typeof fetch = async () =>
        new Response('service unavailable', { status: 503 });
      const failed = await enforceOverdueSubscriberSuspensions({
        asOfDate: '2026-12-20',
        adminToken: TEST_ADMIN_TOKEN,
        fetchImpl: failedFetch,
      });
      expect(failed).toMatchObject({
        evaluated: 1,
        suspended: 1,
        dispatched: 0,
        dispatchFailures: 1,
      });
      expect(await ISPRadiusOutbox.query().first()).toMatchObject({
        status: 'retryable_failure',
        error_message: 'ISP subscriber suspend failed (503)',
      });
    } finally {
      await db.destroy();
    }
  });
});
