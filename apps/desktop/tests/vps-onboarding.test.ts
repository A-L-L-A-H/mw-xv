import { describe, expect, it, vi } from 'vitest';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import {
  DesktopRiskGate,
  NativeHumanApprovalIssuer,
} from '../src/risk-gate.js';
import {
  VpsOnboardingClient,
  assertVpsMeshEndpoint,
  isAllowedVpsMeshHost,
  type VpsOnboardingAuthContext,
} from '../src/vps-onboarding.js';
import type { DesktopCapabilityGrant, RiskTier } from '../src/types.js';

function makeGrant(tier: RiskTier): DesktopCapabilityGrant {
  return {
    grantId: `grant-vps-${tier}`,
    companyId: 1,
    agentId: 10,
    capability: 'vps.onboarding@v1',
    allowedRiskTier: tier,
    allowedClassification: 'cloud_eligible',
    policyVersion: 1,
    status: 'active',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    maxCallsPerRun: 20,
  };
}

function makeAuth(
  tier: RiskTier,
  overrides?: Partial<VpsOnboardingAuthContext>
): VpsOnboardingAuthContext {
  return {
    runId: 'run-vps-1',
    companyId: 1,
    agentId: 10,
    expectedPolicyVersion: 1,
    dataClassification: 'cloud_eligible',
    grant: makeGrant(tier),
    ...overrides,
  };
}

describe('isAllowedVpsMeshHost & assertVpsMeshEndpoint', () => {
  it('allows private mesh CIDRs and 127.0.0.1 for tests', () => {
    const allowed = [
      '10.144.0.1',
      '10.0.0.5',
      '100.64.0.1',
      '100.127.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      'fd00::1',
      '[fd12:3456::1]',
      '127.0.0.1',
    ];
    for (const host of allowed) {
      expect(isAllowedVpsMeshHost(host), `expected ${host} allowed`).toBe(true);
    }
    expect(assertVpsMeshEndpoint('http://10.144.0.1:3003').hostname).toBe('10.144.0.1');
    expect(assertVpsMeshEndpoint('http://127.0.0.1:3003').hostname).toBe('127.0.0.1');
    expect(assertVpsMeshEndpoint('http://[fd00::1]:3003').hostname).toBe('[fd00::1]');
  });

  it('rejects public IPs, boundary-adjacent IPs, DNS hostnames, and unsafe URLs', () => {
    const rejected = [
      '8.8.8.8',
      '1.1.1.1',
      '100.63.255.255',
      '100.128.0.1',
      '172.15.255.255',
      '172.32.0.1',
      '192.167.0.1',
      '2001:db8::1',
      'fe80::1',
      'vps.example.com',
      'localhost',
    ];
    for (const host of rejected) {
      expect(isAllowedVpsMeshHost(host), `expected ${host} rejected`).toBe(false);
    }
    expect(() => assertVpsMeshEndpoint('http://8.8.8.8:3003')).toThrow(AccessDeniedError);
    expect(() => assertVpsMeshEndpoint('ftp://10.144.0.1:3003')).toThrow(AccessDeniedError);
    expect(() => assertVpsMeshEndpoint('http://user:pass@10.144.0.1:3003')).toThrow(AccessDeniedError);
    expect(() => assertVpsMeshEndpoint('http://10.144.0.1:3003/#frag')).toThrow(AccessDeniedError);
    expect(() => assertVpsMeshEndpoint('not-a-url')).toThrow(ValidationError);
  });
});

