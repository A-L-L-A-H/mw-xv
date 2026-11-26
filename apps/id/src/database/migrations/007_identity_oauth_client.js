export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('oauth_client', (table) => {
    table.text('client_id').primary();
    table.text('type').notNullable();
    table.jsonb('grant_types').notNullable().defaultTo('[]');
    table.jsonb('redirect_uris').notNullable().defaultTo('[]');
    table.jsonb('scopes').notNullable().defaultTo('[]');
    table.text('status').notNullable().defaultTo('active');
    table.text('secret_digest').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['status'], 'identity_oauth_client_status_idx');
    table.check('type in (\'public\', \'confidential\')', {}, 'identity_oauth_client_type_check');
    table.check('status in (\'active\', \'disabled\')', {}, 'identity_oauth_client_status_check');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('oauth_client');
}
