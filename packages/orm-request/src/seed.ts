import type { Knex } from 'knex';
import { WorkflowDefinition } from '@moonwitness/orm-workflow';
import { PurchaseRequest } from './models.js';

type CurrencyFields = {
  code: string;
  name: string;
  symbol: string;
};

type ServiceCatalogFields = {
  code: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  workflowCode: string;
  slaCode: string;
  estimatedAmountMinor: number;
  currencyCode: string;
  active: boolean;
};

type SlaPolicyFields = {
  code: string;
  name: string;
  severity: string;
  responseMinutes: number;
  resolutionMinutes: number;
  escalationMinutes: number;
  escalationRole: string;
  active: boolean;
};

type ApprovalChainFields = {
  code: string;
  version: number;
  name: string;
  serviceCatalogCode: string;
  slaCode: string;
  enabled: boolean;
  config: string;
};

type RequestFields = {
  title: string;
  description: string;
  amount_minor: number;
  currency_id: number;
  company_id: number;
  vendor_id?: number | null;
};

const REQUEST_SEED_VERSION = '1.0.0';

const CURRENCY_SEEDS = [
  {
    code: 'IDR',
    name: 'Indonesian Rupiah',
    symbol: 'Rp',
  },
];

const SERVICE_CATALOG_SEEDS = [
  {
    code: 'catalog.erp_rollout',
    name: 'ERP modul keuangan Nusantara',
    category: 'finance',
    description:
      'Implementasi modul piutang, utang, dan buku besar untuk entitas Indonesia dengan integrasi bank lokal.',
    unit: 'project',
    workflowCode: 'seed.request_erp_change',
    slaCode: 'sla.finance_standard',
    estimatedAmountMinor: 48500000000,
    currencyCode: 'IDR',
    active: true,
  },
  {
    code: 'catalog.payroll_operations',
    name: 'Dukungan operasional payroll',
    category: 'finance',
    description:
      'Penanganan kesalahan penggajihan, BPJS, dan PPh21 untuk karyawan di Jakarta, Surabaya, dan Medan.',
    unit: 'subscription',
    workflowCode: 'seed.request_finance_review',
    slaCode: 'sla.finance_high',
    estimatedAmountMinor: 1850000000,
    currencyCode: 'IDR',
    active: true,
  },
  {
    code: 'catalog.network_incident',
    name: 'Respons insiden jaringan ISP',
    category: 'operations',
    description:
      'Diagnosa dan pemulihan gangguan konektivitas pelanggan korporat pada jaringan Metro-E dan SD-WAN.',
    unit: 'request',
    workflowCode: 'seed.request_incident_escalation',
    slaCode: 'sla.operations_critical',
    estimatedAmountMinor: 950000000,
    currencyCode: 'IDR',
    active: true,
  },
  {
    code: 'catalog.sharia_audit',
    name: 'Audit kepatuhan syariah',
    category: 'compliance',
    description:
      'Review akad, pembiayaan, dan pelaporan kepatuhan syariah sesuai prinsip PSAK 101 dan 102.',
    unit: 'project',
    workflowCode: 'seed.request_compliance_approval',
    slaCode: 'sla.compliance_standard',
    estimatedAmountMinor: 12750000000,
    currencyCode: 'IDR',
    active: true,
  },
  {
    code: 'catalog.whatsapp_support',
    name: 'Operasional WhatsApp Business',
    category: 'technology',
    description:
      'Konfigurasi nomor resmi, template pesan, dan integrasi chatbot layanan pelanggan berbahasa Indonesia.',
    unit: 'subscription',
    workflowCode: 'seed.request_technology_review',
    slaCode: 'sla.technology_standard',
    estimatedAmountMinor: 740000000,
    currencyCode: 'IDR',
    active: true,
  },
];

