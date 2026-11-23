export interface ProrationInput {
  /** Current plan total price for the full billing cycle in integer cents */
  currentPlanPeriodCents: number;
  /** New plan total price for the full billing cycle in integer cents */
  newPlanPeriodCents: number;
  /** Billing cycle start timestamp (epoch ms or ISO string) */
  cycleStart: string | number | Date;
  /** Billing cycle end timestamp (epoch ms or ISO string) */
  cycleEnd: string | number | Date;
  /** Effective change timestamp (epoch ms or ISO string) */
  changeAt: string | number | Date;
  /** Optional current seat/unit quantity (default 1) */
  currentQuantity?: number;
  /** Optional new seat/unit quantity (default 1) */
  newQuantity?: number;
}

export interface ProrationResult {
  totalCycleMs: number;
  elapsedMs: number;
  remainingMs: number;
  unusedCreditCents: number;
  newPlanChargeCents: number;
  /** Positive = immediate charge (upgrade), negative = credit (downgrade), 0 = no-op */
  netProrationCents: number;
  direction: 'upgrade' | 'downgrade' | 'neutral';
}

function toEpochMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

/**
 * Integer-cent mid-cycle plan upgrade/downgrade proration calculator.
 */
export function calculateMidCycleProration(input: ProrationInput): ProrationResult {
  assertNonNegativeInt(input.currentPlanPeriodCents, 'currentPlanPeriodCents');
  assertNonNegativeInt(input.newPlanPeriodCents, 'newPlanPeriodCents');

  const currentQty = input.currentQuantity ?? 1;
  const newQty = input.newQuantity ?? 1;
  if (!Number.isInteger(currentQty) || currentQty <= 0) {
    throw new Error('currentQuantity must be a positive integer');
  }
  if (!Number.isInteger(newQty) || newQty <= 0) {
    throw new Error('newQuantity must be a positive integer');
  }

  const startMs = toEpochMs(input.cycleStart);
  const endMs = toEpochMs(input.cycleEnd);
  const changeMs = toEpochMs(input.changeAt);

  if (endMs <= startMs) {
    throw new Error('cycleEnd must be strictly after cycleStart');
  }
  if (changeMs < startMs || changeMs > endMs) {
    throw new Error('changeAt must fall within [cycleStart, cycleEnd]');
  }

  const totalCycleMs = endMs - startMs;
  const elapsedMs = changeMs - startMs;
  const remainingMs = endMs - changeMs;

  const oldTotalCents = input.currentPlanPeriodCents * currentQty;
  const newTotalCents = input.newPlanPeriodCents * newQty;

  const unusedCreditCents = Math.round((oldTotalCents * remainingMs) / totalCycleMs);
  const newPlanChargeCents = Math.round((newTotalCents * remainingMs) / totalCycleMs);
  const netProrationCents = newPlanChargeCents - unusedCreditCents;

  const direction =
    netProrationCents > 0 ? 'upgrade' : netProrationCents < 0 ? 'downgrade' : 'neutral';

  return {
    totalCycleMs,
    elapsedMs,
    remainingMs,
    unusedCreditCents,
    newPlanChargeCents,
    netProrationCents,
    direction,
  };
}

export type DunningStatus = 'active' | 'past_due' | 'grace' | 'suspended' | 'canceled';

export type DunningEvent =
  | 'payment_failed'
  | 'payment_succeeded'
  | 'grace_expired'
  | 'suspension_expired'
  | 'manual_cancel'
  | 'reactivate';

export interface DunningPolicy {
  /** Number of failed attempts before transitioning from past_due to grace */
  maxRetries: number;
  /** Days after failure for each retry attempt */
  retryScheduleDays: readonly number[];
  /** Days spent in grace period before suspension */
  gracePeriodDays: number;
  /** Days spent in suspended state before cancellation */
  suspensionWindowDays: number;
}

export interface DunningState {
  status: DunningStatus;
  retryCount: number;
  nextRetryAtMs: number | null;
  graceEndsAtMs: number | null;
  suspensionEndsAtMs: number | null;
}

export interface DunningTransitionResult {
  previousStatus: DunningStatus;
  nextState: DunningState;
  action:
    | 'none'
    | 'schedule_retry'
    | 'enter_grace_period'
    | 'suspend_service'
    | 'cancel_subscription'
    | 'restore_active';
  reason: string;
}

export const DEFAULT_DUNNING_POLICY: Readonly<DunningPolicy> = {
  maxRetries: 3,
  retryScheduleDays: [1, 3, 7],
  gracePeriodDays: 5,
  suspensionWindowDays: 14,
};

const MS_PER_DAY = 86_400_000;

