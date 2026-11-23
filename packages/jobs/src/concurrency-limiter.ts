import type { Transaction } from 'objection';
import { Company, CompanyMembership } from '@moonwitness/orm-base';
import { Environment } from '@moonwitness/orm';

export interface ConcurrencyQuota {
  companyId: number;
  maxConcurrentJobs: number;
  maxJobsPerMinute: number;
  tokenBucketCapacity: number;
  tokenBucketRefillRate: number;
}

export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

const quotaCache = new Map<number, ConcurrencyQuota>();
const tokenBucketCache = new Map<number, TokenBucketState>();

export function getDefaultQuota(companyId: number): ConcurrencyQuota {
  return {
    companyId,
    maxConcurrentJobs: 10,
    maxJobsPerMinute: 60,
    tokenBucketCapacity: 100,
    tokenBucketRefillRate: 10,
  };
}

export async function loadCompanyQuota(
  companyId: number,
  trx?: Transaction
): Promise<ConcurrencyQuota> {
  const cached = quotaCache.get(companyId);
  if (cached) return cached;

  const company = await Company.query(trx).findById(companyId);
  if (!company) return getDefaultQuota(companyId);

  const quota: ConcurrencyQuota = {
    companyId,
    maxConcurrentJobs: 10,
    maxJobsPerMinute: 60,
    tokenBucketCapacity: 100,
    tokenBucketRefillRate: 10,
  };

  quotaCache.set(companyId, quota);
  return quota;
}

export function clearQuotaCache(companyId?: number): void {
  if (companyId) {
    quotaCache.delete(companyId);
    tokenBucketCache.delete(companyId);
  } else {
    quotaCache.clear();
    tokenBucketCache.clear();
  }
}

export function refillTokenBucket(
  state: TokenBucketState,
  refillRate: number,
  capacity: number,
  now: number
): TokenBucketState {
  const elapsedSeconds = (now - state.lastRefill) / 1000;
  const newTokens = Math.min(capacity, state.tokens + elapsedSeconds * refillRate);
  return { tokens: newTokens, lastRefill: now };
}

export function consumeTokens(
  companyId: number,
  tokens: number,
  quota: ConcurrencyQuota,
  now: number
): boolean {
  let state = tokenBucketCache.get(companyId);
  if (!state) {
    state = { tokens: quota.tokenBucketCapacity, lastRefill: now };
    tokenBucketCache.set(companyId, state);
  }

  const before = refillTokenBucket(
    state,
    quota.tokenBucketRefillRate,
    quota.tokenBucketCapacity,
    now
  );

  if (before.tokens < tokens) {
    state.tokens = before.tokens;
    state.lastRefill = before.lastRefill;
    return false;
  }
  state.tokens = before.tokens - tokens;
  state.lastRefill = before.lastRefill;
  return true;
}

export async function getActiveJobCount(companyId: number, trx?: Transaction): Promise<number> {
  const result = (await Job.query(trx)
    .where({ company_id: companyId, status: 'running' })
    .count('id as cnt')
    .first()) as { cnt: number } | undefined;
  return Number(result?.cnt ?? 0);
}

export async function canAcquireJobSlot(
  companyId: number,
  trx?: Transaction,
  options: { requiredTokens?: number } = {}
): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }> {
  const quota = await loadCompanyQuota(companyId, trx);
  const now = Date.now();

  const activeCount = await getActiveJobCount(companyId, trx);
  if (activeCount >= quota.maxConcurrentJobs) {
    return { allowed: false, reason: 'CONCURRENCY_QUOTA_EXCEEDED', retryAfterMs: 1000 };
  }

  const requiredTokens = options.requiredTokens ?? 1;
  if (!consumeTokens(companyId, requiredTokens, quota, now)) {
    const state = tokenBucketCache.get(companyId);
    if (state) {
      const tokensNeeded = requiredTokens - state.tokens;
      const secondsToRefill = tokensNeeded / quota.tokenBucketRefillRate;
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: Math.ceil(secondsToRefill * 1000),
      };
    }
    return { allowed: false, reason: 'RATE_LIMIT_EXCEEDED', retryAfterMs: 1000 };
  }

  return { allowed: true };
}

