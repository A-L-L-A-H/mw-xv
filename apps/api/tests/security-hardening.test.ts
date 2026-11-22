import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ClamAvScanner,
  DisabledAttachmentScanner,
  createAttachmentScanner,
} from '../src/whatsapp/clamav-scanner.js';
import { buildApp, resolveCorsOrigin } from '../src/app.js';
import knex from 'knex';

describe('API foundation security hardening', () => {
  it('resolves CORS origins restrictively in production and permissively in development', () => {
    expect(resolveCorsOrigin({}, 'production')).toBe(false);
    expect(resolveCorsOrigin({}, 'development')).toBe(true);
    expect(
      resolveCorsOrigin(
        { CORS_ORIGINS: 'https://board.moonwitness.biz.id, https://app.moonwitness.biz.id' },
        'production'
      )
    ).toEqual(['https://board.moonwitness.biz.id', 'https://app.moonwitness.biz.id']);
    expect(() =>
      resolveCorsOrigin({ CORS_ORIGINS: 'https://board.moonwitness.biz.id/path' }, 'production')
    ).toThrow(/CORS_ORIGINS/u);
    expect(() => resolveCorsOrigin({ CORS_ORIGINS: 'ftp://example.com' }, 'production')).toThrow(
      /CORS_ORIGINS/u
    );
  });

  it('requires explicit WHATSAPP_MEDIA_SCAN=disabled or WHATSAPP_CLAMAV_URL for media scanning', async () => {
    expect(createAttachmentScanner(undefined, {})).toBeNull();

    const disabled = createAttachmentScanner(undefined, { WHATSAPP_MEDIA_SCAN: 'disabled' });
    expect(disabled).toBeInstanceOf(DisabledAttachmentScanner);
    await expect(disabled!.scan(Readable.from([Buffer.from('ok')]))).resolves.toEqual({
      status: 'clean',
    });
    await expect(disabled!.ping()).resolves.toBe(true);

    const clam = createAttachmentScanner('tcp://127.0.0.1:3310', {
      WHATSAPP_MEDIA_SCAN: 'disabled',
    });
    expect(clam).toBeInstanceOf(ClamAvScanner);
  });

  it('attaches baseline HTTP security headers to API responses', async () => {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const app = await buildApp({
      db,
      jwtSecret: 'test-hardening-secret-value-at-least-32-chars',
      attachmentScanner: new DisabledAttachmentScanner(),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/livez' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['permissions-policy']).toBe(
        'camera=(), microphone=(), geolocation=()'
      );
      expect(response.headers['x-request-id']).toBeTruthy();
    } finally {
      await app.close();
    }
  }, 15_000);
});