const SLA_POLICY_SEEDS = [
  {
    code: 'sla.finance_standard',
    name: 'Layanan keuangan standar',
    severity: 'medium',
    responseMinutes: 240,
    resolutionMinutes: 5760,
    escalationMinutes: 1440,
    escalationRole: 'superadmin',
    active: true,
  },
  {
    code: 'sla.finance_high',
    name: 'Layanan keuangan prioritas tinggi',
    severity: 'high',
    responseMinutes: 60,
    resolutionMinutes: 1440,
    escalationMinutes: 360,
    escalationRole: 'superadmin',
    active: true,
  },
  {
    code: 'sla.operations_critical',
    name: 'Insiden operasional kritis',
    severity: 'critical',
    responseMinutes: 15,
    resolutionMinutes: 240,
    escalationMinutes: 60,
    escalationRole: 'system',
    active: true,
  },
  {
    code: 'sla.compliance_standard',
    name: 'Layanan kepatuhan standar',
    severity: 'medium',
    responseMinutes: 480,
    resolutionMinutes: 10080,
    escalationMinutes: 2880,
    escalationRole: 'superadmin',
    active: true,
  },
  {
    code: 'sla.technology_standard',
    name: 'Layanan teknologi standar',
    severity: 'low',
    responseMinutes: 720,
    resolutionMinutes: 10080,
    escalationMinutes: 4320,
    escalationRole: 'superadmin',
    active: true,
  },
];

const APPROVAL_CHAIN_SEEDS = [
  {
    code: 'seed.request_erp_change',
    version: 1,
    name: 'Persetujuan perubahan ERP - Nusantara',
    serviceCatalogCode: 'catalog.erp_rollout',
    slaCode: 'sla.finance_standard',
    enabled: true,
    config: {
      startState: 'draft',
      startRoles: ['user', 'system'],
      timeoutMinutes: 10080,
      resourceModels: [PurchaseRequest.modelName],
      transitions: [
        {
          action: 'submit',
          from: 'draft',
          to: 'finance_review',
          roles: ['user', 'superadmin', 'system'],
        },
        {
          action: 'approve_finance',
          from: 'finance_review',
          to: 'approved',
          roles: ['superadmin', 'system'],
          requiredApprovals: 2,
          requireDifferentActor: true,
          notifyStarter: 'request.approved',
        },
        {
          action: 'reject_finance',
          from: 'finance_review',
          to: 'rejected',
          roles: ['superadmin', 'system'],
          notifyStarter: 'request.rejected',
        },
      ],
    },
  },
  {
    code: 'seed.request_finance_review',
    version: 1,
    name: 'Persetujuan dukungan payroll - Nusantara',
    serviceCatalogCode: 'catalog.payroll_operations',
    slaCode: 'sla.finance_high',
    enabled: true,
    config: {
      startState: 'draft',
      startRoles: ['user', 'system'],
      timeoutMinutes: 2880,
      resourceModels: [PurchaseRequest.modelName],
      transitions: [
        {
          action: 'submit',
          from: 'draft',
          to: 'finance_review',
          roles: ['user', 'superadmin', 'system'],
        },
        {
          action: 'approve_finance',
          from: 'finance_review',
          to: 'approved',
          roles: ['superadmin', 'system'],
          requiredApprovals: 1,
          requireDifferentActor: true,
          notifyStarter: 'request.approved',
        },
        {
          action: 'reject_finance',
          from: 'finance_review',
          to: 'rejected',
          roles: ['superadmin', 'system'],
          notifyStarter: 'request.rejected',
        },
      ],
    },
  },
  {
    code: 'seed.request_incident_escalation',
    version: 1,
    name: 'Eskalasi insiden ISP - Nusantara',
    serviceCatalogCode: 'catalog.network_incident',
    slaCode: 'sla.operations_critical',
    enabled: true,
    config: {
      startState: 'detected',
      startRoles: ['system', 'superadmin'],
      timeoutMinutes: 720,
      resourceModels: [PurchaseRequest.modelName],
      transitions: [
        {
          action: 'triage',
          from: 'detected',
          to: 'triaged',
          roles: ['system', 'superadmin'],
        },
        {
          action: 'escalate',
          from: 'triaged',
          to: 'escalated',
          roles: ['system', 'superadmin'],
          requiredApprovals: 1,
          requireDifferentActor: true,
        },
        {
          action: 'resolve',
          from: 'escalated',
          to: 'resolved',
          roles: ['system', 'superadmin'],
          requiredApprovals: 1,
          requireDifferentActor: true,
        },
        {
          action: 'close',
          from: 'resolved',
          to: 'closed',
          roles: ['system', 'superadmin'],
        },
      ],
    },
  },
  {
    code: 'seed.request_compliance_approval',
    version: 1,
    name: 'Persetujuan audit syariah - Nusantara',
    serviceCatalogCode: 'catalog.sharia_audit',
    slaCode: 'sla.compliance_standard',
    enabled: true,
    config: {
      startState: 'draft',
      startRoles: ['user', 'system'],
      timeoutMinutes: 10080,
      resourceModels: [PurchaseRequest.modelName],
      transitions: [
        {
          action: 'submit',
          from: 'draft',
          to: 'compliance_review',
          roles: ['user', 'superadmin', 'system'],
        },
        {
          action: 'approve_compliance',
          from: 'compliance_review',
          to: 'approved',
          roles: ['superadmin', 'system'],
          requiredApprovals: 2,
          requireDifferentActor: true,
          notifyStarter: 'request.approved',
        },
        {
          action: 'reject_compliance',
          from: 'compliance_review',
          to: 'rejected',
          roles: ['superadmin', 'system'],
          notifyStarter: 'request.rejected',
        },
      ],
    },
  },
  {
    code: 'seed.request_technology_review',
    version: 1,
    name: 'Persetujuan teknologi operasional - Nusantara',
    serviceCatalogCode: 'catalog.whatsapp_support',
    slaCode: 'sla.technology_standard',
    enabled: true,
    config: {
      startState: 'draft',
      startRoles: ['user', 'system'],
      timeoutMinutes: 10080,
      resourceModels: [PurchaseRequest.modelName],
      transitions: [
        {
          action: 'submit',
          from: 'draft',
          to: 'technology_review',
          roles: ['user', 'superadmin', 'system'],
        },
        {
          action: 'approve_technology',
          from: 'technology_review',
          to: 'approved',
          roles: ['superadmin', 'system'],
          requiredApprovals: 1,
          requireDifferentActor: true,
        },
        {
          action: 'reject_technology',
          from: 'technology_review',
          to: 'rejected',
          roles: ['superadmin', 'system'],
          notifyStarter: 'request.rejected',
        },
      ],
    },
  },
];

