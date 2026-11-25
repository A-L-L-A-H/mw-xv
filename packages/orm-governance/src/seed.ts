import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { AddonSeedManifest } from '@moonwitness/orm-base';
import type { Knex } from 'knex';
import {
  Institution,
  Official,
  Mandate,
  Policy,
  PolicyVersion,
  Regulation,
  PublicProgram,
  BudgetAllocation,
} from './models.js';

export const GOVERNANCE_SEED_VERSION = '1.0.0';

export interface GovernanceSeedOptions {
  /** Seed data is opt-in; the manifest seed is disabled unless explicitly enabled. */
  readonly enabled: boolean;
  readonly companyId?: number;
  readonly ownerId?: number;
}

interface SeedRow {
  readonly tableName: string;
  readonly values: Record<string, unknown>;
}

const EXTERNAL_REF_COLUMN = 'external_ref';

async function insertIfMissing(db: Knex, rows: readonly SeedRow[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const externalRef = row.values[EXTERNAL_REF_COLUMN];
    const existing = await db(row.tableName)
      .where({ [EXTERNAL_REF_COLUMN]: externalRef })
      .first('id');
    if (existing) continue;
    await db(row.tableName).insert(row.values);
    inserted += 1;
  }
  return inserted;
}

export async function seedGovernanceData(
  db: Knex,
  options: GovernanceSeedOptions
): Promise<SeedResult> {
  if (!options.enabled) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const inserted = await insertIfMissing(db, [
    {
      tableName: Institution.tableName,
      values: {
        name: 'State Chancellery',
        code: 'CHANCERY',
        type: 'ministry',
        jurisdiction: 'national',
        seat_city: 'Capital',
        founded_on: '1945-08-17',
        is_active: true,
        external_ref: 'governance:institution:chancellery',
      },
    },
    {
      tableName: Institution.tableName,
      values: {
        name: 'Independent Budget Office',
        code: 'IBO',
        type: 'agency',
        jurisdiction: 'national',
        seat_city: 'Capital',
        founded_on: '2001-01-01',
        is_active: true,
        external_ref: 'governance:institution:ibo',
      },
    },
    {
      tableName: Official.tableName,
      values: {
        name: 'Chancellor of State',
        title: 'Chancellor',
        institution_id: null,
        status: 'active',
        appointed_on: '2024-01-01',
        term_end: '2029-01-01',
        contact_email: 'chancellor@example.gov',
        is_active: true,
        external_ref: 'governance:official:chancellor',
      },
    },
    {
      tableName: Mandate.tableName,
      values: {
        name: 'Chancellor Executive Term 2024-2029',
        official_id: null,
        institution_id: null,
        status: 'active',
        starts_on: '2024-01-01',
        ends_on: '2029-01-01',
        scope: 'executive',
        responsibilities: JSON.stringify({ items: ['cabinet coordination', 'budget sign-off'] }),
        is_active: true,
        external_ref: 'governance:mandate:chancellor-term',
      },
    },
    {
      tableName: Policy.tableName,
      values: {
        name: 'Fiscal Discipline Framework',
        code: 'POL-FISCAL-001',
        institution_id: null,
        status: 'in_force',
        current_version: '1.0.0',
        summary:
          'Framework constraining deficit levels and mandating transparency in budget execution.',
        stakeholder_ids: JSON.stringify({ ids: ['governance:institution:ibo'] }),
        is_active: true,
        external_ref: 'governance:policy:fiscal-discipline',
      },
    },
    {
      tableName: PolicyVersion.tableName,
      values: {
        policy_id: null,
        version: '1.0.0',
        status: 'in_force',
        change_summary: 'Initial enactment of the fiscal discipline framework.',
        authored_by: null,
        effective_from: '2024-07-01',
        body_markdown: '# Fiscal Discipline Framework\n\nDeficit ceiling: 3% of output.',
        is_active: true,
        external_ref: 'governance:policy-version:fiscal-v1',
      },
    },
    {
      tableName: Regulation.tableName,
      values: {
        name: 'Implementing Regulation on Fiscal Reporting',
        number: 'REG-2024-001',
        institution_id: null,
        status: 'in_force',
        policy_id: null,
        issued_on: '2024-06-15',
        enforced_from: '2024-07-01',
        citation: 'REG-2024-001',
        is_active: true,
        external_ref: 'governance:regulation:fiscal-impl',
      },
    },
    {
      tableName: PublicProgram.tableName,
      values: {
        name: 'Transparent Budget Portal Program',
        code: 'PRG-TBP-001',
        institution_id: null,
        status: 'running',
        policy_id: null,
        program_lead: null,
        starts_on: '2024-08-01',
        target_beneficiaries: 1000000,
        outcome_notes: 'Publishing machine-readable budget execution data.',
        is_active: true,
        external_ref: 'governance:program:transparent-budget',
      },
    },
    {
      tableName: BudgetAllocation.tableName,
      values: {
        name: 'Transparent Budget Portal FY2025',
        program_id: null,
        institution_id: null,
        status: 'approved',
        fiscal_year: 2025,
        amount_minor: 5000000000,
        currency: 'IDR',
        line_items: JSON.stringify({
          items: [
            { label: 'platform', amount_minor: 3500000000 },
            { label: 'operations', amount_minor: 1500000000 },
          ],
        }),
        approved_by: null,
        is_active: true,
        external_ref: 'governance:allocation:tbp-fy2025',
      },
    },
  ]);

  return { inserted, updated: 0, skipped: 0 };
}

export const seedManifest: AddonSeedManifest = {
  seedVersion: GOVERNANCE_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    return seedGovernanceData(ctx.db, { enabled: false });
  },
};

export function isGovernanceSeedEnabled(options?: { enabled?: boolean }): boolean {
  return options?.enabled === true;
}

export default seedManifest;
