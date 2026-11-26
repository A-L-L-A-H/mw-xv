export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('refresh_token_family', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('identity.account').onDelete('CASCADE');
    table.uuid('session_id').notNullable().references('id').inTable('identity.session').onDelete('CASCADE');
    table.text('family_id').notNullable();
    table.text('parent_id').nullable();
    table.text('token_digest').notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['family_id'], 'identity_refresh_family_idx');
    table.index(['expires_at'], 'identity_refresh_expiry_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('refresh_token_family');
}
