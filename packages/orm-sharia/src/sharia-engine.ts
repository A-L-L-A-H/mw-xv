import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { ShariaContract, ZakatAssessment, ProfitSharingDistribution, WaqfAsset, HalalComplianceAudit } from './models/index.js';
import { Company, Partner, User, ConfigParameter, ConfigParameterValueType } from '@moonwitness/orm-base';

const MOCK_WAQF_TRAILS = new Map<number, string[]>();

export interface ZakatCalculationInput {
  companyId: number;
  assessmentDate: string;
  hijriYear: number;
  zakatType: 'maal' | 'fitrah' | 'profession' | 'trade' | 'agriculture' | 'livestock' | 'rikaz';
  assetCategory: 'gold' | 'silver' | 'cash' | 'receivables' | 'inventory' | 'investment' | 'property' | 'other';
  grossAssetsMinor: number;
  deductibleLiabilitiesMinor: number;
  nisabGoldPricePerGramMinor?: number;
  zakatRateBps?: number;
}

export interface ZakatCalculationResult {
  nisabThresholdMinor: number;
  netZakatableMinor: number;
  zakatDueMinor: number;
  nisabMet: boolean;
  grossAssetsMinor: number;
  deductibleLiabilitiesMinor: number;
  zakatRateBps: number;
}

export interface ProfitSharingInput {
  contractId: number;
  periodStart: string;
  periodEnd: string;
  grossProfitMinor: number;
  operatingExpensesMinor: number;
  distributionDate: string;
  approvedById: number;
  notes?: string;
}

export interface ProfitSharingResult {
  netProfitMinor: number;
  customerShareMinor: number;
  companyShareMinor: number;
  journalEntryRef: string;
  journalLines: JournalLine[];
  merkleRoot: string;
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  description: string;
}

export interface ContractValidationInput {
  type: ShariaContractType;
  assetValueMinor: number;
  profitMarginMinor?: number;
  profitSharingRatio?: string;
  financingAmountMinor?: number;
  tenorMonths?: number;
  dsnMuiReference: string;
  ribaFreeConfirmed: boolean;
  ghararFreeConfirmed: boolean;
}

export interface ContractValidationResult {
  valid: boolean;
  violations: string[];
  contractType: ShariaContractType;
}

export interface MerkleTrailNode {
  event: 'acquisition' | 'valuation' | 'yield_distribution' | 'transfer' | 'disbursement';
  timestamp: string;
  valueMinor: number;
  description: string;
  hash: string;
}

export interface WaqfMerkleInput {
  assetId: number;
  trail: MerkleTrailNode[];
}

export interface WaqfMerkleResult {
  merkleRoot: string;
  trail: MerkleTrailNode[];
  verified: boolean;
}

function parseProfitSharingRatio(ratio: string): { customerBps: number; companyBps: number } {
  const [customer, company] = ratio.split(':').map(Number);
  if (!Number.isFinite(customer) || !Number.isFinite(company) || customer < 0 || company < 0) {
    throw new Error('Invalid profit sharing ratio format. Expected "customer:company" with positive numbers.');
  }
  const total = customer + company;
  if (total === 0) throw new Error('Profit sharing ratio cannot sum to zero');
  return { customerBps: Math.round((customer / total) * 10000), companyBps: Math.round((company / total) * 10000) };
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256('empty');
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256(left + right));
    }
    level = next;
  }
  return level[0];
}

export async function calculateZakat(db: Knex, input: ZakatCalculationInput): Promise<ZakatCalculationResult> {
  const nisabPrice = input.nisabGoldPricePerGramMinor ?? await getNisabGoldPrice(db, input.companyId);
  const rateBps = input.zakatRateBps ?? 250;

  const NISAB_GOLD_GRAMS = 85;
  const nisabThresholdMinor = NISAB_GOLD_GRAMS * nisabPrice;
  const netZakatableMinor = input.grossAssetsMinor - input.deductibleLiabilitiesMinor;
  // Rikaz (buried treasure) is due at a flat 20% regardless of nisab; all other
  // zakat types are only due once net zakatable wealth reaches nisab.
  const nisabMet = input.zakatType === 'rikaz' || netZakatableMinor >= nisabThresholdMinor;
  const zakatDueMinor = nisabMet ? Math.floor((netZakatableMinor * rateBps) / 10000) : 0;

  return {
    nisabThresholdMinor,
    netZakatableMinor,
    zakatDueMinor,
    nisabMet,
    grossAssetsMinor: input.grossAssetsMinor,
    deductibleLiabilitiesMinor: input.deductibleLiabilitiesMinor,
    zakatRateBps: rateBps,
  };
}

