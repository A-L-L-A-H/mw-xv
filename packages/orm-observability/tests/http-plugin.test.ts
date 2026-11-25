import knexFactory, { type Knex } from 'knex';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it } from 'vitest';
import { installAddons } from '@moonwitness/orm';
import { MemoryTelemetryStore } from '../src/memory-store.js';
import { observabilityHttpPlugin } from '../src/http-plugin.js';
import { observabilityAddon } from '../src/manifest.js';
import type { TelemetryStore } from '../src/types.js';
import {
  NOW_MS,
  TRACE_ID,
  logPayload,
  metricPayload,
  nanos,
  tracePayload,
} from './otlp-fixtures.js';

const INGEST_TOKEN = 'observability-ingest-token-1234567890';
const JWT_SECRET = 'observability-test-jwt-secret-1234567890';
const apps: FastifyInstance[] = [];

interface HarnessOptions {
  token?: string;
  store?: TelemetryStore;
}

async function createHarness(options: HarnessOptions = {}) {
  const store = options.store ?? new MemoryTelemetryStore({ retentionMs: Number.MAX_SAFE_INTEGER });
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: JWT_SECRET });
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request, reply) => {
    const routeConfig = request.routeOptions.config as { public?: boolean } | undefined;
    if (
      request.method === 'OPTIONS' ||
      request.routeOptions.url === undefined ||
      routeConfig?.public === true
    ) {
      return;
    }
    try {
      const payload = await request.jwtVerify<{ sub: string; role: string }>();
      Object.assign(request, {
        auth: { userId: Number(payload.sub), role: payload.role },
      });
    } catch {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    return reply.code(statusCode).send({
      success: false,
      error:
        statusCode >= 500
          ? 'Internal server error'
          : error instanceof Error
            ? error.message
            : 'Request failed',
    });
  });
  await app.register(observabilityHttpPlugin as Parameters<FastifyInstance['register']>[0], {
    store,
    observabilityIngestToken: options.token ?? INGEST_TOKEN,
  });
  await app.ready();
  return {
    app,
    store,
    adminToken: app.jwt.sign({ sub: '1', role: 'superadmin' }),
    systemToken: app.jwt.sign({ sub: '2', role: 'system' }),
    userToken: app.jwt.sign({ sub: '3', role: 'user' }),
  };
}

