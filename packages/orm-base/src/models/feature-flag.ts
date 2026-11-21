import { defineModel, fields } from '@moonwitness/orm';
import { Company } from './company.js';

export interface FeatureFlagQueryDb {
  (tableName: string): {
    where(filter: Record<string, unknown>): {
      orderBy(column: string, direction?: string): Promise<Array<Record<string, unknown>>>;
    };
  };
}

/** Tenant- and TTL-aware runtime feature flag for experimental addon rollouts. */
export const IrFeatureFlag = defineModel('ir.feature_flag', {
  table: 'ir_feature_flags',
  order: 'key asc',
  fields: {
    key: fields.string({
      required: true,
      unique: true,
      index: true,
      pattern: '^[a-z][a-z0-9_.-]{1,127}$',
      label: 'Flag Key',
    }),
    name: fields.string({ required: true, label: 'Flag Name' }),
    enabled: fields.boolean({ required: true, default: false, label: 'Enabled' }),
    rollout_pct: fields.integer({ required: true, default: 0, label: 'Rollout Percentage' }),
    company: fields.belongsTo(Company, { index: true, label: 'Company Scope' }),
    proposal_id: fields.string({ index: true, label: 'Evolution Proposal ID' }),
    expires_at: fields.string({ index: true, label: 'Expires At (ISO 8601)' }),
    description: fields.text({ label: 'Description' }),
  },
});

/**
 * Evaluates whether a runtime feature flag is enabled for an optional company scope while
 * respecting rollout percentage and automatic expires_at TTL expiration.
 */
export async function isFeatureFlagEnabled(
  db: FeatureFlagQueryDb,
  flagKey: string,
  options: { companyId?: number | null; defaultEnabled?: boolean; now?: Date } = {}
): Promise<boolean> {
  const fallback = options.defaultEnabled ?? false;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db('ir_feature_flags').where({ key: flagKey, active: true }).orderBy('id', 'desc');
  } catch {
    return fallback;
  }
  if (!Array.isArray(rows) || rows.length === 0) return fallback;

  const targetCompanyId = options.companyId ?? null;
  const matched =
    (targetCompanyId !== null
      ? rows.find((row) => Number(row.company_id) === targetCompanyId)
      : undefined) ?? rows.find((row) => row.company_id === null || row.company_id === undefined);
  if (!matched) return false;

  if (typeof matched.expires_at === 'string' && matched.expires_at.trim().length > 0) {
    const expiresMs = Date.parse(matched.expires_at);
    const nowMs = (options.now ?? new Date()).getTime();
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      return false;
    }
  }

  const rolloutPct = matched.rollout_pct === undefined ? 100 : Number(matched.rollout_pct);
  return Boolean(matched.enabled) && rolloutPct > 0;
}