/**
 * Deterministic multi-stage dunning retry & grace-period state machine:
 * active -> past_due -> grace -> suspended -> canceled
 */
export function advanceDunningState(
  current: DunningState,
  event: DunningEvent,
  now: string | number | Date,
  policy: DunningPolicy = DEFAULT_DUNNING_POLICY
): DunningTransitionResult {
  const nowMs = toEpochMs(now);

  if (event === 'manual_cancel') {
    return {
      previousStatus: current.status,
      nextState: {
        status: 'canceled',
        retryCount: current.retryCount,
        nextRetryAtMs: null,
        graceEndsAtMs: null,
        suspensionEndsAtMs: null,
      },
      action: 'cancel_subscription',
      reason: 'Subscription manually canceled',
    };
  }

  if (event === 'payment_succeeded') {
    if (current.status === 'canceled') {
      throw new Error('Cannot apply payment_succeeded to a canceled subscription; use reactivate');
    }
    return {
      previousStatus: current.status,
      nextState: {
        status: 'active',
        retryCount: 0,
        nextRetryAtMs: null,
        graceEndsAtMs: null,
        suspensionEndsAtMs: null,
      },
      action: 'restore_active',
      reason: 'Payment succeeded; subscription restored to active',
    };
  }

  if (event === 'reactivate') {
    return {
      previousStatus: current.status,
      nextState: {
        status: 'active',
        retryCount: 0,
        nextRetryAtMs: null,
        graceEndsAtMs: null,
        suspensionEndsAtMs: null,
      },
      action: 'restore_active',
      reason: 'Subscription reactivated',
    };
  }

  if (event === 'payment_failed') {
    if (current.status === 'active' || current.status === 'past_due') {
      const nextRetryCount = current.retryCount + 1;
      if (nextRetryCount >= policy.maxRetries) {
        return {
          previousStatus: current.status,
          nextState: {
            status: 'grace',
            retryCount: nextRetryCount,
            nextRetryAtMs: null,
            graceEndsAtMs: nowMs + policy.gracePeriodDays * MS_PER_DAY,
            suspensionEndsAtMs: null,
          },
          action: 'enter_grace_period',
          reason: `Max retries (${policy.maxRetries}) reached; entering ${policy.gracePeriodDays}-day grace period`,
        };
      }

      const delayDays =
        policy.retryScheduleDays[nextRetryCount - 1] ??
        policy.retryScheduleDays[policy.retryScheduleDays.length - 1] ??
        1;

      return {
        previousStatus: current.status,
        nextState: {
          status: 'past_due',
          retryCount: nextRetryCount,
          nextRetryAtMs: nowMs + delayDays * MS_PER_DAY,
          graceEndsAtMs: null,
          suspensionEndsAtMs: null,
        },
        action: 'schedule_retry',
        reason: `Payment failed (attempt ${nextRetryCount}/${policy.maxRetries}); retry scheduled in ${delayDays}d`,
      };
    }

    return {
      previousStatus: current.status,
      nextState: { ...current },
      action: 'none',
      reason: `Payment failure ignored in state ${current.status}`,
    };
  }

  if (event === 'grace_expired') {
    if (current.status !== 'grace') {
      throw new Error(`Cannot expire grace period from status ${current.status}`);
    }
    return {
      previousStatus: current.status,
      nextState: {
        status: 'suspended',
        retryCount: current.retryCount,
        nextRetryAtMs: null,
        graceEndsAtMs: null,
        suspensionEndsAtMs: nowMs + policy.suspensionWindowDays * MS_PER_DAY,
      },
      action: 'suspend_service',
      reason: `Grace period expired; service suspended for ${policy.suspensionWindowDays}d`,
    };
  }

  if (event === 'suspension_expired') {
    if (current.status !== 'suspended') {
      throw new Error(`Cannot expire suspension from status ${current.status}`);
    }
    return {
      previousStatus: current.status,
      nextState: {
        status: 'canceled',
        retryCount: current.retryCount,
        nextRetryAtMs: null,
        graceEndsAtMs: null,
        suspensionEndsAtMs: null,
      },
      action: 'cancel_subscription',
      reason: 'Suspension window expired; subscription canceled',
    };
  }

  return {
    previousStatus: current.status,
    nextState: { ...current },
    action: 'none',
    reason: 'No transition',
  };
}

export type BillingInterval = 'monthly' | 'quarterly' | 'annual';

export interface SubscriptionRevenueRecord {
  customerId: string;
  interval: BillingInterval;
  /** Recurring price per billing interval in integer cents */
  intervalPriceCents: number;
  /** Active seat/unit quantity (default 1) */
  quantity?: number;
  /** Only active/past_due/grace subscriptions count toward active MRR by default */
  status: DunningStatus;
}

