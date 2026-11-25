import { describe, expect, it, vi } from 'vitest';
import {
  hasModelAccess,
  parsePositiveId,
  requestAuth,
  requireAuthorizedModelAccess,
  type AddonHttpReply,
  type GroupGrant,
  type RequestAuth,
} from '../src/index.js';

function createMockReply() {
  let statusCode = 200;
  let payload: unknown = undefined;
  const reply: AddonHttpReply = {
    code(code: number) {
      statusCode = code;
      return reply;
    },
    header() {
      return reply;
    },
    send(data?: unknown) {
      payload = data;
      return payload;
    },
  };
  return {
    reply,
    getStatus: () => statusCode,
    getPayload: () => payload,
  };
}

describe('orm HTTP ACL and ID helpers', () => {
  describe('requestAuth', () => {
    it('extracts auth when userId is a number', () => {
      const auth: RequestAuth = { userId: 7, role: 'user', companyId: 2 };
      expect(requestAuth({ auth })).toBe(auth);
    });

    it('returns null when auth is missing or userId is not a number', () => {
      expect(requestAuth({})).toBeNull();
      expect(requestAuth({ auth: null })).toBeNull();
      expect(requestAuth({ auth: { userId: '7', role: 'user' } })).toBeNull();
    });
  });

  describe('parsePositiveId', () => {
    it('parses positive safe integer strings', () => {
      expect(parsePositiveId('1')).toBe(1);
      expect(parsePositiveId('42')).toBe(42);
    });

    it('returns null for zero, negative, non-integer, and non-numeric values', () => {
      for (const raw of ['0', '-5', '1.5', 'abc', '', '9007199254740992']) {
        expect(parsePositiveId(raw)).toBeNull();
      }
    });
  });

  describe('hasModelAccess', () => {
    const grant: GroupGrant = {
      model_name: 'sale.order',
      read: true,
      create: true,
      write: false,
      unlink: false,
    };

    it('allows system and superadmin roles unconditionally', () => {
      expect(hasModelAccess({ userId: 1, role: 'system' }, 'sale.order', 'unlink')).toBe(true);
      expect(hasModelAccess({ userId: 1, role: 'superadmin' }, 'sale.order', 'unlink')).toBe(true);
    });

    it('rejects unknown roles', () => {
      expect(
        hasModelAccess(
          { userId: 1, role: 'manager', groupPermissions: [grant] },
          'sale.order',
          'read'
        )
      ).toBe(false);
    });

    it('checks matching model_name and operation for user role', () => {
      const userAuth: RequestAuth = {
        userId: 10,
        role: 'user',
        companyId: 1,
        groupPermissions: [grant],
      };
      expect(hasModelAccess(userAuth, 'sale.order', 'read')).toBe(true);
      expect(hasModelAccess(userAuth, 'sale.order', 'create')).toBe(true);
      expect(hasModelAccess(userAuth, 'sale.order', 'write')).toBe(false);
      expect(hasModelAccess(userAuth, 'isp.nas', 'read')).toBe(false);
      expect(hasModelAccess({ userId: 10, role: 'user' }, 'sale.order', 'read')).toBe(false);
    });
  });

  describe('requireAuthorizedModelAccess', () => {
    const readGrant: GroupGrant = {
      model_name: 'isp.subscriber',
      read: true,
      create: false,
      write: true,
      unlink: false,
    };

    it('rejects unauthenticated requests with 401 and invokes onDenied', () => {
      const mock = createMockReply();
      const onDenied = vi.fn();
      const result = requireAuthorizedModelAccess({}, mock.reply, 'sale.order', 'read', {
        onDenied,
      });
      expect(result).toBeNull();
      expect(mock.getStatus()).toBe(401);
      expect(mock.getPayload()).toEqual({ success: false, error: 'Authentication required' });
      expect(onDenied).toHaveBeenCalledTimes(1);
    });

    it('rejects missing or invalid companyId with 403', () => {
      for (const companyId of [undefined, 0, -1, 1.5, Number.NaN]) {
        const mock = createMockReply();
        const onDenied = vi.fn();
        const result = requireAuthorizedModelAccess(
          { auth: { userId: 1, role: 'superadmin', companyId } },
          mock.reply,
          'sale.order',
          'read',
          { onDenied }
        );
        expect(result).toBeNull();
        expect(mock.getStatus()).toBe(403);
        expect(mock.getPayload()).toEqual({
          success: false,
          error: 'Active company context required',
        });
        expect(onDenied).toHaveBeenCalledTimes(1);
      }
    });

    it('rejects denied single and multi-model ACL requests with formatted model names', () => {
      const singleMock = createMockReply();
      expect(
        requireAuthorizedModelAccess(
          { auth: { userId: 2, role: 'user', companyId: 3, groupPermissions: [readGrant] } },
          singleMock.reply,
          'sale.order',
          'create'
        )
      ).toBeNull();
      expect(singleMock.getStatus()).toBe(403);
      expect(singleMock.getPayload()).toEqual({
        success: false,
        error: 'Access denied for sale.order:create',
      });

      const multiMock = createMockReply();
      expect(
        requireAuthorizedModelAccess(
          { auth: { userId: 2, role: 'user', companyId: 3, groupPermissions: [readGrant] } },
          multiMock.reply,
          ['isp.nas', 'isp.radius.outbox'],
          'write'
        )
      ).toBeNull();
      expect(multiMock.getStatus()).toBe(403);
      expect(multiMock.getPayload()).toEqual({
        success: false,
        error: 'Access denied for isp.nas|isp.radius.outbox:write',
      });
    });

    it('grants access when any model in an array is permitted', () => {
      const mock = createMockReply();
      const auth: RequestAuth = {
        userId: 2,
        role: 'user',
        companyId: 5,
        groupPermissions: [readGrant],
      };
      const result = requireAuthorizedModelAccess(
        { auth },
        mock.reply,
        ['isp.radius.outbox', 'isp.subscriber'],
        'write'
      );
      expect(result).toEqual({ auth, companyId: 5 });
      expect(mock.getStatus()).toBe(200);
    });

    it('enforces adminOnly after model ACL check', () => {
      const userWithGrantMock = createMockReply();
      const onDenied = vi.fn();
      const result = requireAuthorizedModelAccess(
        { auth: { userId: 2, role: 'user', companyId: 5, groupPermissions: [readGrant] } },
        userWithGrantMock.reply,
        'isp.subscriber',
        'read',
        { adminOnly: true, onDenied }
      );
      expect(result).toBeNull();
      expect(userWithGrantMock.getStatus()).toBe(403);
      expect(userWithGrantMock.getPayload()).toEqual({
        success: false,
        error: 'Admin role required',
      });
      expect(onDenied).toHaveBeenCalledTimes(1);

      const adminMock = createMockReply();
      const adminAuth: RequestAuth = { userId: 1, role: 'superadmin', companyId: 5 };
      expect(
        requireAuthorizedModelAccess(
          { auth: adminAuth },
          adminMock.reply,
          'isp.subscriber',
          'read',
          { adminOnly: true }
        )
      ).toEqual({ auth: adminAuth, companyId: 5 });
    });
  });
});
