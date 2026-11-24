import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseCronExpression, evaluateNextTick, evaluateNextTicks } from '../src/cron-scheduler.js';
import {
  getDefaultQuota,
  loadCompanyQuota,
  refillTokenBucket,
  consumeTokens,
  FairShareLimiter,
  clearQuotaCache,
} from '../src/concurrency-limiter.js';

describe('cron-scheduler', () => {
  describe('parseCronExpression', () => {
    it('parses standard 5-field cron expressions', () => {
      expect(parseCronExpression('0 0 * * *')).toEqual({
        minute: 0,
        hour: 0,
        dayOfMonth: 1,
        month: 1,
        dayOfWeek: 0,
      });
    });

    it('parses specific minute/hour', () => {
      expect(parseCronExpression('30 14 * * *')).toEqual({
        minute: 30,
        hour: 14,
        dayOfMonth: 1,
        month: 1,
        dayOfWeek: 0,
      });
    });

    it('parses day of month and month', () => {
      expect(parseCronExpression('0 0 15 6 *')).toEqual({
        minute: 0,
        hour: 0,
        dayOfMonth: 15,
        month: 6,
        dayOfWeek: 0,
      });
    });

    it('parses day of week names', () => {
      expect(parseCronExpression('0 0 * * mon')).toEqual({
        minute: 0,
        hour: 0,
        dayOfMonth: 1,
        month: 1,
        dayOfWeek: 1,
      });
      expect(parseCronExpression('0 0 * * friday')).toEqual({
        minute: 0,
        hour: 0,
        dayOfMonth: 1,
        month: 1,
        dayOfWeek: 5,
      });
    });

    it('parses step values', () => {
      expect(parseCronExpression('*/5 * * * *')).toEqual({
        minute: 0,
        hour: 0,
        dayOfMonth: 1,
        month: 1,
        dayOfWeek: 0,
      });
    });

    it('throws on invalid field count', () => {
      expect(() => parseCronExpression('0 0 * *')).toThrow('expected 5 fields');
      expect(() => parseCronExpression('0 0 * * * *')).toThrow('expected 5 fields');
    });

    it('throws on out of range values', () => {
      expect(() => parseCronExpression('60 0 * * *')).toThrow('out of range');
      expect(() => parseCronExpression('0 24 * * *')).toThrow('out of range');
      expect(() => parseCronExpression('0 0 32 * *')).toThrow('out of range');
      expect(() => parseCronExpression('0 0 * 13 *')).toThrow('out of range');
      expect(() => parseCronExpression('0 0 * * 7')).toThrow('out of range');
    });
  });

  describe('evaluateNextTick', () => {
    it('evaluates next tick for daily midnight cron', () => {
      const from = new Date('2024-01-15T10:30:00Z');
      const next = evaluateNextTick('0 0 * * *', from, 'UTC');
      expect(next).toEqual(new Date('2024-01-16T00:00:00Z'));
    });

    it('evaluates next tick for hourly cron', () => {
      const from = new Date('2024-01-15T10:30:00Z');
      const next = evaluateNextTick('0 * * * *', from, 'UTC');
      expect(next).toEqual(new Date('2024-01-15T11:00:00Z'));
    });

    it('respects timezone', () => {
      const from = new Date('2024-01-15T10:30:00Z');
      const next = evaluateNextTick('0 0 * * *', from, 'America/New_York');
      expect(next.getUTCHours()).toBe(5);
    });

    it('throws on invalid expression', () => {
      expect(() => evaluateNextTick('invalid', new Date(), 'UTC')).toThrow();
    });
  });

  describe('evaluateNextTicks', () => {
    it('returns multiple future ticks', () => {
      const from = new Date('2024-01-15T10:30:00Z');
      const ticks = evaluateNextTicks('0 * * * *', from, 'UTC', 3);
      expect(ticks).toHaveLength(3);
      expect(ticks[0]).toEqual(new Date('2024-01-15T11:00:00Z'));
      expect(ticks[1]).toEqual(new Date('2024-01-15T12:00:00Z'));
      expect(ticks[2]).toEqual(new Date('2024-01-15T13:00:00Z'));
    });
  });
});

