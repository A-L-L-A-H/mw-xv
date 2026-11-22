import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import type { FastifyInstance } from 'fastify';
import { Company, CompanyMembership, Partner, User } from '@moonwitness/orm-base';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import { buildApp } from '../src/app.js';
import {
  canAccess,
  canAccessField,
  canExecuteAction,
  registerModelAccessPolicy,
  rpcOperation,
  sanitizeClientContext,
} from '../src/auth/policy.js';
import { ActionRegistry, MenuRegistry } from '../src/addons/action-menu-registry.js';
import {
  getAuthCacheEpoch,
  invalidateAuthCache,
  type AuthContext,
} from '../src/plugins/auth.plugin.js';
import {
  safeAttachmentName,
  validateAttachmentMagicBytes,
} from '../src/storage/attachment-validation.js';
import {
  authenticatedRateLimitKey,
  RATE_LIMIT_POLICIES,
  routeRateLimitConfig,
} from '../src/config/rate-limit-policy.js';
import { errorEnvelope, okEnvelope } from '../src/http/api-envelope.js';

const userAuth: AuthContext = {
  userId: 10,
  role: 'user',
  partnerId: 20,
  companyId: 1,
  groupPermissions: [
    { model_name: 'base.partner', read: true, create: true, write: true, unlink: false },
  ],
  groupNames: ['sales_user'],
};

const adminAuth: AuthContext = {
  userId: 1,
  role: 'superadmin',
  partnerId: 1,
  companyId: 1,
  groupPermissions: [],
  groupNames: [],
};

