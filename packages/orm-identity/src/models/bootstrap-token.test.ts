import { describe, expect, it, vi } from 'vitest';

import {
  BootstrapToken,
  consumeBootstrapToken,
  createBootstrapTokenRecord,
  DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS,
  digestBootstrapToken,
  generateBootstrapToken,
  insertBootstrapToken,
  isBootstrapTokenClaimable,
  MIN_BOOTSTRAP_TOKEN_BYTES,
  verifyBootstrapToken,
} from './bootstrap-token.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const RAW_TOKEN = 'test-generated-token-with-at-least-thirty-two-bytes-of-entropy';

describe('identity.bootstrap_token model', () => {
  it('creates a digest-only record with a short expiry', () => {
    const token = createBootstrapTokenRecord(RAW_TOKEN, { now: NOW });

    expect(token.installation_scope).toBe('installation');
    expect(token.token_digest).toBe(digestBootstrapToken(RAW_TOKEN));
    expect(token.expires_at).toBe('2026-01-01T00:15:00.000Z');
    expect(JSON.stringify(token.toJSON())).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(token.toJSON())).not.toContain('token_digest');
    expect(DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS).toBe(900);
    expect(BootstrapToken.tableName).toBe('identity.bootstrap_token');
  });

  it('rejects invalid TTL and weak generated tokens', () => {
    expect(() => createBootstrapTokenRecord(RAW_TOKEN, { ttlSeconds: 0 })).toThrow(
      'between 1 and 3600'
    );
    expect(() => generateBootstrapToken(MIN_BOOTSTRAP_TOKEN_BYTES - 1)).toThrow(
      'at least 32 random bytes'
    );
    expect(generateBootstrapToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('verifies tokens in constant time and rejects altered values', () => {
    const digest = digestBootstrapToken(RAW_TOKEN);

    expect(verifyBootstrapToken(RAW_TOKEN, digest)).toBe(true);
    expect(verifyBootstrapToken(`${RAW_TOKEN}x`, digest)).toBe(false);
    expect(() => verifyBootstrapToken('', digest)).toThrow('non-empty');
  });

  it('treats consumed, revoked and expired tokens as unclaimable', () => {
    const token = createBootstrapTokenRecord(RAW_TOKEN, { now: NOW });

    expect(isBootstrapTokenClaimable(token, NOW)).toBe(true);
    expect(isBootstrapTokenClaimable(undefined, NOW)).toBe(false);
    expect(isBootstrapTokenClaimable({ ...token, consumed_at: NOW.toISOString() } as BootstrapToken, NOW)).toBe(false);
    expect(isBootstrapTokenClaimable({ ...token, revoked_at: NOW.toISOString() } as BootstrapToken, NOW)).toBe(false);
    expect(isBootstrapTokenClaimable(token, new Date('2026-01-01T00:15:00.000Z'))).toBe(false);
  });

  it('inserts once and surfaces duplicate active-token conflicts', async () => {
    const token = createBootstrapTokenRecord(RAW_TOKEN, { now: NOW });
    const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({ rows: [token] }));

    await expect(insertBootstrapToken(token, { raw })).resolves.toBeInstanceOf(BootstrapToken);
    expect(String(raw.mock.calls[0][0])).toContain('ON CONFLICT (installation_scope)');

    raw.mockResolvedValueOnce({ rows: [] });
    await expect(insertBootstrapToken(token, { raw })).rejects.toMatchObject({
      code: 'ACTIVE_BOOTSTRAP_TOKEN_EXISTS',
    });
  });

  it('consumes a valid token atomically once', async () => {
    let claimed = false;
    const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => {
      if (claimed) return { rows: [] };
      claimed = true;
      return { rows: [{ token_digest: digestBootstrapToken(RAW_TOKEN) }] };
    });
    const options = { database: { raw }, now: NOW };

    const first = await consumeBootstrapToken(digestBootstrapToken(RAW_TOKEN), options);
    const second = await consumeBootstrapToken(digestBootstrapToken(RAW_TOKEN), options);

    expect(first).toBeInstanceOf(BootstrapToken);
    expect(second).toBeUndefined();
    expect(String(raw.mock.calls[0][0])).toContain('consumed_at IS NULL');
    expect(raw.mock.calls[0][1]).toEqual([
      NOW.toISOString(),
      digestBootstrapToken(RAW_TOKEN),
      'installation',
      NOW.toISOString(),
    ]);
  });
});
