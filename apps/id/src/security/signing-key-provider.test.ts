import { createPublicKey, createVerify } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PRIVATE_JWK_PARAMETERS,
  SigningKeyProviderError,
  createDevelopmentSigningKeyProvider,
  createExternalSigningKeyProvider,
  resolveSigningKeyProvider,
  type ExternalSigningKeyProviderAdapter,
} from './signing-key-provider.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

function externalAdapter(overrides: Partial<ExternalSigningKeyProviderAdapter> = {}): ExternalSigningKeyProviderAdapter {
  return {
    providerId: 'kms-test',
    listPublicKeys: async () => [
      {
        kid: 'kms-key-1',
        algorithm: 'ES256',
        status: 'active',
        providerId: 'kms-test',
        publicJwk: {
          kty: 'EC',
          kid: 'kms-key-1',
          alg: 'ES256',
          use: 'sig',
          crv: 'P-256',
          x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
          y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
        },
      },
    ],
    sign: async () => new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  };
}

describe('signing key provider abstraction', () => {
  it('provides a clearly labelled development provider that signs and publishes public JWKs only', async () => {
    process.env.NODE_ENV = 'test';
    const provider = createDevelopmentSigningKeyProvider({
      algorithm: 'RS256',
      kid: 'dev-key-1',
      allowInDevelopmentOnly: true,
    });

    expect(provider.developmentOnly).toBe(true);
    const jwks = await provider.getPublicJwks();
    expect(jwks.keys).toHaveLength(1);
    const [jwk] = jwks.keys;
    expect(jwk.kid).toBe('dev-key-1');
    expect(jwk.alg).toBe('RS256');
    for (const privateField of PRIVATE_JWK_PARAMETERS) {
      expect(jwk).not.toHaveProperty(privateField);
    }

    const payload = new TextEncoder().encode('signed-payload');
    const signed = await provider.sign({ payload });
    const verifier = createVerify('SHA256');
    verifier.update(payload);
    verifier.end();
    const publicKey = createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: 'jwk' });
    expect(verifier.verify(publicKey, Buffer.from(signed.signature))).toBe(true);
  });

  it('fails closed in production without an explicitly configured external key provider', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      createDevelopmentSigningKeyProvider({ allowInDevelopmentOnly: true })
    ).toThrow(SigningKeyProviderError);

    expect(() =>
      resolveSigningKeyProvider({
        environment: {
          nodeEnv: 'production',
          keyProviderMode: 'local-development',
        },
      })
    ).toThrow(SigningKeyProviderError);

    expect(() =>
      resolveSigningKeyProvider({
        environment: {
          nodeEnv: 'production',
          keyProviderMode: 'external',
          keyProviderConfig: 'kms://keys/id',
        },
      })
    ).toThrow(SigningKeyProviderError);
  });

  it('supports injectable external providers in production without leaking private parameters', async () => {
    process.env.NODE_ENV = 'production';
    const provider = resolveSigningKeyProvider({
      environment: {
        nodeEnv: 'production',
        keyProviderMode: 'external',
        keyProviderConfig: 'kms://keys/id',
      },
      externalProvider: externalAdapter(),
    });

    expect(provider.developmentOnly).toBe(false);
    const active = await provider.getActiveSigningKey();
    expect(active.kid).toBe('kms-key-1');
    expect(active.algorithm).toBe('ES256');
    const signed = await provider.sign({ payload: new TextEncoder().encode('hello') });
    expect(signed.kid).toBe('kms-key-1');
    expect(Array.from(signed.signature)).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsupported algorithms and private key material inside metadata', async () => {
    process.env.NODE_ENV = 'test';
    const provider = createDevelopmentSigningKeyProvider({
      algorithm: 'ES256',
      allowInDevelopmentOnly: true,
    });
    await expect(
      provider.sign({
        payload: new TextEncoder().encode('x'),
        algorithm: 'HS256' as never,
      })
    ).rejects.toThrow(/Unsupported signing algorithm/);

    const leakyExternal = createExternalSigningKeyProvider(
      externalAdapter({
        listPublicKeys: async () => [
          {
            kid: 'leaky-key',
            algorithm: 'ES256',
            status: 'active',
            providerId: 'kms-test',
            publicJwk: {
              kty: 'EC',
              kid: 'leaky-key',
              alg: 'ES256',
              use: 'sig',
              crv: 'P-256',
              x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
              y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
              d: 'private-secret-must-fail',
            } as never,
          },
        ],
      })
    );

    await expect(leakyExternal.listPublicKeys()).rejects.toThrow(/private key material/);
  });
});
