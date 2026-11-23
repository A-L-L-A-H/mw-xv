import { describe, expect, it } from 'vitest';
import { A2AProtocolError, verifyA2AEnvelope } from '@moonwitness/ai-runtime';
import { AccessDeniedError } from '@moonwitness/types';
import { A2AMeshClient, type A2AFetchFn } from '../src/a2a-client.js';
import { DesktopRiskGate, NativeHumanApprovalIssuer } from '../src/risk-gate.js';
import type { DesktopCapabilityGrant } from '../src/types.js';

const TEST_SECRET = 'desktop-easytier-a2a-signing-secret-2026';

function createGrant(overrides?: Partial<DesktopCapabilityGrant>): DesktopCapabilityGrant {
  return {
    grantId: 'grant-a2a-1',
    companyId: 42,
    agentId: 101,
    capability: 'mesh.delegate@v1',
    allowedRiskTier: 'R3',
    allowedClassification: 'restricted',
    maxCallsPerRun: 5,
    policyVersion: 1,
    status: 'active',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('A2AMeshClient', () => {
  it('signs and delegates an A2A envelope to a private EasyTier mesh node under R2 risk gate', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const mockFetch: A2AFetchFn = async (url, init) => {
      capturedUrl = url;
      capturedBody = String(init?.body ?? '');
      return {
        ok: true,
        status: 202,
        text: async () =>
          JSON.stringify({
            status: 'queued',
            messageId: 'msg-100',
            companyId: 42,
            delegationDepth: 1,
            fencingToken: 10,
            receivedAt: '2026-11-23T10:00:00.000Z',
          }),
      };
    };

    const client = new A2AMeshClient({
      signingSecret: TEST_SECRET,
      riskGate: new DesktopRiskGate(),
      fetchFn: mockFetch,
    });

    const nowMs = Date.UTC(2026, 10, 23, 10, 0, 0);
    const result = await client.delegateToMeshNode({
      runId: 'run-a2a-1',
      agentId: 101,
      messageId: 'msg-100',
      sourceAgentId: 'agent-desktop-1',
      targetAgentId: 'agent-vps-2',
      sourceEndpoint: 'http://100.64.0.10:3003',
      targetEndpoint: 'http://100.64.0.20:3003',
      companyId: 42,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 10,
      payload: { task: 'run-tests', target: 'apps/control-plane' },
      grant: createGrant({ allowedRiskTier: 'R2' }),
      expectedPolicyVersion: 1,
      nowMs,
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(202);
    expect(result.riskDecision.resolvedTier).toBe('R2');
    expect(result.receipt?.status).toBe('queued');
    expect(capturedUrl).toBe('http://100.64.0.20:3003/a2a/delegate');

    const sentEnvelope = JSON.parse(capturedBody) as typeof result.envelope;
    const verification = verifyA2AEnvelope(sentEnvelope, {
      signingSecret: TEST_SECRET,
      expectedCompanyId: 42,
      nowMs,
    });
    expect(verification.valid).toBe(true);
  });

  it('rejects public endpoints fail-closed before calling fetch', async () => {
    let fetchCalled = false;
    const client = new A2AMeshClient({
      signingSecret: TEST_SECRET,
      fetchFn: async () => {
        fetchCalled = true;
        return { ok: true, status: 202, text: async () => '{}' };
      },
    });

    await expect(
      client.delegateToMeshNode({
        runId: 'run-a2a-2',
        agentId: 101,
        sourceAgentId: 'agent-desktop-1',
        targetAgentId: 'agent-public',
        targetEndpoint: 'https://api.example.com',
        companyId: 42,
        delegationDepth: 1,
        dataClassification: 'cloud_eligible',
        fencingToken: 11,
        payload: { task: 'leak' },
        grant: createGrant(),
        expectedPolicyVersion: 1,
      })
    ).rejects.toThrow(A2AProtocolError);

    expect(fetchCalled).toBe(false);
  });

  it('enforces R3 HumanApprovalToken when requireHumanApproval is set', async () => {
    const issuer = new NativeHumanApprovalIssuer();
    const riskGate = new DesktopRiskGate({
      approvalVerifier: (token) => issuer.verifyToken(token),
      requireSignedApprovals: true,
    });

    const client = new A2AMeshClient({
      signingSecret: TEST_SECRET,
      riskGate,
      fetchFn: async () => ({
        ok: true,
        status: 202,
        text: async () =>
          JSON.stringify({
            status: 'queued',
            messageId: 'msg-r3',
            companyId: 42,
            delegationDepth: 1,
            fencingToken: 12,
            receivedAt: '2026-11-23T10:00:00.000Z',
          }),
      }),
    });

    // Without humanApproval -> AccessDeniedError
    await expect(
      client.delegateToMeshNode({
        runId: 'run-a2a-r3',
        agentId: 101,
        messageId: 'msg-r3',
        sourceAgentId: 'agent-desktop-1',
        targetAgentId: 'agent-vps-2',
        targetEndpoint: 'http://100.64.0.20:3003',
        companyId: 42,
        delegationDepth: 1,
        dataClassification: 'cloud_eligible',
        fencingToken: 12,
        payload: { task: 'deploy' },
        grant: createGrant({ allowedRiskTier: 'R3', allowedClassification: 'cloud_eligible' }),
        expectedPolicyVersion: 1,
        requireHumanApproval: true,
      })
    ).rejects.toThrow(AccessDeniedError);

    // With valid signed HumanApprovalToken -> succeeds at R3
    const token = issuer.issueToken({
      approvedByUserId: 7,
      action: 'network.egress',
      runId: 'run-a2a-r3',
    });

    const res = await client.delegateToMeshNode({
      runId: 'run-a2a-r3',
      agentId: 101,
      messageId: 'msg-r3',
      sourceAgentId: 'agent-desktop-1',
      targetAgentId: 'agent-vps-2',
      targetEndpoint: 'http://100.64.0.20:3003',
      companyId: 42,
      delegationDepth: 1,
      dataClassification: 'cloud_eligible',
      fencingToken: 12,
      payload: { task: 'deploy' },
      grant: createGrant({ allowedRiskTier: 'R3', allowedClassification: 'cloud_eligible' }),
      expectedPolicyVersion: 1,
      requireHumanApproval: true,
      humanApproval: token,
    });

    expect(res.ok).toBe(true);
    expect(res.riskDecision.resolvedTier).toBe('R3');
  });

  it('rejects self-acceptance claimedStatus="accepted" and redacts signing secret on error responses', async () => {
    const client = new A2AMeshClient({
      signingSecret: TEST_SECRET,
      fetchFn: async () => ({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: `rejected with secret ${TEST_SECRET}`,
            reasonCode: 'INVALID_SIGNATURE',
          }),
      }),
    });

    await expect(
      client.delegateToMeshNode({
        runId: 'run-a2a-4',
        agentId: 101,
        sourceAgentId: 'agent-desktop-1',
        targetAgentId: 'agent-vps-2',
        targetEndpoint: 'http://100.64.0.20:3003',
        companyId: 42,
        delegationDepth: 1,
        dataClassification: 'restricted',
        fencingToken: 13,
        claimedStatus: 'accepted',
        payload: { task: 'self-accept' },
        grant: createGrant(),
        expectedPolicyVersion: 1,
      })
    ).rejects.toThrow(A2AProtocolError);

    const errRes = await client.delegateToMeshNode({
      runId: 'run-a2a-5',
      agentId: 101,
      sourceAgentId: 'agent-desktop-1',
      targetAgentId: 'agent-vps-2',
      targetEndpoint: 'http://100.64.0.20:3003',
      companyId: 42,
      delegationDepth: 1,
      dataClassification: 'restricted',
      fencingToken: 14,
      payload: { task: 'verify' },
      grant: createGrant(),
      expectedPolicyVersion: 1,
    });

    expect(errRes.ok).toBe(false);
    expect(errRes.reasonCode).toBe('INVALID_SIGNATURE');
    expect(errRes.error).not.toContain(TEST_SECRET);
  });
});
