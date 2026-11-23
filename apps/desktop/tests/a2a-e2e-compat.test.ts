import { describe, expect, it } from 'vitest';
import {
  isPrivateMeshHost,
  verifyA2AEnvelope,
  type SignedA2AEnvelope,
} from '@moonwitness/ai-runtime';
import { A2AMeshClient, type A2AFetchFn } from '../src/a2a-client.js';
import { DesktopRiskGate } from '../src/risk-gate.js';
import type { DesktopCapabilityGrant } from '../src/types.js';

const RECEIVER_SECRET = 'desktop-e2e-wire-compat-a2a-secret-2026';
const RECEIVER_ORIGIN = 'http://100.64.0.20:3000';
const SOURCE_IP = '100.64.0.10';
const SOURCE_ENDPOINT = `http://${SOURCE_IP}:3003`;
const COMPANY_ID = 42;

function createGrant(overrides?: Partial<DesktopCapabilityGrant>): DesktopCapabilityGrant {
  return {
    grantId: 'grant-e2e-compat-1',
    companyId: COMPANY_ID,
    agentId: 101,
    capability: 'mesh.delegate@v1',
    allowedRiskTier: 'R3',
    allowedClassification: 'restricted',
    maxCallsPerRun: 20,
    policyVersion: 1,
    status: 'active',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Deterministic in-process receiver transport mirroring packages/orm-a2a/src/http-plugin.ts
 * and apps/control-plane/a2a.go with zero network calls.
 */
function createInProcessReceiverFetch(options: {
  readonly signingSecret: string;
  readonly expectedCompanyId: number;
  readonly endpointOrigin: string;
  readonly remoteAddress?: string;
  readonly nowMs?: number;
}): A2AFetchFn {
  const seenNonces = new Set<string>();
  const lastFenceByAgent = new Map<string, number>();
  const remoteAddress = options.remoteAddress ?? SOURCE_IP;

  return async (url, init) => {
    const headers = new Headers(init?.headers);
    const protocol = headers.get('x-a2a-protocol');
    if (protocol !== 'a2a.v1') {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            success: false,
            error: 'X-A2A-Protocol must be a2a.v1',
            reasonCode: 'INVALID_PROTOCOL_VERSION',
          }),
      };
    }

    if (!isPrivateMeshHost(remoteAddress)) {
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            success: false,
            error: 'A2A requests must originate directly from a private EasyTier mesh IP',
            reasonCode: 'PUBLIC_ENDPOINT_FORBIDDEN',
          }),
      };
    }

    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== options.endpointOrigin || parsedUrl.pathname !== '/a2a/delegate') {
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            success: false,
            error: 'A2A targetEndpoint does not identify this configured API receiver',
            reasonCode: 'TARGET_ENDPOINT_MISMATCH',
          }),
      };
    }

    const envelope = JSON.parse(String(init?.body ?? '{}')) as SignedA2AEnvelope<
      Record<string, unknown>
    >;
    const lastSeenFencingToken = lastFenceByAgent.get(envelope.sourceAgentId);

    const verification = verifyA2AEnvelope(envelope, {
      signingSecret: options.signingSecret,
      expectedCompanyId: options.expectedCompanyId,
      ...(lastSeenFencingToken !== undefined ? { lastSeenFencingToken } : {}),
      seenNonces,
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    });

    if (!verification.valid) {
      const code = verification.reasonCode ?? 'INVALID_ENVELOPE';
      const status =
        code === 'INVALID_SECRET' || code === 'INVALID_SIGNATURE'
          ? 401
          : code === 'STALE_FENCING_TOKEN' || code === 'REPLAY_NONCE_DETECTED'
            ? 409
            : code === 'ENVELOPE_EXPIRED'
              ? 410
              : 403;
      return {
        ok: false,
        status,
        text: async () =>
          JSON.stringify({
            success: false,
            error: verification.reason ?? 'A2A envelope rejected',
            reasonCode: code,
          }),
      };
    }

    seenNonces.add(envelope.nonce);
    lastFenceByAgent.set(envelope.sourceAgentId, envelope.fencingToken);

    return {
      ok: true,
      status: 202,
      text: async () =>
        JSON.stringify({
          status: 'queued',
          messageId: envelope.messageId,
          companyId: envelope.companyId,
          delegationDepth: envelope.delegationDepth,
          fencingToken: envelope.fencingToken,
          receivedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
        }),
    };
  };
}

