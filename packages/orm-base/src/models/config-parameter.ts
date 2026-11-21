import { defineModel, fields } from '@moonwitness/orm';
import { Company } from './company.js';

export type ConfigParameterValueType = 'string' | 'integer' | 'boolean' | 'json';

export interface ConfigParamQueryDb {
  (tableName: string): {
    where(filter: Record<string, unknown>): {
      orderBy(column: string, direction?: string): Promise<Array<Record<string, unknown>>>;
    };
  };
}

/** System and per-company runtime configuration parameter. */
export const ConfigParameter = defineModel('base.config_parameter', {
  table: 'base_config_parameters',
  order: 'key asc',
  fields: {
    key: fields.string({
      required: true,
      index: true,
      pattern: '^[a-z][a-z0-9_.-]{1,127}$',
      label: 'Parameter Key',
    }),
    value_type: fields.enum(['string', 'integer', 'boolean', 'json'] as const, {
      required: true,
      default: 'string',
      label: 'Value Type',
    }),
    value: fields.text({ label: 'Value' }),
    is_secret: fields.boolean({ required: true, default: false, label: 'Secret' }),
    company: fields.belongsTo(Company, { index: true, label: 'Company Scope' }),
    description: fields.text({ label: 'Description' }),
  },
  unique: [['key', 'company']],
});

function parseTypedConfigValue(raw: string, valueType: ConfigParameterValueType): unknown {
  switch (valueType) {
    case 'integer': {
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) ? parsed : raw;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    case 'string':
    default:
      return raw;
  }
}

/**
 * Resolves a runtime config parameter:
 * 1. Environment variable override (if `envVarName` is provided and set in `processEnv`)
 * 2. Company-scoped DB parameter
 * 3. Global DB parameter (`company_id IS NULL`)
 * 4. `fallback`
 */
export async function getConfigParam<T = string>(
  db: ConfigParamQueryDb,
  key: string,
  fallback: T,
  options: {
    companyId?: number | null;
    envVarName?: string;
    processEnv?: Readonly<Record<string, string | undefined>>;
  } = {}
): Promise<T> {
  const envSource = options.processEnv ?? process.env;
  if (options.envVarName) {
    const envVal = envSource[options.envVarName];
    if (envVal !== undefined && envVal !== '') {
      return envVal as unknown as T;
    }
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db('base_config_parameters').where({ key, active: true }).orderBy('id', 'desc');
  } catch {
    return fallback;
  }
  if (!Array.isArray(rows) || rows.length === 0) return fallback;

  const targetCompanyId = options.companyId ?? null;
  const matched =
    (targetCompanyId !== null
      ? rows.find((row) => Number(row.company_id) === targetCompanyId)
      : undefined) ?? rows.find((row) => row.company_id === null || row.company_id === undefined);

  if (!matched || typeof matched.value !== 'string') return fallback;
  const valueType = (matched.value_type as ConfigParameterValueType | undefined) ?? 'string';
  return parseTypedConfigValue(matched.value, valueType) as T;
}

/** Redacts `value` when `is_secret` is true so secret parameters never leak into audit/outbox payloads. */
export function redactConfigParameterForAudit<T extends Record<string, unknown>>(record: T): T {
  if (!record.is_secret) return record;
  return { ...record, value: '[REDACTED]' };
}
