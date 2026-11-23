import { isIP } from 'node:net';

export type TrustProxySetting = boolean | string[] | ((address: string, hop: number) => boolean);
export type RateLimitStore = 'memory' | 'postgres';

/**
 * Fastify intentionally treats a numeric trustProxy as fail-closed. Operators who explicitly
 * choose hop-count mode get a function that trusts exactly the first N forwarding entries.
 */
function trustHops(hops: number): (address: string, hop: number) => boolean {
  return (_address: string, hop: number) => hop < hops;
}

function readInteger(name: string, raw: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseCidrs(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error('TRUST_PROXY_CIDRS must contain at least one IP or CIDR');
  for (const entry of entries) {
    const parts = entry.split('/');
    const address = parts[0] ?? '';
    const ipVersion = isIP(address);
    if (!ipVersion || parts.length > 2) {
      throw new Error(`TRUST_PROXY_CIDRS entry must be an IP or CIDR: ${entry}`);
    }
    if (parts.length === 2) {
      const prefix = parts[1] ?? '';
      const maximum = ipVersion === 4 ? 32 : 128;
      readInteger('TRUST_PROXY_CIDRS prefix', prefix, 0, maximum);
    }
  }
  return entries;
}

/**
 * Proxy trust must be explicit. Production no longer trusts X-Forwarded-For by default:
 * either a hop count or an allowlist of proxy addresses/CIDRs is required.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const cidrs = env.TRUST_PROXY_CIDRS?.trim();
  const hops = env.TRUST_PROXY_HOPS?.trim();
  const mode = env.TRUST_PROXY?.trim().toLowerCase() ?? '';

  if (cidrs && hops) {
    throw new Error('Configure only one of TRUST_PROXY_CIDRS or TRUST_PROXY_HOPS');
  }
  if (cidrs) return parseCidrs(cidrs);
  if (hops) return trustHops(readInteger('TRUST_PROXY_HOPS', hops, 1, 255));

  if (!mode || mode === 'false') return false;
  if (mode === 'true') return true;
  if (mode === 'hops') {
    if (!hops) throw new Error('TRUST_PROXY=hops requires TRUST_PROXY_HOPS');
    return trustHops(readInteger('TRUST_PROXY_HOPS', hops, 1, 255));
  }
  if (mode === 'cidrs') {
    if (!cidrs) throw new Error('TRUST_PROXY=cidrs requires TRUST_PROXY_CIDRS');
    return parseCidrs(cidrs);
  }
  if (/^\d+$/u.test(mode)) return trustHops(readInteger('TRUST_PROXY', mode, 1, 255));
  throw new Error('TRUST_PROXY must be false, true, hops, cidrs, or a hop count');
}

export function resolveRateLimitStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const store = env.RATE_LIMIT_STORE?.trim().toLowerCase() ?? '';
  if (!store || store === 'memory') return 'memory';
  if (store === 'postgres') return 'postgres';
  throw new Error('RATE_LIMIT_STORE must be memory or postgres');
}
