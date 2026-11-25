import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

type IspTypeRow = {
  name: string;
  code: string;
  description: string;
  sequence: number;
};

const ISP_TYPE_CATALOG: readonly IspTypeRow[] = [
  {
    name: 'PPPoE',
    code: 'pppoe',
    description: 'PPPoE NAS device',
    sequence: 10,
  },
  {
    name: 'Hotspot',
    code: 'hotspot',
    description: 'WiFi Hotspot NAS device',
    sequence: 20,
  },
  {
    name: 'Static IP',
    code: 'static',
    description: 'Static IP NAS device',
    sequence: 30,
  },
] as const;

const DEFAULT_COMPANY_ID = 1;

export async function seed(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  const companyId = ctx.companyId ?? DEFAULT_COMPANY_ID;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  for (const ispType of ISP_TYPE_CATALOG) {
    const existing = await db('isp_isp_types').where({ code: ispType.code }).first('id');

    if (existing) {
      await db('isp_isp_types')
        .where({ id: existing.id })
        .update({
          ...ispType,
          company_id: companyId,
        });
      updated += 1;
    } else {
      await db('isp_isp_types').insert({
        ...ispType,
        company_id: companyId,
      });
      inserted += 1;
    }
  }

  return { inserted, updated, skipped };
}
