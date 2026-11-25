import { DEFAULT_CONTROL_PLANE_URL, MILLISECONDS_PER_MINUTE } from '@moonwitness/types';
import { isLoopbackHostname, isPrivateMeshIp, type PrivateMeshIpOptions } from '@moonwitness/types';
import { controlPlaneAuthHeaders, recordCloudOperation, resolveControlPlaneToken } from './auth.js';
import { CloudDeploymentTarget } from './models/index.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;
const MAX_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 2;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024;

export type ProbeFailureReason =
  | 'INVALID_TARGET_URL'
  | 'TARGET_NOT_ALLOWED'
  | 'INVALID_TIMEOUT'
  | 'REDIRECT_BLOCKED'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'MALFORMED_RESPONSE'
  | 'UPSTREAM_ERROR';

export type ProbeOutcomeStatus = 'healthy' | 'degraded' | 'offline' | 'invalid';

export interface ProbeTargetPolicy {
  /** Exact hostnames (and IPs) that may be probed. */
  readonly allowedHosts?: readonly string[];
  /** Optional IPv4 CIDRs that may be probed, e.g. 10.20.0.0/24. */
  readonly allowedCidrs?: readonly string[];
  /** Loopback is allowed by default for local control-plane agents. */
  readonly allowLoopback?: boolean;
  /** Private RFC1918/CGNAT/ULA ranges are denied unless explicitly enabled. */
  readonly allowPrivateRanges?: boolean;
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  readonly maxTimeoutMs?: number;
}

export class ProbeTargetError extends Error {
  readonly reason: ProbeFailureReason;

  constructor(reason: ProbeFailureReason, message: string) {
    super(message);
    this.name = 'ProbeTargetError';
    this.reason = reason;
  }
}

function normalizeHost(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
}

function ipv4ToInt(host: string): number | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function inCidr(host: string, cidr: string): boolean {
  const [network, prefixText] = cidr.trim().split('/');
  if (!network || !prefixText) return false;
  const hostValue = ipv4ToInt(host);
  const networkValue = ipv4ToInt(network);
  const prefix = Number(prefixText);
  if (hostValue === undefined || networkValue === undefined) return false;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (hostValue & mask) === (networkValue & mask);
}

/** SSRF boundary used by every outbound probe, including redirects. */
export function isAllowedProbeHost(rawHost: string, policy: ProbeTargetPolicy = {}): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  const allowed = (policy.allowedHosts ?? []).map(normalizeHost);
  if (allowed.includes(host)) return true;

  const privateMeshOptions: PrivateMeshIpOptions = {
    allowLoopback: policy.allowLoopback ?? true,
  };

  if (isLoopbackHostname(host, { allowIpv4LoopbackSubnet: privateMeshOptions.allowLoopback })) return true;
  if (policy.allowPrivateRanges && isPrivateMeshIp(host, privateMeshOptions)) return true;

  return (policy.allowedCidrs ?? []).some((cidr) => inCidr(host, cidr));
}

/** Validate a probe destination against the policy without performing I/O. */
export function assertProbeTarget(
  rawUrl: string | undefined | null,
  policy: ProbeTargetPolicy = {}
): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new ProbeTargetError('INVALID_TARGET_URL', 'Probe target URL is missing or invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new ProbeTargetError('INVALID_TARGET_URL', 'Probe target URL is missing or invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProbeTargetError('INVALID_TARGET_URL', 'Probe target protocol is not allowed');
  }
  if (parsed.username || parsed.password) {
    throw new ProbeTargetError('INVALID_TARGET_URL', 'Probe target must not embed credentials');
  }
  if (!isAllowedProbeHost(parsed.hostname, policy)) {
    throw new ProbeTargetError(
      'TARGET_NOT_ALLOWED',
      'Probe target is not in the allowed destination policy'
    );
  }
  return parsed;
}

function statusFromHealthPayload(payload: unknown): ProbeOutcomeStatus {
  const obj = payload as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== 'object') return 'offline';
  const status = obj.status;
  const docker = obj.docker;
  if (status === 'ok' && docker !== 'error') return 'healthy';
  if (status === 'degraded' || status === 'error') return 'degraded';
  if (status === 'offline') return 'offline';
  return 'offline';
}

type BoundedBody =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: ProbeFailureReason };

/** Reads at most maxResponseBytes and never returns upstream body text in errors. */
export async function readBoundedResponseBody(
  res: Response,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<BoundedBody> {
  if (!res.body) return { ok: true, text: '' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'RESPONSE_TOO_LARGE' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'RESPONSE_TOO_LARGE' };
  }
}

export interface ProbeCloudTargetsHealthOptions {
  readonly companyId?: number;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Preferred structured policy. */
  readonly policy?: ProbeTargetPolicy;
  /** Legacy shorthand merged into policy. */
  readonly allowedHosts?: readonly string[];
  readonly allowedCidrs?: readonly string[];
  readonly allowPrivateRanges?: boolean;
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  /** Default URL for targets without api_url; subject to the same policy. */
  readonly defaultTargetUrl?: string;
}

export interface ProbeCloudTargetsHealthResult {
  readonly probed: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly offline: number;
  /** Targets skipped because of invalid configuration (not marked offline). */
  readonly invalid: number;
  /** Stable, non-sensitive reason codes observed in this run. */
  readonly reasonCodes: readonly ProbeFailureReason[];
}

