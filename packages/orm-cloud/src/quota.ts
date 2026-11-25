export type PaasPlanTier = 'starter' | 'pro' | 'enterprise';

export interface PaasPlanLimits {
  readonly tier: PaasPlanTier;
  readonly maxApps: number;
  readonly maxRamMb: number;
  readonly maxCustomDomains: number;
  readonly allowDedicatedMesh: boolean;
}

export const DEFAULT_PAAS_PLANS: Readonly<Record<PaasPlanTier, PaasPlanLimits>> = Object.freeze({
  starter: Object.freeze({
    tier: 'starter',
    maxApps: 3,
    maxRamMb: 1024,
    maxCustomDomains: 1,
    allowDedicatedMesh: false,
  }),
  pro: Object.freeze({
    tier: 'pro',
    maxApps: 15,
    maxRamMb: 8192,
    maxCustomDomains: 10,
    allowDedicatedMesh: false,
  }),
  enterprise: Object.freeze({
    tier: 'enterprise',
    maxApps: 100,
    maxRamMb: 65536,
    maxCustomDomains: 100,
    allowDedicatedMesh: true,
  }),
});

export type PaasSubscriptionStatus =
  'active' | 'trialing' | 'past_due' | 'suspended' | 'cancelled' | 'expired' | 'pending';

export type PaasQuotaDenialCode =
  | 'SUBSCRIPTION_INACTIVE'
  | 'PAAS_PLAN_UNKNOWN'
  | 'PAAS_MAX_APPS_EXCEEDED'
  | 'PAAS_MAX_RAM_EXCEEDED'
  | 'PAAS_CUSTOM_DOMAIN_EXCEEDED'
  | 'PAAS_DEDICATED_MESH_NOT_ALLOWED'
  | 'PAAS_QUOTA_RESERVATION_EXCEEDED';

export interface TenantPaasQuotaInput {
  readonly tenantId: string;
  readonly plan: PaasPlanTier | (string & {});
  readonly subscriptionStatus: PaasSubscriptionStatus | (string & {});
  readonly currentApps: number;
  readonly currentRamMb: number;
  readonly currentCustomDomains: number;
  readonly requestedApps?: number;
  readonly requestedRamMb?: number;
  readonly requestedCustomDomains?: number;
  readonly requireDedicatedMesh?: boolean;
  readonly plans?: Readonly<Record<string, PaasPlanLimits>>;
}

export interface TenantPaasProjectedUsage {
  readonly apps: number;
  readonly ramMb: number;
  readonly customDomains: number;
}

export interface TenantPaasQuotaDecision {
  readonly allowed: boolean;
  readonly code?: PaasQuotaDenialCode;
  readonly reason: string;
  readonly tenantId: string;
  readonly plan: string;
  readonly limits?: PaasPlanLimits;
  readonly projectedUsage: TenantPaasProjectedUsage;
}

export class PaasQuotaExceededError extends Error {
  readonly code: PaasQuotaDenialCode;
  readonly decision: TenantPaasQuotaDecision;

  constructor(decision: TenantPaasQuotaDecision) {
    const code = decision.code ?? 'SUBSCRIPTION_INACTIVE';
    super(`PaaS quota denied [${code}] for tenant "${decision.tenantId}": ${decision.reason}`);
    this.name = 'PaasQuotaExceededError';
    this.code = code;
    this.decision = decision;
  }
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return Number.POSITIVE_INFINITY;
  return value;
}

