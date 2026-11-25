import { isPrivateMeshIp as isSharedPrivateMeshIp } from '@moonwitness/types';
import { controlPlaneAuthHeaders, resolveControlPlaneToken } from '../auth.js';
import {
  evaluateTenantPaasQuota,
  PaasQuotaExceededError,
  type TenantPaasQuotaInput,
} from '../quota.js';

export type MeshPaasAppAction = 'start' | 'restart' | 'stop' | 'redeploy' | 'delete' | 'logs';

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
  readonly volumes?: readonly string[];
  readonly memoryLimit?: string;
  readonly cpuLimit?: string;
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
  readonly url?: string;
  readonly port?: number;
  readonly tenant?: string;
  readonly volumes?: readonly string[];
  readonly memoryLimit?: string;
  readonly cpuLimit?: string;
  readonly containerState?: string;
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
  readonly deploymentId?: string;
  readonly logs?: string;
  readonly message: string;
}

export interface UpdateMeshPaasAppEnvParams extends MeshProviderBaseParams {
  readonly appIdOrSlug: string;
  readonly env: Readonly<Record<string, string>>;
  readonly merge?: boolean;
}

export interface UpdateMeshPaasAppEnvResult {
  readonly ok: boolean;
  readonly appIdOrSlug: string;
  readonly slug: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly message: string;
}

export interface UpdateMeshPaasAppDomainParams extends MeshProviderBaseParams {
  readonly appIdOrSlug: string;
  readonly domain: string;
  readonly port?: number;
}

export interface UpdateMeshPaasAppDomainResult {
  readonly ok: boolean;
  readonly appIdOrSlug: string;
  readonly slug: string;
  readonly domain: string;
  readonly port?: number;
  readonly url?: string;
  readonly message: string;
}

export interface MeshPaasTemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly description?: string;
  readonly image: string;
  readonly defaultPort: number;
  readonly defaultEnv?: Readonly<Record<string, string>>;
  readonly requiredEnvKeys?: readonly string[];
}

