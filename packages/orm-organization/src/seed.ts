import { type Knex } from 'knex';
import { DEFAULT_TIMEZONE } from '@moonwitness/orm-base';

export interface OrganizationSeedPermission {
  model: string;
  read: boolean;
  create: boolean;
  write: boolean;
  unlink: boolean;
}

export interface OrganizationUnitSeed {
  code: string;
  name: string;
  description: string;
  parentCode?: string;
  level: 'holding' | 'operating' | 'department';
}

export interface OrganizationRoleSeed {
  code: string;
  name: string;
  description: string;
  departmentCode: string;
  positionCode: string;
  permissions: OrganizationSeedPermission[];
}

export interface OrganizationMemberSeed {
  login: string;
  name: string;
  email: string;
  unitCode: string;
  teamCode?: string;
  roleCode: string;
  managerLogin?: string;
  startDate: string;
}

export interface OrganizationTeamSeed {
  code: string;
  name: string;
  description: string;
  departmentCode: string;
}

export interface OrganizationInitialSeedBundle {
  company: {
    name: string;
    email: string;
    website: string;
    countryCode: string;
    currencyCode: string;
    languageCode: string;
    timezone: string;
  };
  units: OrganizationUnitSeed[];
  teams: OrganizationTeamSeed[];
  roles: OrganizationRoleSeed[];
  members: OrganizationMemberSeed[];
}

export interface OrganizationSeedExecutionResult {
  companyId: number;
  inserted: {
    units: number;
    teams: number;
    positions: number;
    members: number;
    accessGroups: number;
    modelAccessGrants: number;
    roleBindings: number;
  };
  skipped: {
    units: number;
    teams: number;
    positions: number;
    members: number;
    accessGroups: number;
    modelAccessGrants: number;
    roleBindings: number;
  };
}

const COMPANY_DATA = {
  name: 'PT Witness Nusantara Holdings',
  email: 'corporate@witness-nusantara.id',
  website: 'https://witness-nusantara.id',
  countryCode: 'ID',
  currencyCode: 'IDR',
  languageCode: 'id-ID',
  timezone: DEFAULT_TIMEZONE,
};

const UNITS: OrganizationUnitSeed[] = [
  {
    code: 'holding',
    name: 'Holding',
    description: 'PT Witness Nusantara Holdings - Sovereign holding company',
    level: 'holding',
  },
  {
    code: 'tech',
    name: 'Technology',
    description: 'PT Witness Teknologi Nusantara - Operating unit for engineering',
    level: 'operating',
    parentCode: 'holding',
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'PT Witness Growth Indonesia - Operating unit for revenue & sales',
    level: 'operating',
    parentCode: 'holding',
  },
  {
    code: 'services',
    name: 'Services',
    description: 'PT Witness Layanan Nusantara - Operating unit for customer operations',
    level: 'operating',
    parentCode: 'holding',
  },
  {
    code: 'engineering',
    name: 'Engineering',
    description: 'Software engineering & platform development',
    level: 'department',
    parentCode: 'tech',
  },
  {
    code: 'data',
    name: 'Data & AI',
    description: 'Data engineering, ML platform, analytics',
    level: 'department',
    parentCode: 'tech',
  },
  {
    code: 'sales',
    name: 'Enterprise Sales',
    description: 'Enterprise pipeline, strategic accounts, renewals',
    level: 'department',
    parentCode: 'growth',
  },
  {
    code: 'marketing',
    name: 'Growth Marketing',
    description: 'Demand generation, brand, events, content',
    level: 'department',
    parentCode: 'growth',
  },
  {
    code: 'support',
    name: 'Customer Support',
    description: 'Omnichannel support, SLA, onboarding, escalation',
    level: 'department',
    parentCode: 'services',
  },
];

const TEAMS: OrganizationTeamSeed[] = [
  {
    code: 'platform',
    name: 'Platform Engineering',
    description: 'Core platform, infrastructure, developer experience',
    departmentCode: 'engineering',
  },
  {
    code: 'ml-platform',
    name: 'ML Platform',
    description: 'Feature store, training pipelines, model serving',
    departmentCode: 'data',
  },
  {
    code: 'solutions',
    name: 'Solutions Engineering',
    description: 'Enterprise demos, PoC onboarding, deal engineering',
    departmentCode: 'sales',
  },
];

