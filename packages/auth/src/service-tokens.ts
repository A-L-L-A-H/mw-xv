import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SigningKeyRecord {
  readonly kid: string;
  readonly secret: string | Uint8Array;
  readonly createdAtMs: number;
  /** Optional grace expiration timestamp (ms). After this time the key is no longer accepted for verification. */
  readonly graceExpiresAtMs?: number;
  readonly revoked?: boolean;
}

export interface ServiceTokenClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
  readonly scopes: readonly string[];
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
}

export interface IssueServiceTokenInput {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
  readonly scopes: readonly string[];
  readonly ttlSeconds: number;
  readonly notBeforeOffsetSeconds?: number;
  readonly jti?: string;
  readonly nowMs?: number;
}

export interface VerifyServiceTokenOptions {
  readonly expectedIss?: string;
  readonly expectedAud?: string;
  readonly requiredScopes?: readonly string[];
  readonly nowMs?: number;
  readonly clockSkewSeconds?: number;
}

export type TokenVerificationFailureCode =
  | 'MALFORMED_TOKEN'
  | 'UNSUPPORTED_ALG'
  | 'UNKNOWN_KID'
  | 'KEY_REVOKED'
  | 'KEY_GRACE_EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'ISSUER_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'INSUFFICIENT_SCOPE';

export type TokenVerificationResult =
  | { readonly valid: true; readonly kid: string; readonly claims: ServiceTokenClaims }
  | { readonly valid: false; readonly code: TokenVerificationFailureCode; readonly reason: string };

export interface RbacEvaluationResult {
  readonly allowed: boolean;
  readonly missing: readonly string[];
  readonly deniedBy: readonly string[];
}

export interface ScopedApiKeyRecord {
  readonly id: string;
  readonly kid: string;
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly keyHashHex: string;
  readonly createdAtMs: number;
  readonly expiresAtMs?: number;
  readonly revoked?: boolean;
}

export interface IssuedApiKey {
  readonly rawKey: string;
  readonly record: ScopedApiKeyRecord;
}

interface TokenHeader {
  readonly alg: 'HS256';
  readonly typ: 'MW-SVC';
  readonly kid: string;
}

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function normalizeSecret(secret: string | Uint8Array): Buffer {
  const buf = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (buf.byteLength < 16) {
    throw new Error('Signing key secret must be at least 16 bytes');
  }
  return buf;
}

export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  return constantTimeEqualBytes(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function scopeMatchesPattern(pattern: string, target: string): boolean {
  if (pattern === '*') return true;
  if (pattern === target) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // includes trailing ':'
    return target.startsWith(prefix) && target.length > prefix.length;
  }
  return false;
}

/**
 * Deny-by-default RBAC scope evaluator.
 * - Requires at least one required scope to be checked; if requiredScopes is empty, defaults to deny unless allowEmptyRequired is true.
 * - Supports explicit deny rules prefixed with `!` (e.g. `!vault:delete`), which always override allow rules.
 * - Supports exact scopes (`vault:read`) and namespace wildcards (`vault:*`, `*`).
 */
export function evaluateRbacScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
  options: { readonly allowEmptyRequired?: boolean } = {}
): RbacEvaluationResult {
  if (requiredScopes.length === 0) {
    if (options.allowEmptyRequired) {
      return { allowed: true, missing: [], deniedBy: [] };
    }
    return { allowed: false, missing: ['<none-specified>'], deniedBy: [] };
  }

  const allowPatterns: string[] = [];
  const denyPatterns: string[] = [];
  for (const raw of grantedScopes) {
    const scope = raw.trim();
    if (!scope) continue;
    if (scope.startsWith('!')) {
      const stripped = scope.slice(1).trim();
      if (stripped) denyPatterns.push(stripped);
    } else {
      allowPatterns.push(scope);
    }
  }

  const missing: string[] = [];
  const deniedBy: string[] = [];

  for (const rawReq of requiredScopes) {
    const req = rawReq.trim();
    if (!req) {
      missing.push(rawReq);
      continue;
    }

    const matchedDeny = denyPatterns.find((pattern) => scopeMatchesPattern(pattern, req));
    if (matchedDeny) {
      deniedBy.push(`!${matchedDeny}`);
      continue;
    }

    const matchedAllow = allowPatterns.some((pattern) => scopeMatchesPattern(pattern, req));
    if (!matchedAllow) {
      missing.push(req);
    }
  }

  return {
    allowed: missing.length === 0 && deniedBy.length === 0,
    missing,
    deniedBy,
  };
}

/**
 * Service-to-service HMAC-SHA256 bearer token & scoped API key authority
 * supporting key-ID (`kid`) rotation with dual-key grace windows.
 */
