import { createHash } from 'node:crypto';
import { createRedactor } from '@moonwitness/ai-runtime';
import { assertNonEmpty, assertPositiveInteger } from '@moonwitness/types';

/**
 * CF-017 (issue #71): explicit per-agent A2A peer key identity.
 *
 * The receiver no longer has to treat one company-wide HMAC secret as proof of
 * peer identity. Every signing key is registered with a key ID, a company and
 * an agent code; rotation has a bounded overlap window, revocation is
 * immediate and retirement is deterministic. Secret material lives only in a
 * private field of the registry. Audit records and snapshots carry a SHA-256
 * fingerprint instead, so secrets can never leak into audit payloads or logs.
 */

export const MAX_PEER_KEY_GRACE_WINDOW_MS = 600_000;
export const MIN_PEER_KEY_SECRET_LENGTH = 32;

export type A2aPeerKeyState = 'active' | 'grace' | 'revoked' | 'retired';

export type A2aPeerIdentityAuditAction =
  'registered' | 'rotation_started' | 'retired' | 'revoked' | 'resolved' | 'rejected';

export interface A2aPeerKeyRegistration {
  readonly keyId: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly secret: string;
  readonly activatedAt: number;
  readonly expiresAt?: number;
}

export interface A2aPeerKeyRotation {
  readonly previousKeyId: string;
  readonly nextKeyId: string;
  readonly nextSecret: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly rotatedAt: number;
  readonly graceWindowMs: number;
}

/** Safe-to-serialize audit record: never contains secret material. */
export interface A2aPeerIdentityAuditEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly keyId: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly action: A2aPeerIdentityAuditAction;
  readonly at: number;
  readonly fingerprintSha256: string;
  readonly reasonCode?: string;
}

/** Safe-to-serialize key snapshot: fingerprint only, no secret. */
export interface A2aPeerIdentitySnapshotKey {
  readonly keyId: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly state: A2aPeerKeyState;
  readonly fingerprintSha256: string;
  readonly activatedAt: number;
  readonly graceUntilAt?: number;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly retiredAt?: number;
  readonly rotationFromKeyId?: string;
}

export interface A2aPeerIdentitySnapshot {
  readonly keys: readonly A2aPeerIdentitySnapshotKey[];
  readonly audit: readonly A2aPeerIdentityAuditEvent[];
}

/** Internal-only resolution result: the secret is handed to HMAC verification, never serialized. */
export interface A2aPeerKeyResolution {
  readonly keyId: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly secret: string;
  readonly state: A2aPeerKeyState;
  readonly fingerprintSha256: string;
}

export type A2aPeerIdentityRejectionReasonCode =
  | 'PEER_KEY_ID_REQUIRED'
  | 'PEER_KEY_UNKNOWN'
  | 'PEER_KEY_CROSS_COMPANY_REUSE'
  | 'PEER_KEY_AGENT_MISMATCH'
  | 'PEER_KEY_REVOKED'
  | 'PEER_KEY_RETIRED'
  | 'PEER_KEY_EXPIRED'
  | 'PEER_KEY_GRACE_EXPIRED';

export type A2aPeerIdentityResolutionResult =
  | { readonly ok: true; readonly key: A2aPeerKeyResolution }
  | {
      readonly ok: false;
      readonly reasonCode: A2aPeerIdentityRejectionReasonCode;
      readonly error: string;
    };

export interface A2aPeerIdentityResolveInput {
  readonly keyId: string | undefined;
  readonly companyId: number;
  readonly agentCode: string;
  readonly nowMs: number;
}

interface StoredPeerKey extends A2aPeerIdentitySnapshotKey {
  readonly secret: string;
}

export function fingerprintPeerKeySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function toSnapshotKey(key: StoredPeerKey): A2aPeerIdentitySnapshotKey {
  const { secret: _secret, ...safe } = key;
  return Object.freeze({ ...safe });
}

export class A2aPeerIdentityRegistry {
  readonly #keys = new Map<string, StoredPeerKey>();
  readonly #fingerprints = new Set<string>();
  readonly #audit: A2aPeerIdentityAuditEvent[] = [];
  #sequence = 0;

