import { isRecord } from '@moonwitness/types';
import { isLoopbackEndpointUrl } from '@moonwitness/types';

export type LocalAiMode = 'disabled' | 'local';
export type LocalAiProvider = 'simple-v1' | 'ollama' | 'openai-compat';
export {
  LocalRetrievalError,
  retrieveDynamicLocalPassageChunk,
  retrieveLocalPassageChunk,
  searchLocalPassagesHybrid,
  type ApprovedManifestCatalogEntry,
  type CanonicalPassageReference,
  type HybridPassageCandidate,
  type HybridPassageQuery,
  type HybridPassageSearchResult,
  type LocalPassageChunk,
  type LocalPassageResolver,
  type ResolvedCanonicalPassage,
  type RetrievalVisibility,
  type RetrieveLocalPassageRequest,
} from './retrieval.js';
export {
  evaluateLocalModelHardwareCompatibility,
  isLocalModelRegistry,
  verifyLocalModelArtifact,
  type HardwareCompatibilityProfile,
  type HardwareCompatibilityReason,
  type HardwareCompatibilityResult,
  type LocalModelArtifact,
  type LocalModelRegistry,
  type ModelArtifactVerification,
} from './models.js';
export {
  generateLocalAiSuggestion,
  SUGGESTION_ENVELOPE_JSON_SCHEMA,
  type LocalAiSuggestionKind,
  type LocalAiSuggestionRequest,
  type LocalAiSuggestionPassage,
  type LocalAiSuggestionResult,
  type SuggestionCandidateValidator,
} from './suggestion-generation.js';
export {
  createMultiProviderLlmRouter,
  estimatePromptTokens,
  isLoopbackEndpointUrl,
  ProviderRouterError,
  type BudgetCeilingConfig,
  type BudgetUsageSnapshot,
  type CircuitBreakerConfig,
  type MultiProviderLlmRouter,
  type PrivacyTier,
  type ProviderExecutionResult,
  type ProviderExecutor,
  type ProviderHealthSnapshot,
  type ProviderLocality,
  type ProviderRouteRequest,
  type ProviderRouteResponse,
  type ProviderRouterConfig,
  type RouterProviderConfig,
  type RouterProviderKind,
} from './provider-router.js';

export interface LocalAiConfig {
  mode: LocalAiMode;
  endpoint?: URL;
  timeoutMs: number;
  provider?: LocalAiProvider;
  model?: string;
}

export type { LocalAiRequest, LocalAiResult, LocalAiRuntime } from './runtime.types.js';
import type { LocalAiRequest, LocalAiRuntime } from './runtime.types.js';

export type LocalAiFetch = typeof fetch;

const ALLOWED_PROVIDERS = new Set<LocalAiProvider>(['simple-v1', 'ollama', 'openai-compat']);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_RESPONSE_LENGTH = 100_000;

export function readLocalAiConfig(
  environment: Readonly<Record<string, string | undefined>>
): LocalAiConfig {
  const modeValue = environment.AI_MODE ?? 'disabled';
  if (modeValue !== 'disabled' && modeValue !== 'local') {
    throw new TypeError('AI_MODE must be disabled or local');
  }
  const timeoutText = environment.LOCAL_AI_TIMEOUT_MS;
  const timeoutMs = timeoutText === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutText);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`LOCAL_AI_TIMEOUT_MS must be an integer from 100 to ${MAX_TIMEOUT_MS}`);
  }

  let provider: LocalAiProvider | undefined;
  const providerValue = environment.LOCAL_AI_PROVIDER;
  if (providerValue !== undefined && providerValue !== '') {
    if (!ALLOWED_PROVIDERS.has(providerValue as LocalAiProvider)) {
      throw new TypeError('LOCAL_AI_PROVIDER must be simple-v1, ollama, or openai-compat');
    }
    provider = providerValue as LocalAiProvider;
  }

  const rawModel = environment.LOCAL_AI_MODEL;
  const model = rawModel !== undefined && rawModel.trim().length > 0 ? rawModel.trim() : undefined;

  if (modeValue === 'disabled') {
    return {
      mode: 'disabled',
      timeoutMs,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    };
  }

  const endpointText = environment.LOCAL_AI_ENDPOINT;
  if (!endpointText) throw new TypeError('LOCAL_AI_ENDPOINT is required when AI_MODE=local');
  let endpoint: URL;
  try {
    endpoint = new URL(endpointText);
  } catch (error) {
    throw new TypeError('LOCAL_AI_ENDPOINT must be a valid loopback URL', { cause: error });
  }
  if (!isLoopbackEndpointUrl(endpoint.toString())) {
    throw new TypeError('LOCAL_AI_ENDPOINT must use HTTP on localhost, 127.0.0.1, or ::1 only');
  }
  return {
    mode: 'local',
    endpoint,
    timeoutMs,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}

