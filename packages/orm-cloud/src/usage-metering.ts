import {
  DEFAULT_BILLING_TIERS,
  TenantUsageSettlementLedger,
  calculateTenantInvoice,
  type BillingInvoice,
  type BillingPlanTier,
  type BillingTierPricing,
  type TenantUsageMetrics,
} from './billing-meter.js';

export const BYTES_PER_GIB = 1_073_741_824;
export const MS_PER_HOUR = 3_600_000;

export interface ContainerUsageSample {
  readonly sampleId: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly memoryMb: number;
  readonly storageBytes: number;
  readonly egressBytes: number;
  readonly containerCount?: number;
  readonly cpuMillicores?: number;
}

export interface UsageThresholdAlert {
  readonly tenantId: string;
  readonly metric: keyof TenantUsageMetrics;
  readonly used: number;
  readonly included: number;
  readonly utilizationRatio: number;
  readonly severity: 'warning' | 'exceeded';
}

export interface TenantUsageRollup {
  readonly tenantId: string;
  readonly tier: BillingPlanTier;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sampleCount: number;
  readonly duplicateSamplesDropped: number;
  readonly metrics: TenantUsageMetrics;
  readonly appMetrics: Readonly<Record<string, TenantUsageMetrics>>;
  readonly alerts: readonly UsageThresholdAlert[];
  readonly invoice: BillingInvoice;
}

export interface CloudUsageMeteringOptions {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly tenantTiers?: Readonly<Record<string, BillingPlanTier>>;
  readonly defaultTier?: BillingPlanTier;
  readonly softWarningRatio?: number;
  readonly taxRateBps?: number;
  readonly pricingCatalog?: Readonly<Record<BillingPlanTier, BillingTierPricing>>;
}

export interface CloudUsageAggregationResult {
  readonly totalSamples: number;
  readonly acceptedSamples: number;
  readonly duplicateSamplesDropped: number;
  readonly tenants: readonly TenantUsageRollup[];
}

export interface LedgerSampleRecordResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly tenantId: string;
  readonly usage: TenantUsageMetrics;
}

export interface BuildTenantInvoiceOptions {
  readonly tier: BillingPlanTier;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly taxRateBps?: number;
  readonly pricingCatalog?: Readonly<Record<BillingPlanTier, BillingTierPricing>>;
}

interface MutableAppAccumulator {
  containerHours: number;
  ramGbHours: number;
  peakStorageGb: number;
  egressGb: number;
}

interface MutableTenantAccumulator {
  sampleCount: number;
  duplicateSamplesDropped: number;
  apps: Map<string, MutableAppAccumulator>;
}

interface SampleContribution {
  readonly containerHours: number;
  readonly ramGbHours: number;
  readonly storageGb: number;
  readonly egressGb: number;
}

const DEFAULT_SOFT_WARNING_RATIO = 0.8;

