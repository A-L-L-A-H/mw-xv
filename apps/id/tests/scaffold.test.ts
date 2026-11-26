import { describe, expect, it } from 'vitest';

import { buildApp, IDENTITY_SERVICE_NAME } from '../src/index.js';
import { createIdentityServer } from '../src/server.js';

describe('apps/id scaffold', () => {
  it('uses the identity service package name', () => {
    expect(IDENTITY_SERVICE_NAME).toBe('@moonwitness/id');
  });

  it('builds a Fastify app without business addons or routes', async () => {
    const app = await buildApp({ logger: false });
    const routes = app.printRoutes();
    expect(routes).not.toContain('/api/');
    expect(routes).not.toContain('/orm/');
    expect(app.hasDecorator('identityConfig')).toBe(true);
    expect(app.hasDecorator('identityDatabase')).toBe(true);
    await app.close();
  });

  it('supports controlled startup and shutdown', async () => {
    const closed = new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const server = await createIdentityServer({
      logger: false,
      host: '127.0.0.1',
      port: 0,
      database: { close: () => closed },
    });
    const address = await server.start();
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await server.stop();
    await closed;
  });
});