export function evaluateTenantPaasQuota(input: TenantPaasQuotaInput): TenantPaasQuotaDecision {
  const normalizedPlan = input.plan.trim().toLowerCase();
  const normalizedStatus = input.subscriptionStatus.trim().toLowerCase();

  const projectedUsage: TenantPaasProjectedUsage = {
    apps: normalizeCount(input.currentApps, 0) + normalizeCount(input.requestedApps, 1),
    ramMb: normalizeCount(input.currentRamMb, 0) + normalizeCount(input.requestedRamMb, 0),
    customDomains:
      normalizeCount(input.currentCustomDomains, 0) +
      normalizeCount(input.requestedCustomDomains, 0),
  };

  if (normalizedStatus !== 'active') {
    return {
      allowed: false,
      code: 'SUBSCRIPTION_INACTIVE',
      reason: `Subscription status "${input.subscriptionStatus}" is not active`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      projectedUsage,
    };
  }

  const planCatalog: Readonly<Record<string, PaasPlanLimits>> = input.plans ?? DEFAULT_PAAS_PLANS;
  const limits = Object.prototype.hasOwnProperty.call(planCatalog, normalizedPlan)
    ? planCatalog[normalizedPlan]
    : undefined;

  if (!limits) {
    return {
      allowed: false,
      code: 'PAAS_PLAN_UNKNOWN',
      reason: `Unknown PaaS plan "${input.plan}"`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      projectedUsage,
    };
  }

  if (projectedUsage.apps > limits.maxApps) {
    return {
      allowed: false,
      code: 'PAAS_MAX_APPS_EXCEEDED',
      reason: `Projected app count (${projectedUsage.apps}) exceeds plan limit (${limits.maxApps})`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      limits,
      projectedUsage,
    };
  }

  if (projectedUsage.ramMb > limits.maxRamMb) {
    return {
      allowed: false,
      code: 'PAAS_MAX_RAM_EXCEEDED',
      reason: `Projected RAM (${projectedUsage.ramMb} MB) exceeds plan limit (${limits.maxRamMb} MB)`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      limits,
      projectedUsage,
    };
  }

  if (projectedUsage.customDomains > limits.maxCustomDomains) {
    return {
      allowed: false,
      code: 'PAAS_CUSTOM_DOMAIN_EXCEEDED',
      reason: `Projected custom domains (${projectedUsage.customDomains}) exceeds plan limit (${limits.maxCustomDomains})`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      limits,
      projectedUsage,
    };
  }

  if (input.requireDedicatedMesh && !limits.allowDedicatedMesh) {
    return {
      allowed: false,
      code: 'PAAS_DEDICATED_MESH_NOT_ALLOWED',
      reason: `Plan "${normalizedPlan}" does not allow dedicated mesh nodes`,
      tenantId: input.tenantId,
      plan: normalizedPlan,
      limits,
      projectedUsage,
    };
  }

  return {
    allowed: true,
    reason: 'Quota check passed',
    tenantId: input.tenantId,
    plan: normalizedPlan,
    limits,
    projectedUsage,
  };
}

export type SubscriptionEnforcementAction = 'stop' | 'resume' | 'noop';

export interface SubscriptionEnforcementInput {
  readonly tenantId: string;
  readonly previousStatus: PaasSubscriptionStatus | (string & {});
  readonly nextStatus: PaasSubscriptionStatus | (string & {});
  readonly appIds: readonly string[];
  readonly reason?: string;
  readonly correlationId?: string;
  readonly evaluatedAt?: string;
}

export interface SubscriptionEnforcementOperation {
  readonly appId: string;
  readonly action: Exclude<SubscriptionEnforcementAction, 'noop'>;
}

export interface SubscriptionEnforcementAudit {
  readonly tenantId: string;
  readonly previousStatus: string;
  readonly nextStatus: string;
  readonly action: SubscriptionEnforcementAction;
  readonly reason: string;
  readonly affectedAppCount: number;
  readonly correlationId?: string;
  readonly evaluatedAt: string;
}

export interface SubscriptionEnforcementPlan {
  readonly action: SubscriptionEnforcementAction;
  readonly targetAppIds: readonly string[];
  readonly operations: readonly SubscriptionEnforcementOperation[];
  readonly audit: SubscriptionEnforcementAudit;
}

const REACTIVATION_SOURCE_STATUSES = new Set<string>([
  'suspended',
  'cancelled',
  'past_due',
  'expired',
]);

export function planSubscriptionEnforcement(
  input: SubscriptionEnforcementInput
): SubscriptionEnforcementPlan {
  const previousStatus = input.previousStatus.trim().toLowerCase();
  const nextStatus = input.nextStatus.trim().toLowerCase();
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();

  const normalizedAppIds = Array.from(
    new Set(input.appIds.map((id) => id.trim()).filter((id) => id.length > 0))
  ).sort((left, right) => left.localeCompare(right));

  let action: SubscriptionEnforcementAction = 'noop';
  let defaultReason = `No enforcement action required for transition ${previousStatus} -> ${nextStatus}`;

  if (nextStatus === 'suspended' || nextStatus === 'cancelled') {
    action = 'stop';
    defaultReason = `Subscription transitioned to ${nextStatus}; stopping tenant apps`;
  } else if (nextStatus === 'active' && REACTIVATION_SOURCE_STATUSES.has(previousStatus)) {
    action = 'resume';
    defaultReason = `Subscription reactivated from ${previousStatus} to active; resuming tenant apps`;
  }

  const targetAppIds: readonly string[] = action === 'noop' ? [] : normalizedAppIds;
  const operations: readonly SubscriptionEnforcementOperation[] =
    action === 'noop'
      ? []
      : targetAppIds.map((appId) => ({
          appId,
          action,
        }));

  return {
    action,
    targetAppIds,
    operations,
    audit: {
      tenantId: input.tenantId,
      previousStatus,
      nextStatus,
      action,
      reason: input.reason ?? defaultReason,
      affectedAppCount: targetAppIds.length,
      correlationId: input.correlationId,
      evaluatedAt,
    },
  };
}

