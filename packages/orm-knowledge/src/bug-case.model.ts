import { defineModel, fields } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import type { StaticHookArguments } from 'objection';

/** Scoped BUG case record separating workflow state, human approval, publication, and verified resolution. */
export const BugCaseRecord = defineModel('knowledge.bug_case', {
  table: 'knowledge_bug_cases',
  order: 'company_id asc, id asc',
  unique: [['company', 'case_id']],
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    program_id: fields.string({
      required: true,
      pattern: '^mw:bug-program:slot-(0[1-9]|[12][0-9]|3[0-3])$',
    }),
    case_id: fields.string({
      required: true,
      pattern: '^mw:bug-case:[a-z0-9][a-z0-9._-]{0,127}$',
    }),
    workflow_instance_id: fields.integer(),
    title: fields.string({ required: true }),
    classification: fields.enum(['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'CHILD_SENSITIVE'], {
      required: true,
      default: 'INTERNAL',
    }),
    synthetic: fields.boolean({ required: true, default: false }),
    case_state: fields.enum(
      ['intake', 'triaged', 'planned', 'action_recorded', 'verified_resolved', 'reopened'],
      { required: true, default: 'intake' }
    ),
    human_approval_status: fields.enum(['unreviewed', 'human_approved', 'human_rejected'], {
      required: true,
      default: 'unreviewed',
    }),
    publication_status: fields.enum(['unpublished', 'editorial_candidate', 'public_approved'], {
      required: true,
      default: 'unpublished',
    }),
    resolved_status: fields.enum(['unresolved', 'verified_resolved', 'reopened'], {
      required: true,
      default: 'unresolved',
    }),
    created_by: fields.belongsTo(User, { required: true }),
    revision: fields.integer({ required: true, default: 1 }),
  },
});

/** Append-only BUG case action, verification, and reopen event bound to workflow sequence and idempotency key. */
export const BugCaseActionOutcomeEvent = defineModel('knowledge.bug_case_event', {
  table: 'knowledge_bug_case_events',
  order: 'bug_case_id asc, workflow_event_sequence asc, id asc',
  unique: [
    ['company', 'bug_case', 'idempotency_key'],
    ['bug_case', 'workflow_event_sequence'],
  ],
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    bug_case: fields.belongsTo(BugCaseRecord, { required: true }),
    workflow_instance_id: fields.integer({ required: true }),
    workflow_event_sequence: fields.integer({ required: true }),
    event_kind: fields.enum(['intake', 'triage', 'plan', 'action', 'verification', 'reopen'], {
      required: true,
    }),
    from_state: fields.string({ required: true }),
    to_state: fields.string({ required: true }),
    actor: fields.belongsTo(User, { required: true }),
    idempotency_key: fields.string({ required: true, hidden: true }),
    payload_json: fields.text({ required: true, hidden: true }),
    event_digest: fields.string({ required: true, unique: true, pattern: '^[a-f0-9]{64}$' }),
    recorded_at: fields.string({ required: true }),
  },
});

const rejectImmutableEventMutation = (): never => {
  throw new Error('Knowledge BUG case events are append-only');
};

BugCaseActionOutcomeEvent.beforeUpdate = (
  _args: StaticHookArguments<InstanceType<typeof BugCaseActionOutcomeEvent>>
): never => rejectImmutableEventMutation();
BugCaseActionOutcomeEvent.beforeDelete = (
  _args: StaticHookArguments<InstanceType<typeof BugCaseActionOutcomeEvent>>
): never => rejectImmutableEventMutation();
BugCaseActionOutcomeEvent.prototype.$beforeUpdate = rejectImmutableEventMutation;
BugCaseActionOutcomeEvent.prototype.$beforeDelete = rejectImmutableEventMutation;
