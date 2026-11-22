import { describe, expect, it } from 'vitest';
import {
  SavedFilter,
  validateSavedFilterDomainJson,
  canMutateSavedFilter,
  ConfigParameter,
  getConfigParam,
  redactConfigParameterForAudit,
} from '../src/index.js';

describe('base.saved_filter & base.config_parameter', () => {
  it('validates saved filter domain JSON and enforces owner/admin mutation rules', () => {
    expect(SavedFilter.modelName).toBe('base.saved_filter');
    expect(validateSavedFilterDomainJson('[["active","=",true]]')).toEqual([['active', '=', true]]);
    expect(() => validateSavedFilterDomainJson('not-json')).toThrow(/valid JSON/);
    expect(() => validateSavedFilterDomainJson('{"bad":true}')).toThrow(/Invalid domain/);

    expect(
      canMutateSavedFilter({ userId: 5, role: 'user' }, { user_id: 5, is_shared: false })
    ).toBe(true);
    expect(
      canMutateSavedFilter({ userId: 5, role: 'user' }, { user_id: 9, is_shared: false })
    ).toBe(false);
    expect(canMutateSavedFilter({ userId: 5, role: 'user' }, { user_id: 5, is_shared: true })).toBe(
      false
    );
    expect(
      canMutateSavedFilter({ userId: 1, role: 'superadmin' }, { user_id: 5, is_shared: true })
    ).toBe(true);
  });

  it('resolves config parameters with env override, company scope, and audit redaction', async () => {
    expect(ConfigParameter.modelName).toBe('base.config_parameter');

    const mockDb = () => ({
      where: () => ({
        orderBy: async () => [
          { key: 'app.max_rows', value_type: 'integer', value: '250', company_id: 2, active: true },
          {
            key: 'app.max_rows',
            value_type: 'integer',
            value: '100',
            company_id: null,
            active: true,
          },
        ],
      }),
    });

    expect(await getConfigParam<number>(mockDb, 'app.max_rows', 50, { companyId: 2 })).toBe(250);
    expect(await getConfigParam<number>(mockDb, 'app.max_rows', 50, { companyId: 99 })).toBe(100);
    expect(
      await getConfigParam<string>(mockDb, 'app.max_rows', '50', {
        envVarName: 'TEST_OVERRIDE_KEY',
        processEnv: { TEST_OVERRIDE_KEY: 'override-val' },
      })
    ).toBe('override-val');

    expect(redactConfigParameterForAudit({ key: 'k', value: 's3cr3t', is_secret: true })).toEqual({
      key: 'k',
      value: '[REDACTED]',
      is_secret: true,
    });
    expect(redactConfigParameterForAudit({ key: 'k', value: 'public', is_secret: false })).toEqual({
      key: 'k',
      value: 'public',
      is_secret: false,
    });
  });
});
