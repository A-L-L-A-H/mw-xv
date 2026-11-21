import { estimateRequestInputTokens } from './usage.js';
import type { Clock, ProviderExecutionLimits, ProviderRequest } from './types.js';
import { ProviderError, SYSTEM_CLOCK } from './types.js';

export interface SemaphoreSnapshot {
  readonly active: number;
  readonly queued: number;
  readonly maxConcurrent: number;
  readonly maxQueueDepth: number;
}

interface SemaphoreWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export class AsyncSemaphore {
  private readonly maxConcurrent: number;
  private readonly maxQueueDepth: number;
  private readonly queueTimeoutMs: number;
  private readonly providerId: string;
  private active = 0;
  private readonly waiters: SemaphoreWaiter[] = [];

  constructor(options: {
    readonly maxConcurrent: number;
    readonly maxQueueDepth?: number;
    readonly queueTimeoutMs?: number;
    readonly providerId?: string;
  }) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error('maxConcurrent must be an integer >= 1');
    }
    const maxQueueDepth = options.maxQueueDepth ?? 0;
    if (!Number.isInteger(maxQueueDepth) || maxQueueDepth < 0) {
      throw new Error('maxQueueDepth must be an integer >= 0');
    }
    const queueTimeoutMs = options.queueTimeoutMs ?? 5_000;
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 0) {
      throw new Error('queueTimeoutMs must be a finite number >= 0');
    }
    this.maxConcurrent = options.maxConcurrent;
    this.maxQueueDepth = maxQueueDepth;
    this.queueTimeoutMs = queueTimeoutMs;
    this.providerId = options.providerId ?? 'resilience-semaphore';
  }

  getSnapshot(): SemaphoreSnapshot {
    return {
      active: this.active,
      queued: this.waiters.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueDepth: this.maxQueueDepth,
    };
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next.cleanup();
        next.resolve(this.createRelease());
      } else {
        this.active = Math.max(0, this.active - 1);
      }
    };
  }

  async acquire(signal?: AbortSignal, correlationId = 'semaphore'): Promise<() => void> {
    if (signal?.aborted) {
      throw new ProviderError('Request cancelled before acquiring concurrency slot', {
        code: 'cancelled',
        providerId: this.providerId,
        correlationId,
        retryable: false,
      });
    }

    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.createRelease();
    }

    if (this.waiters.length >= this.maxQueueDepth) {
      throw new ProviderError(
        `Provider concurrency queue exhausted (${this.active} active, ${this.waiters.length} queued)`,
        {
          code: 'rate_limited',
          reasonCode: 'CONCURRENCY_LIMIT_EXCEEDED',
          providerId: this.providerId,
          correlationId,
          retryable: true,
        }
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const removeWaiter = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
      };

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        removeWaiter();
        reject(
          new ProviderError('Request cancelled while waiting for concurrency slot', {
            code: 'cancelled',
            providerId: this.providerId,
            correlationId,
            retryable: false,
          })
        );
      };

      const cleanup = (): void => {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        signal?.removeEventListener('abort', onAbort);
      };

      const waiter: SemaphoreWaiter = {
        resolve: (release) => {
          if (settled) {
            release();
            return;
          }
          settled = true;
          resolve(release);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        },
        cleanup,
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (this.queueTimeoutMs >= 0) {
        timeoutHandle = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          removeWaiter();
          reject(
            new ProviderError(
              `Timed out after ${this.queueTimeoutMs}ms waiting for provider concurrency slot`,
              {
                code: 'timeout',
                reasonCode: 'QUEUE_TIMEOUT',
                providerId: this.providerId,
                correlationId,
                retryable: true,
              }
            )
          );
        }, this.queueTimeoutMs);
        timeoutHandle.unref?.();
      }

      this.waiters.push(waiter);
    });
  }
}

interface RateLimitEntry {
  readonly id: number;
  readonly timestampMs: number;
  tokens: number;
}

export interface RateLimitReservation {
  readonly reservationId: number;
  reconcile(actualTotalTokens: number): void;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs = 60_000;
  private readonly maxRequestsPerMinute?: number;
  private readonly maxTokensPerMinute?: number;
  private readonly clock: Clock;
  private readonly providerId: string;
  private readonly entries: RateLimitEntry[] = [];
  private nextId = 1;

  constructor(options: {
    readonly maxRequestsPerMinute?: number;
    readonly maxTokensPerMinute?: number;
    readonly clock?: Clock;
    readonly providerId?: string;
  }) {
    if (
      options.maxRequestsPerMinute !== undefined &&
      (!Number.isInteger(options.maxRequestsPerMinute) || options.maxRequestsPerMinute < 1)
    ) {
      throw new Error('maxRequestsPerMinute must be an integer >= 1');
    }
    if (
      options.maxTokensPerMinute !== undefined &&
      (!Number.isInteger(options.maxTokensPerMinute) || options.maxTokensPerMinute < 1)
    ) {
      throw new Error('maxTokensPerMinute must be an integer >= 1');
    }
    this.maxRequestsPerMinute = options.maxRequestsPerMinute;
    this.maxTokensPerMinute = options.maxTokensPerMinute;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.providerId = options.providerId ?? 'rate-limiter';
  }

  private prune(now: number): void {
    while (this.entries.length > 0 && now - this.entries[0].timestampMs >= this.windowMs) {
      this.entries.shift();
    }
  }

