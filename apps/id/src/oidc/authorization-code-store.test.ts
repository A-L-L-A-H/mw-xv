import { describe, expect, it } from 'vitest';

import {
  assertAuthorizationCodeBinding,
  createAuthorizationCodeStore,
  isAuthorizationCodeConsumable,
  type OidcAdapter,
  type OidcAdapterConstructor,
} from './authorization-code-store.js';

class ConformanceAdapter implements OidcAdapter {
  readonly model: string;
  readonly records = new Map<string, Record<string, unknown>>();

  constructor(model: string) {
    this.model = model;
  }

  async consume(id: string): Promise<void> {
    const record = this.require(id);
    assertAuthorizationCodeBinding(
      record as { clientId?: string },
      String(record.clientId ?? ''),
    );
    if (!isAuthorizationCodeConsumable(record as { consumed?: number; exp?: number }, 700)) {
      throw new Error('authorization code expired or already consumed');
    }
    if (record.consumed !== undefined) {
      throw new Error('authorization code already consumed');
    }
    record.consumed = 700;
  }

  async destroy(id: string): Promise<void> {
    this.records.delete(id);
  }

  async find(id: string): Promise<unknown> {
    return this.records.get(id);
  }

  async findByUid(): Promise<unknown> {
    return undefined;
  }

  async findByUserCode(): Promise<unknown> {
    return undefined;
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.grantId === grantId) {
        this.records.delete(id);
      }
    }
  }

  async upsert(
    id: string,
    payload: Record<string, unknown>,
    expiresIn: number,
  ): Promise<void> {
    if (this.records.has(id)) {
      throw new Error('authorization code identifier collision');
    }
    if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
      throw new Error('authorization code expiry must be a positive safe integer');
    }
    this.records.set(id, {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    });
  }

  private require(id: string): Record<string, unknown> {
    const record = this.records.get(id);
    if (!record) {
      throw new Error('authorization code not found');
    }
    return record;
  }
}

const makeAdapter = (model: string): OidcAdapter => new ConformanceAdapter(model);
const AuthorizationCodeAdapter: OidcAdapterConstructor = ConformanceAdapter;

describe('authorization code provider adapter', () => {
  it('delegates authorization code storage to the selected provider contract', () => {
    const store = createAuthorizationCodeStore({ adapter: makeAdapter });

    expect(store.providersOwnAuthorizationCodeStorage).toBe(true);
    expect(store.storageTable).toBeNull();
    expect(store.authorizationCodeTtlSeconds).toBe(60);
    expect(store.clockToleranceSeconds).toBe(30);
    expect(Object.isFrozen(store)).toBe(true);
  });

  it('rejects invalid TTL settings without creating a store', () => {
    expect(() =>
      createAuthorizationCodeStore({ adapter: makeAdapter, authorizationCodeTtlSeconds: 0 }),
    ).toThrow('positive safe integer');
    expect(() =>
      createAuthorizationCodeStore({ adapter: makeAdapter, clockToleranceSeconds: -1 }),
    ).toThrow('non-negative safe integer');
  });

  it('instantiates the adapter for the provider model type', async () => {
    const store = createAuthorizationCodeStore({ adapter: AuthorizationCodeAdapter });
    const Adapter = store.adapter as OidcAdapterConstructor;
    const adapter = new Adapter('AuthorizationCode');

    expect(adapter).toBeInstanceOf(ConformanceAdapter);
    expect((adapter as ConformanceAdapter).model).toBe('AuthorizationCode');
  });

  it('stores opaque provider-generated handles with expiry', async () => {
    const adapter = new ConformanceAdapter('AuthorizationCode');
    await adapter.upsert(
      'opaque-provider-handle',
      { clientId: 'board', grantId: 'grant-1' },
      60,
    );
    const record = (await adapter.find('opaque-provider-handle')) as {
      exp: number;
      clientId: string;
    };

    expect(record.clientId).toBe('board');
    expect(record.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(Object.keys(record)).not.toContain('code');
    expect(Object.keys(record)).not.toContain('plainText');
  });

  it('enforces single-use consumption through the provider adapter', async () => {
    const adapter = new ConformanceAdapter('AuthorizationCode');
    await adapter.upsert('single-use', { clientId: 'board', grantId: 'grant-2' }, 60);

    await expect(adapter.consume('single-use')).resolves.toBeUndefined();
    await expect(adapter.consume('single-use')).rejects.toThrow('already consumed');
    expect(isAuthorizationCodeConsumable(undefined, 800)).toBe(false);
  });

  it('rejects expired authorization codes', () => {
    expect(isAuthorizationCodeConsumable({ exp: 799 }, 800)).toBe(false);
    expect(isAuthorizationCodeConsumable({ exp: 801 }, 800)).toBe(true);
  });

  it('binds an authorization code to one client', async () => {
    const adapter = new ConformanceAdapter('AuthorizationCode');
    await adapter.upsert('bound-code', { clientId: 'board', grantId: 'grant-3' }, 60);
    const record = (await adapter.find('bound-code')) as {
      clientId: string;
    };

    expect(() => assertAuthorizationCodeBinding(record, 'board')).not.toThrow();
    expect(() => assertAuthorizationCodeBinding(record, 'desktop')).toThrow(
      'client mismatch',
    );
    expect(() => assertAuthorizationCodeBinding(undefined, 'board')).toThrow('not found');
  });

  it('revokes every adapter record in the grant', async () => {
    const adapter = new ConformanceAdapter('AuthorizationCode');
    await adapter.upsert('grant-member', { clientId: 'board', grantId: 'grant-4' }, 60);

    await adapter.revokeByGrantId('grant-4');

    expect(await adapter.find('grant-member')).toBeUndefined();
  });

  it('keeps authorization code material out of adapter errors and JSON output', async () => {
    const adapter = new ConformanceAdapter('AuthorizationCode');
    const secretMaterial = 'code-plaintext-must-never-appear';

    await expect(adapter.consume(secretMaterial)).rejects.toThrow('not found');
    await expect(adapter.consume(secretMaterial)).rejects.not.toThrow(secretMaterial);
    expect(JSON.stringify(adapter)).not.toContain(secretMaterial);
  });
});