async function getNisabGoldPrice(db: Knex, companyId: number): Promise<number> {
  const param = await db('base_config_parameters')
    .where({ key: 'sharia.nisab_gold_price_per_gram_minor', active: true })
    .andWhere(builder => builder.where({ company_id: companyId }).orWhereNull('company_id'))
    .orderBy('id', 'desc')
    .first();
  if (param?.value) return parseTypedConfigValue(param.value, param.value_type as ConfigParameterValueType) as number;

  const fallback = await db('base_config_parameters')
    .where({ key: 'sharia.nisab_gold_price_per_gram_minor', company_id: null, active: true })
    .orderBy('id', 'desc')
    .first();
  if (fallback?.value) return parseTypedConfigValue(fallback.value, fallback.value_type as ConfigParameterValueType) as number;

  return 12000000;
}

export async function distributeProfitSharing(db: Knex, input: ProfitSharingInput): Promise<ProfitSharingResult> {
  const contract = await db(ShariaContract.tableName).where({ id: input.contractId }).first();
  if (!contract) throw new Error(`ShariaContract ${input.contractId} not found`);

  const ratio = parseProfitSharingRatio(contract.profit_sharing_ratio ?? '60:40');
  const netProfitMinor = input.grossProfitMinor - input.operatingExpensesMinor;
  if (netProfitMinor < 0) throw new Error('Net profit cannot be negative');

  const customerShareMinor = Math.floor((netProfitMinor * ratio.customerBps) / 10000);
  const companyShareMinor = netProfitMinor - customerShareMinor;

  const journalLines: JournalLine[] = [
    {
      accountCode: '6400',
      accountName: 'Profit Sharing Expense',
      debitMinor: netProfitMinor,
      creditMinor: 0,
      description: `Profit sharing distribution for contract ${contract.contract_no} (${input.periodStart} to ${input.periodEnd})`,
    },
    {
      accountCode: contract.type === 'mudharabah' || contract.type === 'musyarakah' ? '2450' : '2400',
      accountName: contract.type === 'mudharabah' || contract.type === 'musyarakah' ? 'Customer Mudharabah/Musyarakah Payable' : 'Customer Murabahah/Ijarah Payable',
      debitMinor: 0,
      creditMinor: customerShareMinor,
      description: `Customer share (${ratio.customerBps / 100}%) for contract ${contract.contract_no}`,
    },
    {
      accountCode: '3300',
      accountName: 'Retained Earnings - Profit Sharing',
      debitMinor: 0,
      creditMinor: companyShareMinor,
      description: `Company share (${ratio.companyBps / 100}%) for contract ${contract.contract_no}`,
    },
  ];

  const journalPayload = JSON.stringify({
    contractId: contract.id,
    contractNo: contract.contract_no,
    contractType: contract.type,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    grossProfitMinor: input.grossProfitMinor,
    operatingExpensesMinor: input.operatingExpensesMinor,
    netProfitMinor,
    customerShareMinor,
    companyShareMinor,
    distributionDate: input.distributionDate,
    journalLines,
    approvedBy: input.approvedById,
    timestamp: new Date().toISOString(),
  });
  const merkleRoot = sha256(journalPayload);
  const journalEntryRef = `JE-SHARIA-${input.distributionDate.replace(/-/g, '')}-${contract.contract_no}`;

  await db(ProfitSharingDistribution.tableName).insert({
    contract_id: input.contractId,
    company_id: contract.company_id,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    gross_profit_minor: input.grossProfitMinor,
    operating_expenses_minor: input.operatingExpensesMinor,
    net_profit_minor: netProfitMinor,
    customer_share_minor: customerShareMinor,
    company_share_minor: companyShareMinor,
    distribution_date: input.distributionDate,
    posted_to_accounting: true,
    journal_entry_ref: journalEntryRef,
    approved_by: input.approvedById,
    merkle_root: merkleRoot,
    notes: input.notes,
    create_uid: input.approvedById,
    write_uid: input.approvedById,
  });

  return { netProfitMinor, customerShareMinor, companyShareMinor, journalEntryRef, journalLines, merkleRoot };
}

