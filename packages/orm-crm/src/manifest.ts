import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { LeadStage, Lead, Opportunity, LeadTagLink } from './models/index.js';

export const manifest = defineAddon({
  name: 'crm',
  version: '1.0.0',
  depends: ['base'],
  models: [LeadStage, Lead, Opportunity, LeadTagLink],
  data: [
    seed(LeadStage, 'crm.stage_new', {
      company: ref('base.company_default'),
      name: 'New',
      sequence: 10,
      is_won: false,
      is_lost: false,
      color: '#64748B',
    }),
    seed(LeadStage, 'crm.stage_qualified', {
      company: ref('base.company_default'),
      name: 'Qualified',
      sequence: 20,
      is_won: false,
      is_lost: false,
      color: '#3B82F6',
    }),
    seed(LeadStage, 'crm.stage_won', {
      company: ref('base.company_default'),
      name: 'Won',
      sequence: 90,
      is_won: true,
      is_lost: false,
      color: '#22C55E',
    }),
    seed(LeadStage, 'crm.stage_lost', {
      company: ref('base.company_default'),
      name: 'Lost',
      sequence: 100,
      is_won: false,
      is_lost: true,
      color: '#EF4444',
    }),
    seed(ModelAccess, 'crm.access_user_lead_read', {
      group: ref('base.group_user'),
      model_name: Lead.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'crm.access_user_opportunity_read', {
      group: ref('base.group_user'),
      model_name: Opportunity.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'crm.access_user_lead_stage_read', {
      group: ref('base.group_user'),
      model_name: LeadStage.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
  ],
  menus: [
    {
      model: Lead.modelName,
      label: 'Leads',
      group: 'CRM',
      sequence: 10,
    },
    {
      model: Opportunity.modelName,
      label: 'Opportunities',
      group: 'CRM',
      sequence: 20,
    },
    {
      model: LeadStage.modelName,
      label: 'Lead Stages',
      group: 'CRM',
      sequence: 25,
      developmentOnly: true,
    },
  ],
});