function ingestHeaders(token = INGEST_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

function adminHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('observability addon HTTP plugin', () => {
  it('fails closed without configuration and requires the dedicated token on every ingest route', async () => {
    const unconfigured = await createHarness({ token: '' });
    for (const url of ['/v1/traces', '/v1/metrics', '/v1/logs', '/v1/qoder']) {
      const response = await unconfigured.app.inject({ method: 'POST', url, payload: {} });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        success: false,
        error: 'Observability ingest is not configured',
      });
    }

    const short = await createHarness({ token: 'too-short' });
    expect(
      (
        await short.app.inject({
          method: 'POST',
          url: '/v1/traces',
          payload: tracePayload(),
        })
      ).statusCode
    ).toBe(503);

    const { app } = await createHarness();
    for (const url of ['/v1/traces', '/v1/metrics', '/v1/logs', '/v1/qoder']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            payload: {},
            headers: ingestHeaders('wrong-token-wrong-token-wrong-token'),
          })
        ).statusCode
      ).toBe(401);
    }

    const bearer = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: tracePayload(),
      headers: ingestHeaders(),
    });
    expect(bearer.statusCode).toBe(200);
    expect(bearer.json()).toEqual({ partialSuccess: { rejectedSpans: '1' } });

    const alternate = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: logPayload(),
      headers: { 'x-observability-token': INGEST_TOKEN },
    });
    expect(alternate.statusCode).toBe(200);
    expect(alternate.json()).toEqual({});
  });

  it('returns bounded validation errors for invalid OTLP and Qoder payloads', async () => {
    const { app } = await createHarness();
    const cases = [
      ['/v1/traces', { resourceSpans: 'invalid' }, 'Invalid OTLP trace payload'],
      ['/v1/metrics', { resourceMetrics: {} }, 'Invalid OTLP metric payload'],
      ['/v1/logs', { resourceLogs: {} }, 'Invalid OTLP log payload'],
      ['/v1/qoder', { hook_event_name: 'SessionStart' }, 'Invalid Qoder hook payload'],
    ] as const;
    for (const [url, payload, error] of cases) {
      const response = await app.inject({
        method: 'POST',
        url,
        payload,
        headers: ingestHeaders(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ success: false, error });
    }

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      headers: { ...ingestHeaders(), 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().success).toBe(false);
    expect(malformed.json()).not.toHaveProperty('stack');
  });

  it('preserves partial success and serves canonical admin read envelopes without caching', async () => {
    const { app, adminToken, systemToken } = await createHarness();
    const headers = ingestHeaders();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/traces',
          payload: tracePayload(),
          headers,
        })
      ).json()
    ).toEqual({ partialSuccess: { rejectedSpans: '1' } });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/logs', payload: logPayload(), headers })).json()
    ).toEqual({});
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/metrics',
          payload: metricPayload(),
          headers,
        })
      ).json()
    ).toEqual({});

    const reads = [
      ['/api/observability/summary', ['traceCount', 'spanCount']],
      ['/api/observability/traces?status=error&query=researcher&limit=999999', ['traces']],
      [`/api/observability/traces/${TRACE_ID}`, ['spans', 'logs']],
      ['/api/observability/logs?severity=ERROR&limit=999999', ['logs']],
      ['/api/observability/metrics?query=tool&limit=999999', ['metrics']],
      ['/api/observability/config', ['protocol', 'endpoints']],
    ] as const;
    for (const [url, keys] of reads) {
      const response = await app.inject({ url, headers: adminHeaders(systemToken) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.json().success).toBe(true);
      for (const key of keys) expect(response.json().data).toHaveProperty(key);
    }

    const summary = await app.inject({
      url: '/api/observability/summary',
      headers: adminHeaders(adminToken),
    });
    expect(summary.json().data).toMatchObject({
      traceCount: 1,
      spanCount: 2,
      errorCount: 1,
      logCount: 1,
      metricSeriesCount: 2,
      totalTokens: 1160,
      costUsd: 0.0042,
      services: ['test-agent'],
    });
    const traces = await app.inject({
      url: '/api/observability/traces',
      headers: adminHeaders(adminToken),
    });
    expect(traces.json().data.traces).toHaveLength(1);
    const detail = await app.inject({
      url: `/api/observability/traces/${TRACE_ID}`,
      headers: adminHeaders(adminToken),
    });
    expect(detail.json().data.spans).toHaveLength(2);
    expect(detail.json().data.spans[1].attributes.password).toBe('[redacted]');
    const logs = await app.inject({
      url: '/api/observability/logs',
      headers: adminHeaders(adminToken),
    });
    expect(logs.json().data.logs[0].body).toContain('Bearer [REDACTED]');
    expect(logs.json().data.logs[0].attributes.api_key).toBe('[redacted]');

    const missing = await app.inject({
      url: '/api/observability/traces/missing',
      headers: adminHeaders(adminToken),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ success: false, error: 'Trace not found' });
    expect(missing.headers['cache-control']).toBe('private, no-store');
  });

  it('denies unauthenticated and non-admin reads while allowing Qoder hooks without JWT', async () => {
    const { app, adminToken, userToken } = await createHarness();
    const ingestCredentialRead = await app.inject({
      url: '/api/observability/summary',
      headers: ingestHeaders(),
    });
    expect(ingestCredentialRead.statusCode).toBe(401);
    for (const url of [
      '/api/observability/summary',
      '/api/observability/traces',
      `/api/observability/traces/${TRACE_ID}`,
      '/api/observability/logs',
      '/api/observability/metrics',
      '/api/observability/config',
    ]) {
      const unauthenticated = await app.inject({ url });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json()).toEqual({ success: false, error: 'Authentication required' });
      const denied = await app.inject({ url, headers: adminHeaders(userToken) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({
        success: false,
        error: 'Active company is required',
      });
      expect(denied.headers['cache-control']).toBe('private, no-store');
    }

    const headers = ingestHeaders();
    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/qoder',
      payload: {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-http',
        prompt: 'private prompt',
        agent_type: 'researcher',
      },
      headers,
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toEqual({ suppressOutput: true });
    const stopped = await app.inject({
      method: 'POST',
      url: '/v1/qoder',
      payload: {
        hook_event_name: 'Stop',
        session_id: 'session-http',
        last_assistant_message: 'private response',
      },
      headers,
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toEqual({ suppressOutput: true });
    const traces = await app.inject({
      url: '/api/observability/traces',
      headers: adminHeaders(adminToken),
    });
    expect(traces.json().data.traces[0]).toMatchObject({
      rootName: 'qoder.prompt',
      agentName: 'researcher',
    });
    expect(JSON.stringify(traces.json())).not.toContain('private prompt');
    expect(JSON.stringify(traces.json())).not.toContain('private response');
  });

  it('redacts structured log bodies before storage', async () => {
    const { app, adminToken } = await createHarness();
    await app.inject({
      method: 'POST',
      url: '/v1/logs',
      headers: ingestHeaders(),
      payload: {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: nanos(NOW_MS),
                    body: {
                      kvlistValue: {
                        values: [{ key: 'api_key', value: { stringValue: 'never-store-this' } }],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const response = await app.inject({
      url: '/api/observability/logs',
      headers: adminHeaders(adminToken),
    });
    expect(response.json().data.logs[0].body).toContain('[redacted]');
    expect(response.json().data.logs[0].body).not.toContain('never-store-this');
  });

  it('does not expose a standalone dashboard or its static assets', async () => {
    const { app } = await createHarness();
    for (const url of ['/', '/index.html', '/app.js', '/styles.css', '/favicon.svg']) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
  });

  it('uses the host Fastify database without destroying it when the addon closes', async () => {
    const db: Knex = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
    try {
      await installAddons(db, [observabilityAddon]);
      const app = Fastify({ logger: false });
      app.decorate('db', db);
      await app.register(observabilityHttpPlugin as Parameters<FastifyInstance['register']>[0], {
        observabilityIngestToken: INGEST_TOKEN,
      });
      await app.ready();
      const ingested = await app.inject({
        method: 'POST',
        url: '/v1/traces',
        payload: tracePayload(Date.now()),
        headers: ingestHeaders(),
      });
      expect(ingested.statusCode).toBe(200);
      await app.close();
      const state = await db('observability_state').where({ key: 'revision' }).first();
      expect(state).toMatchObject({ key: 'revision', value: 1 });
      expect(await db('observability_spans').count('* as count').first()).toMatchObject({
        count: 2,
      });
    } finally {
      await db.destroy();
    }
  });
});
