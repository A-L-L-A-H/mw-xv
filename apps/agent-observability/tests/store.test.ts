import { describe, expect, it } from 'vitest';
import { decodeLogs, decodeMetrics, decodeTraces } from '../src/otlp.js';
import { TelemetryStore } from '../src/store.js';
import { NOW_MS, TRACE_ID, logPayload, metricPayload, tracePayload } from './fixtures.js';

describe('TelemetryStore', () => {
  it('groups spans into traces and redacts stored telemetry', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    const traces = decodeTraces(tracePayload());
    const logs = decodeLogs(logPayload());
    store.ingestSpans(traces.spans);
    store.ingestLogs(logs.logs);

    const summary = store.listTraces()[0];
    expect(summary).toMatchObject({
      traceId: TRACE_ID,
      rootName: 'agent.run',
      durationMs: 250,
      spanCount: 2,
      errorCount: 1,
      runId: 'run-123',
      agentName: 'researcher',
      inputTokens: 840,
      outputTokens: 320,
      totalTokens: 1160,
      costUsd: 0.0042,
    });
    const detail = store.getTrace(TRACE_ID);
    expect(detail?.spans[1]?.attributes.password).toBe('[redacted]');
    expect(detail?.logs[0]?.body).toContain('Bearer [REDACTED]');
    expect(detail?.logs[0]?.attributes.api_key).toBe('[redacted]');
    expect(store.summary()).toMatchObject({
      traceCount: 1,
      spanCount: 2,
      errorCount: 1,
      logCount: 1,
      errorLogCount: 1,
      totalTokens: 1160,
    });
  });

  it('deduplicates span and log retransmissions', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    const spans = decodeTraces(tracePayload()).spans;
    const logs = decodeLogs(logPayload()).logs;
    store.ingestSpans(spans);
    store.ingestLogs(logs);
    const revision = store.revision;

    store.ingestSpans(spans);
    store.ingestLogs(logs);

    expect(store.summary()).toMatchObject({ spanCount: 2, logCount: 1, totalTokens: 1160 });
    expect(store.revision).toBe(revision);
  });

  it('rejects records that exceed the retained byte limit', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    const span = decodeTraces(tracePayload()).spans[0]!;
    const result = store.ingestSpans([
      { ...span, attributes: { ...span.attributes, payload: 'x'.repeat(40_000) } },
    ]);

    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(store.summary().spanCount).toBe(0);
  });

  it('filters traces and logs', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    store.ingestSpans(decodeTraces(tracePayload()).spans);
    store.ingestLogs(decodeLogs(logPayload()).logs);

    expect(store.listTraces({ status: 'error' })).toHaveLength(1);
    expect(store.listTraces({ status: 'ok' })).toHaveLength(0);
    expect(store.listTraces({ query: 'researcher' })).toHaveLength(1);
    expect(store.listTraces({ query: 'missing' })).toHaveLength(0);
    expect(store.listLogs({ severity: 'ERROR' })).toHaveLength(1);
    expect(store.listLogs({ severity: 'INFO' })).toHaveLength(0);
  });

  it('enforces item bounds and retention', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({
      maxSpans: 2,
      maxLogs: 1,
      retentionMs: 1_000,
      now: () => now,
    });
    const decoded = decodeTraces(tracePayload());
    const extra = {
      ...decoded.spans[0]!,
      spanId: '4444444444444444',
      startTimeMs: NOW_MS + 1,
      endTimeMs: NOW_MS + 2,
    };
    store.ingestSpans([...decoded.spans, extra, { ...extra, spanId: '5555555555555555' }]);
    expect(store.summary().spanCount).toBe(2);

    now += 2_000;
    store.ingestSpans([]);
    expect(store.summary().spanCount).toBe(0);
  });

  it('merges metric points by timestamp and bounds each series', () => {
    const store = new TelemetryStore({
      now: () => NOW_MS,
      maxMetricPoints: 2,
    });
    const decoded = decodeMetrics(metricPayload());
    store.ingestMetrics(decoded.metrics);
    const series = decoded.metrics[0]!;
    store.ingestMetrics([
      {
        ...series,
        points: [
          ...series.points,
          { timestampMs: NOW_MS + 300, value: 5, attributes: series.points[0]!.attributes },
          { timestampMs: NOW_MS + 400, value: 7, attributes: series.points[0]!.attributes },
        ],
      },
    ]);

    const stored = store.listMetrics({ query: 'agent.tool.calls' })[0];
    expect(stored?.points).toHaveLength(2);
    expect(stored?.points.at(-1)?.value).toBe(7);
    expect(store.summary().metricSeriesCount).toBe(2);
  });

  it('drops metrics outside the retention window', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({ retentionMs: 500, now: () => now });
    const decoded = decodeMetrics(metricPayload());
    decoded.metrics[0]!.points[0]!.timestampMs = NOW_MS - 1_000;
    store.ingestMetrics(decoded.metrics);
    expect(store.listMetrics({ query: 'agent.tool.calls' })).toHaveLength(0);

    now += 1_000;
    store.ingestMetrics([]);
    expect(store.summary().metricSeriesCount).toBe(0);
  });
});
