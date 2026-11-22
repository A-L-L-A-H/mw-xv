import { defineView } from '@moonwitness/orm';
import { Lead, LeadStage, LeadTagLink, Opportunity } from './models/index.js';

export const views = [
  defineView(LeadStage, {
    title: 'Lead Stages',
    list: {
      columns: ['sequence', 'name', 'is_won', 'is_lost', 'color', 'company'],
      order: 'sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Stage',
          columns: 2,
          fields: ['company', 'name', 'sequence', 'is_won', 'is_lost', 'color'],
        },
      ],
    },
    search: { fields: ['name'] },
  }),
  defineView(Lead, {
    title: 'CRM Leads',
    list: {
      columns: [
        'name',
        'partner',
        'stage',
        'probability',
        'expected_revenue_minor',
        'source',
        'assigned_to',
        'deadline',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['probability', '>=', 75]] },
        { color: 'warning', domain: [['probability', '<', 30]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Lead Overview',
          columns: 2,
          fields: ['name', 'company', 'partner', 'stage', 'source', 'assigned_to'],
        },
        {
          title: 'Pipeline & Contact',
          columns: 2,
          fields: [
            'probability',
            'expected_revenue_minor',
            'currency',
            'deadline',
            'email',
            'phone',
            'mobile',
            'parent',
          ],
        },
        {
          title: 'Notes',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['name', 'email', 'source', 'description'],
      filters: [
        { label: 'High Confidence (>=50%)', domain: [['probability', '>=', 50]] },
        { label: 'Inbound Web', domain: [['source', '=', 'Inbound Web']] },
      ],
      groupBy: [
        { label: 'Stage', field: 'stage_id' },
        { label: 'Owner', field: 'assigned_to_id' },
      ],
    },
    kanban: {
      groupBy: 'stage_id',
      cardTitle: 'name',
      cardFields: ['partner_id', 'expected_revenue_minor', 'source', 'deadline'],
      badgeField: 'source',
    },
  }),
  defineView(Opportunity, {
    title: 'CRM Opportunities',
    list: {
      columns: [
        'name',
        'partner',
        'stage',
        'probability',
        'expected_revenue_minor',
        'assigned_to',
        'deadline',
        'won_date',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['probability', '=', 100]] },
        { color: 'info', domain: [['probability', '>=', 50]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Opportunity',
          columns: 2,
          fields: [
            'name',
            'company',
            'partner',
            'stage',
            'probability',
            'expected_revenue_minor',
            'currency',
            'assigned_to',
          ],
        },
        {
          title: 'Outcome Dates',
          columns: 2,
          fields: ['deadline', 'won_date', 'lost_date', 'lost_reason'],
        },
        {
          title: 'Scope',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['name', 'description'],
      filters: [{ label: 'Late Stage (>=60%)', domain: [['probability', '>=', 60]] }],
      groupBy: [
        { label: 'Stage', field: 'stage_id' },
        { label: 'Customer', field: 'partner_id' },
      ],
    },
    kanban: {
      groupBy: 'stage_id',
      cardTitle: 'name',
      cardFields: ['partner_id', 'expected_revenue_minor', 'probability', 'deadline'],
    },
  }),
  defineView(LeadTagLink, {
    title: 'CRM Tag Links',
    list: { columns: ['tag', 'resource_model', 'resource_id'], order: 'id desc' },
    form: {
      sections: [{ title: 'Link', fields: ['tag', 'resource_model', 'resource_id'] }],
    },
    search: { fields: ['resource_model'] },
  }),
];
