import { describe, expect, it } from 'vitest';

import {
  activeSessionsOnly,
  IdentitySession,
  MAX_SESSION_METADATA_LENGTH,
  normalizeSessionMetadata,
} from './session.js';

function session(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return IdentitySession.fromJson({
    account_id: 'acct-1',
    account_subject: 'subject-1',
    client_id: 'board',
    secret_digest: 'sha256:abcdef',
    expires_at: '2030-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('identity.session model', () => {
  it('classifies active, expired and revoked sessions', () => {
    const now = new Date('2029-01-01T00:00:00.000Z');
    const active = session();
    const expired = session({ expires_at: '2028-01-01T00:00:00.000Z' });
    const revoked = session({ revoked_at: '2028-06-01T00:00:00.000Z' });
    expect(active.isActive(now)).toBe(true);
    expect(expired.isActive(now)).toBe(false);
    expect(revoked.isActive(now)).toBe(false);
    expect(activeSessionsOnly([active, expired, revoked], now)).toEqual([active]);
  });

  it('bounds and redacts metadata without storing a raw token', () => {
    const value = 'x'.repeat(MAX_SESSION_METADATA_LENGTH + 100);
    const metadata = normalizeSessionMetadata({ device: value, userAgent: '  Browser/1.0  ' });
    expect(metadata.device).toHaveLength(MAX_SESSION_METADATA_LENGTH);
    expect(metadata.userAgent).toBe('Browser/1.0');
    const record = session({ metadata });
    record.$beforeInsert({} as never);
    const json = record.toJSON() as Record<string, unknown>;
    expect(json).not.toHaveProperty('token');
    expect(json.secret_digest).toBe('sha256:abcdef');
  });
});
