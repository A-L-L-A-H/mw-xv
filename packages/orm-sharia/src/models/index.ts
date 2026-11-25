import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';
import { Partner } from '@moonwitness/orm-base';
import { User } from '@moonwitness/orm-base';
import { Currency } from '@moonwitness/orm-base';

export type ShariaContractType = 'murabahah' | 'mudharabah' | 'musyarakah' | 'ijarah';
export type ShariaContractStatus = 'draft' | 'active' | 'completed' | 'terminated' | 'disputed';

export const ShariaContract = defineModel('sharia.contract', {
  table: 'sharia_contracts',
  order: 'create_date desc',
  fields: {
    contract_no: fields.string({ required: true, unique: true, label: 'Contract No' }),
    type: fields.string({
      required: true,
      values: ['murabahah', 'mudharabah', 'musyarakah', 'ijarah'],
      label: 'Contract Type',
    }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'active', 'completed', 'terminated', 'disputed'],
      label: 'Status',
    }),
    customer: fields.belongsTo(Partner, { required: true, label: 'Customer' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    currency: fields.belongsTo(Currency, { required: true, label: 'Currency' }),
    asset_description: fields.text({ required: true, label: 'Asset Description' }),
    asset_value_minor: fields.integer({ required: true, label: 'Asset Value (minor units)' }),
    financing_amount_minor: fields.integer({ label: 'Financing Amount (minor units)' }),
    profit_margin_minor: fields.integer({ label: 'Profit Margin (minor units)' }),
    profit_sharing_ratio: fields.string({ label: 'Profit Sharing Ratio (e.g., 60:40)' }),
    tenor_months: fields.integer({ label: 'Tenor (months)' }),
    start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Start Date' }),
    end_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'End Date' }),
    dsn_mui_reference: fields.string({ label: 'DSN-MUI Reference Standard' }),
    sharia_board_approval: fields.string({ label: 'Sharia Board Approval Ref' }),
    riba_free_confirmed: fields.boolean({
      required: true,
      default: true,
      label: 'Riba-Free Confirmed',
    }),
    gharar_free_confirmed: fields.boolean({
      required: true,
      default: true,
      label: 'Gharar-Free Confirmed',
    }),
    assigned_officer: fields.belongsTo(User, { label: 'Assigned Officer' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const ProfitSharingDistribution = defineModel('sharia.profit_sharing_distribution', {
  table: 'sharia_profit_sharing_distributions',
  order: 'distribution_date desc',
  fields: {
    contract: fields.belongsTo(ShariaContract, { required: true, label: 'Sharia Contract' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    period_start: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period Start',
    }),
    period_end: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period End',
    }),
    gross_profit_minor: fields.integer({ required: true, label: 'Gross Profit (minor units)' }),
    operating_expenses_minor: fields.integer({
      default: 0,
      label: 'Operating Expenses (minor units)',
    }),
    net_profit_minor: fields.integer({ required: true, label: 'Net Profit (minor units)' }),
    customer_share_minor: fields.integer({ required: true, label: 'Customer Share (minor units)' }),
    company_share_minor: fields.integer({ required: true, label: 'Company Share (minor units)' }),
    distribution_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Distribution Date',
    }),
    posted_to_accounting: fields.boolean({
      required: true,
      default: false,
      label: 'Posted to Accounting',
    }),
    journal_entry_ref: fields.string({ label: 'Journal Entry Reference' }),
    approved_by: fields.belongsTo(User, { label: 'Approved By' }),
    merkle_root: fields.string({ label: 'Merkle Root' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const ZakatAssessment = defineModel('sharia.zakat_assessment', {
  table: 'sharia_zakat_assessments',
  order: 'assessment_date desc',
  fields: {
    assessment_no: fields.string({ required: true, unique: true, label: 'Assessment No' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    assessment_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Assessment Date',
    }),
    hijri_year: fields.integer({ required: true, label: 'Hijri Year' }),
    nisab_gold_price_per_gram_minor: fields.integer({
      required: true,
      label: 'Nisab Gold Price/Gram (minor units)',
    }),
    nisab_threshold_minor: fields.integer({
      required: true,
      label: 'Nisab Threshold (minor units)',
    }),
    zakat_type: fields.string({
      required: true,
      values: ['maal', 'fitrah', 'profession', 'trade', 'agriculture', 'livestock', 'rikaz'],
      label: 'Zakat Type',
    }),
    asset_category: fields.string({
      required: true,
      values: [
        'gold',
        'silver',
        'cash',
        'receivables',
        'inventory',
        'investment',
        'property',
        'other',
      ],
      label: 'Asset Category',
    }),
    gross_assets_minor: fields.integer({ required: true, label: 'Gross Assets (minor units)' }),
    deductible_liabilities_minor: fields.integer({
      default: 0,
      label: 'Deductible Liabilities (minor units)',
    }),
    net_zakatable_minor: fields.integer({ required: true, label: 'Net Zakatable (minor units)' }),
    zakat_due_minor: fields.integer({ required: true, label: 'Zakat Due (minor units)' }),
    zakat_rate_bps: fields.integer({ required: true, default: 250, label: 'Zakat Rate (bps)' }),
    status: fields.string({
      required: true,
      default: 'calculated',
      values: ['calculated', 'verified', 'paid', 'distributed'],
      label: 'Status',
    }),
    paid_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Paid Date' }),
    paid_to: fields.string({ label: 'Paid To (Institution/Amil)' }),
    payment_reference: fields.string({ label: 'Payment Reference' }),
    calculated_by: fields.belongsTo(User, { label: 'Calculated By' }),
    verified_by: fields.belongsTo(User, { label: 'Verified By' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const WaqfAsset = defineModel('sharia.waqf_asset', {
  table: 'sharia_waqf_assets',
  order: 'create_date desc',
  fields: {
    asset_code: fields.string({ required: true, unique: true, label: 'Asset Code' }),
    name: fields.string({ required: true, label: 'Asset Name' }),
    description: fields.text({ label: 'Description' }),
    asset_type: fields.string({
      required: true,
      values: [
        'productive',
        'non_productive',
        'digital_infra',
        'real_estate',
        'equipment',
        'intellectual_property',
      ],
      label: 'Asset Type',
    }),
    company: fields.belongsTo(Company, { required: true, label: 'Company (Nazir)' }),
    waqf_status: fields.string({
      required: true,
      default: 'active',
      values: ['active', 'inactive', 'transferred', 'disputed'],
      label: 'Waqf Status',
    }),
    acquisition_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Acquisition Date',
    }),
    acquisition_value_minor: fields.integer({
      required: true,
      label: 'Acquisition Value (minor units)',
    }),
    current_value_minor: fields.integer({ label: 'Current Value (minor units)' }),
    beneficiary_category: fields.string({
      label: 'Beneficiary Category',
      values: [
        'education',
        'healthcare',
        'poverty_relief',
        'mosque',
        'research',
        'digital_infra',
        'general',
      ],
    }),
    nazir: fields.belongsTo(User, { required: true, label: 'Nazir (Manager)' }),
    supervisor: fields.belongsTo(User, { label: 'Supervisor' }),
    merkle_root: fields.string({ label: 'Merkle Root' }),
    merkle_trail: fields.text({ label: 'Merkle Trail (JSON)' }),
    is_productive: fields.boolean({ required: true, default: false, label: 'Productive Asset' }),
    annual_yield_minor: fields.integer({ default: 0, label: 'Annual Yield (minor units)' }),
    last_valuation_date: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Last Valuation Date',
    }),
    deed_reference: fields.string({ label: 'Waqf Deed Reference' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const HalalComplianceAudit = defineModel('sharia.halal_compliance_audit', {
  table: 'sharia_halal_compliance_audits',
  order: 'audit_date desc',
  fields: {
    audit_no: fields.string({ required: true, unique: true, label: 'Audit No' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    audit_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Audit Date',
    }),
    audit_scope: fields.string({
      required: true,
      values: ['product', 'process', 'facility', 'supply_chain', 'full'],
      label: 'Audit Scope',
    }),
    standard_reference: fields.string({
      required: true,
      default: 'MUI-HALAL-2024',
      label: 'Standard Reference',
    }),
    auditor: fields.belongsTo(User, { required: true, label: 'Auditor' }),
    status: fields.string({
      required: true,
      default: 'planned',
      values: ['planned', 'in_progress', 'completed', 'non_compliant', 'certified'],
      label: 'Status',
    }),
    findings: fields.text({ label: 'Findings (JSON)' }),
    critical_findings_count: fields.integer({
      required: true,
      default: 0,
      label: 'Critical Findings',
    }),
    major_findings_count: fields.integer({ required: true, default: 0, label: 'Major Findings' }),
    minor_findings_count: fields.integer({ required: true, default: 0, label: 'Minor Findings' }),
    recommendations: fields.text({ label: 'Recommendations' }),
    certificate_number: fields.string({ label: 'Certificate Number' }),
    certificate_expiry: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Certificate Expiry',
    }),
    next_audit_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Next Audit Date' }),
    approved_by: fields.belongsTo(User, { label: 'Approved By' }),
    notes: fields.text({ label: 'Notes' }),
  },
});
