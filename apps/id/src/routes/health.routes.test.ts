import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { healthRoutes } from './health.routes.js';

async function buildHealthApp(options: {
  checkDatabase?: () => Promise<boolean>;
  checkMigrations?: () => Promise<boolean>;
}) {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes, options);
  return app;
}

describe('Identity health routes', () => {
  it('reports liveness without database checks', async () => {
    const app = await buildHealthApp({ checkDatabase: async () => false });
    const response = await app.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'alive' });
    await app.close();
  });

  it('reports ready only when database and migrations succeed', async () => {
    const app = await buildHealthApp({
      checkDatabase: async () => true,
      checkMigrations: async () => true,
    });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'healthy',
      database: 'connected',
      migrations: 'applied',
    });
    await app.close();
  });

  it('returns non-ready and redacted output when dependencies fail', async () => {
    for (const options of [
      { checkDatabase: async () => false, checkMigrations: async () => true },
      { checkDatabase: async () => true, checkMigrations: async () => false },
      {
        checkDatabase: async () => {
          throw new Error('postgresql://user:secret@db/identity');
        },
      },
    ]) {
      const app = await buildHealthApp(options);
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('secret');
      expect(response.body).not.toContain('postgresql://');
      await app.close();
    }
  });
});