const ROLES: OrganizationRoleSeed[] = [
  {
    code: 'cto',
    name: 'Chief Technology Officer',
    description: 'Technology strategy, architecture governance, engineering leadership',
    departmentCode: 'engineering',
    positionCode: 'cto',
    permissions: [
      { model: 'organization.department', read: true, create: true, write: true, unlink: true },
      { model: 'organization.team', read: true, create: true, write: true, unlink: true },
      { model: 'organization.position', read: true, create: true, write: true, unlink: true },
      { model: 'organization.membership', read: true, create: true, write: true, unlink: true },
    ],
  },
  {
    code: 'vp-eng',
    name: 'VP Engineering',
    description: 'Engineering execution, delivery, hiring, career development',
    departmentCode: 'engineering',
    positionCode: 'vp_engineering',
    permissions: [
      { model: 'organization.department', read: true, create: true, write: true, unlink: false },
      { model: 'organization.team', read: true, create: true, write: true, unlink: false },
      { model: 'organization.position', read: true, create: true, write: true, unlink: false },
      { model: 'organization.membership', read: true, create: true, write: true, unlink: false },
    ],
  },
  {
    code: 'eng-lead',
    name: 'Engineering Lead',
    description: 'Team leadership, technical direction, code review, sprint execution',
    departmentCode: 'engineering',
    positionCode: 'engineering_lead',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: true, write: true, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: true, write: true, unlink: false },
    ],
  },
  {
    code: 'senior-engineer',
    name: 'Senior Software Engineer',
    description: 'Feature development, system design, mentoring, on-call',
    departmentCode: 'engineering',
    positionCode: 'senior_engineer',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: false, write: false, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: false, write: false, unlink: false },
    ],
  },
  {
    code: 'data-lead',
    name: 'Data & AI Lead',
    description: 'Data strategy, ML platform, analytics governance',
    departmentCode: 'data',
    positionCode: 'data_lead',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: true, write: true, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: true, write: true, unlink: false },
    ],
  },
  {
    code: 'ml-engineer',
    name: 'ML Engineer',
    description: 'Model training, feature engineering, MLOps, experimentation',
    departmentCode: 'data',
    positionCode: 'ml_engineer',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: false, write: false, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: false, write: false, unlink: false },
    ],
  },
  {
    code: 'sales-director',
    name: 'Sales Director',
    description: 'Enterprise pipeline, strategic accounts, revenue forecasting',
    departmentCode: 'sales',
    positionCode: 'sales_director',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: true, write: true, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: true, write: true, unlink: false },
    ],
  },
  {
    code: 'solutions-architect',
    name: 'Solutions Architect',
    description: 'Enterprise demos, PoC delivery, technical pre-sales, deal engineering',
    departmentCode: 'sales',
    positionCode: 'solutions_architect',
    permissions: [
      { model: 'organization.department', read: true, create: false, write: false, unlink: false },
      { model: 'organization.team', read: true, create: false, write: false, unlink: false },
      { model: 'organization.position', read: true, create: false, write: false, unlink: false },
      { model: 'organization.membership', read: true, create: false, write: false, unlink: false },
    ],
  },
];