describe('MW-SEC & MW-ACT & MW-API & MW-BACK & MW-PERF', () => {
  describe('MW-SEC-001 / MW-SEC-003 / MW-SEC-004: Security Policy & ACLs', () => {
    it('enforces fail-closed internal prefixes including knowledge.* and ai.*', () => {
      expect(canAccess('system', 'knowledge.claim', 'read')).toBe(false);
      expect(canAccess('superadmin', 'ai.agent', 'read')).toBe(false);
      expect(canAccess('system', 'auth.session', 'read')).toBe(false);
    });

    it('supports declarative model access policies', () => {
      registerModelAccessPolicy('custom.readonly_model', 'readOnlyForUsers');
      expect(canAccess('user', 'custom.readonly_model', 'read')).toBe(true);
      expect(
        canAccess('user', 'custom.readonly_model', 'write', [
          {
            model_name: 'custom.readonly_model',
            read: true,
            create: true,
            write: true,
            unlink: true,
          },
        ])
      ).toBe(false);
      expect(canAccess('superadmin', 'custom.readonly_model', 'write')).toBe(true);
    });

    it('enforces field-level ACLs for read and write', () => {
      expect(canAccessField(userAuth, { groups: ['sales_user'] }, 'read')).toBe(true);
      expect(canAccessField(userAuth, { groups: ['finance_manager'] }, 'read')).toBe(false);
      expect(
        canAccessField(
          userAuth,
          { readGroups: ['sales_user'], writeGroups: ['finance_manager'] },
          'read'
        )
      ).toBe(true);
      expect(
        canAccessField(
          userAuth,
          { readGroups: ['sales_user'], writeGroups: ['finance_manager'] },
          'write'
        )
      ).toBe(false);
      expect(canAccessField(adminAuth, { groups: ['finance_manager'] }, 'write')).toBe(true);
    });

    it('enforces action-level ACLs separately from generic write', () => {
      expect(
        canExecuteAction(userAuth, 'base.partner', {
          id: 'base.approve',
          allowedGroups: ['sales_user'],
          requiredPermission: 'write',
        })
      ).toBe(true);
      expect(
        canExecuteAction(userAuth, 'base.partner', {
          id: 'base.approve_finance',
          allowedGroups: ['finance_manager'],
          requiredPermission: 'write',
        })
      ).toBe(false);
      expect(
        canExecuteAction(adminAuth, 'base.partner', {
          id: 'base.approve_finance',
          allowedGroups: ['finance_manager'],
          requiredPermission: 'write',
        })
      ).toBe(true);
    });
  });

  describe('MW-SEC-008: Client Context Sanitization', () => {
    it('strips security keys and activeTest while preserving default_* and overwriting from auth', () => {
      const sanitized = sanitizeClientContext(
        {
          default_name: 'Acme',
          lang: 'en_US',
          userId: 999,
          role: 'system',
          companyId: 999,
          activeTest: false,
          trx: { fake: true },
        },
        userAuth
      );
      expect(sanitized.default_name).toBe('Acme');
      expect(sanitized.lang).toBe('en_US');
      expect(sanitized.userId).toBe(10);
      expect(sanitized.role).toBe('user');
      expect(sanitized.companyId).toBe(1);
      expect(sanitized.activeTest).toBeUndefined();
      expect(sanitized.trx).toBeUndefined();
    });
  });

  describe('MW-ACT-001 to MW-ACT-004: ActionRegistry & MenuRegistry', () => {
    let actions: ActionRegistry;
    let menus: MenuRegistry;

    beforeEach(() => {
      actions = new ActionRegistry();
      menus = new MenuRegistry();
    });

    it('validates action IDs and filters by caller auth', () => {
      expect(() => actions.register({ id: 'invalid-id', name: 'Bad', type: 'window' })).toThrow();

      actions.register({
        id: 'base.partners',
        name: 'Partners',
        type: 'window',
        model: 'base.partner',
        requiredPermission: 'read',
      });
      actions.register({
        id: 'base.admin_only',
        name: 'Admin Only',
        type: 'server',
        model: 'base.user',
        requiredPermission: 'write',
      });

      expect(actions.listForAuth(userAuth).map((a) => a.id)).toEqual(['base.partners']);
      expect(actions.listForAuth(adminAuth).map((a) => a.id)).toEqual([
        'base.partners',
        'base.admin_only',
      ]);
    });

    it('builds acyclic hierarchical menu tree and detects cycles/orphans', () => {
      menus.registerMany([
        { id: 'root', label: 'Root', sequence: 10 },
        {
          id: 'partners',
          parentId: 'root',
          label: 'Partners',
          model: 'base.partner',
          sequence: 20,
        },
        { id: 'users', parentId: 'root', label: 'Users', model: 'base.user', sequence: 30 },
      ]);

      const userTree = menus.buildTreeForAuth(userAuth);
      expect(userTree).toHaveLength(1);
      expect(userTree[0]?.children.map((c) => c.id)).toEqual(['partners']);

      const badMenus = new MenuRegistry();
      expect(() =>
        badMenus.registerMany([{ id: 'orphan', parentId: 'missing', label: 'Orphan' }])
      ).toThrow(/Orphan menu/);
    });
  });

  describe('MW-API-002: JSON-RPC operation mapping', () => {
    it('exposes full execute_kw parity operations', () => {
      expect(rpcOperation('read')).toBe('read');
      expect(rpcOperation('search_count')).toBe('read');
      expect(rpcOperation('search_group_count')).toBe('read');
      expect(rpcOperation('fields_get')).toBe('read');
      expect(rpcOperation('views_get')).toBe('read');
      expect(rpcOperation('default_get')).toBe('read');
      expect(rpcOperation('onchange')).toBe('read');
      expect(rpcOperation('call_action')).toBe('action');
      expect(rpcOperation('unknown_method')).toBeNull();
    });
  });

  describe('MW-SEC-006: Attachment validation & magic-byte verification', () => {
    it('rejects path traversal and spoofed PNG magic bytes', () => {
      expect(safeAttachmentName('../secret.txt')).toBeNull();
      expect(safeAttachmentName('report.pdf')).toBe('report.pdf');

      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const fakePng = Buffer.from('<script>alert(1)</script>', 'utf8');
      expect(validateAttachmentMagicBytes(validPng, 'image/png')).toBe(true);
      expect(validateAttachmentMagicBytes(fakePng, 'image/png')).toBe(false);
    });
  });

  describe('MW-SEC-007 & MW-PERF-001: Auth cache invalidation', () => {
    it('bumps epoch on global invalidation', () => {
      const before = getAuthCacheEpoch();
      invalidateAuthCache();
      expect(getAuthCacheEpoch()).toBe(before + 1);
    });
  });

  describe('MW-BACK-006 & MW-API-006: Rate limit policy & API envelope', () => {
    it('builds composite authenticated rate-limit keys and standardized envelopes', () => {
      expect(RATE_LIMIT_POLICIES.bulkMutation.max).toBe(30);
      expect(routeRateLimitConfig('jsonrpc').rateLimit.max).toBe(120);
      const key = authenticatedRateLimitKey({
        auth: userAuth,
        ip: '127.0.0.1',
      } as never);
      expect(key).toBe('1:10');

      const ok = okEnvelope({ id: 1 }, { meta: { total: 1 }, requestId: 'req-1' });
      expect(ok).toEqual({
        success: true,
        data: { id: 1 },
        meta: { total: 1 },
        requestId: 'req-1',
      });

      const err = errorEnvelope('Not found', 'NOT_FOUND', { requestId: 'req-2' });
      expect(err).toEqual({
        success: false,
        error: 'Not found',
        code: 'NOT_FOUND',
        requestId: 'req-2',
      });
    });
  });

  describe('MW-CFG-002.3: Non-admin mutation guard on base.config_parameter and ir.feature_flag', () => {
    const ADMIN_PASSWORD = 'cfg-guard-admin-password-123';
    const MEMBER_PASSWORD = 'cfg-guard-member-password-123';
    const TEST_JWT_SECRET = 'cfg-guard-test-jwt-secret-minimum-32-chars';

    let db: Knex;
    let app: FastifyInstance;
    let adminToken: string;
    let memberToken: string;

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

      const defaultCompany = await Company.query()
        .findOne({ name: 'MoonWitness' })
        .throwIfNotFound();
      const memberPartner = await Partner.query().insertAndFetch({
        name: 'Config Guard Member Partner',
        company_id: defaultCompany.id,
      });
      const memberUser = await User.query().insertAndFetch({
        login: 'cfg_guard_member',
        password: MEMBER_PASSWORD,
        partner_id: memberPartner.id,
        role: 'user',
      });
      await CompanyMembership.query().insert({
        user_id: memberUser.id,
        company_id: defaultCompany.id,
        is_default: true,
      });

      const loginAs = async (login: string, password: string): Promise<string> => {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { login, password },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ data: { access_token: string } }>();
        return body.data.access_token;
      };

      adminToken = await loginAs('superadmin', ADMIN_PASSWORD);
      memberToken = await loginAs('cfg_guard_member', MEMBER_PASSWORD);
    });

    afterAll(async () => {
      if (app) await app.close();
      if (db) await db.destroy();
    });

    it('denies non-admin mutations via policy and returns HTTP 403 on base.config_parameter and ir.feature_flag', async () => {
      expect(canAccess('user', 'base.config_parameter', 'create', userAuth.groupPermissions)).toBe(
        false
      );
      expect(canAccess('user', 'base.config_parameter', 'write', userAuth.groupPermissions)).toBe(
        false
      );
      expect(canAccess('user', 'base.config_parameter', 'unlink', userAuth.groupPermissions)).toBe(
        false
      );
      expect(canAccess('user', 'ir.feature_flag', 'create', userAuth.groupPermissions)).toBe(false);
      expect(canAccess('user', 'ir.feature_flag', 'write', userAuth.groupPermissions)).toBe(false);
      expect(canAccess('user', 'ir.feature_flag', 'unlink', userAuth.groupPermissions)).toBe(false);

      // Admin can create a config parameter and a feature flag
      const adminCreateParam = await app.inject({
        method: 'POST',
        url: '/api/base.config_parameter',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { key: 'test.max_items', value_type: 'integer', value: '50', is_secret: false },
      });
      expect(adminCreateParam.statusCode).toBe(201);
      const paramId = adminCreateParam.json<{ data: { id: number } }>().data.id;

      const adminCreateFlag = await app.inject({
        method: 'POST',
        url: '/api/ir.feature_flag',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { key: 'test.beta_flag', name: 'Beta Flag', enabled: false, rollout_pct: 0 },
      });
      expect(adminCreateFlag.statusCode).toBe(201);
      const flagId = adminCreateFlag.json<{ data: { id: number } }>().data.id;

      // Non-admin receives 403 on create / write / delete for base.config_parameter
      const memberCreateParam = await app.inject({
        method: 'POST',
        url: '/api/base.config_parameter',
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          key: 'test.unauthorized',
          value_type: 'string',
          value: 'nope',
          is_secret: false,
        },
      });
      expect(memberCreateParam.statusCode).toBe(403);

      const memberPatchParam = await app.inject({
        method: 'PATCH',
        url: `/api/base.config_parameter/${paramId}`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { value: '999' },
      });
      expect(memberPatchParam.statusCode).toBe(403);

      const memberDeleteParam = await app.inject({
        method: 'DELETE',
        url: `/api/base.config_parameter/${paramId}`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(memberDeleteParam.statusCode).toBe(403);

      // Non-admin receives 403 on create / write / delete for ir.feature_flag
      const memberCreateFlag = await app.inject({
        method: 'POST',
        url: '/api/ir.feature_flag',
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { key: 'test.unauthorized_flag', name: 'Nope', enabled: true, rollout_pct: 100 },
      });
      expect(memberCreateFlag.statusCode).toBe(403);

      const memberPatchFlag = await app.inject({
        method: 'PATCH',
        url: `/api/ir.feature_flag/${flagId}`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { enabled: true },
      });
      expect(memberPatchFlag.statusCode).toBe(403);

      const memberDeleteFlag = await app.inject({
        method: 'DELETE',
        url: `/api/ir.feature_flag/${flagId}`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(memberDeleteFlag.statusCode).toBe(403);
    });
  });
});