export interface MoonWitnessMeshComposeDeployParams extends MeshProviderBaseParams {
  readonly slug: string;
  readonly composeSpec: string;
  readonly primaryService: string;
  readonly port: number;
  readonly domain?: string;
  readonly tenant?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ListMeshPaasAppDeploymentsParams extends MeshProviderBaseParams {
  readonly appIdOrSlug: string;
}

export interface MeshPaasDeploymentRecord {
  readonly id: string;
  readonly slug: string;
  readonly action: string;
  readonly image?: string;
  readonly status: string;
  readonly message?: string;
  readonly createdAt: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function isPrivateMeshIp(rawHost: string): boolean {
  return isSharedPrivateMeshIp(rawHost, { allowLoopback: true });
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

interface MeshRequestOptions {
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly errorPrefix: string;
  readonly secrets?: readonly (string | undefined)[];
}

interface MeshRequestResult<T> {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly secrets: readonly (string | undefined)[];
  readonly payload: T;
}

async function requestMeshJson<T>(
  params: MeshProviderBaseParams,
  options: MeshRequestOptions
): Promise<MeshRequestResult<T>> {
  const baseUrl = buildBaseUrl(params.endpoint);
  const token = resolveAuthToken(params.token);
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const secrets = [token, ...(options.secrets ?? [])];
  const hasBody = options.body !== undefined;
  const needsJsonContentType = hasBody || options.method === 'POST' || options.method === 'PUT';

  const response = await fetchImpl(`${baseUrl}${options.path}`, {
    method: options.method,
    headers: controlPlaneAuthHeaders(
      token,
      needsJsonContentType ? { 'content-type': 'application/json' } : undefined
    ),
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorSummary(response, secrets);
    throw new Error(`${options.errorPrefix} (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as T;
  return { baseUrl, token, secrets, payload };
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

  const { payload, secrets } = await requestMeshJson<{
    appId?: string;
    id?: string;
    slug?: string;
    status?: string;
    url?: string;
    deploymentId?: string;
    message?: string;
  }>(params, {
    path: '/paas/apps',
    method: 'POST',
    errorPrefix: 'MoonWitness Mesh deploy failed',
    secrets: Object.values(params.env ?? {}),
    body: {
      slug: params.slug,
      image: params.image,
      domain: params.domain,
      port: params.port,
      tenant: params.tenant,
      env: params.env,
      ...(params.volumes !== undefined ? { volumes: params.volumes } : {}),
      ...(params.memoryLimit !== undefined ? { memoryLimit: params.memoryLimit } : {}),
      ...(params.cpuLimit !== undefined ? { cpuLimit: params.cpuLimit } : {}),
    },
  });

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
  const { payload } = await requestMeshJson<{ apps?: MeshPaasAppSummary[] } | MeshPaasAppSummary[]>(
    params,
    {
      path: '/paas/apps',
      method: 'GET',
      errorPrefix: 'MoonWitness Mesh list apps failed',
    }
  );

  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload.apps) ? payload.apps : [];
}

export async function fetchMeshNodeMetrics(
  params: MeshProviderBaseParams
): Promise<MeshNodeMetrics> {
  const { baseUrl, payload } = await requestMeshJson<Partial<MeshNodeMetrics>>(params, {
    path: '/paas/metrics',
    method: 'GET',
    errorPrefix: 'MoonWitness Mesh metrics failed',
  });

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
  const encodedId = encodeURIComponent(params.appIdOrSlug);

  let path: string;
  let method: 'POST' | 'DELETE' | 'GET';

  if (params.action === 'delete') {
    path = `/paas/apps/${encodedId}`;
    method = 'DELETE';
  } else if (params.action === 'logs') {
    path = `/paas/apps/${encodedId}/logs`;
    method = 'GET';
  } else {
    path = `/paas/apps/${encodedId}/${params.action}`;
    method = 'POST';
  }

  const { payload, secrets } = await requestMeshJson<{
    ok?: boolean;
    status?: string;
    deploymentId?: string;
    logs?: string;
    message?: string;
  }>(params, {
    path,
    method,
    errorPrefix: `MoonWitness Mesh app ${params.action} failed`,
  });

  return {
    ok: payload.ok ?? true,
    appIdOrSlug: params.appIdOrSlug,
    action: params.action,
    status: payload.status,
    ...(typeof payload.deploymentId === 'string' ? { deploymentId: payload.deploymentId } : {}),
    logs: typeof payload.logs === 'string' ? redactMeshSecrets(payload.logs, secrets) : undefined,
    message: redactMeshSecrets(payload.message ?? `App ${params.action} completed`, secrets),
  };
}

export async function updateMeshPaasAppEnv(
  params: UpdateMeshPaasAppEnvParams
): Promise<UpdateMeshPaasAppEnvResult> {
  const encodedId = encodeURIComponent(params.appIdOrSlug);
  const { payload, secrets } = await requestMeshJson<{
    ok?: boolean;
    slug?: string;
    env?: Record<string, string>;
    message?: string;
  }>(params, {
    path: `/paas/apps/${encodedId}/env`,
    method: 'PUT',
    errorPrefix: 'MoonWitness Mesh update env failed',
    secrets: Object.values(params.env),
    body: {
      env: params.env,
      ...(params.merge !== undefined ? { merge: params.merge } : {}),
    },
  });

  return {
    ok: payload.ok ?? true,
    appIdOrSlug: params.appIdOrSlug,
    slug: payload.slug ?? params.appIdOrSlug,
    ...(payload.env !== undefined ? { env: payload.env } : {}),
    message: redactMeshSecrets(payload.message ?? 'Environment updated', secrets),
  };
}

export async function updateMeshPaasAppDomain(
  params: UpdateMeshPaasAppDomainParams
): Promise<UpdateMeshPaasAppDomainResult> {
  const encodedId = encodeURIComponent(params.appIdOrSlug);
  const { payload, secrets } = await requestMeshJson<{
    ok?: boolean;
    slug?: string;
    domain?: string;
    port?: number;
    url?: string;
    message?: string;
  }>(params, {
    path: `/paas/apps/${encodedId}/domain`,
    method: 'PUT',
    errorPrefix: 'MoonWitness Mesh update domain failed',
    body: {
      domain: params.domain,
      ...(params.port !== undefined ? { port: params.port } : {}),
    },
  });

  const domain = payload.domain ?? params.domain;
  return {
    ok: payload.ok ?? true,
    appIdOrSlug: params.appIdOrSlug,
    slug: payload.slug ?? params.appIdOrSlug,
    domain,
    ...(payload.port !== undefined
      ? { port: payload.port }
      : params.port !== undefined
        ? { port: params.port }
        : {}),
    ...(payload.url !== undefined
      ? { url: payload.url }
      : domain
        ? { url: `https://${domain}` }
        : {}),
    message: redactMeshSecrets(payload.message ?? 'Domain updated', secrets),
  };
}

export async function listMeshPaasTemplates(
  params: MeshProviderBaseParams
): Promise<readonly MeshPaasTemplateSummary[]> {
  const { payload } = await requestMeshJson<
    { templates?: MeshPaasTemplateSummary[] } | MeshPaasTemplateSummary[]
  >(params, {
    path: '/paas/templates',
    method: 'GET',
    errorPrefix: 'MoonWitness Mesh list templates failed',
  });

  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload.templates) ? payload.templates : [];
}

export async function deployComposeViaMoonWitnessMesh(
  params: MoonWitnessMeshComposeDeployParams
): Promise<MoonWitnessMeshDeployResult> {
  const { payload, secrets } = await requestMeshJson<{
    appId?: string;
    id?: string;
    slug?: string;
    status?: string;
    url?: string;
    deploymentId?: string;
    message?: string;
  }>(params, {
    path: '/paas/apps/deploy-compose',
    method: 'POST',
    errorPrefix: 'MoonWitness Mesh compose deploy failed',
    secrets: Object.values(params.env ?? {}),
    body: {
      slug: params.slug,
      composeSpec: params.composeSpec,
      primaryService: params.primaryService,
      port: params.port,
      domain: params.domain,
      tenant: params.tenant,
      env: params.env,
    },
  });

  return {
    appId: payload.appId ?? payload.id ?? params.slug,
    slug: payload.slug ?? params.slug,
    status: payload.status ?? 'running',
    url: payload.url,
    deploymentId: payload.deploymentId,
    message: redactMeshSecrets(payload.message ?? 'Compose deployment triggered', secrets),
  };
}

export async function listMeshPaasAppDeployments(
  params: ListMeshPaasAppDeploymentsParams
): Promise<readonly MeshPaasDeploymentRecord[]> {
  const encodedId = encodeURIComponent(params.appIdOrSlug);
  const { payload, secrets } = await requestMeshJson<
    { deployments?: MeshPaasDeploymentRecord[] } | MeshPaasDeploymentRecord[]
  >(params, {
    path: `/paas/apps/${encodedId}/deployments`,
    method: 'GET',
    errorPrefix: 'MoonWitness Mesh list deployments failed',
  });

  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.deployments)
      ? payload.deployments
      : [];

  return records.map((record) => ({
    ...record,
    ...(typeof record.message === 'string'
      ? { message: redactMeshSecrets(record.message, secrets) }
      : {}),
  }));
}