interface SingleProbeResult {
  readonly status: ProbeOutcomeStatus;
  readonly reason?: ProbeFailureReason;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    (typeof message === 'string' && /timeout|aborted/iu.test(message))
  );
}

async function probeOneTarget(
  targetUrl: URL,
  token: string | undefined,
  fetchImpl: typeof fetch,
  policy: ProbeTargetPolicy,
  timeoutMs: number,
  maxResponseBytes: number
): Promise<SingleProbeResult> {
  const maxRedirects = Math.max(0, Math.min(10, policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS));
  let current = targetUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        headers: controlPlaneAuthHeaders(token),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    } catch (error) {
      return {
        status: 'offline',
        reason: isTimeoutError(error) ? 'TIMEOUT' : 'UPSTREAM_ERROR',
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { status: 'offline', reason: 'MALFORMED_RESPONSE' };
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { status: 'offline', reason: 'MALFORMED_RESPONSE' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { status: 'offline', reason: 'REDIRECT_BLOCKED' };
      }
      if (next.username || next.password || !isAllowedProbeHost(next.hostname, policy)) {
        return { status: 'offline', reason: 'REDIRECT_BLOCKED' };
      }
      if (hop === maxRedirects) return { status: 'offline', reason: 'TOO_MANY_REDIRECTS' };
      current = next;
      continue;
    }

    if (res.status >= 500) return { status: 'degraded' };
    if (!res.ok) return { status: 'offline', reason: 'UPSTREAM_ERROR' };

    const body = await readBoundedResponseBody(res, maxResponseBytes);
    if (!body.ok) return { status: 'offline', reason: body.reason };
    let payload: unknown;
    try {
      payload = JSON.parse(body.text) as unknown;
    } catch {
      return { status: 'offline', reason: 'MALFORMED_RESPONSE' };
    }
    return { status: statusFromHealthPayload(payload) };
  }
  return { status: 'offline', reason: 'TOO_MANY_REDIRECTS' };
}

export async function probeCloudTargetsHealth(
  options: ProbeCloudTargetsHealthOptions = {}
): Promise<ProbeCloudTargetsHealthResult> {
  const policy: ProbeTargetPolicy = {
    ...options.policy,
    allowedHosts: [...(options.policy?.allowedHosts ?? []), ...(options.allowedHosts ?? [])],
    allowedCidrs: options.policy?.allowedCidrs ?? options.allowedCidrs,
    allowPrivateRanges: options.policy?.allowPrivateRanges ?? options.allowPrivateRanges ?? false,
    maxRedirects: options.policy?.maxRedirects ?? options.maxRedirects,
    maxResponseBytes: options.policy?.maxResponseBytes ?? options.maxResponseBytes,
    maxTimeoutMs: options.policy?.maxTimeoutMs,
  };
  const maxTimeoutMs = Math.max(
    1,
    Math.min(MILLISECONDS_PER_MINUTE, policy.maxTimeoutMs ?? MAX_PROBE_TIMEOUT_MS)
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const maxResponseBytes = Math.max(
    64,
    Math.min(1024 * 1024, policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.adminToken ?? resolveControlPlaneToken({ jwtSecret: options.jwtSecret });

  const targets = await CloudDeploymentTarget.query()
    .where({ is_active: true, active: true })
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  const reasonCodes = new Set<ProbeFailureReason>();
  let healthy = 0;
  let degraded = 0;
  let offline = 0;
  let invalid = 0;

  for (const target of targets) {
    const startedAt = Date.now();
    let result: SingleProbeResult;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimeoutMs) {
      result = { status: 'invalid', reason: 'INVALID_TIMEOUT' };
    } else {
      try {
        const url = assertProbeTarget(
          target.api_url ?? options.defaultTargetUrl ?? DEFAULT_CONTROL_PLANE_URL,
          policy
        );
        result = await probeOneTarget(url, token, fetchImpl, policy, timeoutMs, maxResponseBytes);
      } catch (error) {
        result = {
          status: 'invalid',
          reason: error instanceof ProbeTargetError ? error.reason : 'INVALID_TARGET_URL',
        };
      }
    }

    if (result.reason) reasonCodes.add(result.reason);
    recordCloudOperation({
      operation: 'target.probe',
      outcome:
        result.status === 'healthy'
          ? 'success'
          : result.status === 'degraded'
            ? 'degraded'
            : result.status === 'invalid'
              ? 'invalid'
              : result.reason === 'TIMEOUT'
                ? 'timeout'
                : 'offline',
      provider: 'docker_agent',
      durationMs: Date.now() - startedAt,
    });

    // Invalid configuration is not proof of an unavailable dependency: keep the
    // last known health status and surface a stable reason code instead.
    if (result.status !== 'invalid' && target.health_status !== result.status) {
      await CloudDeploymentTarget.query()
        .findById(target.id)
        .patch({ health_status: result.status });
    }

    switch (result.status) {
      case 'healthy':
        healthy += 1;
        break;
      case 'degraded':
        degraded += 1;
        break;
      case 'invalid':
        invalid += 1;
        break;
      default:
        offline += 1;
        break;
    }
  }

  return {
    probed: targets.length,
    healthy,
    degraded,
    offline,
    invalid,
    reasonCodes: [...reasonCodes],
  };
}
