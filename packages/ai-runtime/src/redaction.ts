const MAX_REDACTION_DEPTH = 12;
const MAX_ERROR_CAUSE_DEPTH = 5;

// Keys are headers (x-api-key), env var names, and bracket notations.
// Restrict property writes to that character set so a hostile payload
// cannot inject arbitrary object property names.
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:\/\-\[\]()@]{0,255}$/u;
const UNSAFE_KEY_MARKER = '[unsafe-key-redacted]';

const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|proxy-authorization|x-api-key|api[-_]?key|secret|password|token|access_token|refresh_token|cookie|set-cookie|credential|credentials)$/iu;

const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/giu;
const PROVIDER_KEY_PATTERN = new RegExp(
  '\\b' + 'sk' + '-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{12,}\\b',
  'gu'
);
const HEADER_KEY_INLINE_PATTERN =
  /\b(x-api-key|authorization|proxy-authorization)\s*[:=]\s*(?!\[REDACTED(?:_[A-Z0-9_]+)?\])[^\s,;'"}\]]+/giu;
const URL_USERINFO_PATTERN = /(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/giu;
const URL_QUERY_SECRET_PATTERN =
  /([?&](?:key|api_key|apikey|token|access_token|secret|password)=)[^&#\s]+/giu;
const KV_SECRET_PATTERN =
  /\b(password|secret|token|credential|api_key|apikey|MW_AI_[A-Z0-9_]+)\s*[:=]\s*["']?(?!\[REDACTED(?:_[A-Z0-9_]+)?\])[^\s,;'"}\]]+["']?/giu;

export const AI_LOGGER_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers["x-api-key"]',
  'headers["api-key"]',
  '*.headers.authorization',
  '*.headers["x-api-key"]',
  '*.headers["api-key"]',
  'password',
  '*.password',
  'refresh_token',
  '*.refresh_token',
  'access_token',
  '*.access_token',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
];

export interface SanitizedErrorInfo {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly reasonCode?: string;
  readonly statusCode?: number;
  readonly stack?: string;
  readonly cause?: SanitizedErrorInfo;
}

export interface RedactionContext {
  registerSecret(secret: string | null | undefined): void;
  redactString(input: string): string;
  redactObject<T>(input: T): T;
  redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string>;
  redactError(error: unknown): SanitizedErrorInfo;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildSecretVariants(secret: string): string[] {
  const variants = new Set<string>();
  const trimmed = secret.trim();
  if (trimmed.length >= 6) {
    variants.add(trimmed);
    const urlEncoded = encodeURIComponent(trimmed);
    if (urlEncoded.length >= 6) {
      variants.add(urlEncoded);
    }
    const base64Encoded = Buffer.from(trimmed, 'utf8').toString('base64');
    if (base64Encoded.length >= 8) {
      variants.add(base64Encoded);
    }
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function redactStringWithSecrets(input: string, registeredSecrets: ReadonlySet<string>): string {
  let output = input;

  for (const secret of registeredSecrets) {
    for (const variant of buildSecretVariants(secret)) {
      const pattern = new RegExp(escapeRegExp(variant), 'g');
      output = output.replace(pattern, '[REDACTED_SECRET]');
    }
  }

  output = output.replace(AUTH_SCHEME_PATTERN, '$1 [REDACTED]');
  output = output.replace(PROVIDER_KEY_PATTERN, '[REDACTED_API_KEY]');
  output = output.replace(HEADER_KEY_INLINE_PATTERN, '$1=[REDACTED]');
  output = output.replace(URL_USERINFO_PATTERN, '$1[REDACTED]:[REDACTED]@');
  output = output.replace(URL_QUERY_SECRET_PATTERN, '$1[REDACTED]');
  output = output.replace(KV_SECRET_PATTERN, '$1=[REDACTED]');

  return output;
}

function redactValueInternal(
  value: unknown,
  registeredSecrets: ReadonlySet<string>,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') {
    return redactStringWithSecrets(value, registeredSecrets);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (depth > MAX_REDACTION_DEPTH) {
    return '[MAX_DEPTH]';
  }
  if (typeof value !== 'object') {
    return redactStringWithSecrets(String(value), registeredSecrets);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValueInternal(item, registeredSecrets, depth + 1, seen));
  }

  if (value instanceof Error) {
    return redactErrorInternal(value, registeredSecrets, 0, seen);
  }

  const out: Record<string, unknown> = {};
  let unsafeKeyIndex = 0;
  for (const [key, propVal] of Object.entries(value as Record<string, unknown>)) {
    const redactedVal = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : redactValueInternal(propVal, registeredSecrets, depth + 1, seen);

    if (
      key !== '__proto__' &&
      key !== 'prototype' &&
      key !== 'constructor' &&
      SAFE_KEY_PATTERN.test(key)
    ) {
      out[key] = redactedVal;
    } else {
      const safeKey =
        unsafeKeyIndex === 0 ? UNSAFE_KEY_MARKER : `${UNSAFE_KEY_MARKER}_${unsafeKeyIndex}`;
      unsafeKeyIndex += 1;
      out[safeKey] = redactedVal;
    }
  }
  return out;
}

function redactErrorInternal(
  error: unknown,
  registeredSecrets: ReadonlySet<string>,
  depth: number,
  seen: WeakSet<object>
): SanitizedErrorInfo {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: unknown;
      reasonCode?: unknown;
      statusCode?: unknown;
      cause?: unknown;
    };
    const info: {
      name: string;
      message: string;
      code?: string;
      reasonCode?: string;
      statusCode?: number;
      stack?: string;
      cause?: SanitizedErrorInfo;
    } = {
      name: redactStringWithSecrets(error.name || 'Error', registeredSecrets),
      message: redactStringWithSecrets(error.message || '', registeredSecrets),
    };
    if (typeof record.code === 'string') {
      info.code = redactStringWithSecrets(record.code, registeredSecrets);
    }
    if (typeof record.reasonCode === 'string') {
      info.reasonCode = redactStringWithSecrets(record.reasonCode, registeredSecrets);
    }
    if (typeof record.statusCode === 'number') {
      info.statusCode = record.statusCode;
    }
    if (typeof error.stack === 'string') {
      info.stack = redactStringWithSecrets(error.stack, registeredSecrets);
    }
    if (record.cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH) {
      if (typeof record.cause !== 'object' || record.cause === null || !seen.has(record.cause)) {
        if (typeof record.cause === 'object' && record.cause !== null) {
          seen.add(record.cause);
        }
        info.cause = redactErrorInternal(record.cause, registeredSecrets, depth + 1, seen);
      }
    }
    return info;
  }

  return {
    name: 'UnknownError',
    message: redactStringWithSecrets(
      typeof error === 'string' ? error : JSON.stringify(error ?? ''),
      registeredSecrets
    ),
  };
}

export function createRedactor(
  initialSecrets: readonly (string | null | undefined)[] = []
): RedactionContext {
  const registeredSecrets = new Set<string>();
  for (const secret of initialSecrets) {
    if (typeof secret === 'string' && secret.trim().length >= 6) {
      registeredSecrets.add(secret.trim());
    }
  }

  return {
    registerSecret(secret: string | null | undefined): void {
      if (typeof secret === 'string' && secret.trim().length >= 6) {
        registeredSecrets.add(secret.trim());
      }
    },
    redactString(input: string): string {
      return redactStringWithSecrets(input, registeredSecrets);
    },
    redactObject<T>(input: T): T {
      return redactValueInternal(input, registeredSecrets, 0, new WeakSet<object>()) as T;
    },
    redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
      const sanitized: Record<string, string> = {};
      let unsafeHeaderIndex = 0;
      for (const [key, value] of Object.entries(headers)) {
        const redactedVal = SENSITIVE_KEY_PATTERN.test(key)
          ? '[redacted]'
          : redactStringWithSecrets(value, registeredSecrets);

        if (
          key !== '__proto__' &&
          key !== 'prototype' &&
          key !== 'constructor' &&
          SAFE_KEY_PATTERN.test(key)
        ) {
          sanitized[key] = redactedVal;
        } else {
          const safeKey =
            unsafeHeaderIndex === 0
              ? UNSAFE_KEY_MARKER
              : `${UNSAFE_KEY_MARKER}_${unsafeHeaderIndex}`;
          unsafeHeaderIndex += 1;
          sanitized[safeKey] = redactedVal;
        }
      }
      return sanitized;
    },
    redactError(error: unknown): SanitizedErrorInfo {
      return redactErrorInternal(error, registeredSecrets, 0, new WeakSet<object>());
    },
  };
}

export function sanitizeProviderMessage(
  raw: string,
  knownSecrets: readonly (string | null | undefined)[] = []
): string {
  return createRedactor(knownSecrets).redactString(raw);
}

export function redactObject<T>(
  input: T,
  knownSecrets: readonly (string | null | undefined)[] = []
): T {
  return createRedactor(knownSecrets).redactObject(input);
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  knownSecrets: readonly (string | null | undefined)[] = []
): Record<string, string> {
  return createRedactor(knownSecrets).redactHeaders(headers);
}

export function redactError(
  error: unknown,
  knownSecrets: readonly (string | null | undefined)[] = []
): SanitizedErrorInfo {
  return createRedactor(knownSecrets).redactError(error);
}

export function redactSensitiveOutput<T>(
  input: T,
  knownSecrets: readonly (string | null | undefined)[] = []
): T {
  return createRedactor(knownSecrets).redactObject(input);
}