export function validateShariaContract(input: ContractValidationInput): ContractValidationResult {
  const violations: string[] = [];

  if (!input.ribaFreeConfirmed) violations.push('Riba-free confirmation is required');
  if (!input.ghararFreeConfirmed) violations.push('Gharar-free confirmation is required');
  if (input.assetValueMinor <= 0) violations.push('Asset value must be positive');
  if (!input.dsnMuiReference || !input.dsnMuiReference.trim()) violations.push('DSN-MUI reference is required');

  switch (input.type) {
    case 'murabahah': {
      if (input.profitMarginMinor === undefined || input.profitMarginMinor <= 0) {
        violations.push('Murabahah requires positive profit_margin_minor');
      }
      if (input.assetValueMinor <= 0) violations.push('Murabahah requires positive asset_value_minor');
      break;
    }
    case 'mudharabah': {
      if (!input.profitSharingRatio || !/^\d+:\d+$/.test(input.profitSharingRatio)) {
        violations.push('Mudharabah requires profit_sharing_ratio in format "customer:company"');
      }
      if (input.financingAmountMinor === undefined || input.financingAmountMinor <= 0) {
        violations.push('Mudharabah requires positive financing_amount_minor');
      }
      break;
    }
    case 'musyarakah': {
      if (!input.profitSharingRatio || !/^\d+:\d+$/.test(input.profitSharingRatio)) {
        violations.push('Musyarakah requires profit_sharing_ratio in format "customer:company"');
      }
      if (input.financingAmountMinor === undefined || input.financingAmountMinor <= 0) {
        violations.push('Musyarakah requires positive financing_amount_minor');
      }
      break;
    }
    case 'ijarah': {
      if (input.tenorMonths === undefined || input.tenorMonths <= 0) {
        violations.push('Ijarah requires positive tenor_months');
      }
      if (input.assetValueMinor <= 0) violations.push('Ijarah requires positive asset_value_minor');
      break;
    }
  }

  return { valid: violations.length === 0, violations, contractType: input.type };
}

export async function computeWaqfMerkle(db: Knex, input: WaqfMerkleInput): Promise<WaqfMerkleResult> {
  const asset = await findWaqfAsset(db, input.assetId);

  const trail = input.trail.map(node => ({
    ...node,
    hash: sha256(JSON.stringify({ ...node, hash: undefined })),
  }));

  const hashes = trail.map(n => n.hash);
  const merkleRoot = buildMerkleRoot(hashes);

  const verified = asset === null || asset.merkle_root === merkleRoot;

  return { merkleRoot, trail, verified };
}

export async function appendWaqfMerkleEvent(db: Knex, assetId: number, event: Omit<MerkleTrailNode, 'hash'>): Promise<WaqfMerkleResult> {
  const asset = await findWaqfAsset(db, assetId);

  const existingTrailStr = asset?.merkle_trail ?? (MOCK_WAQF_TRAILS.get(assetId) ? JSON.stringify(MOCK_WAQF_TRAILS.get(assetId)) : '[]');
  const existingTrail: MerkleTrailNode[] = existingTrailStr ? JSON.parse(existingTrailStr) : [];
  const newNode: MerkleTrailNode = { ...event, hash: sha256(JSON.stringify(event)) };
  const updatedTrail = [...existingTrail, newNode];
  const hashes = updatedTrail.map(n => n.hash);
  const merkleRoot = buildMerkleRoot(hashes);

  if (typeof db === 'function') {
    await db(WaqfAsset.tableName).where({ id: assetId }).update({
      merkle_trail: JSON.stringify(updatedTrail),
      merkle_root: merkleRoot,
      write_uid: 1,
    });
  } else {
    MOCK_WAQF_TRAILS.set(assetId, updatedTrail.map(n => JSON.stringify(n)));
  }

  return { merkleRoot, trail: updatedTrail, verified: true };
}

async function findWaqfAsset(
  db: Knex,
  assetId: number,
): Promise<{ merkle_root?: string | null; merkle_trail?: string | null } | null> {
  if (typeof db !== 'function') {
    const trail = MOCK_WAQF_TRAILS.get(assetId);
    if (trail) {
      return {
        merkle_root: buildMerkleRoot(trail.map(n => JSON.parse(n).hash)),
        merkle_trail: JSON.stringify(trail.map(n => JSON.parse(n))),
      };
    }
    return null;
  }
  const asset = await db(WaqfAsset.tableName).where({ id: assetId }).first();
  return asset ?? null;
}

function parseTypedConfigValue(raw: string, valueType: ConfigParameterValueType): unknown {
  switch (valueType) {
    case 'integer': {
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) ? parsed : raw;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'json':
      try { return JSON.parse(raw); } catch { return raw; }
    case 'string':
    default:
      return raw;
  }
}

export type ShariaContractType = 'murabahah' | 'mudharabah' | 'musyarakah' | 'ijarah';