export class ServiceTokenAuthority {
  private readonly keys = new Map<string, SigningKeyRecord>();
  private activeKid: string;

  constructor(initialKey: SigningKeyRecord) {
    if (!initialKey.kid.trim()) {
      throw new Error('Signing key kid must be non-empty');
    }
    normalizeSecret(initialKey.secret);
    this.keys.set(initialKey.kid, initialKey);
    this.activeKid = initialKey.kid;
  }

  getActiveKid(): string {
    return this.activeKid;
  }

  /**
   * Rotate to a new active signing key while keeping the previous active key
   * valid for verification during `graceWindowMs`.
   */
  rotateKey(nextKey: SigningKeyRecord, graceWindowMs: number, nowMs: number = Date.now()): void {
    if (!nextKey.kid.trim()) {
      throw new Error('Next signing key kid must be non-empty');
    }
    if (this.keys.has(nextKey.kid)) {
      throw new Error(`Signing key kid "${nextKey.kid}" already exists`);
    }
    if (!Number.isFinite(graceWindowMs) || graceWindowMs < 0) {
      throw new Error('graceWindowMs must be a non-negative finite number');
    }
    normalizeSecret(nextKey.secret);

    const previous = this.keys.get(this.activeKid);
    if (previous) {
      this.keys.set(previous.kid, {
        ...previous,
        graceExpiresAtMs: nowMs + graceWindowMs,
      });
    }

    this.keys.set(nextKey.kid, nextKey);
    this.activeKid = nextKey.kid;
  }

  revokeKey(kid: string): void {
    const existing = this.keys.get(kid);
    if (!existing) return;
    this.keys.set(kid, { ...existing, revoked: true });
  }

  issueToken(input: IssueServiceTokenInput): string {
    if (!input.sub.trim() || !input.iss.trim() || !input.aud.trim()) {
      throw new Error('sub, iss, and aud must be non-empty');
    }
    if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
      throw new Error('ttlSeconds must be a positive finite number');
    }

    const activeKey = this.keys.get(this.activeKid);
    if (!activeKey || activeKey.revoked) {
      throw new Error('Active signing key is unavailable or revoked');
    }

    const nowMs = input.nowMs ?? Date.now();
    const iat = Math.floor(nowMs / 1000);
    const nbf = iat + Math.floor(input.notBeforeOffsetSeconds ?? 0);
    const exp = iat + Math.floor(input.ttlSeconds);

    const header: TokenHeader = {
      alg: 'HS256',
      typ: 'MW-SVC',
      kid: activeKey.kid,
    };

    const claims: ServiceTokenClaims = {
      sub: input.sub,
      iss: input.iss,
      aud: input.aud,
      scopes: [...input.scopes],
      iat,
      nbf,
      exp,
      jti: input.jti ?? randomBytes(16).toString('hex'),
    };

