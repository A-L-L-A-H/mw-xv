export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('credential', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('identity.account').onDelete('CASCADE');
    table.text('algorithm').notNullable();
    table.integer('version').notNullable();
    table.text('verifier').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['account_id'], 'identity_credential_account_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('credential');
}
