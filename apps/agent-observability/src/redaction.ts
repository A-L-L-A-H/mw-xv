const SENSITIVE_KEY_PATTERN =
  /(?:^|[._-])(?:authorization|proxy-authorization|x-api-key|api[-_]?key|secret|secret[-_]?key|password|token|access[-_]?token|refresh[-_]?token|cookie|set-cookie|credential|credentials)$/iu;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/giu;
const PROVIDER_KEY_PATTERN = /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{12,}\b/gu;
const URL_QUERY_SECRET_PATTERN =
  /([?&](?:key|api_key|apikey|token|access_token|refresh_token|secret|password)=)[^&#\s]+/giu;
const KEY_VALUE_SECRET_PATTERN =
  /(\b(?:password|secret|token|access[-_]?token|refresh[-_]?token|credential|api[-_]?key)\b["']?\s*[:=]\s*["']?)(?!\[redacted\])[^\s,;'"}\]]+(["']?)/giu;
const MAX_REDACTION_DEPTH = 12;
const MAX_JSON_REDACTION_DEPTH = 3;

function redactString(input: string, jsonDepth: number): string {
  const trimmed = input.trim();
  if (
    jsonDepth < MAX_JSON_REDACTION_DEPTH &&
    ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')))
  ) {
    try {
      return JSON.stringify(
        redactValue(JSON.parse(trimmed) as unknown, 0, new WeakSet(), jsonDepth + 1)
      );
    } catch {
      // Fall through to text redaction for malformed JSON.
    }
  }
  return input
    .replace(AUTH_SCHEME_PATTERN, '$1 [REDACTED]')
    .replace(PROVIDER_KEY_PATTERN, '[REDACTED_API_KEY]')
    .replace(URL_QUERY_SECRET_PATTERN, '$1[REDACTED]')
    .replace(KEY_VALUE_SECRET_PATTERN, '$1[REDACTED]$2');
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>, jsonDepth = 0): unknown {
  if (typeof value === 'string') return redactString(value, jsonDepth);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > MAX_REDACTION_DEPTH) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return redactString(String(value), jsonDepth);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen, jsonDepth));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    Object.defineProperty(output, key, {
      value: SENSITIVE_KEY_PATTERN.test(key)
        ? '[redacted]'
        : redactValue(item, depth + 1, seen, jsonDepth),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

export function redactTelemetry<T>(value: T): T {
  return redactValue(value, 0, new WeakSet<object>()) as T;
}
