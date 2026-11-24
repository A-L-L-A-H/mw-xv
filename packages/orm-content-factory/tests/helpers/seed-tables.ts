import type { Knex } from 'knex';

/** Creates the minimal content-factory tables used by unit tests. */
export async function seedContentFactoryTables(db: Knex): Promise<void> {
  await db.schema.createTable('content_templates', (table) => {
    table.increments('id').primary();
    table.string('slug').notNullable().unique();
    table.string('name').notNullable();
    table.text('description');
    table.string('kind').notNullable();
    table.json('structure').notNullable();
    table.json('variables');
    table.string('default_locale').notNullable().defaultTo('en');
    table.json('supported_locales');
    table.string('status').notNullable().defaultTo('draft');
    table.string('version').notNullable().defaultTo('1.0.0');
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
  });

  await db.schema.createTable('content_assets', (table) => {
    table.increments('id').primary();
    table.integer('template_id').notNullable();
    table.string('title').notNullable();
    table.string('slug').notNullable().unique();
    table.string('locale').notNullable().defaultTo('en');
    table.json('content').notNullable();
    table.string('status').notNullable().defaultTo('pending');
    table.json('metadata');
    table.string('template_version').notNullable();
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
  });

  await db.schema.createTable('content_campaigns', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('slug').notNullable().unique();
    table.text('description');
    table.string('status').notNullable().defaultTo('planned');
    table.date('start_date');
    table.date('end_date');
    table.json('target_metrics');
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
  });

  await db.schema.createTable('content_publish_targets', (table) => {
    table.increments('id').primary();
    table.integer('campaign_id').notNullable();
    table.string('name').notNullable();
    table.string('kind').notNullable();
    table.string('platform').notNullable();
    table.json('config').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
  });

  await db.schema.createTable('content_publications', (table) => {
    table.increments('id').primary();
    table.integer('asset_id').notNullable();
    table.integer('target_id').notNullable();
    table.string('external_id');
    table.string('url');
    table.string('status').notNullable().defaultTo('pending');
    table.datetime('published_at');
    table.text('error');
    table.json('metrics');
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
  });

  await db.schema.createTable('content_analytics', (table) => {
    table.increments('id').primary();
    table.integer('asset_id').notNullable();
    table.string('date').notNullable();
    table.integer('views').notNullable().defaultTo(0);
    table.integer('clicks').notNullable().defaultTo(0);
    table.integer('shares').notNullable().defaultTo(0);
    table.integer('conversions').notNullable().defaultTo(0);
    table.integer('revenue_minor').notNullable().defaultTo(0);
    table.integer('company_id').notNullable();
    table.datetime('created_at');
    table.datetime('updated_at');
    table.unique(['asset_id', 'date']);
  });
}
