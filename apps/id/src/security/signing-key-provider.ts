import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

import type { IdentityEnvironment } from '../config/env.js';

export const APPROVED_SIGNING_ALGORITHMS = ['RS256', 'ES256'] as const;
export type ApprovedSigningAlgorithm = (typeof APPROVED_SIGNING_ALGORITHMS)[number];

export const SIGNING_KEY_STATUSES = ['pending', 'active', 'retiring', 'retired'] as const;
export type SigningKeyStatus = (typeof SIGNING_KEY_STATUSES)[number];

export const PRIVATE_JWK_PARAMETERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

export interface PublicSigningJwk {
  readonly kty: 'RSA' | 'EC';
  readonly kid: string;
  readonly alg: ApprovedSigningAlgorithm;
  readonly use: 'sig';
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

export function isApprovedSigningAlgorithm(value: string): value is ApprovedSigningAlgorithm {
  return APPROVED_SIGNING_ALGORITHMS.includes(value as ApprovedSigningAlgorithm);
}

function containsPrivateKeyMaterial(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('PRIVATE KEY');
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_JWK_PARAMETERS.includes(key as (typeof PRIVATE_JWK_PARAMETERS)[number])) {
      return true;
    }
    if (containsPrivateKeyMaterial(entry)) return true;
  }
  return false;
}

export function assertPublicSigningJwk(jwk: unknown): PublicSigningJwk {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
    throw new SigningKeyProviderError('Public JWK must be an object');
  }
  const record = jwk as Record<string, unknown>;
  if (containsPrivateKeyMaterial(record)) {
    throw new SigningKeyProviderError('Signing key metadata must not contain private key material');
  }
  if (typeof record.kid !== 'string' || record.kid.trim() === '') {
    throw new SigningKeyProviderError('Public JWK requires a non-empty kid');
  }
  if (typeof record.alg !== 'string' || !isApprovedSigningAlgorithm(record.alg)) {
    throw new SigningKeyProviderError(`Unsupported signing algorithm: ${String(record.alg)}`);
  }
  if (record.use !== 'sig') {
    throw new SigningKeyProviderError('Public JWK use must be sig');
  }
  if (record.alg === 'RS256') {
    if (record.kty !== 'RSA' || typeof record.n !== 'string' || typeof record.e !== 'string') {
      throw new SigningKeyProviderError('RS256 public JWK requires kty=RSA, n and e');
    }
    return Object.freeze({
      kty: 'RSA' as const,
      kid: record.kid,
      alg: 'RS256' as const,
      use: 'sig' as const,
      n: record.n,
      e: record.e,
    });
  }
  if (
    record.kty !== 'EC' ||
    record.crv !== 'P-256' ||
    typeof record.x !== 'string' ||
    typeof record.y !== 'string'
  ) {
    throw new SigningKeyProviderError('ES256 public JWK requires kty=EC, crv=P-256, x and y');
  }
  return Object.freeze({
    kty: 'EC' as const,
    kid: record.kid,
    alg: 'ES256' as const,
    use: 'sig' as const,
    crv: record.crv,
    x: record.x,
    y: record.y,
  });
}

export interface SigningKeyRecord {
  readonly kid: string;
  readonly algorithm: ApprovedSigningAlgorithm;
  readonly status: SigningKeyStatus;
  readonly publicJwk: PublicSigningJwk;
  readonly providerId: string;
  readonly activatedAt?: string | null;
  readonly retiredAt?: string | null;
  readonly expiresAt?: string | null;
}

export interface SigningRequest {
  readonly payload: Uint8Array;
  readonly kid?: string;
  readonly algorithm?: ApprovedSigningAlgorithm;
}

export interface SigningResult {
  readonly kid: string;
  readonly algorithm: ApprovedSigningAlgorithm;
  readonly signature: Uint8Array;
}

/**
 * Provider abstraction separating signing operations and public key metadata
 * from raw private key storage. Compatible with oidc-provider JWKS/key lookup.
 */
export interface SigningKeyProvider {
  readonly providerId: string;
  readonly developmentOnly: boolean;
  readonly listPublicKeys: (now?: Date) => Promise<readonly SigningKeyRecord[]>;
  readonly getActiveSigningKey: () => Promise<SigningKeyRecord>;
  readonly getPublicJwks: (now?: Date) => Promise<{ readonly keys: readonly PublicSigningJwk[] }>;
  readonly sign: (request: SigningRequest) => Promise<SigningResult>;
}

export interface ExternalSigningKeyProviderAdapter {
  readonly providerId: string;
  readonly listPublicKeys: (now?: Date) => Promise<readonly SigningKeyRecord[]>;
  readonly sign: (request: {
    readonly kid: string;
    readonly algorithm: ApprovedSigningAlgorithm;
    readonly payload: Uint8Array;
  }) => Promise<Uint8Array>;
}

export class SigningKeyProviderError extends Error {
  override readonly name = 'SigningKeyProviderError';
}

function assertAllowedAlgorithm(algorithm: string): ApprovedSigningAlgorithm {
  if (!isApprovedSigningAlgorithm(algorithm)) {
    throw new SigningKeyProviderError(`Unsupported signing algorithm: ${algorithm}`);
  }
  return algorithm;
}

function validatePublicRecord(record: SigningKeyRecord): SigningKeyRecord {
  const algorithm = assertAllowedAlgorithm(record.algorithm);
  const publicJwk = assertPublicSigningJwk(record.publicJwk);
  if (publicJwk.kid !== record.kid || publicJwk.alg !== algorithm) {
    throw new SigningKeyProviderError('Signing key metadata mismatch between record and public JWK');
  }
  return Object.freeze({
    ...record,
    algorithm,
    publicJwk,
  });
}

