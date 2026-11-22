import { Registry, columnName, type BaseModel, type Field, type FieldMap } from '@moonwitness/orm';
import type { Transaction } from 'objection';

interface ReverseForeignKeyEntry {
  modelName: string;
  model: typeof BaseModel;
  columns: string[];
}

interface ReverseReferenceCache {
  generation: number;
  byTarget: Map<string, ReverseForeignKeyEntry[]>;
  polymorphic: { modelName: string; model: typeof BaseModel }[];
}

function resolveFieldTarget(field: Field): typeof BaseModel | undefined {
  if (field.kind !== 'belongsTo') return undefined;
  const target = field.target;
  if (typeof target === 'string') {
    return Registry.has(target) ? Registry.get(target) : undefined;
  }
  if (typeof target === 'function' && !('modelName' in target)) {
    return (target as () => typeof BaseModel)();
  }
  return target as typeof BaseModel;
}

function hasPolymorphicResourceFields(fields: FieldMap): boolean {
  return 'resource_model' in fields && 'resource_id' in fields;
}

let reverseReferenceCache: ReverseReferenceCache | null = null;

export function getReverseReferenceIndex(): ReverseReferenceCache {
  const generation = Registry.getGeneration();
  if (reverseReferenceCache && reverseReferenceCache.generation === generation) {
    return reverseReferenceCache;
  }
  const byTarget = new Map<string, ReverseForeignKeyEntry[]>();
  const polymorphic: { modelName: string; model: typeof BaseModel }[] = [];
  for (const [modelName, RegisteredModel] of Registry.getAll()) {
    const fields = RegisteredModel.fields ?? {};
    const columnsByTarget = new Map<string, string[]>();
    for (const [fieldName, field] of Object.entries(fields)) {
      if (field.kind !== 'belongsTo') continue;
      const target = resolveFieldTarget(field);
      if (!target?.modelName) continue;
      const existing = columnsByTarget.get(target.modelName) ?? [];
      existing.push(columnName(fieldName, field));
      columnsByTarget.set(target.modelName, existing);
    }
    for (const [targetName, columns] of columnsByTarget) {
      const entries = byTarget.get(targetName) ?? [];
      entries.push({ modelName, model: RegisteredModel, columns });
      byTarget.set(targetName, entries);
    }
    if (hasPolymorphicResourceFields(fields)) {
      polymorphic.push({ modelName, model: RegisteredModel });
    }
  }
  reverseReferenceCache = { generation, byTarget, polymorphic };
  return reverseReferenceCache;
}

export async function findReference(
  targetModel: string,
  targetId: number,
  activeUsersOnly = false,
  trx?: Transaction
): Promise<string | null> {
  const index = getReverseReferenceIndex();
  for (const { modelName, model: RegisteredModel, columns } of index.byTarget.get(targetModel) ??
    []) {
    for (const column of columns) {
      let query = RegisteredModel.query(trx).select('id').where(column, targetId);
      if (activeUsersOnly && modelName === 'base.user') query = query.where('active', true);
      if (await query.first()) return modelName;
    }
  }
  for (const { modelName, model: RegisteredModel } of index.polymorphic) {
    const reference = await RegisteredModel.query(trx)
      .select('id')
      .where({ resource_model: targetModel, resource_id: targetId })
      .first();
    if (reference) return modelName;
  }
  return null;
}

/**
 * Batched reference lookup (`MW-PERF-002`): maps each referenced target ID to the first
 * referencing model name using 1 `WHERE col IN (...)` query per FK column instead of N queries.
 */
export async function findReferencesBatch(
  targetModel: string,
  targetIds: readonly number[],
  activeUsersOnly = false,
  trx?: Transaction
): Promise<Map<number, string>> {
  const conflicts = new Map<number, string>();
  if (targetIds.length === 0) return conflicts;

  const uniqueIds = Array.from(new Set(targetIds));
  const index = getReverseReferenceIndex();

  for (const { modelName, model: RegisteredModel, columns } of index.byTarget.get(targetModel) ??
    []) {
    for (const column of columns) {
      const remaining = uniqueIds.filter((id) => !conflicts.has(id));
      if (remaining.length === 0) return conflicts;
      let query = RegisteredModel.query(trx)
        .select(column)
        .whereIn(column, remaining)
        .distinct(column);
      if (activeUsersOnly && modelName === 'base.user') query = query.where('active', true);
      const rows = (await query) as unknown as Record<string, unknown>[];
      for (const row of rows) {
        const refId = Number(row[column]);
        if (Number.isInteger(refId) && !conflicts.has(refId)) {
          conflicts.set(refId, modelName);
        }
      }
    }
  }

  for (const { modelName, model: RegisteredModel } of index.polymorphic) {
    const remaining = uniqueIds.filter((id) => !conflicts.has(id));
    if (remaining.length === 0) return conflicts;
    const rows = (await RegisteredModel.query(trx)
      .select('resource_id')
      .where('resource_model', targetModel)
      .whereIn('resource_id', remaining)
      .distinct('resource_id')) as unknown as { resource_id: number }[];
    for (const row of rows) {
      const refId = Number(row.resource_id);
      if (Number.isInteger(refId) && !conflicts.has(refId)) {
        conflicts.set(refId, modelName);
      }
    }
  }

  return conflicts;
}
