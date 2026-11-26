import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  authRoutes,
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type AuthRoutesOptions,
} from './auth.routes.js';
import { LOGIN_FAILURE } from '../auth/login-service.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const session = {
  sessionId: 'session-1',
  accountSubject: 'subject-1',
  clientId: 'board',
  expiresAt: '2026-01-01T08:00:00.000Z',
  metadata: {},
};

function app(options: Partial<AuthRoutesOptions> = {}) {
  const instance = Fastify({ logger: false });
  const resolved: AuthRoutesOptions = {
    login: vi.fn(async () => session),
    readSession: vi.fn(async () => ({
      accountSubject: session.accountSubject,
      expiresAt: session.expiresAt,
    })),
    database: { raw: vi.fn(async () => ({ rows: [] })) },
    now: () => NOW,
    production: false,
    ...options,
  };
  return { instance: instance.register(authRoutes, resolved), resolved };
}

function cookies(response: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  return Object.fromEntries(
    response.cookies.map((cookie) => {
      return [cookie.name, cookie.value];
    })
  );
}

function setCookie(response: { headers: Record<string, unknown> }, name: string): string {
  const values = response.headers['set-cookie'];
  const cookies = Array.isArray(values) ? values.map(String) : values === undefined ? [] : [String(values)];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`missing cookie: ${name}`);
  return cookie;
}

describe('identity auth routes', () => {
  it('logs in with secure cookie attributes and no raw credential in the body', async () => {
    const { instance, resolved } = app({ production: true });
    const response = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        identifierType: 'email',
        identifierValue: 'owner@example.com',
        password: 'generated-password',
        clientId: 'board',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accountSubject).toBe('subject-1');
    expect(JSON.stringify(response.json())).not.toContain(session.sessionId);
    expect(JSON.stringify(response.json())).not.toContain('generated-password');
    const csrf = cookies(response)[CSRF_COOKIE];
    expect(csrf).toBe(response.json().csrfToken);
    const sessionCookie = setCookie(response, SESSION_COOKIE);
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain(`Path=/`);
    expect(sessionCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(resolved.login).toHaveBeenCalledTimes(1);
    await instance.close();
  });

  it('reports current session only for an unexpired, unrevoked cookie', async () => {
    let isRevoked = false;
    const readSession = vi.fn(async () => ({
      accountSubject: session.accountSubject,
      expiresAt: session.expiresAt,
      ...(isRevoked ? { revokedAt: NOW.toISOString() } : {}),
    }));
    const { instance } = app({ readSession });
    await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifierType: 'email', identifierValue: 'owner@example.com', password: 'pw' },
    });
    const current = await instance.inject({
      method: 'GET',
      url: '/auth/session',
      cookies: { [SESSION_COOKIE]: session.sessionId },
    });
    expect(current.json()).toEqual({
      authenticated: true,
      accountSubject: session.accountSubject,
      expiresAt: session.expiresAt,
    });

    const missing = await instance.inject({ method: 'GET', url: '/auth/session' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ authenticated: false });

    isRevoked = true;
    const revokedResponse = await instance.inject({
      method: 'GET',
      url: '/auth/session',
      cookies: { [SESSION_COOKIE]: session.sessionId },
    });
    expect(revokedResponse.statusCode).toBe(401);
    expect(revokedResponse.json()).toEqual({ authenticated: false });
    await instance.close();
  });

  it('revokes session state on CSRF-authenticated logout', async () => {
    const raw = vi.fn(async () => ({ rows: [] }));
    const { instance } = app({ database: { raw } });
    const login = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifierType: 'email', identifierValue: 'owner@example.com', password: 'pw' },
    });
    const csrf = cookies(login)[CSRF_COOKIE];
    const response = await instance.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: session.sessionId, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ loggedOut: true });
    expect(raw).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE identity.session SET revoked_at'),
      [NOW.toISOString(), session.sessionId]
    );
    await instance.close();
  });

  it('rejects logout without a matching CSRF token', async () => {
    const { instance } = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: session.sessionId, [CSRF_COOKIE]: 'csrf-1' },
      headers: { [CSRF_HEADER]: 'different' },
    });
    expect(response.statusCode).toBe(403);
    await instance.close();
  });

  it('hides login failures and exposes no self-registration route', async () => {
    const { instance } = app({
      login: vi.fn(async () => {
        throw new Error('password-plaintext-must-not-leak');
      }),
    });
    const failed = await instance.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifierType: 'email', identifierValue: 'owner@example.com', password: 'pw' },
    });
    expect(failed.statusCode).toBe(401);
    expect(failed.body).toBe(JSON.stringify({ error: LOGIN_FAILURE }));
    expect(failed.body).not.toContain('password-plaintext-must-not-leak');

    for (const url of ['/auth/register', '/register', '/setup/register']) {
      const registered = await instance.inject({ method: 'POST', url, payload: {} });
      expect(registered.statusCode).toBe(404);
    }
    await instance.close();
  });
});