describe('VpsOnboardingClient', () => {
  it('reads onboarding status at R0 and redacts sensitive fields', async () => {
    const riskGate = new DesktopRiskGate();
    const adminToken = 'mw_admin_secret_token_987654321';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          meshIp: '10.144.0.1',
          apiHealth: 'healthy',
          boardHealth: 'healthy',
          controlPlaneHealth: 'healthy',
          superadminBootstrapped: false,
          composeServices: ['postgres', 'api', 'board'],
          redactedSummary: `Control plane active with token=${adminToken}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new VpsOnboardingClient(
      {
        nodeId: 'vps-jkt-01',
        controlPlaneUrl: 'http://10.144.0.1:3003',
        adminToken,
      },
      { riskGate, fetchFn: fetchMock }
    );

    const status = await client.getOnboardingStatus(makeAuth('R0'));
    expect(status.nodeId).toBe('vps-jkt-01');
    expect(status.meshIp).toBe('10.144.0.1');
    expect(status.apiHealth).toBe('healthy');
    expect(status.boardHealth).toBe('healthy');
    expect(status.superadminBootstrapped).toBe(false);
    expect(status.composeServices).toEqual(['postgres', 'api', 'board']);
    expect(status.redactedSummary).not.toContain(adminToken);
    expect(status.redactedSummary).toContain('[REDACTED');
    expect(status.decision.resolvedTier).toBe('R0');
  });

  it('requires R3 human approval for bootstrapSuperadmin and redacts passwords', async () => {
    const issuer = new NativeHumanApprovalIssuer();
    const riskGate = new DesktopRiskGate({
      approvalVerifier: (token) => issuer.verifyToken(token),
      requireSignedApprovals: true,
    });
    const adminToken = 'mw_admin_secret_token_987654321';
    const superPass = 'UltraSecretSuperadminPass!2026';

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          bootstrapped: true,
          message: `Created admin with password=${superPass} and Bearer ${adminToken}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new VpsOnboardingClient(
      {
        nodeId: 'vps-jkt-01',
        controlPlaneUrl: 'http://10.144.0.1:3003',
        remoteApiUrl: 'http://10.144.0.1:3000',
        adminToken,
      },
      { riskGate, fetchFn: fetchMock }
    );

    await expect(
      client.bootstrapSuperadmin(
        { login: 'admin', password: superPass },
        makeAuth('R3')
      )
    ).rejects.toThrow(AccessDeniedError);

    const approval = issuer.issueToken({
      approvedByUserId: 7,
      action: 'upstream.sync_push',
      runId: 'run-vps-1',
    });

    const result = await client.bootstrapSuperadmin(
      { login: 'admin', password: superPass, displayName: 'Root Operator' },
      makeAuth('R3', { humanApproval: approval })
    );

    expect(result.bootstrapped).toBe(true);
    expect(result.login).toBe('admin');
    expect(result.message).not.toContain(superPass);
    expect(result.message).not.toContain(adminToken);
    expect(result.decision.resolvedTier).toBe('R3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gates controlComposeStack at R2 for up/restart and R3 for down/rebuild', async () => {
    const issuer = new NativeHumanApprovalIssuer();
    const riskGate = new DesktopRiskGate({
      approvalVerifier: (token) => issuer.verifyToken(token),
      requireSignedApprovals: true,
    });
    const adminToken = 'mw_admin_secret_token_987654321';

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'ok',
          output: `compose executed with token=${adminToken}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new VpsOnboardingClient(
      {
        nodeId: 'vps-jkt-01',
        controlPlaneUrl: 'http://127.0.0.1:3003',
        adminToken,
      },
      { riskGate, fetchFn: fetchMock }
    );

    // R0 grant cannot run R2 compose restart
    await expect(
      client.controlComposeStack({ action: 'restart' }, makeAuth('R0'))
    ).rejects.toThrow(AccessDeniedError);

    // R2 grant can run restart
    const restartRes = await client.controlComposeStack(
      { action: 'restart', services: ['api', 'board'] },
      makeAuth('R2')
    );
    expect(restartRes.status).toBe('ok');
    expect(restartRes.services).toEqual(['api', 'board']);
    expect(restartRes.output).not.toContain(adminToken);
    expect(restartRes.decision.resolvedTier).toBe('R2');

    // R2 grant cannot run R3 rebuild
    await expect(
      client.controlComposeStack({ action: 'rebuild' }, makeAuth('R2'))
    ).rejects.toThrow(AccessDeniedError);

    // R3 grant + human approval can run rebuild
    const approval = issuer.issueToken({
      approvedByUserId: 7,
      action: 'upstream.sync_push',
      runId: 'run-vps-1',
    });
    const rebuildRes = await client.controlComposeStack(
      { action: 'rebuild' },
      makeAuth('R3', { humanApproval: approval })
    );
    expect(rebuildRes.action).toBe('rebuild');
    expect(rebuildRes.decision.resolvedTier).toBe('R3');
  });
});
