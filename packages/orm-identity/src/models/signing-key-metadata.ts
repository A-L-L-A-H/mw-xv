import { randomUUID } from 'node:crypto';
import { Model, type QueryContext } from 'objection';

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

export function isSigningKeyStatus(value: string): value is SigningKeyStatus {
  return SIGNING_KEY_STATUSES.includes(value as SigningKeyStatus);
}

function containsPrivateKeyMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('PRIVATE KEY');
  }
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_JWK_PARAMETERS.includes(key as (typeof PRIVATE_JWK_PARAMETERS)[number])) {
      return true;
    }
    if (containsPrivateKeyMaterial(entry)) return true;
  }
  return false;
}

function assertAsymmetricPublicFields(
  jwk: Record<string, unknown>,
  algorithm: ApprovedSigningAlgorithm
): void {
  if (algorithm === 'RS256') {
    if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      throw new Error('RS256 public JWK requires kty=RSA, n and e');
    }
    return;
  }
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string'
  ) {
    throw new Error('ES256 public JWK requires kty=EC, crv=P-256, x and y');
  }
}

export function assertPublicSigningJwk(jwk: unknown): PublicSigningJwk {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
    throw new Error('Public JWK must be an object');
  }
  const record = jwk as Record<string, unknown>;
  if (containsPrivateKeyMaterial(record)) {
    throw new Error('Signing key metadata must not contain private key material');
  }
  if (typeof record.kid !== 'string' || record.kid.trim() === '') {
    throw new Error('Public JWK requires a non-empty kid');
  }
  if (typeof record.alg !== 'string' || !isApprovedSigningAlgorithm(record.alg)) {
    throw new Error('Unsupported signing algorithm');
  }
  if (record.use !== 'sig') {
    throw new Error('Public JWK use must be sig');
  }
  assertAsymmetricPublicFields(record, record.alg);

  if (record.alg === 'RS256') {
    return Object.freeze({
      kty: 'RSA' as const,
      kid: record.kid,
      alg: 'RS256' as const,
      use: 'sig' as const,
      n: record.n as string,
      e: record.e as string,
    });
  }
  return Object.freeze({
    kty: 'EC' as const,
    kid: record.kid,
    alg: 'ES256' as const,
    use: 'sig' as const,
    crv: record.crv as string,
    x: record.x as string,
    y: record.y as string,
  });
}

export class SigningKeyMetadata extends Model {
  static override readonly tableName = 'identity.signing_key_metadata';
  static override readonly idColumn = 'id';

  id!: string;
  kid!: string;
  algorithm!: ApprovedSigningAlgorithm;
  status!: SigningKeyStatus;
  public_jwk!: PublicSigningJwk;
  provider_id!: string;
  activated_at?: string | null;
  retired_at?: string | null;
  expires_at?: string | null;
  created_at!: string;

  private validateMetadata(): void {
    if (typeof this.kid !== 'string' || this.kid.trim() === '') {
      throw new Error('Signing key kid is required');
    }
    if (!isApprovedSigningAlgorithm(this.algorithm)) {
      throw new Error('Unsupported signing algorithm');
    }
    if (!isSigningKeyStatus(this.status)) {
      throw new Error('Unsupported signing key status');
    }
    if (typeof this.provider_id !== 'string' || this.provider_id.trim() === '' || this.provider_id.includes('PRIVATE KEY')) {
      throw new Error('Invalid signing key provider identifier');
    }
    const validated = assertPublicSigningJwk(this.public_jwk);
    if (validated.kid !== this.kid || validated.alg !== this.algorithm) {
      throw new Error('Public JWK kid and algorithm must match metadata columns');
    }
    this.public_jwk = validated;
  }

  override $beforeInsert(_context: QueryContext): void {
    if (!this.id) this.id = randomUUID();
    if (!this.created_at) this.created_at = new Date().toISOString();
    if (!this.status) this.status = 'pending';
    this.validateMetadata();
  }

  override $beforeUpdate(_options: unknown, _context: QueryContext): void {
    this.validateMetadata();
  }

  isVerifiableAt(now: Date = new Date()): boolean {
    if (this.status === 'pending') return false;
    if (this.expires_at && new Date(this.expires_at).getTime() <= now.getTime()) return false;
    return this.status === 'active' || this.status === 'retiring';
  }
}
