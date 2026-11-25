import type { JsonObject, JsonValue } from '@moonwitness/types';
import { DEFAULT_OLLAMA_URL, isJsonObject, isRecord } from '@moonwitness/types';
import { createRedactor } from '../redaction.js';
import { composeAttemptSignal } from '../resilience.js';
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
  ProviderStreamEvent,
} from '../types.js';
import { ProviderError } from '../types.js';
import {
  assertPublicDnsResolution,
  buildUrlPath,
  DEFAULT_MAX_RESPONSE_BYTES,
  fetchWithProviderTimeout,
  parseAndValidateStructuredOutput,
  parseRetryAfterHeaderMs,
  readBoundedResponseText,
  runWithProviderAttempt,
  validateCloudOrEndpointUrl,
  validateLoopbackEndpointUrl,
  validateRequestCapabilities,
} from './shared.js';

export type OllamaEndpointMode = 'chat' | 'generate';

export interface OllamaAdapterConfig {
  readonly id?: string;
  readonly endpoint?: string | URL;
  readonly baseUrl?: string | URL;
  readonly model?: string;
  readonly allowNonLoopback?: boolean;
  readonly endpointMode?: OllamaEndpointMode;
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly fetch?: FetchLike;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
}

interface OllamaWireToolCall {
  readonly id?: unknown;
  readonly function?: {
    readonly name?: unknown;
    readonly arguments?: unknown;
  };
}

function parseOllamaToolCalls(
  rawCalls: unknown,
  providerId: string,
  correlationId: string
): AiToolCall[] {
  if (rawCalls === undefined || rawCalls === null) return [];
  if (!Array.isArray(rawCalls)) {
    throw new ProviderError('Ollama returned non-array tool_calls', {
      code: 'malformed_response',
      providerId,
      correlationId,
      retryable: false,
    });
  }

  const calls: AiToolCall[] = [];
  for (let index = 0; index < rawCalls.length; index += 1) {
    const item = rawCalls[index] as OllamaWireToolCall;
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== 'string') {
      throw new ProviderError(`Ollama tool_calls[${index}] is missing function.name`, {
        code: 'malformed_response',
        providerId,
        correlationId,
        retryable: false,
      });
    }

    let parsedArgs: JsonObject;
    const rawArgs = item.function.arguments;
    if (rawArgs === undefined || rawArgs === null) {
      parsedArgs = {};
    } else if (typeof rawArgs === 'string') {
      try {
        const json = JSON.parse(rawArgs) as unknown;
        if (!isJsonObject(json)) {
          throw new Error('Tool arguments JSON is not an object');
        }
        parsedArgs = json;
      } catch (error) {
        throw new ProviderError(`Ollama tool_calls[${index}] arguments is invalid JSON`, {
          code: 'malformed_response',
          providerId,
          correlationId,
          retryable: false,
          cause: error,
        });
      }
    } else if (isJsonObject(rawArgs)) {
      parsedArgs = rawArgs;
    } else {
      throw new ProviderError(`Ollama tool_calls[${index}] arguments must be a JSON object`, {
        code: 'malformed_response',
        providerId,
        correlationId,
        retryable: false,
      });
    }

    calls.push({
      id:
        typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id
          : `call_${correlationId}_${index}`,
      name: item.function.name,
      arguments: parsedArgs,
    });
  }
  return calls;
}

function mapOllamaFinishReason(
  doneReason: unknown,
  toolCalls: readonly AiToolCall[]
): ProviderFinishReason {
  if (toolCalls.length > 0) return 'tool_calls';
  if (doneReason === 'length') return 'length';
  if (doneReason === 'stop' || doneReason === undefined) return 'stop';
  return 'unknown';
}