  getCurrentUsage(): { readonly requestsInWindow: number; readonly tokensInWindow: number } {
    const now = this.clock.now();
    this.prune(now);
    let tokensInWindow = 0;
    for (const entry of this.entries) {
      tokensInWindow += entry.tokens;
    }
    return {
      requestsInWindow: this.entries.length,
      tokensInWindow,
    };
  }

  reserve(estimatedTokens: number, correlationId = 'rate-limit'): RateLimitReservation {
    const now = this.clock.now();
    this.prune(now);

    const safeEstimatedTokens = Math.max(0, Math.floor(estimatedTokens));

    if (
      this.maxRequestsPerMinute !== undefined &&
      this.entries.length + 1 > this.maxRequestsPerMinute
    ) {
      const oldest = this.entries[0];
      const retryAfterMs = oldest ? Math.max(1, oldest.timestampMs + this.windowMs - now) : 1_000;
      throw new ProviderError(`Provider RPM limit (${this.maxRequestsPerMinute}/min) exceeded`, {
        code: 'rate_limited',
        providerId: this.providerId,
        correlationId,
        retryable: true,
        retryAfterMs,
      });
    }

    if (this.maxTokensPerMinute !== undefined) {
      let usedTokens = 0;
      for (const entry of this.entries) {
        usedTokens += entry.tokens;
      }
      if (usedTokens + safeEstimatedTokens > this.maxTokensPerMinute) {
        const oldest = this.entries[0];
        const retryAfterMs = oldest ? Math.max(1, oldest.timestampMs + this.windowMs - now) : 1_000;
        throw new ProviderError(`Provider TPM limit (${this.maxTokensPerMinute}/min) exceeded`, {
          code: 'rate_limited',
          providerId: this.providerId,
          correlationId,
          retryable: true,
          retryAfterMs,
        });
      }
    }

    const entry: RateLimitEntry = {
      id: this.nextId++,
      timestampMs: now,
      tokens: safeEstimatedTokens,
    };
    this.entries.push(entry);

    return {
      reservationId: entry.id,
      reconcile: (actualTotalTokens: number) => {
        entry.tokens = Math.max(0, Math.floor(actualTotalTokens));
      },
    };
  }
}

export interface ComposedAttemptSignal {
  readonly signal: AbortSignal;
  isCallerAborted(): boolean;
  isTimedOut(): boolean;
  cleanup(): void;
}

export function composeAttemptSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
  providerId = 'provider',
  correlationId = 'attempt'
): ComposedAttemptSignal {
  if (callerSignal?.aborted) {
    throw new ProviderError('Request cancelled before dispatch', {
      code: 'cancelled',
      providerId,
      correlationId,
      retryable: false,
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;

  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort(callerSignal?.reason ?? new Error('CALLER_CANCELLED'));
  };

  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const clampedTimeoutMs = Math.max(1, Math.min(600_000, Math.floor(timeoutMs)));
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('PROVIDER_TIMEOUT'));
  }, clampedTimeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    isCallerAborted: () => callerAborted || Boolean(callerSignal?.aborted),
    isTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

export class ProviderResilienceGuard {
  private readonly semaphore: AsyncSemaphore;
  private readonly rateLimiter?: SlidingWindowRateLimiter;
  private readonly defaultTimeoutMs: number;

  constructor(options: {
    readonly providerId: string;
    readonly limits: ProviderExecutionLimits;
    readonly clock?: Clock;
  }) {
    this.defaultTimeoutMs = options.limits.timeoutMs;
    this.semaphore = new AsyncSemaphore({
      providerId: options.providerId,
      maxConcurrent: options.limits.maxConcurrent,
      maxQueueDepth: options.limits.maxQueueDepth,
      queueTimeoutMs: options.limits.queueTimeoutMs,
    });
    if (
      options.limits.maxRequestsPerMinute !== undefined ||
      options.limits.maxTokensPerMinute !== undefined
    ) {
      this.rateLimiter = new SlidingWindowRateLimiter({
        providerId: options.providerId,
        maxRequestsPerMinute: options.limits.maxRequestsPerMinute,
        maxTokensPerMinute: options.limits.maxTokensPerMinute,
        clock: options.clock,
      });
    }
  }

  getSemaphoreSnapshot(): SemaphoreSnapshot {
    return this.semaphore.getSnapshot();
  }

  async run<T extends { readonly usage?: { readonly totalTokens: number } }>(
    request: ProviderRequest,
    execute: (attemptSignal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal
  ): Promise<T> {
    const release = await this.semaphore.acquire(callerSignal, request.correlationId);
    try {
      const estimatedTokens =
        estimateRequestInputTokens(request) +
        (request.maxOutputTokens ?? request.model.maxOutputTokens ?? 0);
      const reservation = this.rateLimiter?.reserve(estimatedTokens, request.correlationId);
      const effectiveTimeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
      const attempt = composeAttemptSignal(
        effectiveTimeoutMs,
        callerSignal,
        request.model.providerId,
        request.correlationId
      );
      try {
        const result = await execute(attempt.signal);
        if (reservation && result.usage) {
          reservation.reconcile(result.usage.totalTokens);
        }
        return result;
      } finally {
        attempt.cleanup();
      }
    } finally {
      release();
    }
  }
}
