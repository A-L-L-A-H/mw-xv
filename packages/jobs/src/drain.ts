/**
 * Bounded graceful-drain controller shared by the jobs worker loop and available
 * to the scheduler/outbox workers. It keeps three concerns separate:
 *
 *  1. `begin()` flips readiness off (via `onDrainStart`) *before* any drain work.
 *  2. In-flight work is allowed to finish; `enterJob`/`exitJob` track it.
 *  3. A timeout aborts `executionSignal`, so a stuck/abandoned job cannot extend
 *     the drain indefinitely. Aborted work can never commit stale results: the
 *     jobs runtime fences every commit with lease ownership + fencing token.
 *
 * This module has no runtime imports so it can also be driven directly from
 * process-level tests (including OS child processes).
 */

export type WorkerDrainState = 'running' | 'draining' | 'drained' | 'abandoned';

export interface GracefulDrainOptions {
  workerId: string;
  /** Maximum time to wait for in-flight work. 0 disables the timeout. */
  drainTimeoutMs?: number;
  /** Called synchronously when drain begins, before in-flight work is awaited. */
  onDrainStart?: (reason: string) => void;
  /** Monotonic milliseconds clock, injectable for deterministic tests. */
  now?: () => number;
}

export interface DrainOutcome {
  workerId: string;
  state: WorkerDrainState;
  reason: string | null;
  inFlight: number;
  completed: number;
  abandoned: number;
  durationMs: number;
  timedOut: boolean;
}

export interface GracefulDrainController {
  readonly workerId: string;
  readonly state: WorkerDrainState;
  /** Aborted only when the drain deadline is exceeded (forced termination). */
  readonly executionSignal: AbortSignal;
  begin(reason?: string): void;
  enterJob(): void;
  exitJob(settled: boolean): void;
  finish(): DrainOutcome;
  getOutcome(): DrainOutcome;
  dispose(): void;
}

/** Raised as the abort reason when the graceful-drain deadline is exceeded. */
export class DrainTimeoutError extends Error {
  constructor(workerId: string) {
    super(`Drain timeout exceeded for worker "${workerId}"`);
    this.name = 'DrainTimeoutError';
  }
}

export function createGracefulDrainController(
  options: GracefulDrainOptions
): GracefulDrainController {
  if (!options.workerId || options.workerId.length > 255)
    throw new Error('workerId must contain 1 to 255 characters');
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.drainTimeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new Error('drainTimeoutMs must be a non-negative finite number');

  const execution = new AbortController();
  let state: WorkerDrainState = 'running';
  let reason: string | null = null;
  let startedAt = 0;
  let inFlight = 0;
  let completed = 0;
  let abandoned = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const outcome = (): DrainOutcome => ({
    workerId: options.workerId,
    state,
    reason,
    inFlight,
    completed,
    abandoned,
    durationMs: state === 'running' ? 0 : Math.max(0, now() - startedAt),
    timedOut: execution.signal.aborted,
  });

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    get workerId() {
      return options.workerId;
    },
    get state() {
      return state;
    },
    executionSignal: execution.signal,
    begin(nextReason = 'shutdown') {
      if (state !== 'running' || finished) return;
      reason = nextReason;
      startedAt = now();
      state = 'draining';
      // Readiness must be false before any drain work starts.
      options.onDrainStart?.(nextReason);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timer = undefined;
          if (finished) return;
          if (inFlight > 0) {
            abandoned = inFlight;
            inFlight = 0;
            state = 'abandoned';
          }
          execution.abort(new DrainTimeoutError(options.workerId));
        }, timeoutMs);
        timer.unref?.();
      }
    },
    enterJob() {
      if (state === 'draining' || state === 'running') inFlight += 1;
    },
    exitJob(settled) {
      if (inFlight > 0) inFlight -= 1;
      // A job that was interrupted by the deadline is not a successful drain.
      if (settled && !execution.signal.aborted) completed += 1;
    },
    finish() {
      clearTimer();
      if (state === 'draining') state = 'drained';
      finished = true;
      return outcome();
    },
    getOutcome: outcome,
    dispose() {
      clearTimer();
    },
  };
}

/** Resolves `promise` unless `signal` aborts first; used to bound in-flight work. */
export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Execution aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Execution aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
