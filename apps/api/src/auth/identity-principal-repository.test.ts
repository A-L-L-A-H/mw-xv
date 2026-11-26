import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest, Partner, User } from '@moonwitness/orm-base';
import {
  findActivePrincipalByVerifiedSubject,
  resolveIdentityPrincipal,
} from './identity-principal-repository.js';

describe('identity-principal-repository (I42)', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [manifest]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('resolves an active mapped user to the exact local integer ID and auth fields', async () => {
    const partner = await Partner.query().insert({
      name: 'Mapped Business User',
      email: 'mapped.user@example.test',
      is_company: false,
    });

    const createdUser = await User.query().insert({
      identity_subject: 'sub_active_01HZY8J2K3L4M5N6P7Q8R9S0T1',
      login: 'mapped.user@example.test',
      partner_id: partner.id,
      role: 'user',
      token_version: 3,
    });

    const result = await resolveIdentityPrincipal('sub_active_01HZY8J2K3L4M5N6P7Q8R9S0T1');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected active mapped subject to resolve');
    }

    expect(result.status).toBe('resolved');
    expect(result.principal).toEqual({
      id: createdUser.id,
      userId: createdUser.id,
      identitySubject: 'sub_active_01HZY8J2K3L4M5N6P7Q8R9S0T1',
      active: true,
      partnerId: partner.id,
      partnerCompanyId: undefined,
      role: 'user',
      tokenVersion: 3,
    });

    const direct = await findActivePrincipalByVerifiedSubject(
      'sub_active_01HZY8J2K3L4M5N6P7Q8R9S0T1'
    );
    expect(direct?.id).toBe(createdUser.id);
  });

  it('rejects unknown subjects and never links implicitly by email or login', async () => {
    const partner = await Partner.query().insert({
      name: 'Email Match Candidate',
      email: 'alice@example.test',
      is_company: false,
    });

    await User.query().insert({
      login: 'alice@example.test',
      partner_id: partner.id,
      role: 'user',
    });

    const unknownResult = await resolveIdentityPrincipal('sub_unknown_999999');
    expect(unknownResult).toEqual({
      ok: false,
      status: 'not_found',
      principal: null,
    });

    // Passing an existing login/email as if it were a subject must not match unless identity_subject equals it
    const emailAttempt = await resolveIdentityPrincipal('alice@example.test');
    expect(emailAttempt).toEqual({
      ok: false,
      status: 'not_found',
      principal: null,
    });
  });

  it('rejects inactive users and users with an inactive partner as explicit fail-closed outcomes', async () => {
    const partner1 = await Partner.query().insert({
      name: 'Inactive User Partner',
      email: 'inactive.user@example.test',
      is_company: false,
    });
    const inactiveUser = await User.query().insert({
      identity_subject: 'sub_inactive_user_01',
      login: 'inactive.user@example.test',
      partner_id: partner1.id,
      role: 'user',
    });
    await User.query().findById(inactiveUser.id).patch({ active: false });

    const inactiveUserResult = await resolveIdentityPrincipal('sub_inactive_user_01');
    expect(inactiveUserResult).toEqual({
      ok: false,
      status: 'inactive',
      principal: null,
    });
    expect(await findActivePrincipalByVerifiedSubject('sub_inactive_user_01')).toBeNull();

    const partner2 = await Partner.query().insert({
      name: 'Inactive Partner Contact',
      email: 'inactive.partner@example.test',
      is_company: false,
    });
    await User.query().insert({
      identity_subject: 'sub_inactive_partner_02',
      login: 'inactive.partner@example.test',
      partner_id: partner2.id,
      role: 'user',
    });
    await Partner.query().findById(partner2.id).patch({ active: false });

    const inactivePartnerResult = await resolveIdentityPrincipal('sub_inactive_partner_02');
    expect(inactivePartnerResult).toEqual({
      ok: false,
      status: 'inactive',
      principal: null,
    });
  });

  it('fails closed on duplicated subject mappings', async () => {
    const duplicateResult = await resolveIdentityPrincipal('sub_dup_01', {
      loadRecords: async () => [
        {
          id: 10,
          identity_subject: 'sub_dup_01',
          active: true,
          partner_id: 100,
          role: 'user',
          token_version: 1,
          partner: { id: 100, active: true },
        },
        {
          id: 11,
          identity_subject: 'sub_dup_01',
          active: true,
          partner_id: 101,
          role: 'user',
          token_version: 1,
          partner: { id: 101, active: true },
        },
      ],
    });

    expect(duplicateResult).toEqual({
      ok: false,
      status: 'duplicate_subject',
      principal: null,
    });
  });

  it('rejects malformed subjects and raw unverified JWT strings', async () => {
    for (const invalidInput of [
      '',
      '   ',
      ' leading-space',
      'trailing-space ',
      'has space',
      'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl',
      null as unknown as string,
      undefined as unknown as string,
      { sub: 'sub_active' } as unknown as string,
    ]) {
      const result = await resolveIdentityPrincipal(invalidInput);
      expect(result).toEqual({
        ok: false,
        status: 'invalid_subject',
        principal: null,
      });
    }
  });
});
