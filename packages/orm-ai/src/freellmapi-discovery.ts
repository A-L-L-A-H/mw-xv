import { createHash } from 'node:crypto';
import type { FetchLike } from '@moonwitness/ai-runtime';
import { FREELMAPI_COMPOSE_ORIGIN } from './models/constants.js';
import { assertValidProviderSecretRef } from './validation.js';
import { ModelProfile, ProviderProfile } from './models.js';

const MAX_DISCOVERY_BYTES = 2 * 1024 * 1024;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,191}$/u;

export interface DiscoveredGatewayModel {
  readonly modelId: string;
  readonly ownedBy?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
}

export class DiscoveryError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 502) {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertExactOrigin(origin: string, allowedOrigins: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new DiscoveryError('INVALID_ORIGIN', 'Gateway origin must be a valid URL', 400);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new DiscoveryError('INVALID_ORIGIN', 'Gateway origin must be an exact origin', 400);
  }
  if (!allowedOrigins.includes(`${url.protocol}//${url.host}`)) {
    throw new DiscoveryError(
      'ORIGIN_NOT_APPROVED',
      'Gateway origin is not on the approved list',
      403
    );
  }
  return url;
}

function resolveSecret(env: NodeJS.ProcessEnv, secretRef: string): string {
  assertValidProviderSecretRef(secretRef);
  const value = env[secretRef];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DiscoveryError('SECRET_UNAVAILABLE', 'Unified inference key is not configured', 503);
  }
  return value.trim();
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body)
    throw new DiscoveryError('EMPTY_DISCOVERY_RESPONSE', 'Gateway returned no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
    if (total > MAX_DISCOVERY_BYTES) {
      throw new DiscoveryError(
        'DISCOVERY_RESPONSE_TOO_LARGE',
        'Gateway model list exceeded its byte limit'
      );
    }
    if (value) chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Operator-only discovery against the real gateway; no model id is invented. */
export async function discoverGatewayModels(params: {
  readonly origin?: string;
  readonly secretRef: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: FetchLike;
  readonly allowedOrigins?: readonly string[];
}): Promise<readonly DiscoveredGatewayModel[]> {
  const allowedOrigins = params.allowedOrigins ?? [FREELMAPI_COMPOSE_ORIGIN];
  const origin = assertExactOrigin(params.origin ?? FREELMAPI_COMPOSE_ORIGIN, allowedOrigins);
  const token = resolveSecret(params.env ?? process.env, params.secretRef);
  const fetchFn = params.fetch ?? globalThis.fetch;
  const url = new URL('/v1/models?available=true', origin).toString();
  let response: Response;
  try {
    response = (await fetchFn(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })) as Response;
  } catch (error) {
    throw new DiscoveryError(
      'GATEWAY_UNAVAILABLE',
      `Gateway model discovery failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new DiscoveryError('GATEWAY_ERROR', `Gateway returned HTTP ${response.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBounded(response));
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError('INVALID_DISCOVERY_RESPONSE', 'Gateway returned malformed JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { data?: unknown }).data)
  ) {
    throw new DiscoveryError(
      'INVALID_DISCOVERY_RESPONSE',
      'Gateway response must contain a data array'
    );
  }
  const models: DiscoveredGatewayModel[] = [];
  const seen = new Set<string>();
  for (const raw of (parsed as { data: unknown[] }).data) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.id !== 'string' || !MODEL_ID.test(record.id) || seen.has(record.id)) continue;
    seen.add(record.id);
    const boundedNumber = (value: unknown, max: number): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
        ? Math.floor(value)
        : undefined;
    models.push({
      modelId: record.id,
      ...(typeof record.owned_by === 'string' ? { ownedBy: record.owned_by.slice(0, 128) } : {}),
      ...(boundedNumber(record.context_window ?? record.contextWindow, 2_000_000) === undefined
        ? {}
        : {
            contextWindow: boundedNumber(record.context_window ?? record.contextWindow, 2_000_000),
          }),
      ...(boundedNumber(record.max_output_tokens ?? record.maxOutputTokens, 1_000_000) === undefined
        ? {}
        : {
            maxOutputTokens: boundedNumber(
              record.max_output_tokens ?? record.maxOutputTokens,
              1_000_000
            ),
          }),
      ...(typeof record.supports_tools === 'boolean'
        ? { supportsTools: record.supports_tools }
        : {}),
      ...(typeof record.supports_streaming === 'boolean'
        ? { supportsStreaming: record.supports_streaming }
        : {}),
    });
    if (models.length >= 500) break;
  }
  if (models.length === 0) {
    throw new DiscoveryError(
      'NO_MODELS_DISCOVERED',
      'Gateway did not expose any usable model ids',
      404
    );
  }
  return models;
}