  register(input: A2aPeerKeyRegistration): A2aPeerIdentitySnapshotKey {
    const redactor = createRedactor([input.secret]);
    assertNonEmpty(input.keyId, 'keyId');
    assertNonEmpty(input.agentCode, 'agentCode');
    assertPositiveInteger(input.companyId, 'companyId');
    assertPositiveInteger(input.activatedAt, 'activatedAt');
    if (input.keyId.length > 128 || input.agentCode.length > 128) {
      throw new Error('keyId and agentCode must be at most 128 characters');
    }
    if (typeof input.secret !== 'string' || input.secret.length < MIN_PEER_KEY_SECRET_LENGTH) {
      throw new Error(redactor.redactString('Peer key secret must be at least 32 characters.'));
    }
    if (input.expiresAt !== undefined) {
      assertPositiveInteger(input.expiresAt, 'expiresAt');
      if (input.expiresAt <= input.activatedAt) {
        throw new Error('expiresAt must be later than activatedAt');
      }
    }
    if (this.#keys.has(input.keyId)) {
      throw new Error(`peer key ${input.keyId} is already registered`);
    }
    const fingerprintSha256 = fingerprintPeerKeySecret(input.secret);
    if (this.#fingerprints.has(fingerprintSha256)) {
      // One secret must never be usable as two agent/company identities.
      throw new Error('peer key secret is already bound to another key identity');
    }

    const stored: StoredPeerKey = {
      keyId: input.keyId,
      companyId: input.companyId,
      agentCode: input.agentCode,
      state: 'active',
      fingerprintSha256,
      activatedAt: input.activatedAt,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      secret: input.secret,
    };
    this.#keys.set(input.keyId, stored);
    this.#fingerprints.add(fingerprintSha256);
    this.#appendAudit(stored, 'registered', input.activatedAt);
    return toSnapshotKey(stored);
  }

