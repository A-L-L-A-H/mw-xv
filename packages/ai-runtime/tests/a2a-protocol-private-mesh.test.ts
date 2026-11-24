import { describe, expect, it } from 'vitest';
import {
  PRIVATE_MESH_CIDRS,
  createSignedA2AEnvelope,
  isPrivateMeshHost,
  verifyA2AEnvelope,
  type PrivateMeshCidr,
} from '../src/a2a-protocol.js';

const NOW_MS = 1_763_865_600_000;
const HMAC_INPUT = 'mesh-cidr-fixture';

describe('PRIVATE_MESH_CIDRS (issue #203)', () => {
  it('is the single canonical, frozen range list', () => {
    expect(PRIVATE_MESH_CIDRS).toEqual([
      '10.0.0.0/8',
      '100.64.0.0/10',
      '172.16.0.0/12',
      '192.168.0.0/16',
      'fd00::/8',
    ]);
    expect(Object.isFrozen(PRIVATE_MESH_CIDRS)).toBe(true);
    const typed: readonly PrivateMeshCidr[] = PRIVATE_MESH_CIDRS;
    expect(typed).toHaveLength(5);
  });

  it('governs every IPv4 boundary accepted by isPrivateMeshHost', () => {
    const firstAndLast: Record<string, readonly [string, string, string]> = {
      '10.0.0.0/8': ['10.0.0.0', '10.255.255.255', '11.0.0.0'],
      '100.64.0.0/10': ['100.64.0.0', '100.127.255.255', '100.128.0.0'],
      '172.16.0.0/12': ['172.16.0.0', '172.31.255.255', '172.32.0.0'],
      '192.168.0.0/16': ['192.168.0.0', '192.168.255.255', '192.169.0.0'],
    };
    for (const cidr of PRIVATE_MESH_CIDRS) {
      const bounds = firstAndLast[cidr];
      if (!bounds) continue;
      const [first, last, outside] = bounds;
      expect(isPrivateMeshHost(first), `${cidr} first address`).toBe(true);
      expect(isPrivateMeshHost(last), `${cidr} last address`).toBe(true);
      expect(isPrivateMeshHost(outside), `${cidr} next address`).toBe(false);
    }
    expect(isPrivateMeshHost('100.63.255.255')).toBe(false);
    expect(isPrivateMeshHost('172.15.255.255')).toBe(false);
    expect(isPrivateMeshHost('192.167.255.255')).toBe(false);
  });

  it('governs the fd00::/8 branch and rejects lookalike IPv6 ranges', () => {
    expect(isPrivateMeshHost('fd00::')).toBe(true);
    expect(isPrivateMeshHost('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
    expect(isPrivateMeshHost('https://[fd12:3456:789a::1]:8443/a2a')).toBe(true);
    expect(isPrivateMeshHost('fc00::1')).toBe(false);
    expect(isPrivateMeshHost('fe00::1')).toBe(false);
    expect(isPrivateMeshHost('fe80::1')).toBe(false);
    expect(isPrivateMeshHost('2001:db8::1')).toBe(false);
    expect(isPrivateMeshHost('::ffff:10.0.0.1')).toBe(false);
    expect(isPrivateMeshHost('fd00::1%eth0')).toBe(false);
    expect(isPrivateMeshHost('fd00:::1')).toBe(false);
  });
});

describe('A2A envelope keyId binding (CF-017)', () => {
  function envelope(overrides: { readonly keyId?: string } = {}) {
    return createSignedA2AEnvelope(
      {
        messageId: 'canonical-keyid-1',
        ...(overrides.keyId !== undefined ? { keyId: overrides.keyId } : {}),
        sourceAgentId: 'agent-source',
        targetAgentId: 'agent-target',
        targetEndpoint: 'http://100.64.0.20:3000',
        companyId: 42,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken: 1,
        ttlMs: 60_000,
        nowMs: NOW_MS,
        payload: { task: 'verify' },
      },
      HMAC_INPUT
    );
  }

  it('is covered by the signature and remains optional for legacy senders', () => {
    const signed = envelope({ keyId: 'peer-key-2026-11' });
    expect(signed.keyId).toBe('peer-key-2026-11');
    expect(
      verifyA2AEnvelope(signed, {
        signingSecret: HMAC_INPUT,
        expectedCompanyId: 42,
        nowMs: NOW_MS + 1,
      })
    ).toEqual({ valid: true });

    expect(
      verifyA2AEnvelope(
        { ...signed, keyId: 'peer-key-attacker' },
        {
          signingSecret: HMAC_INPUT,
          expectedCompanyId: 42,
          nowMs: NOW_MS + 1,
        }
      ).reasonCode
    ).toBe('INVALID_SIGNATURE');

    const legacy = envelope();
    expect(legacy.keyId).toBeUndefined();
    expect(
      verifyA2AEnvelope(legacy, {
        signingSecret: HMAC_INPUT,
        expectedCompanyId: 42,
        nowMs: NOW_MS + 1,
      })
    ).toEqual({ valid: true });
  });
});
