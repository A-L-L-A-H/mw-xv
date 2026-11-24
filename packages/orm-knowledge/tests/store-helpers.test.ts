import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import { manifest as knowledgeManifest } from '../src/index.js';
import { assertActiveCompanyActor, digest, fail, validActor } from '../src/store-helpers.js';

let db: Knex;
let userId: number;
let companyId: number;

beforeEach(async () => {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await installAddons(db, [
    baseManifest,
    jobsManifest,
    notificationManifest,
    workflowManifest,
    knowledgeManifest,
  ]);
  userId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);
  companyId = Number((await db('companies').first('id'))?.id);
  await db('company_memberships')
    .insert({ user_id: userId, company_id: companyId, is_default: true })
    .onConflict(['user_id', 'company_id'])
    .ignore();
});

afterEach(async () => db.destroy());

describe('orm-knowledge store helpers', () => {
  it('fail throws a TypeError with the exact message', () => {
    expect(() => fail('Boom')).toThrow(TypeError);
    expect(() => fail('Boom')).toThrow('Boom');
  });

  it('digest computes lowercase hex sha256', () => {
    const expected = createHash('sha256').update('hello-world', 'utf8').digest('hex');
    expect(digest('hello-world')).toBe(expected);
  });

  it('validActor validates ids and allowed roles', () => {
    expect(validActor({ userId: 1, companyId: 2, role: 'user' })).toBe(true);
    expect(validActor({ userId: 1, companyId: 2, role: 'superadmin' })).toBe(true);
    expect(validActor({ userId: 0, companyId: 2, role: 'user' })).toBe(false);
    expect(validActor({ userId: 1, companyId: -1, role: 'user' })).toBe(false);
    expect(validActor({ userId: 1.5, companyId: 2, role: 'user' })).toBe(false);
    expect(validActor({ userId: 1, companyId: 2, role: 'admin' as unknown as 'user' })).toBe(false);
  });

  it('assertActiveCompanyActor passes for active user, company, and membership', async () => {
    await expect(
      db.transaction((trx) =>
        assertActiveCompanyActor(
          trx,
          { userId, companyId, role: 'superadmin' },
          'Record is unavailable in this company context'
        )
      )
    ).resolves.toBeUndefined();
  });

  it('assertActiveCompanyActor fails with provided message when membership, company, or user is inactive/missing', async () => {
    await db('company_memberships')
      .where({ user_id: userId, company_id: companyId })
      .update({ active: false });

    await expect(
      db.transaction((trx) =>
        assertActiveCompanyActor(
          trx,
          { userId, companyId, role: 'superadmin' },
          'Custom unavailable in this company context'
        )
      )
    ).rejects.toThrow('Custom unavailable in this company context');
  });
});