  /**
   * Start a bounded overlap: the previous key stays usable as `grace` until
   * `rotatedAt + graceWindowMs`, then retires deterministically.
   */
  rotate(input: A2aPeerKeyRotation): void {
    const previous = this.#keys.get(input.previousKeyId);
    if (!previous) throw new Error(`peer key ${input.previousKeyId} is not registered`);
    if (previous.state !== 'active') {
      throw new Error(`peer key ${input.previousKeyId} is not active and cannot be rotated`);
    }
    if (previous.companyId !== input.companyId || previous.agentCode !== input.agentCode) {
      throw new Error('peer key rotation must preserve company and agent binding');
    }
    if (
      !Number.isSafeInteger(input.graceWindowMs) ||
      input.graceWindowMs < 1 ||
      input.graceWindowMs > MAX_PEER_KEY_GRACE_WINDOW_MS
    ) {
      throw new Error(`graceWindowMs must be an integer from 1 to ${MAX_PEER_KEY_GRACE_WINDOW_MS}`);
    }
    assertPositiveInteger(input.rotatedAt, 'rotatedAt');

    const next = this.register({
      keyId: input.nextKeyId,
      companyId: input.companyId,
      agentCode: input.agentCode,
      secret: input.nextSecret,
      activatedAt: input.rotatedAt,
    });
    const nextKey = this.#keys.get(next.keyId)!;
    this.#keys.set(next.keyId, { ...nextKey, rotationFromKeyId: previous.keyId });

    const graceUntilAt = input.rotatedAt + input.graceWindowMs;
    this.#keys.set(previous.keyId, { ...previous, state: 'grace', graceUntilAt });
    this.#appendAudit(
      { ...previous, state: 'grace', graceUntilAt },
      'rotation_started',
      input.rotatedAt,
      `rotated-to:${input.nextKeyId}`
    );
  }

  revoke(keyId: string, at: number, reasonCode = 'OPERATOR_REVOCATION'): void {
    assertPositiveInteger(at, 'at');
    const key = this.#keys.get(keyId);
    if (!key) throw new Error(`peer key ${keyId} is not registered`);
    if (key.state === 'revoked') return;
    const revoked: StoredPeerKey = { ...key, state: 'revoked', revokedAt: at };
    this.#keys.set(keyId, revoked);
    this.#appendAudit(revoked, 'revoked', at, reasonCode);
  }

  /** Deterministic time-driven retirement; no wall-clock reads inside the registry. */
  retireExpired(nowMs: number): readonly string[] {
    assertPositiveInteger(nowMs, 'nowMs');
    const retired: string[] = [];
    for (const key of [...this.#keys.values()]) {
      const graceExpired =
        key.state === 'grace' && key.graceUntilAt !== undefined && nowMs >= key.graceUntilAt;
      const lifetimeExpired =
        key.state === 'active' && key.expiresAt !== undefined && nowMs >= key.expiresAt;
      if (!graceExpired && !lifetimeExpired) continue;
      const retiredKey: StoredPeerKey = { ...key, state: 'retired', retiredAt: nowMs };
      this.#keys.set(key.keyId, retiredKey);
      this.#appendAudit(
        retiredKey,
        'retired',
        nowMs,
        graceExpired ? 'GRACE_WINDOW_ELAPSED' : 'KEY_EXPIRED'
      );
      retired.push(key.keyId);
    }
    return retired.sort((left, right) => left.localeCompare(right));
  }

  resolve(input: A2aPeerIdentityResolveInput): A2aPeerIdentityResolutionResult {
    assertPositiveInteger(input.nowMs, 'nowMs');
    // Fail closed on time-based expiry here; `retireExpired(nowMs)` performs the
    // deterministic state transition when a caller asks for a snapshot.
    const reject = (
      reasonCode: A2aPeerIdentityRejectionReasonCode,
      error: string
    ): A2aPeerIdentityResolutionResult => {
      if (input.keyId) {
        const key = this.#keys.get(input.keyId);
        if (key) this.#appendAudit(key, 'rejected', input.nowMs, reasonCode);
      }
      return { ok: false, reasonCode, error };
    };

    if (typeof input.keyId !== 'string' || input.keyId.trim().length === 0) {
      return {
        ok: false,
        reasonCode: 'PEER_KEY_ID_REQUIRED',
        error: 'A2A envelope is missing keyId',
      };
    }
    const key = this.#keys.get(input.keyId);
    if (!key) return reject('PEER_KEY_UNKNOWN', 'A2A signing key is not registered');
    if (key.companyId !== input.companyId) {
      return reject('PEER_KEY_CROSS_COMPANY_REUSE', 'A2A signing key belongs to another company');
    }
    if (key.agentCode !== input.agentCode) {
      return reject('PEER_KEY_AGENT_MISMATCH', 'A2A signing key is pinned to a different agent');
    }
    if (key.state === 'revoked') {
      return reject('PEER_KEY_REVOKED', 'A2A signing key has been revoked');
    }
    if (key.state === 'retired') {
      return reject('PEER_KEY_RETIRED', 'A2A signing key has been retired');
    }
    if (key.expiresAt !== undefined && input.nowMs >= key.expiresAt) {
      return reject('PEER_KEY_EXPIRED', 'A2A signing key has expired');
    }
    if (
      key.state === 'grace' &&
      key.graceUntilAt !== undefined &&
      input.nowMs >= key.graceUntilAt
    ) {
      return reject('PEER_KEY_GRACE_EXPIRED', 'A2A key rotation grace window has elapsed');
    }

    this.#appendAudit(key, 'resolved', input.nowMs);
    return {
      ok: true,
      key: {
        keyId: key.keyId,
        companyId: key.companyId,
        agentCode: key.agentCode,
        secret: key.secret,
        state: key.state,
        fingerprintSha256: key.fingerprintSha256,
      },
    };
  }

  snapshot(nowMs?: number): A2aPeerIdentitySnapshot {
    if (nowMs !== undefined) this.retireExpired(nowMs);
    return Object.freeze({
      keys: Object.freeze(
        [...this.#keys.values()]
          .sort((left, right) => left.keyId.localeCompare(right.keyId))
          .map(toSnapshotKey)
      ),
      audit: this.auditHistory(),
    });
  }

  auditHistory(): readonly A2aPeerIdentityAuditEvent[] {
    return Object.freeze(this.#audit.map((entry) => Object.freeze({ ...entry })));
  }

  #appendAudit(
    key: StoredPeerKey,
    action: A2aPeerIdentityAuditAction,
    at: number,
    reasonCode?: string
  ): void {
    this.#sequence += 1;
    this.#audit.push(
      Object.freeze({
        eventId: `${key.keyId}#${this.#sequence}`,
        sequence: this.#sequence,
        keyId: key.keyId,
        companyId: key.companyId,
        agentCode: key.agentCode,
        action,
        at,
        fingerprintSha256: key.fingerprintSha256,
        ...(reasonCode !== undefined ? { reasonCode } : {}),
      })
    );
  }
}

export function createA2aPeerIdentityRegistry(
  registrations: readonly A2aPeerKeyRegistration[] = []
): A2aPeerIdentityRegistry {
  const registry = new A2aPeerIdentityRegistry();
  for (const registration of registrations) registry.register(registration);
  return registry;
}

export interface A2aPeerIdentityRegistryDocument {
  readonly keys: readonly A2aPeerKeyRegistration[];
  readonly rotations?: readonly A2aPeerKeyRotation[];
}

/** Env/JSON loader shared by the API receiver and the Control Plane forwarder. */
export function createA2aPeerIdentityRegistryFromJson(json: string): A2aPeerIdentityRegistry {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('peer identity registry JSON must be an object');
  }
  const document = parsed as Partial<A2aPeerIdentityRegistryDocument>;
  if (!Array.isArray(document.keys)) {
    throw new Error('peer identity registry JSON requires a keys array');
  }
  if (document.rotations !== undefined && !Array.isArray(document.rotations)) {
    throw new Error('peer identity registry rotations must be an array');
  }
  const registry = createA2aPeerIdentityRegistry(document.keys);
  for (const rotation of document.rotations ?? []) registry.rotate(rotation);
  return registry;
}
