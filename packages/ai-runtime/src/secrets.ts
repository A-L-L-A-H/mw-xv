import { sanitizeProviderMessage } from './redaction.js';
import type { AiSecretResolver, SecretResolver } from './types.js';
import { ProviderError } from './types.js';

export const AI_SECRET_REF_PATTERN = /^MW_AI_(?:C[1-9][0-9]*_)?[A-Z0-9_]{1,100}$/u;
const COMPANY_INFIX_PATTERN = /^MW_AI_C([1-9][0-9]*)_[A-Z0-9_]{1,100}$/u;

export function isValidSecretRef(secretRef: string): boolean {
  return AI_SECRET_REF_PATTERN.test(secretRef);
}

export function extractSecretRefCompanyId(secretRef: string): number | undefined {
  const match = COMPANY_INFIX_PATTERN.exec(secretRef);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

export function assertValidSecretRef(
  secretRef: string,
  providerId = 'secret-policy',
  correlationId = 'secret-validation'
): void {
  if (!AI_SECRET_REF_PATTERN.test(secretRef)) {
    throw new ProviderError(
      `Invalid AI secret reference "${sanitizeProviderMessage(secretRef)}": must match MW_AI_* env-var naming convention`,
      {
        code: 'auth_failed',
        reasonCode: 'INVALID_SECRET_REF',
        providerId,
        correlationId,
        retryable: false,
      }
    );
  }
}

export function assertSecretRefCompanyScope(
  secretRef: string,
  companyId: number,
  providerId = 'secret-policy',
  correlationId = 'secret-validation'
): void {
  assertValidSecretRef(secretRef, providerId, correlationId);
  const embeddedCompanyId = extractSecretRefCompanyId(secretRef);
  if (embeddedCompanyId !== undefined && embeddedCompanyId !== companyId) {
    throw new ProviderError(`Cross-company secret reference rejected for company ${companyId}`, {
      code: 'auth_failed',
      reasonCode: 'INVALID_SECRET_REF',
      providerId,
      correlationId,
      retryable: false,
    });
  }
}

export function createEnvSecretResolver(
  env: Readonly<Record<string, string | undefined>> = process.env
): AiSecretResolver {
  return (secretRef: string, companyId: number): string | null => {
    assertSecretRefCompanyScope(secretRef, companyId);
    const raw = env[secretRef];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
}

export async function resolveSecretOrThrow(params: {
  readonly secretRef: string;
  readonly secretResolver: SecretResolver;
  readonly providerId: string;
  readonly correlationId: string;
  readonly companyId?: number;
}): Promise<string> {
  if (params.companyId !== undefined) {
    assertSecretRefCompanyScope(
      params.secretRef,
      params.companyId,
      params.providerId,
      params.correlationId
    );
  } else {
    assertValidSecretRef(params.secretRef, params.providerId, params.correlationId);
  }

  const resolved = await params.secretResolver(params.secretRef, params.companyId);
  if (typeof resolved !== 'string' || resolved.trim().length === 0) {
    throw new ProviderError(
      `Secret reference "${params.secretRef}" resolved to an empty or missing credential`,
      {
        code: 'auth_failed',
        reasonCode: 'SECRET_UNAVAILABLE',
        providerId: params.providerId,
        correlationId: params.correlationId,
        retryable: false,
      }
    );
  }
  return resolved.trim();
}
