import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicWebhookAddress, validateWebhookUrl } from '@moonwitness/orm-integration';
import type { JsonValue } from '@moonwitness/types';
import { isLoopbackHostname } from '@moonwitness/types';
import { sanitizeProviderMessage, type RedactionContext } from '../redaction.js';
import { composeAttemptSignal } from '../resilience.js';
import { validateJsonSchema } from '../schema-validator.js';
import type {
  FetchLike,
  ProviderCapabilities,
  ProviderRequest,
  ResponseSchemaOption,
} from '../types.js';
import { ProviderError } from '../types.js';

export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Exact origin of the vendored gateway; the adapter appends `/v1` itself. */
export const FREELMAPI_APPROVED_ORIGIN = 'http://freellmapi:3001';

export { isLoopbackHostname } from '@moonwitness/types';

/** Exact-origin match for explicitly approved private inference gateways. */
export function matchesApprovedPrivateOrigin(
  url: URL,
  approvedOrigins: readonly string[] = [FREELMAPI_APPROVED_ORIGIN]
): boolean {
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    return false;
  }
  return approvedOrigins.some((origin) => {
    try {
      const approved = new URL(origin);
      return (
        url.protocol === approved.protocol &&
        url.hostname.replace(/^\[|\]$/gu, '').toLowerCase() ===
          approved.hostname.replace(/^\[|\]$/gu, '').toLowerCase() &&
        url.port === approved.port
      );
    } catch {
      return false;
    }
  });
}

export function validateLoopbackEndpointUrl(
  value: string | URL,
  providerId = 'ollama',
  correlationId = 'endpoint-validation'
): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new ProviderError('Invalid loopback endpoint URL', {
      code: 'policy_blocked',
      reasonCode: 'INVALID_ENDPOINT',
      providerId,
      correlationId,
      retryable: false,
    });
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !isLoopbackHostname(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ProviderError(
      'Local endpoint URL must use http/https on a loopback host without credentials, query, or fragment',
      {
        code: 'policy_blocked',
        reasonCode: 'INVALID_ENDPOINT',
        providerId,
        correlationId,
        retryable: false,
      }
    );
  }

  return url;
}

export function validateCloudOrEndpointUrl(
  value: string | URL,
  options: {
    readonly allowLoopbackHttp?: boolean;
    readonly approvedPrivateOrigins?: readonly string[];
    readonly providerId: string;
    readonly correlationId?: string;
  }
): URL {
  const correlationId = options.correlationId ?? 'endpoint-validation';
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new ProviderError('Invalid provider endpoint URL', {
      code: 'policy_blocked',
      reasonCode: 'INVALID_ENDPOINT',
      providerId: options.providerId,
      correlationId,
      retryable: false,
    });
  }

  if (options.allowLoopbackHttp && isLoopbackHostname(url.hostname)) {
    return validateLoopbackEndpointUrl(url, options.providerId, correlationId);
  }
  if (
    options.approvedPrivateOrigins?.length &&
    matchesApprovedPrivateOrigin(url, options.approvedPrivateOrigins)
  ) {
    return url;
  }

  try {
    validateWebhookUrl(url.toString());
  } catch {
    throw new ProviderError('Provider endpoint URL failed SSRF / HTTPS validation', {
      code: 'policy_blocked',
      reasonCode: 'INVALID_ENDPOINT',
      providerId: options.providerId,
      correlationId,
      retryable: false,
    });
  }

  if (url.search) {
    throw new ProviderError('Provider endpoint URL must not contain query parameters', {
      code: 'policy_blocked',
      reasonCode: 'INVALID_ENDPOINT',
      providerId: options.providerId,
      correlationId,
      retryable: false,
    });
  }

  return url;
}

export async function assertPublicDnsResolution(
  url: URL,
  options: {
    readonly providerId: string;
    readonly correlationId: string;
    readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
  }
): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host) !== 0) {
    if (!isPublicWebhookAddress(host)) {
      throw new ProviderError('Remote provider IP address is non-public (SSRF blocked)', {
        code: 'policy_blocked',
        reasonCode: 'INVALID_ENDPOINT',
        providerId: options.providerId,
        correlationId: options.correlationId,
        retryable: false,
      });
    }
    return;
  }

  const resolver =
    options.resolveAddresses ??
    ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const records = await resolver(host);
  if (records.length === 0 || records.some((record) => !isPublicWebhookAddress(record.address))) {
    throw new ProviderError('Remote provider DNS resolution failed public-IP SSRF check', {
      code: 'policy_blocked',
      reasonCode: 'INVALID_ENDPOINT',
      providerId: options.providerId,
      correlationId: options.correlationId,
      retryable: false,
    });
  }
}