const INITIAL_SERVICE_REQUEST_SEEDS = [
  {
    code: 'request.seed_erp_rollout',
    title: 'Implementasi ERP keuangan Nusantara',
    description:
      'Pengadaan implementasi modul keuangan ERP untuk 12 entitas Indonesia dengan integrasi BCA, Mandiri, dan BRI.',
    serviceCatalogCode: 'catalog.erp_rollout',
    slaCode: 'sla.finance_standard',
    approvalChainCode: 'seed.request_erp_change',
    amountMinor: 48500000000,
    currencyCode: 'IDR',
    vendorEmail: 'contact@northstar.local',
  },
  {
    code: 'request.seed_payroll_support',
    title: 'Dukungan payroll bulan Ramadan',
    description:
      'Layanan dukungan payroll untuk 420 karyawan dengan penyesuaian BPJS Ketenagakerjaan dan PPh21 periode Ramadan.',
    serviceCatalogCode: 'catalog.payroll_operations',
    slaCode: 'sla.finance_high',
    approvalChainCode: 'seed.request_finance_review',
    amountMinor: 1850000000,
    currencyCode: 'IDR',
    vendorEmail: 'contact@northstar.local',
  },
  {
    code: 'request.seed_network_incident',
    title: 'Pemulihan gangguan SD-WAN kantor Surabaya',
    description:
      'Respons insiden konektivitas SD-WAN kantor Surabaya yang terdampak gangguan fiber optik pada jam operasional.',
    serviceCatalogCode: 'catalog.network_incident',
    slaCode: 'sla.operations_critical',
    approvalChainCode: 'seed.request_incident_escalation',
    amountMinor: 950000000,
    currencyCode: 'IDR',
    vendorEmail: 'contact@northstar.local',
  },
  {
    code: 'request.seed_sharia_audit',
    title: 'Audit kepatuhan syariah Q3',
    description:
      'Audit independen atas akad murabahah dan ijarah untuk unit pembiayaan syariah di Medan dan Bandung.',
    serviceCatalogCode: 'catalog.sharia_audit',
    slaCode: 'sla.compliance_standard',
    approvalChainCode: 'seed.request_compliance_approval',
    amountMinor: 12750000000,
    currencyCode: 'IDR',
    vendorEmail: 'hello@acme.local',
  },
  {
    code: 'request.seed_whatsapp_operations',
    title: 'Integrasi WhatsApp Business CS',
    description:
      'Pengadaan integrasi WhatsApp Business API dan chatbot layanan pelanggan berbahasa Indonesia untuk 60 agen.',
    serviceCatalogCode: 'catalog.whatsapp_support',
    slaCode: 'sla.technology_standard',
    approvalChainCode: 'seed.request_technology_review',
    amountMinor: 740000000,
    currencyCode: 'IDR',
    vendorEmail: 'hello@acme.local',
  },
];

