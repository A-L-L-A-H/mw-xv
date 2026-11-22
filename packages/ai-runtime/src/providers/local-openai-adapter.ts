import type { JsonObject, JsonValue } from '@moonwitness/types';
import { isJsonObject, isRecord } from '@moonwitness/types';
import { createRedactor } from '../redaction.js';
import { assertValidSecretRef, resolveSecretOrThrow } from '../secrets.js';
import { buildTokenUsage, estimateRequestInputTokens, estimateTokenCount } from '../usage.js';
import type {
  AiProvider,
  AiToolCall,
  FetchLike,
  ProviderCapabilities,
  ProviderFinishReason,
  ProviderHealthStatus,
  ProviderRequest,
  ProviderResponse,
  SecretResolver,
} from '../types.js';
import { ProviderError } from '../types.js';
import {
  buildUrlPath,
  DEFAULT_MAX_RESPONSE_BYTES,
  fetchWithProviderTimeout,
  parseAndValidateStructuredOutput,
  readBoundedResponseText,
  validateLoopbackEndpointUrl,
  validateRequestCapabilities,
} from './shared.js';

export interface LocalOpenAiAdapterConfig {
  readonly id?: string;
  readonly baseUrl: string | URL;
  readonly defaultModel?: string;
  readonly secretRef?: string;
  readonly secretResolver?: SecretResolver;
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly fetch?: FetchLike;
}

function mapFinishReason(raw: unknown): ProviderFinishReason {
  if (raw === 'stop') return 'stop';
  if (raw === 'length') return 'length';
  if (raw === 'tool_calls' || raw === 'function_call') return 'tool_calls';
  if (raw === 'content_filter') return 'unknown';
  return 'unknown';
}

function parseToolCalls(
  rawCalls: unknown,
  providerId: string,
  correlationId: string
): AiToolCall[] {
  if (rawCalls === undefined || rawCalls === null) return [];
  if (!Array.isArray(rawCalls)) {
    throw new ProviderError('Local OpenAI-compatible server returned non-array tool_calls', {
      code: 'malformed_response',
      providerId,
      correlationId,
      retryable: false,
    });
  }

  const calls: AiToolCall[] = [];
  for (let i = 0; i < rawCalls.length; i += 1) {
    const entry = rawCalls[i];
    if (!isRecord(entry) || !isRecord(entry.function) || typeof entry.function.name !== 'string') {
      throw new ProviderError(`Local OpenAI tool_calls[${i}] is missing function.name`, {
        code: 'malformed_response',
        providerId,
        correlationId,
        retryable: false,
      });
    }

    let parsedArgs: JsonObject = {};
    const rawArgs = entry.function.arguments;
    if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
      try {
        const decoded = JSON.parse(rawArgs) as unknown;
        if (!isJsonObject(decoded)) {
          throw new Error('arguments must decode to a JSON object');
        }
        parsedArgs = decoded;
      } catch (cause) {
        throw new ProviderError(`Local OpenAI tool_calls[${i}] has invalid JSON arguments`, {
          code: 'malformed_response',
          providerId,
          correlationId,
          retryable: false,
          cause,
        });
      }
    } else if (isJsonObject(rawArgs)) {
      parsedArgs = rawArgs;
    }

    calls.push({
      id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : `local-call-${i + 1}`,
      name: entry.function.name,
      arguments: parsedArgs,
    });
  }
  return calls;
}

/**
 * OpenAI-compatible local loopback adapter for DeepSeek / vLLM / llama.cpp / LM Studio.
 * Enforces strict loopback-only endpoint validation (zero cloud egress).
 */
export class LocalOpenAiAdapter implements AiProvider {
  readonly id: string;
  readonly kind = 'local_openai' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: URL;
  private readonly defaultModel?: string;
  private readonly secretRef?: string;
  private readonly secretResolver?: SecretResolver;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: FetchLike;

  constructor(config: LocalOpenAiAdapterConfig) {
    this.id = config.id ?? 'local-openai';
    this.baseUrl = validateLoopbackEndpointUrl(config.baseUrl, this.id, 'local-openai-init');
    this.defaultModel = config.defaultModel;
    if (config.secretRef) {
      assertValidSecretRef(config.secretRef);
      this.secretRef = config.secretRef;
      this.secretResolver = config.secretResolver;
    }
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchImpl = config.fetch ?? fetch;
    this.capabilities = {
      textGeneration: config.capabilities?.textGeneration ?? true,
      toolCall: config.capabilities?.toolCall ?? true,
      streaming: config.capabilities?.streaming ?? false,
      structuredOutput: config.capabilities?.structuredOutput ?? true,
    };
  }

  get endpointUrl(): string {
    return this.baseUrl.toString();
  }

