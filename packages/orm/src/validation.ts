export type MutationRecord = Readonly<Record<string, unknown>>;
export type ModelRow = Readonly<Record<string, unknown>>;

/** Extract a positive safe-integer foreign-key id from `<field>_id`, `<field>`, or the current row. */
export function extractRelationId(
  values: MutationRecord,
  current: ModelRow | undefined,
  field: string
): number | null {
  const idKey = `${field}_id`;
  const value = Object.hasOwn(values, idKey)
    ? values[idKey]
    : Object.hasOwn(values, field)
      ? values[field]
      : current?.[idKey];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Resolve the effective field value from pending mutation values or fall back to the current row. */
export function resolveMutationField<T = unknown>(
  values: MutationRecord,
  current: ModelRow | undefined,
  key: string
): T | unknown {
  return Object.hasOwn(values, key) ? values[key] : current?.[key];
}

/** Check whether a value is a strict calendar-valid `YYYY-MM-DD` ISO date string. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
