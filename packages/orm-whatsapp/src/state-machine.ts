import { GowaError } from './runtime/gowa-client.js';

export const WHATSAPP_LIFECYCLE_STATES = [
  'uninitialized',
  'qr_pending',
  'qr_expired',
  'connected',
  'reconnecting',
  'disconnected',
  'blocked',
  'gateway_error',
] as const;

export type WhatsAppLifecycleState = (typeof WHATSAPP_LIFECYCLE_STATES)[number];

export type WhatsAppLifecycleEvent =
  | 'QR_ISSUED'
  | 'QR_EXPIRED'
  | 'CONNECTED'
  | 'RECONNECT_REQUESTED'
  | 'DISCONNECTED'
  | 'ORPHAN_DETECTED'
  | 'BLOCKED'
  | 'GATEWAY_ERROR'
  | 'RESET';

export interface AccountTransitionResult {
  readonly previousState: WhatsAppLifecycleState;
  readonly nextState: WhatsAppLifecycleState;
  readonly event: WhatsAppLifecycleEvent;
  readonly valid: boolean;
  readonly reason: string;
}

const ALLOWED_TRANSITIONS: Readonly<
  Record<
    WhatsAppLifecycleState,
    Readonly<Partial<Record<WhatsAppLifecycleEvent, WhatsAppLifecycleState>>>
  >
> = {
  uninitialized: {
    QR_ISSUED: 'qr_pending',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    GATEWAY_ERROR: 'gateway_error',
    BLOCKED: 'blocked',
  },
  qr_pending: {
    QR_ISSUED: 'qr_pending',
    QR_EXPIRED: 'qr_expired',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    GATEWAY_ERROR: 'gateway_error',
    BLOCKED: 'blocked',
    RESET: 'uninitialized',
  },
  qr_expired: {
    QR_ISSUED: 'qr_pending',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    GATEWAY_ERROR: 'gateway_error',
    RESET: 'uninitialized',
  },
  connected: {
    CONNECTED: 'connected',
    RECONNECT_REQUESTED: 'reconnecting',
    DISCONNECTED: 'disconnected',
    ORPHAN_DETECTED: 'disconnected',
    BLOCKED: 'blocked',
    GATEWAY_ERROR: 'gateway_error',
  },
  reconnecting: {
    CONNECTED: 'connected',
    QR_ISSUED: 'qr_pending',
    DISCONNECTED: 'disconnected',
    ORPHAN_DETECTED: 'disconnected',
    BLOCKED: 'blocked',
    GATEWAY_ERROR: 'gateway_error',
  },
  disconnected: {
    QR_ISSUED: 'qr_pending',
    RECONNECT_REQUESTED: 'reconnecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    BLOCKED: 'blocked',
    GATEWAY_ERROR: 'gateway_error',
    RESET: 'uninitialized',
  },
  blocked: {
    RESET: 'uninitialized',
    DISCONNECTED: 'disconnected',
    QR_ISSUED: 'qr_pending',
  },
  gateway_error: {
    QR_ISSUED: 'qr_pending',
    RECONNECT_REQUESTED: 'reconnecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    ORPHAN_DETECTED: 'disconnected',
    RESET: 'uninitialized',
  },
};

