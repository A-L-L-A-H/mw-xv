import type { Knex } from 'knex';
import { countValue } from '@moonwitness/types';
import { Lead, LeadStage, LeadTagLink, Opportunity } from './models/index.js';
import {
  resolveInsertedId,
  type AddonSeedManifest,
  type SeedContext,
  type SeedResult,
} from '@moonwitness/orm-base';

export const CRM_SEED_VERSION = '1.0.0';

export interface CrmStageSeed {
  readonly id: string;
  readonly name: string;
  readonly sequence: number;
  readonly is_won: boolean;
  readonly is_lost: boolean;
  readonly color: string;
}

export interface CrmLeadSeed {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly mobile: string;
  readonly stageName: string;
  readonly probability: number;
  readonly expectedRevenueMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly source: string;
  readonly deadline: string;
  readonly tagNames: readonly string[];
}

export interface CrmOpportunitySeed {
  readonly id: string;
  readonly name: string;
  readonly partnerName: string;
  readonly partnerEmail: string;
  readonly stageName: string;
  readonly probability: number;
  readonly expectedRevenueMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly deadline: string;
  readonly wonDate: string | null;
  readonly lostDate: string | null;
  readonly lostReason: string | null;
  readonly tagNames: readonly string[];
}

export interface CrmInitialSeedBundle {
  readonly version: string;
  readonly stages: readonly CrmStageSeed[];
  readonly leads: readonly CrmLeadSeed[];
  readonly opportunities: readonly CrmOpportunitySeed[];
}

export interface CrmSeedExecutionResult {
  readonly companyId: number;
  readonly stagesTotal: number;
  readonly leadsTotal: number;
  readonly opportunitiesTotal: number;
  readonly tagLinksTotal: number;
  readonly insertedStages: number;
  readonly insertedLeads: number;
  readonly insertedOpportunities: number;
  readonly insertedTagLinks: number;
}

export interface SeedCrmInitialDataOptions {
  readonly companyId?: number;
  readonly ownerId?: number;
}

const CRM_STAGES: readonly CrmStageSeed[] = [
  {
    id: 'crm-stage-new',
    name: 'New Prospect',
    sequence: 10,
    is_won: false,
    is_lost: false,
    color: '#64748B',
  },
  {
    id: 'crm-stage-qualified',
    name: 'Qualified Account',
    sequence: 20,
    is_won: false,
    is_lost: false,
    color: '#3B82F6',
  },
  {
    id: 'crm-stage-proposal',
    name: 'Proposal Submitted',
    sequence: 30,
    is_won: false,
    is_lost: false,
    color: '#0EA5E9',
  },
  {
    id: 'crm-stage-negotiation',
    name: 'Contract Negotiation',
    sequence: 40,
    is_won: false,
    is_lost: false,
    color: '#F59E0B',
  },
  {
    id: 'crm-stage-won',
    name: 'Closed Won',
    sequence: 90,
    is_won: true,
    is_lost: false,
    color: '#22C55E',
  },
  {
    id: 'crm-stage-lost',
    name: 'Closed Lost',
    sequence: 100,
    is_won: false,
    is_lost: true,
    color: '#EF4444',
  },
];

