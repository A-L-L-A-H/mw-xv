import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { installAddons } from '@moonwitness/orm';
import { MemoryTelemetryStore } from '../src/memory-store.js';
import { observabilityAddon } from '../src/manifest.js';
import { SqlTelemetryStore } from '../src/sql-store.js';
import type { Page, TelemetryStore, TelemetryStoreOptions } from '../src/types.js';
import { makeLog, makePoint, makeSeries, makeSpan, NOW_MS } from './fixtures.js';

const implementations: Array<{
  name: string;
  create: (options?: TelemetryStoreOptions) => Promise<TelemetryStore>;
}> = [
  {
    name: 'memory',
    create: async (options = {}) => new MemoryTelemetryStore(options),
  },
  {
    name: 'sqlite',
    create: async (options = {}) => {
      const db = knexFactory({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: { min: 1, max: 1 },
      });
      try {
        await installAddons(db, [observabilityAddon]);
        return new SqlTelemetryStore(db, options);
      } catch (error) {
        await db.destroy();
        throw error;
      }
    },
  },
];

const postgresUrl = process.env.TELEMETRY_POSTGRES_TEST_URL;
if (postgresUrl) {
  implementations.push({
    name: 'postgresql',
    create: async (options = {}) => {
      const schema = `obs_${randomUUID().replaceAll('-', '')}`;
      const db = knexFactory({
        client: 'pg',
        connection: { connectionString: postgresUrl },
        pool: {
          min: 1,
          max: 4,
          afterCreate(connection: { query(sql: string, callback: (error: Error | null) => void): void }, done: (error: Error | null, connection: unknown) => void) {
            connection.query(`SET search_path TO "${schema}"`, (error) => done(error, connection));
          },
        },
      });
      try {
        await db.raw('CREATE SCHEMA ??', [schema]);
        await installAddons(db, [observabilityAddon]);
        return new SqlTelemetryStore(db, options);
      } catch (error) {
        await db.destroy();
        throw error;
      }
    },
  });
}