function slugForModel(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '_')
    .replace(/^[^a-z]+/u, '')
    .slice(0, 120);
  const suffix = createHash('sha256').update(modelId, 'utf8').digest('hex').slice(0, 8);
  return `${slug || 'model'}_${suffix}`;
}

/** Persists only gateway-reported model ids; no fabricated default model row. */
export async function upsertDiscoveredModels(params: {
  readonly companyId: number;
  readonly providerId: number;
  readonly models: readonly DiscoveredGatewayModel[];
}): Promise<
  readonly { readonly id: number; readonly modelId: string; readonly created: boolean }[]
> {
  const provider = await ProviderProfile.query().findOne({
    id: params.providerId,
    company_id: params.companyId,
  });
  if (!provider) throw new DiscoveryError('PROVIDER_NOT_FOUND', 'Provider profile not found', 404);
  const results: { id: number; modelId: string; created: boolean }[] = [];
  for (const model of params.models) {
    const code = slugForModel(model.modelId);
    const existing = await ModelProfile.query().findOne({
      company_id: params.companyId,
      provider_profile_id: params.providerId,
      model_id: model.modelId,
    });
    if (existing) {
      await ModelProfile.query()
        .findById(existing.id)
        .patch({
          name: model.modelId,
          code,
          context_window: model.contextWindow ?? existing.context_window,
          max_output_tokens: model.maxOutputTokens ?? existing.max_output_tokens,
          supports_tools: model.supportsTools ?? existing.supports_tools,
          supports_streaming: model.supportsStreaming ?? existing.supports_streaming,
        });
      results.push({ id: existing.id, modelId: model.modelId, created: false });
      continue;
    }
    const created = await ModelProfile.query().insertAndFetch({
      company_id: params.companyId,
      provider_profile_id: params.providerId,
      code,
      name: model.modelId,
      model_id: model.modelId,
      context_window: model.contextWindow ?? 8_192,
      max_output_tokens: model.maxOutputTokens ?? 2_048,
      supports_tools: model.supportsTools ?? false,
      supports_streaming: model.supportsStreaming ?? false,
      supports_structured_output: true,
      modalities_json: '["text"]',
      enabled: false,
    });
    results.push({ id: created.id, modelId: model.modelId, created: true });
  }
  return results;
}

/** Selects a discovered model as the coding-agent default; fails closed if absent. */
export async function selectCodingAgentModel(params: {
  readonly companyId: number;
  readonly providerId: number;
  readonly modelId: string;
}): Promise<{ readonly id: number; readonly modelId: string }> {
  if (!MODEL_ID.test(params.modelId)) {
    throw new DiscoveryError('INVALID_MODEL_ID', 'Model id failed validation', 400);
  }
  const model = await ModelProfile.query().findOne({
    company_id: params.companyId,
    provider_profile_id: params.providerId,
    model_id: params.modelId,
  });
  if (!model)
    throw new DiscoveryError('MODEL_NOT_DISCOVERED', 'Model has not been discovered', 404);
  await ModelProfile.query()
    .where({ company_id: params.companyId, provider_profile_id: params.providerId })
    .patch({ enabled: false });
  await ModelProfile.query().findById(model.id).patch({ enabled: true });
  await ProviderProfile.query().findById(params.providerId).patch({ enabled: true });
  return { id: model.id, modelId: model.model_id };
}
