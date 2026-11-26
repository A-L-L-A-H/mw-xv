import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Environment, Registry } from '@moonwitness/orm';
import { Company, CompanyMembership, Partner, User } from '@moonwitness/orm-base';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import { buildApp } from '../src/app.js';
import { getApiAddonManifests } from '../src/addons/registry.js';
import {
  INTERNAL_PREFIXES,
  canAccess,
  canAccessField,
  canExecuteAction,
  canManageBaseUser,
  getModelAccessPolicy,
  operationFor,
  registerModelAccessPolicy,
  rpcOperation,
  sanitizeClientContext,
  type GroupModelGrant,
  type Operation,
} from '../src/auth/policy.js';
import { clearRecordRules, getRecordRuleDomain, registerRecordRule } from '../src/auth/rules.js';
import type { AuthContext } from '../src/plugins/auth.plugin.js';

const ADMIN_PASSWORD = 'admin-rbac-matrix-password';
const MEMBER_PASSWORD = 'member-rbac-matrix-password';
const SYSTEM_PASSWORD = 'system-rbac-matrix-password';
const TEST_JWT_SECRET = 'rbac-matrix-test-secret-key-minimum-32-chars';

const ADMIN_ONLY_MODEL_NAMES = new Set([
  'base.user',
  'base.audit_log',
  'base.access_group',
  'base.group_membership',
  'base.model_access',
  'base.company_membership',
  'base.partner_bank',
]);

const PUBLIC_READ_MODEL_NAMES = new Set([
  'base.country',
  'base.currency',
  'base.language',
  'base.tag',
]);

const ALL_OPERATIONS: readonly Operation[] = ['read', 'create', 'write', 'unlink', 'action'];

/**
 * Role mapping for the 3 canonical authorization roles:
 * - `system` -> runtime role `'system'`
 * - `admin`  -> runtime role `'superadmin'`
 * - `member` -> runtime role `'user'`
 */
const ROLE_MATRIX = [
  { label: 'system', runtimeRole: 'system' },
  { label: 'admin', runtimeRole: 'superadmin' },
  { label: 'member', runtimeRole: 'user' },
] as const;

interface LoginResponseBody {
  success: boolean;
  data: {
    access_token: string;
    refresh_token: string;
    user: { id: number; login: string; role: string };
  };
}

