/**
 * CF-018 (issue #72): transport-authenticated A2A peer identity.
 *
 * Contract for the API receiver and the Control Plane forwarder:
 *
 * 1. Identity comes only from the *verified* TLS client certificate on the
 *    accepted socket (`getPeerCertificate()` + `authorized === true`).
 *    Proxy/forwarded headers (`x-forwarded-*`, `x-client-cert*`,
 *    `x-ssl-client-*`, ...) are deliberately never read: they are
 *    client-controlled and cannot prove transport identity.
 * 2. The certificate's SPIFFE/SAN URI (or CN fallback) and its SHA-256
 *    fingerprint must match an explicit allowlist entry bound to the same
 *    company and agent as the CF-017 registered signing key.
 * 3. Missing, expired, not-yet-valid, untrusted, unlisted, revoked or
 *    mismatched certificates fail closed.
 * 4. Certificate rotation is allowlist-based: add the new fingerprint while
 *    keeping the old one during overlap, then move the old fingerprint into
 *    `revokedFingerprints` (or remove it) to complete retirement. Revocation is
 *    immediate and needs no restart.
 *
 * This module is pure: no listener, no production certificate rollout and no
 * public endpoint are introduced by CF-018.
 */

import { assertPositiveInteger } from '@moonwitness/types';

export interface A2aTransportPeerRegistration {
  /** Normalized SAN URI (preferred, e.g. `spiffe://mesh/company/7/agent/source`) or CN. */
  readonly identity: string;
  readonly companyId: number;
  readonly agentCode: string;
  /** SHA-256 certificate fingerprints (hex, colons allowed) currently accepted. */
  readonly allowedFingerprints: readonly string[];
  /** Fingerprints explicitly revoked; checked before the allowlist. */
  readonly revokedFingerprints?: readonly string[];
  /** Optional pin to the CF-017 key ID registered for this agent. */
  readonly keyId?: string;
}

export interface A2aTransportIdentityConfig {
  readonly enabled: boolean;
  readonly peers: readonly A2aTransportPeerRegistration[];
}

export interface A2aTransportVerifiedIdentity {
  readonly identity: string;
  readonly fingerprintSha256: string;
  readonly companyId: number;
  readonly agentCode: string;
  readonly keyId?: string;
  readonly verifiedAt: number;
  readonly source: 'tls_client_certificate';
}

export type A2aTransportIdentityRejectionReasonCode =
  | 'TRANSPORT_TLS_REQUIRED'
  | 'TRANSPORT_CERT_MISSING'
  | 'TRANSPORT_CERT_UNTRUSTED'
  | 'TRANSPORT_CERT_INVALID_VALIDITY'
  | 'TRANSPORT_CERT_NOT_YET_VALID'
  | 'TRANSPORT_CERT_EXPIRED'
  | 'TRANSPORT_CERT_FINGERPRINT_INVALID'
  | 'TRANSPORT_CERT_REVOKED'
  | 'TRANSPORT_CERT_FINGERPRINT_MISMATCH'
  | 'TRANSPORT_IDENTITY_NOT_ALLOWED'
  | 'TRANSPORT_IDENTITY_MISMATCH';

export type A2aTransportIdentityResult =
  | {
      readonly ok: true;
      readonly enforced: boolean;
      readonly identity: A2aTransportVerifiedIdentity | null;
    }
  | {
      readonly ok: false;
      readonly enforced: true;
      readonly reasonCode: A2aTransportIdentityRejectionReasonCode;
      readonly error: string;
    };

export interface A2aPeerCertificate {
  readonly subject?: Readonly<Record<string, string>>;
  readonly subjectaltname?: string;
  readonly fingerprint256?: string;
  readonly valid_from?: string;
  readonly valid_to?: string;
}

export interface A2aTransportCertificateInput {
  readonly protocol?: string;
  readonly authorized?: boolean;
  readonly peerCertificate?: A2aPeerCertificate | null;
  readonly nowMs: number;
}

function reject(
  reasonCode: A2aTransportIdentityRejectionReasonCode,
  error: string
): A2aTransportIdentityResult {
  return { ok: false, enforced: true, reasonCode, error };
}

export function normalizeTransportFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/:/gu, '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function extractCertificateIdentity(certificate: A2aPeerCertificate): string | null {
  const san = certificate.subjectaltname;
  if (typeof san === 'string') {
    for (const entry of san.split(',')) {
      const trimmed = entry.trim();
      if (/^URI:/iu.test(trimmed)) {
        const uri = trimmed.slice(4).trim().toLowerCase();
        if (uri) return uri;
      }
    }
  }
  const commonName = certificate.subject?.CN ?? certificate.subject?.cn;
  return typeof commonName === 'string' && commonName.trim()
    ? commonName.trim().toLowerCase()
    : null;
}

/**
 * Reads transport proof from the accepted socket only. Forwarded headers are
 * intentionally ignored and cannot satisfy this contract.
 */
export function readA2aTransportCertificate(
  request: unknown,
  nowMs: number
): A2aTransportCertificateInput {
  const socket = (request as { raw?: { socket?: Record<string, unknown> } } | undefined)?.raw
    ?.socket;
  if (!socket) return { nowMs };
  const certificate =
    typeof socket.getPeerCertificate === 'function'
      ? (socket.getPeerCertificate() as A2aPeerCertificate | null)
      : undefined;
  return {
    protocol:
      typeof socket.getProtocol === 'function' ? (socket.getProtocol() as string) : undefined,
    authorized: typeof socket.authorized === 'boolean' ? socket.authorized : undefined,
    peerCertificate: certificate ?? undefined,
    nowMs,
  };
}

