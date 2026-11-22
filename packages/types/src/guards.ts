import type { JsonValue } from './domain.js';

export type JsonObject = { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  const pending: Array<{ readonly value: unknown; readonly exit?: object }> = [{ value }];
  const ancestors = new WeakSet<object>();

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) continue;
    if (frame.exit) {
      ancestors.delete(frame.exit);
      continue;
    }

    const current = frame.value;
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      continue;
    }
    if (typeof current !== 'object') return false;
    if (ancestors.has(current)) return false;
    if (!Array.isArray(current)) {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }

    ancestors.add(current);
    pending.push({ value: undefined, exit: current });
    const children = Array.isArray(current) ? current : Object.values(current);
    for (const child of children) pending.push({ value: child });
  }

  return true;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

export function asJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/** Parses a finite safe integer from number, bigint, or decimal string; returns null otherwise. */
export function parseInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/u.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isSafeInteger(num) ? num : null;
  }
  return null;
}

/** Extracts a non-negative integer count from a Knex/SQLite/PostgreSQL aggregate row. */
export function countValue(row: unknown): number {
  if (!isRecord(row)) return 0;
  const raw = row.count ?? row['count(*)'] ?? row['COUNT(*)'] ?? Object.values(row)[0];
  const parsed = parseInteger(raw);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}
