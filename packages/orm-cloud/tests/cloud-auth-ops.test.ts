import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import { installAddons } from '@moonwitness/orm';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as baseManifest, Company } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as projectManifest } from '@moonwitness/orm-project';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import { manifest as subscriptionManifest, Subscription } from '@moonwitness/orm-subscription';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  CLOUD_CONFIG_REASON_CODES,
  CLOUD_METRICS_CONTRACT,
  CLOUD_OPERATIONS,
  CLOUD_OUTCOMES,
  CLOUD_PROVIDERS,
  CLOUD_ROUTE_ACCESS_MATRIX,
  ALLOWED_DEPLOYMENT_TRANSITIONS,
  HA_DRILL_RUNBOOK,
  PRIVATE_MESH_CIDRS,
  TERMINAL_DEPLOYMENT_STATES,
  TenantUsageSettlementLedger,
  applyDeploymentEvent,
  applyFencedHeartbeat,
  CloudApp,
  CloudConfigError,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider as ProviderModel,
  describeControlPlaneToken,
  executeProvisionWithCompensation,
  isPrivateMeshHost,
  nextHaGeneration,
  planDeploymentRetry,
  planHaNodeRecovery,
  planProvisionCompensation,
  reconcileDeploymentOutcome,
  resolveHaFailoverRace,
  runDeterministicHaDrill,
  tryClaimHaOwnership,
  idempotencyPayloadFingerprint,
  isAllowedProbeHost,
  normalizeCloudOperation,
  normalizeCloudOutcome,
  normalizeCloudProvider,
  PaasQuotaReservationLedger,
  probeCloudTargetsHealth,
  readCloudMetricSnapshot,
  readCloudMetrics,
  readCloudReadiness,
  redactSecrets,
  resetCloudMetrics,
  resolveControlPlaneToken,
  resolveControlPlaneTokenCandidates,
  assertProbeTarget,
  validateCloudConfig,
  validateCloudConfigOrThrow,
  verifyControlPlaneToken,
  createCloudHttpPlugin,
  manifest,
  type CloudHttpPluginOptions,
} from '../src/index.js';

const TEST_ADMIN_TOKEN = 'test-admin-token-123456';
const SENTINEL = 'SENTINEL_SUPER_SECRET_9f8e7d';

interface CapturedCall {
  url: string;
  method?: string;
  authorization?: string;
  body?: string;
}

function defaultFetch(calls: CapturedCall[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      body: init?.body ? String(init.body) : undefined,
    });
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
    }
    if (url.endsWith('/services')) return new Response('[]', { status: 200 });
    if (url.endsWith('/api/deploy')) {
      return new Response(JSON.stringify({ id: 'ctr-tenant-1' }), { status: 201 });
    }
    if (url.includes('/api/containers/')) {
      return new Response(JSON.stringify({ logs: 'live log line' }), { status: 200 });
    }
    if (url.includes('/api/v1/deploy')) {
      return new Response(JSON.stringify({ deployment_uuid: 'coolify-dep', message: 'queued' }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 404 });
  };
}

interface TestApp {
  app: Awaited<ReturnType<typeof Fastify>>;
  calls: CapturedCall[];
  setAuth: (auth: Record<string, unknown> | null) => void;
}

async function buildApp(options: Partial<CloudHttpPluginOptions> = {}): Promise<TestApp> {
  const calls: CapturedCall[] = [];
  let auth: Record<string, unknown> | null = {
    userId: 2,
    role: 'superadmin',
    companyId: 1,
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    (req as { auth?: unknown }).auth = auth;
  });
  const pluginOptions: CloudHttpPluginOptions = {
    controlPlaneUrl: 'http://127.0.0.1:3003',
    adminToken: TEST_ADMIN_TOKEN,
    fetchImpl: defaultFetch(calls),
    ...options,
  };
  await app.register(createCloudHttpPlugin(pluginOptions));
  await app.ready();
  return {
    app,
    calls,
    setAuth: (next) => {
      auth = next;
    },
  };
}