const MEMBERS: OrganizationMemberSeed[] = [
  {
    login: 'budi.santoso',
    name: 'Budi Santoso',
    email: 'budi.santoso@witness-nusantara.id',
    unitCode: 'holding',
    roleCode: 'cto',
    startDate: '2024-01-15',
  },
  {
    login: 'siti.rahayu',
    name: 'Siti Rahayu',
    email: 'siti.rahayu@witness-nusantara.id',
    unitCode: 'engineering',
    teamCode: 'platform',
    roleCode: 'vp-eng',
    managerLogin: 'budi.santoso',
    startDate: '2024-02-01',
  },
  {
    login: 'agus.prasetyo',
    name: 'Agus Prasetyo',
    email: 'agus.prasetyo@witness-nusantara.id',
    unitCode: 'engineering',
    teamCode: 'platform',
    roleCode: 'eng-lead',
    managerLogin: 'siti.rahayu',
    startDate: '2024-02-15',
  },
  {
    login: 'dewi.lestari',
    name: 'Dewi Lestari',
    email: 'dewi.lestari@witness-nusantara.id',
    unitCode: 'engineering',
    teamCode: 'platform',
    roleCode: 'senior-engineer',
    managerLogin: 'agus.prasetyo',
    startDate: '2024-03-01',
  },
  {
    login: 'rudi.hartono',
    name: 'Rudi Hartono',
    email: 'rudi.hartono@witness-nusantara.id',
    unitCode: 'data',
    teamCode: 'ml-platform',
    roleCode: 'data-lead',
    managerLogin: 'budi.santoso',
    startDate: '2024-02-01',
  },
  {
    login: 'maya.putri',
    name: 'Maya Putri',
    email: 'maya.putri@witness-nusantara.id',
    unitCode: 'data',
    teamCode: 'ml-platform',
    roleCode: 'ml-engineer',
    managerLogin: 'rudi.hartono',
    startDate: '2024-03-15',
  },
  {
    login: 'andreas.wijaya',
    name: 'Andreas Wijaya',
    email: 'andreas.wijaya@witness-nusantara.id',
    unitCode: 'sales',
    teamCode: 'solutions',
    roleCode: 'sales-director',
    managerLogin: 'budi.santoso',
    startDate: '2024-01-20',
  },
  {
    login: 'lina.kusuma',
    name: 'Lina Kusuma',
    email: 'lina.kusuma@witness-nusantara.id',
    unitCode: 'sales',
    teamCode: 'solutions',
    roleCode: 'solutions-architect',
    managerLogin: 'andreas.wijaya',
    startDate: '2024-02-10',
  },
  {
    login: 'eko.susanto',
    name: 'Eko Susanto',
    email: 'eko.susanto@witness-nusantara.id',
    unitCode: 'support',
    roleCode: 'eng-lead',
    managerLogin: 'siti.rahayu',
    startDate: '2024-04-01',
  },
];

const POSITIONS: Record<string, { code: string; name: string; description: string }> = {
  cto: {
    code: 'cto',
    name: 'Chief Technology Officer',
    description: 'Technology strategy, architecture governance, engineering leadership',
  },
  vp_engineering: {
    code: 'vp_engineering',
    name: 'VP Engineering',
    description: 'Engineering execution, delivery, hiring, career development',
  },
  engineering_lead: {
    code: 'engineering_lead',
    name: 'Engineering Lead',
    description: 'Team leadership, technical direction, code review, sprint execution',
  },
  senior_engineer: {
    code: 'senior_engineer',
    name: 'Senior Software Engineer',
    description: 'Feature development, system design, mentoring, on-call',
  },
  data_lead: {
    code: 'data_lead',
    name: 'Data & AI Lead',
    description: 'Data strategy, ML platform, analytics governance',
  },
  ml_engineer: {
    code: 'ml_engineer',
    name: 'ML Engineer',
    description: 'Model training, feature engineering, MLOps, experimentation',
  },
  sales_director: {
    code: 'sales_director',
    name: 'Sales Director',
    description: 'Enterprise pipeline, strategic accounts, revenue forecasting',
  },
  solutions_architect: {
    code: 'solutions_architect',
    name: 'Solutions Architect',
    description: 'Enterprise demos, PoC delivery, technical pre-sales, deal engineering',
  },
};

function validateBundle(bundle: OrganizationInitialSeedBundle): void {
  const unitCodes = new Set(bundle.units.map((u) => u.code));
  for (const unit of bundle.units) {
    if (unit.parentCode && !unitCodes.has(unit.parentCode)) {
      throw new Error(`Unit ${unit.code} references unknown parent ${unit.parentCode}`);
    }
  }
  const teamDeptCodes = new Set(bundle.teams.map((t) => t.departmentCode));
  for (const deptCode of teamDeptCodes) {
    if (!unitCodes.has(deptCode)) {
      throw new Error(`Team references unknown department ${deptCode}`);
    }
  }
  for (const role of bundle.roles) {
    if (!unitCodes.has(role.departmentCode)) {
      throw new Error(`Role ${role.code} references unknown department ${role.departmentCode}`);
    }
  }
  const roleCodes = new Set(bundle.roles.map((r) => r.code));
  const memberLogins = new Set(bundle.members.map((m) => m.login));
  for (const member of bundle.members) {
    if (!unitCodes.has(member.unitCode)) {
      throw new Error(`Member ${member.login} references unknown unit ${member.unitCode}`);
    }
    if (member.teamCode) {
      const team = bundle.teams.find((t) => t.code === member.teamCode);
      if (!team)
        throw new Error(`Member ${member.login} references unknown team ${member.teamCode}`);
      if (team.departmentCode !== member.unitCode) {
        throw new Error(`Member ${member.login} team ${member.teamCode} department mismatch`);
      }
    }
    if (!roleCodes.has(member.roleCode)) {
      throw new Error(`Member ${member.login} references unknown role ${member.roleCode}`);
    }
    if (member.managerLogin && !memberLogins.has(member.managerLogin)) {
      throw new Error(`Member ${member.login} references unknown manager ${member.managerLogin}`);
    }
  }
}

