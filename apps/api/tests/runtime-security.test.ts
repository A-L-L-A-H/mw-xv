import { describe, expect, it } from 'vitest';
import { resolveRateLimitStore, resolveTrustProxy } from '../src/config/runtime-security.js';

describe('resolveTrustProxy', () => {
  it('ignores X-Forwarded-For by default, including production', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
  });

  it('supports explicit legacy boolean trust', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: 'true' })).toBe(true);
  });

  it('accepts hop counts from TRUST_PROXY_HOPS and mode variables', () => {
    const twoHops = resolveTrustProxy({ TRUST_PROXY_HOPS: '2' });
    const threeHops = resolveTrustProxy({ TRUST_PROXY: 'hops', TRUST_PROXY_HOPS: '3' });
    const numericMode = resolveTrustProxy({ TRUST_PROXY: '2' });
    for (const trust of [twoHops, threeHops, numericMode]) {
      expect(typeof trust).toBe('function');
    }
    if (typeof twoHops !== 'function' || typeof threeHops !== 'function') {
      throw new Error('hop-count modes must return a trust function');
    }
    expect(twoHops('203.0.113.1', 0)).toBe(true);
    expect(twoHops('203.0.113.2', 1)).toBe(true);
    expect(twoHops('203.0.113.3', 2)).toBe(false);
    expect(threeHops('203.0.113.4', 2)).toBe(true);
    expect(threeHops('203.0.113.5', 3)).toBe(false);
  });

  it('accepts an IP and CIDR proxy allowlist', () => {
    expect(resolveTrustProxy({ TRUST_PROXY_CIDRS: '127.0.0.1/32, 10.0.0.0/8' })).toEqual([
      '127.0.0.1/32',
      '10.0.0.0/8',
    ]);
    expect(resolveTrustProxy({ TRUST_PROXY: 'cidrs', TRUST_PROXY_CIDRS: '2001:db8::1' })).toEqual([
      '2001:db8::1',
    ]);
  });

  it('rejects ambiguous or malformed proxy configuration', () => {
    expect(() =>
      resolveTrustProxy({ TRUST_PROXY_HOPS: '1', TRUST_PROXY_CIDRS: '10.0.0.0/8' })
    ).toThrow(/only one of/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'hops' })).toThrow(/TRUST_PROXY_HOPS/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'cidrs' })).toThrow(/TRUST_PROXY_CIDRS/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'anything' })).toThrow(/TRUST_PROXY/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY_HOPS: '0' })).toThrow(/between/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY_CIDRS: '10.0.0.0/33' })).toThrow(/between/u);
    expect(() => resolveTrustProxy({ TRUST_PROXY_CIDRS: 'not-an-ip' })).toThrow(/IP or CIDR/u);
  });
});

describe('resolveRateLimitStore', () => {
  it('defaults to the in-memory store and accepts both explicit values', () => {
    expect(resolveRateLimitStore({})).toBe('memory');
    expect(resolveRateLimitStore({ RATE_LIMIT_STORE: 'memory' })).toBe('memory');
    expect(resolveRateLimitStore({ RATE_LIMIT_STORE: 'POSTGRES' })).toBe('postgres');
  });

  it('rejects unknown stores instead of silently losing shared counters', () => {
    expect(() => resolveRateLimitStore({ RATE_LIMIT_STORE: 'redis' })).toThrow(
      /memory or postgres/u
    );
  });
});
