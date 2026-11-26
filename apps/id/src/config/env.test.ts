import { describe, expect, it } from 'vitest';

import {
  IdentityConfigError,
  parseIdentityEnvironment,
  redactIdentityConfigValue,
  type IdentityEnvironment,
} from './env.js';

const SECRET_QUERY = 'password=hunter2&token=abc123';

function validEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    IDENTITY_DATABASE_URL: 'postgresql://id_user:id_secret@db.internal:5432/identity',
    IDENTITY_ISSUER_URL: 'http://localhost:3000',
    IDENTITY_PORT: '3000',
    IDENTITY_KEY_PROVIDER_MODE: 'local-development',
    ...overrides,
  };
}

function expectConfigError(environment: NodeJS.ProcessEnv, forbidden: string[] = []): void {
  try {
    parseIdentityEnvironment(environment);
    throw new Error('Expected IdentityConfigError');
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityConfigError);
    const message = (error as Error).message;
    for (const value of forbidden) expect(message).not.toContain(value);
  }
}

describe('Identity environment validation', () => {
  it('returns a frozen typed configuration for a valid environment', () => {
    const config: IdentityEnvironment = parseIdentityEnvironment(validEnvironment());
    expect(Object.isFrozen(config)).toBe(true);
    expect(config).toEqual({
      databaseUrl: 'postgresql://id_user:id_secret@db.internal:5432/identity',
      issuerUrl: 'http://localhost:3000',
      port: 3000,
      host: '127.0.0.1',
      nodeEnv: 'test',
      keyProviderMode: 'local-development',
    });
  });

  it('fails closed when the production database URL is missing', () => {
    expectConfigError(validEnvironment({ NODE_ENV: 'production', IDENTITY_DATABASE_URL: undefined }), [
      'id_secret',
      'db.internal',
    ]);
  });

  it('never accepts the business database URL as a fallback', () => {
    const shared = 'postgresql://shared:shared_secret@db.internal:5432/moonwitness';
    expectConfigError(
      validEnvironment({ IDENTITY_DATABASE_URL: shared, DATABASE_URL: shared }),
      ['shared_secret', 'db.internal']
    );
  });

  it('rejects an invalid production issuer URL without leaking values', () => {
    expectConfigError(
      validEnvironment({ NODE_ENV: 'production', IDENTITY_ISSUER_URL: 'http://localhost:3000' }),
      ['localhost', 'id_secret']
    );
  });

  it('rejects an invalid port and key provider configuration', () => {
    expectConfigError(validEnvironment({ IDENTITY_PORT: 'abc' }));
    expectConfigError(validEnvironment({ NODE_ENV: 'production' }));
    expectConfigError(validEnvironment({ IDENTITY_KEY_PROVIDER_MODE: 'external' }));
  });

  it('accepts an explicitly configured external key provider in production', () => {
    const config = parseIdentityEnvironment(
      validEnvironment({
        NODE_ENV: 'production',
        IDENTITY_ISSUER_URL: 'https://id.example.com',
        IDENTITY_KEY_PROVIDER_MODE: 'external',
        IDENTITY_KEY_PROVIDER_CONFIG: 'kms://identity-signing',
      })
    );
    expect(config.keyProviderMode).toBe('external');
    expect(config.keyProviderConfig).toBe('kms://identity-signing');
  });

  it('redacts credentials, query values and malformed values from errors', () => {
    expect(redactIdentityConfigValue(`postgresql://user:${SECRET_QUERY}@db.example.com/id`)).not.toContain(
      'hunter2'
    );
    expect(redactIdentityConfigValue('not a url')).toBe('<redacted>');
  });
});
