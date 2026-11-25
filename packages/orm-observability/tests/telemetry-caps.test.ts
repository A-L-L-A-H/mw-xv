import { afterEach, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { installAddons } from '@moonwitness/orm';
import { MemoryTelemetryStore } from '../src/memory-store.js';
import { observabilityAddon } from '../src/manifest.js';
import { SqlTelemetryStore } from '../src/sql-store.js';
import type { TelemetryStore, TelemetryStoreOptions } from '../src/types.js';
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

describe.each(implementations)('$name telemetry cap enforcement', ({ create }) => {
  const stores: TelemetryStore[] = [];

  async function makeStore(options: TelemetryStoreOptions = {}): Promise<TelemetryStore> {
    const store = await create(options);
    stores.push(store);
    return store;
  }

  afterEach(async () => {
    while (stores.length > 0) await stores.pop()!.close();
  });

  it('rejects spans beyond maxSpans and keeps the cap stable across repeated bursts', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxSpans: 3 });
    const first = [1, 2, 3].map((index) => makeSpan({ spanId: `span-${index}` }));
    expect(await store.ingestSpans(first)).toEqual({ accepted: 3, rejected: 0 });
    expect((await store.summary()).spanCount).toBe(3);

    const overflow = [4, 5, 6].map((index) => makeSpan({ spanId: `span-${index}` }));
    expect(await store.ingestSpans(overflow)).toEqual({ accepted: 0, rejected: 3 });
    expect((await store.summary()).spanCount).toBe(3);

    expect(await store.ingestSpans(overflow)).toEqual({ accepted: 0, rejected: 3 });
    expect((await store.summary()).spanCount).toBe(3);
  });

  it('rejects logs beyond maxLogs and keeps the cap stable across repeated bursts', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxLogs: 2 });
    const first = [1, 2].map((index) => makeLog({ id: `log-${index}` }));
    expect(await store.ingestLogs(first)).toEqual({ accepted: 2, rejected: 0 });
    expect((await store.summary()).logCount).toBe(2);

    const overflow = [3, 4].map((index) => makeLog({ id: `log-${index}` }));
    expect(await store.ingestLogs(overflow)).toEqual({ accepted: 0, rejected: 2 });
    expect((await store.summary()).logCount).toBe(2);

    expect(await store.ingestLogs(overflow)).toEqual({ accepted: 0, rejected: 2 });
    expect((await store.summary()).logCount).toBe(2);
  });

  it('evicts the oldest metric series when maxMetricSeries is exceeded', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxMetricSeries: 2 });
    await store.ingestMetrics([
      makeSeries({ id: 'oldest', points: [makePoint({ timestampMs: NOW_MS + 100 })] }),
    ]);
    await store.ingestMetrics([
      makeSeries({ id: 'middle', points: [makePoint({ timestampMs: NOW_MS + 200 })] }),
    ]);
    expect((await store.summary()).metricSeriesCount).toBe(2);
    expect((await store.listMetrics()).map((series) => series.id)).toEqual(['middle', 'oldest']);

    expect(
      await store.ingestMetrics([
        makeSeries({ id: 'newest', points: [makePoint({ timestampMs: NOW_MS + 300 })] }),
      ])
    ).toEqual({ accepted: 1, rejected: 1 });
    expect((await store.summary()).metricSeriesCount).toBe(2);
    expect((await store.listMetrics()).map((series) => series.id)).toEqual(['newest', 'middle']);
  });

  it('drops only the oldest points when maxMetricPoints is exceeded per series', async () => {
    const store = await makeStore({ now: () => NOW_MS, maxMetricPoints: 3 });
    await store.ingestMetrics([
      makeSeries({
        points: [
          makePoint({ timestampMs: NOW_MS + 0 }),
          makePoint({ timestampMs: NOW_MS + 1 }),
        ],
      }),
    ]);
    expect(
      await store.ingestMetrics([
        makeSeries({
          points: [
            makePoint({ timestampMs: NOW_MS + 2 }),
            makePoint({ timestampMs: NOW_MS + 3 }),
            makePoint({ timestampMs: NOW_MS + 4 }),
          ],
        }),
      ])
    ).toEqual({ accepted: 3, rejected: 2 });

    const points = (await store.listMetrics())[0]?.points ?? [];
    expect(points.map((point) => point.timestampMs)).toEqual([
      NOW_MS + 2,
      NOW_MS + 3,
      NOW_MS + 4,
    ]);
  });

  it('retention prunes records older than retentionMs and bumps revision once', async () => {
    let now = NOW_MS;
    const store = await makeStore({ retentionMs: 1_000, now: () => now });
    await store.ingestSpans([makeSpan()]);
    await store.ingestLogs([makeLog()]);
    await store.ingestMetrics([makeSeries()]);
    const before = await store.getRevision();

    now += 1_101;
    expect(await store.ingestSpans([])).toEqual({ accepted: 0, rejected: 0 });
    expect(await store.getRevision()).toBe(before + 1);
    expect(await store.summary()).toMatchObject({
      spanCount: 0,
      logCount: 0,
      metricSeriesCount: 0,
    });
  });
});