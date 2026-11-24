import { DEFAULT_OLLAMA_URL } from '@moonwitness/types';

export type LocalAiProviderKind = 'ollama' | 'lmstudio' | 'vllm';

export interface LocalAiProviderTarget {
  id: string;
  name: string;
  kind: LocalAiProviderKind;
  endpoint: string;
}

export interface LocalAiDiscoveredModel {
  id: string;
  providerId: string;
  providerName: string;
  providerKind: LocalAiProviderKind;
  endpoint: string;
  sizeBytes?: number;
  family?: string;
}

export interface LocalAiProviderProbeResult {
  id: string;
  name: string;
  kind: LocalAiProviderKind;
  endpoint: string;
  online: boolean;
  latencyMs: number;
  models: LocalAiDiscoveredModel[];
  error?: string;
}

export interface DiscoverLocalAiOptions {
  providers?: readonly LocalAiProviderTarget[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LocalAiDiscoveryResult {
  onlineCount: number;
  providers: LocalAiProviderProbeResult[];
  models: LocalAiDiscoveredModel[];
  recommendedWorkspaceModel: string | null;
  recommendedDevModel: string | null;
}

export const DEFAULT_LOCAL_AI_TIMEOUT_MS = 800;

export const DEFAULT_LOCAL_AI_PROVIDERS: readonly LocalAiProviderTarget[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    endpoint: `${DEFAULT_OLLAMA_URL}/api/tags`,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'lmstudio',
    endpoint: 'http://127.0.0.1:1234/v1/models',
  },
  {
    id: 'vllm',
    name: 'vLLM / OpenAI-Compatible',
    kind: 'vllm',
    endpoint: 'http://127.0.0.1:8000/v1/models',
  },
];

const DEV_MODEL_PATTERN = /coder|code|deepseek|starcoder|codellama|devstral|qwen.*coder/iu;

function isValidLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts[0] !== '127') {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return false;
    }
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

export function isLoopbackEndpointUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]') {
    return true;
  }

  return isValidLoopbackIpv4(host);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOllamaModels(
  payload: unknown,
  provider: LocalAiProviderTarget
): LocalAiDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return [];
  }

  const discovered: LocalAiDiscoveredModel[] = [];
  for (const entry of payload.models) {
    if (!isRecord(entry)) {
      continue;
    }
    const id =
      typeof entry.name === 'string' && entry.name.trim().length > 0
        ? entry.name.trim()
        : typeof entry.model === 'string' && entry.model.trim().length > 0
          ? entry.model.trim()
          : null;
    if (!id) {
      continue;
    }
    const sizeBytes =
      typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : undefined;
    const family =
      isRecord(entry.details) && typeof entry.details.family === 'string'
        ? entry.details.family
        : undefined;

    discovered.push({
      id,
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      endpoint: provider.endpoint,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(family !== undefined ? { family } : {}),
    });
  }
  return discovered;
}

function parseOpenAiCompatModels(
  payload: unknown,
  provider: LocalAiProviderTarget
): LocalAiDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  const discovered: LocalAiDiscoveredModel[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : null;
    if (!id) {
      continue;
    }
    discovered.push({
      id,
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      endpoint: provider.endpoint,
    });
  }
  return discovered;
}

async function probeLocalAiProvider(
  provider: LocalAiProviderTarget,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<LocalAiProviderProbeResult> {
  if (!isLoopbackEndpointUrl(provider.endpoint)) {
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      endpoint: provider.endpoint,
      online: false,
      latencyMs: 0,
      models: [],
      error: 'Rejected non-loopback endpoint URL',
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(provider.endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        endpoint: provider.endpoint,
        online: false,
        latencyMs,
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    const payload: unknown = await response.json();
    const models =
      provider.kind === 'ollama'
        ? parseOllamaModels(payload, provider)
        : parseOpenAiCompatModels(payload, provider);

    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      endpoint: provider.endpoint,
      online: true,
      latencyMs,
      models,
    };
  } catch (err: unknown) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown probe error';
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      endpoint: provider.endpoint,
      online: false,
      latencyMs,
      models: [],
      error: message,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function selectRecommendedModels(models: readonly LocalAiDiscoveredModel[]): {
  recommendedWorkspaceModel: string | null;
  recommendedDevModel: string | null;
} {
  if (models.length === 0) {
    return {
      recommendedWorkspaceModel: null,
      recommendedDevModel: null,
    };
  }

  const devMatch = models.find((model) => DEV_MODEL_PATTERN.test(model.id));
  const workspaceMatch = models.find((model) => !DEV_MODEL_PATTERN.test(model.id));

  const recommendedDevModel = devMatch?.id ?? models[0]?.id ?? null;
  const recommendedWorkspaceModel = workspaceMatch?.id ?? models[0]?.id ?? null;

  return {
    recommendedWorkspaceModel,
    recommendedDevModel,
  };
}

export async function discoverLocalAiProviders(
  options: DiscoverLocalAiOptions = {}
): Promise<LocalAiDiscoveryResult> {
  const providers = options.providers ?? DEFAULT_LOCAL_AI_PROVIDERS;
  const timeoutMs =
    typeof options.timeoutMs === 'number' &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_LOCAL_AI_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const results = await Promise.all(
    providers.map((provider) => probeLocalAiProvider(provider, timeoutMs, fetchImpl))
  );

  const onlineCount = results.filter((provider) => provider.online).length;
  const models = results.flatMap((provider) => provider.models);
  const { recommendedWorkspaceModel, recommendedDevModel } = selectRecommendedModels(models);

  return {
    onlineCount,
    providers: results,
    models,
    recommendedWorkspaceModel,
    recommendedDevModel,
  };
}
