import { defineModel, fields } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import type { StaticHookArguments } from 'objection';

/** Append-only publication snapshot revision separating public-approved projections from internal drafts and takedowns. */
export const PublicationSnapshot = defineModel('knowledge.publication_snapshot', {
  table: 'knowledge_publication_snapshots',
  order: 'publication_id asc, revision asc, id asc',
  unique: [
    ['publication_id', 'revision'],
    ['company', 'publication_id', 'idempotency_key'],
  ],
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    publication_id: fields.string({
      required: true,
      pattern: '^mw:publication:[a-z0-9][a-z0-9._-]{0,127}$',
    }),
    revision: fields.integer({ required: true }),
    subject_id: fields.string({ required: true }),
    title: fields.string({ required: true }),
    classification: fields.enum(
      ['PUBLIC_APPROVED', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'CHILD_SENSITIVE'],
      { required: true, default: 'INTERNAL' }
    ),
    rights_state: fields.enum(
      ['permitted', 'internal_use', 'metadata_only', 'unknown', 'restricted', 'withdrawn'],
      { required: true, default: 'unknown' }
    ),
    minor_involved: fields.boolean({ required: true, default: false }),
    review_status: fields.enum(['draft', 'approved', 'rejected', 'superseded', 'taken_down'], {
      required: true,
      default: 'draft',
    }),
    synthetic: fields.boolean({ required: true, default: true }),
    projection_json: fields.text({ required: true, hidden: true }),
    projection_digest: fields.string({ required: true, pattern: '^[a-f0-9]{64}$' }),
    requester: fields.belongsTo(User, { required: true }),
    reviewer: fields.belongsTo(User),
    supersedes_digest: fields.string({ pattern: '^[a-f0-9]{64}$' }),
    takedown_reason_code: fields.string(),
    idempotency_key: fields.string({ hidden: true }),
    recorded_at: fields.string({ required: true }),
  },
});

const rejectImmutableSnapshotMutation = (): never => {
  throw new Error('Knowledge publication snapshots are append-only');
};

PublicationSnapshot.beforeUpdate = (
  _args: StaticHookArguments<InstanceType<typeof PublicationSnapshot>>
): never => rejectImmutableSnapshotMutation();
PublicationSnapshot.beforeDelete = (
  _args: StaticHookArguments<InstanceType<typeof PublicationSnapshot>>
): never => rejectImmutableSnapshotMutation();
PublicationSnapshot.prototype.$beforeUpdate = rejectImmutableSnapshotMutation;
PublicationSnapshot.prototype.$beforeDelete = rejectImmutableSnapshotMutation;
