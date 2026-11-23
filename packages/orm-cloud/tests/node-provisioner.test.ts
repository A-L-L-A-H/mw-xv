import { describe, expect, it } from 'vitest';
import {
  isValidEasyTierMeshIp,
  planVpsNodeProvision,
  redactProvisionSecrets,
  validateVpsProvisionRequest,
  type VpsProvisionRequest,
} from '../src/node-provisioner.js';

const BASE_REQUEST: VpsProvisionRequest = {
  nodeId: 'vps-sgp-02',
  host: '203.0.113.42',
  sshPort: 2222,
  sshUser: 'ubuntu',
  osFamily: 'ubuntu',
  meshIp: '10.144.0.2',
  meshNetworkName: 'mw-prod-mesh',
  meshNetworkSecret: 'super-secret-easytier-key-9999',
  controlPlaneToken: 'cp-tok-ultra-secret-value',
  existingPeers: [
    { nodeId: 'vps-sgp-01', meshIp: '10.144.0.1', publicEndpoint: 'udp://198.51.100.10:11010' },
  ],
  edgeDomain: 'edge-sgp2.moonwitness.io',
  requestedAt: '2026-11-23T00:00:00.000Z',
};

describe('node-provisioner (Wave C.14)', () => {
  it('validates 10.144.0.x EasyTier mesh CIDR strictly', () => {
    expect(isValidEasyTierMeshIp('10.144.0.1')).toBe(true);
    expect(isValidEasyTierMeshIp('10.144.0.254')).toBe(true);
    expect(isValidEasyTierMeshIp('10.144.0.0')).toBe(false);
    expect(isValidEasyTierMeshIp('10.144.0.255')).toBe(false);
    expect(isValidEasyTierMeshIp('10.144.1.2')).toBe(false);
    expect(isValidEasyTierMeshIp('192.168.1.10')).toBe(false);
  });

  it('produces deterministic idempotent bootstrap plan with redacted secrets and legacy autostart disabled', () => {
    const reportA = planVpsNodeProvision(BASE_REQUEST);
    const reportB = planVpsNodeProvision(BASE_REQUEST);

    expect(reportA.ok).toBe(true);
    expect(reportA.validationErrors).toHaveLength(0);
    expect(reportA.planSha256).toBe(reportB.planSha256);
    expect(reportA.steps.map((s) => s.id)).toEqual([
      'preflight-os',
      'install-docker',
      'join-easytier-mesh',
      'configure-control-plane',
      'configure-caddy-edge',
      'verify-health-probe',
    ]);
    expect(reportA.steps.every((s) => s.idempotent)).toBe(true);
    expect(reportA.systemdUnitPreview).toContain(
      'Environment=MW_CONTROL_PLANE_AUTOSTART_LEGACY=false'
    );
    expect(reportA.redactedSummary).not.toContain(BASE_REQUEST.meshNetworkSecret);
    for (const step of reportA.steps) {
      expect(step.redactedCommand).not.toContain(BASE_REQUEST.meshNetworkSecret);
      expect(step.redactedCommand).not.toContain(BASE_REQUEST.controlPlaneToken!);
    }
    const meshStep = reportA.steps.find((s) => s.id === 'join-easytier-mesh');
    expect(meshStep?.redactedCommand).toContain('[REDACTED]');
    expect(meshStep?.redactedCommand).toContain('--peers udp://198.51.100.10:11010');
  });

  it('rejects mesh IP collisions and duplicate node IDs', () => {
    const report = planVpsNodeProvision({
      ...BASE_REQUEST,
      nodeId: 'vps-sgp-01',
      meshIp: '10.144.0.1',
    });

    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(0);
    const codes = report.validationErrors.map((e) => e.code);
    expect(codes).toContain('MESH_IP_COLLISION');
    expect(codes).toContain('NODE_ID_COLLISION');
  });

  it('rejects invalid host, SSH port, weak secret, and out-of-CIDR mesh IP', () => {
    const errors = validateVpsProvisionRequest({
      ...BASE_REQUEST,
      host: '203.0.113.42; rm -rf /',
      sshPort: 70000,
      meshIp: '10.0.0.5',
      meshNetworkSecret: 'short',
    });

    const codes = errors.map((e) => e.code);
    expect(codes).toContain('INVALID_HOST');
    expect(codes).toContain('INVALID_SSH_PORT');
    expect(codes).toContain('INVALID_MESH_IP_CIDR');
    expect(codes).toContain('WEAK_MESH_SECRET');
  });

  it('redacts multiple secrets safely', () => {
    const output = redactProvisionSecrets('key=abc1234567890123 tok=xyz987', [
      'abc1234567890123',
      'xyz987',
      undefined,
    ]);
    expect(output).toBe('key=[REDACTED] tok=[REDACTED]');
  });
});
