export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('session', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('identity.account').onDelete('CASCADE');
    table.text('account_subject').notNullable();
    table.text('client_id').notNullable();
    table.text('secret_digest').notNullable().unique();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.index(['account_id', 'expires_at'], 'identity_session_account_expiry_idx');
    table.index(['expires_at'], 'identity_session_expiry_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('session');
}