/*
 * CF-007 / concurrency-safe quota reservation
 * ---------------------------------------------------------------------------
 * A reservation is a two-phase claim against a (companyId, resource) scope:
 *   reserve() -> "reserved" (capacity held) -> commit()/release() (terminal).
 *
 * Atomicity contract: all reads/writes for one scope are serialized through a
 * per-scope promise chain, modelling the conditional
 * `UPDATE ... SET reserved = reserved + ? WHERE reserved + ? <= capacity`
 * executed inside the ORM transaction that owns the scope row. Two concurrent
 * reserve() calls therefore can never both consume the same remaining
 * capacity; the loser is denied with PAAS_QUOTA_RESERVATION_EXCEEDED.
 *
 * Idempotency contract: `idempotencyKey` is unique per scope, so a retried
 * reserve() returns the original reservation without holding capacity twice.
 * commit()/release()/settle() are idempotent state transitions; a failed
 * provider operation releases exactly once, and a successful settlement
 * records usage exactly once even under duplicate delivery.
 */

export interface QuotaReservationScope {
  readonly companyId: number;
  readonly resource: string;
}

export type QuotaReservationState = 'reserved' | 'committed' | 'released';

export interface QuotaReservation {
  readonly id: string;
  readonly scope: QuotaReservationScope;
  readonly idempotencyKey: string;
  readonly units: number;
  readonly state: QuotaReservationState;
  readonly createdAt: string;
}

export interface QuotaReservationInput {
  readonly scope: QuotaReservationScope;
  readonly idempotencyKey: string;
  readonly units: number;
  /** Plan limit snapshot for the scope, supplied by the authoritative transaction. */
  readonly capacity: number;
  readonly requestedAt?: string;
}

export interface QuotaReservationOutcome {
  readonly allowed: boolean;
  readonly code?: PaasQuotaDenialCode;
  readonly reason: string;
  readonly replay: boolean;
  readonly reservation?: QuotaReservation;
  readonly remainingUnits: number;
  readonly version: number;
}

export interface QuotaSettlementOutcome {
  /** false when the settlement was a duplicate replay. */
  readonly changed: boolean;
  readonly reservation: QuotaReservation;
  readonly usageRecorded: boolean;
  readonly reason: string;
}

export interface QuotaScopeSnapshot {
  readonly capacity: number;
  readonly committedUnits: number;
  readonly reservedUnits: number;
  readonly remainingUnits: number;
  readonly version: number;
}

interface QuotaScopeEntry {
  capacity: number;
  committedUnits: number;
  reservedUnits: number;
  version: number;
}

function quotaScopeKey(scope: QuotaReservationScope): string {
  return `${scope.companyId}:${scope.resource.trim().toLowerCase()}`;
}

export class PaasQuotaReservationLedger {
  private readonly scopes = new Map<string, QuotaScopeEntry>();
  private readonly reservations = new Map<string, QuotaReservation>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly scopeTails = new Map<string, Promise<unknown>>();
  private sequence = 0;

