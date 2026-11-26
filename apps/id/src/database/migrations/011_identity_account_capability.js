export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('account_capability', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('identity.account').onDelete('CASCADE');
    table.text('capability').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['account_id', 'capability'], 'identity_account_capability_uniq');
    table.check("capability = 'platform_owner'", {}, 'identity_platform_capability_check');
  });

  await knex.raw(
    `CREATE UNIQUE INDEX identity_platform_owner_singleton
     ON identity.account_capability ((capability))
     WHERE capability = 'platform_owner'`
  );
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('account_capability');
}