const CRM_LEADS: readonly CrmLeadSeed[] = [
  {
    id: 'crm-lead-nusantara-digital',
    name: 'PT Nusantara Digital Solusi - Enterprise Cloud Inquiry',
    email: 'budi.santoso@nusantaradigital.co.id',
    phone: '+62-21-5551234',
    mobile: '+62-811-1001234',
    stageName: 'New Prospect',
    probability: 15,
    expectedRevenueMinor: 15000000000,
    currency: 'IDR',
    description:
      'Inquiry for multi-region cloud infrastructure migration across Jakarta and Surabaya data centers.',
    source: 'Executive Referral',
    deadline: '2026-12-15',
    tagNames: ['Customer'],
  },
  {
    id: 'crm-lead-garuda-logistik',
    name: 'PT Garuda Logistik Maritim - Fleet Telemetry System',
    email: 'hendra.wijaya@garudalogistik.id',
    phone: '+62-21-5552345',
    mobile: '+62-812-2002345',
    stageName: 'Qualified Account',
    probability: 35,
    expectedRevenueMinor: 28000000000,
    currency: 'IDR',
    description:
      'IoT fleet tracking and automated customs clearance workflow for 120 cargo vessels.',
    source: 'Industry Summit',
    deadline: '2026-12-20',
    tagNames: ['Customer'],
  },
  {
    id: 'crm-lead-borneo-energi',
    name: 'PT Borneo Energi Lestari - Smart Grid Monitoring',
    email: 'siti.rahayu@borneoenergi.co.id',
    phone: '+62-542-5553456',
    mobile: '+62-813-3003456',
    stageName: 'Proposal Submitted',
    probability: 60,
    expectedRevenueMinor: 42000000000,
    currency: 'IDR',
    description:
      'Real-time SCADA integration and predictive maintenance AI for East Kalimantan power grid.',
    source: 'Direct Enterprise Sales',
    deadline: '2027-01-10',
    tagNames: ['Customer'],
  },
  {
    id: 'crm-lead-sumatra-agro',
    name: 'PT Sumatra Agro Mandiri - Supply Chain ERP',
    email: 'agus.pratama@sumatraagro.id',
    phone: '+62-61-5554567',
    mobile: '+62-811-4004567',
    stageName: 'Contract Negotiation',
    probability: 80,
    expectedRevenueMinor: 19500000000,
    currency: 'IDR',
    description: 'End-to-end plantation harvest tracking and automated procurement platform.',
    source: 'Partner Channel',
    deadline: '2026-11-30',
    tagNames: ['Customer'],
  },
  {
    id: 'crm-lead-celebes-telecom',
    name: 'PT Celebes Telekomunikasi Nusantara - Core Network Upgrade',
    email: 'andi.makassar@celebestelecom.co.id',
    phone: '+62-411-5555678',
    mobile: '+62-812-5005678',
    stageName: 'Closed Won',
    probability: 100,
    expectedRevenueMinor: 65000000000,
    currency: 'IDR',
    description: 'Eastern Indonesia fiber backbone management and RADIUS AAA cluster deployment.',
    source: 'RFP Tender',
    deadline: '2026-11-15',
    tagNames: ['Customer'],
  },
];