describe('Desktop A2AMeshClient E2E wire compatibility', () => {
  it('produces signed envelopes accepted by the durable inbox receiver contract', async () => {
    const nowMs = Date.UTC(2026, 10, 23, 12, 0, 0);
    const client = new A2AMeshClient({
      signingSecret: RECEIVER_SECRET,
      riskGate: new DesktopRiskGate(),
      fetchFn: createInProcessReceiverFetch({
        signingSecret: RECEIVER_SECRET,
        expectedCompanyId: COMPANY_ID,
        endpointOrigin: RECEIVER_ORIGIN,
        nowMs,
      }),
    });

    const result = await client.delegateToMeshNode({
      runId: 'run-e2e-1',
      agentId: 101,
      messageId: 'e2e-msg-1',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: RECEIVER_ORIGIN,
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 1,
      payload: { task: 'sync-ledger', items: [1, 2, 3] },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(202);
    expect(result.receipt).toMatchObject({
      status: 'queued',
      messageId: 'e2e-msg-1',
      companyId: COMPANY_ID,
      delegationDepth: 1,
      fencingToken: 1,
    });
  });

  it('handles replay nonce and stale fencing token rejections cleanly', async () => {
    const nowMs = Date.UTC(2026, 10, 23, 12, 5, 0);
    const client = new A2AMeshClient({
      signingSecret: RECEIVER_SECRET,
      riskGate: new DesktopRiskGate(),
      fetchFn: createInProcessReceiverFetch({
        signingSecret: RECEIVER_SECRET,
        expectedCompanyId: COMPANY_ID,
        endpointOrigin: RECEIVER_ORIGIN,
        nowMs,
      }),
    });

    const fixedNonce = 'e2e_fixed_nonce_000001';
    const first = await client.delegateToMeshNode({
      runId: 'run-e2e-2',
      agentId: 101,
      messageId: 'e2e-msg-first',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: RECEIVER_ORIGIN,
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 5,
      nonce: fixedNonce,
      payload: { step: 1 },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });
    expect(first.ok).toBe(true);

    const replay = await client.delegateToMeshNode({
      runId: 'run-e2e-2',
      agentId: 101,
      messageId: 'e2e-msg-replay',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: RECEIVER_ORIGIN,
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 6,
      nonce: fixedNonce,
      payload: { step: 2 },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });
    expect(replay.ok).toBe(false);
    expect(replay.statusCode).toBe(409);
    expect(replay.reasonCode).toBe('REPLAY_NONCE_DETECTED');

    const stale = await client.delegateToMeshNode({
      runId: 'run-e2e-2',
      agentId: 101,
      messageId: 'e2e-msg-stale',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: RECEIVER_ORIGIN,
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 5,
      payload: { step: 3 },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });
    expect(stale.ok).toBe(false);
    expect(stale.statusCode).toBe(409);
    expect(stale.reasonCode).toBe('STALE_FENCING_TOKEN');
  });

  it('rejects wrong signing secret and company/endpoint scope mismatches', async () => {
    const nowMs = Date.UTC(2026, 10, 23, 12, 10, 0);
    const receiverFetch = createInProcessReceiverFetch({
      signingSecret: RECEIVER_SECRET,
      expectedCompanyId: COMPANY_ID,
      endpointOrigin: RECEIVER_ORIGIN,
      nowMs,
    });

    const wrongSecretClient = new A2AMeshClient({
      signingSecret: 'wrong-desktop-signing-secret-000000',
      riskGate: new DesktopRiskGate(),
      fetchFn: receiverFetch,
    });

    const forgedRes = await wrongSecretClient.delegateToMeshNode({
      runId: 'run-e2e-3',
      agentId: 101,
      messageId: 'e2e-msg-forged',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: RECEIVER_ORIGIN,
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 1,
      payload: { task: 'forged' },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });
    expect(forgedRes.ok).toBe(false);
    expect(forgedRes.statusCode).toBe(401);
    expect(forgedRes.reasonCode).toBe('INVALID_SIGNATURE');

    const validClient = new A2AMeshClient({
      signingSecret: RECEIVER_SECRET,
      riskGate: new DesktopRiskGate(),
      fetchFn: receiverFetch,
    });

    const wrongTargetRes = await validClient.delegateToMeshNode({
      runId: 'run-e2e-4',
      agentId: 101,
      messageId: 'e2e-msg-wrong-target',
      sourceAgentId: 'desktop-agent-1',
      targetAgentId: 'vps-agent-1',
      sourceEndpoint: SOURCE_ENDPOINT,
      targetEndpoint: 'http://100.64.0.99:3000',
      companyId: COMPANY_ID,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 2,
      payload: { task: 'wrong-target' },
      grant: createGrant(),
      expectedPolicyVersion: 1,
      nowMs,
    });
    expect(wrongTargetRes.ok).toBe(false);
    expect(wrongTargetRes.statusCode).toBe(403);
    expect(wrongTargetRes.reasonCode).toBe('TARGET_ENDPOINT_MISMATCH');
  });
});
