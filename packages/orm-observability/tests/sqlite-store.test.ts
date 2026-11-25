import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { installAddons, introspectDatabaseSchema } from '@moonwitness/orm';
import { observabilityAddon } from '../src/manifest.js';
import {
  TelemetryLog,
  TelemetryMetricPoint,
  TelemetryMetricSeries,
  TelemetrySpan,
  TelemetryState,
} from '../src/models.js';
import { SqlTelemetryStore } from '../src/sql-store.js';
import { createSqliteTelemetryStore } from '../src/sqlite.js';
import type { MetricSeries, SpanRecord } from '../src/types.js';
import { makeLog, makePoint, makeSeries, makeSpan, NOW_MS } from './fixtures.js';

const temporaryDirectories: string[] = [];

async function createDatabase() {
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  try {
    await installAddons(db, [observabilityAddon]);
    return db;
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('SQLite telemetry persistence', () => {
  it('creates parent directories and preserves all data and revision across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mw-observability-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'nested', 'telemetry.sqlite');
    let store = await createSqliteTelemetryStore({ filename, now: () => NOW_MS });
    try {
      await store.ingestSpans([makeSpan({ attributes: { password: 'restart-secret' } })]);
      await store.ingestLogs([makeLog()]);
      await store.ingestMetrics([makeSeries()]);
      const before = await store.summary();
      const beforeDetail = await store.getTrace('trace-1');
      expect(before.revision).toBe(3);
      await store.close();

      expect((await stat(filename)).isFile()).toBe(true);
      store = await createSqliteTelemetryStore({ filename, now: () => NOW_MS });
      expect(await store.summary()).toEqual(before);
      expect(await store.getTrace('trace-1')).toEqual(beforeDetail);
      expect((await store.listMetrics())[0]?.points).toHaveLength(1);
      expect(await store.ingestSpans([makeSpan()])).toEqual({ accepted: 1, rejected: 0 });
      expect(await store.getRevision()).toBe(3);
      await store.ingestLogs([makeLog({ id: 'log-after-restart' })]);
      expect(await store.getRevision()).toBe(4);
    } finally {
      await store.close();
    }
  });

  it('installs the addon tables, ORM unique constraints, indexes, and revision state idempotently', async () => {
    const db = await createDatabase();
    const store = new SqlTelemetryStore(db, { now: () => NOW_MS });
    try {
      expect(observabilityAddon).toMatchObject({ name: 'observability', version: '1.0.0' });
      expect(observabilityAddon.depends).toEqual([]);
      for (const table of [
        TelemetrySpan.tableName,
        TelemetryLog.tableName,
        TelemetryMetricSeries.tableName,
        TelemetryMetricPoint.tableName,
        TelemetryState.tableName,
      ]) {
        expect(await db.schema.hasTable(table)).toBe(true);
      }
      await installAddons(db, [observabilityAddon]);

      const snapshots = await introspectDatabaseSchema(db, [
        TelemetrySpan.tableName,
        TelemetryLog.tableName,
        TelemetryMetricSeries.tableName,
        TelemetryMetricPoint.tableName,
        TelemetryState.tableName,
      ]);
      const expectedUniques = new Map([
        [TelemetrySpan.tableName, ['trace_id', 'span_id']],
        [TelemetryLog.tableName, ['log_id']],
        [TelemetryMetricSeries.tableName, ['series_id']],
        [TelemetryMetricPoint.tableName, ['series_id', 'timestamp_ms']],
        [TelemetryState.tableName, ['key']],
      ]);
      for (const [table, columns] of expectedUniques) {
        const snapshot = snapshots.get(table)!;
        expect(
          snapshot.indexes.some(
            (index) =>
              index.unique &&
              index.columns.length === columns.length &&
              index.columns.every((column, index) => column === columns[index])
          )
        ).toBe(true);
      }
      expect(
        snapshots
          .get(TelemetrySpan.tableName)!
          .indexes.some((index) => index.name === 'observability_spans_trace_lookup_idx')
      ).toBe(true);
      expect(
        snapshots
          .get(TelemetryMetricSeries.tableName)!
          .indexes.some((index) => index.name === 'observability_metric_series_recency_idx')
      ).toBe(true);
      expect(await db(TelemetryState.tableName).where({ key: 'revision' }).first()).toMatchObject({
        value: 0,
      });
      expect(await db('_orm_addons').where({ name: 'observability' }).first()).toMatchObject({
        version: '1.0.0',
        status: 'installed',
      });
    } finally {
      await store.close();
    }
  });

  it('stores only redacted JSON payloads and keeps metric point rows synchronized', async () => {
    const db = await createDatabase();
    const store = new SqlTelemetryStore(db, { now: () => NOW_MS });
    try {
      await store.ingestSpans([
        makeSpan({ attributes: { password: 'span-secret', note: 'Bearer abcdef123456' } }),
      ]);
      await store.ingestLogs([
        makeLog({ body: 'Token abcdef123456', attributes: { api_key: 'log-secret' } }),
      ]);
      await store.ingestMetrics([
        makeSeries({ points: [makePoint({ attributes: { secret: 'point-secret' } })] }),
      ]);

      const span = await db(TelemetrySpan.tableName).first('payload_json');
      const log = await db(TelemetryLog.tableName).first('payload_json');
      const series = await db(TelemetryMetricSeries.tableName).first('payload_json');
      const point = await db(TelemetryMetricPoint.tableName).first('payload_json');
      expect(span?.payload_json).not.toContain('span-secret');
      expect(span?.payload_json).not.toContain('abcdef123456');
      expect(log?.payload_json).not.toContain('log-secret');
      expect(log?.payload_json).not.toContain('abcdef123456');
      expect(series?.payload_json).not.toContain('point-secret');
      expect(point?.payload_json).not.toContain('point-secret');
      expect(JSON.parse(series?.payload_json as string).points).toHaveLength(1);
      expect(JSON.parse(point?.payload_json as string).attributes.secret).toBe('[redacted]');
    } finally {
      await store.close();
    }
  });

  it('removes expired point rows and updates the complete series payload', async () => {
    let now = NOW_MS;
    const db = await createDatabase();
    const store = new SqlTelemetryStore(db, { retentionMs: 500, now: () => now });
    try {
      await store.ingestMetrics([
        makeSeries({
          points: [
            makePoint({ timestampMs: NOW_MS - 400, value: 1 }),
            makePoint({ timestampMs: NOW_MS, value: 2 }),
          ],
        }),
      ]);
      now += 401;
      await store.ingestMetrics([]);
      const points = await db(TelemetryMetricPoint.tableName).select('timestamp_ms');
      expect(points).toHaveLength(1);
      expect(Number(points[0]?.timestamp_ms)).toBe(NOW_MS);
      const row = await db(TelemetryMetricSeries.tableName).first('payload_json');
      expect(JSON.parse(row!.payload_json).points).toEqual([
        { timestampMs: NOW_MS, value: 2, attributes: {} },
      ]);
      expect(await store.getRevision()).toBe(2);
    } finally {
      await store.close();
    }
  });

  it('serializes concurrent dedupe-safe writes on a shared SQLite database', async () => {
    const db = await createDatabase();
    const first = new SqlTelemetryStore(db, { now: () => NOW_MS });
    const second = new SqlTelemetryStore(db, { now: () => NOW_MS });
    try {
      const spans: SpanRecord[] = Array.from({ length: 25 }, (_, index) =>
        makeSpan({ spanId: `span-${index}` })
      );
      const results = await Promise.all([first.ingestSpans(spans), second.ingestSpans(spans)]);
      expect(results).toEqual([
        { accepted: 25, rejected: 0 },
        { accepted: 25, rejected: 0 },
      ]);
      expect(await first.getRevision()).toBe(1);
      expect(await first.summary()).toMatchObject({ spanCount: 25, traceCount: 1 });
    } finally {
      await first.close();
    }
  });

  it('destroys the supplied Knex instance only once on repeated close', async () => {
    const db = await createDatabase();
    const store = new SqlTelemetryStore(db);
    const destroy = vi.spyOn(db, 'destroy');
    await Promise.all([store.close(), store.close()]);
    await store.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('supports the in-memory SQLite factory', async () => {
    const store = await createSqliteTelemetryStore({ filename: ':memory:', now: () => NOW_MS });
    try {
      const series: MetricSeries = makeSeries();
      expect(await store.ingestMetrics([series])).toEqual({ accepted: 1, rejected: 0 });
      expect((await store.listMetrics())[0]?.id).toBe(series.id);
    } finally {
      await store.close();
    }
  });
});
