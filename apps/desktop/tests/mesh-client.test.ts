import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import {
  buildEasyTierClientArgs,
  buildEasyTierExecSpec,
  DEFAULT_BOOTSTRAP_HOST,
  DEFAULT_BOOTSTRAP_PORT,
  MeshClientController,
  redactEasyTierArgs,
  resolveMeshSyncTarget,
  type MeshProcessHandle,
} from '../src/mesh-client.js';
import { ensureMeshCredentials, readRawMeshEnvForBootstrap } from '../src/mesh-autopilot.js';

const tempDirs: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-mesh-client-'));
  tempDirs.push(dir);
  return dir;
}

class FakeMeshProcess extends EventEmitter implements MeshProcessHandle {
  public readonly pid = 4242;
  public killed = false;

  public kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, 'SIGTERM');
    return true;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('mesh-client', () => {
  it('builds safe easytier-core args with --dhcp by default and bootstrap peers', () => {
    const args = buildEasyTierClientArgs({
      networkName: 'mw-mesh-a1b2c3d4',
      networkSecret: 'superSecretMeshToken1234567890',
    });

    expect(args).toEqual([
      '--dhcp',
      '--network-name',
      'mw-mesh-a1b2c3d4',
      '--network-secret',
      'superSecretMeshToken1234567890',
      '--peers',
      `tcp://${DEFAULT_BOOTSTRAP_HOST}:${DEFAULT_BOOTSTRAP_PORT}`,
      `udp://${DEFAULT_BOOTSTRAP_HOST}:${DEFAULT_BOOTSTRAP_PORT}`,
    ]);
  });

  it('builds execFile spec with shell: false and redacts network secret', () => {
    const homeDir = createTempHome();
    ensureMeshCredentials(homeDir);
    const raw = readRawMeshEnvForBootstrap(homeDir);

    const spec = buildEasyTierExecSpec({
      desktopHomeDir: homeDir,
      hostname: 'laptop-dx-01',
    });

    expect(spec.shell).toBe(false);
    expect(spec.args).toContain('--dhcp');
    expect(spec.args).toContain(raw.networkSecret);
    expect(spec.args).toContain('--hostname');
    expect(spec.args).toContain('laptop-dx-01');
    expect(spec.redactedArgs).not.toContain(raw.networkSecret);

    const secretFlagIndex = spec.redactedArgs.indexOf('--network-secret');
    expect(secretFlagIndex).toBeGreaterThan(-1);
    expect(spec.redactedArgs[secretFlagIndex + 1]).not.toBe(raw.networkSecret);
    expect(spec.redactedArgs[secretFlagIndex + 1]).toContain('...');
  });

  it('redacts short secrets completely in redactEasyTierArgs', () => {
    const redacted = redactEasyTierArgs([
      '--network-name',
      'mw-mesh-test',
      '--network-secret',
      'shortsec',
    ]);
    expect(redacted).toEqual(['--network-name', 'mw-mesh-test', '--network-secret', '[REDACTED]']);
  });

  it('enforces private-IP-only for explicit ipv4 and controlPlaneMeshIp', () => {
    expect(() =>
      buildEasyTierClientArgs({
        networkName: 'mw-mesh-test',
        networkSecret: 'superSecretMeshToken1234567890',
        dhcp: false,
        ipv4: '8.8.8.8',
      })
    ).toThrow(AccessDeniedError);

    expect(() =>
      buildEasyTierClientArgs({
        networkName: 'mw-mesh-test',
        networkSecret: 'superSecretMeshToken1234567890',
        dhcp: false,
        ipv4: '127.0.0.1',
      })
    ).toThrow(AccessDeniedError);

    expect(() =>
      resolveMeshSyncTarget({
        networkName: 'mw-mesh-test',
        networkSecret: 'superSecretMeshToken1234567890',
        controlPlaneMeshIp: 'apps.mycocolink.com',
      })
    ).toThrow(AccessDeniedError);
  });

  it('rejects flag injection or invalid tokens in buildEasyTierClientArgs', () => {
    expect(() =>
      buildEasyTierClientArgs({
        networkName: '--malicious',
        networkSecret: 'superSecretMeshToken1234567890',
      })
    ).toThrow(ValidationError);

    expect(() =>
      buildEasyTierClientArgs({
        networkName: 'mw-mesh-test',
        networkSecret: 'secret with spaces',
      })
    ).toThrow(ValidationError);
  });

  it('resolves private mesh sync targets from mesh.env and never exposes raw secret', () => {
    const homeDir = createTempHome();
    ensureMeshCredentials(homeDir);
    const raw = readRawMeshEnvForBootstrap(homeDir);

    const target = resolveMeshSyncTarget({ desktopHomeDir: homeDir });

    expect(target.networkName).toBe(raw.networkName);
    expect(target.controlPlaneMeshIp).toBe('10.144.0.1');
    expect(target.controlPlaneUrl).toBe('http://10.144.0.1:3003');
    expect(target.apiUrl).toBe('http://10.144.0.1:3000');
    expect(target.boardUrl).toBe('http://10.144.0.1:4174');
    expect(target.bootstrapPeers).toEqual([
      'tcp://apps.mycocolink.com:11010',
      'udp://apps.mycocolink.com:11010',
    ]);
    expect(JSON.stringify(target)).not.toContain(raw.networkSecret);
  });

  it('MeshClientController starts/stops with --dhcp, redacts secrets, and discovers only private peers', async () => {
    const homeDir = createTempHome();
    ensureMeshCredentials(homeDir);
    const raw = readRawMeshEnvForBootstrap(homeDir);

    const fakeProc = new FakeMeshProcess();
    let spawnedArgs: readonly string[] = [];

    const controller = new MeshClientController({
      desktopHomeDir: homeDir,
      spawnFn: (_cmd, args) => {
        spawnedArgs = args;
        return fakeProc;
      },
      execFileFn: async () => ({
        stdout: JSON.stringify([
          { ipv4: '10.144.0.1/24', hostname: 'vps-control-plane', cost: 'p2p', lat_ms: 14.5 },
          { ipv4: '8.8.8.8/32', hostname: 'public-ignored', cost: 'relay', lat_ms: 99 },
          { ipv4: '127.0.0.1/32', hostname: 'loopback-ignored', cost: 'local', lat_ms: 0 },
        ]),
        stderr: '',
      }),
    });

    const started = controller.start();
    expect(started.state).toBe('running');
    expect(started.pid).toBe(4242);
    expect(started.dhcp).toBe(true);
    expect(spawnedArgs).toContain('--dhcp');
    expect(JSON.stringify(started)).not.toContain(raw.networkSecret);

    const peers = await controller.discoverPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({
      ipv4: '10.144.0.1',
      hostname: 'vps-control-plane',
      cost: 'p2p',
      latencyMs: 14.5,
      controlPlaneUrl: 'http://10.144.0.1:3003',
      apiUrl: 'http://10.144.0.1:3000',
      boardUrl: 'http://10.144.0.1:4174',
    });

    const stopped = controller.stop();
    expect(stopped.state).toBe('stopped');
    expect(stopped.pid).toBeNull();
    expect(fakeProc.killed).toBe(true);
  });
});
