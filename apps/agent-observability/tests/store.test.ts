import { describe, expect, it } from 'vitest';
import { decodeLogs, decodeMetrics, decodeTraces } from '../src/otlp.js';
import { MemoryTelemetryStore } from '../src/store.js';
import { NOW_MS, TRACE_ID, logPayload, metricPayload, tracePayload } from './fixtures.js';

describe('TelemetryStore', () => {
  it('groups spans into traces and redacts stored telemetry', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const traces = decodeTraces(tracePayload());
    const logs = decodeLogs(logPayload());
    await store.ingestSpans(traces.spans);
    await store.ingestLogs(logs.logs);

    const summary = (await store.listTraces())[0];
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
    const detail = await store.getTrace(TRACE_ID);
    expect(detail?.spans[1]?.attributes.password).toBe('[redacted]');
    expect(detail?.logs[0]?.body).toContain('Bearer [REDACTED]');
    expect(detail?.logs[0]?.attributes.api_key).toBe('[redacted]');
    expect(await store.summary()).toMatchObject({
      traceCount: 1,
      spanCount: 2,
      errorCount: 1,
      logCount: 1,
      errorLogCount: 1,
      totalTokens: 1160,
    });
  });

  it('deduplicates span and log retransmissions', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const spans = decodeTraces(tracePayload()).spans;
    const logs = decodeLogs(logPayload()).logs;
    await store.ingestSpans(spans);
    await store.ingestLogs(logs);
    const revision = await store.getRevision();

    await store.ingestSpans(spans);
    await store.ingestLogs(logs);

    expect(await store.summary()).toMatchObject({ spanCount: 2, logCount: 1, totalTokens: 1160 });
    expect(await store.getRevision()).toBe(revision);
  });

  it('rejects records that exceed the retained byte limit', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const span = decodeTraces(tracePayload()).spans[0]!;
    const result = await store.ingestSpans([
      { ...span, attributes: { ...span.attributes, payload: 'x'.repeat(40_000) } },
    ]);

    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect((await store.summary()).spanCount).toBe(0);
  });

  it('filters traces and logs', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    await store.ingestSpans(decodeTraces(tracePayload()).spans);
    await store.ingestLogs(decodeLogs(logPayload()).logs);

    expect(await store.listTraces({ status: 'error' })).toHaveLength(1);
    expect(await store.listTraces({ status: 'ok' })).toHaveLength(0);
    expect(await store.listTraces({ query: 'researcher' })).toHaveLength(1);
    expect(await store.listTraces({ query: 'missing' })).toHaveLength(0);
    expect(await store.listLogs({ severity: 'ERROR' })).toHaveLength(1);
    expect(await store.listLogs({ severity: 'INFO' })).toHaveLength(0);
  });

  it('enforces item bounds and retention', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({
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
    await store.ingestSpans([...decoded.spans, extra, { ...extra, spanId: '5555555555555555' }]);
    expect((await store.summary()).spanCount).toBe(2);

    now += 2_000;
    await store.ingestSpans([]);
    expect((await store.summary()).spanCount).toBe(0);
  });

  it('merges metric points by timestamp and bounds each series', async () => {
    const store = new MemoryTelemetryStore({
      now: () => NOW_MS,
      maxMetricPoints: 2,
    });
    const decoded = decodeMetrics(metricPayload());
    await store.ingestMetrics(decoded.metrics);
    const series = decoded.metrics[0]!;
    await store.ingestMetrics([
      {
        ...series,
        points: [
          ...series.points,
          { timestampMs: NOW_MS + 300, value: 5, attributes: series.points[0]!.attributes },
          { timestampMs: NOW_MS + 400, value: 7, attributes: series.points[0]!.attributes },
        ],
      },
    ]);

    const stored = (await store.listMetrics({ query: 'agent.tool.calls' }))[0];
    expect(stored?.points).toHaveLength(2);
    expect(stored?.points.at(-1)?.value).toBe(7);
    expect((await store.summary()).metricSeriesCount).toBe(2);
  });

  it('drops metrics outside the retention window', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({ now: () => now, retentionMs: 500 });
    const decoded = decodeMetrics(metricPayload());
    decoded.metrics[0]!.points[0]!.timestampMs = NOW_MS - 1_000;
    await store.ingestMetrics(decoded.metrics);
    expect(await store.listMetrics({ query: 'agent.tool.calls' })).toHaveLength(0);

    now += 1_000;
    await store.ingestMetrics([]);
    expect((await store.summary()).metricSeriesCount).toBe(0);
  });
});
