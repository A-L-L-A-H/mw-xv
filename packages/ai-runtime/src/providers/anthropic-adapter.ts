import type { JsonObject, JsonValue } from '@moonwitness/types';
import { isJsonObject, isRecord } from '@moonwitness/types';
import { createRedactor, type RedactionContext } from '../redaction.js';
import { validateJsonSchema } from '../schema-validator.js';
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
  parseAndValidateStructuredOutput,
  parseRetryAfterHeaderMs,
  readBoundedResponseText,
  runWithProviderAttempt,
  validateCloudOrEndpointUrl,
  validateRequestCapabilities,
} from './shared.js';

const STRUCTURED_OUTPUT_SYNTHETIC_TOOL = '__mw_structured_output';

export type AnthropicStructuredOutputStrategy = 'tool_forcing' | 'json_prompt';

export interface AnthropicAdapterConfig {
  readonly id?: string;
  readonly baseUrl?: string | URL;
  readonly allowLoopbackHttp?: boolean;
  readonly anthropicVersion?: string;
  readonly secretRef: string;
  readonly secretResolver: SecretResolver;
  readonly structuredOutputStrategy?: AnthropicStructuredOutputStrategy;
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly fetch?: FetchLike;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
}

function mapAnthropicError(
  status: number,
  bodyText: string,
  headers: Headers,
  providerId: string,
  correlationId: string,
  redactor: RedactionContext
): ProviderError {
  let errorType = '';
  let errorMessage = redactor.redactString(bodyText).slice(0, 500);

  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error)) {
      if (typeof parsed.error.type === 'string') errorType = parsed.error.type;
      if (typeof parsed.error.message === 'string') {
        errorMessage = redactor.redactString(parsed.error.message);
      }
    }
  } catch {
    // non-json error body
  }

  if (status === 401 || status === 403) {
    return new ProviderError(`Anthropic authentication failed (${status}): ${errorMessage}`, {
      code: 'auth_failed',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  const lowerMsg = errorMessage.toLowerCase();
  const isQuotaExhausted =
    status === 402 ||
    errorType === 'insufficient_quota' ||
    errorType === 'billing_error' ||
    lowerMsg.includes('credit balance') ||
    lowerMsg.includes('quota');

  if (isQuotaExhausted) {
    return new ProviderError(`Anthropic quota exceeded (${status}): ${errorMessage}`, {
      code: 'quota_exceeded',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  if (status === 429) {
    return new ProviderError(`Anthropic rate limited (${status}): ${errorMessage}`, {
      code: 'rate_limited',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
      retryAfterMs: parseRetryAfterHeaderMs(headers),
    });
  }

  if (status === 408) {
    return new ProviderError(`Anthropic request timed out (${status}): ${errorMessage}`, {
      code: 'timeout',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
    });
  }

  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError(`Anthropic rejected request (${status}): ${errorMessage}`, {
      code: 'malformed_response',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }

  return new ProviderError(`Anthropic upstream error (${status}): ${errorMessage}`, {
    code: 'outage',
    statusCode: status,
    providerId,
    correlationId,
    retryable: true,
  });
}

function mapAnthropicStopReason(
  stopReason: unknown,
  toolCalls: readonly AiToolCall[]
): ProviderFinishReason {
  if (stopReason === 'refusal') return 'policy_blocked';
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'tool_use' || toolCalls.length > 0) return 'tool_calls';
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop';
  return 'unknown';
}

export class AnthropicProviderAdapter implements AiProvider {
  readonly id: string;
  readonly kind = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: URL;
  private readonly allowLoopbackHttp: boolean;
  private readonly anthropicVersion: string;
  private readonly secretRef: string;
  private readonly secretResolver: SecretResolver;
  private readonly structuredOutputStrategy: AnthropicStructuredOutputStrategy;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: FetchLike;
  private readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;

  constructor(config: AnthropicAdapterConfig) {
    this.id = config.id ?? 'anthropic-default';
    this.allowLoopbackHttp = config.allowLoopbackHttp ?? false;
    assertValidSecretRef(config.secretRef, this.id, 'adapter-init');
    this.secretRef = config.secretRef;
    this.secretResolver = config.secretResolver;
    this.anthropicVersion = config.anthropicVersion ?? '2023-06-01';
    this.structuredOutputStrategy = config.structuredOutputStrategy ?? 'tool_forcing';
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60_000;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.resolveAddresses = config.resolveAddresses;

    this.baseUrl = validateCloudOrEndpointUrl(config.baseUrl ?? 'https://api.anthropic.com', {
      allowLoopbackHttp: this.allowLoopbackHttp,
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
      providerId: this.id,
      correlationId,
    });
    if (!isLoopbackHostname(this.baseUrl.hostname)) {
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

      const response = await fetchWithProviderTimeout({
        fetchFn: this.fetchFn,
        url: buildUrlPath(this.baseUrl, '/v1/models'),
        init: {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': this.anthropicVersion,
            accept: 'application/json',
          },
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
        const mapped = mapAnthropicError(
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
          detail: 'Anthropic /v1/models returned malformed payload',
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

    const systemParts: string[] = [];
    const wireMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const message of request.messages) {
      if (message.role === 'system') {
        systemParts.push(message.content);
        continue;
      }
      if (message.role === 'tool') {
        wireMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId ?? '',
              content: message.content,
            },
          ],
        });
        continue;
      }
      if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        if (message.content) {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        wireMessages.push({ role: 'assistant', content: blocks });
        continue;
      }
      wireMessages.push({
        role: message.role,
        content: message.content,
      });
    }

    const hasCallerTools = Boolean(request.tools && request.tools.length > 0);
    const useToolForcingForSchema =
      Boolean(request.responseSchema) &&
      this.structuredOutputStrategy === 'tool_forcing' &&
      !hasCallerTools;

    if (request.responseSchema && !useToolForcingForSchema) {
      systemParts.push(
        `Respond ONLY with valid JSON matching schema "${request.responseSchema.name}": ${JSON.stringify(
          request.responseSchema.schema
        )}`
      );
    }

    const payload: Record<string, unknown> = {
      model: request.model.modelName,
      max_tokens: request.maxOutputTokens ?? request.model.maxOutputTokens,
      messages: wireMessages,
      stream: false,
    };

    if (systemParts.length > 0) {
      payload.system = systemParts.join('\n\n');
    }

    const temperature = request.temperature ?? request.model.defaultTemperature;
    if (temperature !== undefined) {
      payload.temperature = temperature;
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      payload.stop_sequences = [...request.stopSequences];
    }

    if (useToolForcingForSchema && request.responseSchema) {
      payload.tools = [
        {
          name: STRUCTURED_OUTPUT_SYNTHETIC_TOOL,
          description: `Emit final structured output for ${request.responseSchema.name}`,
          input_schema: request.responseSchema.schema,
        },
      ];
      payload.tool_choice = {
        type: 'tool',
        name: STRUCTURED_OUTPUT_SYNTHETIC_TOOL,
      };
    } else if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      if (request.toolChoice) {
        if (request.toolChoice === 'auto') {
          payload.tool_choice = { type: 'auto' };
        } else if (request.toolChoice === 'required') {
          payload.tool_choice = { type: 'any' };
        } else if (request.toolChoice === 'none') {
          payload.tool_choice = { type: 'none' };
        } else {
          payload.tool_choice = { type: 'tool', name: request.toolChoice.name };
        }
      }
    }

    const url = buildUrlPath(this.baseUrl, '/v1/messages');
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
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': this.anthropicVersion,
            'content-type': 'application/json',
            'x-correlation-id': request.correlationId,
          },
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
      throw mapAnthropicError(
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
      throw new ProviderError('Anthropic returned invalid JSON response', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
        cause: error,
      });
    }

    if (!isRecord(parsedBody) || !Array.isArray(parsedBody.content)) {
      throw new ProviderError('Anthropic response missing content array', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    if (parsedBody.stop_reason === 'refusal') {
      throw new ProviderError('Anthropic policy blocked response (stop_reason=refusal)', {
        code: 'policy_blocked',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    const textParts: string[] = [];
    const toolCalls: AiToolCall[] = [];
    let forcedStructuredPayload: unknown;
    let foundForcedTool = false;

    for (const block of parsedBody.content) {
      if (!isRecord(block) || typeof block.type !== 'string') {
        throw new ProviderError('Anthropic content block missing type', {
          code: 'malformed_response',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || typeof block.name !== 'string') {
          throw new ProviderError('Anthropic tool_use block missing id or name', {
            code: 'malformed_response',
            providerId: this.id,
            correlationId: request.correlationId,
            retryable: false,
          });
        }
        if (block.name === STRUCTURED_OUTPUT_SYNTHETIC_TOOL && useToolForcingForSchema) {
          foundForcedTool = true;
          forcedStructuredPayload = block.input;
        } else {
          const inputObj: JsonObject = isJsonObject(block.input) ? block.input : {};
          if (block.input !== undefined && !isJsonObject(block.input)) {
            throw new ProviderError('Anthropic tool_use input must be a JSON object', {
              code: 'malformed_response',
              providerId: this.id,
              correlationId: request.correlationId,
              retryable: false,
            });
          }
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: inputObj,
          });
        }
      }
    }

    let text = textParts.join('');
    let structuredOutput: JsonValue | undefined;

    if (request.responseSchema) {
      if (useToolForcingForSchema) {
        if (foundForcedTool) {
          const validation = validateJsonSchema(
            request.responseSchema.schema,
            forcedStructuredPayload
          );
          if (!validation.valid) {
            const summary = validation.errors
              .slice(0, 5)
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join('; ');
            throw new ProviderError(
              `Structured output failed schema "${request.responseSchema.name}" validation: ${summary}`,
              {
                code: 'malformed_response',
                reasonCode: 'MALFORMED_STRUCTURED_OUTPUT',
                providerId: this.id,
                correlationId: request.correlationId,
                retryable: false,
              }
            );
          }
          structuredOutput = forcedStructuredPayload as JsonValue;
          if (!text) {
            text = JSON.stringify(structuredOutput);
          }
        } else {
          structuredOutput = parseAndValidateStructuredOutput(
            text,
            request.responseSchema,
            this.id,
            request.correlationId,
            redactor
          );
        }
      } else if (toolCalls.length === 0) {
        structuredOutput = parseAndValidateStructuredOutput(
          text,
          request.responseSchema,
          this.id,
          request.correlationId,
          redactor
        );
      }
    }

    const rawUsage = isRecord(parsedBody.usage) ? parsedBody.usage : undefined;
    const hasReportedUsage =
      rawUsage !== undefined &&
      typeof rawUsage.input_tokens === 'number' &&
      typeof rawUsage.output_tokens === 'number';
    const inputTokens = hasReportedUsage
      ? (rawUsage.input_tokens as number)
      : estimateRequestInputTokens(request);
    const outputTokens = hasReportedUsage
      ? (rawUsage.output_tokens as number)
      : estimateTokenCount(text + (toolCalls.length > 0 ? JSON.stringify(toolCalls) : ''));

    const finishReason =
      foundForcedTool && toolCalls.length === 0
        ? 'stop'
        : mapAnthropicStopReason(parsedBody.stop_reason, toolCalls);

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
      finishReason,
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
        requestId: response.headers.get('request-id') ?? null,
        stopReason: typeof parsedBody.stop_reason === 'string' ? parsedBody.stop_reason : 'unknown',
      },
    };
  }
}
