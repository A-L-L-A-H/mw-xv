import type {
  AiMessage,
  AiToolDefinition,
  ModelPricingConfig,
  ProviderRequest,
  TokenUsage,
  UsageSource,
} from './types.js';

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function estimateMessagesTokens(
  messages: readonly AiMessage[],
  tools?: readonly AiToolDefinition[]
): number {
  let total = 0;
  for (const message of messages) {
    total += 4;
    total += estimateTokenCount(message.content);
    if (message.toolName) {
      total += estimateTokenCount(message.toolName);
    }
    if (message.toolCalls) {
      total += estimateTokenCount(JSON.stringify(message.toolCalls));
    }
  }
  if (tools && tools.length > 0) {
    total += estimateTokenCount(JSON.stringify(tools));
  }
  return total;
}

export function estimateRequestInputTokens(request: ProviderRequest): number {
  let total = estimateMessagesTokens(request.messages, request.tools);
  if (request.responseSchema) {
    total += estimateTokenCount(JSON.stringify(request.responseSchema.schema));
  }
  return total;
}

export function computeEstimatedCostMicros(
  inputTokens: number,
  outputTokens: number,
  pricing?: ModelPricingConfig
): number {
  if (!pricing) return 0;
  const safeInput = Math.max(0, Math.floor(inputTokens));
  const safeOutput = Math.max(0, Math.floor(outputTokens));
  if (pricing.inputMicrosPerMillionTokens === 0 && pricing.outputMicrosPerMillionTokens === 0) {
    return 0;
  }
  return Math.ceil(
    (safeInput * pricing.inputMicrosPerMillionTokens +
      safeOutput * pricing.outputMicrosPerMillionTokens) /
      1_000_000
  );
}

export function computeCostMicrosFromPer1kRates(
  inputTokens: number,
  outputTokens: number,
  inputCostMicrosPer1k: number,
  outputCostMicrosPer1k: number
): number {
  const safeInput = Math.max(0, Math.floor(inputTokens));
  const safeOutput = Math.max(0, Math.floor(outputTokens));
  if (inputCostMicrosPer1k === 0 && outputCostMicrosPer1k === 0) return 0;
  return Math.ceil((safeInput * inputCostMicrosPer1k + safeOutput * outputCostMicrosPer1k) / 1000);
}

export function buildTokenUsage(params: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly source: UsageSource;
  readonly pricing?: ModelPricingConfig;
}): TokenUsage {
  const inputTokens = Math.max(0, Math.floor(params.inputTokens));
  const outputTokens = Math.max(0, Math.floor(params.outputTokens));
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: params.source,
    estimatedCostMicros: computeEstimatedCostMicros(inputTokens, outputTokens, params.pricing),
  };
}
