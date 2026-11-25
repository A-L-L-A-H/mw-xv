import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import type { FastifyInstance } from 'fastify';
import { MemoryStorage, MoonWitnessClient } from '@moonwitness/client';
import { buildApp } from '../src/app.js';

const ADMIN_PASSWORD = 'isp-cloud-addons-test-password';

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

describe('ISP and Cloud live API addons with httpPlugins', () => {
  let db: Knex;
  let app: FastifyInstance;
  let client: MoonWitnessClient;
  let accessToken: string;

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    Model.knex(db);
    process.env.NODE_ENV = 'test';
    process.env.MW_CONTROL_PLANE_URL = 'http://127.0.0.1:3003';
    process.env.MW_CONTROL_PLANE_TOKEN = 'isp-cloud-addons-control-plane-token-123456';
    app = await buildApp({
      db,
      superadminPassword: ADMIN_PASSWORD,
      jwtSecret: 'isp-cloud-addons-secret-isp-cloud-addons-123',
      loginRateMax: 1000,
    });
    await app.ready();
    client = new MoonWitnessClient({
      baseUrl: 'http://api.test',
      fetch: injectFetch(app),
      storage: new MemoryStorage(),
    });
    const tokens = await client.login({ login: 'superadmin', password: ADMIN_PASSWORD });
    accessToken = tokens.access_token;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('serves ISP and Cloud models, default docker_agent provider, views, and httpPlugin routes', async () => {
    const models = await client.getModels();
    const names = models.map((m) => m.model);
    expect(names).toEqual(
      expect.arrayContaining([
        'isp.nas',
        'isp.bandwidth_profile',
        'isp.ip_pool',
        'isp.subscriber',
        'isp.radius_session',
        'cloud.provider',
        'cloud.server',
        'cloud.deployment_target',
        'cloud.app',
        'cloud.deployment',
      ])
    );

    const providers = await client.model('cloud.provider').searchRead({ limit: 10 });
    expect(providers.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'docker_agent',
          type: 'docker_agent',
          endpoint: 'http://127.0.0.1:3003',
        }),
      ])
    );

    const subscribers = await client.model('isp.subscriber').searchRead({ limit: 10 });
    expect(subscribers.records.length).toBeGreaterThanOrEqual(1);
    const subscriberId = Number(subscribers.records[0]!.id);

    const cloudApps = await client.model('cloud.app').searchRead({ limit: 10 });
    expect(cloudApps.records.length).toBeGreaterThanOrEqual(1);

    const appViews = await client.model('cloud.app').getViews();
    expect(appViews.list.columns).toContain('subscription_id');
    expect(appViews.list.columns).toContain('project_id');

    const ispHealth = await app.inject({
      method: 'GET',
      url: '/api/isp/health',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ispHealth.statusCode).toBe(200);
    expect(ispHealth.json()).toMatchObject({ success: true, data: { nasCount: 1 } });

    const cloudHealth = await app.inject({
      method: 'GET',
      url: '/api/cloud/health',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(cloudHealth.statusCode).toBe(200);
    expect(cloudHealth.json()).toMatchObject({ success: true });

    const suspend = await app.inject({
      method: 'POST',
      url: `/api/isp/subscribers/${subscriberId}/suspend`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json()).toMatchObject({ success: true, data: { status: 'suspended' } });

    const unauthCloud = await app.inject({ method: 'GET', url: '/api/cloud/services' });
    expect(unauthCloud.statusCode).toBe(401);
  });
});