  /** Serializes check-and-set operations for one scope (the transaction authority). */
  private async inScope<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.scopeTails.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.scopeTails.set(
      key,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  private snapshotEntry(key: string): QuotaScopeSnapshot {
    const entry = this.scopes.get(key);
    if (!entry)
      return { capacity: 0, committedUnits: 0, reservedUnits: 0, remainingUnits: 0, version: 0 };
    return {
      capacity: entry.capacity,
      committedUnits: entry.committedUnits,
      reservedUnits: entry.reservedUnits,
      remainingUnits: Math.max(0, entry.capacity - entry.committedUnits - entry.reservedUnits),
      version: entry.version,
    };
  }

  snapshot(scope: QuotaReservationScope): QuotaScopeSnapshot {
    return this.snapshotEntry(quotaScopeKey(scope));
  }

  async reserve(input: QuotaReservationInput): Promise<QuotaReservationOutcome> {
    const key = quotaScopeKey(input.scope);
    return this.inScope(key, () => {
      if (!Number.isSafeInteger(input.units) || input.units <= 0) {
        return {
          allowed: false,
          code: 'PAAS_QUOTA_RESERVATION_EXCEEDED' as const,
          reason: 'Reservation units must be a positive safe integer',
          replay: false,
          remainingUnits: this.snapshotEntry(key).remainingUnits,
          version: this.snapshotEntry(key).version,
        };
      }

      const replayId = this.idempotencyIndex.get(`${key}:${input.idempotencyKey}`);
      if (replayId) {
        const replay = this.reservations.get(replayId)!;
        const snapshot = this.snapshotEntry(key);
        return {
          allowed: true,
          reason: `Idempotent replay of reservation "${replay.id}"; no capacity consumed twice`,
          replay: true,
          reservation: replay,
          remainingUnits: snapshot.remainingUnits,
          version: snapshot.version,
        };
      }

      if (!Number.isSafeInteger(input.capacity) || input.capacity < 0) {
        throw new Error('Quota capacity must be a non-negative safe integer');
      }

      let entry = this.scopes.get(key);
      if (!entry) {
        entry = { capacity: input.capacity, committedUnits: 0, reservedUnits: 0, version: 0 };
        this.scopes.set(key, entry);
      } else if (entry.capacity !== input.capacity) {
        throw new Error(
          `Quota capacity mismatch for scope "${key}": committed ${entry.capacity}, received ${input.capacity}`
        );
      }

      const remaining = Math.max(0, entry.capacity - entry.committedUnits - entry.reservedUnits);
      if (input.units > remaining) {
        return {
          allowed: false,
          code: 'PAAS_QUOTA_RESERVATION_EXCEEDED' as const,
          reason: `Requested ${input.units} unit(s) exceeds remaining capacity ${remaining} for scope "${key}"`,
          replay: false,
          remainingUnits: remaining,
          version: entry.version,
        };
      }

      this.sequence += 1;
      const reservation: QuotaReservation = {
        id: `qr-${this.sequence}`,
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        units: input.units,
        state: 'reserved',
        createdAt: input.requestedAt ?? new Date().toISOString(),
      };
      entry.reservedUnits += input.units;
      entry.version += 1;
      this.reservations.set(reservation.id, reservation);
      this.idempotencyIndex.set(`${key}:${input.idempotencyKey}`, reservation.id);

      return {
        allowed: true,
        reason: `Reserved ${input.units} unit(s) for scope "${key}"`,
        replay: false,
        reservation,
        remainingUnits: entry.capacity - entry.committedUnits - entry.reservedUnits,
        version: entry.version,
      };
    });
  }

  async commit(reservationId: string): Promise<QuotaSettlementOutcome> {
    return this.settleReservation(reservationId, 'commit');
  }

  async release(reservationId: string): Promise<QuotaSettlementOutcome> {
    return this.settleReservation(reservationId, 'release');
  }

  async settle(
    reservationId: string,
    outcome: 'success' | 'failure'
  ): Promise<QuotaSettlementOutcome> {
    return this.settleReservation(reservationId, outcome === 'success' ? 'commit' : 'release');
  }

  private async settleReservation(
    reservationId: string,
    target: 'commit' | 'release'
  ): Promise<QuotaSettlementOutcome> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`Unknown quota reservation "${reservationId}"`);
    const key = quotaScopeKey(reservation.scope);

    return this.inScope(key, () => {
      const current = this.reservations.get(reservationId)!;
      const entry = this.scopes.get(key)!;
      const settledState: QuotaReservationState = target === 'commit' ? 'committed' : 'released';
      if (current.state === settledState) {
        return {
          changed: false,
          reservation: current,
          usageRecorded: false,
          reason: `Duplicate ${target} settlement for "${reservationId}"; state unchanged`,
        };
      }
      if (current.state === 'released' && target === 'commit') {
        throw new Error(`Cannot commit released reservation "${reservationId}"`);
      }
      if (current.state === 'committed' && target === 'release') {
        throw new Error(`Cannot release already committed reservation "${reservationId}"`);
      }

      const nextState: QuotaReservationState = target === 'commit' ? 'committed' : 'released';
      const updated: QuotaReservation = { ...current, state: nextState };
      entry.reservedUnits -= current.units;
      if (target === 'commit') entry.committedUnits += current.units;
      entry.version += 1;
      this.reservations.set(reservationId, updated);

      return {
        changed: true,
        reservation: updated,
        usageRecorded: target === 'commit',
        reason:
          target === 'commit'
            ? `Committed reservation "${reservationId}"; usage recorded exactly once`
            : `Released reservation "${reservationId}"; capacity restored exactly once`,
      };
    });
  }
}