    const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claims))}`;
    const signature = createHmac('sha256', normalizeSecret(activeKey.secret))
      .update(signingInput)
      .digest();

    return `${signingInput}.${toBase64Url(signature)}`;
  }

  verifyToken(token: string, options: VerifyServiceTokenOptions = {}): TokenVerificationResult {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      return {
        valid: false,
        code: 'MALFORMED_TOKEN',
        reason: 'Token must have 3 non-empty segments',
      };
    }

    const [encodedHeader, encodedPayload, encodedSig] = parts as [string, string, string];
    let header: Partial<TokenHeader>;
    let claims: Partial<ServiceTokenClaims>;
    try {
      header = JSON.parse(fromBase64Url(encodedHeader).toString('utf8')) as Partial<TokenHeader>;
      claims = JSON.parse(
        fromBase64Url(encodedPayload).toString('utf8')
      ) as Partial<ServiceTokenClaims>;
    } catch {
      return {
        valid: false,
        code: 'MALFORMED_TOKEN',
        reason: 'Token header or payload is not valid JSON',
      };
    }

    if (header.alg !== 'HS256' || header.typ !== 'MW-SVC' || typeof header.kid !== 'string') {
      return {
        valid: false,
        code: 'UNSUPPORTED_ALG',
        reason: 'Unsupported token algorithm or header',
      };
    }

    const keyRecord = this.keys.get(header.kid);
    if (!keyRecord) {
      return { valid: false, code: 'UNKNOWN_KID', reason: `Unknown key ID: ${header.kid}` };
    }
    if (keyRecord.revoked) {
      return {
        valid: false,
        code: 'KEY_REVOKED',
        reason: `Signing key "${header.kid}" is revoked`,
      };
    }

    const nowMs = options.nowMs ?? Date.now();
    if (keyRecord.graceExpiresAtMs !== undefined && nowMs > keyRecord.graceExpiresAtMs) {
      return {
        valid: false,
        code: 'KEY_GRACE_EXPIRED',
        reason: `Grace window for key "${header.kid}" has expired`,
      };
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = createHmac('sha256', normalizeSecret(keyRecord.secret))
      .update(signingInput)
      .digest();
    const providedSig = fromBase64Url(encodedSig);

    if (!constantTimeEqualBytes(expectedSig, providedSig)) {
      return {
        valid: false,
        code: 'INVALID_SIGNATURE',
        reason: 'HMAC signature verification failed',
      };
    }

    if (
      typeof claims.sub !== 'string' ||
      typeof claims.iss !== 'string' ||
      typeof claims.aud !== 'string' ||
      !Array.isArray(claims.scopes) ||
      typeof claims.iat !== 'number' ||
      typeof claims.nbf !== 'number' ||
      typeof claims.exp !== 'number' ||
      typeof claims.jti !== 'string'
    ) {
      return {
        valid: false,
        code: 'MALFORMED_TOKEN',
        reason: 'Token claims are missing required fields',
      };
    }

    const nowSec = Math.floor(nowMs / 1000);
    const skew = Math.max(0, Math.floor(options.clockSkewSeconds ?? 0));

    if (nowSec - skew >= claims.exp) {
      return { valid: false, code: 'TOKEN_EXPIRED', reason: 'Token has expired' };
    }
    if (nowSec + skew < claims.nbf) {
      return { valid: false, code: 'TOKEN_NOT_YET_VALID', reason: 'Token is not yet valid (nbf)' };
    }

    if (options.expectedIss !== undefined && claims.iss !== options.expectedIss) {
      return { valid: false, code: 'ISSUER_MISMATCH', reason: 'Token issuer mismatch' };
    }
    if (options.expectedAud !== undefined && claims.aud !== options.expectedAud) {
      return { valid: false, code: 'AUDIENCE_MISMATCH', reason: 'Token audience mismatch' };
    }

    if (options.requiredScopes !== undefined) {
      const rbac = evaluateRbacScopes(claims.scopes, options.requiredScopes);
      if (!rbac.allowed) {
        return {
          valid: false,
          code: 'INSUFFICIENT_SCOPE',
          reason: `RBAC denied: missing=[${rbac.missing.join(',')}], deniedBy=[${rbac.deniedBy.join(',')}]`,
        };
      }
    }

    return {
      valid: true,
      kid: header.kid,
      claims: claims as ServiceTokenClaims,
    };
  }

  /**
   * Issue a scoped API key bound to the active `kid`. Only the SHA-256 hash is stored in the record.
   */
  issueApiKey(input: {
    readonly subject: string;
    readonly scopes: readonly string[];
    readonly ttlMs?: number;
    readonly nowMs?: number;
  }): IssuedApiKey {
    if (!input.subject.trim()) {
      throw new Error('API key subject must be non-empty');
    }
    const nowMs = input.nowMs ?? Date.now();
    const id = randomBytes(8).toString('hex');
    const secretPart = randomBytes(24).toString('base64url');
    const rawKey = `mw_sk_${this.activeKid}_${id}_${secretPart}`;
    const keyHashHex = createHash('sha256').update(rawKey, 'utf8').digest('hex');

    const record: ScopedApiKeyRecord = {
      id,
      kid: this.activeKid,
      subject: input.subject,
      scopes: [...input.scopes],
      keyHashHex,
      createdAtMs: nowMs,
      ...(input.ttlMs !== undefined ? { expiresAtMs: nowMs + input.ttlMs } : {}),
    };

    return { rawKey, record };
  }

  verifyApiKey(
    rawKey: string,
    record: ScopedApiKeyRecord,
    options: { readonly requiredScopes?: readonly string[]; readonly nowMs?: number } = {}
  ): { readonly valid: boolean; readonly reason?: string } {
    if (record.revoked) {
      return { valid: false, reason: 'API key is revoked' };
    }
    const nowMs = options.nowMs ?? Date.now();
    if (record.expiresAtMs !== undefined && nowMs >= record.expiresAtMs) {
      return { valid: false, reason: 'API key has expired' };
    }

    const candidateHash = createHash('sha256').update(rawKey, 'utf8').digest('hex');
    if (!constantTimeEqualStrings(candidateHash, record.keyHashHex)) {
      return { valid: false, reason: 'API key digest mismatch' };
    }

    if (options.requiredScopes !== undefined) {
      const rbac = evaluateRbacScopes(record.scopes, options.requiredScopes);
      if (!rbac.allowed) {
        return { valid: false, reason: 'API key lacks required scopes' };
      }
    }

    return { valid: true };
  }
}
