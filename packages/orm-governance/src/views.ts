import { defineView } from '@moonwitness/orm';
import {
  Institution,
  Official,
  Mandate,
  Policy,
  PolicyVersion,
  Regulation,
  PublicProgram,
  BudgetAllocation,
} from './models.js';

export const views = [
  defineView(Institution, {
    title: 'Institutions',
    list: {
      columns: ['name', 'code', 'type', 'jurisdiction', 'seat_city', 'is_active'],
      order: 'name asc',
      decorations: [
        { color: 'success', domain: [['is_active', '=', true]] },
        { color: 'muted', domain: [['is_active', '=', false]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Identity',
          columns: 2,
          fields: ['name', 'code', 'type', 'jurisdiction', 'seat_city', 'founded_on'],
        },
        {
          title: 'Structure',
          columns: 2,
          fields: ['parent', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'code'],
      filters: [
        { label: 'Active', domain: [['is_active', '=', true]] },
        { label: 'Inactive', domain: [['is_active', '=', false]] },
        { label: 'Ministry', domain: [['type', '=', 'ministry']] },
        { label: 'Agency', domain: [['type', '=', 'agency']] },
      ],
      groupBy: [
        { label: 'Type', field: 'type' },
        { label: 'Jurisdiction', field: 'jurisdiction' },
      ],
    },
  }),

  defineView(Official, {
    title: 'Officials',
    list: {
      columns: ['name', 'title', 'institution', 'status', 'appointed_on', 'term_end', 'is_active'],
      order: 'name asc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'suspended']] },
        { color: 'muted', domain: [['status', '=', 'retired']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Official Details',
          columns: 2,
          fields: ['name', 'title', 'institution', 'status', 'appointed_on', 'term_end'],
        },
        {
          title: 'Contact & Linking',
          columns: 2,
          fields: ['contact_email', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'title', 'contact_email'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Suspended', domain: [['status', '=', 'suspended']] },
        { label: 'Dismissed', domain: [['status', '=', 'dismissed']] },
        { label: 'Retired', domain: [['status', '=', 'retired']] },
      ],
      groupBy: [
        { label: 'Institution', field: 'institution' },
        { label: 'Status', field: 'status' },
      ],
    },
  }),

  defineView(Mandate, {
    title: 'Mandates',
    list: {
      columns: ['name', 'official', 'institution', 'status', 'starts_on', 'ends_on', 'is_active'],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'muted', domain: [['status', '=', 'expired']] },
        { color: 'danger', domain: [['status', '=', 'revoked']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Mandate',
          columns: 2,
          fields: ['name', 'official', 'institution', 'status', 'starts_on', 'ends_on'],
        },
        {
          title: 'Scope',
          columns: 1,
          fields: ['scope', 'responsibilities', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'scope'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Pending', domain: [['status', '=', 'pending']] },
        { label: 'Expired', domain: [['status', '=', 'expired']] },
        { label: 'Revoked', domain: [['status', '=', 'revoked']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Institution', field: 'institution' },
      ],
    },
  }),

  defineView(Policy, {
    title: 'Policies',
    list: {
      columns: ['name', 'code', 'institution', 'status', 'current_version', 'is_active'],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'in_force']] },
        { color: 'info', domain: [['status', '=', 'in_review']] },
        { color: 'muted', domain: [['status', '=', 'draft']] },
        { color: 'danger', domain: [['status', '=', 'repealed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Policy',
          columns: 2,
          fields: ['name', 'code', 'institution', 'status', 'current_version'],
        },
        {
          title: 'Content',
          columns: 1,
          fields: ['summary', 'stakeholder_ids', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'code', 'summary'],
      filters: [
        { label: 'Draft', domain: [['status', '=', 'draft']] },
        { label: 'In Review', domain: [['status', '=', 'in_review']] },
        { label: 'In Force', domain: [['status', '=', 'in_force']] },
        { label: 'Superseded', domain: [['status', '=', 'superseded']] },
        { label: 'Repealed', domain: [['status', '=', 'repealed']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Institution', field: 'institution' },
      ],
    },
  }),

  defineView(PolicyVersion, {
    title: 'Policy Versions',
    list: {
      columns: [
        'policy',
        'version',
        'status',
        'authored_by',
        'effective_from',
        'effective_to',
        'is_active',
      ],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'in_force']] },
        { color: 'muted', domain: [['status', '=', 'superseded']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Version',
          columns: 2,
          fields: ['policy', 'version', 'status', 'authored_by', 'effective_from', 'effective_to'],
        },
        {
          title: 'Body',
          columns: 1,
          fields: ['change_summary', 'body_markdown', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['version', 'change_summary', 'body_markdown'],
      filters: [
        { label: 'Draft', domain: [['status', '=', 'draft']] },
        { label: 'In Force', domain: [['status', '=', 'in_force']] },
        { label: 'Superseded', domain: [['status', '=', 'superseded']] },
      ],
      groupBy: [
        { label: 'Policy', field: 'policy' },
        { label: 'Status', field: 'status' },
      ],
    },
  }),

  defineView(Regulation, {
    title: 'Regulations',
    list: {
      columns: [
        'name',
        'number',
        'institution',
        'status',
        'issued_on',
        'enforced_from',
        'is_active',
      ],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'in_force']] },
        { color: 'warning', domain: [['status', '=', 'ratified']] },
        { color: 'danger', domain: [['status', '=', 'annulled']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Regulation',
          columns: 2,
          fields: ['name', 'number', 'institution', 'status', 'policy', 'citation'],
        },
        {
          title: 'Dates',
          columns: 2,
          fields: ['issued_on', 'enforced_from', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'number', 'citation'],
      filters: [
        { label: 'Proposed', domain: [['status', '=', 'proposed']] },
        { label: 'Ratified', domain: [['status', '=', 'ratified']] },
        { label: 'In Force', domain: [['status', '=', 'in_force']] },
        { label: 'Annulled', domain: [['status', '=', 'annulled']] },
        { label: 'Archived', domain: [['status', '=', 'archived']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Institution', field: 'institution' },
      ],
    },
  }),

  defineView(PublicProgram, {
    title: 'Public Programs',
    list: {
      columns: [
        'name',
        'code',
        'institution',
        'status',
        'starts_on',
        'ends_on',
        'target_beneficiaries',
      ],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'running']] },
        { color: 'info', domain: [['status', '=', 'planned']] },
        { color: 'danger', domain: [['status', '=', 'halted']] },
        { color: 'muted', domain: [['status', '=', 'completed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Program',
          columns: 2,
          fields: ['name', 'code', 'institution', 'status', 'policy', 'program_lead'],
        },
        {
          title: 'Execution',
          columns: 2,
          fields: [
            'starts_on',
            'ends_on',
            'target_beneficiaries',
            'outcome_notes',
            'is_active',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['name', 'code', 'outcome_notes'],
      filters: [
        { label: 'Planned', domain: [['status', '=', 'planned']] },
        { label: 'Running', domain: [['status', '=', 'running']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
        { label: 'Halted', domain: [['status', '=', 'halted']] },
        { label: 'Cancelled', domain: [['status', '=', 'cancelled']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Institution', field: 'institution' },
      ],
    },
  }),

  defineView(BudgetAllocation, {
    title: 'Budget Allocations',
    list: {
      columns: [
        'name',
        'program',
        'institution',
        'fiscal_year',
        'amount_minor',
        'currency',
        'status',
      ],
      order: 'id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'released']] },
        { color: 'info', domain: [['status', '=', 'approved']] },
        { color: 'warning', domain: [['status', '=', 'proposed']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Allocation',
          columns: 2,
          fields: [
            'name',
            'program',
            'institution',
            'fiscal_year',
            'amount_minor',
            'currency',
            'status',
          ],
        },
        {
          title: 'Approval & Detail',
          columns: 2,
          fields: ['approved_by', 'line_items', 'is_active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['name', 'currency'],
      filters: [
        { label: 'Proposed', domain: [['status', '=', 'proposed']] },
        { label: 'Approved', domain: [['status', '=', 'approved']] },
        { label: 'Released', domain: [['status', '=', 'released']] },
        { label: 'Spent', domain: [['status', '=', 'spent']] },
        { label: 'Returned', domain: [['status', '=', 'returned']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Fiscal Year', field: 'fiscal_year' },
        { label: 'Program', field: 'program' },
      ],
    },
  }),
];
