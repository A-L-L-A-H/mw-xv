export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS identity');
}

export async function down(knex) {
  await knex.raw('DROP SCHEMA IF EXISTS identity CASCADE');
}
