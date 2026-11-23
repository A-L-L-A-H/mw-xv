import { isIP } from 'node:net';
import { controlPlaneAuthHeaders, resolveControlPlaneToken } from '../auth.js';
import {
  evaluateTenantPaasQuota,
  PaasQuotaExceededError,
  type TenantPaasQuotaInput,
} from '../quota.js';

export type MeshPaasAppAction = 'restart' | 'stop' | 'delete' | 'logs';

export interface MeshProviderBaseParams {
  readonly endpoint: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface MoonWitnessMeshDeployParams extends MeshProviderBaseParams {
  readonly slug: string;
  readonly image: string;
  readonly domain?: string;
  readonly port?: number;
  readonly tenant?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly quotaCheck?: TenantPaasQuotaInput;
}

export interface MoonWitnessMeshDeployResult {
  readonly appId: string;
  readonly slug: string;
  readonly status: string;
  readonly url?: string;
  readonly deploymentId?: string;
  readonly message: string;
}

export interface MeshPaasAppSummary {
  readonly id: string;
  readonly slug: string;
  readonly image: string;
  readonly status: string;
  readonly domain?: string;
  readonly port?: number;
  readonly tenant?: string;
  readonly updatedAt?: string;
}

export interface MeshNodeMetrics {
  readonly nodeId: string;
  readonly meshIp: string;
  readonly cpuPercent: number;
  readonly memoryUsedMb: number;
  readonly memoryTotalMb: number;
  readonly memoryPercent: number;
  readonly runningApps: number;
  readonly uptimeSeconds?: number;
}

export interface ControlMeshPaasAppParams extends MeshProviderBaseParams {
  readonly appIdOrSlug: string;
  readonly action: MeshPaasAppAction;
}

export interface ControlMeshPaasAppResult {
  readonly ok: boolean;
  readonly appIdOrSlug: string;
  readonly action: MeshPaasAppAction;
  readonly status?: string;
  readonly logs?: string;
  readonly message: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function isPrivateMeshIp(rawHost: string): boolean {
  const host = stripIpv6Brackets(rawHost.trim()).toLowerCase();
  const ipVersion = isIP(host);

  if (ipVersion === 4) {
    const octets = host.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (host === '127.0.0.1') return true;
    return false;
  }

  if (ipVersion === 6) {
    // fd00::/8 unique local addresses
    if (host.startsWith('fd')) {
      const firstHextet = host.split(':')[0] ?? '';
      return /^[0-9a-f]{4}$/u.test(firstHextet) && firstHextet.startsWith('fd');
    }
    return false;
  }

  return false;
}

export function assertPrivateMeshEndpoint(endpoint: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Invalid MoonWitness Mesh endpoint URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported MoonWitness Mesh protocol: ${parsed.protocol}`);
  }

  if (!isPrivateMeshIp(parsed.hostname)) {
    throw new Error(
      `SSRF blocked: MoonWitness Mesh endpoint host "${parsed.hostname}" is not an allowed private mesh IP`
    );
  }

  return parsed;
}

export function redactMeshSecrets(
  input: string,
  secrets: readonly (string | undefined)[] = []
): string {
  let output = input;

  for (const secret of secrets) {
    if (secret && secret.trim().length > 0) {
      output = output.split(secret).join('[REDACTED]');
    }
  }

  output = output.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[REDACTED]');
  output = output.replace(
    /((?:token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*["']?)[^\s"',;}{]+/giu,
    '$1[REDACTED]'
  );

  return output;
}

function buildBaseUrl(endpoint: string): string {
  const parsed = assertPrivateMeshEndpoint(endpoint);
  return parsed.toString().replace(/\/+$/u, '');
}

function resolveAuthToken(token?: string): string | undefined {
  if (token && token.trim().length > 0) {
    return token.trim();
  }
  return resolveControlPlaneToken();
}

async function readErrorSummary(
  response: Response,
  secrets: readonly (string | undefined)[]
): Promise<string> {
  try {
    const raw = await response.text();
    if (!raw.trim()) return `HTTP ${response.status}`;
    return redactMeshSecrets(raw.slice(0, 300), secrets);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function deployViaMoonWitnessMesh(
  params: MoonWitnessMeshDeployParams
): Promise<MoonWitnessMeshDeployResult> {
  if (params.quotaCheck) {
    const decision = evaluateTenantPaasQuota(params.quotaCheck);
    if (!decision.allowed) {
      throw new PaasQuotaExceededError(decision);
    }
  }

  const baseUrl = buildBaseUrl(params.endpoint);
  const token = resolveAuthToken(params.token);
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const secrets = [token, ...Object.values(params.env ?? {})];

  const response = await fetchImpl(`${baseUrl}/paas/apps`, {
    method: 'POST',
    headers: controlPlaneAuthHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      slug: params.slug,
      image: params.image,
      domain: params.domain,
      port: params.port,
      tenant: params.tenant,
      env: params.env,
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorSummary(response, secrets);
    throw new Error(`MoonWitness Mesh deploy failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    appId?: string;
    id?: string;
    slug?: string;
    status?: string;
    url?: string;
    deploymentId?: string;
    message?: string;
  };

