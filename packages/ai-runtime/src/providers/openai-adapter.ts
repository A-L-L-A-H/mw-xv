import type { JsonObject, JsonValue } from '@moonwitness/types';
import { isJsonObject, isRecord } from '@moonwitness/types';
import { createRedactor, type RedactionContext } from '../redaction.js';
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
  assertPublicDnsResolution,
  buildUrlPath,
  DEFAULT_MAX_RESPONSE_BYTES,
  fetchWithProviderTimeout,
  isLoopbackHostname,
  matchesApprovedPrivateOrigin,
  parseAndValidateStructuredOutput,
  parseRetryAfterHeaderMs,
  readBoundedResponseText,
  runWithProviderAttempt,
  validateCloudOrEndpointUrl,
  validateRequestCapabilities,
} from './shared.js';

export interface OpenAiAdapterConfig {
  readonly id?: string;
  readonly baseUrl?: string | URL;
  readonly allowLoopbackHttp?: boolean;
  /** Exact private origins permitted for an internal inference gateway. */
  readonly approvedPrivateOrigins?: readonly string[];
  readonly secretRef: string;
  readonly secretResolver: SecretResolver;
  readonly organizationId?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly fetch?: FetchLike;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
}

function mapOpenAiError(
  status: number,
  bodyText: string,
  headers: Headers,
  providerId: string,
  correlationId: string,
  redactor: RedactionContext
): ProviderError {
  let errorCode: string | undefined;
  let errorType: string | undefined;
  let errorMessage = redactor.redactString(bodyText).slice(0, 500);

  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error)) {
      if (typeof parsed.error.code === 'string') errorCode = parsed.error.code;
      if (typeof parsed.error.type === 'string') errorType = parsed.error.type;
      if (typeof parsed.error.message === 'string') {
        errorMessage = redactor.redactString(parsed.error.message);
      }
    }
  } catch {
    // non-json error body
  }

  if (status === 401 || status === 403) {
    return new ProviderError(`OpenAI authentication failed (${status}): ${errorMessage}`, {
      code: 'auth_failed',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  if (
    status === 402 ||
    (status === 429 && (errorCode === 'insufficient_quota' || errorType === 'insufficient_quota'))
  ) {
    return new ProviderError(`OpenAI quota exceeded (${status}): ${errorMessage}`, {
      code: 'quota_exceeded',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  if (status === 429) {
    return new ProviderError(`OpenAI rate limited (${status}): ${errorMessage}`, {
      code: 'rate_limited',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
      retryAfterMs: parseRetryAfterHeaderMs(headers),
    });
  }

  if (status === 408) {
    return new ProviderError(`OpenAI request timed out (${status}): ${errorMessage}`, {
      code: 'timeout',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
    });
  }

  if (status === 400 || status === 404 || status === 422) {
    if (errorCode === 'content_filter' || errorType === 'policy_violation') {
      return new ProviderError(`OpenAI policy blocked request (${status}): ${errorMessage}`, {
        code: 'policy_blocked',
        statusCode: status,
        providerId,
        correlationId,
        retryable: false,
      });
    }
    return new ProviderError(`OpenAI rejected request (${status}): ${errorMessage}`, {
      code: 'malformed_response',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  return new ProviderError(`OpenAI upstream error (${status}): ${errorMessage}`, {
    code: 'outage',
    statusCode: status,
    providerId,
    correlationId,
    retryable: true,
  });
}

function mapOpenAiFinishReason(
  finishReason: unknown,
  toolCalls: readonly AiToolCall[]
): ProviderFinishReason {
  if (finishReason === 'content_filter') return 'policy_blocked';
  if (finishReason === 'length') return 'length';
  if (finishReason === 'tool_calls' || toolCalls.length > 0) return 'tool_calls';
  if (finishReason === 'stop') return 'stop';
  return 'unknown';
}

function parseOpenAiToolCalls(
  rawToolCalls: unknown,
  providerId: string,
  correlationId: string,
  redactor: RedactionContext
): AiToolCall[] {
  if (rawToolCalls === undefined || rawToolCalls === null) return [];
  if (!Array.isArray(rawToolCalls)) {
    throw new ProviderError('OpenAI returned non-array message.tool_calls', {
      code: 'malformed_response',
      providerId,
      correlationId,
      retryable: false,
    });
  }

  const toolCalls: AiToolCall[] = [];
  for (let index = 0; index < rawToolCalls.length; index += 1) {
    const entry = rawToolCalls[index];
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      !isRecord(entry.function) ||
      typeof entry.function.name !== 'string'
    ) {
      throw new ProviderError(`OpenAI tool_calls[${index}] is missing id or function.name`, {
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
        const parsed = JSON.parse(rawArgs) as unknown;
        if (!isJsonObject(parsed)) {
          throw new Error('Tool call arguments must decode to a JSON object');
        }
        parsedArgs = parsed;
      } catch (error) {
        throw new ProviderError(
          `OpenAI tool_calls[${index}] returned malformed JSON arguments: ${redactor.redactString(
            error instanceof Error ? error.message : String(error)
          )}`,
          {
            code: 'malformed_response',
            providerId,
            correlationId,
            retryable: false,
            cause: error,
          }
        );
      }
    } else if (isJsonObject(rawArgs)) {
      parsedArgs = rawArgs;
    }

    toolCalls.push({
      id: entry.id,
      name: entry.function.name,
      arguments: parsedArgs,
    });
  }
  return toolCalls;
}

export class OpenAiProviderAdapter implements AiProvider {
  readonly id: string;
  readonly kind = 'openai' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: URL;
  private readonly allowLoopbackHttp: boolean;
  private readonly approvedPrivateOrigins: readonly string[];
  private readonly secretRef: string;
  private readonly secretResolver: SecretResolver;
  private readonly organizationId?: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: FetchLike;
  private readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;

  constructor(config: OpenAiAdapterConfig) {
    this.id = config.id ?? 'openai-default';
    this.allowLoopbackHttp = config.allowLoopbackHttp ?? false;
    this.approvedPrivateOrigins = config.approvedPrivateOrigins ?? [];
    assertValidSecretRef(config.secretRef, this.id, 'adapter-init');
    this.secretRef = config.secretRef;
    this.secretResolver = config.secretResolver;
    this.organizationId = config.organizationId;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60_000;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.resolveAddresses = config.resolveAddresses;

    this.baseUrl = validateCloudOrEndpointUrl(config.baseUrl ?? 'https://api.openai.com', {
      allowLoopbackHttp: this.allowLoopbackHttp,
      approvedPrivateOrigins: this.approvedPrivateOrigins,
      providerId: this.id,
      correlationId: 'adapter-init',
    });

    this.capabilities = {
      textGeneration: config.capabilities?.textGeneration ?? true,
      toolCall: config.capabilities?.toolCall ?? true,
      streaming: config.capabilities?.streaming ?? false,
      structuredOutput: config.capabilities?.structuredOutput ?? true,
    };
  }

  private async ensureEndpointAllowed(correlationId: string): Promise<void> {
    validateCloudOrEndpointUrl(this.baseUrl, {
      allowLoopbackHttp: this.allowLoopbackHttp,
      approvedPrivateOrigins: this.approvedPrivateOrigins,
      providerId: this.id,
      correlationId,
    });
    if (
      !isLoopbackHostname(this.baseUrl.hostname) &&
      !matchesApprovedPrivateOrigin(this.baseUrl, this.approvedPrivateOrigins)
    ) {
      await assertPublicDnsResolution(this.baseUrl, {
        providerId: this.id,
        correlationId,
        resolveAddresses: this.resolveAddresses,
      });
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus> {
    const startedAt = Date.now();
    const correlationId = 'health-check';
    const redactor = createRedactor();
    try {
      await this.ensureEndpointAllowed(correlationId);
      const apiKey = await resolveSecretOrThrow({
        secretRef: this.secretRef,
        secretResolver: this.secretResolver,
        providerId: this.id,
        correlationId,
      });
      redactor.registerSecret(apiKey);

      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      };
      if (this.organizationId) {
        headers['openai-organization'] = this.organizationId;
      }

      const response = await fetchWithProviderTimeout({
        fetchFn: this.fetchFn,
        url: buildUrlPath(this.baseUrl, '/v1/models'),
        init: {
          method: 'GET',
          headers,
        },
        timeoutMs: Math.min(this.defaultTimeoutMs, 10_000),
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
        const mapped = mapOpenAiError(
          response.status,
          bodyText,
          response.headers,
          this.id,
          correlationId,
          redactor
        );
        return {
          ok: false,
          providerId: this.id,
          providerKind: this.kind,
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode: mapped.code,
          reasonCode: mapped.reasonCode,
          detail: mapped.message,
        };
      }

      const parsed = JSON.parse(bodyText) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
        return {
          ok: false,
          providerId: this.id,
          providerKind: this.kind,
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode: 'malformed_response',
          detail: 'OpenAI /v1/models returned malformed payload',
        };
      }

      const models = parsed.data
        .filter(
          (entry): entry is Record<string, unknown> =>
            isRecord(entry) && typeof entry.id === 'string'
        )
        .map((entry) => entry.id as string);

      return {
        ok: true,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        availableModels: models,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        return {
          ok: false,
          providerId: this.id,
          providerKind: this.kind,
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode: error.code,
          reasonCode: error.reasonCode,
          detail: redactor.redactString(error.message),
        };
      }
      return {
        ok: false,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        errorCode: 'malformed_response',
        detail: redactor.redactString(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const startedAt = Date.now();
    validateRequestCapabilities(this.id, this.capabilities, request);
    await this.ensureEndpointAllowed(request.correlationId);

    const redactor = createRedactor();
    const apiKey = await resolveSecretOrThrow({
      secretRef: this.secretRef,
      secretResolver: this.secretResolver,
      providerId: this.id,
      correlationId: request.correlationId,
      companyId: request.companyId,
    });
    redactor.registerSecret(apiKey);

    const wireMessages = request.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId ?? '',
          content: message.content,
        };
      }
      if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        };
      }
      return {
        role: message.role,
        content: message.content,
      };
    });

    const payload: Record<string, unknown> = {
      model: request.model.modelName,
      messages: wireMessages,
      stream: false,
    };

    const temperature = request.temperature ?? request.model.defaultTemperature;
    if (temperature !== undefined) {
      payload.temperature = temperature;
    }

    const maxTokens = request.maxOutputTokens ?? request.model.maxOutputTokens;
    if (maxTokens !== undefined) {
      payload.max_completion_tokens = maxTokens;
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      payload.stop = [...request.stopSequences];
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
        },
      }));
      if (request.toolChoice) {
        if (typeof request.toolChoice === 'string') {
          payload.tool_choice = request.toolChoice;
        } else {
          payload.tool_choice = {
            type: 'function',
            function: { name: request.toolChoice.name },
          };
        }
      }
    }

    if (request.responseSchema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseSchema.name,
          strict: request.responseSchema.strict ?? true,
          schema: request.responseSchema.schema,
        },
      };
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-correlation-id': request.correlationId,
    };
    if (this.organizationId) {
      headers['openai-organization'] = this.organizationId;
    }

    const url = buildUrlPath(this.baseUrl, '/v1/chat/completions');
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const { response, bodyText } = await runWithProviderAttempt({
      timeoutMs,
      callerSignal: signal,
      providerId: this.id,
      correlationId: request.correlationId,
      redactor,
      fn: async (attemptSignal) => {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          redirect: 'error',
          signal: attemptSignal,
        });
        const text = await readBoundedResponseText(
          res,
          this.maxResponseBytes,
          this.id,
          request.correlationId,
          redactor
        );
        return { response: res, bodyText: text };
      },
    });

    if (!response.ok) {
      throw mapOpenAiError(
        response.status,
        bodyText,
        response.headers,
        this.id,
        request.correlationId,
        redactor
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch (error) {
      throw new ProviderError('OpenAI returned invalid JSON response', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
        cause: error,
      });
    }

    if (
      !isRecord(parsedBody) ||
      !Array.isArray(parsedBody.choices) ||
      parsedBody.choices.length === 0
    ) {
      throw new ProviderError('OpenAI response missing choices[0]', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const choice = parsedBody.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message)) {
      throw new ProviderError('OpenAI response choice missing message object', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    if (
      (typeof choice.message.refusal === 'string' && choice.message.refusal.length > 0) ||
      choice.finish_reason === 'content_filter'
    ) {
      const refusalReason =
        typeof choice.message.refusal === 'string'
          ? redactor.redactString(choice.message.refusal)
          : 'content_filter';
      throw new ProviderError(`OpenAI policy blocked output: ${refusalReason}`, {
        code: 'policy_blocked',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const text = typeof choice.message.content === 'string' ? choice.message.content : '';
    const toolCalls = parseOpenAiToolCalls(
      choice.message.tool_calls,
      this.id,
      request.correlationId,
      redactor
    );

    if (typeof choice.message.content !== 'string' && toolCalls.length === 0) {
      throw new ProviderError('OpenAI response missing message content and tool_calls', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    let structuredOutput: JsonValue | undefined;
    if (request.responseSchema && toolCalls.length === 0) {
      structuredOutput = parseAndValidateStructuredOutput(
        text,
        request.responseSchema,
        this.id,
        request.correlationId,
        redactor
      );
    }

    const rawUsage = isRecord(parsedBody.usage) ? parsedBody.usage : undefined;
    const hasReportedUsage =
      rawUsage !== undefined &&
      typeof rawUsage.prompt_tokens === 'number' &&
      typeof rawUsage.completion_tokens === 'number';
    const inputTokens = hasReportedUsage
      ? (rawUsage.prompt_tokens as number)
      : estimateRequestInputTokens(request);
    const outputTokens = hasReportedUsage
      ? (rawUsage.completion_tokens as number)
      : estimateTokenCount(text + (toolCalls.length > 0 ? JSON.stringify(toolCalls) : ''));

    return {
      correlationId: request.correlationId,
      providerId: this.id,
      providerKind: this.kind,
      modelName:
        typeof parsedBody.model === 'string' && parsedBody.model.length > 0
          ? parsedBody.model
          : request.model.modelName,
      text,
      structuredOutput,
      toolCalls,
      finishReason: mapOpenAiFinishReason(choice.finish_reason, toolCalls),
      usage: buildTokenUsage({
        inputTokens,
        outputTokens,
        source: hasReportedUsage ? 'provider_reported' : 'estimated',
        pricing: request.model.pricing,
      }),
      latencyMs: Math.max(0, Date.now() - startedAt),
      rawRedactedMeta: {
        endpointHost: this.baseUrl.host,
        httpStatus: response.status,
        requestId: response.headers.get('x-request-id') ?? null,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown',
      },
    };
  }
}
