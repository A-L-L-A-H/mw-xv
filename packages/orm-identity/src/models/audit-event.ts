import { randomUUID } from 'node:crypto';
import { Model, type ModelOptions, type QueryContext } from 'objection';

export const REDACTED_EVENT_VALUE = '[REDACTED]';
export const MAX_EVENT_DATA_DEPTH = 4;
export const MAX_EVENT_DATA_KEYS = 32;
export const MAX_EVENT_DATA_STRING_LENGTH = 512;

const SENSITIVE_EVENT_KEYS = new Set([
  'accessToken',
  'apiKey',
  'authorization',
  'authorizationCode',
  'bootstrapToken',
  'clientSecret',
  'cookie',
  'idToken',
  'mfaSecret',
  'password',
  'passwordHash',
  'privateKey',
  'refreshToken',
  'secret',
  'token',
].map((key) => key.toLowerCase()));

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function normalizeEventKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function redactEventValue(value: unknown, depth: number, parentKey = ''): unknown {
  if (depth > MAX_EVENT_DATA_DEPTH) return '[TRUNCATED]';
  const parentIsSensitive = SENSITIVE_EVENT_KEYS.has(normalizeEventKey(parentKey));

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (parentIsSensitive || PRIVATE_KEY_PATTERN.test(trimmed) || JWT_PATTERN.test(trimmed)) {
      return REDACTED_EVENT_VALUE;
    }
    return value.length > MAX_EVENT_DATA_STRING_LENGTH
      ? `${value.slice(0, MAX_EVENT_DATA_STRING_LENGTH)}…`
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_EVENT_DATA_KEYS)
      .map((entry) => redactEventValue(entry, depth + 1, parentKey));
  }

  if (value && typeof value === 'object') {
    if (parentIsSensitive) return REDACTED_EVENT_VALUE;
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_EVENT_DATA_KEYS)) {
      const normalized = normalizeEventKey(key);
      if (normalized === '__proto__' || normalized === 'constructor' || normalized === 'prototype') {
        continue;
      }
      redacted[key] = SENSITIVE_EVENT_KEYS.has(normalized)
        ? REDACTED_EVENT_VALUE
        : redactEventValue(entry, depth + 1, key);
    }
    return redacted;
  }

  return value;
}

export function redactAuditMetadata(metadata: unknown = {}): Record<string, unknown> {
  const redacted = redactEventValue(metadata, 0);
  if (!redacted || typeof redacted !== 'object' || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}

export class IdentityAuditEvent extends Model {
  static override readonly tableName = 'identity.audit_event';
  static override readonly idColumn = 'id';

  id!: string;
  actor_type!: string;
  actor_id!: string;
  action!: string;
  subject_type!: string;
  subject_id!: string;
  correlation_id?: string | null;
  occurred_at!: string;
  metadata!: Record<string, unknown>;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.id) this.id = randomUUID();
    if (!this.occurred_at) this.occurred_at = new Date().toISOString();
    this.metadata = redactAuditMetadata(this.metadata);
  }

  override $beforeUpdate(_options: ModelOptions, _context: QueryContext): void {
    throw new Error('identity.audit_event is append-only');
  }

  override $beforeDelete(_context: QueryContext): void {
    throw new Error('identity.audit_event is append-only');
  }

  override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatJson(json);
    return { ...formatted, metadata: redactAuditMetadata(formatted.metadata) };
  }
}
