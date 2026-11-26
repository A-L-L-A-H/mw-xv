import type { Knex } from 'knex';
import type { Role } from '@moonwitness/auth';
import { User } from '@moonwitness/orm-base';

const VALID_ROLES = new Set<Role>(['system', 'superadmin', 'user']);
const MAX_SUBJECT_LENGTH = 255;
const RAW_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface IdentityPrincipalRecord {
  id: number;
  identity_subject?: string | null;
  active?: boolean | number | null;
  partner_id?: number | null;
  role?: string | null;
  token_version?: number | null;
  partner?: {
    id?: number | null;
    active?: boolean | number | null;
    company_id?: number | null;
  } | null;
}

export interface ResolvedIdentityPrincipal {
  id: number;
  userId: number;
  identitySubject: string;
  active: true;
  partnerId: number;
  partnerCompanyId?: number;
  role: Role;
  tokenVersion: number;
}

export type IdentityPrincipalFailureReason =
  | 'invalid_subject'
  | 'not_found'
  | 'inactive'
  | 'duplicate_subject';

export type IdentityPrincipalResolutionResult =
  | {
      ok: true;
      status: 'resolved';
      principal: ResolvedIdentityPrincipal;
    }
  | {
      ok: false;
      status: IdentityPrincipalFailureReason;
      principal: null;
    };

export interface IdentityPrincipalRepositoryOptions {
  db?: Knex;
  loadRecords?: (verifiedSubject: string) => Promise<readonly IdentityPrincipalRecord[]>;
}

function hasWhitespaceOrControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isValidVerifiedSubject(subject: unknown): subject is string {
  if (typeof subject !== 'string') return false;
  const trimmed = subject.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SUBJECT_LENGTH) return false;
  if (trimmed !== subject) return false;
  if (hasWhitespaceOrControlChar(subject)) return false;
  if (subject.startsWith('eyJ') && RAW_JWT_PATTERN.test(subject)) return false;
  return true;
}

function isActiveFlag(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function fail(status: IdentityPrincipalFailureReason): IdentityPrincipalResolutionResult {
  return { ok: false, status, principal: null };
}

function buildPrincipal(
  verifiedSubject: string,
  record: IdentityPrincipalRecord
): IdentityPrincipalResolutionResult {
  if (record.identity_subject !== verifiedSubject) return fail('not_found');
  if (!isActiveFlag(record.active)) return fail('inactive');
  if (!record.partner || !isActiveFlag(record.partner.active)) return fail('inactive');

  const localId = Number(record.id);
  const partnerId = Number(record.partner_id ?? record.partner.id);
  const rawRole = String(record.role ?? 'user') as Role;
  if (!Number.isInteger(localId) || localId < 1) return fail('not_found');
  if (!Number.isInteger(partnerId) || partnerId < 1) return fail('not_found');
  if (!VALID_ROLES.has(rawRole)) return fail('not_found');

  const tokenVersion =
    typeof record.token_version === 'number' &&
    Number.isInteger(record.token_version) &&
    record.token_version >= 1
      ? record.token_version
      : 1;
  const partnerCompanyId =
    typeof record.partner.company_id === 'number' && Number.isInteger(record.partner.company_id)
      ? record.partner.company_id
      : undefined;

  return {
    ok: true,
    status: 'resolved',
    principal: {
      id: localId,
      userId: localId,
      identitySubject: verifiedSubject,
      active: true,
      partnerId,
      partnerCompanyId,
      role: rawRole,
      tokenVersion,
    },
  };
}

async function queryRecordsBySubject(
  verifiedSubject: string,
  db?: Knex
): Promise<readonly IdentityPrincipalRecord[]> {
  const rows = await User.query(db)
    .context({ activeTest: false })
    .where('identity_subject', verifiedSubject)
    .withGraphFetched('partner')
    .limit(2);
  return rows as unknown as readonly IdentityPrincipalRecord[];
}

/**
 * Resolves an already-verified OIDC opaque subject (`sub`) to a single active `base.user`.
 * Fail-closed on invalid input, missing subject, duplicate mappings, or inactive user/partner.
 * Never falls back to email or login matching.
 */
export async function resolveIdentityPrincipal(
  verifiedSubject: string,
  options: IdentityPrincipalRepositoryOptions = {}
): Promise<IdentityPrincipalResolutionResult> {
  if (!isValidVerifiedSubject(verifiedSubject)) return fail('invalid_subject');

  const loader =
    options.loadRecords ?? ((subject: string) => queryRecordsBySubject(subject, options.db));
  const matches = await loader(verifiedSubject);

  if (matches.length === 0) return fail('not_found');
  if (matches.length > 1) return fail('duplicate_subject');

  const record = matches[0];
  if (!record) return fail('not_found');
  return buildPrincipal(verifiedSubject, record);
}

/**
 * Convenience helper returning the resolved active business principal or null when fail-closed.
 */
export async function findActivePrincipalByVerifiedSubject(
  verifiedSubject: string,
  options: IdentityPrincipalRepositoryOptions = {}
): Promise<ResolvedIdentityPrincipal | null> {
  const result = await resolveIdentityPrincipal(verifiedSubject, options);
  return result.ok ? result.principal : null;
}