  private async resolveAuthHeaders(correlationId: string): Promise<Record<string, string>> {
    if (!this.secretRef || !this.secretResolver) {
      return {};
    }
    const token = await resolveSecretOrThrow({
      secretRef: this.secretRef,
      secretResolver: this.secretResolver,
      providerId: this.id,
      correlationId,
    });
    return { authorization: `Bearer ${token}` };
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const correlationId = 'health-check';
    const redactor = createRedactor();
    const url = buildUrlPath(this.baseUrl, '/v1/models');
    try {
      validateLoopbackEndpointUrl(this.baseUrl, this.id, correlationId);
      const authHeaders = await this.resolveAuthHeaders(correlationId);
      const response = await fetchWithProviderTimeout({
        fetchFn: this.fetchImpl,
        url,
        init: {
          method: 'GET',
          headers: { accept: 'application/json', ...authHeaders },
        },
        timeoutMs: Math.min(this.defaultTimeoutMs, 5_000),
        callerSignal: signal,
        providerId: this.id,
        correlationId,
        redactor,
      });
      const bodyText = await readBoundedResponseText(
        response,
        this.maxResponseBytes,
        this.id,
        correlationId,
        redactor
      );
      if (!response.ok) {
        return {
          ok: false,
          providerId: this.id,
          providerKind: this.kind,
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - start),
          errorCode: response.status >= 500 ? 'outage' : 'malformed_response',
          detail: `Local OpenAI health probe failed with HTTP ${response.status}`,
        };
      }

      let models: string[] | undefined;
      try {
        const parsed = JSON.parse(bodyText) as unknown;
        if (isRecord(parsed) && Array.isArray(parsed.data)) {
          models = parsed.data
            .filter(
              (entry): entry is Record<string, unknown> =>
                isRecord(entry) && typeof entry.id === 'string'
            )
            .map((entry) => entry.id as string);
        }
      } catch {
        // tolerate empty/non-JSON health body if HTTP 200
      }

      return {
        ok: true,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - start),
        ...(models ? { models } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - start),
        errorCode: error instanceof ProviderError ? error.code : 'outage',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    validateRequestCapabilities(this.id, this.capabilities, request, false);

    // Re-validate loopback invariant on every request.
    validateLoopbackEndpointUrl(this.baseUrl, this.id, request.correlationId);

    const modelName = request.model.modelName || this.defaultModel;
    if (!modelName) {
      throw new ProviderError('Local OpenAI adapter requires a modelName', {
        code: 'policy_blocked',
        reasonCode: 'NO_ELIGIBLE_MODEL',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const redactor = createRedactor();
    const authHeaders = await this.resolveAuthHeaders(request.correlationId);

    const messages = request.messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const payload: Record<string, unknown> = {
      model: modelName,
      messages,
      stream: false,
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxOutputTokens !== undefined) {
      payload.max_tokens = request.maxOutputTokens;
    }
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    }
    if (request.responseSchema) {
      payload.response_format = {
        type: 'json_object',
      };
    }

    const url = buildUrlPath(this.baseUrl, '/v1/chat/completions');
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const start = Date.now();

    const response = await fetchWithProviderTimeout({
      fetchFn: this.fetchImpl,
      url,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      callerSignal: signal,
      providerId: this.id,
      correlationId: request.correlationId,
      redactor,
    });

    const bodyText = await readBoundedResponseText(
      response,
      this.maxResponseBytes,
      this.id,
      request.correlationId,
      redactor
    );

    if (!response.ok) {
      const safeBody = redactor.redactString(bodyText).slice(0, 500);
      throw new ProviderError(
        `Local OpenAI-compatible server returned HTTP ${response.status}: ${safeBody}`,
        {
          code: response.status >= 500 ? 'outage' : 'malformed_response',
          statusCode: response.status,
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: response.status >= 500 || response.status === 429,
        }
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(bodyText) as unknown;
    } catch (cause) {
      throw new ProviderError('Local OpenAI-compatible server returned invalid JSON', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
        cause,
      });
    }

    if (!isRecord(decoded) || !Array.isArray(decoded.choices) || decoded.choices.length === 0) {
      throw new ProviderError('Local OpenAI-compatible response missing choices[]', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const firstChoice = decoded.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
      throw new ProviderError('Local OpenAI-compatible response missing choices[0].message', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const text = typeof firstChoice.message.content === 'string' ? firstChoice.message.content : '';
    const toolCalls = parseToolCalls(
      firstChoice.message.tool_calls,
      this.id,
      request.correlationId
    );
    const finishReason = mapFinishReason(firstChoice.finish_reason);

    let structuredOutput: JsonValue | undefined;
    if (request.responseSchema) {
      structuredOutput = parseAndValidateStructuredOutput(
        text,
        request.responseSchema,
        this.id,
        request.correlationId
      );
    }

    const usageRaw = isRecord(decoded.usage) ? decoded.usage : undefined;
    const promptTokens =
      typeof usageRaw?.prompt_tokens === 'number'
        ? usageRaw.prompt_tokens
        : estimateRequestInputTokens(request);
    const completionTokens =
      typeof usageRaw?.completion_tokens === 'number'
        ? usageRaw.completion_tokens
        : estimateTokenCount(text);
    const usageSource =
      typeof usageRaw?.prompt_tokens === 'number' && typeof usageRaw?.completion_tokens === 'number'
        ? 'provider_reported'
        : 'estimated';

    const usage = buildTokenUsage({
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      source: usageSource,
      pricing: request.model.pricing,
    });

    return {
      providerId: this.id,
      providerKind: this.kind,
      modelName,
      correlationId: request.correlationId,
      text,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      toolCalls,
      finishReason,
      usage,
      latencyMs: Math.max(0, Date.now() - start),
      rawRedactedMeta: {
        endpoint: this.baseUrl.origin,
        ...(typeof decoded.id === 'string' ? { responseId: decoded.id } : {}),
      },
    };
  }
}