function assertNonEmptyString(value: string, label: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertNonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function validateUsageSample(sample: ContainerUsageSample): {
  readonly sampleId: string;
  readonly tenantId: string;
  readonly appId: string;
} {
  const sampleId = assertNonEmptyString(sample.sampleId, 'Usage sample sampleId');
  const tenantId = assertNonEmptyString(sample.tenantId, 'Usage sample tenantId');
  const appId = assertNonEmptyString(sample.appId, 'Usage sample appId');

  if (!Number.isFinite(sample.windowStartMs) || !Number.isFinite(sample.windowEndMs)) {
    throw new Error('Usage sample windowStartMs and windowEndMs must be finite');
  }
  if (sample.windowEndMs < sample.windowStartMs) {
    throw new Error('Usage sample windowEndMs must be greater than or equal to windowStartMs');
  }

  assertNonNegativeFinite(sample.memoryMb, 'Usage sample memoryMb');
  assertNonNegativeFinite(sample.storageBytes, 'Usage sample storageBytes');
  assertNonNegativeFinite(sample.egressBytes, 'Usage sample egressBytes');

  if (sample.containerCount !== undefined) {
    assertNonNegativeFinite(sample.containerCount, 'Usage sample containerCount');
  }
  if (sample.cpuMillicores !== undefined) {
    assertNonNegativeFinite(sample.cpuMillicores, 'Usage sample cpuMillicores');
  }

  return { sampleId, tenantId, appId };
}

function computeSampleContribution(sample: ContainerUsageSample): SampleContribution {
  const hours = (sample.windowEndMs - sample.windowStartMs) / MS_PER_HOUR;
  const containerCount = sample.containerCount ?? 1;
  return {
    containerHours: hours * containerCount,
    ramGbHours: (sample.memoryMb / 1024) * hours * containerCount,
    storageGb: sample.storageBytes / BYTES_PER_GIB,
    egressGb: sample.egressBytes / BYTES_PER_GIB,
  };
}

function getOrCreateTenantAcc(
  tenantMap: Map<string, MutableTenantAccumulator>,
  tenantId: string
): MutableTenantAccumulator {
  const existing = tenantMap.get(tenantId);
  if (existing) return existing;
  const created: MutableTenantAccumulator = {
    sampleCount: 0,
    duplicateSamplesDropped: 0,
    apps: new Map<string, MutableAppAccumulator>(),
  };
  tenantMap.set(tenantId, created);
  return created;
}

function getOrCreateAppAcc(
  tenantAcc: MutableTenantAccumulator,
  appId: string
): MutableAppAccumulator {
  const existing = tenantAcc.apps.get(appId);
  if (existing) return existing;
  const created: MutableAppAccumulator = {
    containerHours: 0,
    ramGbHours: 0,
    peakStorageGb: 0,
    egressGb: 0,
  };
  tenantAcc.apps.set(appId, created);
  return created;
}

function buildTenantAlerts(
  tenantId: string,
  metrics: TenantUsageMetrics,
  pricing: BillingTierPricing,
  softWarningRatio: number
): UsageThresholdAlert[] {
  const checks: ReadonlyArray<readonly [keyof TenantUsageMetrics, number, number]> = [
    ['containerHours', metrics.containerHours, pricing.includedContainerHours],
    ['ramGbHours', metrics.ramGbHours, pricing.includedRamGbHours],
    ['storageGb', metrics.storageGb, pricing.includedStorageGb],
    ['egressGb', metrics.egressGb, pricing.includedEgressGb],
  ];

  const alerts: UsageThresholdAlert[] = [];
  for (const [metric, used, included] of checks) {
    if (included <= 0) {
      if (used > 0) {
        alerts.push({
          tenantId,
          metric,
          used,
          included,
          utilizationRatio: Number.POSITIVE_INFINITY,
          severity: 'exceeded',
        });
      }
      continue;
    }

    const utilizationRatio = used / included;
    if (used > included) {
      alerts.push({ tenantId, metric, used, included, utilizationRatio, severity: 'exceeded' });
    } else if (utilizationRatio >= softWarningRatio) {
      alerts.push({ tenantId, metric, used, included, utilizationRatio, severity: 'warning' });
    }
  }
  return alerts;
}

function summarizeTenantApps(apps: Map<string, MutableAppAccumulator>): {
  readonly appMetrics: Readonly<Record<string, TenantUsageMetrics>>;
  readonly metrics: TenantUsageMetrics;
} {
  const sortedAppIds = [...apps.keys()].sort((a, b) => a.localeCompare(b));
  const appMetrics: Record<string, TenantUsageMetrics> = {};
  let containerHours = 0;
  let ramGbHours = 0;
  let storageGb = 0;
  let egressGb = 0;

  for (const appId of sortedAppIds) {
    const appAcc = apps.get(appId)!;
    const entry: TenantUsageMetrics = {
      containerHours: appAcc.containerHours,
      ramGbHours: appAcc.ramGbHours,
      storageGb: appAcc.peakStorageGb,
      egressGb: appAcc.egressGb,
    };
    appMetrics[appId] = entry;
    containerHours += entry.containerHours;
    ramGbHours += entry.ramGbHours;
    storageGb += entry.storageGb;
    egressGb += entry.egressGb;
  }

  return {
    appMetrics,
    metrics: { containerHours, ramGbHours, storageGb, egressGb },
  };
}

export function aggregateCloudUsageSamples(
  samples: readonly ContainerUsageSample[],
  options: CloudUsageMeteringOptions
): CloudUsageAggregationResult {
  const periodStart = assertNonEmptyString(options.periodStart, 'Metering periodStart');
  const periodEnd = assertNonEmptyString(options.periodEnd, 'Metering periodEnd');
  const softWarningRatio = options.softWarningRatio ?? DEFAULT_SOFT_WARNING_RATIO;
  if (!Number.isFinite(softWarningRatio) || softWarningRatio <= 0) {
    throw new Error('Metering softWarningRatio must be a finite positive number');
  }

  const defaultTier = options.defaultTier ?? 'free';
  const pricingCatalog = options.pricingCatalog ?? DEFAULT_BILLING_TIERS;
  const seenSampleIds = new Set<string>();
  const tenantMap = new Map<string, MutableTenantAccumulator>();
  let acceptedSamples = 0;
  let duplicateSamplesDropped = 0;

  for (const sample of samples) {
    const { sampleId, tenantId, appId } = validateUsageSample(sample);
    if (seenSampleIds.has(sampleId)) {
      duplicateSamplesDropped += 1;
      const existingTenant = tenantMap.get(tenantId);
      if (existingTenant) existingTenant.duplicateSamplesDropped += 1;
      continue;
    }

    seenSampleIds.add(sampleId);
    acceptedSamples += 1;
    const tenantAcc = getOrCreateTenantAcc(tenantMap, tenantId);
    tenantAcc.sampleCount += 1;

    const appAcc = getOrCreateAppAcc(tenantAcc, appId);
    const contrib = computeSampleContribution(sample);
    appAcc.containerHours += contrib.containerHours;
    appAcc.ramGbHours += contrib.ramGbHours;
    appAcc.peakStorageGb = Math.max(appAcc.peakStorageGb, contrib.storageGb);
    appAcc.egressGb += contrib.egressGb;
  }

  const sortedTenantIds = [...tenantMap.keys()].sort((a, b) => a.localeCompare(b));
  const tenants: TenantUsageRollup[] = sortedTenantIds.map((tenantId) => {
    const tenantAcc = tenantMap.get(tenantId)!;
    const { appMetrics, metrics } = summarizeTenantApps(tenantAcc.apps);
    const tier = options.tenantTiers?.[tenantId] ?? defaultTier;
    const pricing = pricingCatalog[tier];
    const alerts = buildTenantAlerts(tenantId, metrics, pricing, softWarningRatio);
    const invoice = calculateTenantInvoice({
      tenantId,
      tier,
      periodStart,
      periodEnd,
      usage: metrics,
      ...(options.taxRateBps !== undefined ? { taxRateBps: options.taxRateBps } : {}),
      ...(options.pricingCatalog !== undefined ? { pricingCatalog: options.pricingCatalog } : {}),
    });

    return {
      tenantId,
      tier,
      periodStart,
      periodEnd,
      sampleCount: tenantAcc.sampleCount,
      duplicateSamplesDropped: tenantAcc.duplicateSamplesDropped,
      metrics,
      appMetrics,
      alerts,
      invoice,
    };
  });

  return {
    totalSamples: samples.length,
    acceptedSamples,
    duplicateSamplesDropped,
    tenants,
  };
}

export class CloudUsageMeteringLedger {
  private readonly seenSampleIds = new Set<string>();
  private readonly tenantLedgers = new Map<string, TenantUsageSettlementLedger>();
  private readonly peakStorageByTenantApp = new Map<string, Map<string, number>>();

  private getOrCreateLedger(tenantId: string): TenantUsageSettlementLedger {
    const existing = this.tenantLedgers.get(tenantId);
    if (existing) return existing;
    const created = new TenantUsageSettlementLedger();
    this.tenantLedgers.set(tenantId, created);
    return created;
  }

  private getOrCreateStorageMap(tenantId: string): Map<string, number> {
    const existing = this.peakStorageByTenantApp.get(tenantId);
    if (existing) return existing;
    const created = new Map<string, number>();
    this.peakStorageByTenantApp.set(tenantId, created);
    return created;
  }

  recordSample(sample: ContainerUsageSample): LedgerSampleRecordResult {
    const { sampleId, tenantId, appId } = validateUsageSample(sample);
    const ledger = this.getOrCreateLedger(tenantId);

    if (this.seenSampleIds.has(sampleId)) {
      return {
        accepted: false,
        duplicate: true,
        tenantId,
        usage: ledger.snapshot(),
      };
    }

    this.seenSampleIds.add(sampleId);
    const contrib = computeSampleContribution(sample);

    ledger.apply({
      eventId: `${sampleId}:containerHours`,
      tenantId,
      metric: 'containerHours',
      units: contrib.containerHours,
    });
    ledger.apply({
      eventId: `${sampleId}:ramGbHours`,
      tenantId,
      metric: 'ramGbHours',
      units: contrib.ramGbHours,
    });

    const storageMap = this.getOrCreateStorageMap(tenantId);
    const prevPeak = storageMap.get(appId) ?? 0;
    const storageDeltaGb = Math.max(0, contrib.storageGb - prevPeak);
    if (storageDeltaGb > 0) {
      storageMap.set(appId, contrib.storageGb);
      ledger.apply({
        eventId: `${sampleId}:storageGb`,
        tenantId,
        metric: 'storageGb',
        units: storageDeltaGb,
      });
    }

    ledger.apply({
      eventId: `${sampleId}:egressGb`,
      tenantId,
      metric: 'egressGb',
      units: contrib.egressGb,
    });

    return {
      accepted: true,
      duplicate: false,
      tenantId,
      usage: ledger.snapshot(),
    };
  }

  snapshotTenant(tenantId: string): TenantUsageMetrics {
    const normalized = assertNonEmptyString(tenantId, 'Ledger snapshot tenantId');
    return (
      this.tenantLedgers.get(normalized)?.snapshot() ?? {
        containerHours: 0,
        ramGbHours: 0,
        storageGb: 0,
        egressGb: 0,
      }
    );
  }

  buildInvoice(tenantId: string, opts: BuildTenantInvoiceOptions): BillingInvoice {
    const normalized = assertNonEmptyString(tenantId, 'Ledger invoice tenantId');
    return calculateTenantInvoice({
      tenantId: normalized,
      tier: opts.tier,
      periodStart: assertNonEmptyString(opts.periodStart, 'Invoice periodStart'),
      periodEnd: assertNonEmptyString(opts.periodEnd, 'Invoice periodEnd'),
      usage: this.snapshotTenant(normalized),
      ...(opts.taxRateBps !== undefined ? { taxRateBps: opts.taxRateBps } : {}),
      ...(opts.pricingCatalog !== undefined ? { pricingCatalog: opts.pricingCatalog } : {}),
    });
  }
}
