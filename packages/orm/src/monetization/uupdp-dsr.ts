import { createHash, createHmac } from 'node:crypto';
import type {
  AnonymizationOptions,
  AnonymizationResult,
  PiiFieldKind,
  UuPdpDsrBundle,
  UuPdpDsrBundlePayload,
  UuPdpDsrExportInput,
} from './types.js';

const MIN_SECRET_KEY_LENGTH = 16;

function assertValidSecretKey(secretKey: string): void {
  if (typeof secretKey !== 'string' || secretKey.length < MIN_SECRET_KEY_LENGTH) {
    throw new Error(
      `UU PDP anonymization secretKey must be at least ${MIN_SECRET_KEY_LENGTH} characters.`
    );
  }
}

function normalizePiiInput(value: unknown, kind: PiiFieldKind): string {
  const text = String(value ?? '').trim();
  if (kind === 'email' || kind === 'name') {
    return text.toLowerCase();
  }
  if (kind === 'phone') {
    return text.replace(/[\s\-()]/g, '');
  }
  return text;
}

/**
 * Irreversibly and deterministically pseudonymizes a single PII value using keyed HMAC-SHA256
 * with domain separation by field path and PII kind.
 */
export function anonymizePiiValue(
  value: unknown,
  fieldPath: string,
  kind: PiiFieldKind,
  secretKey: string
): string {
  assertValidSecretKey(secretKey);
  const normalized = normalizePiiInput(value, kind);
  const digest = createHmac('sha256', secretKey)
    .update(`uupdp-v1:${kind}:${fieldPath}:${normalized}`, 'utf8')
    .digest('hex');

  if (kind === 'email') {
    return `anon_${digest.slice(0, 20)}@anonymized.invalid`;
  }
  if (kind === 'phone') {
    const digits = BigInt(`0x${digest.slice(0, 12)}`).toString().padStart(12, '0').slice(0, 12);
    return `+62000${digits}`;
  }
  return `anon_${kind}_${digest.slice(0, 24)}`;
}

const FIELD_KIND_PATTERNS: ReadonlyArray<{
  kind: PiiFieldKind;
  match: (lower: string) => boolean;
}> = [
  { kind: 'email', match: (l) => l.includes('email') },
  { kind: 'phone', match: (l) => l.includes('phone') || l.includes('whatsapp') || l.includes('msisdn') },
  { kind: 'nik', match: (l) => l === 'nik' || l.endsWith('_nik') || l.includes('ktp') },
  { kind: 'npwp', match: (l) => l.includes('npwp') },
  { kind: 'name', match: (l) => l.includes('name') },
  { kind: 'address', match: (l) => l.includes('address') },
  { kind: 'ip', match: (l) => l === 'ip' || l.endsWith('_ip') || l.includes('ipaddress') },
];

function inferFieldKind(fieldName: string, options: AnonymizationOptions): PiiFieldKind {
  const configured = options.fieldKinds?.[fieldName];
  if (configured) {
    return configured;
  }
  const lower = fieldName.toLowerCase();
  const matched = FIELD_KIND_PATTERNS.find((rule) => rule.match(lower));
  return matched ? matched.kind : (options.defaultFieldKind ?? 'generic');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface AnonymizeWalkContext {
  targetFields: Set<string>;
  options: AnonymizationOptions;
  touchedFields: Set<string>;
}

function isPrimitiveLeaf(value: unknown): boolean {
  return value !== null && value !== undefined && !isPlainObject(value) && !Array.isArray(value);
}

function anonymizeNode(node: unknown, currentPath: string, ctx: AnonymizeWalkContext): unknown {
  if (Array.isArray(node)) {
    return node.map((item, idx) => anonymizeNode(item, `${currentPath}[${idx}]`, ctx));
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const cloned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    const isTarget = ctx.targetFields.has(key) || ctx.targetFields.has(childPath);

    if (isTarget && isPrimitiveLeaf(value)) {
      const kind = ctx.options.fieldKinds?.[childPath] ?? inferFieldKind(key, ctx.options);
      cloned[key] = anonymizePiiValue(value, childPath, kind, ctx.options.secretKey);
      ctx.touchedFields.add(childPath);
    } else {
      cloned[key] = anonymizeNode(value, childPath, ctx);
    }
  }
  return cloned;
}

/**
 * Deeply anonymizes specified customer PII fields in an immutable clone using deterministic HMAC-SHA256.
 */
export function anonymizePiiRecord<T extends Record<string, unknown>>(
  record: T,
  fieldsToAnonymize: readonly string[],
  options: AnonymizationOptions
): AnonymizationResult<T> {
  assertValidSecretKey(options.secretKey);
  const ctx: AnonymizeWalkContext = {
    targetFields: new Set(fieldsToAnonymize),
    options,
    touchedFields: new Set<string>(),
  };
  const anonymized = anonymizeNode(record, '', ctx) as T;

  return {
    anonymized,
    fieldsAnonymized: [...ctx.touchedFields].sort(),
    algorithm: 'HMAC-SHA256',
    reversible: false,
    anonymizedAt: options.anonymizedAt ?? new Date().toISOString(),
  };
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) {
        sorted[key] = canonicalizeValue(child);
      }
    }
    return sorted;
  }
  return value;
}

