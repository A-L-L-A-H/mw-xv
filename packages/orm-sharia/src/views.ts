import { defineView } from '@moonwitness/orm';
import {
  ShariaContract,
  ProfitSharingDistribution,
  ZakatAssessment,
  WaqfAsset,
  HalalComplianceAudit,
} from './models/index.js';

export const views = [
  defineView(ShariaContract, {
    title: 'Sharia Contracts',
    list: {
      columns: [
        'contract_no',
        'type',
        'status',
        'customer',
        'company',
        'currency',
        'asset_value_minor',
        'profit_sharing_ratio',
        'start_date',
        'end_date',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'draft']] },
        { color: 'danger', domain: [['status', '=', 'disputed']] },
        { color: 'info', domain: [['status', '=', 'completed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Contract Details',
          columns: 2,
          fields: ['contract_no', 'company', 'currency', 'type', 'status', 'customer'],
        },
        {
          title: 'Financial Terms',
          columns: 2,
          fields: [
            'asset_value_minor',
            'financing_amount_minor',
            'profit_margin_minor',
            'profit_sharing_ratio',
            'tenor_months',
            'start_date',
            'end_date',
          ],
        },
        {
          title: 'Compliance',
          columns: 2,
          fields: [
            'dsn_mui_reference',
            'sharia_board_approval',
            'riba_free_confirmed',
            'gharar_free_confirmed',
          ],
        },
        {
          title: 'Assignment & Notes',
          columns: 2,
          fields: ['assigned_officer', 'notes'],
        },
      ],
    },
    search: {
      fields: ['contract_no', 'asset_description', 'dsn_mui_reference', 'sharia_board_approval'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Draft', domain: [['status', '=', 'draft']] },
        { label: 'Murabahah', domain: [['type', '=', 'murabahah']] },
        { label: 'Mudharabah', domain: [['type', '=', 'mudharabah']] },
        { label: 'Musyarakah', domain: [['type', '=', 'musyarakah']] },
        { label: 'Ijarah', domain: [['type', '=', 'ijarah']] },
      ],
      groupBy: [
        { label: 'Type', field: 'type' },
        { label: 'Status', field: 'status' },
        { label: 'Customer', field: 'customer_id' },
        { label: 'Company', field: 'company_id' },
      ],
    },
  }),

  defineView(ProfitSharingDistribution, {
    title: 'Profit Sharing Distributions',
    list: {
      columns: [
        'contract',
        'period_start',
        'period_end',
        'gross_profit_minor',
        'net_profit_minor',
        'customer_share_minor',
        'company_share_minor',
        'distribution_date',
        'posted_to_accounting',
      ],
      order: 'distribution_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['posted_to_accounting', '=', true]] },
        { color: 'warning', domain: [['posted_to_accounting', '=', false]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Distribution',
          columns: 2,
          fields: [
            'contract',
            'company',
            'period_start',
            'period_end',
            'distribution_date',
            'approved_by',
          ],
        },
        {
          title: 'Financials',
          columns: 2,
          fields: [
            'gross_profit_minor',
            'operating_expenses_minor',
            'net_profit_minor',
            'customer_share_minor',
            'company_share_minor',
          ],
        },
        {
          title: 'Accounting Posting',
          columns: 2,
          fields: ['posted_to_accounting', 'journal_entry_ref', 'merkle_root'],
        },
        {
          title: 'Notes',
          fields: ['notes'],
        },
      ],
    },
    search: {
      fields: ['journal_entry_ref', 'merkle_root', 'notes'],
      filters: [
        { label: 'Posted to Accounting', domain: [['posted_to_accounting', '=', true]] },
        { label: 'Not Posted', domain: [['posted_to_accounting', '=', false]] },
      ],
      groupBy: [
        { label: 'Contract', field: 'contract_id' },
        { label: 'Company', field: 'company_id' },
        { label: 'Distribution Date', field: 'distribution_date' },
      ],
    },
  }),

  defineView(ZakatAssessment, {
    title: 'Zakat Assessments',
    list: {
      columns: [
        'assessment_no',
        'company',
        'assessment_date',
        'hijri_year',
        'zakat_type',
        'asset_category',
        'gross_assets_minor',
        'net_zakatable_minor',
        'zakat_due_minor',
        'status',
      ],
      order: 'assessment_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'paid']] },
        { color: 'info', domain: [['status', '=', 'verified']] },
        { color: 'warning', domain: [['status', '=', 'calculated']] },
        { color: 'danger', domain: [['status', '=', 'distributed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Assessment',
          columns: 2,
          fields: [
            'assessment_no',
            'company',
            'assessment_date',
            'hijri_year',
            'zakat_type',
            'asset_category',
            'calculated_by',
            'verified_by',
          ],
        },
        {
          title: 'Financials',
          columns: 2,
          fields: [
            'nisab_gold_price_per_gram_minor',
            'nisab_threshold_minor',
            'gross_assets_minor',
            'deductible_liabilities_minor',
            'net_zakatable_minor',
            'zakat_due_minor',
            'zakat_rate_bps',
          ],
        },
        {
          title: 'Payment',
          columns: 2,
          fields: ['status', 'paid_date', 'paid_to', 'payment_reference'],
        },
        {
          title: 'Notes',
          fields: ['notes'],
        },
      ],
    },
    search: {
      fields: ['assessment_no', 'paid_to', 'payment_reference', 'notes'],
      filters: [
        { label: 'Calculated', domain: [['status', '=', 'calculated']] },
        { label: 'Verified', domain: [['status', '=', 'verified']] },
        { label: 'Paid', domain: [['status', '=', 'paid']] },
        { label: 'Distributed', domain: [['status', '=', 'distributed']] },
        { label: 'Maal', domain: [['zakat_type', '=', 'maal']] },
        { label: 'Trade', domain: [['zakat_type', '=', 'trade']] },
      ],
      groupBy: [
        { label: 'Zakat Type', field: 'zakat_type' },
        { label: 'Status', field: 'status' },
        { label: 'Company', field: 'company_id' },
        { label: 'Hijri Year', field: 'hijri_year' },
      ],
    },
  }),

  defineView(WaqfAsset, {
    title: 'Waqf Assets',
    list: {
      columns: [
        'asset_code',
        'name',
        'asset_type',
        'company',
        'waqf_status',
        'is_productive',
        'acquisition_value_minor',
        'current_value_minor',
        'annual_yield_minor',
        'beneficiary_category',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['is_productive', '=', true]] },
        { color: 'info', domain: [['asset_type', '=', 'digital_infra']] },
        { color: 'warning', domain: [['waqf_status', '=', 'inactive']] },
        { color: 'danger', domain: [['waqf_status', '=', 'disputed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Asset Identity',
          columns: 2,
          fields: ['asset_code', 'name', 'company', 'asset_type', 'waqf_status', 'is_productive'],
        },
        {
          title: 'Valuation & Yield',
          columns: 2,
          fields: [
            'acquisition_date',
            'acquisition_value_minor',
            'current_value_minor',
            'annual_yield_minor',
            'last_valuation_date',
          ],
        },
        {
          title: 'Governance',
          columns: 2,
          fields: ['beneficiary_category', 'nazir', 'supervisor', 'deed_reference'],
        },
        {
          title: 'Merkle Trail',
          columns: 2,
          fields: ['merkle_root', 'merkle_trail'],
        },
        {
          title: 'Description & Notes',
          fields: ['description', 'notes'],
        },
      ],
    },
    search: {
      fields: ['asset_code', 'name', 'description', 'deed_reference', 'merkle_trail'],
      filters: [
        { label: 'Productive', domain: [['is_productive', '=', true]] },
        { label: 'Digital Infrastructure', domain: [['asset_type', '=', 'digital_infra']] },
        { label: 'Active', domain: [['waqf_status', '=', 'active']] },
      ],
      groupBy: [
        { label: 'Asset Type', field: 'asset_type' },
        { label: 'Beneficiary Category', field: 'beneficiary_category' },
        { label: 'Company (Nazir)', field: 'company_id' },
        { label: 'Status', field: 'waqf_status' },
      ],
    },
  }),

  defineView(HalalComplianceAudit, {
    title: 'Halal Compliance Audits',
    list: {
      columns: [
        'audit_no',
        'company',
        'audit_date',
        'audit_scope',
        'standard_reference',
        'auditor',
        'status',
        'critical_findings_count',
        'major_findings_count',
        'minor_findings_count',
      ],
      order: 'audit_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'certified']] },
        { color: 'info', domain: [['status', '=', 'completed']] },
        { color: 'warning', domain: [['status', '=', 'in_progress']] },
        { color: 'danger', domain: [['status', '=', 'non_compliant']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Audit',
          columns: 2,
          fields: [
            'audit_no',
            'company',
            'audit_date',
            'audit_scope',
            'standard_reference',
            'auditor',
            'status',
          ],
        },
        {
          title: 'Findings',
          columns: 2,
          fields: ['critical_findings_count', 'major_findings_count', 'minor_findings_count'],
        },
        {
          title: 'Details',
          fields: ['findings', 'recommendations'],
        },
        {
          title: 'Certification',
          columns: 2,
          fields: ['certificate_number', 'certificate_expiry', 'next_audit_date', 'approved_by'],
        },
        {
          title: 'Notes',
          fields: ['notes'],
        },
      ],
    },
    search: {
      fields: ['audit_no', 'findings', 'recommendations', 'certificate_number'],
      filters: [
        { label: 'Certified', domain: [['status', '=', 'certified']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
        { label: 'In Progress', domain: [['status', '=', 'in_progress']] },
        { label: 'Non-Compliant', domain: [['status', '=', 'non_compliant']] },
        { label: 'Product Scope', domain: [['audit_scope', '=', 'product']] },
        { label: 'Full Scope', domain: [['audit_scope', '=', 'full']] },
      ],
      groupBy: [
        { label: 'Audit Scope', field: 'audit_scope' },
        { label: 'Status', field: 'status' },
        { label: 'Company', field: 'company_id' },
        { label: 'Auditor', field: 'auditor_id' },
      ],
    },
  }),
];
