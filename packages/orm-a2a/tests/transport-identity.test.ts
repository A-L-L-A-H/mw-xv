import { describe, expect, it } from 'vitest';
import {
  createA2aTransportIdentityConfigFromJson,
  normalizeTransportFingerprint,
  readA2aTransportCertificate,
  verifyA2aTransportIdentity,
  type A2aTransportCertificateInput,
  type A2aTransportIdentityConfig,
  type A2aPeerCertificate,
} from '../src/index.js';

const NOW = Date.parse('2026-11-24T08:00:00.000Z');
const FINGERPRINT_A = 'ab'.repeat(32);
const FINGERPRINT_B = 'cd'.repeat(32);
const IDENTITY = 'spiffe://mesh/company/7/agent/source';

function certificate(overrides: Partial<A2aPeerCertificate> = {}): A2aPeerCertificate {
  return {
    subject: { CN: IDENTITY },
    subjectaltname: `DNS:peer.internal, URI:${IDENTITY}`,
    fingerprint256: FINGERPRINT_A.split(/(..)/gu).filter(Boolean).join(':'),
    valid_from: 'Jan 01 12:00:00 2026 GMT',
    valid_to: 'Jan 01 12:00:00 2027 GMT',
    ...overrides,
  };
}

function input(
  overrides: Partial<A2aTransportCertificateInput> = {}
): A2aTransportCertificateInput {
  return {
    protocol: 'TLSv1.3',
    authorized: true,
    peerCertificate: certificate(),
    nowMs: NOW,
    ...overrides,
  };
}

function config(overrides: Partial<A2aTransportIdentityConfig> = {}): A2aTransportIdentityConfig {
  return {
    enabled: true,
    peers: [
      {
        identity: IDENTITY,
        companyId: 7,
        agentCode: 'agent_source',
        keyId: 'key-alpha-1',
        allowedFingerprints: [FINGERPRINT_A],
      },
    ],
    ...overrides,
  };
}

describe('A2A transport-authenticated peer identity (CF-018)', () => {
  it('maps a verified TLS certificate to the registered company/agent/key', () => {
    const result = verifyA2aTransportIdentity(input(), config());
    expect(result).toMatchObject({
      ok: true,
      enforced: true,
      identity: {
        identity: IDENTITY,
        fingerprintSha256: FINGERPRINT_A,
        companyId: 7,
        agentCode: 'agent_source',
        keyId: 'key-alpha-1',
        source: 'tls_client_certificate',
      },
    });
  });

  it('is inert when disabled', () => {
    expect(verifyA2aTransportIdentity(input(), config({ enabled: false }))).toEqual({
      ok: true,
      enforced: false,
      identity: null,
    });
  });

  it('rejects missing, untrusted, unauthenticated and invalid certificates', () => {
    expect(verifyA2aTransportIdentity(input({ protocol: undefined }), config())).toMatchObject({
      ok: false,
      reasonCode: 'TRANSPORT_TLS_REQUIRED',
    });
    expect(verifyA2aTransportIdentity(input({ authorized: false }), config())).toMatchObject({
      ok: false,
      reasonCode: 'TRANSPORT_CERT_UNTRUSTED',
    });
    expect(verifyA2aTransportIdentity(input({ peerCertificate: null }), config())).toMatchObject({
      ok: false,
      reasonCode: 'TRANSPORT_CERT_MISSING',
    });
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ valid_to: 'Jan 01 12:00:00 2025 GMT' }) }),
        config()
      )
    ).toMatchObject({ ok: false, reasonCode: 'TRANSPORT_CERT_EXPIRED' });
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ valid_from: 'Jan 01 12:00:00 2027 GMT' }) }),
        config()
      )
    ).toMatchObject({ ok: false, reasonCode: 'TRANSPORT_CERT_NOT_YET_VALID' });
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ fingerprint256: 'invalid' }) }),
        config()
      )
    ).toMatchObject({ ok: false, reasonCode: 'TRANSPORT_CERT_FINGERPRINT_INVALID' });
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ subjectaltname: 'URI:spiffe://unknown' }) }),
        config()
      )
    ).toMatchObject({ ok: false, reasonCode: 'TRANSPORT_IDENTITY_NOT_ALLOWED' });
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ fingerprint256: FINGERPRINT_B }) }),
        config()
      )
    ).toMatchObject({ ok: false, reasonCode: 'TRANSPORT_CERT_FINGERPRINT_MISMATCH' });
  });

  it('supports fingerprint rotation and immediate revocation', () => {
    const rotating = config({
      peers: [
        {
          identity: IDENTITY,
          companyId: 7,
          agentCode: 'agent_source',
          allowedFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
      ],
    });
    expect(verifyA2aTransportIdentity(input(), rotating).ok).toBe(true);
    expect(
      verifyA2aTransportIdentity(
        input({ peerCertificate: certificate({ fingerprint256: FINGERPRINT_B }) }),
        rotating
      ).ok
    ).toBe(true);

    const revoked = config({
      peers: [
        {
          identity: IDENTITY,
          companyId: 7,
          agentCode: 'agent_source',
          allowedFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
          revokedFingerprints: [FINGERPRINT_A],
        },
      ],
    });
    expect(verifyA2aTransportIdentity(input(), revoked)).toMatchObject({
      ok: false,
      reasonCode: 'TRANSPORT_CERT_REVOKED',
    });
  });

  it('never accepts forwarded headers as a substitute for socket TLS proof', () => {
    const request = {
      headers: {
        'x-forwarded-client-cert': FINGERPRINT_A,
        'x-client-cert-subject': IDENTITY,
        'x-ssl-client-verify': 'SUCCESS',
      },
      raw: { socket: { authorized: false } },
    };
    const read = readA2aTransportCertificate(request, NOW);
    expect(read).not.toHaveProperty('headers');
    expect(read.peerCertificate).toBeUndefined();
    expect(verifyA2aTransportIdentity(read, config())).toMatchObject({
      ok: false,
      reasonCode: 'TRANSPORT_TLS_REQUIRED',
    });

    const verifiedSocket = readA2aTransportCertificate(
      {
        headers: { 'x-forwarded-client-cert': 'spoofed' },
        raw: {
          socket: {
            authorized: true,
            getProtocol: () => 'TLSv1.2',
            getPeerCertificate: () => certificate(),
          },
        },
      },
      NOW
    );
    expect(verifyA2aTransportIdentity(verifiedSocket, config()).ok).toBe(true);
    expect(normalizeTransportFingerprint('zz'.repeat(32))).toBeNull();
    expect(
      normalizeTransportFingerprint(FINGERPRINT_A.split(/(..)/gu).filter(Boolean).join(':'))
    ).toBe(FINGERPRINT_A);
  });

  it('loads and validates the peer allowlist from JSON', () => {
    const loaded = createA2aTransportIdentityConfigFromJson(
      JSON.stringify([
        {
          identity: IDENTITY,
          companyId: 7,
          agentCode: 'agent_source',
          keyId: 'key-alpha-1',
          allowedFingerprints: [FINGERPRINT_A],
        },
      ]),
      true
    );
    expect(verifyA2aTransportIdentity(input(), loaded).ok).toBe(true);
    expect(() => createA2aTransportIdentityConfigFromJson('{}')).toThrow('must be an array');
    expect(() =>
      createA2aTransportIdentityConfigFromJson(
        JSON.stringify([
          { identity: IDENTITY, companyId: 7, agentCode: 'a', allowedFingerprints: [] },
        ])
      )
    ).toThrow('allowedFingerprints');
  });
});