describe('cloud auth and operations hardening', () => {
  let db: Knex;
  let tenantBId: number;
  let probeCompanyId: number;
  let bAppId: number;
  let bSubscriptionId: number;
  let bDeploymentId: number;
  let bTargetId: number;

  beforeAll(async () => {
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

    const tenantB = await Company.query().insertAndFetch({ name: 'tenant-b-isolation' });
    tenantBId = tenantB.id;
    const bTarget = await CloudDeploymentTarget.query().insertAndFetch({
      company_id: tenantBId,
      name: 'b-isolation-target',
      environment: 'production',
      api_url: 'http://127.0.0.1:39999',
      is_active: true,
    });
    bTargetId = bTarget.id;
    const bApp = await CloudApp.query().insertAndFetch({
      company_id: tenantBId,
      deployment_target_id: bTargetId,
      name: 'b-isolation-app',
      image: 'nginx',
      image_tag: '1.0',
      is_active: true,
    });
    bAppId = bApp.id;
    const bDeployment = await CloudDeployment.query().insertAndFetch({
      company_id: tenantBId,
      app_id: bAppId,
      status: 'running',
      container_id: 'b-foreign-container',
      trigger: 'manual',
      started_at: '2026-11-24T00:00:00',
    });
    bDeploymentId = bDeployment.id;

    const templateSubscription = await Subscription.query().first();
    const bSubscription = await Subscription.query().insertAndFetch({
      name: 'b-isolation-subscription',
      partner_id: templateSubscription!.partner_id,
      plan_id: templateSubscription!.plan_id,
      company_id: tenantBId,
      state: 'expired',
    });
    bSubscriptionId = bSubscription.id;

    const probeCompany = await Company.query().insertAndFetch({ name: 'tenant-probe-policy' });
    probeCompanyId = probeCompany.id;
    for (const [name, apiUrl] of [
      ['probe-good', 'http://control-plane.local:3003'],
      ['probe-linklocal', 'http://169.254.169.254/latest/meta-data'],
      ['probe-redirect', 'http://control-plane.local:3003/redirect'],
      ['probe-hang', 'http://control-plane.local:3003/hang'],
      ['probe-huge', 'http://control-plane.local:3003/huge'],
      ['probe-malformed', 'http://control-plane.local:3003/malformed'],
    ] as const) {
      await CloudDeploymentTarget.query().insertAndFetch({
        company_id: probeCompanyId,
        name,
        environment: 'production',
        api_url: apiUrl,
        is_active: true,
        health_status: 'healthy',
      });
    }
  }, 90_000);

  afterAll(async () => {
    await db.destroy();
  });

  it('publishes an explicit route/model access matrix covering every operation family', () => {
    for (const rule of CLOUD_ROUTE_ACCESS_MATRIX) {
      expect(rule.model).toMatch(/^cloud\./u);
      expect(['read', 'create', 'write', 'unlink']).toContain(rule.permission);
      expect(rule.operation.length).toBeGreaterThan(0);
      expect(rule.feature.length).toBeGreaterThan(0);
    }
    const paths = CLOUD_ROUTE_ACCESS_MATRIX.map((rule) => rule.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of [
      '/api/cloud/apps/:id/deploy',
      '/api/cloud/apps/:id',
      '/api/cloud/subscriptions/:id/enforce',
      '/api/cloud/deployments/:id/logs',
      '/api/cloud/deployments/:id/logs/stream',
      '/api/cloud/targets/probe',
      '/api/cloud/export/terraform',
      '/api/cloud/services',
      '/api/cloud/health',
      '/api/cloud/readiness',
    ]) {
      expect(paths).toContain(path);
    }
  });

  it('allows same-company operations and denies cross-company IDs for every route family', async () => {
    const { app, setAuth, calls } = await buildApp();
    try {
      const ownApp = await CloudApp.query().findOne({ company_id: 1, name: 'moonwitness-isp' });
      const ownDeploy = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
      });
      expect(ownDeploy.statusCode).toBe(201);
      const ownDeploymentId = ownDeploy.json().data.deploymentId as number;
      const ownLogs = await app.inject({
        method: 'GET',
        url: `/api/cloud/deployments/${ownDeploymentId}/logs`,
      });
      expect(ownLogs.statusCode).toBe(200);

      const families: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string }> = [
        { method: 'POST', url: `/api/cloud/apps/${bAppId}/deploy` },
        { method: 'DELETE', url: `/api/cloud/apps/${bAppId}` },
        { method: 'POST', url: `/api/cloud/subscriptions/${bSubscriptionId}/enforce` },
        { method: 'GET', url: `/api/cloud/deployments/${bDeploymentId}/logs` },
        { method: 'GET', url: `/api/cloud/deployments/${bDeploymentId}/logs/stream` },
      ];
      for (const family of families) {
        const res = await app.inject(family);
        expect(res.statusCode, `${family.method} ${family.url}`).toBe(404);
        expect(res.body).not.toContain('b-isolation');
        expect(res.body).not.toContain('b-foreign-container');
        expect(res.body).not.toContain(TEST_ADMIN_TOKEN);
      }

      const tfRes = await app.inject({ method: 'GET', url: '/api/cloud/export/terraform' });
      expect(tfRes.statusCode).toBe(200);
      expect(tfRes.body).not.toContain('b-isolation-app');

      const healthBefore = (await CloudDeploymentTarget.query().findById(bTargetId))!.health_status;
      const probeRes = await app.inject({ method: 'POST', url: '/api/cloud/targets/probe' });
      expect(probeRes.statusCode).toBe(200);
      expect(probeRes.json().data.probed).toBeLessThanOrEqual(3);
      expect((await CloudDeploymentTarget.query().findById(bTargetId))!.health_status).toBe(
        healthBefore
      );
      expect(
        await CloudApp.query()
          .findById(bAppId)
          .then((app) => app!.is_active)
      ).toBe(true);

      setAuth(null);
      expect((await app.inject({ method: 'GET', url: '/api/cloud/health' })).statusCode).toBe(401);
      setAuth({ userId: 3, role: 'user', companyId: 1 });
      expect(
        (await app.inject({ method: 'POST', url: `/api/cloud/apps/${ownApp!.id}/deploy` }))
          .statusCode
      ).toBe(403);
      setAuth({ userId: 3, role: 'superadmin' });
      expect((await app.inject({ method: 'GET', url: '/api/cloud/health' })).statusCode).toBe(403);
      expect(calls.some((call) => call.url.includes('169.254.169.254'))).toBe(false);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('redacts sentinel secrets everywhere and supports overlapping token rotation', async () => {
    expect(redactSecrets(`Bearer ${SENTINEL} secret_key="${SENTINEL}"`)).not.toContain(SENTINEL);
    expect(redactSecrets(`postgres://user:${SENTINEL}@db.local/x`)).not.toContain(SENTINEL);
    expect(redactSecrets(JSON.stringify({ token: SENTINEL }))).not.toContain(SENTINEL);

    const provider = await ProviderModel.query().findOne({ code: 'docker_agent' });
    await ProviderModel.query().findById(provider!.id).patch({ secret_key: SENTINEL });
    const ownApp = await CloudApp.query().findOne({ company_id: 1, name: 'moonwitness-isp' });
    const calls: CapturedCall[] = [];
    const { app } = await buildApp({
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), body: init?.body ? String(init.body) : undefined });
        throw new Error(`upstream rejected token=${SENTINEL} Bearer ${TEST_ADMIN_TOKEN}`);
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
      });
      expect(res.statusCode).toBe(502);
      expect(res.body).not.toContain(SENTINEL);
      expect(res.body).not.toContain(TEST_ADMIN_TOKEN);
      const latest = await CloudDeployment.query().orderBy('id', 'desc').first();
      expect(latest!.error_message ?? '').not.toContain(SENTINEL);
      expect(latest!.log ?? '').not.toContain(SENTINEL);
      expect(calls.every((call) => !String(call.body).includes(SENTINEL))).toBe(true);
    } finally {
      await app.close();
    }

    const previous = resolveControlPlaneToken({ adminToken: 'old-rotation-token-12345' });
    const current = resolveControlPlaneToken({ adminToken: 'new-rotation-token-12345' });
    const options = {
      adminToken: current,
      previousAdminToken: previous,
      rotationVersion: 'v2',
    };
    expect(resolveControlPlaneTokenCandidates(options)).toEqual([current, previous]);
    expect(verifyControlPlaneToken(current, options)).toBe(true);
    expect(verifyControlPlaneToken(previous, options)).toBe(true);
    expect(verifyControlPlaneToken('unknown-token', options)).toBe(false);
    expect(verifyControlPlaneToken(undefined, options)).toBe(false);
    const described = describeControlPlaneToken(options);
    expect(described).toMatchObject({
      configured: true,
      rotationVersion: 'v2',
      overlapEnabled: true,
    });
    expect(JSON.stringify(described)).not.toContain(current);
    expect(JSON.stringify(described)).not.toContain(previous);
  }, 30_000);

  it('makes provisioning retry-safe: sequential replay, payload conflict, concurrent retry and ambiguous timeout', async () => {
    const ownApp = await CloudApp.query().findOne({ company_id: 1, name: 'moonwitness-isp' });
    const providerCalls: string[] = [];
    const { app } = await buildApp({
      fetchImpl: async (input, _init) => {
        providerCalls.push(String(input));
        await Promise.resolve();
        return new Response(JSON.stringify({ id: `ctr-${providerCalls.length}` }), { status: 201 });
      },
    });
    try {
      const before = Number(
        (await db(CloudDeployment.tableName)
          .where({ company_id: 1 })
          .count({ count: '*' })
          .first())!.count
      );

      const key = 'retry-key-0001';
      const first = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': key },
      });
      const replay = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': key },
      });
      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.deploymentId).toBe(first.json().data.deploymentId);
      expect(providerCalls.filter((url) => url.endsWith('/api/deploy'))).toHaveLength(1);
      const afterSequential = Number(
        (await db(CloudDeployment.tableName)
          .where({ company_id: 1 })
          .count({ count: '*' })
          .first())!.count
      );
      expect(afterSequential).toBe(before + 1);

      await CloudApp.query().findById(ownApp!.id).patch({ image_tag: '2.0.0' });
      try {
        const conflict = await app.inject({
          method: 'POST',
          url: `/api/cloud/apps/${ownApp!.id}/deploy`,
          headers: { 'idempotency-key': key },
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
        expect(providerCalls.filter((url) => url.endsWith('/api/deploy'))).toHaveLength(1);
      } finally {
        await CloudApp.query().findById(ownApp!.id).patch({ image_tag: 'latest' });
      }

      const concurrentKey = 'retry-key-concurrent';
      const [concurrentA, concurrentB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/cloud/apps/${ownApp!.id}/deploy`,
          headers: { 'idempotency-key': concurrentKey },
        }),
        app.inject({
          method: 'POST',
          url: `/api/cloud/apps/${ownApp!.id}/deploy`,
          headers: { 'idempotency-key': concurrentKey },
        }),
      ]);
      expect([concurrentA.statusCode, concurrentB.statusCode].sort()).toEqual([200, 201]);
      expect(providerCalls.filter((url) => url.endsWith('/api/deploy'))).toHaveLength(2);
      expect(concurrentA.json().data.deploymentId).toBe(concurrentB.json().data.deploymentId);

      expect(idempotencyPayloadFingerprint({ b: 2, a: 1 })).toBe(
        idempotencyPayloadFingerprint({ a: 1, b: 2 })
      );
      expect(idempotencyPayloadFingerprint({ a: 1 })).not.toBe(
        idempotencyPayloadFingerprint({ a: 2 })
      );
      const badKey = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'short' },
      });
      expect(badKey.statusCode).toBe(400);
      expect(badKey.json().code).toBe('INVALID_IDEMPOTENCY_KEY');
    } finally {
      await app.close();
    }

    let timeoutCalls = 0;
    const timeoutApp = await buildApp({
      fetchImpl: async () => {
        timeoutCalls += 1;
        const error = new Error('upstream timeout');
        error.name = 'TimeoutError';
        throw error;
      },
    });
    try {
      const options = {
        method: 'POST' as const,
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'timeout-key-0001' },
      };
      const ambiguous = await timeoutApp.app.inject(options);
      expect(ambiguous.statusCode).toBe(202);
      expect(ambiguous.json().ambiguous).toBe(true);
      const reconciled = await timeoutApp.app.inject(options);
      expect(reconciled.statusCode).toBe(202);
      expect(reconciled.json().reconciliationRequired).toBe(true);
      expect(timeoutCalls).toBe(1);
    } finally {
      await timeoutApp.app.close();
    }
  }, 30_000);

  it('bounds probes with an SSRF allowlist, redirect revalidation, timeout and response size', async () => {
    expect(isAllowedProbeHost('127.0.0.1')).toBe(true);
    expect(isAllowedProbeHost('169.254.169.254')).toBe(false);
    expect(isAllowedProbeHost('8.8.8.8')).toBe(false);
    expect(isAllowedProbeHost('10.0.0.5')).toBe(false);
    expect(isAllowedProbeHost('10.0.0.5', { allowPrivateRanges: true })).toBe(true);
    expect(
      isAllowedProbeHost('control-plane.local', { allowedHosts: ['control-plane.local'] })
    ).toBe(true);
    expect(() => assertProbeTarget('http://user:pass@127.0.0.1:3003')).toThrow();
    expect(() => assertProbeTarget('ftp://127.0.0.1')).toThrow();
    expect(() => assertProbeTarget('http://169.254.169.254/')).toThrow();

    const fetched: string[] = [];
    const startedAt = Date.now();
    const result = await probeCloudTargetsHealth({
      companyId: probeCompanyId,
      adminToken: TEST_ADMIN_TOKEN,
      allowedHosts: ['control-plane.local'],
      timeoutMs: 40,
      fetchImpl: async (input, init) => {
        const url = String(input);
        fetched.push(url);
        if (url.endsWith('/redirect')) {
          return new Response('', {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
          });
        }
        if (url.endsWith('/hang')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'TimeoutError';
              reject(error);
            });
          });
        }
        if (url.endsWith('/huge')) {
          return new Response('x'.repeat(128 * 1024), { status: 200 });
        }
        if (url.endsWith('/malformed')) {
          return new Response('not-json', { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
      },
    });

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(result.probed).toBe(6);
    expect(result.healthy).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.offline).toBe(4);
    for (const code of [
      'TARGET_NOT_ALLOWED',
      'REDIRECT_BLOCKED',
      'TIMEOUT',
      'RESPONSE_TOO_LARGE',
      'MALFORMED_RESPONSE',
    ]) {
      expect(result.reasonCodes).toContain(code);
    }
    expect(fetched.some((url) => url.includes('169.254.169.254'))).toBe(false);
    expect(fetched.filter((url) => url.endsWith('/redirect'))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100));

    const good = await CloudDeploymentTarget.query().findOne({
      company_id: probeCompanyId,
      name: 'probe-good',
    });
    const blocked = await CloudDeploymentTarget.query().findOne({
      company_id: probeCompanyId,
      name: 'probe-linklocal',
    });
    expect(good!.health_status).toBe('healthy');
    expect(blocked!.health_status).toBe('healthy');
  }, 30_000);

  it('emits low-cardinality metrics with normalized labels and no tenant/secret values', async () => {
    resetCloudMetrics();
    const { app, setAuth } = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/api/cloud/health' });
      await app.inject({ method: 'GET', url: '/api/cloud/services' });
      await app.inject({ method: 'GET', url: '/api/cloud/readiness' });
      setAuth(null);
      await app.inject({ method: 'GET', url: '/api/cloud/health' });
    } finally {
      await app.close();
    }

    const snapshot = readCloudMetricSnapshot();
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot.length).toBeLessThanOrEqual(CLOUD_METRICS_CONTRACT.maxSeries);
    for (const sample of snapshot) {
      expect(CLOUD_OPERATIONS).toContain(sample.operation);
      expect(CLOUD_OUTCOMES).toContain(sample.outcome);
      expect(CLOUD_PROVIDERS).toContain(sample.provider);
      expect(sample.count).toBeGreaterThan(0);
    }
    const text = readCloudMetrics();
    expect(text).toContain(CLOUD_METRICS_CONTRACT.counter);
    expect(text).toContain('operation="control_plane.health"');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toMatch(/company[_-]?id/iu);
    expect(text).not.toContain('b-isolation');
    expect(text).not.toContain('127.0.0.1');

    expect(normalizeCloudOperation(SENTINEL)).toBe('other');
    expect(normalizeCloudOutcome(503)).toBe('failed');
    expect(normalizeCloudOutcome(402)).toBe('denied');
    expect(normalizeCloudProvider(SENTINEL)).toBe('other');
  }, 30_000);

  it('validates startup config, keeps disabled features inert and reports safe readiness reasons', async () => {
    const emptyEnv = {} as NodeJS.ProcessEnv;
    const disabled = validateCloudConfig(
      { features: { controlPlane: false, provisioning: false } },
      emptyEnv
    );
    expect(disabled.ok).toBe(true);
    expect(readCloudReadiness(disabled)).toMatchObject({ ready: true, enabledFeatures: [] });

    const missing = validateCloudConfig(
      { adminToken: 'x', features: { controlPlane: true } },
      emptyEnv
    );
    expect(missing.reasonCodes).toContain('CLOUD_TOKEN_WEAK');
    expect(missing.reasonCodes).toContain('CLOUD_CP_URL_MISSING');
    expect(readCloudReadiness(missing).ready).toBe(false);
    for (const issue of missing.issues) {
      expect(issue.message).not.toContain('http://');
      expect(issue.message).not.toContain('x');
    }

    const malformed = validateCloudConfig(
      {
        controlPlaneUrl: 'not-a-url',
        adminToken: TEST_ADMIN_TOKEN,
        features: { controlPlane: true },
      },
      emptyEnv
    );
    expect(malformed.reasonCodes).toContain('CLOUD_CP_URL_MALFORMED');

    const secretRef = validateCloudConfig(
      {
        adminTokenRef: 'MW_TEST_MISSING_REF',
        features: { controlPlane: true },
      },
      emptyEnv
    );
    expect(secretRef.reasonCodes).toContain('CLOUD_SECRET_REF_MISSING');

    const dependency = validateCloudConfig(
      { adminToken: TEST_ADMIN_TOKEN, features: { provisioning: true, controlPlane: false } },
      emptyEnv
    );
    expect(dependency.reasonCodes).toContain('CLOUD_FEATURE_DEPENDENCY_MISSING');

    expect(() =>
      validateCloudConfigOrThrow(
        {
          controlPlaneUrl: 'http://127.0.0.1:3003',
          adminToken: SENTINEL,
          features: { controlPlane: true },
        },
        emptyEnv
      )
    ).not.toThrow();
    let thrown: unknown;
    try {
      validateCloudConfigOrThrow(
        {
          controlPlaneUrl: 'http://127.0.0.1:3003',
          adminToken: 'x',
          features: { controlPlane: true },
        },
        emptyEnv
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CloudConfigError);
    expect((thrown as CloudConfigError).message).not.toContain('x');
    expect((thrown as CloudConfigError).reasonCodes).toContain('CLOUD_TOKEN_WEAK');
    for (const code of (thrown as CloudConfigError).reasonCodes) {
      expect(CLOUD_CONFIG_REASON_CODES).toContain(code);
    }

    const closed = await buildApp({
      controlPlaneUrl: 'http://127.0.0.1:3003',
      adminToken: undefined,
      features: { controlPlane: true, provisioning: true },
    });
    try {
      const health = await closed.app.inject({ method: 'GET', url: '/api/cloud/health' });
      expect(health.statusCode).toBe(503);
      expect(health.json().code).toBe('CLOUD_TOKEN_MISSING');
      expect(health.json().error).not.toContain('http://');
      const readiness = await closed.app.inject({ method: 'GET', url: '/api/cloud/readiness' });
      expect(readiness.statusCode).toBe(200);
      expect(readiness.json().data.ready).toBe(false);
      expect(readiness.json().data.reasonCodes).toContain('CLOUD_TOKEN_MISSING');
    } finally {
      await closed.app.close();
    }

    // Configuration is resolved when the plugin registers (not at construction),
    // so strict startup rejects while the Fastify app becomes ready.
    const strictApp = Fastify();
    strictApp.register(
      createCloudHttpPlugin({
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: 'x',
        features: { controlPlane: true },
        strictStartup: true,
      })
    );
    let strictThrown: unknown;
    try {
      await strictApp.ready();
    } catch (error) {
      strictThrown = error;
    } finally {
      await strictApp.close();
    }
    expect(strictThrown).toBeInstanceOf(CloudConfigError);
  }, 30_000);

  it('drives deployment transitions through the shared state machine and preserves response shapes', async () => {
    const ownApp = await CloudApp.query().findOne({ company_id: 1, name: 'moonwitness-isp' });
    const successApp = await buildApp();
    try {
      const res = await successApp.app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        success: true,
        data: { status: 'running', containerId: 'ctr-tenant-1' },
      });
      const latest = await CloudDeployment.query().orderBy('id', 'desc').first();
      expect(latest!.status).toBe('running');
    } finally {
      await successApp.app.close();
    }

    const failingApp = await buildApp({
      fetchImpl: async () => new Response('provider error', { status: 500 }),
    });
    try {
      const res = await failingApp.app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
      });
      expect(res.statusCode).toBe(502);
      const latest = await CloudDeployment.query().orderBy('id', 'desc').first();
      expect(latest!.status).toBe('failed');
    } finally {
      await failingApp.app.close();
    }

    expect(TERMINAL_DEPLOYMENT_STATES.has('failed')).toBe(true);
    expect(
      applyDeploymentEvent('failed', {
        kind: 'provider_succeeded',
        observedAt: '2026-11-24T00:00:00Z',
      })
    ).toMatchObject({ changed: false, terminalProtected: true });
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS.pending).toContain('running');
    expect(
      planDeploymentRetry({ deploymentId: 42, state: 'pending', attempts: 0 }).idempotencyKey
    ).toBe('deploy:42:uncorrelated');
    expect(
      reconcileDeploymentOutcome(
        { state: 'pending', providerCorrelationId: 'ctr-1', attempts: 1 },
        'ambiguous'
      ).state
    ).toBe('unknown');
  }, 30_000);

  it('enforces the quota ledger at the reservation boundary and settles failures', async () => {
    const ownApp = await CloudApp.query().findOne({ company_id: 1, name: 'moonwitness-isp' });
    const ledger = new PaasQuotaReservationLedger();
    const scope = { companyId: 1, resource: 'cloud.app.deploy' };
    const { app } = await buildApp({ quotaLedger: ledger, quotaCapacity: 1, quotaUnits: 1 });
    try {
      const first = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'quota-key-first' },
      });
      expect(first.statusCode).toBe(201);
      expect(ledger.snapshot(scope).committedUnits).toBe(1);

      const denied = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'quota-key-second' },
      });
      expect(denied.statusCode).toBe(402);
      expect(denied.json().code).toBe('PAAS_QUOTA_RESERVATION_EXCEEDED');

      const replay = await app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'quota-key-first' },
      });
      expect(replay.statusCode).toBe(200);
      expect(ledger.snapshot(scope).committedUnits).toBe(1);
    } finally {
      await app.close();
    }

    const failureLedger = new PaasQuotaReservationLedger();
    const failing = await buildApp({
      quotaLedger: failureLedger,
      quotaCapacity: 1,
      quotaUnits: 1,
      fetchImpl: async () => new Response('provider error', { status: 500 }),
    });
    try {
      const failed = await failing.app.inject({
        method: 'POST',
        url: `/api/cloud/apps/${ownApp!.id}/deploy`,
        headers: { 'idempotency-key': 'quota-key-failure' },
      });
      expect(failed.statusCode).toBe(502);
      expect(failureLedger.snapshot(scope).reservedUnits).toBe(0);
      expect(failureLedger.snapshot(scope).remainingUnits).toBe(1);
    } finally {
      await failing.app.close();
    }
  }, 30_000);

  it('re-exports the shared CLOUD-B integration surface from the package entrypoint', () => {
    for (const helper of [
      applyDeploymentEvent,
      reconcileDeploymentOutcome,
      planDeploymentRetry,
      PaasQuotaReservationLedger,
      TenantUsageSettlementLedger,
      executeProvisionWithCompensation,
      planProvisionCompensation,
      tryClaimHaOwnership,
      applyFencedHeartbeat,
      resolveHaFailoverRace,
      planHaNodeRecovery,
      nextHaGeneration,
      isPrivateMeshHost,
      runDeterministicHaDrill,
    ]) {
      expect(typeof helper).toBe('function');
    }
    expect(PRIVATE_MESH_CIDRS.length).toBeGreaterThan(0);
    expect(HA_DRILL_RUNBOOK.length).toBeGreaterThan(0);
    expect(TERMINAL_DEPLOYMENT_STATES.size).toBeGreaterThan(0);
  });

  it('trims repeated trailing slashes on controlPlaneUrl in linear time', async () => {
    const slashed = await buildApp({
      controlPlaneUrl: `http://127.0.0.1:3003${'/'.repeat(20_000)}`,
    });
    try {
      const res = await slashed.app.inject({ method: 'GET', url: '/api/cloud/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.controlPlane).toBe('connected');
      expect(slashed.calls.map((call) => call.url)).toContain('http://127.0.0.1:3003/health');
    } finally {
      await slashed.app.close();
    }
  });

  it('enforces auth and proxies /api/cloud/paas/* endpoints to the private control plane', async () => {
    const customFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/paas/metrics')) {
        return new Response(
          JSON.stringify({
            nodeId: 'vps-node',
            meshIp: '10.144.0.1',
            cpuPercent: 4.5,
            memoryUsedMb: 1024,
            memoryTotalMb: 8192,
            runningApps: 2,
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/paas/apps') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            apps: [{ id: 'demo', slug: 'demo', image: 'nginx:alpine', status: 'running' }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/paas/apps') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ appId: 'demo', slug: 'demo', status: 'running', url: 'https://demo.apps.moonwitness.biz.id' }),
          { status: 201 }
        );
      }
      if (url.endsWith('/paas/backups')) {
        return new Response(
          JSON.stringify({
            backups: [{ id: 'pg-1', filename: 'pg-1.dump', sizeBytes: 2_097_152, sha256: 'abc', createdAt: '2026-11-25T00:00:00Z' }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/agent/containers/run') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            ok: true,
            slug: 'demo',
            containerName: 'mw-paas-demo',
            containerId: 'ctr-demo',
            status: 'running',
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const harness = await buildApp({ fetchImpl: customFetch });
    try {
      harness.setAuth(null);
      const unauth = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/metrics' });
      expect(unauth.statusCode).toBe(401);

      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });
      const metricsRes = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/metrics' });
      expect(metricsRes.statusCode).toBe(200);
      expect(metricsRes.json().data.nodeId).toBe('vps-node');

      const appsRes = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/apps' });
      expect(appsRes.statusCode).toBe(200);
      expect(appsRes.json().data).toHaveLength(1);

      const deployRes = await harness.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/apps/deploy',
        payload: { slug: 'demo', image: 'nginx:alpine', port: 80 },
      });
      expect(deployRes.statusCode).toBe(201);

      const backupsRes = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/backups' });
      expect(backupsRes.statusCode).toBe(200);
      expect(backupsRes.json().data[0].sizeMb).toBe(2);
    } finally {
      await harness.app.close();
    }
  });

  describe('Postgres PaaS settings & TLS lockdown', () => {
    let harness: TestApp;

    beforeAll(async () => {
      const customFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        console.log('[MOCK FETCH SETTINGS]', init?.method || 'GET', url);
        try {
          if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.endsWith('/agent/containers/run') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              slug: 'test-app',
              containerName: 'mw-paas-test-app',
              containerId: 'ctr-test-app',
              status: 'running',
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/git/deploy') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              slug: 'test-app',
              image: 'test-image',
              branch: 'main',
              commitSha: 'abc123',
              containerName: 'mw-paas-test-app',
              containerId: 'ctr-test-app',
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/containers') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              containers: [
                { name: 'test-app', containerId: 'ctr-1', image: 'nginx', state: 'running', status: 'running', slug: 'test-app', managed: true },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes('/agent/containers/') && url.includes('/stats')) {
          return new Response(
            JSON.stringify({
              slug: 'test-app',
              containerName: 'mw-paas-test-app',
              cpuPercent: 1.5,
              memoryPercent: 25.0,
              memoryUsed: '256MiB',
              memoryLimit: '1GiB',
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/dns/verify') && init?.method === 'POST') {
          console.log('[MOCK FETCH SETTINGS] MATCHED /agent/dns/verify');
          return new Response(
            JSON.stringify({
              ok: true,
              expectedIpv4: '1.2.3.4',
              allMatched: true,
              instance: { matched: true },
              wildcard: { matched: false },
              whatsapp: { matched: false },
              httpsReady: { reachable: true, tlsVerified: true },
            }),
            { status: 200 }
          );
        }
        console.log('[MOCK FETCH SETTINGS] UNMATCHED', init?.method || 'GET', url);
        return new Response('{}', { status: 404 });
      } catch (e) {
        console.error('[MOCK FETCH SETTINGS] ERROR', e);
        return new Response('{}', { status: 500 });
      }
      };

      // Ensure models are bound to the database
      const { Model } = await import('objection');
      Model.knex(db);

      harness = await buildApp({
        fetchImpl: customFetch,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('GET /settings reads from base_config_parameters and builds Caddy spec', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/settings' });
      console.log('GET /settings response:', res.statusCode, res.json());
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data).toHaveProperty('instanceDomain');
      expect(res.json().data).toHaveProperty('wildcardDomain');
      expect(res.json().data).toHaveProperty('routes');
      expect(res.json().data).toHaveProperty('previewListeners');
    });

    it('POST /settings/verify-dns proxies to agent', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/settings/verify-dns',
        payload: { instanceDomain: 'test.example.com', checkHttps: false },
      });
      console.log('POST /settings/verify-dns response:', res.statusCode, res.json());
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('POST /settings/apply rejects lockdown when checkHttps fails', async () => {
      const customFetchFailHttps: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/dns/verify') && init?.method === 'POST') {
          // Simulate DNS check failing HTTPS
          return new Response(
            JSON.stringify({
              ok: true,
              expectedIpv4: '1.2.3.4',
              allMatched: false,
              instance: { matched: true },
              wildcard: { matched: false },
              whatsapp: { matched: false },
              httpsReady: { reachable: false, tlsVerified: false },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      };

      const harnessFail = await buildApp({
        fetchImpl: customFetchFailHttps,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harnessFail.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });

      const res = await harnessFail.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/settings/apply',
        payload: { instanceDomain: 'test.example.com', publicPortEnabled: false, checkHttps: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
      await harnessFail.app.close();
    });

    it('POST /settings/apply accepts when checkHttps passes', async () => {
      const customFetchPassHttps: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/dns/verify') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              expectedIpv4: '1.2.3.4',
              allMatched: true,
              instance: { matched: true },
              wildcard: { matched: false },
              whatsapp: { matched: false },
              httpsReady: { reachable: true, tlsVerified: true },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      };

      const harnessPass = await buildApp({
        fetchImpl: customFetchPassHttps,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harnessPass.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });

      const res = await harnessPass.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/settings/apply',
        payload: { instanceDomain: 'test.example.com', publicPortEnabled: false, checkHttps: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      await harnessPass.app.close();
    });

    it('never leaks seeded isp.moonwitness.local into Caddy routes', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/settings' });
      const routes = res.json().data.routes;
      const ispRoute = routes.find((r: { domain: string }) => r.domain.includes('isp.moonwitness.local'));
      expect(ispRoute).toBeUndefined();
    });
  });

  describe('POST /templates/deploy preview port allocation & promote-wildcard secret preservation', () => {
    let harness: TestApp;

    beforeAll(async () => {
      const customFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.endsWith('/agent/compose/up') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ ok: true, slug: 'uptime-kuma', containers: [] }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/containers') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              containers: [
                { name: 'uptime-kuma', containerId: 'ctr-1', image: 'uptime-kuma', state: 'running', status: 'running', slug: 'uptime-kuma', managed: true, host_port: 8001 },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes('/agent/containers/') && url.includes('/stats')) {
          return new Response(
            JSON.stringify({
              slug: 'uptime-kuma',
              containerName: 'mw-paas-uptime-kuma',
              cpuPercent: 1.5,
              memoryPercent: 25.0,
              memoryUsed: '256MiB',
              memoryLimit: '1GiB',
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      harness = await buildApp({
        fetchImpl: customFetch,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('allocates preview port 8001 in IP mode for template deploy', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/templates/deploy',
        payload: { slug: 'uptime-kuma', tenantId: 'test-tenant' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toHaveProperty('previewPort');
      // In IP mode with no domain, should allocate preview port 8001 (first available)
      expect([8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008, 8009, 8010]).toContain(res.json().data.previewPort);
    });

    it('promote-wildcard switches to <slug>.<wildcard> preserving secrets', async () => {
      // Ensure models are bound to the database
      const { Model } = await import('objection');
      Model.knex(db);

      // First, apply a wildcard domain
      const customFetchWithWildcard: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.endsWith('/agent/compose/up') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ ok: true, slug: 'uptime-kuma', containers: [] }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/dns/verify') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              expectedIpv4: '1.2.3.4',
              allMatched: true,
              instance: { matched: true },
              wildcard: { matched: false },
              whatsapp: { matched: false },
              httpsReady: { reachable: true, tlsVerified: true },
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      const harnessPromote = await buildApp({
        fetchImpl: customFetchWithWildcard,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harnessPromote.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });

      // Apply settings with wildcard domain
      const applyRes = await harnessPromote.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/settings/apply',
        payload: { instanceDomain: 'test.example.com', wildcardDomain: 'apps.example.com', publicPortEnabled: false, checkHttps: false },
      });
      console.log('APPLY RES:', applyRes.statusCode, applyRes.json());
      expect(applyRes.statusCode).toBe(200);

      // Now promote preview apps
      const promoteRes = await harnessPromote.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/settings/promote-wildcard',
        payload: { wildcardDomain: 'apps.example.com' },
      });
      console.log('PROMOTE RES:', promoteRes.statusCode, promoteRes.json());
      expect(promoteRes.statusCode).toBe(200);
      expect(promoteRes.json().success).toBe(true);
      expect(promoteRes.json().data).toHaveProperty('promotedCount');
      await harnessPromote.app.close();
    });
  });

  describe('POST /apps/:slug/env preserves existing secrets with [REDACTED]', () => {
    let harness: TestApp;

    beforeAll(async () => {
      // Ensure models are bound to the database
      const { Model } = await import('objection');
      Model.knex(db);

      const customFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.endsWith('/agent/containers/run') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              slug: 'secret-test',
              containerName: 'mw-paas-secret-test',
              containerId: 'ctr-secret-test',
              status: 'running',
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/compose/up') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ ok: true, slug: 'secret-test', containers: [] }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/containers') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              containers: [
                { name: 'secret-test', containerId: 'ctr-1', image: 'nginx', state: 'running', status: 'running', slug: 'secret-test', managed: true },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      harness = await buildApp({
        fetchImpl: customFetch,
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken: TEST_ADMIN_TOKEN,
      });
      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('preserves existing secret when [REDACTED] is sent for env var', async () => {
      // First deploy an app with a secret
      const deployRes = await harness.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/apps/deploy',
        payload: { slug: 'secret-test', image: 'nginx:alpine', port: 80, env: { MY_SECRET: 'super-secret-value', PUBLIC_VAR: 'public' } },
      });
      expect(deployRes.statusCode).toBe(201);

      // Now update env with [REDACTED] for the secret
      const updateRes = await harness.app.inject({
        method: 'POST',
        url: '/api/cloud/paas/apps/secret-test/env',
        payload: { env: { MY_SECRET: '[REDACTED]', PUBLIC_VAR: 'updated-public', NEW_VAR: 'new-value' }, merge: true, redeploy: false },
      });
      console.log('ENV UPDATE RES:', updateRes.statusCode, updateRes.json());
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().success).toBe(true);
      // The response should redact all values
      expect(updateRes.json().data.env).toEqual({
        MY_SECRET: '[REDACTED]',
        PUBLIC_VAR: '[REDACTED]',
        NEW_VAR: '[REDACTED]',
      });

      // Verify the actual stored value is preserved by checking detail endpoint
      const detailRes = await harness.app.inject({
        method: 'GET',
        url: '/api/cloud/paas/apps/secret-test',
      });
      expect(detailRes.statusCode).toBe(200);
      // The detail endpoint should also redact values
      expect(detailRes.json().data.env_vars).toEqual({
        MY_SECRET: '[REDACTED]',
        PUBLIC_VAR: '[REDACTED]',
        NEW_VAR: '[REDACTED]',
      });
    });
  });

  describe('GET /metrics parses memoryUsedMB/memoryTotalMB', () => {
    it('parses both camelCase and uppercase MB', async () => {
      const customFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/paas/metrics')) {
          // Return both camelCase and uppercase variants
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMB: 2048,
              memoryTotalMB: 16384,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      };

      const harness = await buildApp({ fetchImpl: customFetch, adminToken: TEST_ADMIN_TOKEN });
      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });

      const res = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.memoryUsedMb).toBe(2048);
      expect(res.json().data.memoryTotalMb).toBe(16384);
      await harness.app.close();
    });
  });

  describe('GET /mesh/status returns live routes', () => {
    it('returns mesh, containers, and routes', async () => {
      // Ensure models are bound to the database
      const { Model } = await import('objection');
      Model.knex(db);

      const customFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        console.log('[MESH STATUS MOCK]', init?.method || 'GET', url);
        if (url.endsWith('/agent/metrics')) {
          console.log('[MESH STATUS MOCK] MATCHED /agent/metrics');
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/mesh/status')) {
          console.log('[MESH STATUS MOCK] MATCHED /mesh/status');
          return new Response(
            JSON.stringify({
              nodeId: 'vps-node',
              meshIp: '10.144.0.1',
              cpuPercent: 4.5,
              memoryUsedMb: 1024,
              memoryTotalMb: 8192,
              runningApps: 2,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/containers') && (!init?.method || init.method === 'GET')) {
          console.log('[MESH STATUS MOCK] MATCHED /agent/containers');
          return new Response(
            JSON.stringify({
              containers: [
                { name: 'test-app', containerId: 'ctr-1', image: 'nginx', state: 'running', status: 'running', slug: 'test-app', managed: true },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              containers: [
                { name: 'test-app', containerId: 'ctr-1', image: 'nginx', state: 'running', status: 'running', slug: 'test-app', managed: true },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/agent/caddy/reconcile') && init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        console.log('[MESH STATUS MOCK] UNMATCHED', init?.method || 'GET', url);
        return new Response('{}', { status: 404 });
      };

      const harness = await buildApp({ fetchImpl: customFetch, adminToken: TEST_ADMIN_TOKEN });
      harness.setAuth({ userId: 2, role: 'superadmin', companyId: 1 });

      const res = await harness.app.inject({ method: 'GET', url: '/api/cloud/paas/mesh/status' });
      console.log('MESH STATUS RESPONSE:', res.statusCode, res.json());
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data).toHaveProperty('mesh');
      expect(res.json().data).toHaveProperty('containers');
      expect(res.json().data).toHaveProperty('routes');
      expect(res.json().data).toHaveProperty('previewListeners');
      expect(res.json().data.mesh).toHaveProperty('nodeId', 'vps-node');
      expect(Array.isArray(res.json().data.containers)).toBe(true);
      expect(Array.isArray(res.json().data.routes)).toBe(true);
      await harness.app.close();
    });
  });
});