export function buildOrganizationInitialSeed(): OrganizationInitialSeedBundle {
  const bundle: OrganizationInitialSeedBundle = {
    company: COMPANY_DATA,
    units: UNITS,
    teams: TEAMS,
    roles: ROLES,
    members: MEMBERS,
  };
  validateBundle(bundle);
  return JSON.parse(JSON.stringify(bundle));
}

async function ensureCompany(
  db: Knex,
  companyData: OrganizationInitialSeedBundle['company']
): Promise<number> {
  const existing = await db('companies').where({ name: companyData.name }).first();
  if (existing) return existing.id;
  const [company] = await db('companies')
    .insert({
      name: companyData.name,
      email: companyData.email,
      website: companyData.website,
      country_id: (await db('countries').where({ code: companyData.countryCode }).first())?.id,
      currency_id: (await db('currencies').where({ code: companyData.currencyCode }).first())?.id,
      language_id: (await db('languages').where({ code: companyData.languageCode }).first())?.id,
      timezone: companyData.timezone,
    })
    .returning('id');
  return company.id;
}

async function ensurePartner(
  db: Knex,
  companyId: number,
  email: string,
  name: string
): Promise<number> {
  const existing = await db('partners').where({ email, company_id: companyId }).first();
  if (existing) return existing.id;
  const [partner] = await db('partners')
    .insert({ name, email, company_id: companyId, is_company: false })
    .returning('id');
  return partner.id;
}

async function ensureUser(db: Knex, partnerId: number, login: string): Promise<number> {
  const existing = await db('users').where({ login }).first();
  if (existing) return existing.id;
  const [user] = await db('users')
    .insert({ login, partner_id: partnerId, role: 'user' })
    .returning('id');
  return user.id;
}

