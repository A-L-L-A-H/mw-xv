import { describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '@moonwitness/types';
import {
  DesktopRiskGate,
  NativeHumanApprovalIssuer,
} from '../src/risk-gate.js';
import {
  MeshFleetClient,
  assertPrivateMeshEndpoint,
  isPrivateMeshIp,
  type MeshFleetAuthContext,
} from '../src/mesh-fleet.js';
import type { DesktopCapabilityGrant, RiskTier } from '../src/types.js';

function makeGrant(tier: RiskTier): DesktopCapabilityGrant {
  return {
    grantId: `grant-${tier}`,
    companyId: 1,
    agentId: 10,
    capability: 'mesh.control@v1',
    allowedRiskTier: tier,
    allowedClassification: 'cloud_eligible',
    policyVersion: 1,
    status: 'active',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    maxCallsPerRun: 20,
  };
}

function makeAuth(tier: RiskTier, overrides?: Partial<MeshFleetAuthContext>): MeshFleetAuthContext {
  return {
    runId: 'run-mesh-1',
    companyId: 1,
    agentId: 10,
    expectedPolicyVersion: 1,
    dataClassification: 'cloud_eligible',
    grant: makeGrant(tier),
    ...overrides,
  };
}

describe('isPrivateMeshIp & assertPrivateMeshEndpoint', () => {
  it('allows all private mesh IP ranges', () => {
    const allowed = [
      '10.0.0.1',
      '10.144.144.2',
      '100.64.0.1',
      '100.127.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.1',
      '192.168.100.50',
      'fd00::1',
      'fd12:3456:789a::1',
      '[fd00::42]',
    ];
    for (const ip of allowed) {
      expect(isPrivateMeshIp(ip), `expected ${ip} to be allowed`).toBe(true);
    }
    expect(assertPrivateMeshEndpoint('http://10.144.144.10:3003').hostname).toBe('10.144.144.10');
    expect(assertPrivateMeshEndpoint('http://[fd00::1]:3003').hostname).toBe('[fd00::1]');
  });

  it('fails closed on public IPs, boundary-adjacent IPs, loopback, and DNS hostnames', () => {
    const rejected = [
      '8.8.8.8',
      '1.1.1.1',
      '100.63.255.255',
      '100.128.0.1',
      '172.15.255.255',
      '172.32.0.1',
      '192.167.1.1',
      '127.0.0.1',
      '2001:db8::1',
      'fe80::1',
      'vps.example.com',
      'localhost',
    ];
    for (const host of rejected) {
      expect(isPrivateMeshIp(host), `expected ${host} to be rejected`).toBe(false);
    }

    expect(() => assertPrivateMeshEndpoint('http://8.8.8.8:3003')).toThrow(AccessDeniedError);
    expect(() => assertPrivateMeshEndpoint('https://vps.example.com:3003')).toThrow(AccessDeniedError);
    expect(() => assertPrivateMeshEndpoint('http://user:pass@10.144.144.1:3003')).toThrow(AccessDeniedError);
    expect(() => assertPrivateMeshEndpoint('ftp://10.144.144.1:3003')).toThrow(AccessDeniedError);
  });
});

describe('MeshFleetClient', () => {
  it('rejects registering a node with a public IP', () => {
    const riskGate = new DesktopRiskGate();
    const client = new MeshFleetClient({ riskGate });
    expect(() =>
      client.registerNode({
        nodeId: 'public-vps',
        baseUrl: 'http://203.0.113.10:3003',
        adminToken: 'secret-token-123456',
      })
    ).toThrow(AccessDeniedError);
  });

  it('allows R0 reads (health, mesh status, list services) with an R0 grant', async () => {
    const riskGate = new DesktopRiskGate();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', docker: 'ok' }), { status: 200 });
      }
      if (url.endsWith('/mesh/status')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            backend: 'easytier',
            status: 'running',
            network_name: 'mw-fleet',
            secret_configured: true,
            network_secret: '[REDACTED]',
            ipv4: '10.144.144.5',
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/services')) {
        return new Response(
          JSON.stringify([
            { id: 'abc123', name: 'easytier', image: 'easytier/easytier:latest', state: 'running', status: 'Up 1h' },
          ]),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    });

    const client = new MeshFleetClient({
      riskGate,
      fetchImpl: fetchMock,
      nodes: [
        {
          nodeId: 'vps-sg-01',
          baseUrl: 'http://10.144.144.5:3003',
          adminToken: 'mesh-admin-token-secret',
          label: 'Singapore VPS',
        },
      ],
    });

    const auth = makeAuth('R0');
    const health = await client.getNodeHealth('vps-sg-01', auth);
    expect(health.decision.resolvedTier).toBe('R0');
    expect(health.data.status).toBe('ok');

    const meshStatus = await client.getNodeMeshStatus('vps-sg-01', auth);
    expect(meshStatus.decision.resolvedTier).toBe('R0');
    expect(meshStatus.data.backend).toBe('easytier');
    expect(meshStatus.data.network_secret).toBe('[REDACTED]');

    const svcs = await client.listNodeServices('vps-sg-01', auth);
    expect(svcs.decision.resolvedTier).toBe('R0');
    expect(svcs.data).toHaveLength(1);
    expect(svcs.data[0]?.name).toBe('easytier');
  });

  it('gates R2 service registration and R3 remote deployment through DesktopRiskGate', async () => {
    const issuer = new NativeHumanApprovalIssuer();
    const riskGate = new DesktopRiskGate({
      approvalVerifier: (token) => issuer.verifyToken(token),
      requireSignedApprovals: true,
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/services')) {
        return new Response(JSON.stringify({ name: 'mw-worker', status: 'registered' }), { status: 201 });
      }
      if (url.endsWith('/api/deploy')) {
        return new Response(JSON.stringify({ name: 'mw-worker', status: 'success', container_id: 'deadbeef1234' }), {
          status: 201,
        });
      }
      return new Response('not found', { status: 404 });
    });

    const client = new MeshFleetClient({
      riskGate,
      fetchImpl: fetchMock,
      nodes: [
        {
          nodeId: 'vps-eu-01',
          baseUrl: 'http://100.64.0.12:3003',
          adminToken: 'eu-admin-token-secret',
        },
      ],
    });

    // R0 grant must be blocked from R2 mutation
    await expect(
      client.registerNodeService('vps-eu-01', { name: 'mw-worker', image: 'nginx:alpine' }, makeAuth('R0'))
    ).rejects.toThrow(AccessDeniedError);

    // R2 grant succeeds for R2 service registration
    const reg = await client.registerNodeService(
      'vps-eu-01',
      { name: 'mw-worker', image: 'nginx:alpine' },
      makeAuth('R2')
    );
    expect(reg.decision.resolvedTier).toBe('R2');
    expect(reg.data.status).toBe('registered');

    // R3 deploy without HumanApprovalToken must be blocked
    await expect(
      client.deployNodeService('vps-eu-01', { name: 'mw-worker', image: 'nginx:alpine' }, makeAuth('R3'))
    ).rejects.toThrow(AccessDeniedError);

    // R3 deploy with valid signed HumanApprovalToken succeeds
    const approval = issuer.issueToken({
      approvedByUserId: 7,
      action: 'network.egress',
      runId: 'run-mesh-1',
    });
    const deployed = await client.deployNodeService(
      'vps-eu-01',
      { name: 'mw-worker', image: 'nginx:alpine' },
      makeAuth('R3', { humanApproval: approval })
    );
    expect(deployed.decision.resolvedTier).toBe('R3');
    expect(deployed.data.name).toBe('mw-worker');
  });

  it('redacts admin tokens if a remote node error body echoes them', async () => {
    const riskGate = new DesktopRiskGate();
    const rawToken = 'super-sensitive-admin-token-987654';
    const fetchMock = vi.fn(async () => new Response(`auth failed for ${rawToken}`, { status: 500 }));

    const client = new MeshFleetClient({
      riskGate,
      fetchImpl: fetchMock,
      nodes: [
        {
          nodeId: 'vps-us-01',
          baseUrl: 'http://192.168.50.10:3003',
          adminToken: rawToken,
        },
      ],
    });

    await expect(client.listNodeServices('vps-us-01', makeAuth('R0'))).rejects.toThrow('[REDACTED_SECRET]');
  });
});