export function isWhatsAppLifecycleState(value: unknown): value is WhatsAppLifecycleState {
  return (
    typeof value === 'string' && (WHATSAPP_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

/**
 * Pure deterministic transition function for WhatsApp account lifecycle.
 */
export function transitionAccountState(
  currentState: WhatsAppLifecycleState,
  event: WhatsAppLifecycleEvent
): AccountTransitionResult {
  const next = ALLOWED_TRANSITIONS[currentState]?.[event];
  if (!next) {
    return {
      previousState: currentState,
      nextState: currentState,
      event,
      valid: false,
      reason: `Transition ${currentState} --(${event})--> rejected`,
    };
  }
  return {
    previousState: currentState,
    nextState: next,
    event,
    valid: true,
    reason: `Transition ${currentState} --(${event})--> ${next}`,
  };
}

/**
 * Normalized classification for GoWA v9.6.0 errors, including HTTP 500 responses
 * returned when a device slot is missing or evicted on the gateway.
 */
export type NormalizedGowaErrorCategory =
  'device_missing' | 'rate_limited' | 'auth_blocked' | 'gateway_unavailable' | 'client_error';

export interface NormalizedGowaError {
  readonly category: NormalizedGowaErrorCategory;
  readonly httpStatus: number;
  readonly upstreamStatus: number;
  readonly upstreamCode?: string;
  readonly shouldDemoteToDisconnected: boolean;
  readonly shouldTriggerOrphanRepair: boolean;
  readonly retryable: boolean;
  readonly message: string;
}

const MISSING_DEVICE_PATTERNS = [
  /device\s+not\s+found/iu,
  /no\s+such\s+device/iu,
  /device[_\s-]*missing/iu,
  /session\s+not\s+found/iu,
  /not\s+logged\s+in/iu,
  /unlinked/iu,
];

const AUTH_BLOCKED_PATTERNS = [
  /banned/iu,
  /blocked/iu,
  /logged\s*out/iu,
  /unauthorized\s+device/iu,
];

export function normalizeGowaError(error: unknown, detailText?: string): NormalizedGowaError {
  const statusCode = error instanceof GowaError ? error.statusCode : 502;
  const upstreamCode = error instanceof GowaError ? error.upstreamCode : undefined;
  const rawMessage = [
    error instanceof Error ? error.message : String(error ?? ''),
    upstreamCode ?? '',
    detailText ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (
    statusCode === 404 ||
    upstreamCode === 'DEVICE_NOT_FOUND' ||
    upstreamCode === 'NOT_FOUND' ||
    ((statusCode === 500 || statusCode === 400) &&
      MISSING_DEVICE_PATTERNS.some((pattern) => pattern.test(rawMessage)))
  ) {
    return {
      category: 'device_missing',
      httpStatus: 409,
      upstreamStatus: statusCode,
      upstreamCode,
      shouldDemoteToDisconnected: true,
      shouldTriggerOrphanRepair: true,
      retryable: false,
      message: 'WhatsApp device slot is missing or unlinked on gateway',
    };
  }

  if (statusCode === 429 || upstreamCode === 'RATE_LIMITED') {
    return {
      category: 'rate_limited',
      httpStatus: 429,
      upstreamStatus: statusCode,
      upstreamCode,
      shouldDemoteToDisconnected: false,
      shouldTriggerOrphanRepair: false,
      retryable: true,
      message: 'WhatsApp gateway rate limit exceeded',
    };
  }

  if (statusCode === 403 || AUTH_BLOCKED_PATTERNS.some((pattern) => pattern.test(rawMessage))) {
    return {
      category: 'auth_blocked',
      httpStatus: 403,
      upstreamStatus: statusCode,
      upstreamCode,
      shouldDemoteToDisconnected: true,
      shouldTriggerOrphanRepair: false,
      retryable: false,
      message: 'WhatsApp account is blocked or logged out',
    };
  }

  if (statusCode >= 500 || statusCode === 503 || upstreamCode === 'CIRCUIT_OPEN') {
    return {
      category: 'gateway_unavailable',
      httpStatus: 503,
      upstreamStatus: statusCode,
      upstreamCode,
      shouldDemoteToDisconnected: false,
      shouldTriggerOrphanRepair: false,
      retryable: true,
      message: 'WhatsApp gateway is temporarily unavailable',
    };
  }

  return {
    category: 'client_error',
    httpStatus: statusCode >= 400 && statusCode < 500 ? statusCode : 502,
    upstreamStatus: statusCode,
    upstreamCode,
    shouldDemoteToDisconnected: false,
    shouldTriggerOrphanRepair: false,
    retryable: false,
    message: 'WhatsApp gateway rejected the request',
  };
}

/**
 * Orphan-device detection & repair planning for GoWA v9.6.0.
 * When DB reports `connected` (or `reconnecting`) but GoWA reports the device as
 * absent or unlinked, demote cleanly to `disconnected` and recreate the slot
 * in-place without creating duplicate account rows.
 */
export interface OrphanDeviceCheckInput {
  readonly accountId: number;
  readonly companyId: number;
  readonly dbStatus: WhatsAppLifecycleState;
  readonly deviceId: string | null;
  readonly gatewayDeviceIds: readonly string[];
  readonly gatewayDeviceConnected?: boolean;
}

export interface OrphanDeviceRepairPlan {
  readonly isOrphan: boolean;
  readonly nextStatus: WhatsAppLifecycleState;
  readonly recreateSlot: boolean;
  readonly preserveAccountId: number;
  readonly patchFields: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export function planOrphanDeviceRepair(input: OrphanDeviceCheckInput): OrphanDeviceRepairPlan {
  const trackedActive = input.dbStatus === 'connected' || input.dbStatus === 'reconnecting';
  const missingInGateway = !input.deviceId || !input.gatewayDeviceIds.includes(input.deviceId);
  const unlinkedInGateway = input.gatewayDeviceConnected === false;

  if (!trackedActive || (!missingInGateway && !unlinkedInGateway)) {
    return {
      isOrphan: false,
      nextStatus: input.dbStatus,
      recreateSlot: false,
      preserveAccountId: input.accountId,
      patchFields: {},
      reason: 'Device state is consistent with gateway',
    };
  }

  const transition = transitionAccountState(input.dbStatus, 'ORPHAN_DETECTED');
  return {
    isOrphan: true,
    nextStatus: transition.nextState,
    recreateSlot: missingInGateway,
    preserveAccountId: input.accountId,
    patchFields: {
      status: transition.nextState,
      qr_code: null,
      last_error: missingInGateway
        ? 'Orphan device slot repaired: missing on gateway'
        : 'Orphan device slot repaired: unlinked on gateway',
    },
    reason: missingInGateway
      ? 'DB status active but device missing on GoWA v9.6.0; demoting to disconnected and recreating slot'
      : 'DB status active but device unlinked on GoWA v9.6.0; demoting to disconnected',
  };
}

/**
 * Reconnect-storm exponential backoff with jitter and max-attempt circuit breaker.
 */
export interface ReconnectStormOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxAttempts?: number;
  readonly jitterRatio?: number;
  readonly cooldownMs?: number;
  readonly rng?: () => number;
}

export interface ReconnectAttemptState {
  attempts: number;
  nextAllowedAt: number;
  circuitOpenUntil: number | null;
  lastErrorAt: number | null;
}

export interface ReconnectDecision {
  readonly allowed: boolean;
  readonly circuitOpen: boolean;
  readonly retryAfterMs: number;
  readonly attempts: number;
  readonly recommendedState: WhatsAppLifecycleState;
}

export class ReconnectStormBreaker {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly jitterRatio: number;
  private readonly cooldownMs: number;
  private readonly rng: () => number;
  private readonly states = new Map<string, ReconnectAttemptState>();

  constructor(options: ReconnectStormOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.jitterRatio = Math.min(Math.max(options.jitterRatio ?? 0.25, 0), 1);
    this.cooldownMs = options.cooldownMs ?? 300_000;
    this.rng = options.rng ?? Math.random;
  }

  canAttempt(accountKey: string, now = Date.now()): ReconnectDecision {
    const state = this.states.get(accountKey);
    if (!state) {
      return {
        allowed: true,
        circuitOpen: false,
        retryAfterMs: 0,
        attempts: 0,
        recommendedState: 'reconnecting',
      };
    }

    if (state.circuitOpenUntil !== null) {
      if (now < state.circuitOpenUntil) {
        return {
          allowed: false,
          circuitOpen: true,
          retryAfterMs: state.circuitOpenUntil - now,
          attempts: state.attempts,
          recommendedState: 'gateway_error',
        };
      }
      // Cooldown elapsed: allow half-open probe
      return {
        allowed: true,
        circuitOpen: false,
        retryAfterMs: 0,
        attempts: state.attempts,
        recommendedState: 'reconnecting',
      };
    }

    if (now < state.nextAllowedAt) {
      return {
        allowed: false,
        circuitOpen: false,
        retryAfterMs: state.nextAllowedAt - now,
        attempts: state.attempts,
        recommendedState: 'reconnecting',
      };
    }

    return {
      allowed: true,
      circuitOpen: false,
      retryAfterMs: 0,
      attempts: state.attempts,
      recommendedState: 'reconnecting',
    };
  }

  recordFailure(accountKey: string, now = Date.now()): ReconnectDecision {
    const existing = this.states.get(accountKey) ?? {
      attempts: 0,
      nextAllowedAt: 0,
      circuitOpenUntil: null,
      lastErrorAt: null,
    };

    const attempts = existing.attempts + 1;
    existing.attempts = attempts;
    existing.lastErrorAt = now;

    if (attempts >= this.maxAttempts) {
      existing.circuitOpenUntil = now + this.cooldownMs;
      existing.nextAllowedAt = existing.circuitOpenUntil;
      this.states.set(accountKey, existing);
      return {
        allowed: false,
        circuitOpen: true,
        retryAfterMs: this.cooldownMs,
        attempts,
        recommendedState: 'gateway_error',
      };
    }

    const expDelay = Math.min(this.baseDelayMs * 2 ** (attempts - 1), this.maxDelayMs);
    const jitterSpan = expDelay * this.jitterRatio;
    const jitter = (this.rng() * 2 - 1) * jitterSpan;
    const delayMs = Math.max(100, Math.round(expDelay + jitter));
    existing.nextAllowedAt = now + delayMs;
    existing.circuitOpenUntil = null;
    this.states.set(accountKey, existing);

    return {
      allowed: false,
      circuitOpen: false,
      retryAfterMs: delayMs,
      attempts,
      recommendedState: 'reconnecting',
    };
  }

  recordSuccess(accountKey: string): void {
    this.states.delete(accountKey);
  }

  getState(accountKey: string): Readonly<ReconnectAttemptState> | null {
    const state = this.states.get(accountKey);
    return state ? { ...state } : null;
  }

  reset(accountKey?: string): void {
    if (accountKey === undefined) {
      this.states.clear();
    } else {
      this.states.delete(accountKey);
    }
  }
}

/**
 * Inbound webhook message deduplication keyed by (companyId, messageId)
 * with bounded TTL idempotency window and capacity eviction.
 */
export interface WebhookDeduplicatorOptions {
  readonly windowMs?: number;
  readonly maxEntries?: number;
}

export class WebhookDeduplicator {
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly seen = new Map<string, number>();

  constructor(options: WebhookDeduplicatorOptions = {}) {
    this.windowMs = options.windowMs ?? 15 * 60 * 1_000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  private key(companyId: number, messageId: string): string {
    return `${companyId}:${messageId}`;
  }

  isDuplicate(companyId: number, messageId: string, now = Date.now()): boolean {
    if (!messageId) return false;
    const expiresAt = this.seen.get(this.key(companyId, messageId));
    if (expiresAt === undefined) return false;
    if (now >= expiresAt) {
      this.seen.delete(this.key(companyId, messageId));
      return false;
    }
    return true;
  }

  markProcessed(companyId: number, messageId: string, now = Date.now()): void {
    if (!messageId) return;
    if (this.seen.size >= this.maxEntries) {
      this.prune(now);
      if (this.seen.size >= this.maxEntries) {
        const oldestKey = this.seen.keys().next().value;
        if (oldestKey !== undefined) this.seen.delete(oldestKey);
      }
    }
    this.seen.set(this.key(companyId, messageId), now + this.windowMs);
  }

  /**
   * Atomically checks and marks a webhook message as processed.
   * Returns `true` if this is the first sighting (caller should process),
   * or `false` if it is a duplicate within the idempotency window.
   */
  tryAcquire(companyId: number, messageId: string, now = Date.now()): boolean {
    if (!messageId) return true;
    if (this.isDuplicate(companyId, messageId, now)) return false;
    this.markProcessed(companyId, messageId, now);
    return true;
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const [entryKey, expiresAt] of this.seen.entries()) {
      if (now >= expiresAt) {
        this.seen.delete(entryKey);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}

export const defaultReconnectBreaker = new ReconnectStormBreaker();
export const defaultWebhookDeduplicator = new WebhookDeduplicator();
