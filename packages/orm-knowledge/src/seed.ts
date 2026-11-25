import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

interface PrivacyProjectionSeedRow {
  readonly projection_key: string;
  readonly subject_ref_sha256: string;
  readonly projection_json: string;
  readonly projection_digest: string;
  readonly synthetic: boolean;
  readonly visibility: 'RESTRICTED' | 'INTERNAL';
  readonly state: 'active' | 'revoked';
}

/**
 * Reference privacy projections provisioned at install time. Every entry is a
 * synthetic fixture row so staging tenants never start with an empty projection
 * ledger; real rows are created only through the revocation workflow.
 */
const KNOWLEDGE_PRIVACY_PROJECTION_REFERENCE_ROWS: readonly PrivacyProjectionSeedRow[] = [
  {
    projection_key: 'synthetic-search-001',
    subject_ref_sha256: '357a432635adf14e8fcde203cfc900cb0ad8e43d9768a59a9052a4f52aca7623',
    projection_json: '{"excerpt":"Synthetic privacy projection only; no witness data."}',
    projection_digest: '3a71c3c81696759d8ccef0975ee7a5316ceeec035ed4d15dc959259b3082a011',
    synthetic: true,
    visibility: 'RESTRICTED',
    state: 'active',
  },
] as const;

export async function seedKnowledgeReferenceData(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;

  for (const projectionRow of KNOWLEDGE_PRIVACY_PROJECTION_REFERENCE_ROWS) {
    const existing = await db('knowledge_privacy_projections')
      .where({ projection_key: projectionRow.projection_key, company_id: companyId })
      .first();

    if (existing) {
      await db('knowledge_privacy_projections')
        .where({ id: existing.id })
        .update({ ...projectionRow, company_id: companyId });
      updated++;
    } else {
      await db('knowledge_privacy_projections').insert({
        ...projectionRow,
        company_id: companyId,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}