describe('MW-QA-003: Full Model × 3 Role Authorization Matrix', () => {
  let db: Knex;
  let app: FastifyInstance;
  let systemToken: string;
  let adminToken: string;
  let memberToken: string;
  let defaultCompanyId: number;
  let foreignCompanyId: number;
  let memberUserId: number;
  let memberPartnerId: number;

  const attachmentStorage: AttachmentStorage = {
    async put(key, content) {
      return { key, sizeBytes: content.byteLength, checksum: '0'.repeat(64) };
    },
    async get() {
      return null;
    },
    async delete() {},
    async *list() {},
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    app = await buildApp({
      db,
      superadminPassword: ADMIN_PASSWORD,
      jwtSecret: TEST_JWT_SECRET,
      loginRateMax: 1000,
      attachmentStorage,
    });
    await app.ready();

    const defaultCompany = await Company.query().findOne({ name: 'MoonWitness' }).throwIfNotFound();
    defaultCompanyId = defaultCompany.id;

    const foreignCompany = await Company.query().insertAndFetch({
      name: 'Foreign Isolated Corp',
    });
    foreignCompanyId = foreignCompany.id;

    const memberPartner = await Partner.query().insertAndFetch({
      name: 'Matrix Member Partner',
      company_id: defaultCompanyId,
    });
    memberPartnerId = memberPartner.id;

    const memberUser = await User.query().insertAndFetch({
      login: 'matrix_member',
      password: MEMBER_PASSWORD,
      partner_id: memberPartnerId,
      role: 'user',
    });
    memberUserId = memberUser.id;

    await CompanyMembership.query().insert({
      user_id: memberUserId,
      company_id: defaultCompanyId,
      is_default: true,
    });

    const systemUser = await User.query().findOne({ login: 'system' }).throwIfNotFound();
    await User.query().findById(systemUser.id).patch({ password: SYSTEM_PASSWORD });

    const loginAs = async (login: string, password: string): Promise<string> => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { login, password },
      });
      expect(response.statusCode).toBe(200);
      return response.json<LoginResponseBody>().data.access_token;
    };

    systemToken = await loginAs('system', SYSTEM_PASSWORD);
    adminToken = await loginAs('superadmin', ADMIN_PASSWORD);
    memberToken = await loginAs('matrix_member', MEMBER_PASSWORD);
  }, 30000);

  afterAll(async () => {
    clearRecordRules();
    await app.close();
  });

  it('registers all 88+ workspace addon models in Registry without orphan models', () => {
    const manifests = getApiAddonManifests();
    const manifestModelNames = manifests.flatMap((m) => m.models.map((model) => model.modelName));
    const registeredNames = Registry.getNames();

    expect(registeredNames.length).toBeGreaterThanOrEqual(88);
    expect(new Set(registeredNames).size).toBe(registeredNames.length);
    for (const modelName of manifestModelNames) {
      expect(Registry.has(modelName)).toBe(true);
    }
  });

  it('evaluates the complete 88+ Model × 3 Role (system, admin, member) × 5 Operation authorization matrix', () => {
    const modelNames = Registry.getNames().sort();
    expect(modelNames.length).toBeGreaterThanOrEqual(88);

    for (const modelName of modelNames) {
      const isInternal =
        INTERNAL_PREFIXES.some((prefix) => modelName.startsWith(prefix)) ||
        getModelAccessPolicy(modelName) === 'internal';
      const isWhatsApp = modelName.startsWith('whatsapp.');
      const isAuditLog = modelName === 'base.audit_log';
      const isAdminOnly = ADMIN_ONLY_MODEL_NAMES.has(modelName);

      for (const { runtimeRole } of ROLE_MATRIX) {
        for (const op of ALL_OPERATIONS) {
          const allowedWithoutGrant = canAccess(runtimeRole, modelName, op, []);

          if (isInternal) {
            // Fail-closed internal models (auth.*, base.job*, base.cron, base.outbox_event, workflow.*, knowledge.*, ai.*)
            expect(allowedWithoutGrant, `${runtimeRole} ${op} on internal ${modelName}`).toBe(
              false
            );
            expect(getModelAccessPolicy(modelName)).toBe('internal');
            continue;
          }

          if (isWhatsApp) {
            // WhatsApp models are read-only on generic API; mutations must use dedicated company routes
            expect(allowedWithoutGrant, `${runtimeRole} ${op} on whatsapp ${modelName}`).toBe(
              op === 'read'
            );
            continue;
          }

          if (isAuditLog) {
            // Audit log is append-only and read-only for system/admin roles only
            const expectedAudit =
              (runtimeRole === 'system' || runtimeRole === 'superadmin') && op === 'read';
            expect(allowedWithoutGrant, `${runtimeRole} ${op} on ${modelName}`).toBe(expectedAudit);
            continue;
          }

          if (runtimeRole === 'system' || runtimeRole === 'superadmin') {
            expect(allowedWithoutGrant, `${runtimeRole} ${op} on ${modelName}`).toBe(true);
            continue;
          }

          // Member (`user` role) evaluation
          if (isAdminOnly) {
            expect(allowedWithoutGrant, `member ${op} on adminOnly ${modelName}`).toBe(false);
            // Even with a forged group grant, adminOnly models remain blocked for member role
            const forgedGrant: GroupModelGrant[] = [
              { model_name: modelName, read: true, create: true, write: true, unlink: true },
            ];
            expect(
              canAccess(runtimeRole, modelName, op, forgedGrant),
              `member ${op} with grant on adminOnly ${modelName}`
            ).toBe(false);
          } else if (op === 'read') {
            expect(allowedWithoutGrant, `member read on standard ${modelName}`).toBe(true);
          } else {
            // Without explicit group grant, member cannot mutate standard models
            expect(allowedWithoutGrant, `member ${op} without grant on ${modelName}`).toBe(false);

            // With explicit group grant, member can perform the granted operation
            const grantKey = op === 'action' ? 'write' : op;
            const explicitGrant: GroupModelGrant[] = [
              {
                model_name: modelName,
                read: true,
                create: grantKey === 'create',
                write: grantKey === 'write',
                unlink: grantKey === 'unlink',
              },
            ];
            expect(
              canAccess(runtimeRole, modelName, op, explicitGrant),
              `member ${op} with grant on ${modelName}`
            ).toBe(true);
          }
        }
      }
    }
  });

  it('enforces fail-closed internal guards for all knowledge.* (18 models) and ai.* (15 models) across REST and JSON-RPC for all 3 roles', async () => {
    const allModels = Registry.getNames();
    const knowledgeModels = allModels.filter((name) => name.startsWith('knowledge.'));
    const aiModels = allModels.filter((name) => name.startsWith('ai.'));

    expect(knowledgeModels.length).toBeGreaterThanOrEqual(18);
    expect(aiModels.length).toBeGreaterThanOrEqual(15);

    const tokens = [
      { role: 'system', token: systemToken },
      { role: 'admin', token: adminToken },
      { role: 'member', token: memberToken },
    ];

    for (const modelName of [...knowledgeModels, ...aiModels]) {
      for (const { role, token } of tokens) {
        const restRead = await app.inject({
          method: 'GET',
          url: `/api/${modelName}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(restRead.statusCode, `REST GET /api/${modelName} as ${role}`).toBe(403);

        const rpcRead = await app.inject({
          method: 'POST',
          url: '/jsonrpc',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'call',
            params: {
              service: 'object',
              method: 'execute_kw',
              args: [modelName, 'search_read', [[]], {}],
            },
          },
        });
        expect(rpcRead.statusCode, `JSON-RPC search_read ${modelName} as ${role}`).toBe(403);
      }
    }
  });

  it('enforces adminOnly model isolation and base.user system-role protection across roles', async () => {
    for (const adminModel of ADMIN_ONLY_MODEL_NAMES) {
      const memberRes = await app.inject({
        method: 'GET',
        url: `/api/${adminModel}`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(memberRes.statusCode, `member GET /api/${adminModel}`).toBe(403);

      const adminRes = await app.inject({
        method: 'GET',
        url: `/api/${adminModel}?limit=5`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(adminRes.statusCode, `admin GET /api/${adminModel}`).toBe(200);
    }

    // base.audit_log is read-only even for system and admin
    for (const token of [systemToken, adminToken, memberToken]) {
      const writeAudit = await app.inject({
        method: 'POST',
        url: '/api/base.audit_log',
        headers: { authorization: `Bearer ${token}` },
        payload: { model: 'base.partner', record_id: 1, operation: 'create' },
      });
      expect(writeAudit.statusCode).toBe(403);
    }

    // System account escalation protection: admin (superadmin) cannot create/modify/unlink system users
    expect(canManageBaseUser('superadmin', 'read', 'system')).toBe(true);
    expect(canManageBaseUser('superadmin', 'create', undefined, 'system')).toBe(false);
    expect(canManageBaseUser('superadmin', 'write', 'system', 'superadmin')).toBe(false);
    expect(canManageBaseUser('superadmin', 'write', 'user', 'system')).toBe(false);
    expect(canManageBaseUser('system', 'create', undefined, 'system')).toBe(true);
    expect(canManageBaseUser('user', 'read', 'user')).toBe(false);

    // Declarative policy override test
    registerModelAccessPolicy('base.tag', 'readOnlyForUsers');
    expect(
      canAccess('user', 'base.tag', 'write', [
        { model_name: 'base.tag', read: true, create: true, write: true, unlink: true },
      ])
    ).toBe(false);
    registerModelAccessPolicy('base.tag', 'standard');
  });

  it('enforces publicRead boundaries vs tenant-scoped record rules across all registered models', async () => {
    const env = new Environment({
      userId: memberUserId,
      role: 'user',
      companyId: defaultCompanyId,
    });
    const fakeMemberReq = {
      auth: {
        userId: memberUserId,
        role: 'user',
        partnerId: memberPartnerId,
        companyId: defaultCompanyId,
        groupPermissions: [],
        groupNames: ['user'],
      },
      env,
    } as unknown as FastifyRequest;

    const fakeAdminReq = {
      auth: {
        userId: 1,
        role: 'superadmin',
        companyId: defaultCompanyId,
        groupPermissions: [],
        groupNames: [],
      },
      env,
    } as unknown as FastifyRequest;

    for (const publicModel of PUBLIC_READ_MODEL_NAMES) {
      const domain = await getRecordRuleDomain(fakeMemberReq, publicModel);
      expect(domain, `publicRead model ${publicModel} has empty record rule domain`).toEqual([]);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/${publicModel}?limit=5`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(getRes.statusCode).toBe(200);

      // Member still cannot create/update/unlink publicRead models without grant
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/${publicModel}`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { name: 'Unauthorized Public Write' },
      });
      expect(postRes.statusCode).toBe(403);
    }

    // Verify record rules for every non-public model in Registry
    for (const modelName of Registry.getNames()) {
      if (PUBLIC_READ_MODEL_NAMES.has(modelName)) continue;
      const memberDomain = await getRecordRuleDomain(fakeMemberReq, modelName);
      expect(
        memberDomain.length,
        `non-public model ${modelName} must enforce non-empty record rule for member`
      ).toBeGreaterThan(0);

      const adminDomain = await getRecordRuleDomain(fakeAdminReq, modelName);
      if (modelName.startsWith('whatsapp.')) {
        expect(adminDomain).toEqual([['company_id', '=', defaultCompanyId]]);
      } else {
        expect(adminDomain).toEqual([]);
      }
    }

    // Custom record rule registration is additive with company_id isolation
    registerRecordRule('request.purchase', (ctx) => [['create_uid', '=', ctx.userId]]);
    const customDomain = await getRecordRuleDomain(fakeMemberReq, 'request.purchase');
    expect(customDomain).toEqual([
      ['company_id', '=', defaultCompanyId],
      ['create_uid', '=', memberUserId],
    ]);
    clearRecordRules();
  });

  it('enforces field-level ACLs (readGroups, writeGroups, groups) and context sanitization across roles', () => {
    const restrictedField = {
      readGroups: ['finance_auditor'],
      writeGroups: ['finance_Controller'],
    };
    const generalGroupField = {
      groups: ['hr_officer'],
    };

    const systemAuth: Pick<AuthContext, 'role' | 'groupNames'> = {
      role: 'system',
      groupNames: [],
    };
    const adminAuth: Pick<AuthContext, 'role' | 'groupNames'> = {
      role: 'superadmin',
      groupNames: [],
    };
    const regularMemberAuth: Pick<AuthContext, 'role' | 'groupNames'> = {
      role: 'user',
      groupNames: ['user'],
    };
    const auditorMemberAuth: Pick<AuthContext, 'role' | 'groupNames'> = {
      role: 'user',
      groupNames: ['user', 'finance_auditor'],
    };

    // System and Admin bypass field ACLs
    expect(canAccessField(systemAuth, restrictedField, 'read')).toBe(true);
    expect(canAccessField(systemAuth, restrictedField, 'write')).toBe(true);
    expect(canAccessField(adminAuth, restrictedField, 'read')).toBe(true);
    expect(canAccessField(adminAuth, restrictedField, 'write')).toBe(true);

    // Unauthenticated or unprivileged member denied
    expect(canAccessField(null, restrictedField, 'read')).toBe(false);
    expect(canAccessField(regularMemberAuth, restrictedField, 'read')).toBe(false);
    expect(canAccessField(regularMemberAuth, restrictedField, 'write')).toBe(false);
    expect(canAccessField(regularMemberAuth, generalGroupField, 'read')).toBe(false);

    // Auditor member has read access but not write access
    expect(canAccessField(auditorMemberAuth, restrictedField, 'read')).toBe(true);
    expect(canAccessField(auditorMemberAuth, restrictedField, 'write')).toBe(false);

    // Client context sanitization strips activeTest/trx/security spoofing and injects verified auth context
    const spoofedContext = {
      default_name: 'Safe Default',
      lang: 'id-ID',
      tz: 'Asia/Jakarta',
      userId: 99999,
      role: 'system',
      companyId: 88888,
      activeTest: false,
      active_test: false,
      trx: { hacked: true },
    };
    const sanitized = sanitizeClientContext(spoofedContext, {
      userId: memberUserId,
      role: 'user',
      partnerId: memberPartnerId,
      companyId: defaultCompanyId,
      groupPermissions: [],
    });

    expect(sanitized).toEqual({
      default_name: 'Safe Default',
      lang: 'id-ID',
      tz: 'Asia/Jakarta',
      userId: memberUserId,
      role: 'user',
      partnerId: memberPartnerId,
      companyId: defaultCompanyId,
    });
    expect(sanitized.activeTest).toBeUndefined();
    expect(sanitized.active_test).toBeUndefined();
    expect(sanitized.trx).toBeUndefined();
  });

  it('enforces action-level ACLs and maps HTTP / JSON-RPC methods to canonical operations', async () => {
    expect(operationFor('GET', '/api/:model')).toBe('read');
    expect(operationFor('POST', '/api/:model/default-get')).toBe('read');
    expect(operationFor('POST', '/api/:model/onchange')).toBe('read');
    expect(operationFor('POST', '/api/:model')).toBe('create');
    expect(operationFor('PATCH', '/api/:model/:id')).toBe('write');
    expect(operationFor('DELETE', '/api/:model/:id')).toBe('unlink');
    expect(operationFor('POST', '/api/:model/:id/action/:method')).toBe('action');
    expect(operationFor('POST', '/api/:model/action/:actionName')).toBe('action');

    expect(rpcOperation('search_read')).toBe('read');
    expect(rpcOperation('default_get')).toBe('read');
    expect(rpcOperation('onchange')).toBe('read');
    expect(rpcOperation('create')).toBe('create');
    expect(rpcOperation('write')).toBe('write');
    expect(rpcOperation('unlink')).toBe('unlink');
    expect(rpcOperation('call_action')).toBe('action');
    expect(rpcOperation('arbitrary_private_method')).toBeNull();

    const memberNoWrite: Pick<AuthContext, 'role' | 'groupPermissions' | 'groupNames'> = {
      role: 'user',
      groupPermissions: [],
      groupNames: ['user'],
    };
    const memberWithWriteNoGroup: Pick<AuthContext, 'role' | 'groupPermissions' | 'groupNames'> = {
      role: 'user',
      groupPermissions: [
        {
          model_name: 'request.purchase',
          read: true,
          create: false,
          write: true,
          unlink: false,
        },
      ],
      groupNames: ['user'],
    };
    const memberWithWriteAndGroup: Pick<AuthContext, 'role' | 'groupPermissions' | 'groupNames'> = {
      role: 'user',
      groupPermissions: [
        {
          model_name: 'request.purchase',
          read: true,
          create: false,
          write: true,
          unlink: false,
        },
      ],
      groupNames: ['user', 'procurement_approver'],
    };

    const approvalAction = {
      id: 'request.approve',
      name: 'Approve Request',
      allowedGroups: ['procurement_approver'],
      requiredPermission: 'action' as const,
    };

    expect(canExecuteAction(memberNoWrite, 'request.purchase', approvalAction)).toBe(false);
    expect(canExecuteAction(memberWithWriteNoGroup, 'request.purchase', approvalAction)).toBe(
      false
    );
    expect(canExecuteAction(memberWithWriteAndGroup, 'request.purchase', approvalAction)).toBe(
      true
    );
    // Internal models never allow action execution even for system
    expect(
      canExecuteAction(
        { role: 'system', groupPermissions: [], groupNames: [] },
        'knowledge.story_version',
        approvalAction
      )
    ).toBe(false);

    // Live HTTP action endpoint rejects member without action permission (403)
    const actionRes = await app.inject({
      method: 'POST',
      url: '/api/base.partner/action/action_archive',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { ids: [memberPartnerId] },
    });
    expect(actionRes.statusCode).toBe(403);
  });

  it('enforces cross-company isolation (X-Company-Id) across header validation, record rules, and cross-tenant mutations', async () => {
    const foreignPartner = await Partner.query().insertAndFetch({
      name: 'Foreign Secret Partner',
      company_id: foreignCompanyId,
    });

    // 1. Member attempting to select a company they are not a member of via X-Company-Id -> 403
    const unauthorizedHeaderRes = await app.inject({
      method: 'GET',
      url: '/api/base.partner',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-company-id': String(foreignCompanyId),
      },
    });
    expect(unauthorizedHeaderRes.statusCode).toBe(403);
    expect(unauthorizedHeaderRes.json()).toMatchObject({
      success: false,
      error: 'Company access denied',
    });

    // 2. Malformed X-Company-Id header -> 403
    const malformedHeaderRes = await app.inject({
      method: 'GET',
      url: '/api/base.partner',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-company-id': 'not-a-company-id',
      },
    });
    expect(malformedHeaderRes.statusCode).toBe(403);

    // 3. Member reading foreign company record directly -> 404 (filtered out by company record rule)
    const directForeignRead = await app.inject({
      method: 'GET',
      url: `/api/base.partner/${foreignPartner.id}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(directForeignRead.statusCode).toBe(404);
    expect(directForeignRead.payload).not.toContain('Foreign Secret Partner');

    // 4. Even admin with defaultCompanyId active is blocked from creating a record pointing to foreignCompanyId without switching membership
    const crossCompanyCreate = await app.inject({
      method: 'POST',
      url: '/api/base.partner',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-company-id': String(defaultCompanyId),
      },
      payload: {
        name: 'Injected Foreign Partner',
        company_id: foreignCompanyId,
      },
    });
    expect(crossCompanyCreate.statusCode).toBe(403);
  });
});
