import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import type { FastifyInstance } from 'fastify';
import { MemoryStorage, MoonWitnessClient } from '@moonwitness/client';
import { buildApp } from '../src/app.js';

const ADMIN_PASSWORD = 'commercial-addons-test-password';

function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(res.statusCode === 204 ? null : res.body, {
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  }) as typeof fetch;
}

describe('CRM, Sales, and Subscription live API addons', () => {
  let db: Knex;
  let app: FastifyInstance;
  let client: MoonWitnessClient;

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    Model.knex(db);
    process.env.NODE_ENV = 'test';
    app = await buildApp({
      db,
      superadminPassword: ADMIN_PASSWORD,
      jwtSecret: 'commercial-addons-secret-commercial-addons-123',
      loginRateMax: 1000,
    });
    await app.ready();
    client = new MoonWitnessClient({
      baseUrl: 'http://api.test',
      fetch: injectFetch(app),
      storage: new MemoryStorage(),
    });
    await client.login({ login: 'superadmin', password: ADMIN_PASSWORD });
  }, 30000);

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('serves seeded CRM, Sales, and Subscription demo pipelines and views via REST & SDK', async () => {
    const models = await client.getModels();
    const names = models.map((m) => m.model);
    expect(names).toEqual(
      expect.arrayContaining([
        'crm.lead_stage',
        'crm.lead',
        'crm.opportunity',
        'sale.order_state',
        'sale.order',
        'sale.order_line',
        'subscription.plan',
        'subscription.subscription',
        'subscription.invoice_line',
      ])
    );

    const leads = await client.model('crm.lead').searchRead({ limit: 20 });
    expect(leads.records.length).toBeGreaterThanOrEqual(6);
    const opportunities = await client.model('crm.opportunity').searchRead({ limit: 20 });
    expect(opportunities.records.length).toBeGreaterThanOrEqual(4);
    const orders = await client.model('sale.order').searchRead({ limit: 20 });
    expect(orders.records.length).toBeGreaterThanOrEqual(4);
    const plans = await client.model('subscription.plan').searchRead({ limit: 20 });
    expect(plans.records.length).toBeGreaterThanOrEqual(4);
    const subscriptions = await client.model('subscription.subscription').searchRead({ limit: 20 });
    expect(subscriptions.records.length).toBeGreaterThanOrEqual(4);

    const leadViews = await client.model('crm.lead').getViews();
    expect(leadViews.kanban?.groupBy).toBe('stage_id');
  });
});
