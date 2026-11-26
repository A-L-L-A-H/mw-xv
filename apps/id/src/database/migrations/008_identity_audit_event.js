export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('audit_event', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('actor_type').notNullable();
    table.text('actor_id').notNullable();
    table.text('action').notNullable();
    table.text('subject_type').notNullable();
    table.text('subject_id').notNullable();
    table.text('correlation_id').nullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.index(['subject_type', 'subject_id', 'occurred_at'], 'identity_audit_subject_time_idx');
    table.index(['correlation_id'], 'identity_audit_correlation_idx');
    table.index(['occurred_at'], 'identity_audit_occurred_at_idx');
  });

  await knex.raw(
    `CREATE OR REPLACE FUNCTION identity.prevent_audit_event_mutation()
     RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'identity.audit_event is append-only';
     END;
     $$ LANGUAGE plpgsql`
  );
  await knex.raw('DROP TRIGGER IF EXISTS identity_audit_event_append_only ON identity.audit_event');
  await knex.raw(
    `CREATE TRIGGER identity_audit_event_append_only
     BEFORE UPDATE OR DELETE ON identity.audit_event
     FOR EACH ROW EXECUTE FUNCTION identity.prevent_audit_event_mutation()`
  );
}

export async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS identity_audit_event_append_only ON identity.audit_event');
  await knex.raw('DROP FUNCTION IF EXISTS identity.prevent_audit_event_mutation()');
  await knex.schema.withSchema('identity').dropTableIfExists('audit_event');
}
