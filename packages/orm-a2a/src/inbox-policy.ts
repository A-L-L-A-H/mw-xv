/**
 * CF-019 (issue #73): bounded durable-inbox reads, explicit ingestion
 * backpressure, and a retention policy that separates operational payload
 * minimization from append-only audit evidence.
 *
 * Audit rows are never deleted by this policy. Payload minimization only
 * projects a read result: it keeps the payload SHA-256 digest and the audit
 * row reference so verification evidence and audit traceability survive.
 */

import { MILLISECONDS_PER_MINUTE } from '@moonwitness/types';

export interface A2aInboxPaginationConfig {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export const DEFAULT_A2A_INBOX_PAGINATION: A2aInboxPaginationConfig = Object.freeze({
  defaultLimit: 50,
  maxLimit: 200,
});

export interface A2aInboxPageQuery {
  readonly limit: number;
  /** Return receipts with audit id strictly less than this cursor. */
  readonly beforeId?: number;
}

export type A2aInboxPageRequestResult =
  | { readonly ok: true; readonly query: A2aInboxPageQuery }
  | {
      readonly ok: false;
      readonly reasonCode: 'INVALID_INBOX_LIMIT' | 'INVALID_INBOX_CURSOR';
      readonly error: string;
    };

export interface A2aInboxPageRequest {
  readonly limit?: string | number;
  readonly cursor?: string;
}

export interface A2aInboxPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}

function readPositiveInteger(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function parseA2aInboxPageRequest(
  query: A2aInboxPageRequest = {},
  config: A2aInboxPaginationConfig = DEFAULT_A2A_INBOX_PAGINATION
): A2aInboxPageRequestResult {
  if (
    !Number.isSafeInteger(config.defaultLimit) ||
    config.defaultLimit < 1 ||
    !Number.isSafeInteger(config.maxLimit) ||
    config.maxLimit < config.defaultLimit
  ) {
    throw new Error('inbox pagination config is invalid');
  }

  const limit = query.limit === undefined ? config.defaultLimit : readPositiveInteger(query.limit);
  if (limit === null || limit > config.maxLimit) {
    return {
      ok: false,
      reasonCode: 'INVALID_INBOX_LIMIT',
      error: `limit must be an integer from 1 to ${config.maxLimit}`,
    };
  }

  if (query.cursor === undefined) {
    return { ok: true, query: { limit } };
  }
  const cursor = readPositiveInteger(query.cursor.trim());
  if (cursor === null) {
    return {
      ok: false,
      reasonCode: 'INVALID_INBOX_CURSOR',
      error: 'cursor must be a positive audit-log id returned as nextCursor',
    };
  }
  return { ok: true, query: { limit, beforeId: cursor } };
}

/** Stable, descending-id cursor. `rows` must be fetched with `limit + 1` rows. */
export function buildA2aInboxPage<T extends { readonly id: number }>(
  rows: readonly T[],
  limit: number,
  config: A2aInboxPaginationConfig = DEFAULT_A2A_INBOX_PAGINATION
): A2aInboxPage<T> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    (config !== undefined && limit > config.maxLimit)
  ) {
    throw new Error('limit must be a positive integer within the configured maximum');
  }
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items.at(-1);
  return Object.freeze({
    items: Object.freeze(items),
    hasMore,
    nextCursor: hasMore && last ? String(last.id) : null,
    limit,
  });
}

export interface A2aIngestionBackpressureConfig {
  readonly maxEnvelopeBytes: number;
  readonly maxRequestsPerWindow: number;
  readonly windowMs: number;
  readonly retryAfterSeconds: number;
}

export const DEFAULT_A2A_INGESTION_BACKPRESSURE: A2aIngestionBackpressureConfig = Object.freeze({
  maxEnvelopeBytes: 256 * 1024,
  maxRequestsPerWindow: 120,
  windowMs: MILLISECONDS_PER_MINUTE,
  retryAfterSeconds: 1,
});

export interface A2aBackpressureDecision {
  readonly allowed: boolean;
  readonly reasonCode?: 'A2A_RATE_LIMITED';
  readonly retryAfterMs: number;
}

/** Deterministic sliding-window throttle; explicit clock injection for tests. */
export class A2aIngestionThrottle {
  readonly #config: A2aIngestionBackpressureConfig;
  readonly #clock: () => number;
  readonly #timestamps: number[] = [];

