import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GIB,
  CloudUsageMeteringLedger,
  MS_PER_HOUR,
  aggregateCloudUsageSamples,
  type ContainerUsageSample,
} from '../src/index.js';

function makeSample(overrides: Partial<ContainerUsageSample> = {}): ContainerUsageSample {
  return {
    sampleId: 'sample-1',
    tenantId: 'tenant-alpha',
    appId: 'app-web',
    windowStartMs: 0,
    windowEndMs: 2 * MS_PER_HOUR,
    memoryMb: 1024,
    storageBytes: 2 * BYTES_PER_GIB,
    egressBytes: 1 * BYTES_PER_GIB,
    containerCount: 1,
    ...overrides,
  };
}

describe('usage-metering (cloud usage aggregator & ledger)', () => {
  it('converts sample intervals into containerHours, ramGbHours, peak per-app storageGb, and summed egressGb', () => {
    const result = aggregateCloudUsageSamples(
      [
        makeSample({
          sampleId: 's-1',
          appId: 'app-web',
          windowStartMs: 0,
          windowEndMs: 2 * MS_PER_HOUR,
          memoryMb: 512, // 0.5 GiB * 2h * 2 containers = 2 ramGbHours
          containerCount: 2, // 2h * 2 = 4 containerHours
          storageBytes: 3 * BYTES_PER_GIB,
          egressBytes: 1 * BYTES_PER_GIB,
        }),
        makeSample({
          sampleId: 's-2',
          appId: 'app-web',
          windowStartMs: 2 * MS_PER_HOUR,
          windowEndMs: 3 * MS_PER_HOUR,
          memoryMb: 1024, // 1 GiB * 1h * 1 = 1 ramGbHour
          containerCount: 1, // 1 containerHour
          storageBytes: 5 * BYTES_PER_GIB, // peak for app-web = 5 GiB
          egressBytes: 2 * BYTES_PER_GIB,
        }),
        makeSample({
          sampleId: 's-3',
          appId: 'app-worker',
          windowStartMs: 0,
          windowEndMs: 4 * MS_PER_HOUR,
          memoryMb: 2048, // 2 GiB * 4h * 1 = 8 ramGbHours
          containerCount: 1, // 4 containerHours
          storageBytes: 4 * BYTES_PER_GIB, // peak for app-worker = 4 GiB
          egressBytes: 3 * BYTES_PER_GIB,
        }),
      ],
      {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-12-01T00:00:00.000Z',
        tenantTiers: { 'tenant-alpha': 'starter' },
      }
    );

    expect(result.totalSamples).toBe(3);
    expect(result.acceptedSamples).toBe(3);
    expect(result.duplicateSamplesDropped).toBe(0);
    expect(result.tenants).toHaveLength(1);

    const rollup = result.tenants[0]!;
    expect(rollup.metrics).toEqual({
      containerHours: 9,
      ramGbHours: 11,
      storageGb: 9, // 5 GiB peak (app-web) + 4 GiB peak (app-worker)
      egressGb: 6,
    });
    expect(rollup.appMetrics['app-web']).toEqual({
      containerHours: 5,
      ramGbHours: 3,
      storageGb: 5,
      egressGb: 3,
    });
    expect(rollup.appMetrics['app-worker']).toEqual({
      containerHours: 4,
      ramGbHours: 8,
      storageGb: 4,
      egressGb: 3,
    });
    expect(rollup.alerts).toEqual([]);
  });

  it('deduplicates repeated sampleId deliveries idempotently', () => {
    const samples: ContainerUsageSample[] = [
      makeSample({ sampleId: 'dup-1', egressBytes: 2 * BYTES_PER_GIB }),
      makeSample({ sampleId: 'dup-1', egressBytes: 2 * BYTES_PER_GIB }),
      makeSample({ sampleId: 'uniq-2', egressBytes: 3 * BYTES_PER_GIB }),
    ];

    const result = aggregateCloudUsageSamples(samples, {
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    });

    expect(result.totalSamples).toBe(3);
    expect(result.acceptedSamples).toBe(2);
    expect(result.duplicateSamplesDropped).toBe(1);
    expect(result.tenants[0]!.sampleCount).toBe(2);
    expect(result.tenants[0]!.duplicateSamplesDropped).toBe(1);
    expect(result.tenants[0]!.metrics.egressGb).toBe(5);
  });

  it('rejects invalid sample identifiers, reversed windows, and negative metrics', () => {
    const opts = {
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    };

    expect(() =>
      aggregateCloudUsageSamples([makeSample({ sampleId: '   ' })], opts)
    ).toThrow();
    expect(() =>
      aggregateCloudUsageSamples([makeSample({ windowStartMs: 5000, windowEndMs: 1000 })], opts)
    ).toThrow();
    expect(() =>
      aggregateCloudUsageSamples([makeSample({ memoryMb: -1 })], opts)
    ).toThrow();
    expect(() =>
      aggregateCloudUsageSamples([makeSample({ egressBytes: Number.NaN })], opts)
    ).toThrow();
  });

  it('emits soft-warning and exceeded alerts and produces deterministic multi-tenant invoices', () => {
    const samples: ContainerUsageSample[] = [
      makeSample({
        sampleId: 'b-1',
        tenantId: 'tenant-beta',
        windowStartMs: 0,
        windowEndMs: 600 * MS_PER_HOUR, // 600 / 720 = 0.833 >= 0.8 (warning on free tier)
        memoryMb: 256, // 150 ramGbHours
        storageBytes: 6 * BYTES_PER_GIB, // > 5 GiB free limit (exceeded)
        egressBytes: 12 * BYTES_PER_GIB, // > 10 GiB free limit (exceeded)
      }),
      makeSample({
        sampleId: 'a-1',
        tenantId: 'tenant-alpha',
        windowStartMs: 0,
        windowEndMs: 10 * MS_PER_HOUR,
        memoryMb: 512,
        storageBytes: 1 * BYTES_PER_GIB,
        egressBytes: 1 * BYTES_PER_GIB,
      }),
    ];

    const opts = {
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      defaultTier: 'free' as const,
      softWarningRatio: 0.8,
      taxRateBps: 1100,
    };

    const run1 = aggregateCloudUsageSamples(samples, opts);
    const run2 = aggregateCloudUsageSamples([...samples].reverse(), opts);

    expect(run1.tenants.map((t) => t.tenantId)).toEqual(['tenant-alpha', 'tenant-beta']);
    expect(run1.tenants[0]!.invoice.invoiceSha256).toBe(run2.tenants[0]!.invoice.invoiceSha256);
    expect(run1.tenants[1]!.invoice.invoiceSha256).toBe(run2.tenants[1]!.invoice.invoiceSha256);

    const betaAlerts = run1.tenants[1]!.alerts;
    expect(betaAlerts.find((a) => a.metric === 'containerHours')?.severity).toBe('warning');
    expect(betaAlerts.find((a) => a.metric === 'storageGb')?.severity).toBe('exceeded');
    expect(betaAlerts.find((a) => a.metric === 'egressGb')?.severity).toBe('exceeded');
    expect(run1.tenants[1]!.invoice.totalCents).toBeGreaterThan(0);
  });

  it('maintains stateful idempotent per-tenant usage and invoices in CloudUsageMeteringLedger', () => {
    const ledger = new CloudUsageMeteringLedger();

    const first = ledger.recordSample(
      makeSample({
        sampleId: 'l-1',
        tenantId: 'tenant-ledger',
        appId: 'app-1',
        windowStartMs: 0,
        windowEndMs: 10 * MS_PER_HOUR,
        memoryMb: 1024,
        storageBytes: 4 * BYTES_PER_GIB,
        egressBytes: 2 * BYTES_PER_GIB,
      })
    );
    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBe(false);

    const dup = ledger.recordSample(
      makeSample({
        sampleId: 'l-1',
        tenantId: 'tenant-ledger',
        appId: 'app-1',
        windowStartMs: 0,
        windowEndMs: 10 * MS_PER_HOUR,
        memoryMb: 1024,
        storageBytes: 4 * BYTES_PER_GIB,
        egressBytes: 2 * BYTES_PER_GIB,
      })
    );
    expect(dup.accepted).toBe(false);
    expect(dup.duplicate).toBe(true);

    // Lower storage sample on same app should not reduce peak; higher storage adds only delta
    ledger.recordSample(
      makeSample({
        sampleId: 'l-2',
        tenantId: 'tenant-ledger',
        appId: 'app-1',
        windowStartMs: 10 * MS_PER_HOUR,
        windowEndMs: 12 * MS_PER_HOUR,
        memoryMb: 1024,
        storageBytes: 2 * BYTES_PER_GIB,
        egressBytes: 1 * BYTES_PER_GIB,
      })
    );
    ledger.recordSample(
      makeSample({
        sampleId: 'l-3',
        tenantId: 'tenant-ledger',
        appId: 'app-1',
        windowStartMs: 12 * MS_PER_HOUR,
        windowEndMs: 14 * MS_PER_HOUR,
        memoryMb: 1024,
        storageBytes: 7 * BYTES_PER_GIB,
        egressBytes: 3 * BYTES_PER_GIB,
      })
    );

    expect(ledger.snapshotTenant('tenant-ledger')).toEqual({
      containerHours: 14,
      ramGbHours: 14,
      storageGb: 7,
      egressGb: 6,
    });
    expect(ledger.snapshotTenant('tenant-empty')).toEqual({
      containerHours: 0,
      ramGbHours: 0,
      storageGb: 0,
      egressGb: 0,
    });

    const invoice = ledger.buildInvoice('tenant-ledger', {
      tier: 'free',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    });
    expect(invoice.lineItems.some((item) => item.code === 'overage_storage_gb')).toBe(true);
    expect(invoice.totalCents).toBe(30); // 2 GiB storage overage * 15 cents
  });
});
