import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createAuthCacheBus,
  AUTH_CACHE_INVALIDATION_CHANNEL,
} from '../src/plugins/auth-cache-bus.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth cache bus', () => {
  it('is inert for non-PostgreSQL connection strings (SQLite test backends)', async () => {
    const bus = createAuthCacheBus({ connectionString: 'sqlite://:memory:' });
    // Must not throw and must not attempt any connection.
    await expect(bus.broadcast(1)).resolves.toBeUndefined();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it('is inert for an empty connection string', async () => {
    const bus = createAuthCacheBus({ connectionString: '' });
    await expect(bus.broadcast()).resolves.toBeUndefined();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it('swallows broadcast failures and keeps the local cache contract (no throw)', async () => {
    // Point at an unreachable PostgreSQL endpoint: connect fails, broadcast
    // must degrade silently — the caller's local invalidation already ran.
    const bus = createAuthCacheBus({
      connectionString: 'postgresql://127.0.0.1:1/moonwitness_none',
    });
    await expect(bus.broadcast(42)).resolves.toBeUndefined();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it('exposes the canonical NOTIFY channel name', () => {
    expect(AUTH_CACHE_INVALIDATION_CHANNEL).toBe('auth_cache_invalidate');
  });
});
