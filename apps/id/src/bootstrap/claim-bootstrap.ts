import { createHash } from 'node:crypto';

import {
  createFirstOwner,
  FIRST_OWNER_GENERIC_FAILURE,
  type OwnerDatabasePort,
} from './create-first-owner.js';

export const CLAIM_FAILURE = 'Initial setup is no longer available';
export const MAX_CLAIM_FIELD_LENGTH = 512;
export const MIN_CLAIM_PASSWORD_LENGTH = 12;

export interface ClaimBootstrapInput {
  readonly transactionDatabase: OwnerDatabasePort;
  readonly setupToken: string;
  readonly identifierType: 'email' | 'username';
  readonly identifierValue: string;
  readonly password: string;
  readonly installationScope?: string;
  readonly now?: Date;
  readonly isSecure?: boolean;
  readonly createAccount?: typeof createFirstOwner;
}

export interface ClaimBootstrapResult {
  readonly complete: true;
  readonly nextStep: 'Sign in with your identity provider account';
}

export class ClaimBootstrapError extends Error {
  override readonly name = 'ClaimBootstrapError';
}

function fail(cause?: unknown): ClaimBootstrapError {
  return new ClaimBootstrapError(CLAIM_FAILURE, cause === undefined ? undefined : { cause });
}

export function digestClaimToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function assertClaimInput(input: ClaimBootstrapInput): void {
  if (input.isSecure === false) throw fail('insecure transport');
  for (const value of [input.setupToken, input.identifierValue, input.password]) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CLAIM_FIELD_LENGTH) {
      throw fail('invalid field length');
    }
  }
  if (input.identifierType !== 'email' && input.identifierType !== 'username') {
    throw fail('invalid identifier type');
  }
  if (input.password.length < MIN_CLAIM_PASSWORD_LENGTH) throw fail('weak password');
}

export async function claimBootstrap(
  input: ClaimBootstrapInput
): Promise<ClaimBootstrapResult> {
  assertClaimInput(input);
  const createOwner = input.createAccount ?? createFirstOwner;
  try {
    await createOwner({
      transactionDatabase: input.transactionDatabase,
      bootstrapTokenDigest: digestClaimToken(input.setupToken),
      identifierType: input.identifierType,
      identifierValue: input.identifierValue,
      password: input.password,
      installationScope: input.installationScope,
      now: input.now,
    });
    return Object.freeze({ complete: true as const, nextStep: 'Sign in with your identity provider account' as const });
  } catch (error) {
    throw fail(error);
  }
}

export function redactClaimForLog(fields: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    output[key] = '[REDACTED]';
  }
  return output;
}
