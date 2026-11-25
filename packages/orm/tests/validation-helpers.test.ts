import { describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import {
  extractRelationId,
  isValidIsoDate,
  requireAddonDb,
  resolveMutationField,
  type AddonHttpRequestBase,
} from '../src/index.js';

describe('orm validation and addon helpers', () => {
  describe('extractRelationId', () => {
    it('prefers <field>_id over <field> and current row', () => {
      expect(extractRelationId({ company_id: 12, company: 99 }, { company_id: 5 }, 'company')).toBe(
        12
      );
      expect(extractRelationId({ company: 34 }, { company_id: 5 }, 'company')).toBe(34);
      expect(extractRelationId({}, { company_id: 5 }, 'company')).toBe(5);
    });

    it('returns null when an explicit null/invalid value overrides current row', () => {
      expect(extractRelationId({ company_id: null }, { company_id: 5 }, 'company')).toBeNull();
      expect(extractRelationId({ company_id: 0 }, { company_id: 5 }, 'company')).toBeNull();
      expect(extractRelationId({ company_id: -3 }, { company_id: 5 }, 'company')).toBeNull();
      expect(extractRelationId({ company_id: 1.5 }, { company_id: 5 }, 'company')).toBeNull();
      expect(extractRelationId({ company_id: '5' }, { company_id: 5 }, 'company')).toBeNull();
      expect(extractRelationId({}, undefined, 'company')).toBeNull();
    });
  });

  describe('resolveMutationField', () => {
    it('resolves own property from values even when null or undefined, else falls back to current', () => {
      expect(resolveMutationField({ status: 'closed' }, { status: 'open' }, 'status')).toBe(
        'closed'
      );
      expect(resolveMutationField({ status: null }, { status: 'open' }, 'status')).toBeNull();
      expect(
        resolveMutationField({ status: undefined }, { status: 'open' }, 'status')
      ).toBeUndefined();
      expect(resolveMutationField({}, { status: 'open' }, 'status')).toBe('open');
      expect(resolveMutationField({}, undefined, 'status')).toBeUndefined();
    });
  });

  describe('isValidIsoDate', () => {
    it('accepts valid YYYY-MM-DD calendar dates including leap days', () => {
      expect(isValidIsoDate('2026-03-15')).toBe(true);
      expect(isValidIsoDate('2024-02-29')).toBe(true);
    });

    it('rejects non-strings, malformed strings, and impossible calendar dates', () => {
      expect(isValidIsoDate('2023-02-29')).toBe(false);
      expect(isValidIsoDate('2026-04-31')).toBe(false);
      expect(isValidIsoDate('2026-3-5')).toBe(false);
      expect(isValidIsoDate('2026-03-15T00:00:00Z')).toBe(false);
      expect(isValidIsoDate(null)).toBe(false);
      expect(isValidIsoDate(20260315)).toBe(false);
    });
  });

  describe('requireAddonDb', () => {
    it('returns the Knex instance from req.server.db', async () => {
      const db = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      try {
        const req = { server: { db } } as unknown as AddonHttpRequestBase;
        expect(requireAddonDb(req)).toBe(db);
      } finally {
        await db.destroy();
      }
    });

    it('throws when server or db is missing from request context', () => {
      const noServer = {} as AddonHttpRequestBase;
      const noDb = { server: {} } as unknown as AddonHttpRequestBase;
      expect(() => requireAddonDb(noServer)).toThrow('Database not available on request context');
      expect(() => requireAddonDb(noDb)).toThrow('Database not available on request context');
    });
  });
});
