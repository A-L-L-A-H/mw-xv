import type { Knex } from 'knex';
import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import {
  Account,
  JournalEntry,
  JournalLine,
  LedgerPosting,
} from './models/index.js';

export const ACCOUNTING_SEED_VERSION = '1.0.0';

const USER_GROUP_CODE = 'user';

interface AccountingModelGrantSeed {
  readonly modelName: string;
  readonly read: boolean;
  readonly create: boolean;
  readonly write: boolean;
  readonly unlink: boolean;
}

const USER_GROUP_MODEL_ACCESS: readonly AccountingModelGrantSeed[] = [
  { modelName: Account.modelName, read: true, create: true, write: true, unlink: false },
  { modelName: JournalEntry.modelName, read: true, create: true, write: true, unlink: false },
  { modelName: JournalLine.modelName, read: true, create: true, write: true, unlink: false },
  { modelName: LedgerPosting.modelName, read: true, create: true, write: false, unlink: false },
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
      `Cannot seed accounting model access: access group '${USER_GROUP_CODE}' does not exist`
    );
  }
  const groupId = Number((group as AccessGroupRow).id);
  if (!Number.isFinite(groupId)) {
    throw new Error(
      `Cannot seed accounting model access: invalid group id for '${USER_GROUP_CODE}'`
    );
  }
  return groupId;
}

async function upsertModelAccess(
  db: Knex,
  groupId: number,
  grant: AccountingModelGrantSeed
): Promise<'created' | 'updated'> {
  const existing = await db('model_access')
    .where({ model_name: grant.modelName, group_id: groupId })
    .first('id');

  const payload = {
    model_name: grant.modelName,
    group_id: groupId,
    read: grant.read,
    create: grant.create,
    write: grant.write,
    unlink: grant.unlink,
  };

  if (existing) {
    await db('model_access')
      .where({ id: (existing as ModelAccessRow).id })
      .update(payload);
    return 'updated';
  }

  await db('model_access').insert(payload);
  return 'created';
}

export async function seed(ctx: SeedContext): Promise<SeedResult> {
  const groupId = await resolveUserGroupId(ctx.db);

  let inserted = 0;
  let updated = 0;

  for (const grant of USER_GROUP_MODEL_ACCESS) {
    const status = await upsertModelAccess(ctx.db, groupId, grant);
    if (status === 'created') {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  return {
    inserted,
    updated,
    skipped: 0,
  };
}
