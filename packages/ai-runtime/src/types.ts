import type { JsonObject, JsonValue } from '@moonwitness/types';

export type ProviderKind =
  'mock' | 'ollama' | 'openai' | 'anthropic' | 'local_openai' | 'freellmapi';
export type DataClassification = 'local_only' | 'cloud_eligible' | 'restricted';
export type ModelModality = 'text' | 'json' | 'vision' | 'audio' | 'image';
export type UsageSource = 'estimated' | 'provider_reported';
export type TaskClass =
  | 'classification'
  | 'extraction'
  | 'summarization'
  | 'code_inspection'
  | 'reasoning'
  | 'planning'
  | 'review';
export type LatencyTier = 'low' | 'medium' | 'high';
export type FetchLike = typeof fetch;

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
};

/** AI3.5 - AI3.6: Explicit capability flags, never assumed universal. */
export interface ProviderCapabilities {
  readonly textGeneration: boolean;
  readonly toolCall: boolean;
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
}

/** AI3.7, AI3.17: Model identity, limits, and pricing metadata (separate from transport). */
export interface ModelPricingConfig {
  /** Micro-USD (1e-6 USD) per 1,000,000 input tokens (integer >= 0). */
  readonly inputMicrosPerMillionTokens: number;
  /** Micro-USD (1e-6 USD) per 1,000,000 output tokens (integer >= 0). */
  readonly outputMicrosPerMillionTokens: number;
}

export interface RateLimitConfig {
  readonly maxRequestsPerMinute?: number;
  readonly maxTokensPerMinute?: number;
  readonly maxConcurrency?: number;
}

export interface ProviderExecutionLimits {
  /** Hard per-attempt request timeout in ms (100..600_000). */
  readonly timeoutMs: number;
  /** Maximum concurrent in-flight requests for this provider instance (>= 1). */
  readonly maxConcurrent: number;
  /** Maximum waiters in semaphore queue before fail-fast (0 = no queueing). */
  readonly maxQueueDepth: number;
  /** Max time a caller waits for a concurrency slot in ms (>= 0). */
  readonly queueTimeoutMs: number;
  /** Optional requests-per-minute cap (sliding window, >= 1). */
  readonly maxRequestsPerMinute?: number;
  /** Optional tokens-per-minute cap (sliding window, >= 1). */
  readonly maxTokensPerMinute?: number;
}

export interface ModelProfileConfig {
  readonly id: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly modelName: string;
  readonly capabilities: ProviderCapabilities;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly modalities: readonly ModelModality[];
  readonly pricing?: ModelPricingConfig;
  readonly rateLimits?: RateLimitConfig;
  readonly defaultTemperature?: number;
  readonly supportsSystemPrompt?: boolean;
}

/** AI3.23: Credential resolution strictly via approved secret references (never raw secrets in ORM). */
export type SecretResolver = (
  secretRef: string,
  companyId?: number
) => Promise<string | null | undefined> | string | null | undefined;

export type AiSecretResolver = (
  secretRef: string,
  companyId: number
) => Promise<string | null> | string | null;

/** AI3.4: JSON Schema subset contract (zero external npm dependencies). */
export type JsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface JsonSchemaNode {
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly items?: JsonSchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly enum?: readonly JsonValue[];
  readonly const?: JsonValue;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface SchemaValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type SchemaValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly SchemaValidationIssue[] };

export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaNode;
  readonly strict?: boolean;
}

export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly AiToolCall[];
}

export interface ResponseSchemaOption {
  readonly name: string;
  readonly schema: JsonSchemaNode;
  readonly strict?: boolean;
}

/** AI3.3: Request envelope with correlation ID, timeout, cancellation, and data classification. */
export interface ProviderRequest {
  readonly correlationId: string;
  readonly model: ModelProfileConfig;
  readonly messages: readonly AiMessage[];
  readonly dataClassification: DataClassification;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly tools?: readonly AiToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required' | { readonly name: string };
  readonly responseSchema?: ResponseSchemaOption;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly companyId?: number;
  readonly workContractId?: string;
  readonly runId?: string;
}