export function validateRequestCapabilities(
  providerId: string,
  providerCapabilities: ProviderCapabilities,
  request: ProviderRequest,
  requireStreaming = false
): void {
  const mutableReq = request as unknown as {
    correlationId?: string;
    dataClassification?: string;
    model?: ProviderRequest['model'] | string;
  };
  if (typeof mutableReq.correlationId !== 'string' || !mutableReq.correlationId) {
    mutableReq.correlationId = 'corr-auto';
  }
  if (typeof mutableReq.dataClassification !== 'string' || !mutableReq.dataClassification) {
    mutableReq.dataClassification = 'local_only';
  }
  if (typeof mutableReq.model !== 'object' || mutableReq.model === null) {
    const modelStr =
      typeof mutableReq.model === 'string' &&
      mutableReq.model.trim().length > 0 &&
      mutableReq.model !== 'default'
        ? mutableReq.model
        : 'default-model';
    mutableReq.model = {
      id: modelStr,
      providerId,
      providerKind: 'mock',
      modelName: modelStr,
      capabilities: providerCapabilities,
      contextWindowTokens: 16_384,
      maxOutputTokens: 2_048,
      modalities: ['text'],
    };
  }

  const modelCapabilities = request.model.capabilities;

  if (!providerCapabilities.textGeneration || !modelCapabilities.textGeneration) {
    throw new ProviderError(
      `Text generation capability disabled for provider "${providerId}" / model "${request.model.modelName}"`,
      {
        code: 'policy_blocked',
        reasonCode: 'CAPABILITY_UNSUPPORTED',
        providerId,
        correlationId: request.correlationId,
        retryable: false,
      }
    );
  }

  if (requireStreaming && (!providerCapabilities.streaming || !modelCapabilities.streaming)) {
    throw new ProviderError(
      `Streaming capability disabled for provider "${providerId}" / model "${request.model.modelName}"`,
      {
        code: 'policy_blocked',
        reasonCode: 'CAPABILITY_UNSUPPORTED',
        providerId,
        correlationId: request.correlationId,
        retryable: false,
      }
    );
  }

  if (
    request.tools &&
    request.tools.length > 0 &&
    (!providerCapabilities.toolCall || !modelCapabilities.toolCall)
  ) {
    throw new ProviderError(
      `Tool calling is not supported by provider "${providerId}" / model "${request.model.modelName}"`,
      {
        code: 'policy_blocked',
        reasonCode: 'CAPABILITY_UNSUPPORTED',
        providerId,
        correlationId: request.correlationId,
        retryable: false,
      }
    );
  }

  if (
    request.responseSchema &&
    (!providerCapabilities.structuredOutput || !modelCapabilities.structuredOutput)
  ) {
    throw new ProviderError(
      `Structured output is not supported by provider "${providerId}" / model "${request.model.modelName}"`,
      {
        code: 'policy_blocked',
        reasonCode: 'CAPABILITY_UNSUPPORTED',
        providerId,
        correlationId: request.correlationId,
        retryable: false,
      }
    );
  }
}

export function parseAndValidateStructuredOutput(
  rawText: string,
  responseSchema: ResponseSchemaOption,
  providerId: string,
  correlationId: string,
  redactor?: RedactionContext
): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const safeMsg = redactor
      ? redactor.redactString(error instanceof Error ? error.message : String(error))
      : sanitizeProviderMessage(error instanceof Error ? error.message : String(error));
    throw new ProviderError(`Provider returned invalid JSON for structured output: ${safeMsg}`, {
      code: 'malformed_response',
      reasonCode: 'MALFORMED_STRUCTURED_OUTPUT',
      providerId,
      correlationId,
      retryable: false,
      cause: error,
    });
  }

  const validation = validateJsonSchema(responseSchema.schema, parsed);
  if (!validation.valid) {
    const summary = validation.errors
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new ProviderError(
      `Structured output failed schema "${responseSchema.name}" validation: ${summary}`,
      {
        code: 'malformed_response',
        reasonCode: 'MALFORMED_STRUCTURED_OUTPUT',
        providerId,
        correlationId,
        retryable: false,
      }
    );
  }

  return parsed as JsonValue;
}

