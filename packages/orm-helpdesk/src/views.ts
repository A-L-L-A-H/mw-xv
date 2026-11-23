import { defineView } from '@moonwitness/orm';
import { SlaPolicy, SupportTicket, TicketMessage, EscalationRule, KnowledgeDeflection, CsatSurvey } from './models/index.js';

export const views = [
  defineView(SlaPolicy, {
    title: 'SLA Policies',
    list: {
      columns: ['name', 'priority', 'first_response_minutes', 'resolution_minutes', 'business_hours_only', 'applies_to_queue', 'active'],
      order: 'priority asc, id asc',
      decorations: [
        { color: 'success', domain: [['active', '=', true]] },
        { color: 'danger', domain: [['active', '=', false]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Policy Details',
          columns: 2,
          fields: ['name', 'priority', 'applies_to_queue', 'active'],
        },
        {
          title: 'SLA Targets',
          columns: 2,
          fields: ['first_response_minutes', 'resolution_minutes', 'business_hours_only'],
        },
      ],
    },
    search: {
      fields: ['name'],
      filters: [
        { label: 'Active', domain: [['active', '=', true]] },
        { label: 'Inactive', domain: [['active', '=', false]] },
        { label: 'P1', domain: [['priority', '=', 'P1']] },
        { label: 'P2', domain: [['priority', '=', 'P2']] },
        { label: 'P3', domain: [['priority', '=', 'P3']] },
        { label: 'P4', domain: [['priority', '=', 'P4']] },
      ],
      groupBy: [
        { label: 'Priority', field: 'priority' },
        { label: 'Queue', field: 'applies_to_queue' },
        { label: 'Active', field: 'active' },
      ],
    },
  }),

  defineView(SupportTicket, {
    title: 'Support Tickets',
    list: {
      columns: ['ticket_no', 'subject', 'status', 'priority', 'channel', 'queue', 'customer', 'assigned_agent', 'first_response_due_at', 'resolution_due_at', 'sla_breached', 'escalation_level'],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'danger', domain: [['sla_breached', '=', true]] },
        { color: 'warning', domain: [['status', '=', 'pending']] },
        { color: 'info', domain: [['status', '=', 'on_hold']] },
        { color: 'success', domain: [['status', '=', 'resolved']] },
        { color: 'muted', domain: [['status', '=', 'closed']] },
        { color: 'danger', domain: [['priority', '=', 'P1']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Ticket Details',
          columns: 2,
          fields: ['ticket_no', 'company', 'customer', 'subject', 'status', 'priority', 'channel', 'queue', 'assigned_agent'],
        },
        {
          title: 'SLA Tracking',
          columns: 2,
          fields: ['sla_policy', 'first_response_due_at', 'first_responded_at', 'resolution_due_at', 'resolved_at', 'sla_breached', 'escalation_level'],
        },
        {
          title: 'Source & Tags',
          columns: 2,
          fields: ['source_ref', 'tags', 'notes'],
        },
      ],
    },
    search: {
      fields: ['ticket_no', 'subject', 'tags', 'notes', 'source_ref'],
      filters: [
        { label: 'New', domain: [['status', '=', 'new']] },
        { label: 'Open', domain: [['status', '=', 'open']] },
        { label: 'Pending', domain: [['status', '=', 'pending']] },
        { label: 'On Hold', domain: [['status', '=', 'on_hold']] },
        { label: 'Resolved', domain: [['status', '=', 'resolved']] },
        { label: 'Closed', domain: [['status', '=', 'closed']] },
        { label: 'P1', domain: [['priority', '=', 'P1']] },
        { label: 'P2', domain: [['priority', '=', 'P2']] },
        { label: 'P3', domain: [['priority', '=', 'P3']] },
        { label: 'P4', domain: [['priority', '=', 'P4']] },
        { label: 'SLA Breached', domain: [['sla_breached', '=', true]] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Priority', field: 'priority' },
        { label: 'Queue', field: 'queue' },
        { label: 'Channel', field: 'channel' },
        { label: 'Customer', field: 'customer_id' },
        { label: 'Assigned Agent', field: 'assigned_agent_id' },
      ],
    },
  }),

  defineView(TicketMessage, {
    title: 'Ticket Messages',
    list: {
      columns: ['ticket', 'direction', 'author', 'created_via', 'created_at'],
      order: 'created_at asc, id asc',
      decorations: [
        { color: 'info', domain: [['direction', '=', 'inbound']] },
        { color: 'success', domain: [['direction', '=', 'outbound']] },
        { color: 'warning', domain: [['direction', '=', 'internal_note']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Message',
          columns: 2,
          fields: ['ticket', 'direction', 'author', 'created_via'],
        },
        {
          title: 'Content',
          fields: ['body'],
        },
      ],
    },
    search: {
      fields: ['body'],
      filters: [
        { label: 'Inbound', domain: [['direction', '=', 'inbound']] },
        { label: 'Outbound', domain: [['direction', '=', 'outbound']] },
        { label: 'Internal Note', domain: [['direction', '=', 'internal_note']] },
        { label: 'From Agent', domain: [['created_via', '=', 'agent']] },
        { label: 'Auto Reply', domain: [['created_via', '=', 'auto_reply']] },
        { label: 'From Customer', domain: [['created_via', '=', 'customer']] },
      ],
      groupBy: [
        { label: 'Direction', field: 'direction' },
        { label: 'Created Via', field: 'created_via' },
        { label: 'Ticket', field: 'ticket_id' },
      ],
    },
  }),

  defineView(EscalationRule, {
    title: 'Escalation Rules',
    list: {
      columns: ['name', 'sla_policy', 'trigger', 'escalate_after_minutes', 'escalate_to', 'oncall_rotation', 'max_escalations', 'active'],
      order: 'id asc',
      decorations: [
        { color: 'success', domain: [['active', '=', true]] },
        { color: 'danger', domain: [['active', '=', false]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Rule Details',
          columns: 2,
          fields: ['name', 'sla_policy', 'trigger', 'active'],
        },
        {
          title: 'Escalation',
          columns: 2,
          fields: ['escalate_after_minutes', 'escalate_to', 'oncall_rotation', 'max_escalations'],
        },
      ],
    },
    search: {
      fields: ['name'],
      filters: [
        { label: 'Active', domain: [['active', '=', true]] },
        { label: 'Inactive', domain: [['active', '=', false]] },
        { label: 'First Response Breach', domain: [['trigger', '=', 'first_response_breach']] },
        { label: 'Resolution Breach', domain: [['trigger', '=', 'resolution_breach']] },
        { label: 'Priority Change', domain: [['trigger', '=', 'priority_change']] },
        { label: 'Reopen', domain: [['trigger', '=', 'reopen']] },
        { label: 'Escalate to Team Lead', domain: [['escalate_to', '=', 'team_lead']] },
        { label: 'Escalate to On-Call', domain: [['escalate_to', '=', 'on_call']] },
        { label: 'Escalate to Manager', domain: [['escalate_to', '=', 'manager']] },
        { label: 'Escalate to Vendor', domain: [['escalate_to', '=', 'vendor']] },
      ],
      groupBy: [
        { label: 'Trigger', field: 'trigger' },
        { label: 'Escalate To', field: 'escalate_to' },
        { label: 'SLA Policy', field: 'sla_policy_id' },
        { label: 'Active', field: 'active' },
      ],
    },
  }),

  defineView(KnowledgeDeflection, {
    title: 'Knowledge Deflections',
    list: {
      columns: ['ticket', 'knowledge_article_ref', 'confidence', 'accepted', 'deflected'],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['deflected', '=', true]] },
        { color: 'info', domain: [['accepted', '=', true]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Deflection',
          columns: 2,
          fields: ['ticket', 'knowledge_article_ref', 'confidence', 'accepted', 'deflected'],
        },
        {
          title: 'Suggestion',
          fields: ['suggestion_text'],
        },
      ],
    },
    search: {
      fields: ['knowledge_article_ref', 'suggestion_text'],
      filters: [
        { label: 'Accepted', domain: [['accepted', '=', true]] },
        { label: 'Deflected', domain: [['deflected', '=', true]] },
      ],
      groupBy: [
        { label: 'Article', field: 'knowledge_article_ref' },
        { label: 'Accepted', field: 'accepted' },
        { label: 'Deflected', field: 'deflected' },
        { label: 'Ticket', field: 'ticket_id' },
      ],
    },
  }),

  defineView(CsatSurvey, {
    title: 'CSAT Surveys',
    list: {
      columns: ['ticket', 'rating', 'nps_category', 'surveyed_at', 'responded'],
      order: 'surveyed_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['nps_category', '=', 'promoter']] },
        { color: 'info', domain: [['nps_category', '=', 'passive']] },
        { color: 'danger', domain: [['nps_category', '=', 'detractor']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Survey',
          columns: 2,
          fields: ['ticket', 'rating', 'nps_category', 'surveyed_at', 'responded'],
        },
        {
          title: 'Comment',
          fields: ['comment'],
        },
      ],
    },
    search: {
      fields: ['comment'],
      filters: [
        { label: 'Promoters (5)', domain: [['rating', '=', 5]] },
        { label: 'Passives (4)', domain: [['rating', '=', 4]] },
        { label: 'Detractors (1-3)', domain: [['rating', '<=', 3]] },
        { label: 'Responded', domain: [['responded', '=', true]] },
        { label: 'Pending', domain: [['responded', '=', false]] },
      ],
      groupBy: [
        { label: 'Rating', field: 'rating' },
        { label: 'NPS Category', field: 'nps_category' },
        { label: 'Responded', field: 'responded' },
        { label: 'Ticket', field: 'ticket_id' },
      ],
    },
  }),
];