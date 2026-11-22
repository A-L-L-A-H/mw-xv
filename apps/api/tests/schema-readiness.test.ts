import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('API schema readiness', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('keeps liveness available while rejecting traffic before schema is applied', async () => {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    app = await buildApp({
      db,
      installSchema: false,
      schemaReadiness: {
        ready: false,
        status: 'running',
        version: 1,
        digest: 'abc123abc123abcd',
      },
      superadminPassword: 'schema-readiness-test-password',
      jwtSecret: 'test-secret-test-secret-test-secret-123',
    });
    await app.ready();

    expect((await app.inject('/livez')).statusCode).toBe(200);
    const readiness = await app.inject('/readyz');
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      status: 'unhealthy',
      schema: { status: 'running', version: 1, digest: 'abc123abc123abcd' },
    });
    const blocked = await app.inject('/api/models');
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toMatchObject({ code: 'SCHEMA_NOT_READY' });

    app.schemaReadiness.ready = true;
    app.schemaReadiness.status = 'applied';
    expect((await app.inject('/readyz')).statusCode).toBe(200);
    expect((await app.inject('/api/models')).statusCode).toBe(401);
  });
});
