import {
  calculateTenantInvoice,
  evaluateBillingLifecycle,
  type BillingInvoice,
  type BillingLifecycleTransition,
  type BillingPlanTier,
  type TenantUsageMetrics,
} from './billing-meter.js';
import type { PaasSubscriptionStatus } from './quota.js';

export interface PaasBillingBridgeOptions {
  readonly defaultTaxRateBps?: number;
}

export interface PaasTenantBillingReport {
  readonly tenantId: string;
  readonly tier: BillingPlanTier;
  readonly invoice: BillingInvoice;
  readonly lifecycle: BillingLifecycleTransition;
  readonly status: 'healthy' | 'action_required' | 'critical';
}

export class PaasBillingBridge {
  private readonly defaultTaxRateBps: number;

  constructor(options: PaasBillingBridgeOptions = {}) {
    this.defaultTaxRateBps = options.defaultTaxRateBps ?? 1000; // 10%
  }

  public generateTenantBillingReport(input: {
    readonly tenantId: string;
    readonly tier: BillingPlanTier;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly usage: TenantUsageMetrics;
    readonly daysPastDue: number;
    readonly previousSubscriptionStatus: PaasSubscriptionStatus;
    readonly quotaUtilizationPercent: number;
    readonly appIds: readonly string[];
  }): PaasTenantBillingReport {
    const invoice = calculateTenantInvoice({
      tenantId: input.tenantId,
      tier: input.tier,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      usage: input.usage,
      taxRateBps: this.defaultTaxRateBps,
    });

    const lifecycle = evaluateBillingLifecycle({
      tenantId: input.tenantId,
      previousSubscriptionStatus: input.previousSubscriptionStatus,
      daysPastDue: input.daysPastDue,
      quotaUtilizationPercent: input.quotaUtilizationPercent,
      appIds: input.appIds,
    });

    let status: 'healthy' | 'action_required' | 'critical' = 'healthy';
    if (lifecycle.state === 'hard_suspended') {
      status = 'critical';
    } else if (
      lifecycle.state === 'grace_period' ||
      lifecycle.state === 'soft_warning'
    ) {
      status = 'action_required';
    }

    return {
      tenantId: input.tenantId,
      tier: input.tier,
      invoice,
      lifecycle,
      status,
    };
  }
}