export function verifyA2aTransportIdentity(
  input: A2aTransportCertificateInput,
  config: A2aTransportIdentityConfig
): A2aTransportIdentityResult {
  if (!config.enabled) return { ok: true, enforced: false, identity: null };

  if (!input.protocol || !/^(?:TLSv1|DTLSv1)/u.test(input.protocol)) {
    return reject(
      'TRANSPORT_TLS_REQUIRED',
      'A2A peer identity requires a TLS-authenticated socket'
    );
  }
  if (input.authorized !== true) {
    return reject('TRANSPORT_CERT_UNTRUSTED', 'A2A peer certificate is missing or untrusted');
  }
  const certificate = input.peerCertificate;
  if (!certificate) {
    return reject('TRANSPORT_CERT_MISSING', 'A2A peer certificate is missing');
  }

  const validTo = typeof certificate.valid_to === 'string' ? Date.parse(certificate.valid_to) : NaN;
  const validFrom =
    typeof certificate.valid_from === 'string' ? Date.parse(certificate.valid_from) : NaN;
  if (!Number.isFinite(validTo)) {
    return reject('TRANSPORT_CERT_INVALID_VALIDITY', 'A2A peer certificate validity is unreadable');
  }
  if (Number.isFinite(validFrom) && input.nowMs < validFrom) {
    return reject('TRANSPORT_CERT_NOT_YET_VALID', 'A2A peer certificate is not yet valid');
  }
  if (input.nowMs >= validTo) {
    return reject('TRANSPORT_CERT_EXPIRED', 'A2A peer certificate has expired');
  }

  const fingerprintSha256 = normalizeTransportFingerprint(certificate.fingerprint256);
  if (!fingerprintSha256) {
    return reject(
      'TRANSPORT_CERT_FINGERPRINT_INVALID',
      'A2A peer certificate has no usable SHA-256 fingerprint'
    );
  }

  const identity = extractCertificateIdentity(certificate);
  if (!identity) {
    return reject('TRANSPORT_IDENTITY_NOT_ALLOWED', 'A2A peer certificate has no identity');
  }

  const registration = config.peers.find((peer) => peer.identity.trim().toLowerCase() === identity);
  if (!registration) {
    return reject(
      'TRANSPORT_IDENTITY_NOT_ALLOWED',
      'A2A peer certificate identity is not registered'
    );
  }
  if (
    registration.revokedFingerprints?.some(
      (revoked) => normalizeTransportFingerprint(revoked) === fingerprintSha256
    )
  ) {
    return reject('TRANSPORT_CERT_REVOKED', 'A2A peer certificate fingerprint is revoked');
  }
  if (
    !registration.allowedFingerprints.some(
      (allowed) => normalizeTransportFingerprint(allowed) === fingerprintSha256
    )
  ) {
    return reject(
      'TRANSPORT_CERT_FINGERPRINT_MISMATCH',
      'A2A peer certificate fingerprint is not pinned for this identity'
    );
  }

  return {
    ok: true,
    enforced: true,
    identity: {
      identity,
      fingerprintSha256,
      companyId: registration.companyId,
      agentCode: registration.agentCode,
      ...(registration.keyId !== undefined ? { keyId: registration.keyId } : {}),
      verifiedAt: input.nowMs,
      source: 'tls_client_certificate',
    },
  };
}

export function createA2aTransportIdentityConfigFromJson(
  json: string,
  enabled = true
): A2aTransportIdentityConfig {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('transport identity peer JSON must be an array');
  }
  const peers: A2aTransportPeerRegistration[] = parsed.map((entry: unknown, index: number) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`transport identity peer #${index} must be an object`);
    }
    const candidate = entry as Partial<A2aTransportPeerRegistration>;
    if (typeof candidate.identity !== 'string' || !candidate.identity.trim()) {
      throw new Error(`transport identity peer #${index} requires an identity`);
    }
    assertPositiveInteger(candidate.companyId, `transport identity peer #${index} companyId`);
    if (typeof candidate.agentCode !== 'string' || !candidate.agentCode.trim()) {
      throw new Error(`transport identity peer #${index} requires an agentCode`);
    }
    if (
      !Array.isArray(candidate.allowedFingerprints) ||
      candidate.allowedFingerprints.length === 0
    ) {
      throw new Error(`transport identity peer #${index} requires allowedFingerprints`);
    }
    for (const fingerprint of candidate.allowedFingerprints) {
      if (!normalizeTransportFingerprint(fingerprint)) {
        throw new Error(`transport identity peer #${index} has an invalid fingerprint`);
      }
    }
    return {
      identity: candidate.identity.trim(),
      companyId: candidate.companyId,
      agentCode: candidate.agentCode,
      allowedFingerprints: candidate.allowedFingerprints,
      ...(candidate.revokedFingerprints !== undefined
        ? { revokedFingerprints: candidate.revokedFingerprints }
        : {}),
      ...(candidate.keyId !== undefined ? { keyId: candidate.keyId } : {}),
    };
  });
  return { enabled, peers };
}