/** AI3.27: Explicit estimated vs. provider-reported token and micro-USD cost accounting. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly source: UsageSource;
  readonly estimatedCostMicros: number;
}

export type ProviderFinishReason = 'stop' | 'tool_calls' | 'length' | 'policy_blocked' | 'unknown';

export interface ProviderResponse {
  readonly correlationId: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly modelName: string;
  readonly text: string;
  readonly structuredOutput?: JsonValue;
  readonly toolCalls: readonly AiToolCall[];
  readonly finishReason: ProviderFinishReason;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly rawRedactedMeta: Readonly<Record<string, JsonValue>>;
}

/** AI3.6: Optional streaming event union for providers with capabilities.streaming === true. */
export type ProviderStreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | {
      readonly type: 'tool_call_delta';
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta: string;
    }
  | { readonly type: 'completed'; readonly response: ProviderResponse };

/** AI3.9: Prompt-free health check result. */
export interface ProviderHealthStatus {
  readonly ok: boolean;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly availableModels?: readonly string[];
  readonly errorCode?: ProviderErrorCode;
  readonly reasonCode?: ProviderErrorReasonCode;
  readonly detail?: string;
}

/** AI3.8: Retryable vs non-retryable typed error taxonomy. */
export type ProviderErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'outage'
  | 'malformed_response'
  | 'cancelled'
  | 'auth_failed'
  | 'policy_blocked';

export type ProviderErrorReasonCode =
  | 'CONCURRENCY_LIMIT_EXCEEDED'
  | 'QUEUE_TIMEOUT'
  | 'CAPABILITY_UNSUPPORTED'
  | 'CLASSIFICATION_EGRESS_BLOCKED'
  | 'CLASSIFICATION_FALLBACK_BLOCKED'
  | 'INVALID_CLASSIFICATION_OVERRIDE'
  | 'SECRET_UNAVAILABLE'
  | 'INVALID_SECRET_REF'
  | 'MALFORMED_STRUCTURED_OUTPUT'
  | 'RESPONSE_TOO_LARGE'
  | 'NO_ELIGIBLE_MODEL'
  | 'INVALID_ENDPOINT'
  | (string & {});

export const RETRYABLE_PROVIDER_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'timeout',
  'rate_limited',
  'outage',
]);

export interface ProviderErrorOptions {
  readonly code: ProviderErrorCode;
  readonly reasonCode?: ProviderErrorReasonCode;
  readonly providerId: string;
  readonly correlationId: string;
  readonly retryable?: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly reasonCode?: ProviderErrorReasonCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly providerId: string;
  readonly correlationId: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = options.code;
    this.reasonCode = options.reasonCode;
    this.retryable = options.retryable ?? RETRYABLE_PROVIDER_ERROR_CODES.has(options.code);
    this.statusCode = options.statusCode;
    this.providerId = options.providerId;
    this.correlationId = options.correlationId;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** AI3.1 - AI3.2: Transport interface (runtime/service layer, never ORM). */
export interface AiProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus>;
  generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
  stream?(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

/** AI3.2, AI4.21: AgentHarness stub strictly separated from AiProvider transport. */
export interface AgentHarnessStep {
  readonly stepIndex: number;
  readonly finishReason: ProviderFinishReason;
  readonly toolCallsRequested: number;
  readonly usage: TokenUsage;
}

export interface AgentHarnessInput {
  readonly runId: string;
  readonly correlationId: string;
  readonly model: ModelProfileConfig;
  readonly dataClassification: DataClassification;
  readonly systemPolicy: string;
  readonly taskPrompt: string;
  readonly untrustedInputs?: Readonly<Record<string, JsonValue>>;
  readonly allowedTools: readonly AiToolDefinition[];
  readonly maxSteps: number;
  readonly maxDurationMs: number;
  readonly maxTotalTokens?: number;
  readonly responseSchema?: ResponseSchemaOption;
}

export interface AgentHarnessResult {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
  readonly outputText: string;
  readonly structuredOutput?: JsonValue;
  readonly steps: readonly AgentHarnessStep[];
  readonly totalUsage: TokenUsage;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface AgentHarness {
  readonly id: string;
  execute(
    input: AgentHarnessInput,
    executeTool: (call: AiToolCall, signal: AbortSignal) => Promise<JsonValue>,
    signal?: AbortSignal
  ): Promise<AgentHarnessResult>;
}