  constructor(
    config: A2aIngestionBackpressureConfig = DEFAULT_A2A_INGESTION_BACKPRESSURE,
    clock: () => number = () => Date.now()
  ) {
    if (
      !Number.isSafeInteger(config.maxEnvelopeBytes) ||
      config.maxEnvelopeBytes < 1 ||
      !Number.isSafeInteger(config.maxRequestsPerWindow) ||
      config.maxRequestsPerWindow < 1 ||
      !Number.isSafeInteger(config.windowMs) ||
      config.windowMs < 1 ||
      !Number.isSafeInteger(config.retryAfterSeconds) ||
      config.retryAfterSeconds < 1
    ) {
      throw new Error('ingestion backpressure config is invalid');
    }
    this.#config = config;
    this.#clock = clock;
  }

  get config(): A2aIngestionBackpressureConfig {
    return this.#config;
  }

  get pendingCount(): number {
    return this.#timestamps.length;
  }

  reset(): void {
    this.#timestamps.length = 0;
  }

  tryAcquire(nowMs: number = this.#clock()): A2aBackpressureDecision {
    if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite number');
    const cutoff = nowMs - this.#config.windowMs;
    while (this.#timestamps.length > 0 && (this.#timestamps[0] ?? 0) <= cutoff) {
      this.#timestamps.shift();
    }
    if (this.#timestamps.length >= this.#config.maxRequestsPerWindow) {
      const oldest = this.#timestamps[0] ?? nowMs;
      return {
        allowed: false,
        reasonCode: 'A2A_RATE_LIMITED',
        retryAfterMs: Math.max(1, oldest + this.#config.windowMs - nowMs),
      };
    }
    this.#timestamps.push(nowMs);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export interface A2aInboxRetentionPolicy {
  /** Payload bodies are minimized after this window; audit metadata is retained indefinitely. */
  readonly payloadRetentionMs: number;
  readonly preservePayloadDigest: true;
  readonly preserveAuditReference: true;
  readonly purgeAuditRecords: false;
}

export const DEFAULT_A2A_INBOX_RETENTION: A2aInboxRetentionPolicy = Object.freeze({
  payloadRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  preservePayloadDigest: true,
  preserveAuditReference: true,
  purgeAuditRecords: false,
});

export interface A2aReceiptRetentionInput {
  readonly auditLogId: number;
  readonly model: string;
  readonly receivedAt: string;
  readonly changes: Record<string, unknown>;
}

export interface A2aRetainedReceipt extends Record<string, unknown> {
  readonly id: number;
  readonly auditLogId: number;
  readonly auditModel: string;
  readonly payloadSha256: string;
  readonly payloadExpired: boolean;
  readonly retention: {
    readonly auditMetadata: 'retained_indefinitely';
    readonly payload: 'retained' | 'minimized';
    readonly digestPreserved: true;
    readonly auditReferencePreserved: true;
  };
}

export function projectA2aReceiptForRetention(
  input: A2aReceiptRetentionInput,
  nowMs: number,
  policy: A2aInboxRetentionPolicy = DEFAULT_A2A_INBOX_RETENTION
): A2aRetainedReceipt {
  if (!Number.isSafeInteger(policy.payloadRetentionMs) || policy.payloadRetentionMs < 1) {
    throw new Error('payloadRetentionMs must be a positive safe integer');
  }
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite number');

  const receivedAtMs = Date.parse(input.receivedAt);
  const payloadSha256 =
    typeof input.changes.payloadSha256 === 'string' ? input.changes.payloadSha256 : '';
  const { payload, payloadSha256: _digest, ...metadata } = input.changes;
  const payloadExpired =
    Number.isFinite(receivedAtMs) && nowMs - receivedAtMs >= policy.payloadRetentionMs;

  return {
    ...metadata,
    id: input.auditLogId,
    auditLogId: input.auditLogId,
    auditModel: input.model,
    payloadSha256,
    ...(payloadExpired
      ? {
          payloadExpired: true,
          payloadExpiredAt: new Date(receivedAtMs + policy.payloadRetentionMs).toISOString(),
        }
      : { payload, payloadExpired: false }),
    retention: {
      auditMetadata: 'retained_indefinitely',
      payload: payloadExpired ? 'minimized' : 'retained',
      digestPreserved: true,
      auditReferencePreserved: true,
    },
  };
}
