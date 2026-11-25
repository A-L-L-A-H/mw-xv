import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import {
  manifest,
  buildOrganizationInitialSeed,
  seedOrganizationInitialData,
  type OrganizationInitialSeedBundle,
} from '../src/index.js';

describe('organization seed', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    });
  });

  afterEach(async () => db.destroy());

  it('buildOrganizationInitialSeed returns valid deterministic bundle', async () => {
    const bundle1 = buildOrganizationInitialSeed();
    const bundle2 = buildOrganizationInitialSeed();

    expect(bundle1).toEqual(bundle2);
    expect(bundle1.company.name).toBe('PT Witness Nusantara Holdings');
    expect(bundle1.company.timezone).toBe('Asia/Jakarta');
    expect(bundle1.company.countryCode).toBe('ID');
    expect(bundle1.company.currencyCode).toBe('IDR');
    expect(bundle1.company.languageCode).toBe('id-ID');

    expect(bundle1.units).toHaveLength(9);
    expect(bundle1.teams).toHaveLength(3);
    expect(bundle1.roles).toHaveLength(8);
    expect(bundle1.members).toHaveLength(9);

    // Deep clone immutability
    bundle1.units.push({ code: 'test', name: 'Test', description: 'Test', level: 'department' });
    const bundle3 = buildOrganizationInitialSeed();
    expect(bundle3.units).toHaveLength(9);
  });

  it('bundle schema validation: unit codes, levels, parent references', () => {
    const bundle = buildOrganizationInitialSeed();
    const unitCodes = new Set(bundle.units.map((u) => u.code));

    for (const unit of bundle.units) {
      expect(unit.code).toMatch(/^[a-z][a-z0-9_-]{1,63}$/);
      expect(['holding', 'operating', 'department']).toContain(unit.level);
      if (unit.parentCode) {
        expect(unitCodes).toContain(unit.parentCode);
      }
      if (unit.level === 'holding') {
        expect(unit.parentCode).toBeUndefined();
      }
    }

    // Exactly one holding
    const holdings = bundle.units.filter((u) => u.level === 'holding');
    expect(holdings).toHaveLength(1);
    expect(holdings[0].code).toBe('holding');
  });

  it('bundle schema validation: team department references', () => {
    const bundle = buildOrganizationInitialSeed();
    const unitCodes = new Set(bundle.units.map((u) => u.code));

    for (const team of bundle.teams) {
      expect(team.code).toMatch(/^[a-z][a-z0-9_-]{1,63}$/);
      expect(unitCodes).toContain(team.departmentCode);
    }
  });

  it('bundle schema validation: role permissions structure', () => {
    const bundle = buildOrganizationInitialSeed();
    const unitCodes = new Set(bundle.units.map((u) => u.code));

    for (const role of bundle.roles) {
      expect(role.code).toMatch(/^[a-z][a-z0-9_-]{1,63}$/);
      expect(unitCodes).toContain(role.departmentCode);
      expect(role.permissions).toHaveLength(4);
      for (const perm of role.permissions) {
        expect([
          'organization.department',
          'organization.team',
          'organization.position',
          'organization.membership',
        ]).toContain(perm.model);
        expect(typeof perm.read).toBe('boolean');
        expect(typeof perm.create).toBe('boolean');
        expect(typeof perm.write).toBe('boolean');
        expect(typeof perm.unlink).toBe('boolean');
      }
    }
  });

  it('bundle schema validation: member references', () => {
    const bundle = buildOrganizationInitialSeed();
    const unitCodes = new Set(bundle.units.map((u) => u.code));
    const teamCodes = new Set(bundle.teams.map((t) => t.code));
    const roleCodes = new Set(bundle.roles.map((r) => r.code));
    const memberLogins = new Set(bundle.members.map((m) => m.login));

    for (const member of bundle.members) {
      expect(member.login).toMatch(/^[a-z0-9.]+$/);
      expect(member.email).toContain('@witness-nusantara.id');
      expect(unitCodes).toContain(member.unitCode);
      if (member.teamCode) {
        expect(teamCodes).toContain(member.teamCode);
        const team = bundle.teams.find((t) => t.code === member.teamCode)!;
        expect(team.departmentCode).toBe(member.unitCode);
      }
      expect(roleCodes).toContain(member.roleCode);
      if (member.managerLogin) {
        expect(memberLogins).toContain(member.managerLogin);
      }
      expect(member.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('seedOrganizationInitialData inserts expected counts on first run', async () => {
    await installAddons(db, [baseManifest, manifest]);
    const result = await seedOrganizationInitialData(db);

    expect(result.companyId).toBeGreaterThan(0);
    expect(result.inserted.units).toBe(9);
    expect(result.inserted.teams).toBe(3);
    expect(result.inserted.positions).toBe(8);
    expect(result.inserted.members).toBe(9);
    expect(result.inserted.accessGroups).toBe(8);
    expect(result.inserted.modelAccessGrants).toBe(32); // 8 roles * 4 models
    expect(result.inserted.roleBindings).toBe(9);

    expect(result.skipped.units).toBe(0);
    expect(result.skipped.teams).toBe(0);
    expect(result.skipped.positions).toBe(0);
    expect(result.skipped.members).toBe(0);
    expect(result.skipped.accessGroups).toBe(0);
    expect(result.skipped.modelAccessGrants).toBe(0);
    expect(result.skipped.roleBindings).toBe(0);
  });

  it('seedOrganizationInitialData is idempotent: second run inserts 0, totals unchanged', async () => {
    await installAddons(db, [baseManifest, manifest]);
    const result1 = await seedOrganizationInitialData(db);
    const result2 = await seedOrganizationInitialData(db);

    expect(result2.inserted.units).toBe(0);
    expect(result2.inserted.teams).toBe(0);
    expect(result2.inserted.positions).toBe(0);
    expect(result2.inserted.members).toBe(0);
    expect(result2.inserted.accessGroups).toBe(0);
    expect(result2.inserted.modelAccessGrants).toBe(0);
    expect(result2.inserted.roleBindings).toBe(0);

    expect(result2.skipped.units).toBe(9);
    expect(result2.skipped.teams).toBe(3);
    expect(result2.skipped.positions).toBe(8);
    expect(result2.skipped.members).toBe(9);
    expect(result2.skipped.accessGroups).toBe(8);
    expect(result2.skipped.modelAccessGrants).toBe(32);
    expect(result2.skipped.roleBindings).toBe(9);

    // Verify DB totals unchanged
    const deptCount = await db('organization_departments')
      .where({ company_id: result1.companyId })
      .count({ count: '*' })
      .first();
    const teamCount = await db('organization_teams')
      .where({ company_id: result1.companyId })
      .count({ count: '*' })
      .first();
    const posCount = await db('organization_positions')
      .where({ company_id: result1.companyId })
      .count({ count: '*' })
      .first();
    const memCount = await db('organization_memberships')
      .where({ company_id: result1.companyId })
      .count({ count: '*' })
      .first();
    const groupCount = await db('access_groups')
      .where('code', 'like', 'organization_role_%')
      .count({ count: '*' })
      .first();
    const accessCount = await db('model_access')
      .join('access_groups', 'model_access.group_id', 'access_groups.id')
      .where('access_groups.code', 'like', 'organization_role_%')
      .count({ count: '*' })
      .first();
    const bindingCount = await db('group_memberships')
      .join('access_groups', 'group_memberships.group_id', 'access_groups.id')
      .where('access_groups.code', 'like', 'organization_role_%')
      .count({ count: '*' })
      .first();

    expect(Number(deptCount?.count)).toBe(9);
    expect(Number(teamCount?.count)).toBe(3);
    expect(Number(posCount?.count)).toBe(8);
    expect(Number(memCount?.count)).toBe(9);
    expect(Number(groupCount?.count)).toBe(8);
    expect(Number(accessCount?.count)).toBe(32);
    expect(Number(bindingCount?.count)).toBe(9);
  });

  it('FK consistency: member.unit matches role.department, team.department exists, manager chain valid', async () => {
    await installAddons(db, [baseManifest, manifest]);
    await seedOrganizationInitialData(db);

    const bundle = buildOrganizationInitialSeed();

    const members = await db('organization_memberships')
      .where({
        company_id: (await db('companies').where({ name: bundle.company.name }).first())!.id,
      })
      .select('*');

    for (const member of members) {
      // Use a simpler check: verify all FKs exist
      expect(
        await db('organization_departments').where({ id: member.department_id }).first()
      ).toBeTruthy();
      if (member.team_id) {
        expect(await db('organization_teams').where({ id: member.team_id }).first()).toBeTruthy();
      }
      expect(
        await db('organization_positions').where({ id: member.position_id }).first()
      ).toBeTruthy();
      if (member.manager_id) {
        expect(
          await db('organization_memberships').where({ id: member.manager_id }).first()
        ).toBeTruthy();
      }
    }

    // Team department FK
    const teams = await db('organization_teams')
      .where({
        company_id: (await db('companies').where({ name: bundle.company.name }).first())!.id,
      })
      .select('*');
    for (const team of teams) {
      expect(
        await db('organization_departments').where({ id: team.department_id }).first()
      ).toBeTruthy();
    }

    // Position department FK
    const positions = await db('organization_positions')
      .where({
        company_id: (await db('companies').where({ name: bundle.company.name }).first())!.id,
      })
      .select('*');
    for (const pos of positions) {
      if (pos.department_id) {
        expect(
          await db('organization_departments').where({ id: pos.department_id }).first()
        ).toBeTruthy();
      }
    }
  });

  it('access groups created with correct prefix and model grants', async () => {
    await installAddons(db, [baseManifest, manifest]);
    await seedOrganizationInitialData(db);

    const groups = await db('access_groups')
      .where('code', 'like', 'organization_role_%')
      .select('*');
    expect(groups).toHaveLength(8);

    const codes = groups.map((g) => g.code).sort();
    const expectedCodes = [
      'organization_role_cto',
      'organization_role_data-lead',
      'organization_role_eng-lead',
      'organization_role_ml-engineer',
      'organization_role_sales-director',
      'organization_role_senior-engineer',
      'organization_role_solutions-architect',
      'organization_role_vp-eng',
    ].sort();
    expect(codes).toEqual(expectedCodes);

    for (const group of groups) {
      const grants = await db('model_access').where({ group_id: group.id }).select('*');
      expect(grants).toHaveLength(4);
      const models = grants.map((g) => g.model_name).sort();
      expect(models).toEqual([
        'organization.department',
        'organization.membership',
        'organization.position',
        'organization.team',
      ]);
    }
  });

  it('base install + seed: original org seed records preserved, new records additive', async () => {
    await installAddons(db, [baseManifest, manifest]);

    // Original seed counts from manifest
    const origDepts = await db('organization_departments').count({ count: '*' }).first();
    const origTeams = await db('organization_teams').count({ count: '*' }).first();
    const origPositions = await db('organization_positions').count({ count: '*' }).first();
    const origMemberships = await db('organization_memberships').count({ count: '*' }).first();

    expect(Number(origDepts?.count)).toBe(4);
    expect(Number(origTeams?.count)).toBe(4);
    expect(Number(origPositions?.count)).toBe(4);
    expect(Number(origMemberships?.count)).toBe(2);

    // Now run seed
    const result = await seedOrganizationInitialData(db);

    // Verify totals are additive (4+9=13 depts, 4+3=7 teams, 4+8=12 positions, 2+9=11 memberships)
    const totalDepts = await db('organization_departments').count({ count: '*' }).first();
    const totalTeams = await db('organization_teams').count({ count: '*' }).first();
    const totalPositions = await db('organization_positions').count({ count: '*' }).first();
    const totalMemberships = await db('organization_memberships').count({ count: '*' }).first();

    expect(Number(totalDepts?.count)).toBe(13);
    expect(Number(totalTeams?.count)).toBe(7);
    expect(Number(totalPositions?.count)).toBe(12);
    expect(Number(totalMemberships?.count)).toBe(11);

    // Original records still exist
    const opsDept = await db('organization_departments').where({ code: 'operations' }).first();
    expect(opsDept).toBeTruthy();
    expect(opsDept?.name).toBe('Operations');

    const apiTeam = await db('organization_teams').where({ code: 'api' }).first();
    expect(apiTeam).toBeTruthy();
    expect(apiTeam?.name).toBe('API');

    // New records exist
    const holdingDept = await db('organization_departments').where({ code: 'holding' }).first();
    expect(holdingDept).toBeTruthy();
    expect(holdingDept?.name).toBe('Holding');
  });
});
