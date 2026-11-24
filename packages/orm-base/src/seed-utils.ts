function parseInsertedScalarId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Number(raw);
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Resolve the inserted numeric primary key from a Knex `.returning('id')` result.
 */
export function resolveInsertedId(inserted: readonly unknown[], context: string): number {
  const value = inserted[0];
  const directId = parseInsertedScalarId(value);
  if (directId !== null) return directId;
  if (value && typeof value === 'object' && 'id' in value) {
    const rowId = parseInsertedScalarId((value as { readonly id?: unknown }).id);
    if (rowId !== null) return rowId;
  }
  throw new Error(`Unable to resolve inserted id for ${context}`);
}
