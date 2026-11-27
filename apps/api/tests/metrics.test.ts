import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import {
  readWhatsAppDatabaseMetrics,
  recordHttpRequest,
  renderMetrics,
  resetWhatsAppDatabaseMetricsCache,
} from '../src/observability/metrics.js';

describe('observability metrics cache and cardinality guards', () => {
  beforeEach(() => {
    resetWhatsAppDatabaseMetricsCache();
  });

  it('caches WhatsApp DB metrics across repeated scrapes within TTL', async () => {
    const queryCalls = vi.fn(async () => []);
    const makeBuilder = () => ({
      select: () => makeBuilder(),
      whereIn: () => makeBuilder(),
      where: () => makeBuilder(),
      count: () => makeBuilder(),
      min: () => makeBuilder(),
      groupBy: queryCalls,
    });
    const db = (() => makeBuilder()) as unknown as Knex;

    const first = await readWhatsAppDatabaseMetrics(db);
    const second = await readWhatsAppDatabaseMetrics(db);
    expect(first).toEqual(second);
    expect(queryCalls).toHaveBeenCalledTimes(4);
  });

  it('logs a warning and degrades safely when DB metrics query fails', async () => {
    const logger = { warn: vi.fn() };
    const failingDb = (() => ({
      select: () => {
        throw new Error('pg timeout');
      },
    })) as unknown as Knex;

    const lines = await readWhatsAppDatabaseMetrics(failingDb, { logger });
    expect(lines).toContain('moonwitness_whatsapp_database_metrics_available 0');
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('caps HTTP metric keys and routes excess routes to __overflow__', () => {
    for (let i = 0; i < 2010; i++) {
      recordHttpRequest('GET', `/api/dynamic/${i}`, 200, 0.01);
    }
    const output = renderMetrics(1);
    expect(output).toContain('route="__overflow__"');
  });
});