function mapOllamaHttpError(
  status: number,
  bodyText: string,
  headers: Headers,
  providerId: string,
  correlationId: string
): ProviderError {
  const redactor = createRedactor();
  let detail = redactor.redactString(bodyText).slice(0, 500);
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof parsed.error === 'string') {
      detail = redactor.redactString(parsed.error);
    }
  } catch {
    // plain text body
  }

  if (status === 401 || status === 403) {
    return new ProviderError(`Ollama authentication failed (${status}): ${detail}`, {
      code: 'auth_failed',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }
  if (status === 402) {
    return new ProviderError(`Ollama quota exceeded (${status}): ${detail}`, {
      code: 'quota_exceeded',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError(`Ollama rate limited (${status}): ${detail}`, {
      code: 'rate_limited',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
      retryAfterMs: parseRetryAfterHeaderMs(headers),
    });
  }
  if (status === 408) {
    return new ProviderError(`Ollama request timed out (${status}): ${detail}`, {
      code: 'timeout',
      statusCode: status,
      providerId,
      correlationId,
      retryable: true,
    });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError(`Ollama rejected request (${status}): ${detail}`, {
      code: 'malformed_response',
      statusCode: status,
      providerId,
      correlationId,
      retryable: false,
    });
  }
  return new ProviderError(`Ollama server error (${status}): ${detail}`, {
    code: 'outage',
    statusCode: status,
    providerId,
    correlationId,
    retryable: true,
  });
}

export class OllamaAdapter implements AiProvider {
  readonly id: string;
  readonly kind = 'ollama' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly endpointUrl: URL;
  private readonly allowNonLoopback: boolean;
  private readonly endpointMode: OllamaEndpointMode;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: FetchLike;
  private readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;

  constructor(config: OllamaAdapterConfig = {}) {
    this.id = config.id ?? 'ollama-local';
    this.allowNonLoopback = config.allowNonLoopback ?? false;
    this.endpointMode = config.endpointMode ?? 'chat';
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.resolveAddresses = config.resolveAddresses;

    const rawEndpoint = config.endpoint ?? config.baseUrl ?? DEFAULT_OLLAMA_URL;
    this.endpointUrl = this.allowNonLoopback
      ? validateCloudOrEndpointUrl(rawEndpoint, {
          allowLoopbackHttp: true,
          providerId: this.id,
        })
      : validateLoopbackEndpointUrl(rawEndpoint, this.id);

    this.capabilities = {
      textGeneration: config.capabilities?.textGeneration ?? true,
      toolCall: config.capabilities?.toolCall ?? (this.endpointMode === 'generate' ? false : true),
      streaming: config.capabilities?.streaming ?? true,
      structuredOutput: config.capabilities?.structuredOutput ?? true,
    };
  }

  private async ensureEndpointAllowed(correlationId: string): Promise<void> {
    if (this.allowNonLoopback) {
      validateCloudOrEndpointUrl(this.endpointUrl, {
        allowLoopbackHttp: true,
        providerId: this.id,
        correlationId,
      });
      if (
        this.endpointUrl.protocol === 'https:' &&
        this.endpointUrl.hostname !== 'localhost' &&
        this.endpointUrl.hostname !== '127.0.0.1' &&
        this.endpointUrl.hostname !== '::1'
      ) {
        await assertPublicDnsResolution(this.endpointUrl, {
          providerId: this.id,
          correlationId,
          resolveAddresses: this.resolveAddresses,
        });
      }
    } else {
      validateLoopbackEndpointUrl(this.endpointUrl, this.id, correlationId);
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus> {
    const startedAt = Date.now();
    const correlationId = 'health-check';
    try {
      await this.ensureEndpointAllowed(correlationId);
      const tagsUrl = buildUrlPath(this.endpointUrl, '/api/tags');
      const response = await fetchWithProviderTimeout({
        fetchFn: this.fetchFn,
        url: tagsUrl,
        init: {
          method: 'GET',
          headers: { accept: 'application/json' },
        },
        timeoutMs: Math.min(this.defaultTimeoutMs, 10_000),
        callerSignal: signal,
        providerId: this.id,
        correlationId,
      });

      const bodyText = await readBoundedResponseText(
        response,
        this.maxResponseBytes,
        this.id,
        correlationId
      );

      if (!response.ok) {
        const mapped = mapOllamaHttpError(
          response.status,
          bodyText,
          response.headers,
          this.id,
          correlationId
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
      if (!isRecord(parsed) || (parsed.models !== undefined && !Array.isArray(parsed.models))) {
        return {
          ok: false,
          providerId: this.id,
          providerKind: this.kind,
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode: 'malformed_response',
          detail: 'Ollama /api/tags returned malformed payload',
        };
      }

      const models: string[] = [];
      if (Array.isArray(parsed.models)) {
        for (const entry of parsed.models) {
          if (isRecord(entry)) {
            const name =
              typeof entry.name === 'string'
                ? entry.name
                : typeof entry.model === 'string'
                  ? entry.model
                  : undefined;
            if (name) models.push(name);
          }
        }
      }

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
          detail: error.message,
        };
      }
      return {
        ok: false,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        errorCode: 'malformed_response',
        detail: createRedactor().redactString(
          error instanceof Error ? error.message : String(error)
        ),
      };
    }
  }

  private buildRequestPayload(
    request: ProviderRequest,
    stream: boolean
  ): { readonly path: string; readonly payload: Record<string, unknown> } {
    const options: Record<string, unknown> = {
      temperature: request.temperature ?? request.model.defaultTemperature ?? 0,
    };
    const maxTokens = request.maxOutputTokens ?? request.model.maxOutputTokens;
    if (maxTokens !== undefined) {
      options.num_predict = maxTokens;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      options.stop = [...request.stopSequences];
    }

    if (this.endpointMode === 'generate') {
      const systemParts: string[] = [];
      const promptParts: string[] = [];
      for (const message of request.messages) {
        if (message.role === 'system') {
          systemParts.push(message.content);
        } else {
          promptParts.push(
            request.messages.length === 1 && message.role === 'user'
              ? message.content
              : `${message.role}: ${message.content}`
          );
        }
      }

      const payload: Record<string, unknown> = {
        model: request.model.modelName,
        prompt: promptParts.join('\n\n'),
        stream,
        options,
      };
      if (systemParts.length > 0) {
        payload.system = systemParts.join('\n\n');
      }
      if (request.responseSchema) {
        payload.format = request.responseSchema.schema;
      }
      return { path: '/api/generate', payload };
    }

    const messages = request.messages.map((message) => {
      const wire: Record<string, unknown> = {
        role: message.role,
        content: message.content,
      };
      if (message.toolName) {
        wire.tool_name = message.toolName;
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        }));
      }
      return wire;
    });

    const payload: Record<string, unknown> = {
      model: request.model.modelName,
      messages,
      stream,
      options,
    };

    if (request.responseSchema) {
      payload.format = request.responseSchema.schema;
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

    return { path: '/api/chat', payload };
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const startedAt = Date.now();
    validateRequestCapabilities(this.id, this.capabilities, request);
    await this.ensureEndpointAllowed(request.correlationId);

    const { path, payload } = this.buildRequestPayload(request, false);
    const url = buildUrlPath(this.endpointUrl, path);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const redactor = createRedactor();

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
      throw mapOllamaHttpError(
        response.status,
        bodyText,
        response.headers,
        this.id,
        request.correlationId
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch (error) {
      throw new ProviderError('Ollama returned invalid JSON response', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
        cause: error,
      });
    }

    if (!isRecord(parsedBody)) {
      throw new ProviderError('Ollama returned non-object JSON payload', {
        code: 'malformed_response',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: false,
      });
    }

    let text: string;
    let toolCalls: AiToolCall[] = [];

    if (this.endpointMode === 'generate') {
      if (typeof parsedBody.response !== 'string') {
        throw new ProviderError('Ollama /api/generate payload missing string "response"', {
          code: 'malformed_response',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }
      text = parsedBody.response;
    } else {
      if (!isRecord(parsedBody.message) || typeof parsedBody.message.content !== 'string') {
        throw new ProviderError('Ollama /api/chat payload missing message.content', {
          code: 'malformed_response',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }
      text = parsedBody.message.content;
      toolCalls = parseOllamaToolCalls(
        parsedBody.message.tool_calls,
        this.id,
        request.correlationId
      );
    }

    let structuredOutput: JsonValue | undefined;
    if (request.responseSchema) {
      structuredOutput = parseAndValidateStructuredOutput(
        text,
        request.responseSchema,
        this.id,
        request.correlationId,
        redactor
      );
    }

    const hasReportedTokens =
      typeof parsedBody.prompt_eval_count === 'number' && typeof parsedBody.eval_count === 'number';
    const inputTokens = hasReportedTokens
      ? (parsedBody.prompt_eval_count as number)
      : estimateRequestInputTokens(request);
    const outputTokens = hasReportedTokens
      ? (parsedBody.eval_count as number)
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
      finishReason: mapOllamaFinishReason(parsedBody.done_reason, toolCalls),
      usage: buildTokenUsage({
        inputTokens,
        outputTokens,
        source: hasReportedTokens ? 'provider_reported' : 'estimated',
        pricing: request.model.pricing,
      }),
      latencyMs: Math.max(0, Date.now() - startedAt),
      rawRedactedMeta: {
        endpointMode: this.endpointMode,
        endpointHost: this.endpointUrl.host,
        httpStatus: response.status,
        doneReason: typeof parsedBody.done_reason === 'string' ? parsedBody.done_reason : 'stop',
      },
    };
  }

  async *stream(
    request: ProviderRequest,
    signal?: AbortSignal
  ): AsyncIterable<ProviderStreamEvent> {
    const startedAt = Date.now();
    validateRequestCapabilities(this.id, this.capabilities, request, true);
    await this.ensureEndpointAllowed(request.correlationId);

    const { path, payload } = this.buildRequestPayload(request, true);
    const url = buildUrlPath(this.endpointUrl, path);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const redactor = createRedactor();
    const attempt = composeAttemptSignal(timeoutMs, signal, this.id, request.correlationId);

    let accumulatedText = '';
    const accumulatedToolCalls: AiToolCall[] = [];
    let promptEvalCount: number | undefined;
    let evalCount: number | undefined;
    let doneReason: unknown;
    let resolvedModel = request.model.modelName;
    let totalBytes = 0;

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': request.correlationId,
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: attempt.signal,
      });

      if (!response.ok) {
        const errorText = await readBoundedResponseText(
          response,
          this.maxResponseBytes,
          this.id,
          request.correlationId,
          redactor
        );
        throw mapOllamaHttpError(
          response.status,
          errorText,
          response.headers,
          this.id,
          request.correlationId
        );
      }

      if (!response.body) {
        throw new ProviderError('Ollama streaming response missing body stream', {
          code: 'malformed_response',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      const processLine = function* (
        thisAdapter: OllamaAdapter,
        line: string
      ): Generator<ProviderStreamEvent> {
        const trimmed = line.trim();
        if (!trimmed) return;
        let chunk: unknown;
        try {
          chunk = JSON.parse(trimmed);
        } catch (error) {
          throw new ProviderError('Ollama stream emitted invalid NDJSON line', {
            code: 'malformed_response',
            providerId: thisAdapter.id,
            correlationId: request.correlationId,
            retryable: false,
            cause: error,
          });
        }
        if (!isRecord(chunk)) {
          throw new ProviderError('Ollama stream chunk must be a JSON object', {
            code: 'malformed_response',
            providerId: thisAdapter.id,
            correlationId: request.correlationId,
            retryable: false,
          });
        }

        if (typeof chunk.model === 'string' && chunk.model.length > 0) {
          resolvedModel = chunk.model;
        }

        if (thisAdapter.endpointMode === 'generate') {
          if (typeof chunk.response === 'string' && chunk.response.length > 0) {
            accumulatedText += chunk.response;
            yield { type: 'text_delta', delta: chunk.response };
          }
        } else if (isRecord(chunk.message)) {
          if (typeof chunk.message.content === 'string' && chunk.message.content.length > 0) {
            accumulatedText += chunk.message.content;
            yield { type: 'text_delta', delta: chunk.message.content };
          }
          if (chunk.message.tool_calls !== undefined) {
            const parsedCalls = parseOllamaToolCalls(
              chunk.message.tool_calls,
              thisAdapter.id,
              request.correlationId
            );
            for (const call of parsedCalls) {
              const index = accumulatedToolCalls.length;
              accumulatedToolCalls.push(call);
              yield {
                type: 'tool_call_delta',
                index,
                id: call.id,
                name: call.name,
                argumentsDelta: JSON.stringify(call.arguments),
              };
            }
          }
        }

        if (chunk.done === true) {
          sawDone = true;
          doneReason = chunk.done_reason;
          if (typeof chunk.prompt_eval_count === 'number') {
            promptEvalCount = chunk.prompt_eval_count;
          }
          if (typeof chunk.eval_count === 'number') {
            evalCount = chunk.eval_count;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > this.maxResponseBytes) {
          throw new ProviderError(
            `Ollama stream exceeded max allowed bytes (${totalBytes} > ${this.maxResponseBytes})`,
            {
              code: 'malformed_response',
              reasonCode: 'RESPONSE_TOO_LARGE',
              providerId: this.id,
              correlationId: request.correlationId,
              retryable: false,
            }
          );
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          yield* processLine(this, line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        yield* processLine(this, buffer);
      }

      if (!sawDone && accumulatedText.length === 0 && accumulatedToolCalls.length === 0) {
        throw new ProviderError('Ollama stream ended without completion chunk', {
          code: 'malformed_response',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }

      const structuredOutput = request.responseSchema
        ? parseAndValidateStructuredOutput(
            accumulatedText,
            request.responseSchema,
            this.id,
            request.correlationId,
            redactor
          )
        : undefined;

      const hasReported = promptEvalCount !== undefined && evalCount !== undefined;
      const inputTokens = hasReported ? promptEvalCount! : estimateRequestInputTokens(request);
      const outputTokens = hasReported
        ? evalCount!
        : estimateTokenCount(
            accumulatedText +
              (accumulatedToolCalls.length > 0 ? JSON.stringify(accumulatedToolCalls) : '')
          );

      yield {
        type: 'completed',
        response: {
          correlationId: request.correlationId,
          providerId: this.id,
          providerKind: this.kind,
          modelName: resolvedModel,
          text: accumulatedText,
          structuredOutput,
          toolCalls: accumulatedToolCalls,
          finishReason: mapOllamaFinishReason(doneReason, accumulatedToolCalls),
          usage: buildTokenUsage({
            inputTokens,
            outputTokens,
            source: hasReported ? 'provider_reported' : 'estimated',
            pricing: request.model.pricing,
          }),
          latencyMs: Math.max(0, Date.now() - startedAt),
          rawRedactedMeta: {
            endpointMode: this.endpointMode,
            endpointHost: this.endpointUrl.host,
            httpStatus: response.status,
            streamed: true,
          },
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (attempt.isCallerAborted()) {
        throw new ProviderError('Ollama stream cancelled by caller signal', {
          code: 'cancelled',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
          cause: redactor.redactError(error),
        });
      }
      if (attempt.isTimedOut() || (error instanceof Error && error.name === 'TimeoutError')) {
        throw new ProviderError(`Ollama stream timed out after ${timeoutMs}ms`, {
          code: 'timeout',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: true,
          cause: redactor.redactError(error),
        });
      }
      throw new ProviderError(
        `Ollama stream transport failure: ${redactor.redactString(
          error instanceof Error ? error.message : String(error)
        )}`,
        {
          code: 'outage',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: true,
          cause: redactor.redactError(error),
        }
      );
    } finally {
      attempt.cleanup();
    }
  }
}
