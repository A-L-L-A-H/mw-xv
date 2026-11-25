import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import {
  ALLOCATION_STATUSES,
  MANDATE_STATUSES,
  OFFICIAL_STATUSES,
  POLICY_STATUSES,
  PROGRAM_STATUSES,
  REGULATION_STATUSES,
} from './statuses.js';

export type {
  AllocationStatus,
  MandateStatus,
  OfficialStatus,
  PolicyStatus,
  ProgramStatus,
  RegulationStatus,
} from './statuses.js';

const INSTITUTION_TYPES = [
  'ministry',
  'agency',
  'legislature',
  'judiciary',
  'state_enterprise',
  'advisory_body',
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

function parentInstitutionModel(): typeof BaseModel {
  return Institution;
}

export const Institution = defineModel('governance.institution', {
  table: 'governance_institutions',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true, label: 'Institution Name' }),
    code: fields.string({ required: true, unique: true, label: 'Institution Code' }),
    type: fields.enum(INSTITUTION_TYPES, { required: true, label: 'Institution Type' }),
    parent: fields.belongsTo(parentInstitutionModel, { label: 'Parent Institution' }),
    jurisdiction: fields.string({ label: 'Jurisdiction' }),
    seat_city: fields.string({ label: 'Seat City' }),
    founded_on: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Founded On',
    }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const Official = defineModel('governance.official', {
  table: 'governance_officials',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, label: 'Official Name' }),
    title: fields.string({ required: true, label: 'Title' }),
    institution: fields.belongsTo(Institution, { required: true, label: 'Institution' }),
    status: fields.enum(OFFICIAL_STATUSES, { required: true, default: 'active', label: 'Status' }),
    appointed_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Appointed On' }),
    term_end: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Term End' }),
    contact_email: fields.string({ label: 'Contact Email' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const Mandate = defineModel('governance.mandate', {
  table: 'governance_mandates',
  order: 'id desc',
  fields: {
    name: fields.string({ required: true, label: 'Mandate Name' }),
    official: fields.belongsTo(Official, { required: true, label: 'Office Holder' }),
    institution: fields.belongsTo(Institution, { required: true, label: 'Institution' }),
    status: fields.enum(MANDATE_STATUSES, { required: true, default: 'pending', label: 'Status' }),
    starts_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Starts On' }),
    ends_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Ends On' }),
    scope: fields.string({ label: 'Mandate Scope' }),
    responsibilities: fields.json({ label: 'Responsibilities' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const Policy = defineModel('governance.policy', {
  table: 'governance_policies',
  order: 'id desc',
  fields: {
    name: fields.string({ required: true, label: 'Policy Name' }),
    code: fields.string({ required: true, unique: true, label: 'Policy Code' }),
    institution: fields.belongsTo(Institution, { required: true, label: 'Sponsoring Institution' }),
    status: fields.enum(POLICY_STATUSES, { required: true, default: 'draft', label: 'Status' }),
    current_version: fields.string({ label: 'Current Version' }),
    summary: fields.text({ label: 'Summary' }),
    stakeholder_ids: fields.json({ label: 'Stakeholder IDs' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const PolicyVersion = defineModel('governance.policy_version', {
  table: 'governance_policy_versions',
  order: 'id desc',
  fields: {
    policy: fields.belongsTo(Policy, { required: true, label: 'Policy' }),
    version: fields.string({ required: true, label: 'Version Label' }),
    status: fields.enum(POLICY_STATUSES, { required: true, default: 'draft', label: 'Status' }),
    change_summary: fields.text({ label: 'Change Summary' }),
    authored_by: fields.belongsTo(Official, { label: 'Authored By' }),
    effective_from: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Effective From' }),
    effective_to: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Effective To' }),
    body_markdown: fields.text({ label: 'Policy Body' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const Regulation = defineModel('governance.regulation', {
  table: 'governance_regulations',
  order: 'id desc',
  fields: {
    name: fields.string({ required: true, label: 'Regulation Name' }),
    number: fields.string({ required: true, unique: true, label: 'Regulation Number' }),
    institution: fields.belongsTo(Institution, { required: true, label: 'Issuing Institution' }),
    status: fields.enum(REGULATION_STATUSES, {
      required: true,
      default: 'proposed',
      label: 'Status',
    }),
    policy: fields.belongsTo(Policy, { label: 'Underlying Policy' }),
    issued_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Issued On' }),
    enforced_from: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Enforced From' }),
    citation: fields.string({ label: 'Citation' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const PublicProgram = defineModel('governance.public_program', {
  table: 'governance_public_programs',
  order: 'id desc',
  fields: {
    name: fields.string({ required: true, label: 'Program Name' }),
    code: fields.string({ required: true, unique: true, label: 'Program Code' }),
    institution: fields.belongsTo(Institution, {
      required: true,
      label: 'Implementing Institution',
    }),
    status: fields.enum(PROGRAM_STATUSES, { required: true, default: 'planned', label: 'Status' }),
    policy: fields.belongsTo(Policy, { label: 'Mandating Policy' }),
    program_lead: fields.belongsTo(Official, { label: 'Program Lead' }),
    starts_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Starts On' }),
    ends_on: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Ends On' }),
    target_beneficiaries: fields.integer({ label: 'Target Beneficiaries' }),
    outcome_notes: fields.text({ label: 'Outcome Notes' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});

export const BudgetAllocation = defineModel('governance.budget_allocation', {
  table: 'governance_budget_allocations',
  order: 'id desc',
  fields: {
    name: fields.string({ required: true, label: 'Allocation Name' }),
    program: fields.belongsTo(PublicProgram, { required: true, label: 'Program' }),
    institution: fields.belongsTo(Institution, { required: true, label: 'Budget Holder' }),
    status: fields.enum(ALLOCATION_STATUSES, {
      required: true,
      default: 'proposed',
      label: 'Status',
    }),
    fiscal_year: fields.integer({ required: true, label: 'Fiscal Year' }),
    amount_minor: fields.integer({ required: true, label: 'Amount (minor units)' }),
    currency: fields.string({ required: true, default: 'IDR', label: 'Currency' }),
    line_items: fields.json({ label: 'Line Items' }),
    approved_by: fields.belongsTo(Official, { label: 'Approved By' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    external_ref: fields.string({ label: 'External Reference', help: 'Cross-package link key' }),
  },
});
