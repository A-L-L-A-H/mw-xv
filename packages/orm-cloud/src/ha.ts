export interface HaTargetCandidate {
  readonly id: number;
  readonly name: string;
  readonly priority?: number | null;
  readonly health_status?: string | null;
  readonly is_active: boolean;
}

export function selectHealthyDeploymentTarget<T extends HaTargetCandidate>(
  targets: readonly T[]
): T | undefined {
  const active = targets.filter((t) => t.is_active && t.health_status !== 'offline');
  if (active.length === 0) return undefined;

  const healthy = active.filter((t) => (t.health_status ?? 'healthy') === 'healthy');
  const pool = healthy.length > 0 ? healthy : active;
  return [...pool].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id - b.id)[0];
}

/*
 * CF-009 / HA stale-target fencing contract
 * ---------------------------------------------------------------------------
 * MONOTONIC GENERATION RULE: every HA ownership change must obtain a strictly
 * greater fencing generation than the currently committed one. The durable
 * record (owned by the ORM transaction that writes the deployment target) is
 * authoritative; generation is never inferred from wall-clock time alone.
 *
 *  1. `nextHaGeneration(current)` issues `current + 1` (first claim = 1).
 *  2. A claim is granted only when `claim.generation > current.generation`.
 *     An equal generation from a different target is a conflict, a lower one
 *     is stale; both are rejected without mutating the committed record.
 *  3. Heartbeats and health/ownership writes carrying a generation lower than
 *     the committed one are dropped: a partitioned node cannot overwrite newer
 *     state. Equal generation from a different target is also dropped.
 *  4. Concurrent failover claims are resolved deterministically and
 *     order-independently by (generation DESC, claimedAtMs ASC, targetId ASC).
 *  5. A recovered old node keeps its previous generation and rejoins as a
 *     standby. It never automatically reclaims authority; an operator claim
 *     with a strictly newer generation is required.
 *
 * The helpers below are pure; the ORM transaction is the serialization
 * authority in production (conditional UPDATE on generation inside the same
 * transaction that writes `health_status` / `is_active`).
 */

export interface HaOwnershipState {
  readonly targetId: string;
  readonly generation: number;
  readonly claimedAtMs: number;
  readonly active: boolean;
  readonly health_status?: string | null;
}

export interface HaFencingClaim {
  readonly targetId: string;
  readonly generation: number;
  readonly claimedAtMs: number;
}

export type HaFencingRejectCode =
  'INVALID_GENERATION' | 'STALE_GENERATION' | 'EQUAL_GENERATION_CONFLICT';

export interface HaFencingDecision {
  readonly granted: boolean;
  readonly code?: HaFencingRejectCode;
  readonly reason: string;
  readonly state: HaOwnershipState;
}

export interface HaFencedHeartbeat {
  readonly targetId: string;
  readonly generation: number;
  readonly health_status: 'healthy' | 'degraded' | 'offline';
  readonly observedAtMs: number;
}

export interface HaHeartbeatDecision {
  readonly applied: boolean;
  readonly reason: string;
  readonly state: HaOwnershipState;
}

export interface HaRecoveryPlan {
  readonly nodeId: string;
  readonly role: 'active' | 'standby';
  readonly generation: number;
  readonly reason: string;
}

export const HA_FENCING_RULE =
  'ownership changes require a strictly greater generation; stale heartbeats and recovered nodes cannot overwrite or reclaim committed ownership' as const;

export function nextHaGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) return 1;
  return current + 1;
}

export function tryClaimHaOwnership(
  current: HaOwnershipState,
  claim: HaFencingClaim
): HaFencingDecision {
  if (!Number.isSafeInteger(claim.generation) || claim.generation < 0) {
    return {
      granted: false,
      code: 'INVALID_GENERATION',
      reason: `Invalid fencing generation ${String(claim.generation)}`,
      state: current,
    };
  }
  if (claim.generation < current.generation) {
    return {
      granted: false,
      code: 'STALE_GENERATION',
      reason: `Target "${claim.targetId}" generation ${claim.generation} is stale vs committed ${current.generation}`,
      state: current,
    };
  }
  if (claim.generation === current.generation && claim.targetId !== current.targetId) {
    return {
      granted: false,
      code: 'EQUAL_GENERATION_CONFLICT',
      reason: `Target "${claim.targetId}" collides with committed generation ${current.generation} owned by "${current.targetId}"`,
      state: current,
    };
  }
  if (claim.generation === current.generation && claim.targetId === current.targetId) {
    return {
      granted: false,
      code: 'EQUAL_GENERATION_CONFLICT',
      reason: `Target "${claim.targetId}" already owns generation ${current.generation}; a new ownership change requires a newer generation`,
      state: current,
    };
  }

  return {
    granted: true,
    reason: `Fencing generation advanced ${current.generation} -> ${claim.generation} for "${claim.targetId}"`,
    state: {
      targetId: claim.targetId,
      generation: claim.generation,
      claimedAtMs: claim.claimedAtMs,
      active: true,
      health_status: 'healthy',
    },
  };
}

export function applyFencedHeartbeat(
  current: HaOwnershipState,
  heartbeat: HaFencedHeartbeat
): HaHeartbeatDecision {
  if (
    heartbeat.generation < current.generation ||
    (heartbeat.generation === current.generation && heartbeat.targetId !== current.targetId)
  ) {
    return {
      applied: false,
      reason: `Dropped ${heartbeat.health_status} heartbeat from "${heartbeat.targetId}" (generation ${heartbeat.generation} <= committed ${current.generation})`,
      state: current,
    };
  }
  return {
    applied: true,
    reason: `Applied ${heartbeat.health_status} heartbeat from "${heartbeat.targetId}" at generation ${heartbeat.generation}`,
    state: {
      ...current,
      targetId: heartbeat.targetId,
      generation: heartbeat.generation,
      claimedAtMs: Math.max(current.claimedAtMs, heartbeat.observedAtMs),
      health_status: heartbeat.health_status,
      active: heartbeat.health_status !== 'offline',
    },
  };
}

export interface HaFailoverRaceResolution {
  readonly winner: HaFencingClaim | undefined;
  readonly ordered: readonly HaFencingClaim[];
}

/** Order-independent, deterministic resolution of concurrent failover claims. */
export function resolveHaFailoverRace(claims: readonly HaFencingClaim[]): HaFailoverRaceResolution {
  const ordered = [...claims].sort(
    (a, b) =>
      b.generation - a.generation ||
      a.claimedAtMs - b.claimedAtMs ||
      a.targetId.localeCompare(b.targetId)
  );
  return { winner: ordered[0], ordered };
}

/**
 * A recovered node rejoins as a standby unless an operator explicitly claims
 * ownership with a strictly newer generation. Recovery never auto-reclaims.
 */
export function planHaNodeRecovery(
  current: HaOwnershipState,
  recoveredNodeId: string,
  operatorClaimGeneration: number = current.generation
): HaRecoveryPlan {
  if (
    Number.isSafeInteger(operatorClaimGeneration) &&
    operatorClaimGeneration > current.generation &&
    recoveredNodeId !== current.targetId
  ) {
    return {
      nodeId: recoveredNodeId,
      role: 'active',
      generation: operatorClaimGeneration,
      reason: `Operator claim with newer generation ${operatorClaimGeneration} promotes "${recoveredNodeId}"`,
    };
  }
  return {
    nodeId: recoveredNodeId,
    role: 'standby',
    generation: current.generation,
    reason: `Recovered node "${recoveredNodeId}" keeps prior generation ${current.generation} and cannot automatically reclaim authority`,
  };
}
