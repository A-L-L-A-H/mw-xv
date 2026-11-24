import { defineView } from '@moonwitness/orm';
import { BotFlow, BotFlowStep, BotRun, BotRunQueue, BotSchedule, BotStepRun } from './models.js';

export const views = [
  defineView(BotFlow, {
    title: 'Bot Flows',
    list: {
      columns: ['code', 'name', 'status', 'version', 'max_concurrency', 'external_ref'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Flow',
          columns: 2,
          fields: ['code', 'name', 'status', 'version', 'external_ref'],
        },
        {
          title: 'Execution',
          columns: 2,
          fields: ['max_concurrency', 'timeout_seconds'],
        },
        {
          title: 'Description',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['code', 'name', 'description'],
      filters: [{ label: 'Active', domain: [['status', '=', 'active']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(BotFlowStep, {
    title: 'Flow Steps',
    list: {
      columns: ['flow', 'sequence', 'name', 'kind', 'handler', 'next_step', 'error_step'],
      order: 'flow_id asc, sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Step',
          columns: 2,
          fields: ['flow', 'sequence', 'name', 'kind', 'handler', 'external_ref'],
        },
        {
          title: 'Transitions',
          columns: 2,
          fields: ['next_step', 'error_step'],
        },
        {
          title: 'Configuration',
          fields: ['config'],
        },
      ],
    },
    search: {
      fields: ['name', 'handler'],
      groupBy: [
        { label: 'Flow', field: 'flow_id' },
        { label: 'Kind', field: 'kind' },
      ],
    },
  }),
  defineView(BotRun, {
    title: 'Bot Runs',
    list: {
      columns: ['flow', 'status', 'trigger', 'started_at', 'finished_at', 'external_ref'],
      order: 'started_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Run',
          columns: 2,
          fields: ['flow', 'status', 'trigger', 'external_ref'],
        },
        {
          title: 'Timing',
          columns: 2,
          fields: ['started_at', 'finished_at'],
        },
        {
          title: 'Details',
          fields: ['context', 'error_message'],
        },
      ],
    },
    search: {
      fields: ['trigger'],
      filters: [
        { label: 'Running', domain: [['status', '=', 'running']] },
        { label: 'Failed', domain: [['status', '=', 'failed']] },
      ],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
    kanban: {
      groupBy: 'status',
      cardTitle: 'flow',
      cardFields: ['trigger', 'started_at', 'finished_at'],
    },
  }),
  defineView(BotStepRun, {
    title: 'Step Runs',
    list: {
      columns: ['run', 'step', 'sequence', 'status', 'started_at', 'finished_at'],
      order: 'started_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Step Run',
          columns: 2,
          fields: ['run', 'step', 'sequence', 'status', 'external_ref'],
        },
        {
          title: 'Timing',
          columns: 2,
          fields: ['started_at', 'finished_at'],
        },
        {
          title: 'Result',
          fields: ['output', 'error_message'],
        },
      ],
    },
    search: {
      fields: ['error_message'],
      filters: [{ label: 'Failed', domain: [['status', '=', 'failed']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(BotSchedule, {
    title: 'Bot Schedules',
    list: {
      columns: ['name', 'flow', 'kind', 'cron_expression', 'interval_seconds', 'next_run_at', 'last_run_at', 'status'],
      order: 'next_run_at asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Schedule',
          columns: 2,
          fields: ['name', 'flow', 'kind', 'status', 'external_ref'],
        },
        {
          title: 'Timing',
          columns: 2,
          fields: ['cron_expression', 'interval_seconds', 'next_run_at', 'last_run_at'],
        },
      ],
    },
    search: {
      fields: ['name', 'cron_expression'],
      filters: [{ label: 'Active', domain: [['status', '=', 'active']] }],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Flow', field: 'flow_id' },
      ],
    },
  }),
  defineView(BotRunQueue, {
    title: 'Run Queue',
    list: {
      columns: ['flow', 'run', 'priority', 'queued_at', 'claimed_at', 'claimed_by', 'external_ref'],
      order: 'queued_at asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Queue Entry',
          columns: 2,
          fields: ['flow', 'run', 'priority', 'external_ref'],
        },
        {
          title: 'Claim',
          columns: 2,
          fields: ['queued_at', 'claimed_at', 'claimed_by'],
        },
        {
          title: 'Payload',
          fields: ['payload'],
        },
      ],
    },
    search: {
      fields: ['claimed_by'],
      filters: [{ label: 'Unclaimed', domain: [['claimed_at', '=', null]] }],
      groupBy: [{ label: 'Flow', field: 'flow_id' }],
    },
  }),
];
