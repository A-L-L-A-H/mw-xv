import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_PAAS_PLANS,
  planSubscriptionEnforcement,
  type PaasPlanLimits,
  type PaasPlanTier,
  type PaasSubscriptionStatus,
  type SubscriptionEnforcementPlan,
} from './quota.js';

export type BillingPlanTier = 'free' | PaasPlanTier;

export interface BillingTierPricing {
  readonly tier: BillingPlanTier;
  readonly monthlyBaseCents: number;
  readonly includedContainerHours: number;
  readonly includedRamGbHours: number;
  readonly includedStorageGb: number;
  readonly includedEgressGb: number;
  readonly overageContainerHourCents: number;
  readonly overageRamGbHourCents: number;
  readonly overageStorageGbCents: number;
  readonly overageEgressGbCents: number;
  readonly quotaLimits: Omit<PaasPlanLimits, 'tier'> & { readonly tier: BillingPlanTier };
}

export const DEFAULT_BILLING_TIERS: Readonly<Record<BillingPlanTier, BillingTierPricing>> =
  Object.freeze({
    free: Object.freeze({
      tier: 'free',
      monthlyBaseCents: 0,
      includedContainerHours: 720,
      includedRamGbHours: 360,
      includedStorageGb: 5,
      includedEgressGb: 10,
      overageContainerHourCents: 2,
      overageRamGbHourCents: 3,
      overageStorageGbCents: 15,
      overageEgressGbCents: 12,
      quotaLimits: Object.freeze({
        tier: 'free',
        maxApps: 1,
        maxRamMb: 512,
        maxCustomDomains: 0,
        allowDedicatedMesh: false,
      }),
    }),
    starter: Object.freeze({
      tier: 'starter',
      monthlyBaseCents: 1900,
      includedContainerHours: 2160,
      includedRamGbHours: 2160,
      includedStorageGb: 25,
      includedEgressGb: 100,
      overageContainerHourCents: 2,
      overageRamGbHourCents: 2,
      overageStorageGbCents: 10,
      overageEgressGbCents: 9,
      quotaLimits: DEFAULT_PAAS_PLANS.starter,
    }),
    pro: Object.freeze({
      tier: 'pro',
      monthlyBaseCents: 7900,
      includedContainerHours: 10800,
      includedRamGbHours: 16200,
      includedStorageGb: 150,
      includedEgressGb: 1000,
      overageContainerHourCents: 1,
      overageRamGbHourCents: 2,
      overageStorageGbCents: 8,
      overageEgressGbCents: 7,
      quotaLimits: DEFAULT_PAAS_PLANS.pro,
    }),
    enterprise: Object.freeze({
      tier: 'enterprise',
      monthlyBaseCents: 39900,
      includedContainerHours: 72000,
      includedRamGbHours: 144000,
      includedStorageGb: 1000,
      includedEgressGb: 10000,
      overageContainerHourCents: 1,
      overageRamGbHourCents: 1,
      overageStorageGbCents: 5,
      overageEgressGbCents: 5,
      quotaLimits: DEFAULT_PAAS_PLANS.enterprise,
    }),
  });

export interface TenantUsageMetrics {
  readonly containerHours: number;
  readonly ramGbHours: number;
  readonly storageGb: number;
  readonly egressGb: number;
}

export interface InvoiceCalculationInput {
  readonly tenantId: string;
  readonly tier: BillingPlanTier;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly usage: TenantUsageMetrics;
  readonly taxRateBps?: number;
  readonly pricingCatalog?: Readonly<Record<BillingPlanTier, BillingTierPricing>>;
}

export type InvoiceLineItemCode =
  | 'base_plan'
  | 'overage_container_hours'
  | 'overage_ram_gb_hours'
  | 'overage_storage_gb'
  | 'overage_egress_gb';

export interface InvoiceLineItem {
  readonly code: InvoiceLineItemCode;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly amountCents: number;
}

