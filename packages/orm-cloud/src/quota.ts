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
  | 'PAAS_DEDICATED_MESH_NOT_ALLOWED';

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
