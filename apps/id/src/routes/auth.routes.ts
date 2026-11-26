import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { LOGIN_FAILURE, type LoginInput, type LoginSession, type LoginError } from '../auth/login-service.js';
import {
  checkLoginRateLimit,
  LOGIN_RATE_LIMIT_FAILURE,
  type LoginRateLimitOptions,
} from '../security/login-rate-limit.js';

export const SESSION_COOKIE = 'mw_id_session';
export const CSRF_COOKIE = 'mw_id_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_PATH = '/';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface AuthDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface AuthLoginPort {
  readonly login: (input: Omit<LoginInput, 'database' | 'now'>) => Promise<LoginSession>;
}

export interface AuthSessionLookup {
  readonly database?: AuthDatabasePort;
  readonly login: AuthLoginPort['login'];
  readonly readSession?: (sessionId: string) => Promise<{
    readonly accountSubject: string;
    readonly expiresAt: string;
    readonly revokedAt?: string | null;
  } | undefined>;
}

export interface AuthRoutesOptions extends AuthSessionLookup {
  readonly now?: () => Date;
  readonly production?: boolean;
  readonly trustedProxy?: boolean;
}

function serializeCookie(
  name: string,
  value: string,
  options: AuthRoutesOptions,
  attributes: { readonly httpOnly: boolean; readonly maxAge?: number }
): string {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new Error('invalid cookie name');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${SESSION_PATH}`];
  if (attributes.httpOnly) parts.push('HttpOnly');
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`);
  parts.push('SameSite=Lax');
  if (options.production ?? process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readCookies(request: { readonly headers: Record<string, unknown> }): Record<string, string> {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return {};
  const cookies: Record<string, string> = Object.create(null);
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!COOKIE_NAME_PATTERN.test(name) || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function expiredCookie(name: string): string {
  return `${name}=; Path=${SESSION_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function setCookie(reply: FastifyReply, value: string): void {
  const existing = reply.getHeader('Set-Cookie');
  const cookies = existing === undefined
    ? [value]
    : Array.isArray(existing)
      ? [...existing.map(String), value]
      : [String(existing), value];
  reply.header('Set-Cookie', cookies);
}

function clearSessionCookies(reply: FastifyReply, options: AuthRoutesOptions): void {
  const suffix = (options.production ?? process.env.NODE_ENV === 'production') ? '; Secure' : '';
  setCookie(reply, expiredCookie(SESSION_COOKIE) + suffix);
  setCookie(reply, expiredCookie(CSRF_COOKIE) + suffix);
}

async function readSessionFromDatabase(
  options: AuthRoutesOptions,
  sessionId: string
): Promise<{
  readonly accountSubject: string;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
} | undefined> {
  if (!options.database) return undefined;
  const rows = await options.database.raw(
    `SELECT account_subject, expires_at, revoked_at
     FROM identity.session
     WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
     LIMIT 1`,
    [sessionId, (options.now?.() ?? new Date()).toISOString()]
  ).catch(() => undefined);
  const row = Array.isArray(rows)
    ? rows[0]
    : rows && typeof rows === 'object' && 'rows' in rows && Array.isArray((rows as { rows: unknown }).rows)
      ? (rows as { rows: unknown[] }).rows[0]
      : undefined;
  if (!row || typeof row !== 'object') return undefined;
  const session = row as Record<string, unknown>;
  if (typeof session.account_subject !== 'string' || typeof session.expires_at !== 'string') return undefined;
  return {
    accountSubject: session.account_subject,
    expiresAt: session.expires_at,
    ...(typeof session.revoked_at === 'string' ? { revokedAt: session.revoked_at } : {}),
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, options) => {
  const rateLimitOptions: LoginRateLimitOptions = {
    database: options.database,
    trustedProxy: options.trustedProxy,
    now: options.now,
  };

  fastify.post('/auth/login', async (request, reply) => {
    const rateLimit = await checkLoginRateLimit(rateLimitOptions, request);
    if (!rateLimit.allowed) {
      return reply
        .header('Cache-Control', 'no-store')
        .header('Retry-After', String(rateLimit.retryAfterSeconds ?? 60))
        .status(429)
        .send({ error: LOGIN_RATE_LIMIT_FAILURE });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const csrfToken = randomBytes(24).toString('base64url');
    try {
      const session = await options.login({
        identifierType: body.identifierType as 'email' | 'username',
        identifierValue: String(body.identifierValue ?? ''),
        password: String(body.password ?? ''),
        clientId: String(body.clientId ?? 'identity'),
        device: typeof body.device === 'string' ? body.device : undefined,
        userAgent: request.headers['user-agent'],
      });
      reply
        .header('Cache-Control', 'no-store')
        .header('Set-Cookie', [
          serializeCookie(CSRF_COOKIE, csrfToken, options, { httpOnly: false, maxAge: SESSION_MAX_AGE_SECONDS }),
          serializeCookie(SESSION_COOKIE, session.sessionId, options, {
            httpOnly: true,
            maxAge: SESSION_MAX_AGE_SECONDS,
          }),
        ]);
      return reply.send({
        accountSubject: session.accountSubject,
        expiresAt: session.expiresAt,
        csrfToken,
      });
    } catch (error) {
      request.log.warn({ reason: LOGIN_FAILURE }, 'identity login rejected');
      clearSessionCookies(reply, options);
      return reply.header('Cache-Control', 'no-store').status(401).send({ error: LOGIN_FAILURE });
    }
  });

  fastify.get('/auth/session', async (request, reply) => {
    const sessionId = readCookies(request)[SESSION_COOKIE];
    if (!sessionId || !options.readSession) {
      return reply.header('Cache-Control', 'no-store').status(401).send({ authenticated: false });
    }
    const session = options.readSession
      ? await options.readSession(sessionId).catch(() => undefined)
      : await readSessionFromDatabase(options, sessionId);
    const now = options.now?.() ?? new Date();
    if (
      !session ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= now.getTime()
    ) {
      clearSessionCookies(reply, options);
      return reply.header('Cache-Control', 'no-store').status(401).send({ authenticated: false });
    }
    return reply.header('Cache-Control', 'no-store').send({
      authenticated: true,
      accountSubject: session.accountSubject,
      expiresAt: session.expiresAt,
    });
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const cookies = readCookies(request);
    const sessionId = cookies[SESSION_COOKIE];
    const csrfCookie = cookies[CSRF_COOKIE];
    const csrfHeader = request.headers[CSRF_HEADER];
    if (
      !sessionId ||
      !csrfCookie ||
      typeof csrfHeader !== 'string' ||
      !safeEqual(csrfCookie, csrfHeader)
    ) {
      return reply.header('Cache-Control', 'no-store').status(403).send({ error: 'CSRF check failed' });
    }

    try {
      if (!options.database) throw new Error('database unavailable');
      await options.database.raw(
        `UPDATE identity.session SET revoked_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
        [(options.now?.() ?? new Date()).toISOString(), sessionId]
      );
    } catch {
      return reply.header('Cache-Control', 'no-store').status(503).send({ error: 'Logout unavailable' });
    }

    clearSessionCookies(reply, options);
    return reply.header('Cache-Control', 'no-store').send({ loggedOut: true });
  });
};
