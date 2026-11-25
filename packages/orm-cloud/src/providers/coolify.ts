export interface CoolifyDeployParams {
  readonly endpoint: string;
  readonly token: string;
  readonly appUuid: string;
  readonly fetchImpl?: typeof fetch;
  /** Provider correlation ID, echoed back so retries never lose it. */
  readonly correlationId?: string;
}

export interface CoolifyDeployResult {
  readonly deploymentUuid?: string;
  readonly message: string;
}

export async function deployViaCoolify(params: CoolifyDeployParams): Promise<CoolifyDeployResult> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const baseUrl = params.endpoint.replace(/\/+$/u, '');
  const response = await fetchImpl(
    `${baseUrl}/api/v1/deploy?uuid=${encodeURIComponent(params.appUuid)}&force=true`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${params.token}`,
        'content-type': 'application/json',
        ...(params.correlationId ? { 'x-moonwitness-correlation-id': params.correlationId } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!response.ok) {
    throw new Error(`Coolify deploy failed (${response.status})`);
  }

  const payload = (await response.json()) as { deployment_uuid?: string; message?: string };
  return {
    deploymentUuid: payload.deployment_uuid,
    message: payload.message ?? 'Deployment triggered',
  };
}

/*
 * CF-006 / cloud deployment state machine & provider-state reconciliation
 * ---------------------------------------------------------------------------
 * The database is the canonical application record. A provider response is an
 * OBSERVATION, never an authority that may overwrite committed state.
 *
 * States (aligned with CloudDeployment.status):
 *   pending  -> initial record created before any provider call
 *   building -> provider accepted the deployment (correlation ID recorded)
 *   running  -> terminal success (container/application serving)
 *   failed   -> terminal failure
 *   stopped  -> terminal cancellation / suspension
 *   unknown  -> ambiguous provider outcome; bounded reconciliation required
 *
 * ALLOWED TRANSITIONS
 *   pending  -> building | running | failed | stopped | unknown
 *   building -> running | failed | stopped | unknown
 *   unknown  -> running | failed | stopped | building
 *   running  -> failed | stopped              (a serving app may die/stop)
 *   failed   -> (none)                        TERMINAL
 *   stopped  -> (none)                        TERMINAL
 *
 * Duplicate/out-of-order events are no-ops. Once `failed` or `stopped` is
 * committed, no provider event — including a late success — can regress it.
 * Ambiguous outcomes (`timeout`, `ambiguous`) stay `unknown` until a bounded
 * reconciliation (max 2 attempts) resolves them; unresolved ones are flagged
 * for operator review rather than guessed.
 */

export type CloudDeploymentState =
  'pending' | 'building' | 'running' | 'failed' | 'stopped' | 'unknown';

export const TERMINAL_DEPLOYMENT_STATES: ReadonlySet<CloudDeploymentState> = new Set([
  'failed',
  'stopped',
]);

export const ALLOWED_DEPLOYMENT_TRANSITIONS: Readonly<
  Record<CloudDeploymentState, readonly CloudDeploymentState[]>
> = Object.freeze({
  pending: [
    'building',
    'running',
    'failed',
    'stopped',
    'unknown',
  ] as readonly CloudDeploymentState[],
  building: ['running', 'failed', 'stopped', 'unknown'] as readonly CloudDeploymentState[],
  unknown: ['building', 'running', 'failed', 'stopped'] as readonly CloudDeploymentState[],
  running: ['failed', 'stopped'] as readonly CloudDeploymentState[],
  failed: [] as readonly CloudDeploymentState[],
  stopped: [] as readonly CloudDeploymentState[],
});

export type DeploymentEventKind =
  | 'provider_started'
  | 'provider_succeeded'
  | 'provider_failed'
  | 'provider_timeout'
  | 'provider_cancelled'
  | 'retry_scheduled'
  | 'reconciled_success'
  | 'reconciled_missing';

export interface DeploymentEvent {
  readonly kind: DeploymentEventKind;
  readonly observedAt: string;
  readonly providerCorrelationId?: string;
  readonly sequence?: number;
}

export interface DeploymentStateTransition {
  readonly from: CloudDeploymentState;
  readonly to: CloudDeploymentState;
  readonly changed: boolean;
  readonly terminalProtected: boolean;
  readonly reason: string;
  readonly providerCorrelationId?: string;
}

const EVENT_TARGET_STATE: Readonly<Record<DeploymentEventKind, CloudDeploymentState>> = {
  provider_started: 'building',
  provider_succeeded: 'running',
  provider_failed: 'failed',
  provider_timeout: 'unknown',
  provider_cancelled: 'stopped',
  retry_scheduled: 'pending',
  reconciled_success: 'running',
  reconciled_missing: 'failed',
};

export function applyDeploymentEvent(
  current: CloudDeploymentState,
  event: DeploymentEvent
): DeploymentStateTransition {
  if (TERMINAL_DEPLOYMENT_STATES.has(current)) {
    return {
      from: current,
      to: current,
      changed: false,
      terminalProtected: true,
      reason: `Terminal state "${current}" is final; ignored ${event.kind} (out-of-order or duplicate event)`,
      providerCorrelationId: event.providerCorrelationId,
    };
  }

  const target = EVENT_TARGET_STATE[event.kind];
  const allowed = ALLOWED_DEPLOYMENT_TRANSITIONS[current].includes(target);
  if (!allowed || target === current) {
    return {
      from: current,
      to: current,
      changed: false,
      terminalProtected: false,
      reason: `Ignored ${event.kind}: ${current} -> ${target} is not an allowed transition`,
      providerCorrelationId: event.providerCorrelationId,
    };
  }

  return {
    from: current,
    to: target,
    changed: true,
    terminalProtected: false,
    reason: `Applied ${event.kind}: ${current} -> ${target}`,
    providerCorrelationId: event.providerCorrelationId,
  };
}

export type ProviderObservation = 'running' | 'missing' | 'ambiguous' | 'timeout';

export interface DeploymentLocalRecord {
  readonly state: CloudDeploymentState;
  readonly providerCorrelationId?: string;
  readonly attempts: number;
}

export interface DeploymentReconciliation {
  readonly state: CloudDeploymentState;
  readonly resolved: boolean;
  readonly needsOperatorReview: boolean;
  readonly attemptsUsed: number;
  readonly reason: string;
  readonly providerCorrelationId?: string;
}

export const MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS = 2;

/**
 * Bounded reconciliation of unknown/ambiguous provider outcomes. The provider
 * correlation ID is carried through unchanged; it is never replaced by an
 * inferred identifier. Missing resources fail closed; still-ambiguous
 * outcomes remain `unknown` and escalate after the bounded attempt budget.
 */
export function reconcileDeploymentOutcome(
  local: DeploymentLocalRecord,
  observation: ProviderObservation,
  attempts?: number
): DeploymentReconciliation {
  const attemptsUsed = Math.max(0, Math.floor(attempts ?? local.attempts ?? 0));
  if (TERMINAL_DEPLOYMENT_STATES.has(local.state)) {
    return {
      state: local.state,
      resolved: true,
      needsOperatorReview: false,
      attemptsUsed,
      reason: `Local state "${local.state}" is terminal; provider observation ignored`,
      providerCorrelationId: local.providerCorrelationId,
    };
  }
  if (observation === 'running') {
    return {
      state: 'running',
      resolved: true,
      needsOperatorReview: false,
      attemptsUsed,
      reason: `Provider reports deployment ${local.providerCorrelationId ?? '(unknown id)'} running`,
      providerCorrelationId: local.providerCorrelationId,
    };
  }
  if (observation === 'missing') {
    return {
      state: 'failed',
      resolved: true,
      needsOperatorReview: false,
      attemptsUsed,
      reason: `Provider has no resource for correlation ${local.providerCorrelationId ?? '(unknown id)'}; failing closed`,
      providerCorrelationId: local.providerCorrelationId,
    };
  }
  if (attemptsUsed >= MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS) {
    return {
      state: 'unknown',
      resolved: false,
      needsOperatorReview: true,
      attemptsUsed: MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS,
      reason: `Bounded reconciliation exhausted after ${MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS} attempts; operator review required`,
      providerCorrelationId: local.providerCorrelationId,
    };
  }
  return {
    state: 'unknown',
    resolved: false,
    needsOperatorReview: false,
    attemptsUsed: attemptsUsed + 1,
    reason: `Provider outcome ${observation} still ambiguous; retry reconciliation within bounded budget`,
    providerCorrelationId: local.providerCorrelationId,
  };
}

export interface DeploymentRetryPlanInput {
  readonly deploymentId: number | string;
  readonly state: CloudDeploymentState;
  readonly providerCorrelationId?: string;
  readonly attempts: number;
  readonly maxAttempts?: number;
}

export interface DeploymentRetryPlan {
  readonly idempotencyKey: string;
  readonly providerCorrelationId?: string;
  readonly attempt: number;
  readonly shouldRetry: boolean;
  readonly reason: string;
}

/**
 * A retry reuses a deterministic idempotency key derived from the deployment
 * ID and the ORIGINAL provider correlation ID, so a retried deployment cannot
 * create a duplicate remote resource or lose its correlation ID.
 */
export function planDeploymentRetry(input: DeploymentRetryPlanInput): DeploymentRetryPlan {
  const attempt = Math.max(1, Math.floor(input.attempts) + 1);
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 3));
  const idempotencyKey = `deploy:${input.deploymentId}:${input.providerCorrelationId ?? 'uncorrelated'}`;
  const terminal = TERMINAL_DEPLOYMENT_STATES.has(input.state);
  const shouldRetry = !terminal && attempt <= maxAttempts;
  return {
    idempotencyKey,
    providerCorrelationId: input.providerCorrelationId,
    attempt,
    shouldRetry,
    reason: terminal
      ? `Deployment is terminal (${input.state}); no retry will be issued`
      : shouldRetry
        ? `Retry ${attempt}/${maxAttempts} with stable idempotency key ${idempotencyKey}`
        : `Retry budget exhausted (${maxAttempts}); operator review required`,
  };
}