const CRM_OPPORTUNITIES: readonly CrmOpportunitySeed[] = [
  {
    id: 'crm-opp-merdeka-finansial',
    name: 'PT Merdeka Finansial Teknologi - Core Banking AI Mesh',
    partnerName: 'PT Merdeka Finansial Teknologi',
    partnerEmail: 'direksi@merdekafinansial.co.id',
    stageName: 'Contract Negotiation',
    probability: 85,
    expectedRevenueMinor: 85000000000,
    currency: 'IDR',
    description:
      'Sovereign AI fraud detection and real-time credit scoring engine for 12M retail banking users.',
    deadline: '2026-12-05',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-khatulistiwa-medika',
    name: 'RS Khatulistiwa Medika Group - Unified HIS & Telemedicine',
    partnerName: 'RS Khatulistiwa Medika Group',
    partnerEmail: 'procurement@khatulistiwamedika.id',
    stageName: 'Proposal Submitted',
    probability: 65,
    expectedRevenueMinor: 34000000000,
    currency: 'IDR',
    description:
      'Hospital Information System integration across 28 regional hospitals with encrypted patient records.',
    deadline: '2026-12-22',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-jawadwipa-manufaktur',
    name: 'PT Jawadwipa Manufaktur Presisi - Industrial IoT Automation',
    partnerName: 'PT Jawadwipa Manufaktur Presisi',
    partnerEmail: 'ops.director@jawadwipamanufaktur.co.id',
    stageName: 'Closed Won',
    probability: 100,
    expectedRevenueMinor: 52000000000,
    currency: 'IDR',
    description:
      'Automated quality control vision system and MES rollout for Cikarang automotive plants.',
    deadline: '2026-11-10',
    wonDate: '2026-11-08',
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-sriwijaya-kargo',
    name: 'PT Sriwijaya Kargo Udara - Aviation Logistics Platform',
    partnerName: 'PT Sriwijaya Kargo Udara',
    partnerEmail: 'cargo.it@sriwijayakargo.id',
    stageName: 'Qualified Account',
    probability: 40,
    expectedRevenueMinor: 21000000000,
    currency: 'IDR',
    description: 'Air freight booking, warehouse automation, and customs EDI integration.',
    deadline: '2027-01-18',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-majapahit-ritel',
    name: 'PT Majapahit Ritel Modern - Omnichannel Commerce Cloud',
    partnerName: 'PT Majapahit Ritel Modern',
    partnerEmail: 'digital@majapahitritel.co.id',
    stageName: 'Closed Won',
    probability: 100,
    expectedRevenueMinor: 48000000000,
    currency: 'IDR',
    description:
      'Unified POS, inventory synchronization, and WhatsApp commerce engine for 1,400 outlets.',
    deadline: '2026-11-01',
    wonDate: '2026-10-29',
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-cendrawasih-mining',
    name: 'PT Cendrawasih Mineral Tambang - Autonomous Haulage Network',
    partnerName: 'PT Cendrawasih Mineral Tambang',
    partnerEmail: 'mine.ops@cendrawasihmineral.co.id',
    stageName: 'Proposal Submitted',
    probability: 55,
    expectedRevenueMinor: 92000000000,
    currency: 'IDR',
    description:
      'Private 5G mesh network and autonomous dump truck telemetry in Papua mining site.',
    deadline: '2027-02-01',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-bali-hospitality',
    name: 'Bali Dewata Hospitality Group - Smart Resort Guest Experience',
    partnerName: 'Bali Dewata Hospitality Group',
    partnerEmail: 'it.vp@balidewata.com',
    stageName: 'Contract Negotiation',
    probability: 75,
    expectedRevenueMinor: 16500000000,
    currency: 'IDR',
    description:
      'AI concierge, automated check-in, and energy management across 18 luxury resorts.',
    deadline: '2026-12-12',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-andalas-semen',
    name: 'PT Andalas Semen Konstruksi - Distributor Portal & Billing',
    partnerName: 'PT Andalas Semen Konstruksi',
    partnerEmail: 'supplychain@andalassemen.co.id',
    stageName: 'Qualified Account',
    probability: 30,
    expectedRevenueMinor: 24000000000,
    currency: 'IDR',
    description: 'B2B distributor ordering portal, credit limit automation, and fleet dispatch.',
    deadline: '2027-01-25',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-pasifik-perikanan',
    name: 'PT Pasifik Perikanan Samudra - Cold Chain Traceability',
    partnerName: 'PT Pasifik Perikanan Samudra',
    partnerEmail: 'export@pasifikperikanan.id',
    stageName: 'New Prospect',
    probability: 20,
    expectedRevenueMinor: 13500000000,
    currency: 'IDR',
    description: 'Blockchain-backed cold storage temperature monitoring for export compliance.',
    deadline: '2027-02-14',
    wonDate: null,
    lostDate: null,
    lostReason: null,
    tagNames: ['Customer'],
  },
  {
    id: 'crm-opp-sunda-kelapa-port',
    name: 'PT Sunda Kelapa Pelabuhan Terpadu - Container Terminal OS',
    partnerName: 'PT Sunda Kelapa Pelabuhan Terpadu',
    partnerEmail: 'terminal.director@sundakelapaport.co.id',
    stageName: 'Closed Lost',
    probability: 0,
    expectedRevenueMinor: 78000000000,
    currency: 'IDR',
    description: 'Automated crane scheduling and port gate OCR system.',
    deadline: '2026-10-15',
    wonDate: null,
    lostDate: '2026-10-18',
    lostReason: 'Deferred budget allocation to FY2027 state infrastructure cycle.',
    tagNames: ['Customer'],
  },
];

