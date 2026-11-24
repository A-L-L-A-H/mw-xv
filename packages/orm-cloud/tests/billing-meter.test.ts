import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BILLING_TIERS,
  TenantUsageSettlementLedger,
  applyBillingWebhookEvent,
  calculateTenantInvoice,
  evaluateBillingLifecycle,
  signBillingWebhookPayload,
  verifyBillingWebhookSignature,
} from '../src/billing-meter.js';

describe('billing-meter (Wave C.16)', () => {
  it('exposes free, starter, pro, and enterprise tiers wired to quota limits', () => {
    expect(Object.keys(DEFAULT_BILLING_TIERS)).toEqual(['free', 'starter', 'pro', 'enterprise']);
    expect(DEFAULT_BILLING_TIERS.free.monthlyBaseCents).toBe(0);
    expect(DEFAULT_BILLING_TIERS.enterprise.quotaLimits.allowDedicatedMesh).toBe(true);
  });

  it('calculates deterministic invoice line items with overages and tax', () => {
    const invoiceA = calculateTenantInvoice({
      tenantId: 'tenant-acme',
      tier: 'starter',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      usage: {
        containerHours: 2260, // 100 overage * 2 = 200
        ramGbHours: 2210, // 50 overage * 2 = 100
        storageGb: 35, // 10 overage * 10 = 100
        egressGb: 120, // 20 overage * 9 = 180
      },
      taxRateBps: 1000, // 10%
    });
    const invoiceB = calculateTenantInvoice({
      tenantId: 'tenant-acme',
      tier: 'starter',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      usage: {
        containerHours: 2260,
        ramGbHours: 2210,
        storageGb: 35,
        egressGb: 120,
      },
      taxRateBps: 1000,
    });

    expect(invoiceA.invoiceSha256).toBe(invoiceB.invoiceSha256);
    expect(invoiceA.subtotalCents).toBe(1900 + 200 + 100 + 100 + 180);
    expect(invoiceA.taxCents).toBe(248);
    expect(invoiceA.totalCents).toBe(2728);
    expect(invoiceA.lineItems).toHaveLength(5);
  });

  it('evaluates soft-warning, grace-period, and hard-suspension transitions with enforcement plans', () => {
    const soft = evaluateBillingLifecycle({
      tenantId: 'tenant-1',
      previousSubscriptionStatus: 'active',
      daysPastDue: 0,
      quotaUtilizationPercent: 85,
      appIds: ['app-a', 'app-b'],
    });
    expect(soft.state).toBe('soft_warning');
    expect(soft.enforcementPlan.action).toBe('noop');

    const grace = evaluateBillingLifecycle({
      tenantId: 'tenant-1',
      previousSubscriptionStatus: 'active',
      daysPastDue: 3,
      quotaUtilizationPercent: 40,
      gracePeriodDays: 7,
      appIds: ['app-a', 'app-b'],
    });
    expect(grace.state).toBe('grace_period');
    expect(grace.graceDaysRemaining).toBe(4);
    expect(grace.subscriptionStatus).toBe('past_due');
    expect(grace.enforcementPlan.action).toBe('noop');

    const suspended = evaluateBillingLifecycle({
      tenantId: 'tenant-1',
      previousSubscriptionStatus: 'past_due',
      daysPastDue: 8,
      quotaUtilizationPercent: 40,
      gracePeriodDays: 7,
      appIds: ['app-b', 'app-a'],
    });
    expect(suspended.state).toBe('hard_suspended');
    expect(suspended.subscriptionStatus).toBe('suspended');
    expect(suspended.enforcementPlan.action).toBe('stop');
    expect(suspended.enforcementPlan.targetAppIds).toEqual(['app-a', 'app-b']);
  });

  it('verifies HMAC-SHA256 webhook signatures with constant-time comparison and replay window', () => {
    const secret = 'whsec_test_9988776655';
    const rawPayload = JSON.stringify({ eventId: 'evt_1', type: 'invoice.paid' });
    const ts = 1_763_865_600;
    const sig = signBillingWebhookPayload(rawPayload, secret, ts);

    expect(
      verifyBillingWebhookSignature({
        rawPayload,
        signatureHex: `sha256=${sig}`,
        secret,
        timestampSec: ts,
        nowSec: ts + 60,
        toleranceSec: 300,
      }).valid
    ).toBe(true);

    expect(
      verifyBillingWebhookSignature({
        rawPayload,
        signatureHex: sig.replace(/^./u, sig[0] === 'a' ? 'b' : 'a'),
        secret,
        timestampSec: ts,
        nowSec: ts + 60,
      }).valid
    ).toBe(false);

    expect(
      verifyBillingWebhookSignature({
        rawPayload,
        signatureHex: sig,
        secret,
        timestampSec: ts,
        nowSec: ts + 600,
        toleranceSec: 300,
      }).valid
    ).toBe(false);
  });

  it('applies invoice.paid, invoice.payment_failed, and subscription.canceled events', () => {
    const paid = applyBillingWebhookEvent(
      {
        eventId: 'evt-paid',
        type: 'invoice.paid',
        tenantId: 'tenant-1',
        occurredAt: '2026-11-23T01:00:00.000Z',
      },
      'suspended',
      ['app-1']
    );
    expect(paid.transition.state).toBe('active');
    expect(paid.transition.enforcementPlan.action).toBe('resume');

    const failed = applyBillingWebhookEvent(
      {
        eventId: 'evt-fail',
        type: 'invoice.payment_failed',
        tenantId: 'tenant-1',
        occurredAt: '2026-11-23T02:00:00.000Z',
        daysPastDue: 2,
      },
      'active',
      ['app-1']
    );
    expect(failed.transition.state).toBe('grace_period');

    const canceled = applyBillingWebhookEvent(
      {
        eventId: 'evt-cancel',
        type: 'subscription.canceled',
        tenantId: 'tenant-1',
        occurredAt: '2026-11-23T03:00:00.000Z',
      },
      'active',
      ['app-1']
    );
    expect(canceled.transition.state).toBe('canceled');
    expect(canceled.transition.enforcementPlan.action).toBe('stop');
  });
});

describe('CF-007 idempotent usage accounting', () => {
  it('records a usage event once under duplicate settlement and keeps metrics isolated', () => {
    const ledger = new TenantUsageSettlementLedger();
    const event = {
      eventId: 'evt-meter-1',
      tenantId: 'tenant-1',
      metric: 'containerHours' as const,
      units: 3,
    };

    const first = ledger.apply(event);
    const duplicate = ledger.apply(event);
    expect(first.applied).toBe(true);
    expect(duplicate).toMatchObject({ applied: false, duplicate: true });

    const otherMetric = ledger.apply({
      ...event,
      eventId: 'evt-meter-2',
      metric: 'ramGbHours',
      units: 512,
    });
    expect(otherMetric.applied).toBe(true);
    expect(ledger.snapshot()).toEqual({
      containerHours: 3,
      ramGbHours: 512,
      storageGb: 0,
      egressGb: 0,
    });
  });
});
