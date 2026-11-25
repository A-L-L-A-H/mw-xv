import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { DEFAULT_CONTROL_PLANE_URL } from '@moonwitness/types';
import type { Knex } from 'knex';

interface CloudProviderSeedRow {
  code: string;
  name: string;
  type: 'docker_agent' | 'coolify';
  endpoint: string;
  region: string;
  is_active: boolean;
}

const PROVIDER_REFERENCE_ROWS: CloudProviderSeedRow[] = [
  {
    code: 'docker_agent',
    name: 'Local Docker Agent (Control Plane)',
    type: 'docker_agent',
    endpoint: DEFAULT_CONTROL_PLANE_URL,
    region: 'local',
    is_active: true,
  },
  {
    code: 'coolify',
    name: 'Coolify Cloud',
    type: 'coolify',
    endpoint: 'https://coolify.moonwitness.local',
    region: 'cloud',
    is_active: false,
  },
];

export async function seedCloudProviders(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  const companyId = ctx.companyId ?? 1;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const providerRow of PROVIDER_REFERENCE_ROWS) {
    const existing = await db('cloud_providers').where({ code: providerRow.code }).first();

    if (existing) {
      const unchanged =
        existing.name === providerRow.name &&
        existing.type === providerRow.type &&
        existing.endpoint === providerRow.endpoint &&
        existing.region === providerRow.region &&
        existing.is_active === providerRow.is_active &&
        existing.company_id === companyId;

      if (unchanged) {
        skipped++;
        continue;
      }

      await db('cloud_providers').where({ id: existing.id }).update({
        name: providerRow.name,
        type: providerRow.type,
        endpoint: providerRow.endpoint,
        region: providerRow.region,
        is_active: providerRow.is_active,
        company_id: companyId,
        updated_at: new Date(),
      });
      updated++;
    } else {
      await db('cloud_providers').insert({
        code: providerRow.code,
        name: providerRow.name,
        type: providerRow.type,
        endpoint: providerRow.endpoint,
        region: providerRow.region,
        is_active: providerRow.is_active,
        company_id: companyId,
        created_at: new Date(),
        updated_at: new Date(),
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const cloudSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedCloudProviders,
};
