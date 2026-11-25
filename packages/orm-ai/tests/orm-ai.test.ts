import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defineAddon,
  installAddons,
  ref,
  registerAddons,
  Registry,
  resolveViews,
  seed,
  type Addon,
} from '@moonwitness/orm';
import {
  AccessGroup,
  Company,
  CompanyMembership,
  IrFeatureFlag,
  isFeatureFlagEnabled,
  manifest as baseManifest,
  ModelAccess,
  Partner,
  User,
} from '@moonwitness/orm-base';
import { Job, jobsManifest } from '@moonwitness/jobs';
import {
  OrganizationDepartment,
  OrganizationMembership,
  OrganizationPosition,
  OrganizationTeam,
  manifest as organizationManifest,
} from '@moonwitness/orm-organization';
import { LocalFileAttachmentStorage, manifest as storageManifest } from '@moonwitness/orm-storage';
import {
  manifest as workflowManifest,
  startWorkflow,
  transitionWorkflow,
} from '@moonwitness/orm-workflow';
import { manifest as notificationManifest } from '../../orm-notification/dist/index.js';
import { manifest as requestManifest, PurchaseRequest } from '../../orm-request/dist/index.js';
import { manifest as integrationManifest } from '../../orm-integration/dist/index.js';
import { manifest as knowledgeManifest } from '../../orm-knowledge/dist/index.js';
import {
  AcceptanceCriterion,
  Agent,
  AgentProfile,
  AgentRun,
  ArtifactManifest,
  assertAcyclicAgentHierarchy,
  assertAcyclicWorkContractHierarchy,
  assertAgentServicePrincipal,
  assertSafeCapabilityIdentifier,
  assertValidProviderSecretRef,
  CapabilityGrant,
  ExecutionPolicy,
  findAgentByServiceUserId,
  isActiveCapabilityGrant,
  isAgentOperational,
  isAllowedClassificationRoute,
  isUsableApprovedMemory,
  isUsableApprovedSkill,
  isValidAiMutation,
  isValidProviderEndpoint,
  isValidSha256,
  isValidStorageKey,
  manifest as aiManifest,
  MemoryCandidate,
  ModelProfile,
  Obligation,
  ProviderProfile,
  SkillVersion,
  Taskforce,
  validateServicePrincipalUser,
  WorkContract,
  WorkforceAssignment,
} from '../src/index.js';

const FULL_ADDONS: readonly Addon[] = [
  baseManifest,
  organizationManifest,
  jobsManifest,
  notificationManifest,
  workflowManifest,
  requestManifest,
  integrationManifest,
  storageManifest,
  knowledgeManifest,
  aiManifest,
];

const EXPECTED_AI_MODEL_NAMES = [
  'ai.provider_profile',
  'ai.model_profile',
  'ai.execution_policy',
  'ai.agent',
  'ai.agent_profile',
  'ai.work_contract',
  'ai.acceptance_criterion',
  'ai.capability_grant',
  'ai.agent_run',
  'ai.agent_run_effect',
  'ai.interactive_session',
  'ai.interactive_session_event',
  'ai.interactive_session_command',
  'ai.interactive_session_approval',
  'ai.artifact_manifest',
  'ai.obligation',
  'ai.taskforce',
  'ai.workforce_assignment',
  'ai.skill_version',
  'ai.memory_candidate',
] as const;

let activeDb: Knex | undefined;
const tempDirs: string[] = [];

