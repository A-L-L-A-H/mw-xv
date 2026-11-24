import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

const REQUEST_APPROVAL_DEFINITION = {
  code: 'sample.request_approval',
  version: 1,
  name: 'Sample request approval',
  config: JSON.stringify({
    startState: 'draft',
    startRoles: ['user', 'superadmin', 'system'],
    timeoutMinutes: 10080,
    resourceModels: ['base.partner'],
    transitions: [
      {
        action: 'submit',
        from: 'draft',
        to: 'submitted',
        roles: ['user', 'superadmin', 'system'],
      },
      {
        action: 'approve',
        from: 'submitted',
        to: 'approved',
        roles: ['user', 'superadmin', 'system'],
        requiredApprovals: 1,
        requireDifferentActor: true,
      },
      {
        action: 'reject',
        from: 'submitted',
        to: 'rejected',
        roles: ['user', 'superadmin', 'system'],
      },
    ],
  }),
  enabled: true,
};

export async function seedWorkflowDefinitions(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const definition = REQUEST_APPROVAL_DEFINITION;
  const existing = await db('workflow_definitions')
    .where({ code: definition.code, version: definition.version })
    .first();

  if (existing) {
    if (
      existing.name === definition.name &&
      existing.config === definition.config &&
      existing.enabled === definition.enabled
    ) {
      skipped++;
    } else {
      await db('workflow_definitions').where({ id: existing.id }).update({
        name: definition.name,
        config: definition.config,
        enabled: definition.enabled,
      });
      updated++;
    }
  } else {
    await db('workflow_definitions').insert(definition);
    inserted++;
  }

  return { inserted, updated, skipped };
}

export const workflowSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedWorkflowDefinitions,
};