function computeBundleDigest(payload: UuPdpDsrBundlePayload): string {
  const canonicalJson = JSON.stringify(canonicalizeValue(payload));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

const DEFAULT_DSR_PII_FIELDS = [
  'email',
  'phone',
  'whatsapp',
  'fullName',
  'full_name',
  'name',
  'nik',
  'npwp',
  'address',
  'ipAddress',
  'ip_address',
] as const;

function resolveExportedProfile(
  rawProfile: Record<string, unknown>,
  mode: 'raw' | 'anonymized',
  anonymizationOptions?: AnonymizationOptions
): Record<string, unknown> {
  const canonical = canonicalizeValue(rawProfile) as Record<string, unknown>;
  if (mode !== 'anonymized') {
    return canonical;
  }
  if (!anonymizationOptions) {
    throw new Error('anonymizationOptions is required when exporting DSR bundle in anonymized mode.');
  }
  const configuredFields = anonymizationOptions.fieldKinds
    ? Object.keys(anonymizationOptions.fieldKinds)
    : [...DEFAULT_DSR_PII_FIELDS];
  return anonymizePiiRecord(canonical, configuredFields, anonymizationOptions).anonymized;
}

/**
 * Exports a canonical UU No. 27 Tahun 2022 (UU PDP) Data Subject Right (DSR) JSON bundle
 * with a tamper-evident SHA-256 content digest.
 */
export function exportUuPdpDsrBundle(input: UuPdpDsrExportInput): UuPdpDsrBundle {
  if (!input.requestId || !input.subjectId || !input.tenantId) {
    throw new Error('UU PDP DSR export requires requestId, subjectId, and tenantId.');
  }

  const mode = input.mode ?? 'raw';
  const profile = resolveExportedProfile(input.profile, mode, input.anonymizationOptions);

  const payload: UuPdpDsrBundlePayload = {
    schemaVersion: 'uupdp-dsr/v1',
    legalBasis: 'UU No. 27 Tahun 2022 (UU PDP)',
    requestId: input.requestId,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    mode,
    subject: {
      subjectId: input.subjectId,
      tenantId: input.tenantId,
    },
    retentionPolicy: {
      retentionDays: input.retentionDays ?? 1825,
      anonymizationAfterErasure: true,
    },
    profile,
    consents: input.consents.map((consent) => ({ ...consent })),
    transactions: (input.transactions ?? []).map((tx) => ({ ...tx })),
    entitlements: (input.entitlements ?? []).map((ent) => ({ ...ent })),
    ledgerReferences: [...(input.ledgerReferences ?? [])],
  };

  return {
    ...payload,
    integrity: {
      algorithm: 'SHA-256',
      contentDigest: computeBundleDigest(payload),
    },
  };
}

/**
 * Serializes a UU PDP DSR bundle to deterministic formatted JSON.
 */
export function serializeUuPdpDsrBundle(bundle: UuPdpDsrBundle): string {
  return JSON.stringify(canonicalizeValue(bundle), null, 2);
}

/**
 * Verifies that a UU PDP DSR bundle's SHA-256 content digest matches its payload.
 */
export function verifyUuPdpDsrBundleIntegrity(bundle: UuPdpDsrBundle): boolean {
  const { integrity, ...payload } = bundle;
  if (!integrity || integrity.algorithm !== 'SHA-256' || !integrity.contentDigest) {
    return false;
  }
  return computeBundleDigest(payload) === integrity.contentDigest;
}