describe('concurrency-limiter', () => {
  beforeEach(() => {
    clearQuotaCache();
  });

  describe('getDefaultQuota', () => {
    it('returns default quota values', () => {
      const quota = getDefaultQuota(1);
      expect(quota.companyId).toBe(1);
      expect(quota.maxConcurrentJobs).toBe(10);
      expect(quota.maxJobsPerMinute).toBe(60);
      expect(quota.tokenBucketCapacity).toBe(100);
      expect(quota.tokenBucketRefillRate).toBe(10);
    });
  });

  describe('refillTokenBucket', () => {
    it('refills tokens based on elapsed time', () => {
      const state = { tokens: 10, lastRefill: 1000 };
      const refilled = refillTokenBucket(state, 5, 100, 2000);
      expect(refilled.tokens).toBe(15);
      expect(refilled.lastRefill).toBe(2000);
    });

    it('caps at capacity', () => {
      const state = { tokens: 90, lastRefill: 1000 };
      const refilled = refillTokenBucket(state, 50, 100, 2000);
      expect(refilled.tokens).toBe(100);
    });

    it('handles zero elapsed time', () => {
      const state = { tokens: 50, lastRefill: 1000 };
      const refilled = refillTokenBucket(state, 10, 100, 1000);
      expect(refilled.tokens).toBe(50);
    });
  });

  describe('consumeTokens', () => {
    it('consumes tokens when available', () => {
      const quota = getDefaultQuota(1);
      const now = Date.now();
      const result = consumeTokens(1, 5, quota, now);
      expect(result).toBe(true);
    });

    it('refuses when insufficient tokens', () => {
      const quota = getDefaultQuota(1);
      const now = Date.now();
      consumeTokens(1, 90, quota, now);
      const result = consumeTokens(1, 20, quota, now);
      expect(result).toBe(false);
    });

    it('refills before consuming', () => {
      const quota = { ...getDefaultQuota(1), tokenBucketRefillRate: 1000 };
      const now = Date.now();
      consumeTokens(1, 90, quota, now);
      const later = now + 2000;
      const result = consumeTokens(1, 5, quota, later);
      expect(result).toBe(true);
    });
  });

  describe('FairShareLimiter', () => {
    it('allows acquisition within quota', async () => {
      const limiter = new FairShareLimiter();
      const result = await limiter.acquire(1, 100, 10);
      expect(result.allowed).toBe(true);
    });

    it('rejects when concurrent job limit exceeded', async () => {
      const limiter = new FairShareLimiter();
      limiter.setQuota(1, { maxConcurrentJobs: 1 });

      await limiter.acquire(1, 100, 10);
      const result = await limiter.acquire(1, 101, 10);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('FAIR_SHARE_QUOTA_EXCEEDED');
    });

    it('rejects when rate limit exceeded', async () => {
      const limiter = new FairShareLimiter();
      limiter.setQuota(1, { tokenBucketCapacity: 1, tokenBucketRefillRate: 0 });

      await limiter.acquire(1, 100, 10);
      const result = await limiter.acquire(1, 101, 10);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('releases job slot on release', async () => {
      const limiter = new FairShareLimiter();
      limiter.setQuota(1, { maxConcurrentJobs: 1 });

      await limiter.acquire(1, 100, 10);
      limiter.release(1, 100);

      const result = await limiter.acquire(1, 101, 10);
      expect(result.allowed).toBe(true);
    });

    it('tracks active job count per company', async () => {
      const limiter = new FairShareLimiter();

      await limiter.acquire(1, 100, 10);
      await limiter.acquire(1, 101, 10);
      await limiter.acquire(2, 200, 10);

      expect(limiter.getActiveCount(1)).toBe(2);
      expect(limiter.getActiveCount(2)).toBe(1);
    });

    it('prioritizes higher priority jobs', async () => {
      const limiter = new FairShareLimiter();
      limiter.setQuota(1, { maxConcurrentJobs: 1 });

      const lowPriority = await limiter.acquire(1, 100, 1);
      expect(lowPriority.allowed).toBe(true);

      const highPriority = await limiter.acquire(1, 101, 100);
      expect(highPriority.allowed).toBe(false);
    });
  });
});
