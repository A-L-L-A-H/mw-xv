import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import {
  DEFAULT_CONTROL_PLANE_MESH_IP,
  DEFAULT_CONTROL_PLANE_PORT,
  DEFAULT_MESH_SUBNET,
  ensureMeshCredentials,
  readRawMeshEnvForBootstrap,
  redactMeshSecret,
  resolveDesktopHomeDir,
  type RawMeshEnvBootstrap,
} from './mesh-autopilot.js';
import { assertPrivateMeshEndpoint, isPrivateMeshIp } from './mesh-fleet.js';

export const DEFAULT_BOOTSTRAP_HOST = 'apps.mycocolink.com';
export const DEFAULT_BOOTSTRAP_PORT = 11010;
export const DEFAULT_MESH_API_PORT = 3000;
export const DEFAULT_MESH_BOARD_PORT = 4174;

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SAFE_HOST_PATTERN = /^[A-Za-z0-9.-]+$/u;

export interface EasyTierClientArgsOptions {
  readonly networkName: string;
  readonly networkSecret: string;
  readonly dhcp?: boolean;
  readonly ipv4?: string;
  readonly bootstrapHost?: string;
  readonly bootstrapPort?: number;
  readonly hostname?: string;
}

export interface EasyTierExecSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly redactedArgs: readonly string[];
}

export interface MeshSyncTargetInput {
  readonly networkName?: string;
  readonly networkSecret?: string;
  readonly subnet?: string;
  readonly secretRefPath?: string;
  readonly desktopHomeDir?: string;
  readonly controlPlaneMeshIp?: string;
  readonly controlPlanePort?: number;
  readonly apiPort?: number;
  readonly boardPort?: number;
  readonly bootstrapHost?: string;
  readonly bootstrapPort?: number;
}

export interface MeshSyncTarget {
  readonly networkName: string;
  readonly redactedSecret: string;
  readonly subnet: string;
  readonly secretRefPath: string;
  readonly controlPlaneMeshIp: string;
  readonly controlPlaneUrl: string;
  readonly apiUrl: string;
  readonly boardUrl: string;
  readonly bootstrapPeers: readonly string[];
}

export type MeshClientState = 'stopped' | 'starting' | 'running' | 'error';

export interface DiscoveredMeshPeer {
  readonly ipv4: string;
  readonly hostname: string;
  readonly cost?: string;
  readonly latencyMs?: number;
  readonly controlPlaneUrl: string;
  readonly apiUrl: string;
  readonly boardUrl: string;
}

export interface MeshClientStatus {
  readonly state: MeshClientState;
  readonly pid: number | null;
  readonly dhcp: boolean;
  readonly networkName: string;
  readonly redactedSecret: string;
  readonly bootstrapPeers: readonly string[];
  readonly redactedArgs: readonly string[];
  readonly syncTarget: MeshSyncTarget;
  readonly discoveredPeers: readonly DiscoveredMeshPeer[];
  readonly lastError?: string;
}

export interface MeshProcessHandle {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export type MeshSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: 'ignore' | 'pipe' },
) => MeshProcessHandle;

export type MeshExecFileFn = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export interface MeshClientControllerOptions {
  readonly desktopHomeDir?: string;
  readonly binaryPath?: string;
  readonly cliBinaryPath?: string;
  readonly bootstrapHost?: string;
  readonly bootstrapPort?: number;
  readonly hostname?: string;
  readonly controlPlaneMeshIp?: string;
  readonly controlPlanePort?: number;
  readonly apiPort?: number;
  readonly boardPort?: number;
  readonly spawnFn?: MeshSpawnFn;
  readonly execFileFn?: MeshExecFileFn;
}

function assertValidPort(port: number, label: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError(`${label} must be an integer between 1 and 65535.`);
  }
  return port;
}

function assertSafeToken(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !SAFE_TOKEN_PATTERN.test(trimmed) || trimmed.startsWith('-')) {
    throw new ValidationError(
      `${label} must be a non-empty safe token without whitespace, control characters, or leading dashes.`,
    );
  }
  return trimmed;
}

function assertSafeBootstrapHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || !SAFE_HOST_PATTERN.test(trimmed) || trimmed.startsWith('-')) {
    throw new ValidationError(
      'bootstrapHost must be a valid hostname or IP address without whitespace or leading dashes.',
    );
  }
  return trimmed;
}

