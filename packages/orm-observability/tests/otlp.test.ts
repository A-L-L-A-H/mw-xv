import { describe, expect, it } from 'vitest';
import { decodeLogs, decodeMetrics, decodeTraces } from '../src/otlp.js';
import {
  CHILD_SPAN_ID,
  NOW_MS,
  ROOT_SPAN_ID,
  TRACE_ID,
  logPayload,
  metricPayload,
  tracePayload,
} from './otlp-fixtures.js';

describe('OTLP JSON decoding', () => {
  it('decodes resource spans, attributes, events, status, and usage', () => {
    const decoded = decodeTraces(tracePayload());

    expect(decoded.valid).toBe(true);
    expect(decoded.spans).toHaveLength(2);
    expect(decoded.rejected).toBe(1);
    expect(decoded.spans[0]).toMatchObject({
      traceId: TRACE_ID,
      spanId: ROOT_SPAN_ID,
      name: 'agent.run',
      serviceName: 'test-agent',
      scopeName: 'test-scope',
      status: 'ok',
      startTimeMs: NOW_MS,
      endTimeMs: NOW_MS + 250,
      durationMs: 250,
      runId: 'run-123',
      agentName: 'researcher',
    });
    expect(decoded.spans[0]?.attributes['custom.labels']).toEqual(['alpha', 2]);
    expect(decoded.spans[0]?.events[0]).toEqual({
      name: 'agent.started',
      timestampMs: NOW_MS + 10,
      attributes: { attempt: 1 },
    });
    expect(decoded.spans[1]).toMatchObject({
      parentSpanId: ROOT_SPAN_ID,
      status: 'error',
      statusMessage: 'tool failed',
      durationMs: 70,
      toolName: 'workspace.search',
      inputTokens: 840,
      outputTokens: 320,
      totalTokens: 1160,
      costUsd: 0.0042,
    });
  });

  it('rejects invalid top-level trace payloads', () => {
    expect(decodeTraces(null).valid).toBe(false);
    expect(decodeTraces({ resourceSpans: 'invalid' }).valid).toBe(false);
    expect(decodeTraces({})).toEqual({ valid: true, spans: [], rejected: 0 });
  });

  it('decodes correlated logs and severity', () => {
    const decoded = decodeLogs(logPayload());

    expect(decoded.valid).toBe(true);
    expect(decoded.rejected).toBe(0);
    expect(decoded.logs[0]).toMatchObject({
      timestampMs: NOW_MS + 201,
      serviceName: 'test-agent',
      severity: 'ERROR',
      traceId: TRACE_ID,
      spanId: CHILD_SPAN_ID,
      runId: 'run-123',
    });
    expect(decoded.logs[0]?.body).toContain('Bearer [REDACTED]');
  });

  it('redacts structured log bodies before serialization', () => {
    const payload = logPayload();
    const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]! as unknown as {
      body: unknown;
    };
    record.body = {
      kvlistValue: {
        values: [
          { key: 'api_key', value: { stringValue: 'structured-secret' } },
          { key: 'message', value: { stringValue: 'safe message' } },
        ],
      },
    };

    const decoded = decodeLogs(payload);
    expect(decoded.logs[0]?.body).toContain('[redacted]');
    expect(decoded.logs[0]?.body).not.toContain('structured-secret');
  });

  it('does not silently truncate large OTLP batches', () => {
    const decoded = decodeTraces({ resourceSpans: Array.from({ length: 10_001 }, () => null) });
    expect(decoded.valid).toBe(true);
    expect(decoded.spans).toHaveLength(0);
    expect(decoded.rejected).toBe(10_001);
  });

  it('rejects metric integers that cannot be represented safely', () => {
    const payload = metricPayload();
    payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.sum!.dataPoints[0]!.asInt =
      '9007199254740993';

    const decoded = decodeMetrics(payload);
    expect(decoded.rejected).toBe(1);
    expect(decoded.metrics.map((metric) => metric.name)).toEqual(['agent.run.duration']);
  });

  it('decodes sums and histograms into stable metric series', () => {
    const decoded = decodeMetrics(metricPayload());

    expect(decoded.valid).toBe(true);
    expect(decoded.rejected).toBe(0);
    expect(decoded.metrics).toHaveLength(2);
    expect(decoded.metrics[0]).toMatchObject({
      name: 'agent.tool.calls',
      type: 'sum',
      serviceName: 'test-agent',
      unit: '1',
    });
    expect(decoded.metrics[0]?.points[0]).toMatchObject({
      timestampMs: NOW_MS + 100,
      value: 3,
      attributes: { 'tool.name': 'workspace.search' },
    });
    expect(decoded.metrics[1]?.points[0]).toMatchObject({
      count: 2,
      sum: 540,
      min: 120,
      max: 420,
    });
    expect(decodeMetrics(metricPayload()).metrics.map((metric) => metric.id)).toEqual(
      decoded.metrics.map((metric) => metric.id)
    );
  });

  it('rejects invalid metric and log envelopes', () => {
    expect(decodeMetrics([]).valid).toBe(false);
    expect(decodeLogs({ resourceLogs: {} }).valid).toBe(false);
  });
});