function cloneConfig(config: (typeof APPROVAL_CHAIN_SEEDS)[0]['config']) {
  return {
    ...config,
    startRoles: [...config.startRoles],
    resourceModels: [...config.resourceModels],
    transitions: config.transitions.map((transition) => ({
      ...transition,
      roles: [...transition.roles],
    })),
  };
}

function cloneServiceCatalogItem(item: (typeof SERVICE_CATALOG_SEEDS)[0]) {
  return { ...item };
}

function cloneSlaPolicy(policy: (typeof SLA_POLICY_SEEDS)[0]) {
  return { ...policy };
}

function cloneApprovalChain(chain: (typeof APPROVAL_CHAIN_SEEDS)[0]) {
  return { ...chain, config: cloneConfig(chain.config) };
}

function cloneRequest(request: (typeof INITIAL_SERVICE_REQUEST_SEEDS)[0]) {
  return { ...request };
}

export function buildRequestInitialSeed() {
  return {
    version: REQUEST_SEED_VERSION,
    currencies: CURRENCY_SEEDS.map((currency) => ({ ...currency })),
    serviceCatalog: SERVICE_CATALOG_SEEDS.map(cloneServiceCatalogItem),
    slaPolicies: SLA_POLICY_SEEDS.map(cloneSlaPolicy),
    approvalChains: APPROVAL_CHAIN_SEEDS.map(cloneApprovalChain),
    requests: INITIAL_SERVICE_REQUEST_SEEDS.map(cloneRequest),
  };
}

async function resolveForeignKey(db: Knex, table: string, conditions: Record<string, unknown>) {
  const row = await db(table).where(conditions).first('id');
  if (!row) {
    throw new Error(`Missing seed foreign key in ${table}: ${JSON.stringify(conditions)}`);
  }
  return Number(row.id);
}

export async function seedRequestInitialData(db: Knex) {
  const bundle = buildRequestInitialSeed();
  let insertedCurrencies = 0;
  let insertedDefinitions = 0;
  let insertedRequests = 0;

  for (const currency of bundle.currencies) {
    const existing = await db('currencies').where({ code: currency.code }).first('id');
    if (existing) continue;
    await db('currencies').insert(currency);
    insertedCurrencies += 1;
  }

  for (const chain of bundle.approvalChains) {
    const existing = await db(WorkflowDefinition.tableName)
      .where({ code: chain.code, version: chain.version })
      .first('id');
    if (existing) continue;
    await db(WorkflowDefinition.tableName).insert({
      code: chain.code,
      version: chain.version,
      name: chain.name,
      config: JSON.stringify(chain.config),
      enabled: chain.enabled,
    });
    insertedDefinitions += 1;
  }

  for (const request of bundle.requests) {
    const existing = await db(PurchaseRequest.tableName)
      .where({ title: request.title })
      .first('id');
    if (existing) continue;
    const currencyId = await resolveForeignKey(db, 'currencies', { code: request.currencyCode });
    const companyId = await resolveForeignKey(db, 'companies', { name: 'MoonWitness' });
    const vendorId = request.vendorEmail
      ? await resolveForeignKey(db, 'partners', { email: request.vendorEmail })
      : null;
    const fields: RequestFields = {
      title: request.title,
      description: request.description,
      amount_minor: request.amountMinor,
      currency_id: currencyId,
      company_id: companyId,
      vendor_id: vendorId,
    };
    await db(PurchaseRequest.tableName).insert(fields);
    insertedRequests += 1;
  }

  const currenciesCount = await db('currencies').count({ count: '*' }).first();
  const definitionsCount = await db(WorkflowDefinition.tableName).count({ count: '*' }).first();
  const requestsCount = await db(PurchaseRequest.tableName).count({ count: '*' }).first();

  return {
    insertedCurrencies,
    insertedDefinitions,
    insertedRequests,
    currenciesTotal: Number(currenciesCount?.count ?? 0),
    definitionsTotal: Number(definitionsCount?.count ?? 0),
    requestsTotal: Number(requestsCount?.count ?? 0),
  };
}