function createMemoryDb(): Knex {
  const db = knex({
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
  activeDb = db;
  return db;
}

async function setupFullAddons(reverseOrder = true): Promise<Knex> {
  const db = createMemoryDb();
  Model.knex(db);
  await installAddons(db, reverseOrder ? [...FULL_ADDONS].reverse() : FULL_ADDONS);
  return db;
}

async function createCompanyWithUser(
  name: string,
  login: string,
  role: 'user' | 'superadmin' | 'system' = 'user',
  options: { withPassword?: boolean; partnerActive?: boolean; userActive?: boolean } = {}
) {
  const company = await Company.query().insertAndFetch({ name });
  const partner = await Partner.query().insertAndFetch({
    name: `${name} ${login}`,
    company_id: company.id,
    active: options.partnerActive ?? true,
  });
  const user = await User.query().insertAndFetch({
    login,
    role,
    partner_id: partner.id,
    active: options.userActive ?? true,
    ...(options.withPassword ? { password: 'fixture-password-value' } : {}),
  });
  await CompanyMembership.query().insert({
    user_id: user.id,
    company_id: company.id,
    is_default: true,
  });
  return { company, partner, user };
}

async function createCoreAiStack(companyId: number, userId: number, suffix: string) {
  const provider = await ProviderProfile.query().insertAndFetch({
    company_id: companyId,
    code: `provider_${suffix}`,
    name: `Local Provider ${suffix}`,
    kind: 'ollama',
    endpoint_url: 'http://127.0.0.1:11434',
    secret_ref: 'MW_AI_LOCAL_UNUSED',
    data_classification: 'local_only',
    enabled: true,
  });
  const modelProfile = await ModelProfile.query().insertAndFetch({
    company_id: companyId,
    provider_profile_id: provider.id,
    code: `model_${suffix}`,
    name: `Model ${suffix}`,
    model_id: 'qwen2.5:7b',
    supports_tools: true,
    supports_structured_output: true,
    enabled: true,
  });
  const policy = await ExecutionPolicy.query().insertAndFetch({
    company_id: companyId,
    code: `policy_${suffix}`,
    policy_version: 1,
    name: `Policy ${suffix}`,
    default_risk_tier: 'R0',
    max_risk_tier: 'R1',
    allowed_classification: 'local_only',
    allow_cloud_fallback: false,
    require_independent_review: true,
    max_delegation_depth: 2,
    enabled: true,
  });
  const agent = await Agent.query().insertAndFetch({
    company_id: companyId,
    code: `agent_${suffix}`,
    status: 'active',
    role_template: 'researcher',
    is_emergency_stopped: false,
  });
  const reviewer = await Agent.query().insertAndFetch({
    company_id: companyId,
    code: `reviewer_${suffix}`,
    status: 'active',
    role_template: 'reviewer',
    is_emergency_stopped: false,
  });
  const contract = await WorkContract.query().insertAndFetch({
    company_id: companyId,
    code: `contract_${suffix}`,
    title: `Contract ${suffix}`,
    objective: 'Produce verified research report',
    execution_policy_id: policy.id,
    requested_by_id: userId,
    assigned_agent_id: agent.id,
    reviewer_agent_id: reviewer.id,
    risk_tier: 'R0',
    data_classification: 'local_only',
    status: 'draft',
  });
  const issuedAt = new Date('2026-11-22T00:00:00.000Z').toISOString();
  const expiresAt = new Date('2026-12-22T00:00:00.000Z').toISOString();
  const grant = await CapabilityGrant.query().insertAndFetch({
    company_id: companyId,
    agent_id: agent.id,
    work_contract_id: contract.id,
    execution_policy_id: policy.id,
    capability: 'repo.read@v1',
    policy_version: 1,
    issued_by_id: userId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: 'active',
  });
  return { provider, modelProfile, policy, agent, reviewer, contract, grant, issuedAt, expiresAt };
}

afterEach(async () => {
  if (activeDb) {
    await activeDb.destroy();
    activeDb = undefined;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('@moonwitness/orm-ai addon conformance and domain lifecycle', () => {
  it('installs cleanly in SQLite with all dependencies and supports registerAddons in-memory', async () => {
    const memoryOnlyDb = createMemoryDb();
    await registerAddons(memoryOnlyDb, [...FULL_ADDONS].reverse());
    expect(Registry.has('ai.agent')).toBe(true);
    expect(Registry.has('ai.taskforce')).toBe(true);
    expect(Registry.has('ai.workforce_assignment')).toBe(true);
    expect(await memoryOnlyDb.schema.hasTable('_orm_addons')).toBe(false);
    await memoryOnlyDb.destroy();
    activeDb = undefined;

    const db = await setupFullAddons(true);
    expect(aiManifest.name).toBe('ai');
    expect(aiManifest.version).toBe('1.1.0');
    expect(aiManifest.depends).toEqual(['base', 'organization', 'jobs', 'workflow', 'orm-storage']);
    expect(aiManifest.models.map((m) => m.modelName)).toEqual(
      expect.arrayContaining([...EXPECTED_AI_MODEL_NAMES])
    );
    expect(aiManifest.models).toHaveLength(20);
    expect(aiManifest.views).toHaveLength(15);
    expect(aiManifest.menus).toHaveLength(15);
    for (const seedRecord of aiManifest.data ?? []) {
      expect(seedRecord.id.startsWith('ai.')).toBe(true);
    }

    const addonRow = await db('_orm_addons').where({ name: 'ai' }).first();
    expect(addonRow).toMatchObject({ name: 'ai', version: '1.1.0' });

    const tables = await db('sqlite_master').where({ type: 'table' }).select('name');
    const tableSet = new Set(tables.map((row: { name: string }) => row.name));
    for (const modelName of EXPECTED_AI_MODEL_NAMES) {
      expect(Registry.has(modelName)).toBe(true);
      const registered = Registry.get(modelName);
      expect(tableSet.has(registered.tableName)).toBe(true);
      const resolvedView = resolveViews(registered);
      expect(resolvedView.model).toBe(modelName);
      expect(resolvedView.fields.length).toBeGreaterThan(0);
    }

    // Verify orm-request stays unmodified and WorkContract can correlate to request.purchase.
    expect(PurchaseRequest.fields).not.toHaveProperty('risk_tier');
    const company = await Company.query().first().throwIfNotFound();
    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();
    const policy = await ExecutionPolicy.query()
      .findOne({ code: 'r0_readonly_default' })
      .throwIfNotFound();
    const pr = await PurchaseRequest.query().first().throwIfNotFound();
    const linkedContract = await WorkContract.query().insertAndFetch({
      company_id: company.id,
      code: 'linked_pr_contract',
      title: 'Inspect Purchase Request',
      objective: 'Verify source_model/source_id correlation',
      source_model: PurchaseRequest.modelName,
      source_id: pr.id,
      execution_policy_id: policy.id,
      requested_by_id: superadmin.id,
    });
    expect(linkedContract.source_model).toBe('request.purchase');
    expect(linkedContract.source_id).toBe(pr.id);
  });

  it('reinstalls idempotently, preserves user edits, runs semver upgrades, and rejects downgrades', async () => {
    const db = await setupFullAddons(false);
    const seedCountBefore = await db('_orm_data').count({ count: '*' }).first();
    const userCountBefore = await db('users').count({ count: '*' }).first();

    const seededProfile = await AgentProfile.query()
      .findOne({ name: 'Example Bounded Researcher' })
      .throwIfNotFound();
    expect(seededProfile.display_name).toBe('Example Bounded Researcher');
    await AgentProfile.query()
      .findById(seededProfile.id)
      .patch({ name: 'Customized Researcher Title' });

    const seededPolicy = await ExecutionPolicy.query()
      .findOne({ code: 'r0_readonly_default' })
      .throwIfNotFound();
    await ExecutionPolicy.query()
      .findById(seededPolicy.id)
      .patch({ description: 'Operator customized description' });

    await installAddons(db, FULL_ADDONS);
    expect(await db('_orm_data').count({ count: '*' }).first()).toEqual(seedCountBefore);
    expect(await db('users').count({ count: '*' }).first()).toEqual(userCountBefore);

    const reloadedProfile = await AgentProfile.query().findById(seededProfile.id).throwIfNotFound();
    const reloadedPolicy = await ExecutionPolicy.query()
      .findById(seededPolicy.id)
      .throwIfNotFound();
    expect(reloadedProfile.name).toBe('Customized Researcher Title');
    expect(reloadedPolicy.description).toBe('Operator customized description');

    // Upgrade hook runs transactionally and preserves existing data.
    let upgradeExecuted = false;
    const upgradedManifest = defineAddon({
      ...aiManifest,
      version: '1.2.0',
      upgrade: {
        '1.1.0': async (trx) => {
          upgradeExecuted = true;
          const rows = await trx(AgentProfile.tableName).where({ id: seededProfile.id });
          expect(rows).toHaveLength(1);
        },
      },
    });
    await installAddons(
      db,
      FULL_ADDONS.map((addon) => (addon === aiManifest ? upgradedManifest : addon))
    );
    expect(upgradeExecuted).toBe(true);
    expect(await db('_orm_addons').where({ name: 'ai' }).first()).toMatchObject({
      name: 'ai',
      version: '1.2.0',
    });
    expect((await AgentProfile.query().findById(seededProfile.id).throwIfNotFound()).name).toBe(
      'Customized Researcher Title'
    );

    // Downgrade is rejected.
    await expect(installAddons(db, FULL_ADDONS)).rejects.toThrow(/downgrade/iu);

    // Duplicate external seed IDs fail safely.
    const dupAddon = defineAddon({
      name: 'ai_dup_test',
      version: '1.0.0',
      depends: ['ai'],
      models: [],
      data: [
        seed(ExecutionPolicy, 'ai_dup_test.policy_a', {
          company: ref('base.company_default'),
          code: 'dup_a',
          name: 'Dup A',
        }),
        seed(ExecutionPolicy, 'ai_dup_test.policy_a', {
          company: ref('base.company_default'),
          code: 'dup_b',
          name: 'Dup B',
        }),
      ],
    });
    await expect(
      installAddons(
        db,
        FULL_ADDONS.map((addon) => (addon === aiManifest ? upgradedManifest : addon)).concat(
          dupAddon
        )
      )
    ).rejects.toThrow(/Duplicate external data ID/iu);
  }, 30_000);

  it('enforces agent lifecycle states, org consistency, acyclic reporting, and non-privileged service principals', async () => {
    const db = await setupFullAddons();
    const { company: compA, user: svcUserA } = await createCompanyWithUser(
      'Tenant Alpha',
      'svc_agent_a',
      'user'
    );
    const { company: compB, user: superadminB } = await createCompanyWithUser(
      'Tenant Beta',
      'admin_beta',
      'superadmin'
    );
    const { user: systemUser } = await createCompanyWithUser('Tenant Gamma', 'sys_gamma', 'system');
    const { user: pwUser } = await createCompanyWithUser('Tenant Delta', 'pw_user', 'user', {
      withPassword: true,
    });
    const { user: inactivePartnerUser } = await createCompanyWithUser(
      'Tenant Epsilon',
      'inactive_partner_user',
      'user',
      { partnerActive: false }
    );
    const { user: multiCompanyUser } = await createCompanyWithUser(
      'Tenant Zeta',
      'multi_co_user',
      'user'
    );
    await CompanyMembership.query().insert({
      user_id: multiCompanyUser.id,
      company_id: compB.id,
    });

    expect(isAgentOperational({ status: 'draft' })).toBe(false);
    expect(isAgentOperational({ status: 'paused' })).toBe(false);
    expect(isAgentOperational({ status: 'disabled' })).toBe(false);
    expect(isAgentOperational({ status: 'retired' })).toBe(false);
    expect(isAgentOperational({ status: 'active', is_emergency_stopped: true })).toBe(false);
    expect(isAgentOperational({ status: 'active', active: false })).toBe(false);
    expect(isAgentOperational({ status: 'active', retired_at: '2026-11-22T00:00:00.000Z' })).toBe(
      false
    );
    expect(
      isAgentOperational({ status: 'active', active: true, is_emergency_stopped: false })
    ).toBe(true);

    // Service principal validation rejects superadmin, system, password-bearing, inactive partner, multi-company.
    expect((await validateServicePrincipalUser(superadminB.id, compB.id, db)).valid).toBe(false);
    expect((await validateServicePrincipalUser(systemUser.id, compA.id, db)).valid).toBe(false);
    expect((await validateServicePrincipalUser(pwUser.id, compA.id, db)).valid).toBe(false);
    await expect(
      assertAgentServicePrincipal(db, { companyId: compA.id, userId: superadminB.id })
    ).rejects.toThrow(/role "user" only/iu);
    expect((await validateServicePrincipalUser(inactivePartnerUser.id, compA.id, db)).valid).toBe(
      false
    );
    expect((await validateServicePrincipalUser(multiCompanyUser.id, compA.id, db)).valid).toBe(
      false
    );
    expect((await validateServicePrincipalUser(svcUserA.id, compB.id, db)).valid).toBe(false);
    expect((await validateServicePrincipalUser(svcUserA.id, compA.id, db)).valid).toBe(true);

    const deptA = await OrganizationDepartment.query().insertAndFetch({
      company_id: compA.id,
      code: 'ai_eng',
      name: 'AI Engineering',
    });
    const otherDeptA = await OrganizationDepartment.query().insertAndFetch({
      company_id: compA.id,
      code: 'ai_ops',
      name: 'AI Operations',
    });
    const teamA = await OrganizationTeam.query().insertAndFetch({
      company_id: compA.id,
      department_id: deptA.id,
      code: 'core_ai',
      name: 'Core AI',
    });
    const posA = await OrganizationPosition.query().insertAndFetch({
      company_id: compA.id,
      department_id: deptA.id,
      code: 'lead_researcher',
      name: 'Lead Researcher',
    });
    const orgMemberA = await OrganizationMembership.query().insertAndFetch({
      company_id: compA.id,
      user_id: svcUserA.id,
      department_id: deptA.id,
      team_id: teamA.id,
      position_id: posA.id,
      start_date: '2026-01-01',
    });

    expect(
      await isValidAiMutation(Agent.modelName, {
        company_id: compA.id,
        code: 'lead_agent_a',
        status: 'active',
        service_user_id: svcUserA.id,
        department_id: deptA.id,
        team_id: teamA.id,
        position_id: posA.id,
        organization_membership_id: orgMemberA.id,
      })
    ).toBe(true);

    // Mismatched department/team rejected.
    expect(
      await isValidAiMutation(Agent.modelName, {
        company_id: compA.id,
        code: 'bad_dept_team',
        department_id: otherDeptA.id,
        team_id: teamA.id,
      })
    ).toBe(false);

    const leadAgent = await Agent.query().insertAndFetch({
      company_id: compA.id,
      code: 'lead_agent_a',
      status: 'active',
      service_user_id: svcUserA.id,
      department_id: deptA.id,
      team_id: teamA.id,
      position_id: posA.id,
      organization_membership_id: orgMemberA.id,
      role_template: 'manager',
    });

    // Lookup by service user ID & prevent duplicate binding.
    const found = await findAgentByServiceUserId(db, svcUserA.id);
    expect(found?.id).toBe(leadAgent.id);
    expect((await validateServicePrincipalUser(svcUserA.id, compA.id, db)).valid).toBe(false);
    expect(
      (await validateServicePrincipalUser(svcUserA.id, compA.id, db, leadAgent.id)).valid
    ).toBe(true);

    // Acyclic reporting hierarchy check.
    const subAgent = await Agent.query().insertAndFetch({
      company_id: compA.id,
      code: 'sub_agent_a',
      status: 'active',
      reports_to_agent_id: leadAgent.id,
      role_template: 'researcher',
    });
    expect(await assertAcyclicAgentHierarchy(leadAgent.id, subAgent.id, compA.id)).toBe(false);
    expect(
      await isValidAiMutation(
        Agent.modelName,
        { reports_to_agent_id: subAgent.id },
        leadAgent.toJSON()
      )
    ).toBe(false);
  });

  it('rejects raw secrets, enforces provider endpoints/classification routing, and validates capability grants', async () => {
    const db = await setupFullAddons();
    const { company, user } = await createCompanyWithUser('Security Co', 'sec_op');
    const stack = await createCoreAiStack(company.id, user.id, 'sec');

    // Raw API key rejected by JSON schema and validation helper.
    const rawSecret = ['sk', 'live', 'rawsecret', '9999'].join('-');
    expect(() => assertValidProviderSecretRef(rawSecret)).toThrow(/MW_AI_\*/u);
    expect(() => assertValidProviderSecretRef('MW_AI_C1_OPENAI_KEY')).not.toThrow();
    await expect(
      ProviderProfile.query().insertAndFetch({
        company_id: company.id,
        code: 'bad_secret_provider',
        name: 'Unsafe Provider',
        kind: 'openai',
        secret_ref: rawSecret,
        data_classification: 'cloud_eligible',
      })
    ).rejects.toThrow(/pattern|secret_ref/iu);

    // Endpoint & classification checks.
    expect(isValidProviderEndpoint('ollama', 'http://127.0.0.1:11434')).toBe(true);
    expect(isValidProviderEndpoint('ollama', 'http://localhost:11434')).toBe(true);
    expect(isValidProviderEndpoint('ollama', 'https://remote.example.com:11434')).toBe(false);
    expect(isValidProviderEndpoint('openai', 'https://api.openai.com/v1')).toBe(true);
    expect(isValidProviderEndpoint('openai', 'http://api.openai.com/v1')).toBe(false);
    expect(isValidProviderEndpoint('openai', 'https://169.254.169.254/latest')).toBe(false);
    expect(isValidProviderEndpoint('anthropic', 'https://user:pass@api.anthropic.com')).toBe(false);

    expect(isAllowedClassificationRoute('local_only', 'ollama', 'local_only', true)).toBe(true);
    expect(isAllowedClassificationRoute('local_only', 'openai', 'cloud_eligible', true)).toBe(
      false
    );
    expect(isAllowedClassificationRoute('restricted', 'ollama', 'local_only', true)).toBe(false);
    expect(isAllowedClassificationRoute('restricted', 'ollama', 'restricted', false)).toBe(true);
    expect(isAllowedClassificationRoute('restricted', 'anthropic', 'cloud_eligible', true)).toBe(
      false
    );
    expect(isAllowedClassificationRoute('cloud_eligible', 'openai', 'cloud_eligible', false)).toBe(
      true
    );

    // Capability naming & grant lifecycle.
    expect(() => assertSafeCapabilityIdentifier('repo.read@v1')).not.toThrow();
    expect(() => assertSafeCapabilityIdentifier('repo.*')).toThrow();
    expect(() => assertSafeCapabilityIdentifier('repo.read@v0')).toThrow();

    const activeTime = new Date('2026-12-01T00:00:00.000Z');
    const expiredTime = new Date('2026-12-25T00:00:00.000Z');
    expect(
      isActiveCapabilityGrant(stack.grant, {
        companyId: company.id,
        agentId: stack.agent.id,
        workContractId: stack.contract.id,
        capability: 'repo.read@v1',
        expectedPolicyVersion: 1,
        now: activeTime,
      })
    ).toBe(true);
    expect(
      isActiveCapabilityGrant(stack.grant, {
        companyId: company.id,
        agentId: stack.agent.id,
        workContractId: stack.contract.id,
        capability: 'repo.read@v1',
        expectedPolicyVersion: 2,
        now: activeTime,
      })
    ).toBe(false);
    expect(
      isActiveCapabilityGrant(stack.grant, {
        companyId: company.id,
        agentId: stack.agent.id,
        workContractId: stack.contract.id,
        capability: 'repo.read@v1',
        expectedPolicyVersion: 1,
        now: expiredTime,
      })
    ).toBe(false);

    // Revoking grant invalidates immediately.
    const revokedGrant = await CapabilityGrant.query().patchAndFetchById(stack.grant.id, {
      status: 'revoked',
      revoked_at: '2026-11-23T00:00:00.000Z',
      revoked_by_id: user.id,
      revocation_reason: 'Operator revoked mid-flight',
    });
    expect(
      isActiveCapabilityGrant(revokedGrant, {
        companyId: company.id,
        agentId: stack.agent.id,
        workContractId: stack.contract.id,
        capability: 'repo.read@v1',
        expectedPolicyVersion: 1,
        now: activeTime,
      })
    ).toBe(false);

    // Invalid grant mutations (mismatched policy_version or expires_at <= issued_at).
    expect(
      await isValidAiMutation(CapabilityGrant.modelName, {
        company_id: company.id,
        agent_id: stack.agent.id,
        execution_policy_id: stack.policy.id,
        capability: 'repo.read@v1',
        policy_version: 99,
        issued_by_id: user.id,
        issued_at: stack.issuedAt,
        expires_at: stack.expiresAt,
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(CapabilityGrant.modelName, {
        company_id: company.id,
        agent_id: stack.agent.id,
        execution_policy_id: stack.policy.id,
        capability: 'repo.read@v1',
        policy_version: 1,
        issued_by_id: user.id,
        issued_at: stack.expiresAt,
        expires_at: stack.issuedAt,
      })
    ).toBe(false);
    expect(db).toBeDefined();
  });

  it('correlates AgentRun with @moonwitness/jobs and validates PCW evidence, workflow independence, and obligation continuity', async () => {
    const db = await setupFullAddons();
    const { company, user: requester } = await createCompanyWithUser('PCW Co', 'requester_pcw');
    const { user: reviewerUser } = await createCompanyWithUser('PCW Reviewer', 'reviewer_pcw');
    const stack = await createCoreAiStack(company.id, requester.id, 'pcw');

    const storageDir = await mkdtemp(join(tmpdir(), 'mw-orm-ai-storage-'));
    tempDirs.push(storageDir);
    const storage = new LocalFileAttachmentStorage(storageDir);

    // Durable job correlation.
    const job = await Job.query().insertAndFetch({
      company_id: company.id,
      handler: 'ai.agent_run.inspect',
      payload: JSON.stringify({ workContractId: stack.contract.id }),
      idempotency_key: 'ai-job-pcw-1',
      status: 'queued',
      available_at: '2026-11-22T00:00:00.000Z',
    });

    const runPayload = {
      company_id: company.id,
      work_contract_id: stack.contract.id,
      agent_id: stack.agent.id,
      capability_grant_id: stack.grant.id,
      provider_profile_id: stack.provider.id,
      model_profile_id: stack.modelProfile.id,
      execution_policy_id: stack.policy.id,
      job_id: job.id,
      idempotency_key: 'run-idem-1',
      correlation_id: 'corr-pcw-1',
      status: 'completed' as const,
      fencing_token: 3,
      checkpoint_cursor: 'step-3',
      checkpoint_json: JSON.stringify({ step: 3 }),
      step_count: 3,
      input_tokens: 120,
      output_tokens: 45,
      token_source: 'estimated' as const,
      estimated_cost_micros: 0,
    };
    expect(await isValidAiMutation(AgentRun.modelName, runPayload)).toBe(true);
    const run = await AgentRun.query().insertAndFetch(runPayload);
    const serializedRun = run.toJSON() as Record<string, unknown>;
    expect(serializedRun).not.toHaveProperty('idempotency_key');
    expect(serializedRun).not.toHaveProperty('checkpoint_json');

    // Duplicate idempotency_key or duplicate job rejected by unique constraints.
    await expect(
      AgentRun.query().insertAndFetch({
        ...runPayload,
        job_id: null,
        correlation_id: 'corr-dup',
      })
    ).rejects.toThrow(/unique/iu);

    // Cloud provider disallowed for local_only contract even on AgentRun validation.
    const cloudProvider = await ProviderProfile.query().insertAndFetch({
      company_id: company.id,
      code: 'cloud_openai',
      name: 'Cloud OpenAI',
      kind: 'openai',
      secret_ref: 'MW_AI_OPENAI_API_KEY',
      data_classification: 'cloud_eligible',
      enabled: true,
    });
    const cloudModel = await ModelProfile.query().insertAndFetch({
      company_id: company.id,
      provider_profile_id: cloudProvider.id,
      code: 'gpt_model',
      name: 'GPT Model',
      model_id: 'gpt-4o-mini',
      enabled: true,
    });
    expect(
      await isValidAiMutation(AgentRun.modelName, {
        ...runPayload,
        job_id: null,
        idempotency_key: 'run-idem-cloud-blocked',
        provider_profile_id: cloudProvider.id,
        model_profile_id: cloudModel.id,
      })
    ).toBe(false);

    // Acceptance criterion & silent lock guard (AI6.7).
    const criterion = await AcceptanceCriterion.query().insertAndFetch({
      company_id: company.id,
      work_contract_id: stack.contract.id,
      sequence: 1,
      code: 'crit_report_sha',
      title: 'Verified inspection report artifact',
      verification_method: 'automated_test',
      required_evidence_type: 'evidence_bundle',
      mandatory: true,
      version: 1,
      status: 'pending',
    });
    const lockedContract = await WorkContract.query().patchAndFetchById(stack.contract.id, {
      criteria_locked_at: '2026-11-22T01:00:00.000Z',
    });
    expect(lockedContract.criteria_locked_at).toBeTruthy();

    // Updating status without bumping version succeeds; changing title without bumping version fails.
    expect(
      await isValidAiMutation(
        AcceptanceCriterion.modelName,
        { status: 'produced' },
        criterion.toJSON()
      )
    ).toBe(true);
    expect(
      await isValidAiMutation(
        AcceptanceCriterion.modelName,
        { title: 'Silently weakened requirement' },
        criterion.toJSON()
      )
    ).toBe(false);
    expect(
      await isValidAiMutation(
        AcceptanceCriterion.modelName,
        { title: 'Versioned requirement update', version: 2 },
        criterion.toJSON()
      )
    ).toBe(true);

    // ArtifactManifest backed by orm-storage blob & SHA-256 verification.
    const storageKey = randomUUID();
    const contentBytes = Buffer.from(JSON.stringify({ ok: true, lines: [1, 2] }), 'utf8');
    const stored = await storage.put(storageKey, contentBytes);
    const expectedSha = createHash('sha256').update(contentBytes).digest('hex');
    expect(stored.checksum).toBe(expectedSha);
    expect(isValidStorageKey(storageKey)).toBe(true);
    expect(isValidSha256(expectedSha)).toBe(true);

    const artifactPayload = {
      company_id: company.id,
      work_contract_id: stack.contract.id,
      acceptance_criterion_id: criterion.id,
      agent_run_id: run.id,
      producer_agent_id: stack.agent.id,
      artifact_kind: 'evidence_bundle' as const,
      storage_key: storageKey,
      sha256: expectedSha,
      size_bytes: stored.sizeBytes,
      data_classification: 'local_only' as const,
      verification_status: 'produced' as const,
    };
    expect(await isValidAiMutation(ArtifactManifest.modelName, artifactPayload)).toBe(true);
    const artifact = await ArtifactManifest.query().insertAndFetch(artifactPayload);

    // Reject self-review on WorkContract and via orm-workflow requireDifferentActor.
    expect(
      await isValidAiMutation(
        WorkContract.modelName,
        { reviewer_agent_id: stack.agent.id },
        lockedContract.toJSON()
      )
    ).toBe(false);

    const wfInstance = await startWorkflow(db, {
      code: 'ai.work_contract_review',
      companyId: company.id,
      actorId: requester.id,
      role: 'user',
      resourceModel: WorkContract.modelName,
      resourceId: stack.contract.id,
      idempotencyKey: 'wf-ai-start-1',
    });
    const inReview = await transitionWorkflow(db, {
      instanceId: wfInstance.id,
      companyId: company.id,
      actorId: requester.id,
      role: 'user',
      action: 'submit_for_review',
      expectedRevision: 0,
      idempotencyKey: 'wf-ai-submit-1',
    });
    expect(inReview.currentState).toBe('in_review');

    await expect(
      transitionWorkflow(db, {
        instanceId: wfInstance.id,
        companyId: company.id,
        actorId: requester.id,
        role: 'user',
        action: 'accept',
        expectedRevision: 1,
        idempotencyKey: 'wf-ai-self-accept',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const accepted = await transitionWorkflow(db, {
      instanceId: wfInstance.id,
      companyId: company.id,
      actorId: reviewerUser.id,
      role: 'user',
      action: 'accept',
      expectedRevision: 1,
      idempotencyKey: 'wf-ai-indep-accept',
    });
    expect(accepted.currentState).toBe('accepted');

    // Obligation continuity: cannot delete contract with open obligation, superseding requires rationale.
    const obligation = await Obligation.query().insertAndFetch({
      company_id: company.id,
      code: 'ob_keep_verified',
      origin_contract_id: stack.contract.id,
      origin_artifact_id: artifact.id,
      owner_agent_id: stack.reviewer.id,
      owner_user_id: reviewerUser.id,
      scope_json: JSON.stringify({ paths: ['packages/orm-ai/src'] }),
      trigger_kind: 'code_change',
      impact_links_json: JSON.stringify(['packages/orm-ai/src/models.ts']),
      required_evidence: 'Re-run unit & conformance suite',
      status: 'open',
    });
    await expect(WorkContract.query().deleteById(stack.contract.id)).rejects.toThrow(
      /FOREIGN KEY/iu
    );
    expect(
      await isValidAiMutation(Obligation.modelName, { status: 'superseded' }, obligation.toJSON())
    ).toBe(false);
    expect(
      await isValidAiMutation(
        Obligation.modelName,
        { status: 'superseded', decision_rationale: 'Superseded by v2 contract evidence' },
        obligation.toJSON()
      )
    ).toBe(true);
  });

  it('supports Phase AI7 Taskforce/WorkforceAssignment and Phase AI8 Memory/Skill candidate lifecycle', async () => {
    const db = await setupFullAddons();
    const { company, user } = await createCompanyWithUser('Workforce & Memory Co', 'wf_mem_op');
    const stack = await createCoreAiStack(company.id, user.id, 'wm');

    // Taskforce & WorkforceAssignment.
    const taskforce = await Taskforce.query().insertAndFetch({
      company_id: company.id,
      code: 'tf_audit_01',
      name: 'Bounded Audit Taskforce',
      purpose: 'Parallel read-only analysis of packages',
      scope_json: JSON.stringify({ targets: ['packages/orm-ai', 'packages/ai-runtime'] }),
      status: 'active',
      lead_agent_id: stack.reviewer.id,
      work_contract_id: stack.contract.id,
      execution_policy_id: stack.policy.id,
      max_agents: 3,
      budget_micros: 100000,
      expires_at: '2026-12-31T00:00:00.000Z',
      created_by_id: user.id,
    });
    const assignmentPayload = {
      company_id: company.id,
      taskforce_id: taskforce.id,
      agent_id: stack.agent.id,
      work_contract_id: stack.contract.id,
      role_template: 'researcher' as const,
      status: 'active' as const,
      workspace_scope: 'packages/orm-ai',
      write_mode: 'read_only' as const,
      budget_micros: 50000,
      assigned_by_id: user.id,
      assigned_at: '2026-11-22T00:00:00.000Z',
      expires_at: '2026-12-01T00:00:00.000Z',
    };
    expect(await isValidAiMutation(WorkforceAssignment.modelName, assignmentPayload)).toBe(true);
    const assignment = await WorkforceAssignment.query().insertAndFetch(assignmentPayload);
    expect(assignment.write_mode).toBe('read_only');

    expect(
      await isValidAiMutation(WorkforceAssignment.modelName, {
        ...assignmentPayload,
        expires_at: '2026-11-20T00:00:00.000Z',
      })
    ).toBe(false);

    // MemoryCandidate & SkillVersion lifecycle.
    const run = await AgentRun.query().insertAndFetch({
      company_id: company.id,
      work_contract_id: stack.contract.id,
      agent_id: stack.agent.id,
      capability_grant_id: stack.grant.id,
      provider_profile_id: stack.provider.id,
      model_profile_id: stack.modelProfile.id,
      execution_policy_id: stack.policy.id,
      idempotency_key: 'run-mem-1',
      correlation_id: 'corr-mem-1',
      status: 'completed',
    });

    const skillCandidate = await SkillVersion.query().insertAndFetch({
      company_id: company.id,
      code: 'sop.inspect_addon',
      version: 1,
      title: 'Inspect Addon Manifests',
      sop_body: 'Check manifest.models, views, menus, and _orm_data prefixes.',
      allowed_capabilities_json: '["repo.read@v1"]',
      source_run_id: run.id,
      status: 'candidate',
      eval_score_bps: 9200,
    });
    const memCandidate = await MemoryCandidate.query().insertAndFetch({
      company_id: company.id,
      memory_kind: 'episodic',
      scope_kind: 'project',
      scope_ref: 'packages/orm-ai',
      title: 'Avoid cyclic model serialization',
      content: 'Use lazy modelRef thunks on belongsTo targets.',
      source_ref: `run:${run.id}`,
      confidence_bps: 8500,
      data_classification: 'local_only',
      work_contract_id: stack.contract.id,
      source_run_id: run.id,
      source_agent_id: stack.agent.id,
      promoted_skill_id: skillCandidate.id,
      status: 'candidate',
      expires_at: '2026-12-31T00:00:00.000Z',
    });

    const checkNow = new Date('2026-11-25T00:00:00.000Z');
    // Candidates are never consumable before approval.
    expect(isUsableApprovedSkill(skillCandidate, { companyId: company.id, now: checkNow })).toBe(
      false
    );
    expect(isUsableApprovedMemory(memCandidate, { companyId: company.id, now: checkNow })).toBe(
      false
    );

    const approvedSkill = await SkillVersion.query().patchAndFetchById(skillCandidate.id, {
      status: 'approved',
      approved_by_id: user.id,
      approved_at: '2026-11-23T00:00:00.000Z',
    });
    const approvedMem = await MemoryCandidate.query().patchAndFetchById(memCandidate.id, {
      status: 'approved',
      reviewed_by_id: user.id,
      reviewed_at: '2026-11-23T00:00:00.000Z',
    });
    expect(isUsableApprovedSkill(approvedSkill, { companyId: company.id, now: checkNow })).toBe(
      true
    );
    expect(
      isUsableApprovedMemory(approvedMem, {
        companyId: company.id,
        allowedClassifications: ['local_only'],
        now: checkNow,
      })
    ).toBe(true);
    // Classification boundary respected.
    expect(
      isUsableApprovedMemory(approvedMem, {
        companyId: company.id,
        allowedClassifications: ['cloud_eligible'],
        now: checkNow,
      })
    ).toBe(false);

    // Revocation immediately excludes consumption.
    const revokedSkill = await SkillVersion.query().patchAndFetchById(approvedSkill.id, {
      status: 'revoked',
      revoked_by_id: user.id,
      revoked_at: '2026-11-24T00:00:00.000Z',
      revocation_reason: 'Superseded by safer procedure',
    });
    const revokedMem = await MemoryCandidate.query().patchAndFetchById(approvedMem.id, {
      status: 'revoked',
      revoked_by_id: user.id,
      revoked_at: '2026-11-24T00:00:00.000Z',
      revocation_reason: 'Stale guidance',
    });
    expect(isUsableApprovedSkill(revokedSkill, { companyId: company.id, now: checkNow })).toBe(
      false
    );
    expect(isUsableApprovedMemory(revokedMem, { companyId: company.id, now: checkNow })).toBe(
      false
    );

    // Validation bounds on MemoryCandidate & SkillVersion.
    expect(
      await isValidAiMutation(SkillVersion.modelName, {
        company_id: company.id,
        code: 'bad_skill',
        title: 'Bad',
        sop_body: 'body',
        eval_score_bps: 10001,
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(MemoryCandidate.modelName, {
        company_id: company.id,
        memory_kind: 'semantic',
        scope_ref: 'repo',
        title: 'Bad confidence',
        content: 'text',
        source_ref: 'run:1',
        confidence_bps: 15000,
      })
    ).toBe(false);
    expect(db).toBeDefined();
  });

  it('enforces strict company isolation, immutable ownership, sensitive/hidden fields, and least-privilege ModelAccess metadata', async () => {
    const db = await setupFullAddons();
    const { company: compA, user: userA } = await createCompanyWithUser('Tenant One', 'op_one');
    const { company: compB, user: userB } = await createCompanyWithUser('Tenant Two', 'op_two');
    const stackA = await createCoreAiStack(compA.id, userA.id, 'iso_a');
    const stackB = await createCoreAiStack(compB.id, userB.id, 'iso_b');

    // Cross-company references rejected across all models.
    expect(
      await isValidAiMutation(AgentProfile.modelName, {
        company_id: compA.id,
        agent_id: stackB.agent.id,
        name: 'Cross-company steal',
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(WorkContract.modelName, {
        company_id: compA.id,
        code: 'cross_contract',
        title: 'Cross',
        objective: 'Cross',
        execution_policy_id: stackA.policy.id,
        requested_by_id: userA.id,
        assigned_agent_id: stackB.agent.id,
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(AgentRun.modelName, {
        company_id: compA.id,
        work_contract_id: stackA.contract.id,
        agent_id: stackA.agent.id,
        capability_grant_id: stackA.grant.id,
        provider_profile_id: stackB.provider.id,
        model_profile_id: stackB.modelProfile.id,
        execution_policy_id: stackA.policy.id,
        idempotency_key: 'cross-run',
        correlation_id: 'corr-cross',
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(Agent.modelName, { company_id: compB.id }, stackA.agent.toJSON())
    ).toBe(false);
    expect(
      await isValidAiMutation(
        WorkContract.modelName,
        { company_id: compB.id },
        stackA.contract.toJSON()
      )
    ).toBe(false);
    expect(
      await isValidAiMutation(Taskforce.modelName, {
        company_id: compA.id,
        name: 'Cross TF',
        lead_agent_id: stackB.agent.id,
      })
    ).toBe(false);

    // Verify default-off feature flag ai.corporation_enabled.
    const flag = await IrFeatureFlag.query()
      .findOne({ key: 'ai.corporation_enabled' })
      .throwIfNotFound();
    expect(flag.enabled).toBe(false);
    expect(await isFeatureFlagEnabled(db, 'ai.corporation_enabled')).toBe(false);

    // Verify ModelAccess metadata for group_user (deny all), ai_operator (no unlink), ai_reviewer (read-only).
    const groupUser = await AccessGroup.query().findOne({ code: 'user' }).throwIfNotFound();
    const groupOperator = await AccessGroup.query()
      .findOne({ code: 'ai_operator' })
      .throwIfNotFound();
    const groupReviewer = await AccessGroup.query()
      .findOne({ code: 'ai_reviewer' })
      .throwIfNotFound();

    const userAccessRows = await ModelAccess.query()
      .where({ group_id: groupUser.id })
      .where('model_name', 'like', 'ai.%');
    expect(userAccessRows).toHaveLength(19);
    for (const row of userAccessRows) {
      expect(row.read).toBe(false);
      expect(row.create).toBe(false);
      expect(row.write).toBe(false);
      expect(row.unlink).toBe(false);
    }

    const reviewerAccessRows = await ModelAccess.query()
      .where({ group_id: groupReviewer.id })
      .where('model_name', 'like', 'ai.%');
    expect(reviewerAccessRows).toHaveLength(19);
    for (const row of reviewerAccessRows) {
      expect(row.read).toBe(true);
      expect(row.create).toBe(false);
      expect(row.write).toBe(false);
      expect(row.unlink).toBe(false);
    }

    const operatorAccessRows = await ModelAccess.query()
      .where({ group_id: groupOperator.id })
      .where('model_name', 'like', 'ai.%');
    expect(operatorAccessRows).toHaveLength(19);
    for (const row of operatorAccessRows) {
      expect(row.read).toBe(true);
      expect(row.unlink).toBe(false);
      if (
        row.model_name === 'ai.agent_run' ||
        row.model_name === 'ai.interactive_session' ||
        row.model_name === 'ai.interactive_session_event' ||
        row.model_name === 'ai.interactive_session_command' ||
        row.model_name === 'ai.interactive_session_approval' ||
        row.model_name === 'ai.artifact_manifest' ||
        row.model_name === 'ai.skill_version' ||
        row.model_name === 'ai.memory_candidate'
      ) {
        expect(row.create).toBe(false);
        expect(row.write).toBe(false);
      } else {
        expect(row.create).toBe(true);
        expect(row.write).toBe(true);
      }
    }

    // Verify work contract hierarchical depth & cycle rejection.
    expect(
      await assertAcyclicWorkContractHierarchy(
        stackA.contract.id,
        stackA.contract.id,
        compA.id,
        2,
        db
      )
    ).toBe(false);
    expect(
      await isValidAiMutation(WorkContract.modelName, {
        company_id: compA.id,
        code: 'child_bad_depth',
        title: 'Child Bad Depth',
        objective: 'Test depth validation',
        execution_policy_id: stackA.policy.id,
        requested_by_id: userA.id,
        parent_contract_id: stackA.contract.id,
        delegation_depth: 0,
      })
    ).toBe(false);
    expect(
      await isValidAiMutation(WorkContract.modelName, {
        company_id: compA.id,
        code: 'child_ok_depth',
        title: 'Child OK Depth',
        objective: 'Test depth validation',
        execution_policy_id: stackA.policy.id,
        requested_by_id: userA.id,
        parent_contract_id: stackA.contract.id,
        delegation_depth: 1,
      })
    ).toBe(true);
  });
});
