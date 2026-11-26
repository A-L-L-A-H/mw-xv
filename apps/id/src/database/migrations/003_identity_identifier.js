export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('identifier', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('identity.account').onDelete('CASCADE');
    table.text('type').notNullable();
    table.text('value').notNullable();
    table.text('display_value').notNullable();
    table.boolean('verified').notNullable().defaultTo(false);
    table.boolean('primary').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['type', 'value'], 'identity_identifier_type_value_uniq');
    table.index(['account_id'], 'identity_identifier_account_idx');
    table.check('type in (\'email\', \'username\')', {}, 'identity_identifier_type_check');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('identifier');
}