function isVerifiableKey(record: SigningKeyRecord, now: Date): boolean {
  if (record.status === 'pending' || record.status === 'retired') return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) return false;
  return record.status === 'active' || record.status === 'retiring';
}

export function createExternalSigningKeyProvider(
  adapter: ExternalSigningKeyProviderAdapter
): SigningKeyProvider {
  if (!adapter.providerId || adapter.providerId.trim() === '') {
    throw new SigningKeyProviderError('External signing key provider requires a providerId');
  }

  const listPublicKeys = async (now = new Date()): Promise<readonly SigningKeyRecord[]> => {
    const records = await adapter.listPublicKeys(now);
    return records.map(validatePublicRecord).filter((record) => isVerifiableKey(record, now));
  };

  const getActiveSigningKey = async (): Promise<SigningKeyRecord> => {
    const keys = await listPublicKeys();
    const active = keys.find((entry) => entry.status === 'active');
    if (!active) {
      throw new SigningKeyProviderError('No active signing key available');
    }
    return active;
  };

  return {
    providerId: adapter.providerId,
    developmentOnly: false,
    listPublicKeys,
    getActiveSigningKey,
    getPublicJwks: async (now = new Date()) => {
      const keys = await listPublicKeys(now);
      return Object.freeze({ keys: Object.freeze(keys.map((entry) => entry.publicJwk)) });
    },
    sign: async (request) => {
      const keys = await listPublicKeys();
      const selected = request.kid
        ? keys.find((entry) => entry.kid === request.kid && entry.status === 'active')
        : keys.find((entry) => entry.status === 'active');
      if (!selected) {
        throw new SigningKeyProviderError('Requested active signing key is not available');
      }
      const algorithm = request.algorithm ? assertAllowedAlgorithm(request.algorithm) : selected.algorithm;
      if (algorithm !== selected.algorithm) {
        throw new SigningKeyProviderError('Requested algorithm does not match signing key');
      }
      const signature = await adapter.sign({
        kid: selected.kid,
        algorithm,
        payload: request.payload,
      });
      return Object.freeze({ kid: selected.kid, algorithm, signature });
    },
  };
}

export interface DevelopmentSigningKeyProviderOptions {
  readonly algorithm?: ApprovedSigningAlgorithm;
  readonly kid?: string;
  readonly allowInDevelopmentOnly: true;
}

export function createDevelopmentSigningKeyProvider(
  options: DevelopmentSigningKeyProviderOptions
): SigningKeyProvider {
  if (process.env.NODE_ENV === 'production') {
    throw new SigningKeyProviderError('Development signing key provider cannot be used in production');
  }
  if (options.allowInDevelopmentOnly !== true) {
    throw new SigningKeyProviderError('Development signing key provider must be explicitly opted in');
  }

  const algorithm = assertAllowedAlgorithm(options.algorithm ?? 'RS256');
  const kid = options.kid ?? `dev-${randomUUID()}`;
  const pair =
    algorithm === 'RS256'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  const exportedPublic = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const publicJwk = assertPublicSigningJwk({
    ...exportedPublic,
    kid,
    alg: algorithm,
    use: 'sig',
  });
  const record: SigningKeyRecord = Object.freeze({
    kid,
    algorithm,
    status: 'active',
    publicJwk,
    providerId: 'local-development',
    activatedAt: new Date().toISOString(),
    retiredAt: null,
    expiresAt: null,
  });

  return {
    providerId: 'local-development',
    developmentOnly: true,
    listPublicKeys: async () => Object.freeze([record]),
    getActiveSigningKey: async () => record,
    getPublicJwks: async () => Object.freeze({ keys: Object.freeze([publicJwk]) }),
    sign: async (request) => {
      const requestedAlgorithm = request.algorithm
        ? assertAllowedAlgorithm(request.algorithm)
        : algorithm;
      if (requestedAlgorithm !== algorithm) {
        throw new SigningKeyProviderError('Requested algorithm does not match signing key');
      }
      if (request.kid && request.kid !== kid) {
        throw new SigningKeyProviderError('Unknown signing key id');
      }
      const signer = createSign('SHA256');
      signer.update(request.payload);
      signer.end();
      const signature =
        algorithm === 'RS256'
          ? signer.sign(pair.privateKey)
          : signer.sign({ key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
      return Object.freeze({
        kid,
        algorithm,
        signature: new Uint8Array(signature),
      });
    },
  };
}

export interface ResolveSigningKeyProviderInput {
  readonly environment: Pick<IdentityEnvironment, 'nodeEnv' | 'keyProviderMode' | 'keyProviderConfig'>;
  readonly externalProvider?: ExternalSigningKeyProviderAdapter;
}

export function resolveSigningKeyProvider(
  input: ResolveSigningKeyProviderInput
): SigningKeyProvider {
  if (input.environment.nodeEnv === 'production') {
    if (input.environment.keyProviderMode !== 'external' || !input.environment.keyProviderConfig) {
      throw new SigningKeyProviderError('Production requires a configured external signing key provider');
    }
    if (!input.externalProvider) {
      throw new SigningKeyProviderError('External signing key provider adapter must be supplied in production');
    }
    return createExternalSigningKeyProvider(input.externalProvider);
  }

  if (input.environment.keyProviderMode === 'external') {
    if (!input.externalProvider) {
      throw new SigningKeyProviderError('External signing key provider adapter is missing');
    }
    return createExternalSigningKeyProvider(input.externalProvider);
  }

  return createDevelopmentSigningKeyProvider({ allowInDevelopmentOnly: true });
}
