import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export const TRIGGER_KINDS = [
  'signal.scored',
  'signal.alert',
  'orm.event',
  'cron',
  'income.entry',
  'social.mention',
  'bot.session',
  'manual',
  'webhook',
] as const;
export type AutomationTriggerKind = (typeof TRIGGER_KINDS)[number];

export const AUTOMATION_ACTION_KINDS = [
  'notify',
  'enqueue_job',
  'create_task',
  'record_income',
  'publish_content',
  'post_social',
  'run_bot',
  'sync_ecommerce',
  'run_public_tool',
  'run_agent',
] as const;
export type AutomationActionKind = (typeof AUTOMATION_ACTION_KINDS)[number];

export const AUTOMATION_RUN_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'skipped',
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const AutomationTrigger = defineModel('automation.trigger', {
  table: 'automation_triggers',
  order: 'id desc',
  fields: {
    kind: fields.enum(TRIGGER_KINDS, { required: true, label: 'Trigger Kind' }),
    ref: fields.string({ required: true, label: 'Trigger Reference' }),
    config: fields.json({ label: 'Trigger Config' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const AutomationRule = defineModel('automation.rule', {
  table: 'automation_rules',
  order: 'sequence asc, id asc',
  fields: {
    name: fields.string({ required: true, label: 'Rule Name' }),
    code: fields.string({
      required: true,
      unique: true,
      pattern: '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*$',
      label: 'Rule Code',
    }),
    trigger: fields.belongsTo(AutomationTrigger, { label: 'Trigger' }),
    condition: fields.json({ label: 'Condition (DSL)' }),
    action_kind: fields.enum(AUTOMATION_ACTION_KINDS, {
      required: true,
      label: 'Action Kind',
    }),
    action_config: fields.json({ label: 'Action Config' }),
    sequence: fields.integer({ required: true, default: 10, label: 'Sequence' }),
    cooldown_minutes: fields.integer({ required: true, default: 0, label: 'Cooldown (minutes)' }),
    dedupe_key_template: fields.string({ label: 'Dedupe Key Template' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const AutomationRun = defineModel('automation.run', {
  table: 'automation_runs',
  order: 'id desc',
  fields: {
    rule: fields.belongsTo(AutomationRule, { required: true, label: 'Rule' }),
    trigger_ref: fields.string({ required: true, label: 'Trigger Reference' }),
    input: fields.json({ label: 'Input Payload' }),
    output: fields.json({ label: 'Output' }),
    status: fields.enum(AUTOMATION_RUN_STATUSES, {
      required: true,
      default: 'pending',
      label: 'Status',
    }),
    error: fields.text({ label: 'Error' }),
    started_at: fields.datetime({ label: 'Started At' }),
    finished_at: fields.datetime({ label: 'Finished At' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});
