export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('account', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('subject').notNullable().unique();
    table.text('status').notNullable().defaultTo('active');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('disabled_at', { useTz: true }).nullable();
    table.index(['status'], 'identity_account_status_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('account');
}
