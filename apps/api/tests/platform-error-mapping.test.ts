import knex from 'knex';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  NotFoundError,
  PlatformError,
  SchemaSyncError,
  ValidationError,
} from '@moonwitness/types';
import { buildApp } from '../src/app.js';

describe('platform error mapping', { timeout: 30_000 }, () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  async function createTestApp() {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const instance = await buildApp({
      db,
      superadminPassword: 'platform-error-test-password',
      jwtSecret: 'platform-error-test-secret-at-least-32-chars',
    });
    instance.get('/docs/platform-error/validation', async () => {
      throw new ValidationError('Field is invalid', { details: { field: 'name' } });
    });
    instance.get('/docs/platform-error/access-denied', async () => {
      throw new AccessDeniedError();
    });
    instance.get('/docs/platform-error/not-found', async () => {
      throw new NotFoundError();
    });
    instance.get('/docs/platform-error/conflict', async () => {
      throw new ConcurrencyConflictError();
    });
    instance.get('/docs/platform-error/schema-sync', async () => {
      throw new SchemaSyncError('Indexed schema drift', { details: { table: 'base_user' } });
    });
    instance.get('/docs/platform-error/platform', async () => {
      throw new PlatformError('Unhandled platform failure');
    });
    await instance.ready();
    return instance;
  }

  it('maps each platform error subclass to its stable HTTP status in development', async () => {
    app = await createTestApp();

    const responses = [
      await app.inject('/docs/platform-error/validation'),
      await app.inject('/docs/platform-error/access-denied'),
      await app.inject('/docs/platform-error/not-found'),
      await app.inject('/docs/platform-error/conflict'),
      await app.inject('/docs/platform-error/schema-sync'),
      await app.inject('/docs/platform-error/platform'),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 403, 404, 409, 500, 500,
    ]);
    expect(responses[0]!.json()).toMatchObject({
      success: false,
      error: 'Field is invalid',
      type: 'ValidationError',
      data: { field: 'name' },
    });
    expect(responses[4]!.json()).toMatchObject({
      success: false,
      error: 'Indexed schema drift',
      type: 'SchemaSyncError',
      data: { table: 'base_user' },
    });
    expect(responses[5]!.json()).toMatchObject({
      success: false,
      error: 'Unhandled platform failure',
      type: 'PlatformError',
    });
  });

  it('sanitizes internal platform failures in production while preserving client errors', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      app = await createTestApp();

      const internalFailure = await app.inject('/docs/platform-error/platform');
      expect(internalFailure.statusCode).toBe(500);
      expect(internalFailure.json()).toMatchObject({
        success: false,
        error: 'Unhandled platform failure',
      });
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
