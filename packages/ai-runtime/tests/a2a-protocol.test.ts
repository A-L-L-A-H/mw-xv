import { describe, expect, it } from 'vitest';
import {
  A2AProtocolError,
  MAX_A2A_DELEGATION_DEPTH,
  createSignedA2AEnvelope,
  isPrivateMeshHost,
  validateA2ADelegationPolicy,
  verifyA2AEnvelope,
} from '../src/a2a-protocol.js';

const TEST_SIGNING_SECRET = 'mw-a2a-mesh-test-secret-0123456789abcdef';
const BASE_NOW_MS = 1_763_865_600_000;

describe('isPrivateMeshHost', () => {
  it('accepts all EasyTier private mesh CIDR ranges', () => {
    expect(isPrivateMeshHost('10.0.0.1')).toBe(true);
    expect(isPrivateMeshHost('https://10.255.255.254:8443/a2a')).toBe(true);
    expect(isPrivateMeshHost('100.64.0.1')).toBe(true);
    expect(isPrivateMeshHost('http://100.127.255.254:9000/delegate')).toBe(true);
    expect(isPrivateMeshHost('172.16.0.1')).toBe(true);
    expect(isPrivateMeshHost('172.31.255.254')).toBe(true);
    expect(isPrivateMeshHost('192.168.1.42')).toBe(true);
    expect(isPrivateMeshHost('fd00::1')).toBe(true);
    expect(isPrivateMeshHost('https://[fd12:3456:789a::1]:8443/a2a')).toBe(true);
  });

  it('rejects public IPs, loopback, link-local, DNS hostnames, and malformed inputs', () => {
    expect(isPrivateMeshHost('8.8.8.8')).toBe(false);
    expect(isPrivateMeshHost('https://1.1.1.1/a2a')).toBe(false);
    expect(isPrivateMeshHost('100.63.255.255')).toBe(false);
    expect(isPrivateMeshHost('100.128.0.1')).toBe(false);
    expect(isPrivateMeshHost('172.15.255.255')).toBe(false);
    expect(isPrivateMeshHost('172.32.0.1')).toBe(false);
    expect(isPrivateMeshHost('127.0.0.1')).toBe(false);
    expect(isPrivateMeshHost('169.254.169.254')).toBe(false);
    expect(isPrivateMeshHost('::1')).toBe(false);
    expect(isPrivateMeshHost('fe80::1')).toBe(false);
    expect(isPrivateMeshHost('fc00::1')).toBe(false);
    expect(isPrivateMeshHost('https://agent.example.com/a2a')).toBe(false);
    expect(isPrivateMeshHost('ftp://10.0.0.5/a2a')).toBe(false);
    expect(isPrivateMeshHost('')).toBe(false);
  });
});

describe('validateA2ADelegationPolicy', () => {
  it('allows valid private-mesh delegation within bounds', () => {
    const result = validateA2ADelegationPolicy({
      targetEndpoint: 'https://100.64.10.2:8443/a2a',
      sourceEndpoint: 'https://100.64.10.1:8443/a2a',
      sourceCompanyId: 42,
      targetCompanyId: 42,
      delegationDepth: 2,
      dataClassification: 'restricted',
      fencingToken: 10,
      lastKnownFencingToken: 9,
      ttlMs: 60_000,
      claimedStatus: 'submitted',
    });

    expect(result).toEqual({ allowed: true });
  });

  it('rejects public endpoints, classification violations, cross-company, depth > 3, and accepted authority', () => {
    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://8.8.8.8/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 1,
        delegationDepth: 1,
        dataClassification: 'cloud_eligible',
        fencingToken: 1,
        ttlMs: 30_000,
      }).reasonCode
    ).toBe('PUBLIC_ENDPOINT_FORBIDDEN');

    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://8.8.8.8/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 1,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken: 1,
        ttlMs: 30_000,
      }).reasonCode
    ).toBe('CLASSIFICATION_VIOLATION');

    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://10.0.0.2/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 2,
        delegationDepth: 1,
        dataClassification: 'local_only',
        fencingToken: 1,
        ttlMs: 30_000,
      }).reasonCode
    ).toBe('COMPANY_ISOLATION_VIOLATION');

    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://10.0.0.2/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 1,
        delegationDepth: MAX_A2A_DELEGATION_DEPTH + 1,
        maxDelegationDepth: 10,
        dataClassification: 'local_only',
        fencingToken: 1,
        ttlMs: 30_000,
      }).reasonCode
    ).toBe('DELEGATION_DEPTH_EXCEEDED');

    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://10.0.0.2/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 1,
        delegationDepth: 1,
        dataClassification: 'local_only',
        fencingToken: 5,
        lastKnownFencingToken: 5,
        ttlMs: 30_000,
      }).reasonCode
    ).toBe('STALE_FENCING_TOKEN');

    expect(
      validateA2ADelegationPolicy({
        targetEndpoint: 'https://10.0.0.2/a2a',
        sourceCompanyId: 1,
        targetCompanyId: 1,
        delegationDepth: 1,
        dataClassification: 'local_only',
        fencingToken: 5,
        ttlMs: 30_000,
        claimedStatus: 'accepted',
      }).reasonCode
    ).toBe('SERVER_ONLY_ACCEPTED_AUTHORITY');
  });
});

