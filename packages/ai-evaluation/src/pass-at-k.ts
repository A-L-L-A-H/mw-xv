import { createHash } from 'node:crypto';

/**
 * pass^k reliability metric (tau-bench, arXiv:2406.12045).
 *
 * A task qualifies at k only when ALL k independent trials succeed. The
 * estimate uses combinations so it also works when more than k trials exist:
 *   pass^k(task) = C(successes, k) / C(trials, k)
 * Outcomes must come from independent verification (PCW), never self-report.
 */
export interface PassAtKInput {
  readonly trialsByTask: readonly (readonly boolean[])[];
  readonly k?: number;
}

export interface PassAtKResult {
  readonly k: number;
  readonly taskCount: number;
  readonly qualifyingTaskCount: number;
  readonly passAtK: number;
  readonly passAtKBps: number;
  readonly reportSha256: string;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

export function computePassAtK(input: PassAtKInput): PassAtKResult {
  const k = input.k ?? 3;
  if (!Number.isSafeInteger(k) || k < 1 || k > 8) {
    throw new Error('k must be an integer between 1 and 8');
  }
  if (input.trialsByTask.length === 0) {
    throw new Error('pass^k requires at least one task with trials');
  }

  let qualifyingTaskCount = 0;
  const perTask: number[] = [];
  for (const trials of input.trialsByTask) {
    const successes = trials.filter(Boolean).length;
    const value = choose(successes, k) / choose(trials.length, k);
    if (Number.isFinite(value) && value > 0) qualifyingTaskCount += 1;
    perTask.push(Number.isFinite(value) ? value : 0);
  }

  const passAtK = perTask.reduce((sum, value) => sum + value, 0) / perTask.length;
  const payload = {
    k,
    taskCount: input.trialsByTask.length,
    qualifyingTaskCount,
    passAtK: Number(passAtK.toFixed(6)),
  };
  return {
    ...payload,
    passAtKBps: Math.round(passAtK * 10_000),
    reportSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

/** Convenience wrapper producing pass^1, pass^3 and pass^8 in one call. */
export function computeReliabilityProfile(trialsByTask: readonly (readonly boolean[])[]): {
  readonly pass1: PassAtKResult;
  readonly pass3: PassAtKResult;
  readonly pass8: PassAtKResult;
} {
  return {
    pass1: computePassAtK({ trialsByTask, k: 1 }),
    pass3: computePassAtK({ trialsByTask, k: 3 }),
    pass8: computePassAtK({ trialsByTask, k: 8 }),
  };
}
