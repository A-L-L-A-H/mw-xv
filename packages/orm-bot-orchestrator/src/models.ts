import { defineModel, fields } from '@moonwitness/orm';

export const BotFlowStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;

export const BotStepKind = {
  START: 'start',
  ACTION: 'action',
  CONDITION: 'condition',
  WAIT: 'wait',
  END: 'end',
} as const;

export const BotRunStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const BotStepRunStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export const BotScheduleKind = {
  INTERVAL: 'interval',
  CRON: 'cron',
  ONCE: 'once',
} as const;

export const BotScheduleStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  EXPIRED: 'expired',
} as const;

export const BotFlow = defineModel('bot.flow', {
  table: 'bot_flows',
  order: 'create_date desc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Flow Code' }),
    name: fields.string({ required: true }),
    description: fields.text({ label: 'Description' }),
    status: fields.enum(['draft', 'active', 'paused', 'archived'], {
      required: true,
      default: BotFlowStatus.DRAFT,
    }),
    version: fields.string({ required: true, default: '1.0.0' }),
    max_concurrency: fields.integer({ label: 'Max Concurrency', default: 1 }),
    timeout_seconds: fields.integer({ label: 'Timeout (seconds)' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to ai-runtime or orm-a2a records',
    }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const BotFlowStep = defineModel('bot.flow_step', {
  table: 'bot_flow_steps',
  order: 'flow_id asc, sequence asc',
  fields: {
    flow: fields.belongsTo(BotFlow, { required: true }),
    sequence: fields.integer({ required: true, label: 'Sequence' }),
    name: fields.string({ required: true }),
    kind: fields.enum(['start', 'action', 'condition', 'wait', 'end'], {
      required: true,
      default: BotStepKind.ACTION,
    }),
    handler: fields.string({ label: 'Handler' }),
    config: fields.json({ label: 'Step Configuration' }),
    next_step: fields.integer({ label: 'Next Step Sequence' }),
    error_step: fields.integer({ label: 'Error Step Sequence' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const BotRun = defineModel('bot.run', {
  table: 'bot_runs',
  order: 'started_at desc',
  fields: {
    flow: fields.belongsTo(BotFlow, { required: true }),
    status: fields.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled'], {
      required: true,
      default: BotRunStatus.PENDING,
    }),
    started_at: fields.datetime({ label: 'Started At' }),
    finished_at: fields.datetime({ label: 'Finished At' }),
    trigger: fields.string({ label: 'Trigger', default: 'manual' }),
    context: fields.json({ label: 'Run Context' }),
    error_message: fields.text({ label: 'Error Message' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const BotStepRun = defineModel('bot.step_run', {
  table: 'bot_step_runs',
  order: 'started_at desc',
  fields: {
    run: fields.belongsTo(BotRun, { required: true }),
    step: fields.belongsTo(BotFlowStep, { required: true }),
    sequence: fields.integer({ required: true, label: 'Sequence' }),
    status: fields.enum(['pending', 'in_progress', 'succeeded', 'failed', 'skipped'], {
      required: true,
      default: BotStepRunStatus.PENDING,
    }),
    started_at: fields.datetime({ label: 'Started At' }),
    finished_at: fields.datetime({ label: 'Finished At' }),
    output: fields.json({ label: 'Step Output' }),
    error_message: fields.text({ label: 'Error Message' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const BotSchedule = defineModel('bot.schedule', {
  table: 'bot_schedules',
  order: 'next_run_at asc',
  fields: {
    flow: fields.belongsTo(BotFlow, { required: true }),
    name: fields.string({ required: true }),
    kind: fields.enum(['interval', 'cron', 'once'], {
      required: true,
      default: BotScheduleKind.INTERVAL,
    }),
    cron_expression: fields.string({ label: 'Cron Expression' }),
    interval_seconds: fields.integer({ label: 'Interval (seconds)' }),
    next_run_at: fields.datetime({ label: 'Next Run At' }),
    last_run_at: fields.datetime({ label: 'Last Run At' }),
    status: fields.enum(['active', 'paused', 'expired'], {
      required: true,
      default: BotScheduleStatus.ACTIVE,
    }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const BotRunQueue = defineModel('bot.run_queue', {
  table: 'bot_run_queue',
  order: 'queued_at asc',
  fields: {
    flow: fields.belongsTo(BotFlow, { required: true }),
    run: fields.belongsTo(BotRun),
    priority: fields.integer({ required: true, default: 100 }),
    payload: fields.json({ label: 'Queue Payload' }),
    queued_at: fields.datetime({ required: true }),
    claimed_at: fields.datetime({ label: 'Claimed At' }),
    claimed_by: fields.string({ label: 'Claimed By' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});