function extractProviderText(provider: LocalAiProvider, body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (provider === 'ollama') {
    if (typeof body.response === 'string') return body.response;
    if (typeof body.text === 'string') return body.text;
    return undefined;
  }
  if (provider === 'openai-compat') {
    if (Array.isArray(body.choices) && body.choices.length > 0) {
      const first = body.choices[0];
      if (isRecord(first) && isRecord(first.message) && typeof first.message.content === 'string') {
        return first.message.content;
      }
    }
    if (typeof body.text === 'string') return body.text;
    return undefined;
  }
  return typeof body.text === 'string' ? body.text : undefined;
}

function buildProviderRequest(
  provider: LocalAiProvider,
  config: LocalAiConfig,
  request: LocalAiRequest
): { url: URL; payload: Record<string, unknown> } {
  if (provider === 'ollama') {
    return {
      url: new URL('/api/generate', config.endpoint),
      payload: {
        model: config.model ?? 'qwen2.5:3b-instruct-q4_K_M',
        prompt: request.prompt,
        stream: false,
        options: { temperature: 0 },
        format: request.jsonSchema ?? 'json',
      },
    };
  }
  if (provider === 'openai-compat') {
    return {
      url: new URL('/v1/chat/completions', config.endpoint),
      payload: {
        model: config.model ?? 'local-model',
        temperature: 0,
        messages: [{ role: 'user', content: request.prompt }],
        response_format: request.jsonSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: 'mw_local_ai_envelope',
                strict: true,
                schema: request.jsonSchema,
              },
            }
          : { type: 'json_object' },
      },
    };
  }
  return {
    url: new URL('/v1/generate', config.endpoint),
    payload: {
      prompt: request.prompt,
      ...(request.jsonSchema ? { json_schema: request.jsonSchema } : {}),
    },
  };
}

export function createLocalAiRuntime(
  config: LocalAiConfig,
  fetchProvider: LocalAiFetch = globalThis.fetch
): LocalAiRuntime {
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new TypeError(`timeoutMs must be an integer from 100 to ${MAX_TIMEOUT_MS}`);
  }
  if (config.mode === 'local' && (!config.endpoint || !isLoopbackEndpointUrl(config.endpoint.toString()))) {
    throw new TypeError('local AI runtime accepts loopback endpoints only');
  }
  if (config.mode !== 'disabled' && config.mode !== 'local') {
    throw new TypeError('local AI mode is invalid');
  }
  const provider: LocalAiProvider = config.provider ?? 'simple-v1';
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new TypeError('local AI provider is invalid');
  }

  return {
    async generate(request) {
      if (config.mode === 'disabled') return { status: 'disabled' };
      if (
        typeof request.prompt !== 'string' ||
        request.prompt.trim().length === 0 ||
        request.prompt.length > MAX_PROMPT_LENGTH
      ) {
        throw new TypeError(`prompt must contain 1-${MAX_PROMPT_LENGTH} characters`);
      }
      try {
        const { url, payload } = buildProviderRequest(provider, config, request);
        const response = await fetchProvider(url, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
          redirect: 'error',
        });
        if (!response.ok) return { status: 'unavailable', reason: 'provider_unreachable' };
        let body: unknown;
        if (typeof response.text === 'function') {
          const rawBody = await response.text();
          try {
            body = JSON.parse(rawBody) as unknown;
          } catch {
            return { status: 'unavailable', reason: 'invalid_response' };
          }
        } else {
          try {
            body = (await response.json()) as unknown;
          } catch {
            return { status: 'unavailable', reason: 'invalid_response' };
          }
        }
        const text = extractProviderText(provider, body);
        if (text === undefined || text.length > MAX_RESPONSE_LENGTH) {
          return { status: 'unavailable', reason: 'invalid_response' };
        }
        return { status: 'generated', text };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          return { status: 'unavailable', reason: 'timeout' };
        }
        return { status: 'unavailable', reason: 'provider_unreachable' };
      }
    },
  };
}