describe('createSignedA2AEnvelope & verifyA2AEnvelope', () => {
  it('creates and verifies a valid HMAC-SHA256 signed envelope while redacting secrets in payload', () => {
    const envelope = createSignedA2AEnvelope(
      {
        messageId: 'msg-001',
        sourceAgentId: 'agent-alpha',
        targetAgentId: 'agent-beta',
        sourceEndpoint: 'https://100.64.1.10:8443/a2a',
        targetEndpoint: 'https://100.64.1.11:8443/a2a',
        companyId: 7,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken: 12,
        ttlMs: 60_000,
        nowMs: BASE_NOW_MS,
        claimedStatus: 'submitted',
        payload: {
          workContractId: 'wc-100',
          note: `leaked ${TEST_SIGNING_SECRET}`,
        },
      },
      TEST_SIGNING_SECRET
    );

    expect(envelope.payload.note).not.toContain(TEST_SIGNING_SECRET);
    expect(envelope.payload.note).toContain('[REDACTED_SECRET]');

    const verified = verifyA2AEnvelope(envelope, {
      signingSecret: TEST_SIGNING_SECRET,
      expectedCompanyId: 7,
      lastSeenFencingToken: 11,
      seenNonces: new Set<string>(),
      nowMs: BASE_NOW_MS + 10_000,
    });

    expect(verified).toEqual({ valid: true });
  });

  it('rejects tampered signatures, expired envelopes, replay nonces, stale fencing tokens, and company mismatches', () => {
    const envelope = createSignedA2AEnvelope(
      {
        messageId: 'msg-002',
        sourceAgentId: 'agent-alpha',
        targetAgentId: 'agent-beta',
        targetEndpoint: 'https://[fd00::42]:8443/a2a',
        companyId: 9,
        delegationDepth: 2,
        dataClassification: 'local_only',
        fencingToken: 20,
        ttlMs: 30_000,
        nowMs: BASE_NOW_MS,
        payload: { task: 'verify-artifact' },
      },
      TEST_SIGNING_SECRET
    );

    expect(
      verifyA2AEnvelope(
        { ...envelope, payload: { task: 'tampered-artifact' } },
        {
          signingSecret: TEST_SIGNING_SECRET,
          expectedCompanyId: 9,
          nowMs: BASE_NOW_MS + 1_000,
        }
      ).reasonCode
    ).toBe('INVALID_SIGNATURE');

    expect(
      verifyA2AEnvelope(envelope, {
        signingSecret: TEST_SIGNING_SECRET,
        expectedCompanyId: 9,
        nowMs: BASE_NOW_MS + 30_001,
      }).reasonCode
    ).toBe('ENVELOPE_EXPIRED');

    expect(
      verifyA2AEnvelope(envelope, {
        signingSecret: TEST_SIGNING_SECRET,
        expectedCompanyId: 9,
        seenNonces: new Set([envelope.nonce]),
        nowMs: BASE_NOW_MS + 1_000,
      }).reasonCode
    ).toBe('REPLAY_NONCE_DETECTED');

    expect(
      verifyA2AEnvelope(envelope, {
        signingSecret: TEST_SIGNING_SECRET,
        expectedCompanyId: 9,
        lastSeenFencingToken: 20,
        nowMs: BASE_NOW_MS + 1_000,
      }).reasonCode
    ).toBe('STALE_FENCING_TOKEN');

    expect(
      verifyA2AEnvelope(envelope, {
        signingSecret: TEST_SIGNING_SECRET,
        expectedCompanyId: 10,
        nowMs: BASE_NOW_MS + 1_000,
      }).reasonCode
    ).toBe('COMPANY_ISOLATION_VIOLATION');
  });

  it('throws A2AProtocolError when creating an envelope violating policy', () => {
    expect(() =>
      createSignedA2AEnvelope(
        {
          messageId: 'msg-003',
          sourceAgentId: 'agent-alpha',
          targetAgentId: 'agent-beta',
          targetEndpoint: 'https://203.0.113.5/a2a',
          companyId: 1,
          delegationDepth: 0,
          dataClassification: 'local_only',
          fencingToken: 1,
          ttlMs: 30_000,
          payload: {},
        },
        TEST_SIGNING_SECRET
      )
    ).toThrow(A2AProtocolError);
  });
});
