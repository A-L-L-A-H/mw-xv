import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

const COMPLIANCE_FRAMEWORK_REFERENCE_ROWS = [
  {
    code: 'ISO-27001',
    name: 'ISO/IEC 27001:2022',
    version: '2022',
    category: 'regulatory',
    description: 'Information security management systems standard',
    status: 'active',
    issuer: 'ISO/IEC',
    effective_date: '2022-10-25',
    expiry_date: '2027-10-25',
    reference_url: 'https://www.iso.org/standard/27001',
    tags: '["information-security", "iso"]',
    notes: 'Baseline framework for ISMS certification',
  },
  {
    code: 'SOC2',
    name: 'SOC 2 Type II',
    version: '2017',
    category: 'industry',
    description:
      'Service Organization Control 2 for security, availability, processing integrity, confidentiality, privacy',
    status: 'active',
    issuer: 'AICPA',
    effective_date: '2017-01-01',
    expiry_date: '2027-01-01',
    reference_url:
      'https://www.aicpa.org/interestareas/frc/assurance/downloadabledocuments/soc-2-guide.pdf',
    tags: '["security", "availability", "confidentiality"]',
    notes: 'Required for SaaS vendors',
  },
  {
    code: 'GDPR',
    name: 'General Data Protection Regulation',
    version: '2016',
    category: 'regulatory',
    description: 'EU data protection and privacy regulation',
    status: 'active',
    issuer: 'European Union',
    effective_date: '2018-05-25',
    reference_url: 'https://gdpr.eu/',
    tags: '["data-protection", "privacy", "eu"]',
    notes: 'Mandatory for EU data processing',
  },
  {
    code: 'PCI-DSS',
    name: 'PCI DSS v4.0',
    version: '4.0',
    category: 'industry',
    description: 'Payment Card Industry Data Security Standard',
    status: 'active',
    issuer: 'PCI Security Standards Council',
    effective_date: '2022-03-31',
    expiry_date: '2025-03-31',
    reference_url: 'https://www.pcisecuritystandards.org/',
    tags: '["payment-card", "financial"]',
    notes: 'Required for card payment processing',
  },
  {
    code: 'ESG-INTERNAL',
    name: 'Internal ESG Framework',
    version: '1.0',
    category: 'esg',
    description: 'Environmental, Social, and Governance internal compliance framework',
    status: 'draft',
    issuer: 'Internal',
    effective_date: '2026-01-01',
    reference_url: null,
    tags: '["esg", "sustainability", "internal"]',
    notes: 'Internal voluntary framework',
  },
] as const;

export async function seedComplianceReferenceData(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;
  const ownerId = ctx.ownerId ?? 1;

  for (const frameworkRow of COMPLIANCE_FRAMEWORK_REFERENCE_ROWS) {
    const existing = await db('compliance_frameworks')
      .where({ code: frameworkRow.code, company_id: companyId })
      .first();

    const rowValues = {
      ...frameworkRow,
      company_id: companyId,
      owner_id: ownerId,
    };

    if (existing) {
      await db('compliance_frameworks')
        .where({ id: existing.id })
        .update({
          ...rowValues,
          updated_at: new Date(),
        });
      updated++;
    } else {
      await db('compliance_frameworks').insert({
        ...rowValues,
        created_at: new Date(),
        updated_at: new Date(),
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const complianceSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedComplianceReferenceData,
};
