import {
  CloudProviderAdapter,
  createEnvSecretResolver,
  DataClassificationRouter,
  FREELMAPI_APPROVED_ORIGIN,
  normalizeDataClassification,
} from '@moonwitness/ai-runtime';
import type {
  AiProvider,
  AiToolCall,
  AiToolDefinition,
  CapabilityGateway,
  ClassificationRoutingPolicy,
  GatewayInvokeResult,
  ModelModality,
  ModelProfileConfig,
  ProviderCapabilities,
  SecretResolver,
  ToolExecutionContext,
  TypedToolDefinition,
} from '@moonwitness/ai-runtime';
import type { TrustedRunSnapshot } from './agent-run-executor.js';
import { ModelProfile } from './models.js';

// JsonValue / JsonObject live in @moonwitness/types, which ai-runtime imports
// but does not re-export. Derive the exact structural shapes from ai-runtime's
// own exported contracts so this package keeps a single source of truth.
type JsonObject = AiToolCall['arguments'];
type JsonValue = Extract<GatewayInvokeResult, { readonly allowed: true }>['output'];

const CLOUD_KINDS = ['openai', 'anthropic', 'freellmapi'] as const;
type CloudKind = (typeof CLOUD_KINDS)[number];

const MODEL_MODALITIES = new Set<ModelModality>(['text', 'json', 'vision', 'audio', 'image']);

export interface TrustedProviderBinding {
  readonly provider: AiProvider;
  readonly model: ModelProfileConfig;
  readonly router?: DataClassificationRouter;
  readonly routingPolicy: ClassificationRoutingPolicy;
}

function requireCloudKind(kind: string): CloudKind {
  if (kind === 'openai' || kind === 'anthropic' || kind === 'freellmapi') return kind;
  throw new Error(
    `Unsupported provider kind "${kind}" in trusted snapshot; expected openai, anthropic or freellmapi`
  );
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function parseModalities(value: unknown): readonly ModelModality[] {
  if (typeof value !== 'string' || value.trim() === '') return ['text'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return ['text'];
  }
  if (!Array.isArray(parsed)) return ['text'];
  const modalities = parsed.filter(
    (item): item is ModelModality =>
      typeof item === 'string' && MODEL_MODALITIES.has(item as ModelModality)
  );
  return modalities.length > 0 ? modalities : ['text'];
}

function mapModelProfile(
  row: Record<string, unknown>,
  providerKind: CloudKind
): ModelProfileConfig {
  const capabilities: ProviderCapabilities = {
    textGeneration: true,
    toolCall: row.supports_tools === true,
    streaming: row.supports_streaming === true,
    structuredOutput: row.supports_structured_output !== false,
  };
  return {
    id: String(row.id),
    providerId: String(row.provider_profile_id ?? 0),
    providerKind,
    modelName: String(row.model_id ?? row.code ?? 'unknown-model'),
    capabilities,
    contextWindowTokens: positiveInteger(row.context_window, 8_192),
    maxOutputTokens: positiveInteger(row.max_output_tokens, 2_048),
    modalities: parseModalities(row.modalities_json),
  };
}

/**
 * Turns an immutable, secret-free TrustedRunSnapshot into a cloud provider
 * binding. Every authority value comes from the snapshot or the ORM row; no
 * client-supplied configuration is used and no raw credential is ever stored.
 */
export async function createTrustedProviderBinding(options: {
  readonly snapshot: TrustedRunSnapshot;
  readonly secretResolver?: SecretResolver;
  readonly gatewayOrigin?: string;
  readonly approvedOrigins?: readonly string[];
  readonly fetch?: typeof fetch;
}): Promise<TrustedProviderBinding> {
  const { snapshot } = options;
  const modelProfileId = Number(snapshot.run.model_profile_id);
  if (!Number.isSafeInteger(modelProfileId) || modelProfileId < 1) {
    throw new Error('Trusted run snapshot has no valid model_profile_id');
  }
  const row = await ModelProfile.query().findById(modelProfileId);
  if (!row) {
    throw new Error(
      `Model profile ${modelProfileId} referenced by trusted run ${snapshot.runId} is missing`
    );
  }

  const providerKind = requireCloudKind(snapshot.providerKind);
  const model = mapModelProfile(row as unknown as Record<string, unknown>, providerKind);

  // Fail closed: resolve credentials only through an approved secret reference,
  // scoped to the company that owns the run.
  const envResolver = createEnvSecretResolver(process.env);
  const secretResolver: SecretResolver =
    options.secretResolver ??
    ((secretRef, companyId) => envResolver(secretRef, companyId ?? snapshot.companyId));

  const provider = new CloudProviderAdapter({
    kind: providerKind,
    secretRef: snapshot.secretRefName,
    secretResolver,
    baseUrl: options.gatewayOrigin ?? FREELMAPI_APPROVED_ORIGIN,
    approvedPrivateOrigins: options.approvedOrigins ?? [FREELMAPI_APPROVED_ORIGIN],
    model: model.modelName,
    capabilities: model.capabilities,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const routingPolicy: ClassificationRoutingPolicy = {
    allowedClassification: normalizeDataClassification(snapshot.classification),
    allowCloudFallback: false,
  };
  const router = new DataClassificationRouter({
    targets: [{ id: provider.id, provider, model, deploymentZone: 'cloud' }],
  });

  return { provider, model, router, routingPolicy };
}

/** Maps governed gateway tools into the provider-agnostic harness tool shape. */
export function mapToolsToHarnessDefinitions(
  tools: readonly TypedToolDefinition[]
): AiToolDefinition[] {
  return tools.map((tool) => {
    const declaredStrict = (tool as TypedToolDefinition & { readonly strict?: unknown }).strict;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      strict:
        typeof declaredStrict === 'boolean'
          ? declaredStrict
          : tool.inputSchema.additionalProperties === false,
    };
  });
}

/** Bridges provider tool calls to the capability gateway's policy decision. */
export function createGatewayToolExecutor(
  gateway: CapabilityGateway,
  context: ToolExecutionContext
): (call: AiToolCall, signal: AbortSignal) => Promise<JsonValue> {
  return async (call: AiToolCall, signal: AbortSignal): Promise<JsonValue> => {
    const result = await gateway.invoke(call.name, call.arguments as JsonObject, {
      ...context,
      signal,
    });
    if (!result.allowed) {
      throw new Error(`Gateway denied tool "${call.name}": ${result.denial.reasonCode}`);
    }
    return result.output;
  };
}
