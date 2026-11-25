import { createHash } from 'node:crypto';

export function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic JSON serialization: object keys sorted, `undefined` values
 * and properties dropped, arrays order-preserving. Any two structurally
 * equal JSON payloads serialize to the same string, so hashing this output
 * yields stable content addresses.
 */
export function toCanonicalJson(payload: unknown): string {
  const normalized = canonicalizeValue(payload);
  const serialized = JSON.stringify(normalized);
  return serialized === undefined ? 'null' : serialized;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256 over {@link toCanonicalJson} output — the canonical content digest. */
export function sha256Canonical(payload: unknown): string {
  return sha256Hex(toCanonicalJson(payload));
}
