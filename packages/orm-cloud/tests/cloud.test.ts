import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import {
  assertAddonDefaultDataPolicy,
  installAddons,
  resolveViews,
  validateViews,
} from '@moonwitness/orm';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as projectManifest } from '@moonwitness/orm-project';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import { manifest as subscriptionManifest } from '@moonwitness/orm-subscription';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  CloudApp,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider,
  CloudServer,
  createCloudHttpPlugin,
  manifest,
} from '../src/index.js';

describe('@moonwitness/orm-cloud addon', () => {
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

  it('installs Cloud models defaulting to the local Docker Agent and linked to project and subscription', async () => {
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

    const dockerAgent = await CloudProvider.query().findOne({ code: 'docker_agent' });
    expect(dockerAgent).toMatchObject({
      type: 'docker_agent',
      endpoint: 'http://127.0.0.1:3003',
      is_active: true,
    });

    const cloudApp = await CloudApp.query().first();
    expect(cloudApp).toMatchObject({
      is_active: true,
    });
    expect(cloudApp?.partner_id).toBeGreaterThan(0);
    expect(cloudApp?.project_id).toBeGreaterThan(0);
    expect(cloudApp?.subscription_id).toBeGreaterThan(0);
    expect(await db(CloudServer.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });
    expect(await db(CloudDeploymentTarget.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('mounts cloudHttpPlugin routes for health, service listing, and deployment through the control-plane agent', async () => {
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

    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const app = Fastify({ logger: false });
    let currentAuth: { userId: number; role: string; companyId?: number } | null = {
      userId: 2,
      role: 'superadmin',
      companyId: 1,
    };
    app.addHook('onRequest', async (req) => {
      (req as { auth?: typeof currentAuth }).auth = currentAuth;
    });

    await app.register(
      createCloudHttpPlugin({
        controlPlaneUrl: 'http://control-plane.local:3003',
        fetchImpl: async (input, init) => {
          const url = String(input);
          calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body ? String(init.body) : undefined,
          });
          if (url.endsWith('/health')) {
            return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
          }
          if (url.endsWith('/services')) {
            return new Response(
              JSON.stringify([
                { id: 'abc123456789', name: 'moonwitness_isp', state: 'running', status: 'Up' },
              ]),
              { status: 200 }
            );
          }
          if (url.endsWith('/api/deploy')) {
            return new Response(
              JSON.stringify({ id: 'ctr987654321', name: 'mw-xv-isp:latest', status: 'success' }),
              { status: 201 }
            );
          }
          return new Response('{}', { status: 404 });
        },
      })
    );
    await app.ready();

    try {
      const cloudApp = await CloudApp.query().first();
      expect(cloudApp).toBeDefined();

      const healthRes = await app.inject({ method: 'GET', url: '/api/cloud/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toMatchObject({
        success: true,
        data: { controlPlane: 'connected', docker: 'ok' },
      });

      const servicesRes = await app.inject({ method: 'GET', url: '/api/cloud/services' });
      expect(servicesRes.statusCode).toBe(200);
      expect(servicesRes.json()).toMatchObject({
        success: true,
        data: [{ name: 'moonwitness_isp', state: 'running' }],
      });

      const deployRes = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${cloudApp!.id}/deploy`,
      });
      expect(deployRes.statusCode).toBe(201);
      expect(deployRes.json()).toMatchObject({
        success: true,
        data: { status: 'running', containerId: 'ctr987654321' },
      });
      expect(calls.some((c) => c.url === 'http://control-plane.local:3003/api/deploy')).toBe(true);
      expect(await db(CloudDeployment.tableName).count({ count: '*' }).first()).toMatchObject({
        count: 1,
      });

      currentAuth = { userId: 99, role: 'superadmin', companyId: 999 };
      const foreignRes = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${cloudApp!.id}/deploy`,
      });
      expect(foreignRes.statusCode).toBe(404);

      currentAuth = null;
      const unauthRes = await app.inject({ method: 'GET', url: '/api/cloud/health' });
      expect(unauthRes.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