export interface BillingInvoice {
  readonly tenantId: string;
  readonly tier: BillingPlanTier;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: 'USD';
  readonly lineItems: readonly InvoiceLineItem[];
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly invoiceSha256: string;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

export function calculateTenantInvoice(input: InvoiceCalculationInput): BillingInvoice {
  const catalog = input.pricingCatalog ?? DEFAULT_BILLING_TIERS;
  const pricing = catalog[input.tier];

  const containerHours = clampNonNegative(input.usage.containerHours);
  const ramGbHours = clampNonNegative(input.usage.ramGbHours);
  const storageGb = clampNonNegative(input.usage.storageGb);
  const egressGb = clampNonNegative(input.usage.egressGb);

  const lineItems: InvoiceLineItem[] = [
    {
      code: 'base_plan',
      description: `MoonWitness PaaS ${pricing.tier} plan monthly base`,
      quantity: 1,
      unitPriceCents: pricing.monthlyBaseCents,
      amountCents: pricing.monthlyBaseCents,
    },
  ];

  const overageContainerHours = Math.ceil(
    Math.max(0, containerHours - pricing.includedContainerHours)
  );
  if (overageContainerHours > 0) {
    lineItems.push({
      code: 'overage_container_hours',
      description: 'Container-hours overage',
      quantity: overageContainerHours,
      unitPriceCents: pricing.overageContainerHourCents,
      amountCents: overageContainerHours * pricing.overageContainerHourCents,
    });
  }

  const overageRamGbHours = Math.ceil(Math.max(0, ramGbHours - pricing.includedRamGbHours));
  if (overageRamGbHours > 0) {
    lineItems.push({
      code: 'overage_ram_gb_hours',
      description: 'RAM GB-hours overage',
      quantity: overageRamGbHours,
      unitPriceCents: pricing.overageRamGbHourCents,
      amountCents: overageRamGbHours * pricing.overageRamGbHourCents,
    });
  }

  const overageStorageGb = Math.ceil(Math.max(0, storageGb - pricing.includedStorageGb));
  if (overageStorageGb > 0) {
    lineItems.push({
      code: 'overage_storage_gb',
      description: 'Persistent storage GB overage',
      quantity: overageStorageGb,
      unitPriceCents: pricing.overageStorageGbCents,
      amountCents: overageStorageGb * pricing.overageStorageGbCents,
    });
  }

  const overageEgressGb = Math.ceil(Math.max(0, egressGb - pricing.includedEgressGb));
  if (overageEgressGb > 0) {
    lineItems.push({
      code: 'overage_egress_gb',
      description: 'Network egress GB overage',
      quantity: overageEgressGb,
      unitPriceCents: pricing.overageEgressGbCents,
      amountCents: overageEgressGb * pricing.overageEgressGbCents,
    });
  }

  const subtotalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const taxRateBps = Math.max(0, Math.round(input.taxRateBps ?? 0));
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  const canonical = {
    tenantId: input.tenantId,
    tier: input.tier,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: 'USD' as const,
    lineItems,
    subtotalCents,
    taxCents,
    totalCents,
  };

  const invoiceSha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

  return {
    ...canonical,
    invoiceSha256,
  };
}

export type BillingLifecycleState =
  'active' | 'soft_warning' | 'grace_period' | 'hard_suspended' | 'canceled';

export interface BillingLifecycleInput {
  readonly tenantId: string;
  readonly previousSubscriptionStatus: PaasSubscriptionStatus;
  readonly daysPastDue: number;
  readonly quotaUtilizationPercent: number;
  readonly canceled?: boolean;
  readonly softWarningThresholdPercent?: number;
  readonly gracePeriodDays?: number;
  readonly appIds: readonly string[];
  readonly evaluatedAt?: string;
}

export interface BillingLifecycleTransition {
  readonly tenantId: string;
  readonly state: BillingLifecycleState;
  readonly subscriptionStatus: PaasSubscriptionStatus;
  readonly daysPastDue: number;
  readonly graceDaysRemaining: number;
  readonly enforcementPlan: SubscriptionEnforcementPlan;
  readonly reason: string;
}

const DEFAULT_SOFT_WARNING_PERCENT = 80;
const DEFAULT_GRACE_PERIOD_DAYS = 7;

export function evaluateBillingLifecycle(input: BillingLifecycleInput): BillingLifecycleTransition {
  const softWarningPercent = input.softWarningThresholdPercent ?? DEFAULT_SOFT_WARNING_PERCENT;
  const gracePeriodDays = Math.max(
    1,
    Math.floor(input.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS)
  );
  const daysPastDue = Math.max(0, Math.floor(input.daysPastDue));

  let state: BillingLifecycleState;
  let subscriptionStatus: PaasSubscriptionStatus;
  let reason: string;

  if (input.canceled) {
    state = 'canceled';
    subscriptionStatus = 'cancelled';
    reason = 'Subscription canceled by provider or tenant';
  } else if (daysPastDue > gracePeriodDays) {
    state = 'hard_suspended';
    subscriptionStatus = 'suspended';
    reason = `Invoice is ${daysPastDue} day(s) past due, exceeding ${gracePeriodDays}-day grace period`;
  } else if (daysPastDue > 0) {
    state = 'grace_period';
    subscriptionStatus = 'past_due';
    reason = `Invoice is ${daysPastDue} day(s) past due; ${gracePeriodDays - daysPastDue} grace day(s) remaining`;
  } else if (input.quotaUtilizationPercent >= softWarningPercent) {
    state = 'soft_warning';
    subscriptionStatus = 'active';
    reason = `Quota utilization (${input.quotaUtilizationPercent}%) reached soft-warning threshold (${softWarningPercent}%)`;
  } else {
    state = 'active';
    subscriptionStatus = 'active';
    reason = 'Account is in good standing';
  }

  const graceDaysRemaining =
    state === 'grace_period' ? Math.max(0, gracePeriodDays - daysPastDue) : 0;

  const enforcementPlan = planSubscriptionEnforcement({
    tenantId: input.tenantId,
    previousStatus: input.previousSubscriptionStatus,
    nextStatus: subscriptionStatus,
    appIds: input.appIds,
    reason,
    ...(input.evaluatedAt !== undefined ? { evaluatedAt: input.evaluatedAt } : {}),
  });

  return {
    tenantId: input.tenantId,
    state,
    subscriptionStatus,
    daysPastDue,
    graceDaysRemaining,
    enforcementPlan,
    reason,
  };
}

export function signBillingWebhookPayload(
  rawPayload: string | Buffer,
  secret: string,
  timestampSec?: number
): string {
  const payloadStr = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : rawPayload;
  const signedContent = timestampSec !== undefined ? `${timestampSec}.${payloadStr}` : payloadStr;
  return createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
}

export interface VerifyBillingWebhookInput {
  readonly rawPayload: string | Buffer;
  readonly signatureHex: string;
  readonly secret: string;
  readonly timestampSec?: number;
  readonly nowSec?: number;
  readonly toleranceSec?: number;
}

export interface VerifyBillingWebhookResult {
  readonly valid: boolean;
  readonly reason: string;
}

export function verifyBillingWebhookSignature(
  input: VerifyBillingWebhookInput
): VerifyBillingWebhookResult {
  if (!input.secret || input.secret.length === 0) {
    return { valid: false, reason: 'Webhook secret is empty' };
  }

  const normalizedSig = input.signatureHex
    .trim()
    .toLowerCase()
    .replace(/^sha256=/u, '');
  if (!/^[0-9a-f]{64}$/u.test(normalizedSig)) {
    return { valid: false, reason: 'Signature is not a valid 64-char hex SHA-256 digest' };
  }

  if (input.timestampSec !== undefined) {
    const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
    const toleranceSec = Math.max(0, input.toleranceSec ?? 300);
    if (Math.abs(nowSec - input.timestampSec) > toleranceSec) {
      return { valid: false, reason: 'Webhook timestamp outside replay tolerance window' };
    }
  }

  const expectedHex = signBillingWebhookPayload(input.rawPayload, input.secret, input.timestampSec);
  const providedBuf = Buffer.from(normalizedSig, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  const matched = timingSafeEqual(providedBuf, expectedBuf);
  return matched
    ? { valid: true, reason: 'HMAC-SHA256 signature verified' }
    : { valid: false, reason: 'HMAC-SHA256 signature mismatch' };
}

export type BillingWebhookEventType =
  'invoice.paid' | 'invoice.payment_failed' | 'subscription.canceled';

export interface BillingWebhookEvent {
  readonly eventId: string;
  readonly type: BillingWebhookEventType;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly daysPastDue?: number;
}

export interface BillingWebhookOutcome {
  readonly eventId: string;
  readonly type: BillingWebhookEventType;
  readonly tenantId: string;
  readonly transition: BillingLifecycleTransition;
}

export function applyBillingWebhookEvent(
  event: BillingWebhookEvent,
  currentStatus: PaasSubscriptionStatus,
  appIds: readonly string[],
  gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS
): BillingWebhookOutcome {
  if (event.type === 'invoice.paid') {
    return {
      eventId: event.eventId,
      type: event.type,
      tenantId: event.tenantId,
      transition: evaluateBillingLifecycle({
        tenantId: event.tenantId,
        previousSubscriptionStatus: currentStatus,
        daysPastDue: 0,
        quotaUtilizationPercent: 0,
        appIds,
        gracePeriodDays,
        evaluatedAt: event.occurredAt,
      }),
    };
  }

  if (event.type === 'invoice.payment_failed') {
    return {
      eventId: event.eventId,
      type: event.type,
      tenantId: event.tenantId,
      transition: evaluateBillingLifecycle({
        tenantId: event.tenantId,
        previousSubscriptionStatus: currentStatus,
        daysPastDue: Math.max(1, event.daysPastDue ?? 1),
        quotaUtilizationPercent: 0,
        appIds,
        gracePeriodDays,
        evaluatedAt: event.occurredAt,
      }),
    };
  }

  return {
    eventId: event.eventId,
    type: event.type,
    tenantId: event.tenantId,
    transition: evaluateBillingLifecycle({
      tenantId: event.tenantId,
      previousSubscriptionStatus: currentStatus,
      daysPastDue: 0,
      quotaUtilizationPercent: 0,
      canceled: true,
      appIds,
      gracePeriodDays,
      evaluatedAt: event.occurredAt,
    }),
  };
}

/*
 * CF-007 / idempotent usage accounting under retry
 * ---------------------------------------------------------------------------
 * Usage events are keyed by `eventId`: a duplicate delivery (e.g. a retried
 * webhook or a replayed settlement) is acknowledged but never counted twice.
 * This is the metering counterpart of PaasQuotaReservationLedger.settle().
 */
export interface UsageSettlementEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly metric: keyof TenantUsageMetrics;
  readonly units: number;
  readonly correlationId?: string;
  readonly recordedAt?: string;
}

export interface UsageSettlementResult {
  readonly applied: boolean;
  readonly duplicate: boolean;
  readonly eventId: string;
  readonly tenantId: string;
  readonly usage: TenantUsageMetrics;
  readonly reason: string;
}

export class TenantUsageSettlementLedger {
  private readonly appliedEventIds = new Set<string>();
  private readonly usage: Record<keyof TenantUsageMetrics, number> = {
    containerHours: 0,
    ramGbHours: 0,
    storageGb: 0,
    egressGb: 0,
  };

  snapshot(): TenantUsageMetrics {
    return { ...this.usage };
  }

  apply(event: UsageSettlementEvent): UsageSettlementResult {
    if (!event.eventId || !event.eventId.trim()) {
      throw new Error('Usage settlement requires a non-empty eventId');
    }
    if (!Object.prototype.hasOwnProperty.call(this.usage, event.metric)) {
      throw new Error(`Unknown usage metric "${event.metric}"`);
    }
    if (!Number.isFinite(event.units) || event.units < 0) {
      throw new Error('Usage settlement units must be a finite non-negative number');
    }

    if (this.appliedEventIds.has(event.eventId)) {
      return {
        applied: false,
        duplicate: true,
        eventId: event.eventId,
        tenantId: event.tenantId,
        usage: this.snapshot(),
        reason: `Duplicate usage event "${event.eventId}" ignored (idempotent under retry)`,
      };
    }

    this.appliedEventIds.add(event.eventId);
    this.usage[event.metric] += event.units;
    return {
      applied: true,
      duplicate: false,
      eventId: event.eventId,
      tenantId: event.tenantId,
      usage: this.snapshot(),
      reason: `Recorded ${event.units} ${event.metric} for tenant "${event.tenantId}"`,
    };
  }
}
