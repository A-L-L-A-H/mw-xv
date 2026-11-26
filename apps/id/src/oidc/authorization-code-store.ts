const CLOCK_TOLERANCE_SECONDS = 30;

export interface OidcAdapter {
  consume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  find(id: string): Promise<unknown>;
  findByUid(uid: string): Promise<unknown>;
  findByUserCode(userCode: string): Promise<unknown>;
  revokeByGrantId(grantId: string): Promise<void>;
  upsert(id: string, payload: Record<string, unknown>, expiresIn: number): Promise<void>;
}

export type OidcAdapterConstructor = new (model: string) => OidcAdapter;
export type OidcAdapterFactory = (model: string) => OidcAdapter;

export interface AuthorizationCodeConformanceRecord {
  consumed?: number;
  exp?: number;
  clientId?: string;
}

export interface AuthorizationCodeStore {
  adapter: OidcAdapterConstructor | OidcAdapterFactory;
  authorizationCodeTtlSeconds: number;
  clockToleranceSeconds: number;
  providersOwnAuthorizationCodeStorage: true;
  storageTable: null;
}

export function createAuthorizationCodeStore(options: {
  adapter: OidcAdapterConstructor | OidcAdapterFactory;
  authorizationCodeTtlSeconds?: number;
  clockToleranceSeconds?: number;
}): AuthorizationCodeStore {
  const authorizationCodeTtlSeconds = options.authorizationCodeTtlSeconds ?? 60;
  if (
    !Number.isSafeInteger(authorizationCodeTtlSeconds) ||
    authorizationCodeTtlSeconds <= 0
  ) {
    throw new Error('authorizationCodeTtlSeconds must be a positive safe integer');
  }

  const clockToleranceSeconds = options.clockToleranceSeconds ?? CLOCK_TOLERANCE_SECONDS;
  if (
    !Number.isSafeInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0
  ) {
    throw new Error('clockToleranceSeconds must be a non-negative safe integer');
  }

  return Object.freeze({
    adapter: options.adapter,
    authorizationCodeTtlSeconds,
    clockToleranceSeconds,
    providersOwnAuthorizationCodeStorage: true as const,
    storageTable: null,
  });
}

export function isAuthorizationCodeConsumable(
  record: AuthorizationCodeConformanceRecord | undefined,
  nowEpochSeconds: number,
): boolean {
  if (!record || record.consumed !== undefined) {
    return false;
  }

  return record.exp === undefined || record.exp > nowEpochSeconds;
}

export function assertAuthorizationCodeBinding(
  record: AuthorizationCodeConformanceRecord | undefined,
  clientId: string,
): void {
  if (!record) {
    throw new Error('authorization code not found');
  }
  if (record.clientId !== clientId) {
    throw new Error('authorization code client mismatch');
  }
}