function assertPrivateMeshIpValue(ip: string, label: string): string {
  const trimmed = ip.trim();
  if (!isPrivateMeshIp(trimmed)) {
    throw new AccessDeniedError(
      `${label} '${trimmed}' is not a private mesh IP address.`,
      { code: 'access_denied' },
    );
  }
  return trimmed;
}

function defaultExecFile(
  command: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { shell: false, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: 'ignore' | 'pipe' },
): ChildProcess {
  return spawn(command, [...args], {
    shell: options.shell,
    stdio: options.stdio,
    windowsHide: true,
  });
}

/**
 * Redacts the value following `--network-secret` in an easytier-core argv array.
 */
export function redactEasyTierArgs(args: readonly string[]): readonly string[] {
  const redacted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? '';
    redacted.push(token);
    if (token === '--network-secret' && i + 1 < args.length) {
      redacted.push(redactMeshSecret(args[i + 1] ?? ''));
      i += 1;
    }
  }
  return redacted;
}

/**
 * Builds safe argv arguments for `easytier-core` (intended for `execFile`/`spawn` with `shell: false`).
 * Defaults to `--dhcp` for automatic IP assignment (zero manual IP configuration).
 * If an explicit `ipv4` is supplied with `dhcp: false`, strictly enforces private mesh IP.
 */
export function buildEasyTierClientArgs(options: EasyTierClientArgsOptions): string[] {
  const networkName = assertSafeToken(options.networkName, 'networkName');
  const networkSecret = assertSafeToken(options.networkSecret, 'networkSecret');
  const useDhcp = options.dhcp ?? (options.ipv4 === undefined);
  const bootstrapHost = assertSafeBootstrapHost(options.bootstrapHost ?? DEFAULT_BOOTSTRAP_HOST);
  const bootstrapPort = assertValidPort(
    options.bootstrapPort ?? DEFAULT_BOOTSTRAP_PORT,
    'bootstrapPort',
  );

  const args: string[] = [];
  if (useDhcp) {
    args.push('--dhcp');
  } else {
    const ipv4 = assertPrivateMeshIpValue(options.ipv4 ?? '', 'ipv4');
    args.push('--ipv4', ipv4);
  }

  args.push(
    '--network-name',
    networkName,
    '--network-secret',
    networkSecret,
    '--peers',
    `tcp://${bootstrapHost}:${bootstrapPort}`,
    `udp://${bootstrapHost}:${bootstrapPort}`,
  );

  if (options.hostname !== undefined) {
    const hostname = assertSafeToken(options.hostname, 'hostname');
    args.push('--hostname', hostname);
  }

  return args;
}

/**
 * Builds a complete `execFile` invocation spec (`shell: false`) for `easytier-core`,
 * loading credentials from `~/.moonwitness/mesh.env` via `ensureMeshCredentials` /
 * `readRawMeshEnvForBootstrap` when not explicitly provided.
 */
export function buildEasyTierExecSpec(
  options: Partial<EasyTierClientArgsOptions> & {
    readonly desktopHomeDir?: string;
    readonly binaryPath?: string;
  } = {},
): EasyTierExecSpec {
  let networkName = options.networkName;
  let networkSecret = options.networkSecret;

  if (!networkName || !networkSecret) {
    ensureMeshCredentials(options.desktopHomeDir);
    const raw = readRawMeshEnvForBootstrap(options.desktopHomeDir);
    networkName = networkName ?? raw.networkName;
    networkSecret = networkSecret ?? raw.networkSecret;
  }

  const args = buildEasyTierClientArgs({
    networkName,
    networkSecret,
    dhcp: options.dhcp,
    ipv4: options.ipv4,
    bootstrapHost: options.bootstrapHost,
    bootstrapPort: options.bootstrapPort,
    hostname: options.hostname,
  });

  const defaultBinary = process.platform === 'win32'
    ? path.join(resolveDesktopHomeDir(options.desktopHomeDir), 'bin', 'easytier-core.exe')
    : 'easytier-core';

  return {
    command: options.binaryPath?.trim() || defaultBinary,
    args,
    shell: false,
    redactedArgs: redactEasyTierArgs(args),
  };
}

/**
 * Resolves private mesh sync endpoints (`controlPlaneUrl`, `apiUrl`, `boardUrl`)
 * from `meshEnv` or `~/.moonwitness/mesh.env`, strictly validating private mesh IPs
 * and redacting secrets in the returned status object.
 */
