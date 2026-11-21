import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { canAccess } from '../src/auth/policy.js';
import { DisabledAttachmentScanner } from '../src/whatsapp/clamav-scanner.js';
import { Registry } from '@moonwitness/orm';

const TEST_JWT_SECRET = 'test-api-orm-hardening-secret-value-at-least-32-chars';

describe('API & ORM architectural hardening', { timeout: 20_000 }, () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    while (apps.length) {
      await apps.pop()!.close();
    }
    Registry.clear();
  });

  async function createTestApp() {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const app = await buildApp({
      db,
      jwtSecret: TEST_JWT_SECRET,
      superadminPassword: 'superadmin-test-password',
      attachmentScanner: new DisabledAttachmentScanner(),
    });
    apps.push(app);
    return app;
  }

  async function loginAs(
    app: Awaited<ReturnType<typeof buildApp>>,
    login: string,
    password: string
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login, password },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.access_token as string;
  }

  it('blocks every knowledge.* model from generic CRUD and JSON-RPC for all roles', () => {
    const knowledgeModels = [
      'knowledge.bug_case',
      'knowledge.bug_case_event',
      'knowledge.publication_snapshot',
      'knowledge.research_graph_release',
      'knowledge.research_review_event',
      'knowledge.research_actor_identity',
      'knowledge.concept_profile_version',
      'knowledge.future_sensitive_model',
    ];
    for (const model of knowledgeModels) {
      for (const role of ['user', 'superadmin', 'system']) {
        for (const op of ['read', 'create', 'write', 'unlink', 'action'] as const) {
          expect(canAccess(role, model, op)).toBe(false);
        }
      }
    }
  });

  it('does not leak internal model names on 404 modelNotFound responses', async () => {
    const app = await createTestApp();
    const token = await loginAs(app, 'superadmin', 'superadmin-test-password');
    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent.model',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe("Model 'nonexistent.model' not found");
    expect(body.error).not.toContain('Available models');
    expect(body.error).not.toContain('auth.');
    expect(body.error).not.toContain('knowledge.');
  });

  it('enforces optimistic concurrency via If-Match / x-expected-write-date on PUT/PATCH', async () => {
    const app = await createTestApp();
    const token = await loginAs(app, 'superadmin', 'superadmin-test-password');

    const created = await app.inject({
      method: 'POST',
      url: '/api/base.tag',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Initial Tag' },
    });
    expect(created.statusCode).toBe(201);
    const record = created.json().data as { id: number; write_date: string };

    const staleAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/base.tag/${record.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'if-match': '"1999-01-01T00:00:00.000Z"',
      },
      payload: { name: 'Stale Overwrite' },
    });
    expect(staleAttempt.statusCode).toBe(409);
    expect(staleAttempt.json().error).toMatch(/modified by another request/i);

    const freshAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/base.tag/${record.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'if-match': `"${record.write_date}"`,
      },
      payload: { name: 'Updated Tag' },
    });
    expect(freshAttempt.statusCode).toBe(200);
    expect(freshAttempt.json().data.name).toBe('Updated Tag');
  });

  it('supports route-level config.public opt-in in authPlugin', async () => {
    const app = await createTestApp();
    app.get('/custom/public-probe', { config: { public: true } }, async () => ({
      success: true,
    }));
    const response = await app.inject({ method: 'GET', url: '/custom/public-probe' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });
});
