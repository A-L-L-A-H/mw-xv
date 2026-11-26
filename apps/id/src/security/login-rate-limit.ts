import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthDatabasePort } from '../routes/auth.routes.js';

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 10;
const CLAIM_WINDOW_SECONDS = 60 * 60;
const CLAIM_MAX_ATTEMPTS = 5;

export interface LoginRateLimitOptions {
  readonly database?: AuthDatabasePort;
  readonly trustedProxy?: boolean;
  readonly now?: () => Date;
}

export interface LoginRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export const LOGIN_RATE_LIMIT_FAILURE = 'Too many attempts, please try again later';

let ephemeralSalt: string | undefined;

function resolveSalt(): string {
  const configured =
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT?.trim() ||
    process.env.IDENTITY_INTERNAL_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('IDENTITY_LOGIN_RATE_LIMIT_SALT or equivalent must be set in production');
  }
  ephemeralSalt ??= randomBytes(32).toString('hex');
  return ephemeralSalt;
}

function getClientKey(
  request: { readonly headers: Record<string, unknown>; readonly ip?: string },
  trustedProxy: boolean
): string {
  if (trustedProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = request.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp;
  }
  return request.ip ?? '127.0.0.1';
}

export function hashKey(key: string): string {
  const salt = resolveSalt();
  return createHmac('sha256', salt).update(key).digest('hex');
}

async function countAttempts(
  database: AuthDatabasePort | undefined,
  identifierHash: string,
  windowStart: Date
): Promise<number> {
  if (!database) return 0;
  const rows = await database.raw(
    `SELECT count(*) as count FROM identity.login_attempt
     WHERE identifier_hash = ? AND created_at >= ?`,
    [identifierHash, windowStart]
  ).catch(() => undefined);
  const row = Array.isArray(rows)
    ? rows[0]
    : rows && typeof rows === 'object' && 'rows' in rows && Array.isArray((rows as { rows: unknown }).rows)
      ? (rows as { rows: unknown[] }).rows[0]
      : undefined;
  if (!row || typeof row !== 'object') return 0;
  const count = (row as Record<string, unknown>).count;
  return Number(count) || 0;
}

async function recordAttempt(
  database: AuthDatabasePort | undefined,
  identifierHash: string
): Promise<void> {
  if (!database) return;
  await database.raw(
    `INSERT INTO identity.login_attempt (identifier_hash, created_at) VALUES (?, ?)`,
    [identifierHash, new Date().toISOString()]
  ).catch(() => undefined);
}

async function pruneExpired(
  database: AuthDatabasePort | undefined,
  windowStart: Date
): Promise<void> {
  if (!database) return;
  await database.raw(
    `DELETE FROM identity.login_attempt WHERE created_at < ?`,
    [windowStart]
  ).catch(() => undefined);
}

export async function checkLoginRateLimit(
  options: LoginRateLimitOptions,
  request: { readonly headers: Record<string, unknown>; readonly ip?: string }
): Promise<LoginRateLimitResult> {
  const now = options.now?.() ?? new Date();
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_SECONDS * 1000);
  const clientKey = getClientKey(request, options.trustedProxy ?? false);
  const identifierHash = hashKey(clientKey);

  await pruneExpired(options.database, windowStart);

  const attempts = await countAttempts(options.database, identifierHash, windowStart);
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((windowStart.getTime() + LOGIN_WINDOW_SECONDS * 1000 - now.getTime()) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  await recordAttempt(options.database, identifierHash);
  return { allowed: true };
}

export async function checkClaimRateLimit(
  options: LoginRateLimitOptions,
  request: { readonly headers: Record<string, unknown>; readonly ip?: string }
): Promise<LoginRateLimitResult> {
  const now = options.now?.() ?? new Date();
  const windowStart = new Date(now.getTime() - CLAIM_WINDOW_SECONDS * 1000);
  const clientKey = getClientKey(request, options.trustedProxy ?? false);
  const identifierHash = hashKey(clientKey);

  await pruneExpired(options.database, windowStart);

  const attempts = await countAttempts(options.database, identifierHash, windowStart);
  if (attempts >= CLAIM_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((windowStart.getTime() + CLAIM_WINDOW_SECONDS * 1000 - now.getTime()) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  await recordAttempt(options.database, identifierHash);
  return { allowed: true };
}

export function constantTimeVerify(stored: string, provided: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