  return {
    appId: payload.appId ?? payload.id ?? params.slug,
    slug: payload.slug ?? params.slug,
    status: payload.status ?? 'deploying',
    url: payload.url,
    deploymentId: payload.deploymentId,
    message: redactMeshSecrets(payload.message ?? 'Deployment triggered', secrets),
  };
}

export async function listMeshPaasApps(
  params: MeshProviderBaseParams
): Promise<readonly MeshPaasAppSummary[]> {
  const baseUrl = buildBaseUrl(params.endpoint);
  const token = resolveAuthToken(params.token);
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;

  const response = await fetchImpl(`${baseUrl}/paas/apps`, {
    method: 'GET',
    headers: controlPlaneAuthHeaders(token),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorSummary(response, [token]);
    throw new Error(`MoonWitness Mesh list apps failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as { apps?: MeshPaasAppSummary[] } | MeshPaasAppSummary[];

  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload.apps) ? payload.apps : [];
}

export async function fetchMeshNodeMetrics(
  params: MeshProviderBaseParams
): Promise<MeshNodeMetrics> {
  const baseUrl = buildBaseUrl(params.endpoint);
  const token = resolveAuthToken(params.token);
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;

  const response = await fetchImpl(`${baseUrl}/paas/metrics`, {
    method: 'GET',
    headers: controlPlaneAuthHeaders(token),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorSummary(response, [token]);
    throw new Error(`MoonWitness Mesh metrics failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as Partial<MeshNodeMetrics>;
  const memoryUsedMb = typeof payload.memoryUsedMb === 'number' ? payload.memoryUsedMb : 0;
  const memoryTotalMb = typeof payload.memoryTotalMb === 'number' ? payload.memoryTotalMb : 0;
  const memoryPercent =
    typeof payload.memoryPercent === 'number'
      ? payload.memoryPercent
      : memoryTotalMb > 0
        ? Math.round((memoryUsedMb / memoryTotalMb) * 100)
        : 0;

  return {
    nodeId: payload.nodeId ?? 'mesh-node',
    meshIp: payload.meshIp ?? new URL(baseUrl).hostname,
    cpuPercent: typeof payload.cpuPercent === 'number' ? payload.cpuPercent : 0,
    memoryUsedMb,
    memoryTotalMb,
    memoryPercent,
    runningApps: typeof payload.runningApps === 'number' ? payload.runningApps : 0,
    uptimeSeconds: typeof payload.uptimeSeconds === 'number' ? payload.uptimeSeconds : undefined,
  };
}

export async function controlMeshPaasApp(
  params: ControlMeshPaasAppParams
): Promise<ControlMeshPaasAppResult> {
  const baseUrl = buildBaseUrl(params.endpoint);
  const token = resolveAuthToken(params.token);
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const encodedId = encodeURIComponent(params.appIdOrSlug);

  let url: string;
  let method: 'POST' | 'DELETE' | 'GET';

  if (params.action === 'delete') {
    url = `${baseUrl}/paas/apps/${encodedId}`;
    method = 'DELETE';
  } else if (params.action === 'logs') {
    url = `${baseUrl}/paas/apps/${encodedId}/logs`;
    method = 'GET';
  } else {
    url = `${baseUrl}/paas/apps/${encodedId}/${params.action}`;
    method = 'POST';
  }

  const response = await fetchImpl(url, {
    method,
    headers: controlPlaneAuthHeaders(
      token,
      method === 'POST' ? { 'content-type': 'application/json' } : undefined
    ),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorSummary(response, [token]);
    throw new Error(`MoonWitness Mesh app ${params.action} failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    status?: string;
    logs?: string;
    message?: string;
  };

  return {
    ok: payload.ok ?? true,
    appIdOrSlug: params.appIdOrSlug,
    action: params.action,
    status: payload.status,
    logs: typeof payload.logs === 'string' ? redactMeshSecrets(payload.logs, [token]) : undefined,
    message: redactMeshSecrets(payload.message ?? `App ${params.action} completed`, [token]),
  };
}
