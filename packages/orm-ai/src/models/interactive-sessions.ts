import { defineModel, fields } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import { modelRef } from './helpers.js';
import { AgentRun } from './runs.js';

export const INTERACTIVE_SESSION_STATUSES = [
  'created',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type InteractiveSessionStatus = (typeof INTERACTIVE_SESSION_STATUSES)[number];
export const INTERACTIVE_COMMAND_TYPES = [
  'prompt',
  'request_approval',
  'approve',
  'deny',
  'cancel',
] as const;
export type InteractiveCommandType = (typeof INTERACTIVE_COMMAND_TYPES)[number];

export const InteractiveSession = defineModel('ai.interactive_session', {
  table: 'ai_interactive_sessions',
  order: 'create_date desc, id desc',
  unique: [['company', 'idempotency_key']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    owner: fields.belongsTo(
      modelRef(() => User),
      { required: true }
    ),
    agent_run: fields.belongsTo(
      modelRef(() => AgentRun),
      { required: true, unique: true }
    ),
    status: fields.enum(INTERACTIVE_SESSION_STATUSES, { required: true, default: 'created' }),
    idempotency_key: fields.string({ required: true, hidden: true }),
    initial_prompt: fields.text({ required: true }),
    checkpoint_json: fields.text({ required: true, default: '{}', hidden: true }),
    last_sequence: fields.integer({ required: true, default: 0 }),
    version: fields.integer({ required: true, default: 1 }),
    pending_approval_id: fields.integer(),
    terminal_at: fields.string(),
  },
});

export const InteractiveSessionEvent = defineModel('ai.interactive_session_event', {
  table: 'ai_interactive_session_events',
  order: 'sequence asc, id asc',
  unique: [
    ['session', 'sequence'],
    ['session', 'event_uuid'],
  ],
  fields: {
    session: fields.belongsTo(
      modelRef(() => InteractiveSession),
      { required: true }
    ),
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    sequence: fields.integer({ required: true }),
    event_uuid: fields.string({ required: true }),
    type: fields.string({ required: true }),
    actor_id: fields.integer({ required: true }),
    payload_json: fields.text({ required: true, default: '{}' }),
  },
});

export const InteractiveSessionCommand = defineModel('ai.interactive_session_command', {
  table: 'ai_interactive_session_commands',
  order: 'id asc',
  unique: [['session', 'idempotency_key']],
  fields: {
    session: fields.belongsTo(
      modelRef(() => InteractiveSession),
      { required: true }
    ),
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    actor_id: fields.integer({ required: true }),
    idempotency_key: fields.string({ required: true, hidden: true }),
    command_type: fields.enum(INTERACTIVE_COMMAND_TYPES, { required: true }),
    payload_sha256: fields.string({ required: true }),
    payload_json: fields.text({ required: true, hidden: true }),
    result_sequence: fields.integer({ required: true }),
  },
});

export const InteractiveSessionApproval = defineModel('ai.interactive_session_approval', {
  table: 'ai_interactive_session_approvals',
  order: 'id asc',
  fields: {
    session: fields.belongsTo(
      modelRef(() => InteractiveSession),
      { required: true }
    ),
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    requested_by_id: fields.integer({ required: true }),
    decided_by_id: fields.integer(),
    fingerprint_sha256: fields.string({ required: true }),
    capability: fields.string({ required: true }),
    arguments_json: fields.text({ required: true, hidden: true }),
    expires_at: fields.string({ required: true }),
    status: fields.enum(['pending', 'approved', 'denied', 'expired'], {
      required: true,
      default: 'pending',
    }),
    decided_at: fields.string(),
  },
});
