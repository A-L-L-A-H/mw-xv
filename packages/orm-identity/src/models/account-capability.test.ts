import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AccountCapability,
  isPlatformCapability,
  PLATFORM_OWNER_CAPABILITY,
} from './account-capability.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationPath = path.join(
  repositoryRoot,
  'apps/id/src/database/migrations/011_identity_account_capability.js'
);

describe('identity.account_capability model', () => {
  it('accepts only explicit platform capabilities', () => {
    expect(isPlatformCapability(PLATFORM_OWNER_CAPABILITY)).toBe(true);
    expect(isPlatformCapability('system')).toBe(false);
    expect(isPlatformCapability('superadmin')).toBe(false);
    expect(isPlatformCapability('tenant_admin')).toBe(false);
  });

  it('initializes stable capability grants', () => {
    const capability = AccountCapability.fromJson({
      account_id: 'acct-1',
      capability: PLATFORM_OWNER_CAPABILITY,
    });
    capability.$beforeInsert({} as never);

    expect(capability.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(capability.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(capability.capability).toBe('platform_owner');
    expect(AccountCapability.tableName).toBe('identity.account_capability');
  });

  it('rejects unsupported capability values on insert', () => {
    const capability = AccountCapability.fromJson({
      account_id: 'acct-1',
      capability: 'system',
    });
    expect(() => capability.$beforeInsert({} as never)).toThrow('Unsupported platform capability');
  });

  it('uses dedicated migration with account/capability and singleton guards', async () => {
    const source = await readFile(migrationPath, 'utf8');

    expect(source).toContain("createTable('account_capability'");
    expect(source).toContain("table.unique(['account_id', 'capability']");
    expect(source).toContain('identity_platform_owner_singleton');
    expect(source).toContain("capability = 'platform_owner'");
    expect(source).not.toContain('system');
    expect(source).not.toContain('superadmin');
  });
});
