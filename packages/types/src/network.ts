/**
 * Canonical private-mesh CIDR ranges and shared network endpoint validators.
 *
 * Issue #263: single source of truth for loopback URL checks and private-mesh
 * IP/host validation across workspace packages.
 */
export const PRIVATE_MESH_CIDRS = Object.freeze([
  '10.0.0.0/8',
  '100.64.0.0/10',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fd00::/8',
] as const);

export type PrivateMeshCidr = (typeof PRIVATE_MESH_CIDRS)[number];

export interface PrivateMeshIpOptions {
  /** When true, also accepts loopback addresses (`127.0.0.0/8`, `::1`). Default: false. */
  readonly allowLoopback?: boolean;
}

export interface LoopbackHostnameOptions {
  /** Additional hostnames treated as loopback (e.g. `ipc.localhost`, `tauri.localhost`). */
  readonly extraHostnames?: readonly string[];
  /** Allow the full `127.0.0.0/8` IPv4 range instead of only `127.0.0.1`. Default: true. */
  readonly allowIpv4LoopbackSubnet?: boolean;
}

export interface LoopbackEndpointUrlOptions extends LoopbackHostnameOptions {
  /** Additional URL protocols allowed beyond `http:` and `https:` (e.g. `ws:`, `tauri:`). */
  readonly allowedProtocols?: readonly string[];
  /** Reject URLs with non-empty query strings. Default: false. */
  readonly rejectQuery?: boolean;
}

interface ParsedIpv4Cidr {
  readonly network: number;
  readonly mask: number;
}

interface ParsedIpv6Cidr {
  readonly network: bigint;
  readonly mask: bigint;
}

function parseStrictIpv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) {
      return null;
    }
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    octets.push(num);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function ipv4ToUint32(octets: readonly [number, number, number, number]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function parseIpv4Cidr(cidr: string): ParsedIpv4Cidr | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const octets = parseStrictIpv4(cidr.slice(0, slash));
  const prefixText = cidr.slice(slash + 1);
  if (!octets || !/^\d{1,2}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ipv4ToUint32(octets) & mask) >>> 0, mask };
}

/** Strict IPv6 parser returning eight 16-bit groups; fails closed on zone ids and IPv4 mapping. */
function parseStrictIpv6(rawHost: string): readonly number[] | null {
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host.includes(':') || host.includes('%') || host.includes('.')) {
    return null;
  }
  const doubleColonParts = host.split('::');
  if (doubleColonParts.length > 2) {
    return null;
  }

  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const allGroups = [...left, ...right];

  if (doubleColonParts.length === 1) {
    if (allGroups.length !== 8) return null;
  } else if (allGroups.length >= 8) {
    return null;
  }

  for (const group of allGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) {
      return null;
    }
  }

  return [
    ...left.map((group) => Number.parseInt(group, 16)),
    ...Array.from({ length: 8 - allGroups.length }, () => 0),
    ...right.map((group) => Number.parseInt(group, 16)),
  ];
}

function ipv6ToBigInt(groups: readonly number[]): bigint {
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

function parseIpv6Cidr(cidr: string): ParsedIpv6Cidr | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const groups = parseStrictIpv6(cidr.slice(0, slash));
  const prefixText = cidr.slice(slash + 1);
  if (!groups || !/^\d{1,3}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix > 128) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return { network: ipv6ToBigInt(groups) & mask, mask };
}

const PRIVATE_MESH_IPV4_CIDRS = PRIVATE_MESH_CIDRS.map(parseIpv4Cidr).filter(
  (cidr): cidr is ParsedIpv4Cidr => cidr !== null
);
const PRIVATE_MESH_IPV6_CIDRS = PRIVATE_MESH_CIDRS.map(parseIpv6Cidr).filter(
  (cidr): cidr is ParsedIpv6Cidr => cidr !== null
);

/**
 * Validates that a host string is strictly a private mesh IP address
 * (`PRIVATE_MESH_CIDRS`), optionally allowing loopback addresses (`127.0.0.0/8`, `::1`).
 */
export function isPrivateMeshIp(rawHost: string, options?: PrivateMeshIpOptions): boolean {
  if (typeof rawHost !== 'string') return false;
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('://') || /\s/u.test(trimmed)) {
    return false;
  }

  const ipv4 = parseStrictIpv4(trimmed);
  if (ipv4) {
    if (options?.allowLoopback === true && ipv4[0] === 127) {
      return true;
    }
    const value = ipv4ToUint32(ipv4);
    return PRIVATE_MESH_IPV4_CIDRS.some(({ network, mask }) => (value & mask) >>> 0 === network);
  }

  const ipv6 = parseStrictIpv6(trimmed);
  if (!ipv6) return false;
  const value = ipv6ToBigInt(ipv6);
  if (options?.allowLoopback === true && value === 1n) {
    return true;
  }
  return PRIVATE_MESH_IPV6_CIDRS.some(({ network, mask }) => (value & mask) === network);
}

/**
 * Validates that a host string or `http:`/`https:` URL targets a private mesh IP address.
 */
export function isPrivateMeshHost(hostOrUrl: string, options?: PrivateMeshIpOptions): boolean {
  if (typeof hostOrUrl !== 'string') return false;
  const trimmed = hostOrUrl.trim();
  if (!trimmed) return false;
  if (trimmed.includes('://')) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return isPrivateMeshIp(parsed.hostname, options);
  }
  return isPrivateMeshIp(trimmed, options);
}

/** Returns true when `hostname` is a loopback host (`localhost`, `::1`, or `127.0.0.0/8`). */
export function isLoopbackHostname(hostname: string, options?: LoopbackHostnameOptions): boolean {
  if (typeof hostname !== 'string') return false;
  const normalized = hostname
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (!normalized) return false;

  if (normalized === 'localhost') return true;
  if (options?.extraHostnames?.some((extra) => extra.toLowerCase() === normalized)) {
    return true;
  }

  const ipv4 = parseStrictIpv4(normalized);
  if (ipv4) {
    return options?.allowIpv4LoopbackSubnet === false
      ? normalized === '127.0.0.1'
      : ipv4[0] === 127;
  }

  const ipv6 = parseStrictIpv6(normalized);
  return ipv6 !== null && ipv6ToBigInt(ipv6) === 1n;
}

/** Validates that `rawUrl` targets a loopback host over an allowed protocol without credentials or fragments. */
export function isLoopbackEndpointUrl(
  rawUrl: string,
  options?: LoopbackEndpointUrlOptions
): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const protocol = parsed.protocol;
  const isHttp = protocol === 'http:' || protocol === 'https:';
  const isExtraProtocol = options?.allowedProtocols?.includes(protocol) ?? false;
  if (!isHttp && !isExtraProtocol) {
    return false;
  }

  if (parsed.username || parsed.password || parsed.hash) {
    return false;
  }
  if (options?.rejectQuery && parsed.search.length > 0) {
    return false;
  }

  return isLoopbackHostname(parsed.hostname, options);
}