export async function releaseJobSlot(companyId: number): Promise<void> {}

export interface FairShareContext {
  companyId: number;
  jobId: number;
  priority: number;
  acquiredAt: number;
}

const activeJobs = new Map<number, FairShareContext>();

export function registerActiveJob(context: FairShareContext): void {
  activeJobs.set(context.jobId, context);
}

export function unregisterActiveJob(jobId: number): void {
  activeJobs.delete(jobId);
}

export function getActiveJobsByCompany(companyId: number): FairShareContext[] {
  const results: FairShareContext[] = [];
  for (const ctx of activeJobs.values()) {
    if (ctx.companyId === companyId) results.push(ctx);
  }
  return results;
}

export function getFairShareWeight(companyId: number, allCompanies: number[]): number {
  const totalCompanies = allCompanies.length;
  if (totalCompanies === 0) return 1;
  return 1 / totalCompanies;
}

export class FairShareLimiter {
  private quotas: Map<number, ConcurrencyQuota> = new Map();
  private tokenBuckets: Map<number, TokenBucketState> = new Map();
  private activeJobs: Map<number, FairShareContext[]> = new Map();

  constructor(private defaultQuota: Partial<ConcurrencyQuota> = {}) {}

  setQuota(companyId: number, quota: Partial<ConcurrencyQuota>): void {
    const existing = this.quotas.get(companyId) ?? getDefaultQuota(companyId);
    this.quotas.set(companyId, { ...existing, ...quota });
  }

  getQuota(companyId: number): ConcurrencyQuota {
    return this.quotas.get(companyId) ?? getDefaultQuota(companyId);
  }

  async acquire(
    companyId: number,
    jobId: number,
    priority: number,
    trx?: Transaction
  ): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }> {
    const quota = this.getQuota(companyId);
    const now = Date.now();

    const companyJobs = this.activeJobs.get(companyId) ?? [];
    if (companyJobs.length >= quota.maxConcurrentJobs) {
      return { allowed: false, reason: 'FAIR_SHARE_QUOTA_EXCEEDED', retryAfterMs: 1000 };
    }

    let bucket = this.tokenBuckets.get(companyId);
    if (!bucket) {
      bucket = { tokens: quota.tokenBucketCapacity, lastRefill: now };
      this.tokenBuckets.set(companyId, bucket);
    }

    bucket = refillTokenBucket(bucket, quota.tokenBucketRefillRate, quota.tokenBucketCapacity, now);
    this.tokenBuckets.set(companyId, bucket);

    if (bucket.tokens < 1) {
      const tokensNeeded = 1 - bucket.tokens;
      const secondsToRefill = tokensNeeded / quota.tokenBucketRefillRate;
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: Math.ceil(secondsToRefill * 1000),
      };
    }

    bucket.tokens -= 1;

    const context: FairShareContext = { companyId, jobId, priority, acquiredAt: now };
    const updated = [...companyJobs, context].sort((a, b) => b.priority - a.priority);
    this.activeJobs.set(companyId, updated);

    return { allowed: true };
  }

  release(companyId: number, jobId: number): void {
    const companyJobs = this.activeJobs.get(companyId) ?? [];
    const filtered = companyJobs.filter((ctx) => ctx.jobId !== jobId);
    this.activeJobs.set(companyId, filtered);
  }

  getActiveCount(companyId: number): number {
    return (this.activeJobs.get(companyId) ?? []).length;
  }

  getTokenBucketState(companyId: number): TokenBucketState | undefined {
    return this.tokenBuckets.get(companyId);
  }
}

import { Job } from './models.js';

export const globalFairShareLimiter = new FairShareLimiter();

export async function checkFairShareLimit(
  companyId: number,
  jobId: number,
  priority: number,
  trx?: Transaction
): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }> {
  return globalFairShareLimiter.acquire(companyId, jobId, priority, trx);
}

export function releaseFairShareLimit(companyId: number, jobId: number): void {
  globalFairShareLimiter.release(companyId, jobId);
}