export function resolveMeshSyncTarget(
  meshEnv?: RawMeshEnvBootstrap | MeshSyncTargetInput,
): MeshSyncTarget {
  const input: MeshSyncTargetInput = meshEnv ?? {};
  let networkName = input.networkName;
  let networkSecret = input.networkSecret;
  let subnet = input.subnet;
  let secretRefPath = input.secretRefPath;

  if (!networkName || !networkSecret) {
    const status = ensureMeshCredentials(input.desktopHomeDir);
    const raw = readRawMeshEnvForBootstrap(input.desktopHomeDir);
    networkName = networkName ?? raw.networkName;
    networkSecret = networkSecret ?? raw.networkSecret;
    subnet = subnet ?? raw.subnet;
    secretRefPath = secretRefPath ?? status.secretRefPath;
  }

  const validatedNetworkName = assertSafeToken(networkName, 'networkName');
  const validatedNetworkSecret = assertSafeToken(networkSecret, 'networkSecret');
  const controlPlaneMeshIp = assertPrivateMeshIpValue(
    input.controlPlaneMeshIp ?? DEFAULT_CONTROL_PLANE_MESH_IP,
    'controlPlaneMeshIp',
  );
  const controlPlanePort = assertValidPort(
    input.controlPlanePort ?? DEFAULT_CONTROL_PLANE_PORT,
    'controlPlanePort',
  );
  const apiPort = assertValidPort(input.apiPort ?? DEFAULT_MESH_API_PORT, 'apiPort');
  const boardPort = assertValidPort(input.boardPort ?? DEFAULT_MESH_BOARD_PORT, 'boardPort');
  const bootstrapHost = assertSafeBootstrapHost(input.bootstrapHost ?? DEFAULT_BOOTSTRAP_HOST);
  const bootstrapPort = assertValidPort(
    input.bootstrapPort ?? DEFAULT_BOOTSTRAP_PORT,
    'bootstrapPort',
  );

  const controlPlaneUrl = `http://${controlPlaneMeshIp}:${controlPlanePort}`;
  const apiUrl = `http://${controlPlaneMeshIp}:${apiPort}`;
  const boardUrl = `http://${controlPlaneMeshIp}:${boardPort}`;

  assertPrivateMeshEndpoint(controlPlaneUrl);
  assertPrivateMeshEndpoint(apiUrl);
  assertPrivateMeshEndpoint(boardUrl);

  return {
    networkName: validatedNetworkName,
    redactedSecret: redactMeshSecret(validatedNetworkSecret),
    subnet: (subnet ?? DEFAULT_MESH_SUBNET).trim(),
    secretRefPath: secretRefPath ?? path.join(resolveDesktopHomeDir(input.desktopHomeDir), 'mesh.env'),
    controlPlaneMeshIp,
    controlPlaneUrl,
    apiUrl,
    boardUrl,
    bootstrapPeers: [
      `tcp://${bootstrapHost}:${bootstrapPort}`,
      `udp://${bootstrapHost}:${bootstrapPort}`,
    ],
  };
}

interface RawEasyTierPeerRecord {
  readonly ipv4?: unknown;
  readonly hostname?: unknown;
  readonly cost?: unknown;
  readonly lat_ms?: unknown;
}

function parseEasyTierPeersJson(
  stdout: string,
  ports: { readonly controlPlanePort: number; readonly apiPort: number; readonly boardPort: number },
): DiscoveredMeshPeer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const peers: DiscoveredMeshPeer[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const rec = entry as RawEasyTierPeerRecord;
    const rawIp = typeof rec.ipv4 === 'string' ? rec.ipv4.split('/')[0]?.trim() ?? '' : '';
    if (!rawIp || !isPrivateMeshIp(rawIp)) {
      continue;
    }
    const controlPlaneUrl = `http://${rawIp}:${ports.controlPlanePort}`;
    const apiUrl = `http://${rawIp}:${ports.apiPort}`;
    const boardUrl = `http://${rawIp}:${ports.boardPort}`;
    assertPrivateMeshEndpoint(controlPlaneUrl);
    assertPrivateMeshEndpoint(apiUrl);
    assertPrivateMeshEndpoint(boardUrl);

    const parsedLat = typeof rec.lat_ms === 'number'
      ? rec.lat_ms
      : typeof rec.lat_ms === 'string' && rec.lat_ms.trim() !== '' && Number.isFinite(Number(rec.lat_ms))
        ? Number(rec.lat_ms)
        : undefined;

    peers.push({
      ipv4: rawIp,
      hostname: typeof rec.hostname === 'string' && rec.hostname.trim().length > 0
        ? rec.hostname.trim()
        : rawIp,
      cost: typeof rec.cost === 'string' ? rec.cost : undefined,
      latencyMs: parsedLat,
      controlPlaneUrl,
      apiUrl,
      boardUrl,
    });
  }
  return peers;
}