export function parseRetryAfterHeaderMs(headers: Headers): number | undefined {
  const retryAfterMsHeader = headers.get('retry-after-ms');
  if (retryAfterMsHeader) {
    const parsedMs = Number.parseFloat(retryAfterMsHeader);
    if (Number.isFinite(parsedMs) && parsedMs >= 0) {
      return Math.ceil(parsedMs);
    }
  }

  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const trimmed = retryAfter.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  providerId: string,
  correlationId: string,
  redactor?: RedactionContext
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new ProviderError(
        `Provider response exceeded max allowed bytes (${declaredLength} > ${maxBytes})`,
        {
          code: 'malformed_response',
          reasonCode: 'RESPONSE_TOO_LARGE',
          providerId,
          correlationId,
          retryable: false,
        }
      );
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const msg = redactor
      ? redactor.redactString(error instanceof Error ? error.message : String(error))
      : sanitizeProviderMessage(error instanceof Error ? error.message : String(error));
    throw new ProviderError(`Failed reading provider response body: ${msg}`, {
      code: 'malformed_response',
      providerId,
      correlationId,
      retryable: false,
      cause: error,
    });
  }

  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > maxBytes) {
    throw new ProviderError(
      `Provider response body exceeded max allowed bytes (${byteLength} > ${maxBytes})`,
      {
        code: 'malformed_response',
        reasonCode: 'RESPONSE_TOO_LARGE',
        providerId,
        correlationId,
        retryable: false,
      }
    );
  }

  return text;
}

export async function runWithProviderAttempt<T>(params: {
  readonly timeoutMs: number;
  readonly callerSignal?: AbortSignal;
  readonly providerId: string;
  readonly correlationId: string;
  readonly redactor?: RedactionContext;
  readonly fn: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const attempt = composeAttemptSignal(
    params.timeoutMs,
    params.callerSignal,
    params.providerId,
    params.correlationId
  );

  try {
    return await params.fn(attempt.signal);
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (attempt.isCallerAborted()) {
      throw new ProviderError('Provider request cancelled by caller signal', {
        code: 'cancelled',
        providerId: params.providerId,
        correlationId: params.correlationId,
        retryable: false,
        cause: params.redactor ? params.redactor.redactError(error) : undefined,
      });
    }
    if (attempt.isTimedOut() || (error instanceof Error && error.name === 'TimeoutError')) {
      throw new ProviderError(`Provider request timed out after ${params.timeoutMs}ms`, {
        code: 'timeout',
        providerId: params.providerId,
        correlationId: params.correlationId,
        retryable: true,
        cause: params.redactor ? params.redactor.redactError(error) : undefined,
      });
    }
    const rawMsg = error instanceof Error ? error.message : String(error);
    const safeMsg = params.redactor
      ? params.redactor.redactString(rawMsg)
      : sanitizeProviderMessage(rawMsg);
    throw new ProviderError(`Provider transport failure: ${safeMsg}`, {
      code: 'outage',
      providerId: params.providerId,
      correlationId: params.correlationId,
      retryable: true,
      cause: params.redactor ? params.redactor.redactError(error) : undefined,
    });
  } finally {
    attempt.cleanup();
  }
}

export async function fetchWithProviderTimeout(params: {
  readonly fetchFn: FetchLike;
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMs: number;
  readonly callerSignal?: AbortSignal;
  readonly providerId: string;
  readonly correlationId: string;
  readonly redactor?: RedactionContext;
}): Promise<Response> {
  return runWithProviderAttempt({
    timeoutMs: params.timeoutMs,
    callerSignal: params.callerSignal,
    providerId: params.providerId,
    correlationId: params.correlationId,
    redactor: params.redactor,
    fn: (signal) =>
      params.fetchFn(params.url, {
        ...params.init,
        redirect: 'error',
        signal,
      }),
  });
}

export function buildUrlPath(baseUrl: URL, path: string): string {
  const basePath = baseUrl.pathname.endsWith('/')
    ? baseUrl.pathname.slice(0, -1)
    : baseUrl.pathname;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl.origin}${basePath}${suffix}`;
}