describe.each(implementations)('$name telemetry store', ({ create }) => {
  const stores: TelemetryStore[] = [];

  async function makeStore(options: TelemetryStoreOptions = {}): Promise<TelemetryStore> {
    const store = await create(options);
    stores.push(store);
    return store;
  }

  afterEach(async () => {
    while (stores.length > 0) await stores.pop()!.close();
  });

  it('exposes resolved limits, an async revision, and an empty summary', async () => {
    const store = await makeStore();
    expect(store.limits).toEqual({
      maxSpans: 5_000,
      maxLogs: 5_000,
      maxMetricSeries: 1_000,
      maxMetricPoints: 120,
      retentionMs: 3_600_000,
    });
    expect('revision' in store).toBe(false);
    expect(await store.getRevision()).toBe(0);
    expect(await store.summary()).toEqual({
      status: 'ok',
      revision: 0,
      traceCount: 0,
      spanCount: 0,
      errorCount: 0,
      logCount: 0,
      errorLogCount: 0,
      metricSeriesCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      services: [],
    });
  });

  it('redacts records and preserves trace, log, metric, and summary queries', async () => {
    const store = await makeStore({ now: () => NOW_MS });
    const root = makeSpan({
      agentName: 'researcher',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.25,
      endTimeMs: NOW_MS + 250,
      durationMs: 250,
      attributes: { password: 'do-not-store', nested: '{"api_key":"secret-value"}' },
    });
    const child = makeSpan({
      spanId: 'span-2',
      parentSpanId: 'span-1',
      name: 'tool.search',
      kind: 'client',
      status: 'error',
      startTimeMs: NOW_MS + 50,
      endTimeMs: NOW_MS + 200,
      durationMs: 150,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      costUsd: 0.05,
    });
    const log = makeLog({
      severity: 'ERROR',
      body: 'Provider failed with Bearer abcdef123456',
      attributes: { api_key: 'sk-test-12345678901234567890' },
    });
    const series = makeSeries();

    expect(await store.ingestSpans([root, child])).toEqual({ accepted: 2, rejected: 0 });
    expect(await store.ingestLogs([log])).toEqual({ accepted: 1, rejected: 0 });
    expect(await store.ingestMetrics([series])).toEqual({ accepted: 1, rejected: 0 });

    const traces = await store.listTraces({ query: '  RESEARCHER  ' });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceId: 'trace-1',
      rootName: 'agent.run',
      startedAt: NOW_MS,
      durationMs: 250,
      spanCount: 2,
      errorCount: 1,
      serviceNames: ['agent-service'],
      runId: 'run-1',
      agentName: 'researcher',
      inputTokens: 120,
      outputTokens: 60,
      totalTokens: 180,
      costUsd: 0.3,
    });
    expect(await store.listTraces({ status: 'error' })).toHaveLength(1);
    expect(await store.listTraces({ status: 'ok' })).toHaveLength(0);
    expect(await store.listTraces({ query: 'missing' })).toHaveLength(0);

    const detail = await store.getTrace('trace-1');
    expect(detail?.spans.map((span) => span.spanId)).toEqual(['span-1', 'span-2']);
    expect(detail?.spans[0]?.attributes.password).toBe('[redacted]');
    expect(detail?.spans[0]?.attributes.nested).toBe('{"api_key":"[redacted]"}');
    expect(detail?.logs[0]?.body).toContain('Bearer [REDACTED]');
    expect(detail?.logs[0]?.attributes.api_key).toBe('[redacted]');
    expect(await store.getTrace('missing')).toBeUndefined();

    expect(await store.listLogs({ severity: 'error' })).toHaveLength(1);
    expect(await store.listLogs({ severity: 'ALL' })).toHaveLength(1);
    expect(await store.listLogs({ severity: 'INFO' })).toHaveLength(0);
    expect(await store.listLogs({ query: 'bearer [redacted]' })).toHaveLength(1);
    expect(await store.listMetrics({ query: 'TOOL CALLS' })).toHaveLength(1);
    expect(await store.listMetrics({ query: 'missing' })).toHaveLength(0);

    expect(await store.summary()).toEqual({
      status: 'ok',
      revision: 3,
      traceCount: 1,
      spanCount: 2,
      errorCount: 1,
      logCount: 1,
      errorLogCount: 1,
      metricSeriesCount: 1,
      inputTokens: 120,
      outputTokens: 60,
      totalTokens: 180,
      costUsd: 0.3,
      avgLatencyMs: 200,
      services: ['agent-service'],
      lastEventAt: new Date(NOW_MS + 250).toISOString(),
    });
  });

  it('deduplicates retransmissions without revising and revises actual point replacements', async () => {
    const store = await makeStore({ now: () => NOW_MS });
    const span = makeSpan();
    const log = makeLog();
    const series = makeSeries();
    await store.ingestSpans([span]);
    await store.ingestLogs([log]);
    await store.ingestMetrics([series]);
    expect(await store.getRevision()).toBe(3);

    expect(await store.ingestSpans([{ ...span, name: 'ignored duplicate' }])).toEqual({
      accepted: 1,
      rejected: 0,
    });
    expect(await store.ingestLogs([{ ...log, body: 'ignored duplicate' }])).toEqual({
      accepted: 1,
      rejected: 0,
    });
    expect(await store.ingestMetrics([series])).toEqual({ accepted: 1, rejected: 0 });
    expect(await store.getRevision()).toBe(3);

    expect(await store.ingestMetrics([{ ...series, points: [makePoint({ value: 2 })] }])).toEqual({
      accepted: 1,
      rejected: 0,
    });
    expect(await store.getRevision()).toBe(4);
    expect((await store.listMetrics())[0]?.points[0]?.value).toBe(2);
  });

  it('prunes expired spans, logs, and metric points and bumps revision once', async () => {
    let now = NOW_MS;
    const store = await makeStore({ retentionMs: 1_000, now: () => now });
    await store.ingestSpans([makeSpan()]);
    await store.ingestLogs([makeLog()]);
    await store.ingestMetrics([makeSeries()]);
    expect(await store.getRevision()).toBe(3);

    now += 1_101;
    expect(await store.ingestSpans([])).toEqual({ accepted: 0, rejected: 0 });
    expect(await store.getRevision()).toBe(4);
    expect(await store.summary()).toMatchObject({
      spanCount: 0,
      logCount: 0,
      metricSeriesCount: 0,
    });

    await store.ingestLogs([makeLog({ timestampMs: now })]);
    now += 1_000;
    await store.ingestMetrics([]);
    expect((await store.listLogs()).length).toBe(1);
    now += 1;
    await store.ingestMetrics([]);
    expect((await store.listLogs()).length).toBe(0);
  });

  it('derives tenant attribution from ingest context and isolates every read path', async () => {
    const store = await makeStore({ now: () => NOW_MS });
    const forged = makeSpan({ tenantId: 999 });
    await store.ingestSpans([forged], { tenantId: 7 });
    await store.ingestSpans([forged], { tenantId: 8 });
    await store.ingestLogs([makeLog({ tenantId: 999 })], { tenantId: 7 });
    await store.ingestMetrics([makeSeries({ tenantId: 999 })], { tenantId: 7 });
    const scope = { global: false, tenantId: 7 };
    expect((await store.listTraces({ scope })).map((trace) => trace.tenantId)).toEqual([7]);
    expect((await store.getTrace(forged.traceId, { scope }))?.spans[0]?.tenantId).toBe(7);
    expect((await store.listLogs({ scope }))[0]?.tenantId).toBe(7);
    expect((await store.listMetrics({ scope }))[0]?.tenantId).toBe(7);
    expect(await store.summary(scope)).toMatchObject({ traceCount: 1, spanCount: 1, logCount: 1, metricSeriesCount: 1 });
    expect(await store.summary({ global: false, tenantId: 9 })).toMatchObject({ traceCount: 0, spanCount: 0, logCount: 0, metricSeriesCount: 0 });
    expect(await store.getTrace(forged.traceId, { scope: { global: false, tenantId: 9 } })).toBeUndefined();
    expect(await store.summary({ global: true })).toMatchObject({ traceCount: 2, spanCount: 2 });
    const first = await store.listTraces({ limit: 1 });
    const second = await store.listTraces({ limit: 1, cursor: first.nextCursor });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((trace) => trace.tenantId))).toEqual(new Set([7, 8]));
  });

  it('paginates descending lists and ascending trace details without duplicates', async () => {
    const store = await makeStore({ now: () => NOW_MS });
    await store.ingestSpans(['c', 'a', 'b'].map((spanId) => makeSpan({ spanId, traceId: `trace-${spanId}` })));
    await store.ingestLogs(['c', 'a', 'b'].map((id) => makeLog({ id, traceId: `trace-${id}` })));
    await store.ingestMetrics(['c', 'a', 'b'].map((id) => makeSeries({ id })));
    async function collect<T>(read: (cursor?: string) => Promise<Page<T>>) {
      const first = await read();
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();
      const second = await read(first.nextCursor);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeUndefined();
      expect(new Set([...first.items, ...second.items]).size).toBe(3);
    }
    await collect((cursor) => store.listTraces({ limit: 2, cursor }));
    await collect((cursor) => store.listLogs({ limit: 2, cursor }));
    await collect((cursor) => store.listMetrics({ limit: 2, cursor }));
    await store.ingestSpans(['c', 'a', 'b'].map((spanId) => makeSpan({ traceId: 'detail', spanId })));
    await store.ingestLogs(['c', 'a', 'b'].map((id) => makeLog({ id: `detail-${id}`, traceId: 'detail' })));
    const first = await store.getTrace('detail', { spanLimit: 2, logLimit: 2 });
    expect(first?.spans.items.map((span) => span.spanId)).toEqual(['a', 'b']);
    expect(first?.logs.items.map((log) => log.id)).toEqual(['detail-a', 'detail-b']);
    const second = await store.getTrace('detail', { spanCursor: first?.spans.nextCursor, logCursor: first?.logs.nextCursor });
    expect(second?.spans.items.map((span) => span.spanId)).toEqual(['c']);
    expect(second?.logs.items.map((log) => log.id)).toEqual(['detail-c']);
  });

  it('retains trace projections when only an old child span expires', async () => {
    let now = NOW_MS;
    const store = await makeStore({ retentionMs: 1_000, now: () => now });
    await store.ingestSpans([
      makeSpan({ spanId: 'old-child', parentSpanId: 'root', startTimeMs: NOW_MS - 2_000, endTimeMs: NOW_MS - 1_500, durationMs: 500 }),
      makeSpan({ spanId: 'root', startTimeMs: NOW_MS, endTimeMs: NOW_MS + 100, durationMs: 100 }),
    ]);
    now += 1_001;
    await store.pruneExpired?.();
    expect(await store.getTrace('trace-1')).toMatchObject({ summary: { spanCount: 1 }, spans: { items: [{ spanId: 'root' }] } });
    expect(await store.summary()).toMatchObject({ traceCount: 1, spanCount: 1 });
  });

  it('enforces item, series, and latest-point limits with current eviction accounting', async () => {
    const store = await makeStore({
      now: () => NOW_MS,
      maxSpans: 2,
      maxLogs: 1,
      maxMetricSeries: 2,
      maxMetricPoints: 2,
    });
    const spans = [1, 2, 3].map((index) => makeSpan({ spanId: `span-${index}` }));
    expect(await store.ingestSpans(spans)).toEqual({ accepted: 2, rejected: 1 });
    expect(await store.ingestSpans(spans)).toEqual({ accepted: 2, rejected: 1 });

    const logs = [1, 2].map((index) => makeLog({ id: `log-${index}` }));
    expect(await store.ingestLogs(logs)).toEqual({ accepted: 1, rejected: 1 });

    const first = makeSeries({
      id: 'first',
      points: [makePoint({ timestampMs: NOW_MS + 300 })],
    });
    const second = makeSeries({
      id: 'second',
      points: [makePoint({ timestampMs: NOW_MS + 100 })],
    });
    const third = makeSeries({
      id: 'third',
      points: [makePoint({ timestampMs: NOW_MS + 200 })],
    });
    expect(
      await store.ingestMetrics([
        {
          ...first,
          points: [
            makePoint(),
            makePoint({ timestampMs: NOW_MS + 1 }),
            makePoint({ timestampMs: NOW_MS + 2 }),
          ],
        },
      ])
    ).toEqual({ accepted: 2, rejected: 1 });
    expect(await store.ingestMetrics([second, third])).toEqual({ accepted: 2, rejected: 2 });
    expect((await store.listMetrics()).map((series) => series.id)).toEqual(['third', 'second']);
    expect(await store.getRevision()).toBe(4);
    expect((await store.summary()).spanCount).toBe(2);
    expect((await store.summary()).logCount).toBe(1);
  });

  it('merges points by timestamp, sorts them, and drops only the oldest overflow', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxMetricPoints: 3 });
    await store.ingestMetrics([
      makeSeries({ points: [makePoint({ timestampMs: NOW_MS + 2, value: 2 })] }),
    ]);
    expect(
      await store.ingestMetrics([
        makeSeries({
          points: [
            makePoint({ timestampMs: NOW_MS + 1, value: 1 }),
            makePoint({ timestampMs: NOW_MS, value: 9 }),
          ],
        }),
      ])
    ).toEqual({ accepted: 2, rejected: 0 });
    expect((await store.listMetrics())[0]?.points.map((point) => point.timestampMs)).toEqual([
      NOW_MS,
      NOW_MS + 1,
      NOW_MS + 2,
    ]);

    expect(
      await store.ingestMetrics([
        makeSeries({ points: [makePoint({ timestampMs: NOW_MS + 3, value: 3 })] }),
      ])
    ).toEqual({ accepted: 1, rejected: 1 });
    const points = (await store.listMetrics())[0]?.points;
    expect(points?.map((point) => point.timestampMs)).toEqual([NOW_MS + 1, NOW_MS + 2, NOW_MS + 3]);
  });

  it('rejects oversized records, points, and metric series without revising', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxMetricPoints: 20 });
    expect(
      await store.ingestSpans([makeSpan({ attributes: { payload: 'x'.repeat(40_000) } })])
    ).toEqual({ accepted: 0, rejected: 1 });
    expect(await store.ingestLogs([makeLog({ body: 'x'.repeat(40_000) })])).toEqual({
      accepted: 0,
      rejected: 1,
    });
    expect(
      await store.ingestMetrics([
        makeSeries({ points: [makePoint({ attributes: { payload: 'x'.repeat(40_000) } })] }),
      ])
    ).toEqual({ accepted: 0, rejected: 1 });

    const points = Array.from({ length: 9 }, (_, index) =>
      makePoint({
        timestampMs: NOW_MS + index,
        attributes: { payload: 'x'.repeat(30_000) },
      })
    );
    expect(await store.ingestMetrics([makeSeries({ points })])).toEqual({
      accepted: 0,
      rejected: 9,
    });
    expect(await store.getRevision()).toBe(0);
  });

  it('defaults query limits to 100 and caps explicit limits at 500', async () => {
    const store = await makeStore({ now: () => NOW_MS });
    const logs = Array.from({ length: 505 }, (_, index) =>
      makeLog({ id: `log-${index}`, timestampMs: NOW_MS + index })
    );
    expect(await store.ingestLogs(logs)).toEqual({ accepted: 505, rejected: 0 });
    expect(await store.listLogs()).toHaveLength(100);
    expect(await store.listLogs({ limit: 0 })).toHaveLength(100);
    expect(await store.listLogs({ limit: 10_000 })).toHaveLength(500);
    expect((await store.listLogs({ limit: 1 }))[0]?.timestampMs).toBe(NOW_MS + 504);
  });
});
