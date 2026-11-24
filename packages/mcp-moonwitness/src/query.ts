/**
 * Read-only query layer over MoonWitness ORM models.
 *
 * HARD BOUNDARIES (enforced by scripts/check-addon-agent-boundary.mjs):
 * - NO INSERT / UPDATE / DELETE SQL and no ORM mutation calls.
 * - Fields with kind === 'password' and field names matching
 *   /password|secret|token|hash/i are stripped from every result row.
 */
import { Registry, type BaseModel } from '@moonwitness/orm';

const SECRET_FIELD_PATTERN = /password|secret|token|hash/iu;

export interface QueryOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly fields?: readonly string[];
}

export interface QueryResult {
  readonly modelName: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
  readonly truncated: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function isForbiddenFieldName(fieldName: string): boolean {
  return SECRET_FIELD_PATTERN.test(fieldName);
}

function isPasswordField(fieldName: string, field: unknown): boolean {
  return (
    typeof field === 'object' &&
    field !== null &&
    'kind' in field &&
    (field as { kind?: unknown }).kind === 'password'
  );
}

/** Strip secret-bearing keys from a row using field metadata plus name denylist. */
export function redactRow(
  modelName: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  const model = Registry.has(modelName)
    ? (Registry.get(modelName) as typeof BaseModel & {
        readonly fields?: Readonly<Record<string, unknown>>;
      })
    : undefined;
  const modelFields = model?.fields ?? {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET_FIELD_PATTERN.test(key)) continue;
    if (isPasswordField(key, modelFields[key])) continue;
    redacted[key] = value;
  }
  return redacted;
}

export async function queryMoonWitnessModel(
  modelName: string,
  options: QueryOptions = {}
): Promise<QueryResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);

  const model = Registry.get(modelName) as unknown as {
    readonly fields?: Readonly<Record<string, unknown>>;
    query(): {
      where(filter: Record<string, unknown>): unknown;
    };
  };
  if (!model || typeof model.query !== 'function') {
    throw new Error(`Model '${modelName}' does not expose a read-only query() API`);
  }

  const requestedFields = options.fields?.filter((field) => !SECRET_FIELD_PATTERN.test(field));
  const total = await countMoonWitnessModel(modelName);
  const qb = model.query() as unknown as {
    limit: (n: number) => {
      offset: (n: number) => {
        select: (...columns: string[]) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  const rows =
    (await qb
      .limit(limit)
      .offset(offset)
      .select(...(requestedFields && requestedFields.length > 0 ? requestedFields : []))) ?? [];

  return {
    modelName,
    rows: rows.map((row: Record<string, unknown>) => redactRow(modelName, row)),
    total,
    truncated: total > offset + rows.length,
  };
}

export async function countMoonWitnessModel(modelName: string): Promise<number> {
  const model = Registry.get(modelName) as unknown as {
    query(): {
      count: (...args: unknown[]) => Promise<unknown>;
    };
  };
  const result = await model.query().count('* as total');
  const first = Array.isArray(result) ? result[0] : result;
  const total = (first as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' ? total : Number(total ?? 0);
}
