import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { TelemetryStore } from '../src/store.js';
import { NOW_MS, TRACE_ID, logPayload, metricPayload, tracePayload } from './fixtures.js';

const apps: Array<ReturnType<typeof buildApp>['app']> = [];

function createApp() {
  const store = new TelemetryStore({ now: () => NOW_MS });
  const result = buildApp({ store });
  apps.push(result.app);
  return result;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('agent observability HTTP app', () => {
  it('ingests OTLP traces, logs, and metrics and exposes dashboard APIs', async () => {
    const { app } = createApp();
    const traceResponse = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: tracePayload(),
    });
    expect(traceResponse.statusCode).toBe(200);
    expect(traceResponse.json()).toEqual({
      partialSuccess: { rejectedSpans: '1' },
    });

    const logResponse = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: logPayload(),
    });
    expect(logResponse.statusCode).toBe(200);
    expect(logResponse.json()).toEqual({});

    const metricResponse = await app.inject({
      method: 'POST',
      url: '/v1/metrics',
      payload: metricPayload(),
    });
    expect(metricResponse.statusCode).toBe(200);
    expect(metricResponse.json()).toEqual({});

    const summaryResponse = await app.inject('/api/summary');
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({
      status: 'ok',
      traceCount: 1,
      spanCount: 2,
      errorCount: 1,
      logCount: 1,
      metricSeriesCount: 2,
      totalTokens: 1160,
      costUsd: 0.0042,
      services: ['test-agent'],
    });

    const tracesResponse = await app.inject('/api/traces?status=error&query=researcher');
    expect(tracesResponse.json().traces).toHaveLength(1);

    const detailResponse = await app.inject(`/api/traces/${TRACE_ID}`);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().spans).toHaveLength(2);
    expect(detailResponse.json().spans[1].attributes.password).toBe('[redacted]');

    const logsResponse = await app.inject('/api/logs?severity=ERROR');
    expect(logsResponse.json().logs).toHaveLength(1);
    expect(logsResponse.json().logs[0].body).toContain('[REDACTED]');

    const metricsResponse = await app.inject('/api/metrics?query=tool');
    expect(metricsResponse.json().metrics).toHaveLength(1);
    expect(metricsResponse.json().metrics[0].points[0].value).toBe(3);
  });

  it('redacts structured log bodies in stored dashboard output', async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: {
        resourceLogs: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'structured-agent' } }],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(BigInt(NOW_MS) * 1_000_000n),
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

    expect(response.statusCode).toBe(200);
    const logs = await app.inject('/api/logs');
    expect(logs.json().logs[0].body).toContain('[redacted]');
    expect(logs.json().logs[0].body).not.toContain('never-store-this');
  });

  it('returns safe errors for malformed OTLP payloads and missing traces', async () => {
    const { app } = createApp();
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: { resourceSpans: 'invalid' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('Invalid OTLP trace payload');

    const malformedJson = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).not.toHaveProperty('stack');

    const missing = await app.inject('/api/traces/missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('Trace not found');
  });

  it('accepts Qoder hooks and exposes their metadata through the dashboard APIs', async () => {
    const { app } = createApp();
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/qoder',
      payload: { hook_event_name: 'SessionStart' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('Invalid Qoder hook payload');

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/qoder',
      payload: {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-http',
        prompt: 'private prompt',
        agent_type: 'researcher',
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ suppressOutput: true });

    const stopped = await app.inject({
      method: 'POST',
      url: '/v1/qoder',
      payload: {
        hook_event_name: 'Stop',
        session_id: 'session-http',
        last_assistant_message: 'private response',
      },
    });
    expect(stopped.statusCode).toBe(200);

    const summary = await app.inject('/api/summary');
    expect(summary.json()).toMatchObject({ traceCount: 1, services: ['qoder'] });
    const traces = await app.inject('/api/traces');
    expect(traces.json().traces[0]).toMatchObject({ rootName: 'qoder.prompt' });
    expect(JSON.stringify(traces.json())).not.toContain('private prompt');
    expect(JSON.stringify(traces.json())).not.toContain('private response');
  });

  it('serves the dashboard with restrictive security headers', async () => {
    const { app } = createApp();
    const response = await app.inject('/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.body).toContain('AgentScope');
    expect(response.body).toContain('/app.js');
    expect(response.body).toContain('data-view="flow"');
    expect(response.body).toContain('id="flowView"');

    const script = await app.inject('/app.js');
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body).toContain('function renderFlow()');
    expect(script.body).toContain('function buildFlowLayout(');
  });

  it('reports health and receiver configuration', async () => {
    const { app } = createApp();
    const health = await app.inject('/healthz');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', revision: 0 });

    const config = await app.inject('/api/config');
    expect(config.json()).toMatchObject({
      protocol: 'OTLP/HTTP JSON',
      endpoints: {
        traces: '/v1/traces',
        metrics: '/v1/metrics',
        logs: '/v1/logs',
      },
      integrations: { qoderHooks: '/v1/qoder' },
      maxSpans: 5_000,
    });
  });
});
