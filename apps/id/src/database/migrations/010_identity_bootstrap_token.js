export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('bootstrap_token', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('installation_scope').notNullable().defaultTo('installation');
    table.text('token_digest').notNullable().unique();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.index(['expires_at'], 'identity_bootstrap_expiry_idx');
  });

  await knex.raw(
    `CREATE UNIQUE INDEX identity_bootstrap_one_active_per_scope
     ON identity.bootstrap_token (installation_scope)
     WHERE consumed_at IS NULL AND revoked_at IS NULL`
  );
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('bootstrap_token');
}