export async function seedOrganizationInitialData(
  db: Knex
): Promise<OrganizationSeedExecutionResult> {
  const bundle = buildOrganizationInitialSeed();
  const result: OrganizationSeedExecutionResult = {
    companyId: 0,
    inserted: {
      units: 0,
      teams: 0,
      positions: 0,
      members: 0,
      accessGroups: 0,
      modelAccessGrants: 0,
      roleBindings: 0,
    },
    skipped: {
      units: 0,
      teams: 0,
      positions: 0,
      members: 0,
      accessGroups: 0,
      modelAccessGrants: 0,
      roleBindings: 0,
    },
  };

  const trx = await db.transaction();
  try {
    // Company
    result.companyId = await ensureCompany(trx, bundle.company);

    // Units (Departments)
    const unitIdMap = new Map<string, number>();
    for (const unit of bundle.units) {
      const existing = await trx('organization_departments')
        .where({ company_id: result.companyId, code: unit.code })
        .first();
      if (existing) {
        unitIdMap.set(unit.code, existing.id);
        result.skipped.units++;
        continue;
      }
      const [dept] = await trx('organization_departments')
        .insert({
          company_id: result.companyId,
          code: unit.code,
          name: unit.name,
          description: unit.description,
          parent_id: unit.parentCode ? unitIdMap.get(unit.parentCode) : null,
        })
        .returning('id');
      unitIdMap.set(unit.code, dept.id);
      result.inserted.units++;
    }

    // Teams
    const teamIdMap = new Map<string, number>();
    for (const team of bundle.teams) {
      const existing = await trx('organization_teams')
        .where({ company_id: result.companyId, code: team.code })
        .first();
      if (existing) {
        teamIdMap.set(team.code, existing.id);
        result.skipped.teams++;
        continue;
      }
      const [t] = await trx('organization_teams')
        .insert({
          company_id: result.companyId,
          code: team.code,
          name: team.name,
          description: team.description,
          department_id: unitIdMap.get(team.departmentCode)!,
        })
        .returning('id');
      teamIdMap.set(team.code, t.id);
      result.inserted.teams++;
    }

    // Positions
    const positionIdMap = new Map<string, number>();
    const positionCodes = [...new Set(bundle.roles.map((r) => r.positionCode))];
    for (const posCode of positionCodes) {
      const pos = POSITIONS[posCode];
      if (!pos) continue;
      const existing = await trx('organization_positions')
        .where({ company_id: result.companyId, code: pos.code })
        .first();
      if (existing) {
        positionIdMap.set(posCode, existing.id);
        result.skipped.positions++;
        continue;
      }
      // Find a department for this position (first role using it)
      const roleForPos = bundle.roles.find((r) => r.positionCode === posCode);
      const [p] = await trx('organization_positions')
        .insert({
          company_id: result.companyId,
          code: pos.code,
          name: pos.name,
          description: pos.description,
          department_id: roleForPos ? unitIdMap.get(roleForPos.departmentCode) : null,
        })
        .returning('id');
      positionIdMap.set(posCode, p.id);
      result.inserted.positions++;
    }

    // Access Groups & Model Access (before members to bind users)
    const accessGroupIdMap = new Map<string, number>();
    for (const role of bundle.roles) {
      const groupCode = `organization_role_${role.code}`;
      const existingGroup = await trx('access_groups').where({ code: groupCode }).first();
      let groupId: number;
      if (existingGroup) {
        groupId = existingGroup.id;
        result.skipped.accessGroups++;
      } else {
        const [group] = await trx('access_groups')
          .insert({ code: groupCode, name: role.name, description: role.description })
          .returning('id');
        groupId = group.id;
        result.inserted.accessGroups++;
      }
      accessGroupIdMap.set(role.code, groupId);

      for (const perm of role.permissions) {
        const existingAccess = await trx('model_access')
          .where({ group_id: groupId, model_name: perm.model })
          .first();
        if (existingAccess) {
          result.skipped.modelAccessGrants++;
          continue;
        }
        await trx('model_access').insert({
          group_id: groupId,
          model_name: perm.model,
          read: perm.read,
          create: perm.create,
          write: perm.write,
          unlink: perm.unlink,
        });
        result.inserted.modelAccessGrants++;
      }
    }

    // Members
    const memberIdMap = new Map<string, number>();
    for (const member of bundle.members) {
      const partnerId = await ensurePartner(trx, result.companyId, member.email, member.name);
      const userId = await ensureUser(trx, partnerId, member.login);

      const existingMember = await trx('organization_memberships')
        .where({ company_id: result.companyId, user_id: userId })
        .first();
      if (existingMember) {
        memberIdMap.set(member.login, existingMember.id);
        result.skipped.members++;
      } else {
        const role = bundle.roles.find((r) => r.code === member.roleCode)!;
        const [membership] = await trx('organization_memberships')
          .insert({
            company_id: result.companyId,
            user_id: userId,
            department_id: unitIdMap.get(member.unitCode)!,
            team_id: member.teamCode ? teamIdMap.get(member.teamCode) : null,
            position_id: positionIdMap.get(role.positionCode)!,
            manager_id: member.managerLogin ? memberIdMap.get(member.managerLogin) : null,
            start_date: member.startDate,
          })
          .returning('id');
        memberIdMap.set(member.login, membership.id);
        result.inserted.members++;
      }

      // Bind user to role access group (runs for both new and existing members)
      const groupId = accessGroupIdMap.get(member.roleCode)!;
      const existingBinding = await trx('group_memberships')
        .where({ user_id: userId, group_id: groupId })
        .first();
      if (!existingBinding) {
        await trx('group_memberships').insert({ user_id: userId, group_id: groupId });
        result.inserted.roleBindings++;
      } else {
        result.skipped.roleBindings++;
      }
    }

    await trx.commit();
  } catch (e) {
    await trx.rollback();
    throw e;
  }

  return result;
}