export interface RevenueMetricsResult {
  activeSubscriptions: number;
  mrrCents: number;
  arrCents: number;
}

export interface CohortRetentionResult {
  startingMrrCents: number;
  newMrrCents: number;
  expansionMrrCents: number;
  contractionMrrCents: number;
  churnedMrrCents: number;
  endingMrrCents: number;
  /** Net Dollar Retention in basis points (10000 = 100.00%) */
  netDollarRetentionBps: number;
  /** Gross Dollar Retention in basis points (10000 = 100.00%, capped at 10000) */
  grossDollarRetentionBps: number;
}

const REVENUE_ACTIVE_STATUSES: ReadonlySet<DunningStatus> = new Set([
  'active',
  'past_due',
  'grace',
]);

/**
 * Normalizes a subscription record to integer-cent Monthly Recurring Revenue (MRR).
 */
export function normalizeToMrrCents(record: SubscriptionRevenueRecord): number {
  assertNonNegativeInt(record.intervalPriceCents, 'intervalPriceCents');
  const qty = record.quantity ?? 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('quantity must be a positive integer');
  }
  if (!REVENUE_ACTIVE_STATUSES.has(record.status)) {
    return 0;
  }

  const totalIntervalCents = record.intervalPriceCents * qty;
  switch (record.interval) {
    case 'monthly':
      return totalIntervalCents;
    case 'quarterly':
      return Math.round(totalIntervalCents / 3);
    case 'annual':
      return Math.round(totalIntervalCents / 12);
  }
}

/**
 * Calculates aggregate integer-cent MRR and ARR across a set of subscriptions.
 */
export function calculateMrrAndArr(
  records: readonly SubscriptionRevenueRecord[]
): RevenueMetricsResult {
  let activeSubscriptions = 0;
  let mrrCents = 0;

  for (const record of records) {
    const normalized = normalizeToMrrCents(record);
    if (normalized > 0) {
      activeSubscriptions += 1;
      mrrCents += normalized;
    }
  }

  return {
    activeSubscriptions,
    mrrCents,
    arrCents: mrrCents * 12,
  };
}

/**
 * Deterministic MRR cohort retention calculator (NDR & GDR in basis points).
 */
export function calculateCohortRetention(
  startSnapshot: readonly SubscriptionRevenueRecord[],
  endSnapshot: readonly SubscriptionRevenueRecord[]
): CohortRetentionResult {
  const startByCustomer = new Map<string, number>();
  for (const rec of startSnapshot) {
    const mrr = normalizeToMrrCents(rec);
    if (mrr > 0) {
      startByCustomer.set(rec.customerId, (startByCustomer.get(rec.customerId) ?? 0) + mrr);
    }
  }

  const endByCustomer = new Map<string, number>();
  for (const rec of endSnapshot) {
    const mrr = normalizeToMrrCents(rec);
    if (mrr > 0) {
      endByCustomer.set(rec.customerId, (endByCustomer.get(rec.customerId) ?? 0) + mrr);
    }
  }

  let startingMrrCents = 0;
  let newMrrCents = 0;
  let expansionMrrCents = 0;
  let contractionMrrCents = 0;
  let churnedMrrCents = 0;
  let endingMrrCents = 0;

  for (const [customerId, startMrr] of startByCustomer.entries()) {
    startingMrrCents += startMrr;
    const endMrr = endByCustomer.get(customerId) ?? 0;
    if (endMrr === 0) {
      churnedMrrCents += startMrr;
    } else if (endMrr > startMrr) {
      expansionMrrCents += endMrr - startMrr;
    } else if (endMrr < startMrr) {
      contractionMrrCents += startMrr - endMrr;
    }
  }

  for (const [customerId, endMrr] of endByCustomer.entries()) {
    endingMrrCents += endMrr;
    if (!startByCustomer.has(customerId)) {
      newMrrCents += endMrr;
    }
  }

  const retainedWithExpansion =
    startingMrrCents + expansionMrrCents - contractionMrrCents - churnedMrrCents;
  const retainedGross = startingMrrCents - contractionMrrCents - churnedMrrCents;

  const netDollarRetentionBps =
    startingMrrCents > 0 ? Math.round((retainedWithExpansion * 10000) / startingMrrCents) : 0;
  const grossDollarRetentionBps =
    startingMrrCents > 0 ? Math.round((retainedGross * 10000) / startingMrrCents) : 0;

  return {
    startingMrrCents,
    newMrrCents,
    expansionMrrCents,
    contractionMrrCents,
    churnedMrrCents,
    endingMrrCents,
    netDollarRetentionBps,
    grossDollarRetentionBps,
  };
}
