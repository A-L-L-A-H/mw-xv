import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildVpsJoinCommand,
  DEFAULT_MESH_SUBNET,
  ensureMeshCredentials,
  readRawMeshEnvForBootstrap,
  redactMeshSecret,
} from '../src/mesh-autopilot.js';

const tempDirs: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-mesh-autopilot-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('mesh-autopilot', () => {
  it('idempotently creates and reuses mesh credentials in <desktopHomeDir>/mesh.env', () => {
    const tempHome = createTempHome();

    const first = ensureMeshCredentials(tempHome);
    expect(first.created).toBe(true);
    expect(first.networkName).toMatch(/^mw-mesh-[0-9a-f]{8}$/);
    expect(first.subnet).toBe(DEFAULT_MESH_SUBNET);
    expect(first.secretRefPath).toBe(path.join(tempHome, 'mesh.env'));
    expect(fs.existsSync(first.secretRefPath)).toBe(true);

    const second = ensureMeshCredentials(tempHome);
    expect(second.created).toBe(false);
    expect(second.networkName).toBe(first.networkName);
    expect(second.subnet).toBe(first.subnet);
    expect(second.secretRefPath).toBe(first.secretRefPath);
    expect(second.redactedSecret).toBe(first.redactedSecret);
  });

  it('generates at least 32 bytes of cryptographic entropy for MW_MESH_NETWORK_SECRET', () => {
    const tempHome = createTempHome();
    ensureMeshCredentials(tempHome);

    const raw = readRawMeshEnvForBootstrap(tempHome);
    const decoded = Buffer.from(raw.networkSecret, 'base64url');
    expect(decoded.length).toBeGreaterThanOrEqual(32);
    expect(raw.networkName).toMatch(/^mw-mesh-[0-9a-f]{8}$/);
    expect(raw.subnet).toBe(DEFAULT_MESH_SUBNET);
  });

  it('redacts raw secret in ensureMeshCredentials status output', () => {
    const tempHome = createTempHome();
    const status = ensureMeshCredentials(tempHome);
    const raw = readRawMeshEnvForBootstrap(tempHome);

    expect(status.redactedSecret).not.toBe(raw.networkSecret);
    expect(status.redactedSecret).toBe(redactMeshSecret(raw.networkSecret));
    expect(JSON.stringify(status)).not.toContain(raw.networkSecret);
    expect(redactMeshSecret('short')).toBe('[REDACTED]');
  });

  it('formats a clean 1-line Linux VPS join command referencing scripts/install-control-plane-vps.sh', () => {
    const cmd = buildVpsJoinCommand({
      networkName: 'mw-mesh-deadbeef',
      subnet: '10.144.0.0/24',
      controlPlaneMeshIp: '10.144.0.1',
      controlPlanePort: 3003,
      peers: ['tcp://peer1.example.com:11010', 'udp://peer2.example.com:11010'],
    });

    expect(cmd).not.toContain('\n');
    expect(cmd).toContain("MW_MESH_NETWORK_NAME='mw-mesh-deadbeef'");
    expect(cmd).toContain("MW_MESH_NETWORK_SECRET='<MW_MESH_NETWORK_SECRET>'");
    expect(cmd).toContain("MW_MESH_SUBNET='10.144.0.0/24'");
    expect(cmd).toContain("MW_MESH_IP='10.144.0.1'");
    expect(cmd).toContain("MW_CONTROL_PLANE_PORT='3003'");
    expect(cmd).toContain("MW_MESH_PEERS='tcp://peer1.example.com:11010,udp://peer2.example.com:11010'");
    expect(cmd).toContain("bash 'scripts/install-control-plane-vps.sh'");

    const remoteCmd = buildVpsJoinCommand({
      networkName: 'mw-mesh-cafebabe',
      repoRawBaseUrl: 'https://raw.githubusercontent.com/org/repo/main/',
    });
    expect(remoteCmd).toContain(
      "curl -fsSL 'https://raw.githubusercontent.com/org/repo/main/scripts/install-control-plane-vps.sh' | sudo ",
    );
    expect(remoteCmd.endsWith(' bash')).toBe(true);
  });

  it('rejects public wildcard bind addresses in buildVpsJoinCommand', () => {
    expect(() =>
      buildVpsJoinCommand({
        networkName: 'mw-mesh-12345678',
        controlPlaneMeshIp: '0.0.0.0',
      }),
    ).toThrow(/private mesh IP/i);
  });
});
