import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';
import { Partner } from '@moonwitness/orm-base';
import { User } from '@moonwitness/orm-base';
import { BASIS_POINTS_TOTAL } from '@moonwitness/types';

export type TicketStatus = 'new' | 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketChannel = 'whatsapp' | 'email' | 'web' | 'phone' | 'isp_incident' | 'api';
export type TicketQueue = 'technical' | 'billing' | 'general' | 'enterprise';

export const SlaPolicy = defineModel('helpdesk.sla_policy', {
  table: 'helpdesk_sla_policies',
  order: 'priority asc',
  fields: {
    name: fields.string({ required: true, unique: true, label: 'Policy Name' }),
    priority: fields.string({
      required: true,
      unique: true,
      values: ['P1', 'P2', 'P3', 'P4'],
      label: 'Priority',
    }),
    first_response_minutes: fields.integer({ required: true, label: 'First Response (minutes)' }),
    resolution_minutes: fields.integer({ required: true, label: 'Resolution (minutes)' }),
    business_hours_only: fields.boolean({
      required: true,
      default: false,
      label: 'Business Hours Only',
    }),
    applies_to_queue: fields.string({
      required: true,
      default: 'all',
      values: ['technical', 'billing', 'general', 'enterprise', 'all'],
      label: 'Applies To Queue',
    }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const SupportTicket = defineModel('helpdesk.support_ticket', {
  table: 'helpdesk_support_tickets',
  order: 'create_date desc',
  fields: {
    ticket_no: fields.string({ required: true, unique: true, label: 'Ticket No' }),
    subject: fields.string({ required: true, label: 'Subject' }),
    status: fields.string({
      required: true,
      default: 'new',
      values: ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'],
      label: 'Status',
    }),
    priority: fields.string({
      required: true,
      default: 'P4',
      values: ['P1', 'P2', 'P3', 'P4'],
      label: 'Priority',
    }),
    channel: fields.string({
      required: true,
      default: 'web',
      values: ['whatsapp', 'email', 'web', 'phone', 'isp_incident', 'api'],
      label: 'Channel',
    }),
    queue: fields.string({
      required: true,
      default: 'general',
      values: ['technical', 'billing', 'general', 'enterprise'],
      label: 'Queue',
    }),
    customer: fields.belongsTo(Partner, { required: true, label: 'Customer' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    assigned_agent: fields.belongsTo(User, { label: 'Assigned Agent' }),
    sla_policy: fields.belongsTo(SlaPolicy, { label: 'SLA Policy' }),
    first_response_due_at: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'First Response Due At',
    }),
    resolution_due_at: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'Resolution Due At',
    }),
    first_responded_at: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'First Responded At',
    }),
    resolved_at: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'Resolved At',
    }),
    sla_breached: fields.boolean({ required: true, default: false, label: 'SLA Breached' }),
    escalation_level: fields.integer({ required: true, default: 0, label: 'Escalation Level' }),
    source_ref: fields.string({ label: 'Source Reference (whatsapp msg id / isp incident id)' }),
    tags: fields.string({ label: 'Tags' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const TicketMessage = defineModel('helpdesk.ticket_message', {
  table: 'helpdesk_ticket_messages',
  order: 'created_at asc',
  fields: {
    ticket: fields.belongsTo(SupportTicket, { required: true, label: 'Ticket' }),
    direction: fields.string({
      required: true,
      values: ['inbound', 'outbound', 'internal_note'],
      label: 'Direction',
    }),
    author: fields.belongsTo(User, { label: 'Author' }),
    body: fields.text({ required: true, label: 'Body' }),
    created_via: fields.string({
      required: true,
      default: 'agent',
      values: ['agent', 'auto_reply', 'customer'],
      label: 'Created Via',
    }),
    created_at: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'Created At',
    }),
  },
});

export const EscalationRule = defineModel('helpdesk.escalation_rule', {
  table: 'helpdesk_escalation_rules',
  order: 'id asc',
  fields: {
    name: fields.string({ required: true, label: 'Rule Name' }),
    sla_policy: fields.belongsTo(SlaPolicy, { required: true, label: 'SLA Policy' }),
    trigger: fields.string({
      required: true,
      values: ['first_response_breach', 'resolution_breach', 'priority_change', 'reopen'],
      label: 'Trigger',
    }),
    escalate_after_minutes: fields.integer({ required: true, label: 'Escalate After (minutes)' }),
    escalate_to: fields.string({
      required: true,
      values: ['team_lead', 'on_call', 'manager', 'vendor'],
      label: 'Escalate To',
    }),
    oncall_rotation: fields.string({ label: 'On-Call Rotation' }),
    max_escalations: fields.integer({ required: true, default: 2, label: 'Max Escalations' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const KnowledgeDeflection = defineModel('helpdesk.knowledge_deflection', {
  table: 'helpdesk_knowledge_deflections',
  order: 'create_date desc',
  fields: {
    ticket: fields.belongsTo(SupportTicket, { label: 'Ticket' }),
    knowledge_article_ref: fields.string({ required: true, label: 'Knowledge Article Ref' }),
    suggestion_text: fields.text({ required: true, label: 'Suggestion Text' }),
    accepted: fields.boolean({ required: true, default: false, label: 'Accepted' }),
    deflected: fields.boolean({
      required: true,
      default: false,
      label: 'Deflected (resolved without agent)',
    }),
    confidence: fields.integer({
      required: true,
      default: 0,
      label: `Confidence (bps 0-${BASIS_POINTS_TOTAL})`,
      pattern: `^(?:${BASIS_POINTS_TOTAL}|\\d{1,4})$`,
    }),
  },
});

export const CsatSurvey = defineModel('helpdesk.csat_survey', {
  table: 'helpdesk_csat_surveys',
  order: 'surveyed_at desc',
  fields: {
    ticket: fields.belongsTo(SupportTicket, { required: true, unique: true, label: 'Ticket' }),
    rating: fields.integer({ required: true, label: 'Rating (1-5)', pattern: '^[1-5]$' }),
    comment: fields.text({ label: 'Comment' }),
    surveyed_at: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
      label: 'Surveyed At',
    }),
    responded: fields.boolean({ required: true, default: false, label: 'Responded' }),
    nps_category: fields.string({
      values: ['promoter', 'passive', 'detractor'],
      label: 'NPS Category',
    }),
  },
});
