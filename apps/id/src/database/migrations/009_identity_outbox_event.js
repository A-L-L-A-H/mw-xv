export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('outbox_event', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('event_id').notNullable().unique();
    table.text('event_type').notNullable();
    table.integer('schema_version').notNullable();
    table.jsonb('payload').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('delivered_at', { useTz: true }).nullable();
    table.index(['delivered_at', 'next_attempt_at'], 'identity_outbox_pending_idx');
    table.index(['event_type', 'created_at'], 'identity_outbox_type_created_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('outbox_event');
}
