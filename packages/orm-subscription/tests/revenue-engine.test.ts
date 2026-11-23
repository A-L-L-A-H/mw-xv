import { describe, expect, it } from 'vitest';
import {
  advanceDunningState,
  calculateCohortRetention,
  calculateMidCycleProration,
  calculateMrrAndArr,
  type DunningState,
  type SubscriptionRevenueRecord,
} from '../src/index.js';

describe('Mid-Cycle Plan Proration Calculator', () => {
  it('calculates exact integer-cent upgrade charge and downgrade credit', () => {
    const upgrade = calculateMidCycleProration({
      currentPlanPeriodCents: 10_000,
      newPlanPeriodCents: 30_000,
      cycleStart: '2026-06-01T00:00:00Z',
      cycleEnd: '2026-07-01T00:00:00Z',
      changeAt: '2026-06-16T00:00:00Z', // exact midpoint (15/30 days remaining)
    });
    expect(upgrade.unusedCreditCents).toBe(5_000);
    expect(upgrade.newPlanChargeCents).toBe(15_000);
    expect(upgrade.netProrationCents).toBe(10_000);
    expect(upgrade.direction).toBe('upgrade');

    const downgrade = calculateMidCycleProration({
      currentPlanPeriodCents: 30_000,
      newPlanPeriodCents: 10_000,
      cycleStart: '2026-06-01T00:00:00Z',
      cycleEnd: '2026-07-01T00:00:00Z',
      changeAt: '2026-06-16T00:00:00Z',
    });
    expect(downgrade.netProrationCents).toBe(-10_000);
    expect(downgrade.direction).toBe('downgrade');
  });
});

describe('Dunning Retry & Grace-Period State Machine', () => {
  it('transitions active -> past_due -> grace -> suspended -> canceled and supports recovery', () => {
    const state: DunningState = {
      status: 'active',
      retryCount: 0,
      nextRetryAtMs: null,
      graceEndsAtMs: null,
      suspensionEndsAtMs: null,
    };

    const t1 = advanceDunningState(state, 'payment_failed', '2026-06-01T00:00:00Z');
    expect(t1.nextState.status).toBe('past_due');
    expect(t1.nextState.retryCount).toBe(1);
    expect(t1.action).toBe('schedule_retry');

    const t2 = advanceDunningState(t1.nextState, 'payment_failed', '2026-06-02T00:00:00Z');
    expect(t2.nextState.status).toBe('past_due');
    expect(t2.nextState.retryCount).toBe(2);

    const t3 = advanceDunningState(t2.nextState, 'payment_failed', '2026-06-05T00:00:00Z');
    expect(t3.nextState.status).toBe('grace');
    expect(t3.action).toBe('enter_grace_period');
    expect(t3.nextState.graceEndsAtMs).not.toBeNull();

    // Recovery from grace restores active & resets retryCount
    const recovered = advanceDunningState(
      t3.nextState,
      'payment_succeeded',
      '2026-06-06T00:00:00Z'
    );
    expect(recovered.nextState.status).toBe('active');
    expect(recovered.nextState.retryCount).toBe(0);

    // Continue failure path: grace -> suspended -> canceled
    const t4 = advanceDunningState(t3.nextState, 'grace_expired', '2026-06-10T00:00:00Z');
    expect(t4.nextState.status).toBe('suspended');
    expect(t4.action).toBe('suspend_service');

    const t5 = advanceDunningState(t4.nextState, 'suspension_expired', '2026-06-24T00:00:00Z');
    expect(t5.nextState.status).toBe('canceled');
    expect(t5.action).toBe('cancel_subscription');
  });
});

describe('MRR/ARR & Cohort Net Retention Calculator', () => {
  it('normalizes intervals to MRR/ARR and computes NDR/GDR in basis points', () => {
    const startSnapshot: SubscriptionRevenueRecord[] = [
      { customerId: 'c1', interval: 'monthly', intervalPriceCents: 10_000, status: 'active' }, // 10_000
      { customerId: 'c2', interval: 'annual', intervalPriceCents: 120_000, status: 'active' }, // 10_000
      { customerId: 'c3', interval: 'quarterly', intervalPriceCents: 15_000, status: 'active' }, // 5_000
    ];

    const metrics = calculateMrrAndArr(startSnapshot);
    expect(metrics.activeSubscriptions).toBe(3);
    expect(metrics.mrrCents).toBe(25_000);
    expect(metrics.arrCents).toBe(300_000);

    const endSnapshot: SubscriptionRevenueRecord[] = [
      { customerId: 'c1', interval: 'monthly', intervalPriceCents: 15_000, status: 'active' }, // +5_000 expansion
      { customerId: 'c2', interval: 'annual', intervalPriceCents: 96_000, status: 'active' }, // -2_000 contraction (8_000)
      { customerId: 'c3', interval: 'quarterly', intervalPriceCents: 15_000, status: 'canceled' }, // -5_000 churn
      { customerId: 'c4', interval: 'monthly', intervalPriceCents: 20_000, status: 'active' }, // +20_000 new
    ];

    const cohort = calculateCohortRetention(startSnapshot, endSnapshot);
    expect(cohort.startingMrrCents).toBe(25_000);
    expect(cohort.expansionMrrCents).toBe(5_000);
    expect(cohort.contractionMrrCents).toBe(2_000);
    expect(cohort.churnedMrrCents).toBe(5_000);
    expect(cohort.newMrrCents).toBe(20_000);
    expect(cohort.endingMrrCents).toBe(43_000);
    // NDR = (25_000 + 5_000 - 2_000 - 5_000) / 25_000 = 23_000 / 25_000 = 92.00% (9200 bps)
    expect(cohort.netDollarRetentionBps).toBe(9200);
    // GDR = (25_000 - 2_000 - 5_000) / 25_000 = 18_000 / 25_000 = 72.00% (7200 bps)
    expect(cohort.grossDollarRetentionBps).toBe(7200);
  });
});
