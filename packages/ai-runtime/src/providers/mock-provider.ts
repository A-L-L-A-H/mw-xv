import type { JsonValue } from '@moonwitness/types';
import { composeAttemptSignal } from '../resilience.js';
import { validateJsonSchema } from '../schema-validator.js';
import { buildTokenUsage, estimateRequestInputTokens, estimateTokenCount } from '../usage.js';
import type {
  AiProvider,
  AiToolCall,
  ProviderCapabilities,
  ProviderErrorCode,
  ProviderErrorOptions,
  ProviderFinishReason,
  ProviderHealthStatus,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  TokenUsage,
} from '../types.js';
import { ProviderError } from '../types.js';
import { parseAndValidateStructuredOutput, validateRequestCapabilities } from './shared.js';

export type MockScriptOutcome =
  | {
      readonly kind: 'response';
      readonly text?: string;
      readonly structuredOutput?: JsonValue;
      readonly toolCalls?: readonly AiToolCall[];
      readonly finishReason?: ProviderFinishReason;
      readonly usage?: Partial<Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'source'>>;
      readonly delayMs?: number;
      readonly streamChunks?: readonly string[];
      readonly meta?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly kind: 'raw_text';
      readonly text: string;
      readonly delayMs?: number;
      readonly usage?: Partial<Pick<TokenUsage, 'inputTokens' | 'outputTokens'>>;
    }
  | {
      readonly kind: 'error';
      readonly error: Partial<Omit<ProviderErrorOptions, 'code'>> & {
        readonly code: ProviderErrorCode;
        readonly message?: string;
      };
      readonly delayMs?: number;
    }
  | {
      readonly kind: 'hang';
    };

export type MockScriptResolver = (
  request: ProviderRequest,
  callIndex: number
) => MockScriptOutcome | Promise<MockScriptOutcome>;

export interface MockProviderConfig {
  readonly id?: string;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly healthStatus?: Partial<Omit<ProviderHealthStatus, 'providerId' | 'providerKind'>>;
  readonly defaultTimeoutMs?: number;
  readonly script?: readonly MockScriptOutcome[] | MockScriptResolver;
}

function deepCloneFrozen<T>(value: T): T {
  return structuredClone(value);
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason ?? new Error('ABORTED'));
      },
      { once: true }
    );
  });
}

