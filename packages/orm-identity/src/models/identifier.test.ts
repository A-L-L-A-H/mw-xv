import { describe, expect, it } from 'vitest';

import {
  IdentityIdentifier,
  normalizeIdentityIdentifier,
} from './identifier.js';

describe('identity.identifier model', () => {
  it('normalizes email case and outer whitespace', () => {
    expect(normalizeIdentityIdentifier('email', '  Person@Example.COM \t')).toBe('person@example.com');
  });

  it('trims usernames but preserves their case', () => {
    expect(normalizeIdentityIdentifier('username', '  Person.Name  ')).toBe('Person.Name');
  });

  it('normalizes on insert and preserves display form', () => {
    const identifier = IdentityIdentifier.fromJson({
      account_id: 'acct-1',
      type: 'email',
      value: '  Person@Example.COM ',
      display_value: 'Person@example.com',
    });
    identifier.$beforeInsert({} as never);
    expect(identifier.value).toBe('person@example.com');
    expect(identifier.display_value).toBe('Person@example.com');
    expect(identifier.verified).toBe(false);
    expect(identifier.primary).toBe(false);
  });

  it('requires exactly one account reference', () => {
    const identifier = IdentityIdentifier.fromJson({
      account_id: 'acct-1',
      type: 'username',
      value: ' person ',
    });
    expect(identifier.account_id).toBe('acct-1');
    expect(IdentityIdentifier.tableName).toBe('identity.identifier');
  });
});
