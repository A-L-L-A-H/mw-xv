import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Partner } from '@moonwitness/orm-base';
import { Company } from '@moonwitness/orm-base';
import { User } from '@moonwitness/orm-base';
import { Tag } from '@moonwitness/orm-base';
import { TagLink } from '@moonwitness/orm-base';

function parentLeadModel(): typeof BaseModel {
  return Lead;
}

export const LeadStage = defineModel('crm.lead_stage', {
  table: 'crm_lead_stages',
  order: 'sequence asc, name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    sequence: fields.integer({ required: true, default: 10 }),
    is_won: fields.boolean({ required: true, default: false }),
    is_lost: fields.boolean({ required: true, default: false }),
    color: fields.string({ pattern: '^#[0-9A-Fa-f]{6}$', default: '#64748B', label: 'Color' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});

export const Lead = defineModel('crm.lead', {
  table: 'crm_leads',
  order: 'create_date desc',
  fields: {
    name: fields.string({ required: true }),
    email: fields.string({ unique: true, label: 'Email' }),
    phone: fields.string({ label: 'Phone' }),
    mobile: fields.string({ label: 'Mobile' }),
    partner: fields.belongsTo(Partner, { label: 'Related Partner' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
    stage: fields.belongsTo(LeadStage, { required: true, label: 'Stage' }),
    probability: fields.integer({ required: true, default: 0 }),
    expected_revenue_minor: fields.integer({ label: 'Expected Revenue (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    description: fields.text({ label: 'Description' }),
    source: fields.string({ label: 'Lead Source' }),
    assigned_to: fields.belongsTo(User, { label: 'Salesperson' }),
    deadline: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    tags: fields.hasMany(TagLink, {
      foreignKey: 'resource_id',
      label: 'Tags',
    }),
    parent: fields.belongsTo(parentLeadModel, { label: 'Parent Lead' }),
  },
});

export const Opportunity = defineModel('crm.opportunity', {
  table: 'crm_opportunities',
  order: 'create_date desc',
  fields: {
    name: fields.string({ required: true }),
    partner: fields.belongsTo(Partner, { required: true, label: 'Customer' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
    stage: fields.belongsTo(LeadStage, { required: true, label: 'Stage' }),
    probability: fields.integer({ required: true, default: 0 }),
    expected_revenue_minor: fields.integer({ label: 'Expected Revenue (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    description: fields.text({ label: 'Description' }),
    assigned_to: fields.belongsTo(User, { label: 'Salesperson' }),
    deadline: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    won_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    lost_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    lost_reason: fields.text({ label: 'Lost Reason' }),
    tags: fields.hasMany(TagLink, {
      foreignKey: 'resource_id',
      label: 'Tags',
    }),
  },
});

export const LeadTagLink = defineModel('crm.lead_tag_link', {
  table: 'crm_lead_tag_links',
  order: 'id desc',
  unique: [['tag', 'resource_model', 'resource_id']],
  fields: {
    tag: fields.belongsTo(Tag, { required: true }),
    resource_model: fields.string({
      required: true,
      pattern: '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$',
    }),
    resource_id: fields.integer({ required: true }),
  },
});
