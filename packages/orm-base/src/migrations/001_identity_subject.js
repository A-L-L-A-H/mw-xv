/**
 * Add nullable unique identity_subject column and index to base.user table.
 * Repeatable and preserves existing primary keys and foreign keys.
 */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('users');
  if (!hasTable) return;

  const hasCol = await knex.schema.hasColumn('users', 'identity_subject');
  if (!hasCol) {
    await knex.schema.alterTable('users', (table) => {
      table.text('identity_subject').nullable();
    });
  }

  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (isPostgres) {
    await knex.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_identity_subject_unique
       ON users (identity_subject)
       WHERE identity_subject IS NOT NULL`
    );
  } else {
    await knex.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_identity_subject_unique
       ON users (identity_subject)`
    );
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('users');
  if (!hasTable) return;

  await knex.raw('DROP INDEX IF EXISTS users_identity_subject_unique');
  const hasCol = await knex.schema.hasColumn('users', 'identity_subject');
  if (hasCol) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('identity_subject');
    });
  }
}
