import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MESH_SUBNET = '10.144.0.0/24';
export const DEFAULT_CONTROL_PLANE_MESH_IP = '10.144.0.1';
export const DEFAULT_CONTROL_PLANE_PORT = 3003;
export const DEFAULT_VPS_INSTALL_SCRIPT_PATH = 'scripts/install-control-plane-vps.sh';

export interface MeshCredentialsStatus {
  networkName: string;
  secretRefPath: string;
  subnet: string;
  created: boolean;
  redactedSecret: string;
}

export interface RawMeshEnvBootstrap {
  networkName: string;
  networkSecret: string;
  subnet: string;
  secretRefPath: string;
}

export interface VpsJoinCommandOptions {
  networkName: string;
  networkSecret?: string;
  subnet?: string;
  controlPlaneMeshIp?: string;
  controlPlanePort?: number;
  peers?: string[];
  scriptPath?: string;
  repoRawBaseUrl?: string;
}

export function resolveDesktopHomeDir(desktopHomeDir?: string): string {
  if (desktopHomeDir && desktopHomeDir.trim().length > 0) {
    return path.resolve(desktopHomeDir.trim());
  }
  return path.join(os.homedir(), '.moonwitness');
}

export function redactMeshSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 12) {
    return '[REDACTED]';
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function serializeMeshEnv(networkName: string, networkSecret: string, subnet: string): string {
  return [
    '# MoonWitness EasyTier P2P Mesh Credentials (local-only, never commit to git)',
    `MW_MESH_NETWORK_NAME=${networkName}`,
    `MW_MESH_NETWORK_SECRET=${networkSecret}`,
    `MW_MESH_SUBNET=${subnet}`,
    '',
  ].join('\n');
}

function applyRestrictivePermissions(filePath: string, mode: number): void {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Best-effort on platforms where POSIX chmod bits are not enforced (e.g. Windows).
  }
}

export function ensureMeshCredentials(desktopHomeDir?: string): MeshCredentialsStatus {
  const resolvedHome = resolveDesktopHomeDir(desktopHomeDir);
  const secretRefPath = path.join(resolvedHome, 'mesh.env');

  if (fs.existsSync(secretRefPath)) {
    const existing = parseEnvFile(fs.readFileSync(secretRefPath, 'utf8'));
    const networkName = existing.MW_MESH_NETWORK_NAME?.trim();
    const networkSecret = existing.MW_MESH_NETWORK_SECRET?.trim();
    const subnet = existing.MW_MESH_SUBNET?.trim() || DEFAULT_MESH_SUBNET;

    if (!networkName || !networkSecret) {
      throw new Error(
        `Existing mesh credentials file at ${secretRefPath} is missing MW_MESH_NETWORK_NAME or MW_MESH_NETWORK_SECRET.`
      );
    }

    return {
      networkName,
      secretRefPath,
      subnet,
      created: false,
      redactedSecret: redactMeshSecret(networkSecret),
    };
  }

  fs.mkdirSync(resolvedHome, { recursive: true, mode: 0o700 });
  applyRestrictivePermissions(resolvedHome, 0o700);

  const networkName = `mw-mesh-${crypto.randomBytes(4).toString('hex')}`;
  const networkSecret = `mw_${crypto.randomBytes(32).toString('base64url')}`;
  const subnet = DEFAULT_MESH_SUBNET;

  fs.writeFileSync(secretRefPath, serializeMeshEnv(networkName, networkSecret, subnet), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  applyRestrictivePermissions(secretRefPath, 0o600);

  return {
    networkName,
    secretRefPath,
    subnet,
    created: true,
    redactedSecret: redactMeshSecret(networkSecret),
  };
}

/**
 * Operator-only bootstrap helper. Reads the raw mesh secret from local disk.
 * Never pass the returned secret into telemetry, status endpoints, or UI logs.
 */
export function readRawMeshEnvForBootstrap(desktopHomeDir?: string): RawMeshEnvBootstrap {
  const resolvedHome = resolveDesktopHomeDir(desktopHomeDir);
  const secretRefPath = path.join(resolvedHome, 'mesh.env');

  if (!fs.existsSync(secretRefPath)) {
    throw new Error(
      `Mesh credentials file not found at ${secretRefPath}. Run ensureMeshCredentials() first.`
    );
  }

  const parsed = parseEnvFile(fs.readFileSync(secretRefPath, 'utf8'));
  const networkName = parsed.MW_MESH_NETWORK_NAME?.trim();
  const networkSecret = parsed.MW_MESH_NETWORK_SECRET?.trim();
  const subnet = parsed.MW_MESH_SUBNET?.trim() || DEFAULT_MESH_SUBNET;

  if (!networkName || !networkSecret) {
    throw new Error(`Mesh credentials file at ${secretRefPath} is incomplete.`);
  }

  return {
    networkName,
    networkSecret,
    subnet,
    secretRefPath,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildVpsJoinCommand(options: VpsJoinCommandOptions): string {
  const networkName = options.networkName.trim();
  if (!networkName) {
    throw new Error('networkName is required to build a VPS join command.');
  }

  const secretValue = options.networkSecret?.trim() || '<MW_MESH_NETWORK_SECRET>';
  const subnet = options.subnet?.trim() || DEFAULT_MESH_SUBNET;
  const controlPlaneMeshIp = options.controlPlaneMeshIp?.trim() || DEFAULT_CONTROL_PLANE_MESH_IP;
  const controlPlanePort = options.controlPlanePort ?? DEFAULT_CONTROL_PLANE_PORT;
  const scriptPath = options.scriptPath?.trim() || DEFAULT_VPS_INSTALL_SCRIPT_PATH;

  if (controlPlaneMeshIp === '0.0.0.0' || controlPlaneMeshIp === '::') {
    throw new Error('controlPlaneMeshIp must be a private mesh IP, never 0.0.0.0 or ::.');
  }

  const envParts: string[] = [
    `MW_MESH_NETWORK_NAME=${shellQuote(networkName)}`,
    `MW_MESH_NETWORK_SECRET=${shellQuote(secretValue)}`,
    `MW_MESH_SUBNET=${shellQuote(subnet)}`,
    `MW_MESH_IP=${shellQuote(controlPlaneMeshIp)}`,
    `MW_CONTROL_PLANE_PORT=${shellQuote(String(controlPlanePort))}`,
  ];

  if (options.peers && options.peers.length > 0) {
    const cleanedPeers = options.peers.map((peer) => peer.trim()).filter(Boolean);
    if (cleanedPeers.length > 0) {
      envParts.push(`MW_MESH_PEERS=${shellQuote(cleanedPeers.join(','))}`);
    }
  }

  if (options.repoRawBaseUrl && options.repoRawBaseUrl.trim().length > 0) {
    const baseUrl = options.repoRawBaseUrl.trim().replace(/\/+$/, '');
    const normalizedScript = scriptPath.replace(/^\/+/, '');
    const scriptUrl = `${baseUrl}/${normalizedScript}`;
    return `curl -fsSL ${shellQuote(scriptUrl)} | sudo ${envParts.join(' ')} bash`;
  }

  return `sudo ${envParts.join(' ')} bash ${shellQuote(scriptPath)}`;
}
