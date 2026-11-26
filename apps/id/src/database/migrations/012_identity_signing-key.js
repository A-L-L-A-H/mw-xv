export async function up(knex) {
  await knex.schema.withSchema('identity').createTable('signing_key_metadata', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('kid').notNullable().unique();
    table.text('algorithm').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.jsonb('public_jwk').notNullable();
    table.text('provider_id').notNullable();
    table.timestamp('activated_at', { useTz: true }).nullable();
    table.timestamp('retired_at', { useTz: true }).nullable();
    table.timestamp('expires_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("algorithm IN ('RS256', 'ES256')", {}, 'identity_signing_key_alg_check');
    table.check(
      "status IN ('pending', 'active', 'retiring', 'retired')",
      {},
      'identity_signing_key_status_check'
    );
    table.check(
      "NOT (public_jwk ?| array['d','p','q','dp','dq','qi','oth','k'])",
      {},
      'identity_signing_key_public_jwk_only_check'
    );
    table.index(['status', 'activated_at'], 'identity_signing_key_status_active_idx');
    table.index(['expires_at'], 'identity_signing_key_expiry_idx');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('identity').dropTableIfExists('signing_key_metadata');
}
