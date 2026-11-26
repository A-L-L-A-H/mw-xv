import { describe, expect, it } from 'vitest';

import { IdentityAccount } from './account.js';

describe('identity.account model', () => {
  it('uses an opaque UUID subject and immutable identifier column', () => {
    const account = IdentityAccount.fromJson({});
    account.$beforeInsert({} as never);
    expect(account.subject).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(IdentityAccount.idColumn).toBe('id');
    expect(IdentityAccount.tableName).toBe('identity.account');
  });

  it('never modifies a supplied subject on insert', () => {
    const subject = 'acct_01JTESTSUBJECT000000000000';
    const account = IdentityAccount.fromJson({ subject });
    account.$beforeInsert({} as never);
    expect(account.subject).toBe(subject);
  });

  it('tracks lifecycle timestamps without profile or permission fields', () => {
    const account = IdentityAccount.fromJson({ status: 'active' });
    account.$beforeInsert({} as never);
    account.status = 'disabled';
    account.$beforeUpdate({} as never, {} as never);
    expect(account.disabled_at).toBeTruthy();
    expect(account.updated_at).toBeTruthy();
    const json = account.toJSON() as Record<string, unknown>;
    for (const forbidden of ['password', 'email', 'company', 'role', 'permission']) {
      expect(json).not.toHaveProperty(forbidden);
    }
  });
});