export class MockProvider implements AiProvider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly defaultTimeoutMs: number;
  private readonly scriptQueue: MockScriptOutcome[];
  private readonly scriptResolver?: MockScriptResolver;
  private healthConfig: Partial<Omit<ProviderHealthStatus, 'providerId' | 'providerKind'>>;
  private callCounter = 0;
  private readonly requests: ProviderRequest[] = [];

  constructor(config: MockProviderConfig = {}) {
    this.id = config.id ?? 'mock-default';
    this.capabilities = {
      textGeneration: config.capabilities?.textGeneration ?? true,
      toolCall: config.capabilities?.toolCall ?? true,
      streaming: config.capabilities?.streaming ?? true,
      structuredOutput: config.capabilities?.structuredOutput ?? true,
    };
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 15_000;
    this.healthConfig = config.healthStatus ?? { ok: true, availableModels: ['mock-model-1'] };
    if (typeof config.script === 'function') {
      this.scriptResolver = config.script;
      this.scriptQueue = [];
    } else {
      this.scriptQueue = [...(config.script ?? [])];
    }
  }

  get recordedRequests(): readonly ProviderRequest[] {
    return this.requests;
  }

  setHealthStatus(
    status: Partial<Omit<ProviderHealthStatus, 'providerId' | 'providerKind'>>
  ): void {
    this.healthConfig = status;
  }

  enqueue(outcome: MockScriptOutcome): void {
    this.scriptQueue.push(outcome);
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus> {
    const start = Date.now();
    if (signal?.aborted) {
      return {
        ok: false,
        providerId: this.id,
        providerKind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        errorCode: 'cancelled',
        detail: 'Health check cancelled by caller signal',
      };
    }

    return {
      ok: this.healthConfig.ok ?? true,
      providerId: this.id,
      providerKind: this.kind,
      checkedAt: this.healthConfig.checkedAt ?? new Date().toISOString(),
      latencyMs: this.healthConfig.latencyMs ?? Math.max(0, Date.now() - start),
      availableModels: this.healthConfig.availableModels ?? ['mock-model-1'],
      errorCode: this.healthConfig.errorCode,
      reasonCode: this.healthConfig.reasonCode,
      detail: this.healthConfig.detail,
    };
  }

  private async resolveOutcome(
    request: ProviderRequest,
    callIndex: number
  ): Promise<MockScriptOutcome> {
    if (this.scriptResolver) {
      return this.scriptResolver(request, callIndex);
    }
    const next = this.scriptQueue.shift();
    if (next) return next;
    const lastMessage = request.messages[request.messages.length - 1]?.content ?? '';
    return {
      kind: 'response',
      text: `mock:${lastMessage}`,
      finishReason: 'stop',
    };
  }

  private async executeOutcome(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<{ readonly response: ProviderResponse; readonly streamChunks?: readonly string[] }> {
    const startedAt = Date.now();
    validateRequestCapabilities(this.id, this.capabilities, request);

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const attempt = composeAttemptSignal(timeoutMs, signal, this.id, request.correlationId);

    try {
      const callIndex = this.callCounter++;
      this.requests.push(deepCloneFrozen(request));

      const outcome = await this.resolveOutcome(request, callIndex);
      if (outcome.kind === 'hang') {
        return await hangUntilAborted(attempt.signal);
      }

      if (outcome.delayMs && outcome.delayMs > 0) {
        await sleepWithSignal(outcome.delayMs, attempt.signal);
      }

      if (outcome.kind === 'error') {
        throw new ProviderError(
          outcome.error.message ?? `Mock provider simulated error (${outcome.error.code})`,
          {
            code: outcome.error.code,
            reasonCode: outcome.error.reasonCode,
            providerId: outcome.error.providerId ?? this.id,
            correlationId: outcome.error.correlationId ?? request.correlationId,
            retryable: outcome.error.retryable,
            statusCode: outcome.error.statusCode,
            retryAfterMs: outcome.error.retryAfterMs,
            cause: outcome.error.cause,
          }
        );
      }

      if (outcome.kind === 'raw_text') {
        const structuredOutput = request.responseSchema
          ? parseAndValidateStructuredOutput(
              outcome.text,
              request.responseSchema,
              this.id,
              request.correlationId
            )
          : undefined;
        const inputTokens = outcome.usage?.inputTokens ?? estimateRequestInputTokens(request);
        const outputTokens = outcome.usage?.outputTokens ?? estimateTokenCount(outcome.text);
        const source =
          outcome.usage?.inputTokens !== undefined && outcome.usage?.outputTokens !== undefined
            ? 'provider_reported'
            : 'estimated';

        return {
          response: {
            correlationId: request.correlationId,
            providerId: this.id,
            providerKind: this.kind,
            modelName: request.model.modelName,
            text: outcome.text,
            structuredOutput,
            toolCalls: [],
            finishReason: 'stop',
            usage: buildTokenUsage({
              inputTokens,
              outputTokens,
              source,
              pricing: request.model.pricing,
            }),
            latencyMs: Math.max(0, Date.now() - startedAt),
            rawRedactedMeta: {
              mockMode: 'raw_text',
            },
          },
        };
      }

      let structuredOutput = outcome.structuredOutput;
      let text = outcome.text ?? '';
      if (structuredOutput !== undefined && !text) {
        text = JSON.stringify(structuredOutput);
      }

      if (request.responseSchema) {
        if (structuredOutput !== undefined) {
          const check = validateJsonSchema(request.responseSchema.schema, structuredOutput);
          if (!check.valid) {
            const summary = check.errors
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
        } else {
          structuredOutput = parseAndValidateStructuredOutput(
            text,
            request.responseSchema,
            this.id,
            request.correlationId
          );
        }
      }

      const toolCalls = outcome.toolCalls ?? [];
      const hasReportedUsage =
        outcome.usage?.inputTokens !== undefined && outcome.usage?.outputTokens !== undefined;
      const inputTokens = outcome.usage?.inputTokens ?? estimateRequestInputTokens(request);
      const outputTokens =
        outcome.usage?.outputTokens ??
        estimateTokenCount(text + (toolCalls.length > 0 ? JSON.stringify(toolCalls) : ''));

      return {
        streamChunks: outcome.streamChunks,
        response: {
          correlationId: request.correlationId,
          providerId: this.id,
          providerKind: this.kind,
          modelName: request.model.modelName,
          text,
          structuredOutput,
          toolCalls,
          finishReason: outcome.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
          usage: buildTokenUsage({
            inputTokens,
            outputTokens,
            source: outcome.usage?.source ?? (hasReportedUsage ? 'provider_reported' : 'estimated'),
            pricing: request.model.pricing,
          }),
          latencyMs: Math.max(0, Date.now() - startedAt),
          rawRedactedMeta: {
            mockMode: 'response',
            ...(outcome.meta ?? {}),
          },
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (attempt.isCallerAborted()) {
        throw new ProviderError('Mock provider request cancelled by caller signal', {
          code: 'cancelled',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: false,
        });
      }
      if (attempt.isTimedOut()) {
        throw new ProviderError(`Mock provider request timed out after ${timeoutMs}ms`, {
          code: 'timeout',
          providerId: this.id,
          correlationId: request.correlationId,
          retryable: true,
        });
      }
      throw new ProviderError(error instanceof Error ? error.message : String(error), {
        code: 'outage',
        providerId: this.id,
        correlationId: request.correlationId,
        retryable: true,
        cause: error,
      });
    } finally {
      attempt.cleanup();
    }
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const result = await this.executeOutcome(request, signal);
    return result.response;
  }

  async *stream(
    request: ProviderRequest,
    signal?: AbortSignal
  ): AsyncIterable<ProviderStreamEvent> {
    validateRequestCapabilities(this.id, this.capabilities, request, true);
    const result = await this.executeOutcome(request, signal);
    const chunks =
      result.streamChunks ?? (result.response.text.length > 0 ? [result.response.text] : []);

    for (const delta of chunks) {
      yield { type: 'text_delta', delta };
    }
    for (let index = 0; index < result.response.toolCalls.length; index += 1) {
      const call = result.response.toolCalls[index];
      yield {
        type: 'tool_call_delta',
        index,
        id: call.id,
        name: call.name,
        argumentsDelta: JSON.stringify(call.arguments),
      };
    }
    yield { type: 'completed', response: result.response };
  }
}
