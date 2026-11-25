import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/env.js';

const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-123';
const SETUP_TOKEN = 'test-setup-token-abc123';
const NEW_LOGIN = 'newrootadmin';
const NEW_PASSWORD = 'newrootpassword123';

describe('first-boot setup claim lifecycle and conditional HSTS', () => {
  let db: Knex;
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // No superadminPassword: seeded superadmin stays password=null so the setup claim is available.
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    app = await buildApp({
      db,
      jwtSecret: TEST_JWT_SECRET,
      loginRateMax: 1000,
      // Empty string bypasses config.superadminPassword so the seeded superadmin
      // keeps password=null, making the first-boot setup claim available.
      superadminPassword: '',
    });
    await app.ready();
  }, 30000);

  afterAll(async () => {
    delete process.env.MW_SETUP_TOKEN;
    await app.close();
    await db.destroy();
  });

  it('reports setupRequired=false when MW_SETUP_TOKEN is unset (fail-closed)', async () => {
    delete process.env.MW_SETUP_TOKEN;
    const res = await app.inject({ method: 'GET', url: '/auth/setup-status' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ success: true, data: { setupRequired: false } });
  });

  it('claims setup: 401 wrong token, 201 valid claim, login, replay 409, setupRequired=false', async () => {
    process.env.MW_SETUP_TOKEN = SETUP_TOKEN;

    // Setup is required while unclaimed.
    const statusRes = await app.inject({ method: 'GET', url: '/auth/setup-status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().data.setupRequired).toBe(true);

    // Wrong token -> 401.
    const wrongTokenRes = await app.inject({
      method: 'POST',
      url: '/auth/setup-claim',
      payload: { setup_token: 'definitely-wrong-token', login: NEW_LOGIN, password: NEW_PASSWORD },
    });
    expect(wrongTokenRes.statusCode).toBe(401);
    expect(wrongTokenRes.json().success).toBe(false);

    // Valid claim -> 201 with token response; webhook secrets never present.
    const claimRes = await app.inject({
      method: 'POST',
      url: '/auth/setup-claim',
      payload: {
        setup_token: SETUP_TOKEN,
        login: NEW_LOGIN,
        password: NEW_PASSWORD,
        name: 'Root Administrator',
        email: 'root@example.com',
      },
    });
    expect(claimRes.statusCode).toBe(201);
    expect(claimRes.headers['cache-control']).toBe('no-store');
    const claimBody = claimRes.json<{
      success: boolean;
      data: { access_token: string; user: { login: string; role: string } };
    }>();
    expect(claimBody.success).toBe(true);
    expect(claimBody.data.user.login).toBe(NEW_LOGIN);
    expect(claimBody.data.user.role).toBe('superadmin');
    expect(claimBody.data.access_token).toBeTruthy();

    // Can log in with the newly claimed credentials and password.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: NEW_LOGIN, password: NEW_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().data.user.login).toBe(NEW_LOGIN);

    // Replay -> 409 (already claimed).
    const replayRes = await app.inject({
      method: 'POST',
      url: '/auth/setup-claim',
      payload: { setup_token: SETUP_TOKEN, login: 'anotherroot', password: 'anotherrootpass123' },
    });
    expect(replayRes.statusCode).toBe(409);
    expect(replayRes.json().success).toBe(false);

    // Setup is no longer required after a successful claim.
    const statusAfterRes = await app.inject({ method: 'GET', url: '/auth/setup-status' });
    expect(statusAfterRes.json().data.setupRequired).toBe(false);
  });

  it('emits strict-transport-security only on HTTPS requests in production', async () => {
    const originalEnv = config.env;
    (config as { env: string }).env = 'production';
    try {
      // Plain HTTP request: no HSTS header.
      const httpRes = await app.inject({ method: 'GET', url: '/auth/setup-status' });
      expect(httpRes.statusCode).toBe(200);
      expect(httpRes.headers['strict-transport-security']).toBeUndefined();

      // Forwarded HTTPS request: HSTS header present.
      const httpsRes = await app.inject({
        method: 'GET',
        url: '/auth/setup-status',
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(httpsRes.statusCode).toBe(200);
      expect(httpsRes.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(httpsRes.headers['strict-transport-security']).toContain('includeSubDomains');
    } finally {
      (config as { env: string }).env = originalEnv;
    }
  });
});