export function buildCrmInitialSeed(): CrmInitialSeedBundle {
  return {
    version: CRM_SEED_VERSION,
    stages: CRM_STAGES.map((s) => ({ ...s })),
    leads: CRM_LEADS.map((l) => ({ ...l, tagNames: [...l.tagNames] })),
    opportunities: CRM_OPPORTUNITIES.map((o) => ({ ...o, tagNames: [...o.tagNames] })),
  };
}

export async function seedCrmInitialData(
  db: Knex,
  options: SeedCrmInitialDataOptions = {}
): Promise<CrmSeedExecutionResult> {
  const bundle = buildCrmInitialSeed();

  const companyRow =
    options.companyId === undefined
      ? await db('companies').orderBy('id', 'asc').first('id')
      : await db('companies').where({ id: options.companyId }).first('id');
  if (!companyRow) {
    throw new Error('Cannot seed CRM initial data: no company record found');
  }
  const companyId = Number(companyRow.id);

  const ownerRow =
    options.ownerId === undefined
      ? await db('users').where({ login: 'superadmin' }).first('id')
      : await db('users').where({ id: options.ownerId }).first('id');
  const fallbackOwnerRow = ownerRow ?? (await db('users').orderBy('id', 'asc').first('id'));
  if (!fallbackOwnerRow) {
    throw new Error('Cannot seed CRM initial data: no user record found');
  }
  const ownerId = Number(fallbackOwnerRow.id);

  const stageIdByName = new Map<string, number>();
  let insertedStages = 0;

  for (const stage of bundle.stages) {
    const existing = await db(LeadStage.tableName).where({ name: stage.name }).first('id');
    if (existing) {
      stageIdByName.set(stage.name, Number(existing.id));
      continue;
    }
    const inserted = (await db(LeadStage.tableName)
      .insert({
        company_id: companyId,
        name: stage.name,
        sequence: stage.sequence,
        is_won: stage.is_won,
        is_lost: stage.is_lost,
        color: stage.color,
      })
      .returning('id')) as unknown[];
    const stageId = resolveInsertedId(inserted, `stage ${stage.name}`);
    stageIdByName.set(stage.name, stageId);
    insertedStages += 1;
  }

  let insertedLeads = 0;
  let insertedTagLinks = 0;

  for (const lead of bundle.leads) {
    const stageId = stageIdByName.get(lead.stageName);
    if (!stageId) throw new Error(`Missing stage ${lead.stageName}`);

    let leadRow = await db(Lead.tableName).where({ email: lead.email }).first('id');
    if (!leadRow) {
      const inserted = (await db(Lead.tableName)
        .insert({
          company_id: companyId,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          mobile: lead.mobile,
          stage_id: stageId,
          probability: lead.probability,
          expected_revenue_minor: lead.expectedRevenueMinor,
          currency: lead.currency,
          description: lead.description,
          source: lead.source,
          assigned_to_id: ownerId,
          deadline: lead.deadline,
        })
        .returning('id')) as unknown[];
      leadRow = { id: resolveInsertedId(inserted, `lead ${lead.email}`) };
      insertedLeads += 1;
    }

    const leadId = Number(leadRow.id);
    for (const tagName of lead.tagNames) {
      let tagRow = await db('tags').where({ name: tagName }).first('id');
      if (!tagRow) {
        const insTag = (await db('tags')
          .insert({ name: tagName, color: '#3B82F6' })
          .returning('id')) as unknown[];
        tagRow = { id: resolveInsertedId(insTag, `tag ${tagName}`) };
      }
      const linkFilter = {
        tag_id: Number(tagRow.id),
        resource_model: Lead.modelName,
        resource_id: leadId,
      };
      const existingLink = await db(LeadTagLink.tableName).where(linkFilter).first('id');
      if (!existingLink) {
        await db(LeadTagLink.tableName).insert(linkFilter);
        insertedTagLinks += 1;
      }
    }
  }

  let insertedOpportunities = 0;
  for (const opp of bundle.opportunities) {
    const stageId = stageIdByName.get(opp.stageName);
    if (!stageId) throw new Error(`Missing stage ${opp.stageName}`);

    let partnerRow = await db('partners').where({ email: opp.partnerEmail }).first('id');
    if (!partnerRow) {
      const inserted = (await db('partners')
        .insert({
          company_id: companyId,
          name: opp.partnerName,
          email: opp.partnerEmail,
          is_company: true,
          is_customer: true,
        })
        .returning('id')) as unknown[];
      partnerRow = { id: resolveInsertedId(inserted, `partner ${opp.partnerEmail}`) };
    }

    let oppRow = await db(Opportunity.tableName).where({ name: opp.name }).first('id');
    if (!oppRow) {
      const inserted = (await db(Opportunity.tableName)
        .insert({
          company_id: companyId,
          name: opp.name,
          partner_id: Number(partnerRow.id),
          stage_id: stageId,
          probability: opp.probability,
          expected_revenue_minor: opp.expectedRevenueMinor,
          currency: opp.currency,
          description: opp.description,
          assigned_to_id: ownerId,
          deadline: opp.deadline,
          won_date: opp.wonDate,
          lost_date: opp.lostDate,
          lost_reason: opp.lostReason,
        })
        .returning('id')) as unknown[];
      oppRow = { id: resolveInsertedId(inserted, `opportunity ${opp.name}`) };
      insertedOpportunities += 1;
    }

    const oppId = Number(oppRow.id);
    for (const tagName of opp.tagNames) {
      const tagRow = await db('tags').where({ name: tagName }).first('id');
      if (!tagRow) continue;
      const linkFilter = {
        tag_id: Number(tagRow.id),
        resource_model: Opportunity.modelName,
        resource_id: oppId,
      };
      const existingLink = await db(LeadTagLink.tableName).where(linkFilter).first('id');
      if (!existingLink) {
        await db(LeadTagLink.tableName).insert(linkFilter);
        insertedTagLinks += 1;
      }
    }
  }

  const stagesTotal = await db(LeadStage.tableName).count({ count: '*' }).first();
  const leadsTotal = await db(Lead.tableName).count({ count: '*' }).first();
  const opportunitiesTotal = await db(Opportunity.tableName).count({ count: '*' }).first();
  const tagLinksTotal = await db(LeadTagLink.tableName).count({ count: '*' }).first();

  return {
    companyId,
    stagesTotal: countValue(stagesTotal),
    leadsTotal: countValue(leadsTotal),
    opportunitiesTotal: countValue(opportunitiesTotal),
    tagLinksTotal: countValue(tagLinksTotal),
    insertedStages,
    insertedLeads,
    insertedOpportunities,
    insertedTagLinks,
  };
}

export const seedManifest: AddonSeedManifest = {
  seedVersion: CRM_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const res = await seedCrmInitialData(ctx.db, {
      companyId: ctx.companyId,
      ownerId: ctx.ownerId,
    });
    const inserted =
      res.insertedStages + res.insertedLeads + res.insertedOpportunities + res.insertedTagLinks;
    const total = res.stagesTotal + res.leadsTotal + res.opportunitiesTotal + res.tagLinksTotal;
    return {
      inserted,
      updated: 0,
      skipped: Math.max(0, total - inserted),
    };
  },
};

export default seedManifest;
