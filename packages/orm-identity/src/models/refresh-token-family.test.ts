import { describe, expect, it, vi } from 'vitest';

import {
  consumeAndRotateRefreshToken,
  digestRefreshToken,
  RefreshTokenFamily,
} from './refresh-token-family.js';

const TOKEN = 'plain-refresh-token-value';

describe('refresh token family', () => {
  it('stores only a digest and hides it from JSON output', () => {
    const record = RefreshTokenFamily.fromJson({
      account_id: 'acct-1',
      session_id: 'session-1',
      token_digest: TOKEN,
      expires_at: '2030-01-01T00:00:00.000Z',
    });
    record.$beforeInsert({} as never);
    expect(record.token_digest).toBe(digestRefreshToken(TOKEN));
    expect(JSON.stringify(record.toJSON())).not.toContain(TOKEN);
    expect(JSON.stringify(record.toJSON())).not.toContain('token_digest');
  });

  it('consumes once atomically and rejects concurrent reuse', async () => {
    let consumed = false;
    const raw = vi.fn(async (sql: string) => {
      if (sql.startsWith('UPDATE')) {
        if (consumed) return { rows: [] };
        consumed = true;
        return { rows: [{ family_id: 'family-1', session_id: 'session-1' }] };
      }
      return { rows: [{ family_id: 'family-1', session_id: 'session-1', consumed_at: new Date().toISOString() }] };
    });
    const revokeFamily = vi.fn(async () => undefined);
    const options = { database: { raw }, revokeFamily };
    const first = await consumeAndRotateRefreshToken(TOKEN, options);
    const second = await consumeAndRotateRefreshToken(TOKEN, options);
    expect(first.status).toBe('rotated');
    expect(second.status).toBe('replayed');
    expect(revokeFamily).toHaveBeenCalledWith('family-1', 'session-1');
  });

  it('detects expired and revoked tokens without consuming them', async () => {
    const past = '2020-01-01T00:00:00.000Z';
    const raw = vi.fn(async (sql: string) =>
      sql.startsWith('UPDATE')
        ? { rows: [] }
        : { rows: [{ family_id: 'family-2', session_id: 'session-2', expires_at: past }] }
    );
    const revokeFamily = vi.fn(async () => undefined);
    const result = await consumeAndRotateRefreshToken(TOKEN, { database: { raw }, revokeFamily });
    expect(result.status).toBe('expired');
    expect(revokeFamily).not.toHaveBeenCalled();
  });
});
