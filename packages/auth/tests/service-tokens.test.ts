import { describe, expect, it } from 'vitest';
import {
  ServiceTokenAuthority,
  constantTimeEqualBytes,
  constantTimeEqualStrings,
  evaluateRbacScopes,
} from '../src/service-tokens.js';

describe('ServiceTokenAuthority & RBAC', () => {
  const BASE_MS = 1_700_000_000_000;

  it('issues and verifies HMAC-SHA256 bearer tokens with explicit claims', () => {
    const auth = new ServiceTokenAuthority({
      kid: 'k1',
      secret: 'super-secret-signing-key-0001',
      createdAtMs: BASE_MS,
    });

    const token = auth.issueToken({
      sub: 'svc-ingest',
      iss: 'mw-auth',
      aud: 'mw-vault',
      scopes: ['vault:read', 'vault:write'],
      ttlSeconds: 300,
      nowMs: BASE_MS,
    });

    const res = auth.verifyToken(token, {
      expectedIss: 'mw-auth',
      expectedAud: 'mw-vault',
      requiredScopes: ['vault:read'],
      nowMs: BASE_MS + 10_000,
    });

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.kid).toBe('k1');
      expect(res.claims.sub).toBe('svc-ingest');
      expect(res.claims.scopes).toEqual(['vault:read', 'vault:write']);
    }
  });

  it('supports kid key rotation with dual-key grace window and rejects after grace expires', () => {
    const auth = new ServiceTokenAuthority({
      kid: 'k1',
      secret: 'primary-secret-key-000001',
      createdAtMs: BASE_MS,
    });

    const k1Token = auth.issueToken({
      sub: 'svc-worker',
      iss: 'mw-auth',
      aud: 'mw-api',
      scopes: ['jobs:run'],
      ttlSeconds: 3600,
      nowMs: BASE_MS,
    });

    // Rotate to k2 with a 60s grace window for k1
    auth.rotateKey(
      { kid: 'k2', secret: 'rotated-secret-key-000002', createdAtMs: BASE_MS + 10_000 },
      60_000,
      BASE_MS + 10_000
    );
    expect(auth.getActiveKid()).toBe('k2');

    // k1 token still valid during grace window
    const duringGrace = auth.verifyToken(k1Token, { nowMs: BASE_MS + 50_000 });
    expect(duringGrace.valid).toBe(true);

    // k2 token valid
    const k2Token = auth.issueToken({
      sub: 'svc-worker',
      iss: 'mw-auth',
      aud: 'mw-api',
      scopes: ['jobs:run'],
      ttlSeconds: 3600,
      nowMs: BASE_MS + 50_000,
    });
    expect(auth.verifyToken(k2Token, { nowMs: BASE_MS + 50_000 }).valid).toBe(true);

    // k1 token rejected after grace window expires
    const afterGrace = auth.verifyToken(k1Token, { nowMs: BASE_MS + 71_000 });
    expect(afterGrace.valid).toBe(false);
    if (!afterGrace.valid) {
      expect(afterGrace.code).toBe('KEY_GRACE_EXPIRED');
    }
  });

  it('enforces explicit exp, nbf, tampered signature, and key revocation', () => {
    const auth = new ServiceTokenAuthority({
      kid: 'k1',
      secret: 'strict-signing-key-000001',
      createdAtMs: BASE_MS,
    });

    const token = auth.issueToken({
      sub: 'svc-sync',
      iss: 'mw-auth',
      aud: 'mw-api',
      scopes: ['sync:push'],
      ttlSeconds: 120,
      notBeforeOffsetSeconds: 30,
      nowMs: BASE_MS,
    });

    // Before nbf
    const early = auth.verifyToken(token, { nowMs: BASE_MS + 10_000 });
    expect(early.valid).toBe(false);
    if (!early.valid) expect(early.code).toBe('TOKEN_NOT_YET_VALID');

    // After exp
    const expired = auth.verifyToken(token, { nowMs: BASE_MS + 125_000 });
    expect(expired.valid).toBe(false);
    if (!expired.valid) expect(expired.code).toBe('TOKEN_EXPIRED');

    // Tampered payload
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    const badSig = auth.verifyToken(tampered, { nowMs: BASE_MS + 40_000 });
    expect(badSig.valid).toBe(false);

    // Revoked key
    auth.revokeKey('k1');
    const revoked = auth.verifyToken(token, { nowMs: BASE_MS + 40_000 });
    expect(revoked.valid).toBe(false);
    if (!revoked.valid) expect(revoked.code).toBe('KEY_REVOKED');
  });

  it('evaluates deny-by-default RBAC scopes with wildcards and explicit denies', () => {
    // Deny-by-default on empty required or empty granted
    expect(evaluateRbacScopes(['vault:read'], []).allowed).toBe(false);
    expect(evaluateRbacScopes([], ['vault:read']).allowed).toBe(false);

    // Wildcard namespace
    expect(evaluateRbacScopes(['vault:*'], ['vault:read', 'vault:write']).allowed).toBe(true);
    expect(evaluateRbacScopes(['vault:*'], ['billing:read']).allowed).toBe(false);

    // Explicit deny overrides wildcard allow
    const denied = evaluateRbacScopes(['vault:*', '!vault:delete'], ['vault:read', 'vault:delete']);
    expect(denied.allowed).toBe(false);
    expect(denied.deniedBy).toEqual(['!vault:delete']);
  });

  it('issues and verifies scoped API keys with constant-time digest comparison', () => {
    const auth = new ServiceTokenAuthority({
      kid: 'k1',
      secret: 'api-key-authority-secret-01',
      createdAtMs: BASE_MS,
    });

    const issued = auth.issueApiKey({
      subject: 'partner-webhook',
      scopes: ['webhook:emit'],
      ttlMs: 60_000,
      nowMs: BASE_MS,
    });

    expect(issued.rawKey.startsWith('mw_sk_k1_')).toBe(true);
    expect(
      auth.verifyApiKey(issued.rawKey, issued.record, {
        requiredScopes: ['webhook:emit'],
        nowMs: BASE_MS + 1000,
      }).valid
    ).toBe(true);

    // Wrong scope
    expect(
      auth.verifyApiKey(issued.rawKey, issued.record, {
        requiredScopes: ['vault:delete'],
        nowMs: BASE_MS + 1000,
      }).valid
    ).toBe(false);

    // Expired
    expect(auth.verifyApiKey(issued.rawKey, issued.record, { nowMs: BASE_MS + 61_000 }).valid).toBe(
      false
    );

    // Constant-time helpers
    expect(constantTimeEqualStrings('abc', 'abc')).toBe(true);
    expect(constantTimeEqualStrings('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualBytes(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(constantTimeEqualBytes(Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false);
  });
});
