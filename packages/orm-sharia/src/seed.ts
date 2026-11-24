import type { Knex } from 'knex';
import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import {
  ShariaContract,
  ProfitSharingDistribution,
  ZakatAssessment,
  WaqfAsset,
  HalalComplianceAudit,
} from './models/index.js';

export const SHARIA_SEED_VERSION = '1.0.0';

const USER_GROUP_CODE = 'user';

interface ShariaModelGrantSeed {
  readonly modelName: string;
  readonly read: boolean;
  readonly create: boolean;
  readonly write: boolean;
  readonly unlink: boolean;
}

const USER_GROUP_MODEL_ACCESS: readonly ShariaModelGrantSeed[] = [
  { modelName: ShariaContract.modelName, read: true, create: true, write: true, unlink: false },
  {
    modelName: ProfitSharingDistribution.modelName,
    read: true,
    create: true,
    write: true,
    unlink: false,
  },
  { modelName: ZakatAssessment.modelName, read: true, create: true, write: true, unlink: false },
  { modelName: WaqfAsset.modelName, read: true, create: true, write: true, unlink: false },
  {
    modelName: HalalComplianceAudit.modelName,
    read: true,
    create: true,
    write: true,
    unlink: false,
  },
];

interface AccessGroupRow {
  readonly id: number | string;
}

interface ModelAccessRow {
  readonly id: number | string;
}

async function resolveUserGroupId(db: Knex): Promise<number> {
  const group = await db('access_groups').where({ code: USER_GROUP_CODE }).first('id');
  if (!group) {
    throw new Error(
      `Cannot seed sharia model access: access group '${USER_GROUP_CODE}' does not exist`
    );
  }
  const groupId = Number((group as AccessGroupRow).id);
  if (!Number.isFinite(groupId)) {
    throw new Error(
      `Cannot seed sharia model access: access group '${USER_GROUP_CODE}' has no numeric id`
    );
  }
  return groupId;
}

export async function seed(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  const groupId = await resolveUserGroupId(db);
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  for (const grant of USER_GROUP_MODEL_ACCESS) {
    const existing = await db('model_access')
      .where({ group_id: groupId, model_name: grant.modelName })
      .first('id');

    if (existing) {
      await db('model_access')
        .where({ id: (existing as ModelAccessRow).id })
        .update({
          read: grant.read,
          create: grant.create,
          write: grant.write,
          unlink: grant.unlink,
          write_date: db.fn.now(),
        });
      updated += 1;
      continue;
    }

    await db('model_access').insert({
      group_id: groupId,
      model_name: grant.modelName,
      read: grant.read,
      create: grant.create,
      write: grant.write,
      unlink: grant.unlink,
      create_date: db.fn.now(),
      write_date: db.fn.now(),
    });
    inserted += 1;
  }

  return { inserted, updated, skipped };
}