/**
 * In-app controller for `apps/desktop` DX Mode to start/stop EasyTier (`--dhcp`),
 * inspect redacted status, and auto-discover private VPS mesh peers directly from the UI.
 */
export class MeshClientController {
  private readonly options: MeshClientControllerOptions;
  private readonly spawnFn: MeshSpawnFn;
  private readonly execFileFn: MeshExecFileFn;
  private child: MeshProcessHandle | null = null;
  private state: MeshClientState = 'stopped';
  private lastError: string | undefined;
  private lastRedactedArgs: readonly string[] = [];
  private discoveredPeers: readonly DiscoveredMeshPeer[] = [];

  constructor(options: MeshClientControllerOptions = {}) {
    this.options = options;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
    this.execFileFn = options.execFileFn ?? defaultExecFile;
  }

  private resolveCliBinary(): string {
    if (this.options.cliBinaryPath?.trim()) {
      return this.options.cliBinaryPath.trim();
    }
    return process.platform === 'win32'
      ? path.join(resolveDesktopHomeDir(this.options.desktopHomeDir), 'bin', 'easytier-cli.exe')
      : 'easytier-cli';
  }

  public start(): MeshClientStatus {
    if (this.child !== null && (this.state === 'running' || this.state === 'starting')) {
      return this.getStatus();
    }

    const spec = buildEasyTierExecSpec({
      desktopHomeDir: this.options.desktopHomeDir,
      binaryPath: this.options.binaryPath,
      dhcp: true,
      bootstrapHost: this.options.bootstrapHost,
      bootstrapPort: this.options.bootstrapPort,
      hostname: this.options.hostname,
    });

    this.lastRedactedArgs = spec.redactedArgs;
    this.lastError = undefined;
    this.state = 'starting';

    const proc = this.spawnFn(spec.command, spec.args, {
      shell: false,
      stdio: 'ignore',
    });
    this.child = proc;
    this.state = 'running';

    proc.on('error', (err: Error) => {
      this.state = 'error';
      this.lastError = err.message;
      this.child = null;
    });

    proc.on('exit', (code: number | null) => {
      if (this.state !== 'stopped') {
        this.state = code === 0 || code === null ? 'stopped' : 'error';
        if (code !== 0 && code !== null) {
          this.lastError = `easytier-core exited with code ${code}`;
        }
      }
      this.child = null;
    });

    return this.getStatus();
  }

  public stop(): MeshClientStatus {
    if (this.child !== null) {
      const proc = this.child;
      this.state = 'stopped';
      this.child = null;
      proc.kill('SIGTERM');
    } else {
      this.state = 'stopped';
    }
    return this.getStatus();
  }

  public async discoverPeers(): Promise<readonly DiscoveredMeshPeer[]> {
    const controlPlanePort = assertValidPort(
      this.options.controlPlanePort ?? DEFAULT_CONTROL_PLANE_PORT,
      'controlPlanePort',
    );
    const apiPort = assertValidPort(this.options.apiPort ?? DEFAULT_MESH_API_PORT, 'apiPort');
    const boardPort = assertValidPort(
      this.options.boardPort ?? DEFAULT_MESH_BOARD_PORT,
      'boardPort',
    );

    const { stdout } = await this.execFileFn(this.resolveCliBinary(), ['-o', 'json', 'peer']);
    const peers = parseEasyTierPeersJson(stdout, { controlPlanePort, apiPort, boardPort });
    this.discoveredPeers = peers;
    return peers;
  }

  public getStatus(): MeshClientStatus {
    const syncTarget = resolveMeshSyncTarget({
      desktopHomeDir: this.options.desktopHomeDir,
      controlPlaneMeshIp: this.options.controlPlaneMeshIp,
      controlPlanePort: this.options.controlPlanePort,
      apiPort: this.options.apiPort,
      boardPort: this.options.boardPort,
      bootstrapHost: this.options.bootstrapHost,
      bootstrapPort: this.options.bootstrapPort,
    });

    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      dhcp: true,
      networkName: syncTarget.networkName,
      redactedSecret: syncTarget.redactedSecret,
      bootstrapPeers: syncTarget.bootstrapPeers,
      redactedArgs: this.lastRedactedArgs,
      syncTarget,
      discoveredPeers: this.discoveredPeers,
      lastError: this.lastError,
    };
  }
}
