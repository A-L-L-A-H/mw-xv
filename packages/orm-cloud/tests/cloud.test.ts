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
import { manifest as subscriptionManifest, Subscription } from '@moonwitness/orm-subscription';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  CloudApp,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider,
  CloudServer,
  createCloudHttpPlugin,
  exportCloudTerraformHcl,
  manifest,
  probeCloudTargetsHealth,
  registerCloudJobHandlers,
  resolveControlPlaneToken,
  selectHealthyDeploymentTarget,
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
  }, 30_000);

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
      createCloudHttpPlugin({
        controlPlaneUrl: 'http://control-plane.local:3003',
        adminToken: 'internal-token-123',
        probePolicy: { allowedHosts: ['coolify.moonwitness.local'] },
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
          if (url.includes('/api/v1/deploy')) {
            return new Response(
              JSON.stringify({ deployment_uuid: 'coolify-dep-001', message: 'Deployment queued' }),
              { status: 200 }
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

      const deployId = deployRes.json().data.deploymentId as number;
      const logsRes = await app.inject({
        method: 'GET',
        url: `/api/cloud/deployments/${deployId}/logs`,
      });
      expect(logsRes.statusCode).toBe(200);
      expect(logsRes.json()).toMatchObject({
        success: true,
        data: { id: deployId, status: 'running', containerId: 'ctr987654321' },
      });

      const sseRes = await app.inject({
        method: 'GET',
        url: `/api/cloud/deployments/${deployId}/logs/stream`,
      });
      expect(sseRes.statusCode).toBe(200);
      expect(sseRes.headers['content-type']).toContain('text/event-stream');
      expect(sseRes.body).toContain('ctr987654321');

      const tfRes = await app.inject({
        method: 'GET',
        url: '/api/cloud/export/terraform',
      });
      expect(tfRes.statusCode).toBe(200);
      expect(tfRes.body).toContain('resource "docker_container"');
      expect(tfRes.body).toContain('moonwitness-isp');

      const coolifyProvider = await CloudProvider.query().findOne({ code: 'coolify' });
      await CloudProvider.query().findById(coolifyProvider!.id).patch({
        is_active: true,
        secret_key: 'coolify-api-token',
      });
      const coolifyServer = await CloudServer.query().insertAndFetch({
        company_id: 1,
        provider_id: coolifyProvider!.id,
        name: 'coolify-eu-node',
        region: 'eu-central',
        ha_group: 'prod-eu',
        ha_priority: 10,
        status: 'active',
      });
      const coolifyTarget = await CloudDeploymentTarget.query().insertAndFetch({
        company_id: 1,
        server_id: coolifyServer.id,
        name: 'coolify-production',
        environment: 'production',
        api_url: 'https://coolify.moonwitness.local',
        ha_group: 'prod-eu',
        priority: 10,
        health_status: 'healthy',
        is_active: true,
      });
      const coolifyApp = await CloudApp.query().insertAndFetch({
        company_id: 1,
        deployment_target_id: coolifyTarget.id,
        subscription_id: cloudApp!.subscription_id,
        name: 'coolify-edge-app',
        image: 'ghcr.io/moonwitness/edge',
        image_tag: '1.0.0',
        is_active: true,
      });

      const coolifyDeploy = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${coolifyApp.id}/deploy`,
      });
      expect(coolifyDeploy.statusCode).toBe(201);
      expect(
        calls.some((c) => c.url.includes('https://coolify.moonwitness.local/api/v1/deploy'))
      ).toBe(true);

      const tfDirect = await exportCloudTerraformHcl(1);
      expect(tfDirect).toContain('resource "coolify_application"');
      expect(tfDirect).not.toContain('coolify-api-token');

      const selected = selectHealthyDeploymentTarget([
        { id: 1, name: 'primary', priority: 10, health_status: 'offline', is_active: true },
        { id: 2, name: 'secondary', priority: 20, health_status: 'healthy', is_active: true },
      ]);
      expect(selected?.name).toBe('secondary');

      currentAuth = { userId: 98, role: 'user', companyId: 1 };
      expect(
        (await app.inject({ method: 'POST', url: `/api/cloud/apps/${cloudApp!.id}/deploy` }))
          .statusCode
      ).toBe(403);

      currentAuth = {
        userId: 98,
        role: 'user',
        companyId: 1,
        groupPermissions: [
          { model_name: 'cloud.app', read: true, create: false, write: true, unlink: false },
          { model_name: 'cloud.deployment', read: true, create: false, write: true, unlink: false },
        ],
      };
      await Subscription.query().findById(cloudApp!.subscription_id!).patch({ state: 'expired' });
      const blockedDeploy = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${cloudApp!.id}/deploy`,
      });
      expect(blockedDeploy.statusCode).toBe(402);

      const enforceRes = await app.inject({
        method: 'POST',
        url: `/api/cloud/subscriptions/${cloudApp!.subscription_id}/enforce`,
      });
      expect(enforceRes.statusCode).toBe(200);
      expect(enforceRes.json()).toMatchObject({ success: true, data: { suspendedApps: 2 } });

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
  }, 30_000);

  it('derives the control-plane token from the shared secret and forwards bearer auth', async () => {
    const derived = resolveControlPlaneToken({ jwtSecret: 'shared-secret-value' });
    expect(derived).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolveControlPlaneToken({ adminToken: ' explicit-token ' })).toBe('explicit-token');

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

    const calls: Array<{ url: string; authorization?: string; body?: string }> = [];
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => {
      (req as { auth?: unknown }).auth = {
        userId: 2,
        role: 'superadmin',
        companyId: 1,
      };
    });

    await app.register(
      createCloudHttpPlugin({
        controlPlaneUrl: 'http://control-plane.local:3003',
        adminToken: 'internal-token-123',
        fetchImpl: async (input, init) => {
          const headers = new Headers(init?.headers);
          calls.push({
            url: String(input),
            authorization: headers.get('authorization') ?? undefined,
            body: init?.body ? String(init.body) : undefined,
          });
          if (String(input).endsWith('/health')) {
            return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
          }
          if (String(input).endsWith('/services')) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          if (String(input).endsWith('/api/deploy')) {
            return new Response(JSON.stringify({ id: 'ctr123', name: 'mw-app' }), { status: 201 });
          }
          if (String(input).includes('/api/containers/')) {
            return new Response(JSON.stringify({ id: 'ctr123', logs: 'live log line' }), {
              status: 200,
            });
          }
          return new Response('{}', { status: 404 });
        },
      })
    );
    await app.ready();

    try {
      const cloudApp = await CloudApp.query().first();
      expect(cloudApp).toBeDefined();

      await app.inject({ method: 'GET', url: '/api/cloud/services' });
      expect(calls.at(-1)?.authorization).toBe('Bearer internal-token-123');

      const deployRes = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${cloudApp!.id}/deploy`,
      });
      expect(deployRes.statusCode).toBe(201);
      const deployCall = calls.find((c) => c.url.endsWith('/api/deploy'));
      expect(deployCall?.authorization).toBe('Bearer internal-token-123');
      expect(JSON.parse(deployCall?.body ?? '{}')).toMatchObject({ name: cloudApp!.name });

      const deployId = deployRes.json().data.deploymentId as number;
      const logsRes = await app.inject({
        method: 'GET',
        url: `/api/cloud/deployments/${deployId}/logs`,
      });
      expect(logsRes.statusCode).toBe(200);
      expect(logsRes.json()).toMatchObject({
        success: true,
        data: { log: 'live log line', live: true },
      });
      expect(calls.at(-1)?.authorization).toBe('Bearer internal-token-123');
    } finally {
      await app.close();
    }
  }, 30_000);

  it('probes cloud deployment target health so HA failover selects a healthy peer', async () => {
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

    const offlineTarget = await CloudDeploymentTarget.query().insertAndFetch({
      company_id: 1,
      name: 'probe-offline',
      environment: 'production',
      api_url: 'http://127.0.0.1:39999',
      health_status: 'healthy',
      is_active: true,
    });
    const healthyTarget = await CloudDeploymentTarget.query().insertAndFetch({
      company_id: 1,
      name: 'probe-healthy',
      environment: 'production',
      api_url: 'http://control-plane.local:3003',
      health_status: 'offline',
      is_active: true,
    });

    const result = await probeCloudTargetsHealth({
      companyId: 1,
      adminToken: 'internal-token-123',
      allowedHosts: ['control-plane.local'],
      fetchImpl: async (input) => {
        if (String(input).includes('control-plane.local')) {
          return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
        }
        throw new Error('unreachable');
      },
    });

    expect(result.probed).toBe(3);
    expect(result.healthy).toBe(1);
    expect(result.offline).toBe(2);
    const offlineTargetRow = await CloudDeploymentTarget.query().findById(offlineTarget.id);
    const healthyTargetRow = await CloudDeploymentTarget.query().findById(healthyTarget.id);
    expect(offlineTargetRow).toBeDefined();
    expect(healthyTargetRow).toBeDefined();
    expect(offlineTargetRow?.health_status).toBe('offline');
    expect(healthyTargetRow?.health_status).toBe('healthy');

    const selected = selectHealthyDeploymentTarget([
      {
        id: offlineTarget.id,
        name: 'probe-offline',
        priority: 10,
        health_status: 'offline',
        is_active: true,
      },
      {
        id: healthyTarget.id,
        name: 'probe-healthy',
        priority: 20,
        health_status: 'healthy',
        is_active: true,
      },
    ]);
    expect(selected?.name).toBe('probe-healthy');

    const dispose = registerCloudJobHandlers({
      adminToken: 'internal-token-123',
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 }),
    });
    try {
      const { enqueueJob, Job } = await import('@moonwitness/jobs');
      const jobId = await enqueueJob('cloud.targets.probe', { companyId: 1 });
      expect(typeof jobId).toBe('number');
      const record = await Job.query().findById(jobId);
      expect(record?.handler).toBe('cloud.targets.probe');
    } finally {
      dispose();
    }
  }, 30_000);
});
