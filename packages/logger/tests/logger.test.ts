import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, flushLogger } from '../src/index.js';

describe('Centralized Logger (@moonwitness/logger)', () => {
  const testLogDir = path.resolve(process.cwd(), 'tmp-test-logs');
  const testLogFile = 'test-run.log';

  afterAll(() => {
    try {
      if (fs.existsSync(testLogDir)) {
        fs.rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('should initialize logger with default silent in test if configured', () => {
    const log = createLogger({ level: 'silent' });
    expect(log).toBeDefined();
    expect(log.level).toBe('silent');
  });

  it('should create logger writing to a destination file', async () => {
    const log = createLogger({
      name: 'test-logger',
      level: 'info',
      logDir: testLogDir,
      logFileName: testLogFile,
      enableFile: true,
      enableConsole: false,
    });

    log.info({ test: 123 }, 'Hello world log test');

    // Wait slightly for pino transport worker thread to flush
    await new Promise((r) => setTimeout(r, 200));

    const fullFilePath = path.join(testLogDir, testLogFile);
    expect(fs.existsSync(fullFilePath)).toBe(true);

    const content = fs.readFileSync(fullFilePath, 'utf-8');
    expect(content).toContain('Hello world log test');
    expect(content).toContain('"test":123');
  });

  it('redacts credentials in structured and nested log fields', async () => {
    const log = createLogger({
      name: 'secret-redaction',
      level: 'info',
      logDir: testLogDir,
      logFileName: 'redaction.log',
      enableFile: true,
      enableConsole: false,
    });

    log.error(
      {
        password: 'sentinel-password',
        user: { password: 'sentinel-nested-password' },
        refresh_token: 'sentinel-refresh-token',
        session: { refresh_token: 'sentinel-nested-refresh-token' },
        access_token: 'sentinel-access-token',
        req: { headers: { authorization: 'Bearer sentinel-authorization' } },
      },
      'credential redaction probe'
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(path.join(testLogDir, 'redaction.log'), 'utf8');
    for (const sentinel of [
      'sentinel-password',
      'sentinel-nested-password',
      'sentinel-refresh-token',
      'sentinel-nested-refresh-token',
      'sentinel-access-token',
      'sentinel-authorization',
    ]) {
      expect(content).not.toContain(sentinel);
    }
    expect(content).toContain('[redacted]');
  });

  it('redacts secrets nested 4+ levels deep with MW_AI_ and apiKey patterns', async () => {
    const log = createLogger({
      name: 'deep-redaction',
      level: 'info',
      logDir: testLogDir,
      logFileName: 'deep-redaction.log',
      enableFile: true,
      enableConsole: false,
    });

    log.info(
      {
        level1: {
          level2: {
            level3: {
              level4: {
                token: 'deep-token-value',
                secret: 'deep-secret-value',
                apiKey: 'deep-apikey-value',
                MW_AI_API_KEY: 'deep-mw-ai-value',
                password: 'deep-password-value',
                normalField: 'should-not-be-redacted',
              },
            },
          },
        },
        topLevelToken: 'top-token',
        MW_AI_SECRET: 'top-mw-secret',
      },
      'deep nested secret redaction probe'
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(path.join(testLogDir, 'deep-redaction.log'), 'utf8');
    for (const sentinel of [
      'deep-token-value',
      'deep-secret-value',
      'deep-apikey-value',
      'deep-mw-ai-value',
      'deep-password-value',
      'top-token',
      'top-mw-secret',
    ]) {
      expect(content).not.toContain(sentinel);
    }
    expect(content).toContain('should-not-be-redacted');
    expect(content).toContain('[redacted]');
  });

  it('redacts secrets in arrays at any depth', async () => {
    const log = createLogger({
      name: 'array-redaction',
      level: 'info',
      logDir: testLogDir,
      logFileName: 'array-redaction.log',
      enableFile: true,
      enableConsole: false,
    });

    log.info(
      {
        tokens: [
          { secret: 'nested-in-array-secret' },
          [{ apiKey: 'deep-in-nested-array' }],
        ],
        credentials: [
          { password: 'pass-1' },
          { password: 'pass-2' },
        ],
      },
      'array secret redaction probe'
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(path.join(testLogDir, 'array-redaction.log'), 'utf8');
    for (const sentinel of [
      'nested-in-array-secret',
      'deep-in-nested-array',
      'pass-1',
      'pass-2',
    ]) {
      expect(content).not.toContain(sentinel);
    }
    expect(content).toContain('[redacted]');
  });

  it('flushLogger flushes async destination without message loss', async () => {
    const log = createLogger({
      name: 'flush-test',
      level: 'info',
      logDir: testLogDir,
      logFileName: 'flush.log',
      enableFile: true,
      enableConsole: false,
    });

    log.info({ msg: 'before-flush' }, 'before flush');
    await new Promise((r) => setTimeout(r, 200));
    await log.flush?.();

    const content1 = fs.readFileSync(path.join(testLogDir, 'flush.log'), 'utf8');
    expect(content1).toContain('before-flush');

    log.info({ msg: 'after-flush' }, 'after flush');
    await new Promise((r) => setTimeout(r, 200));
    await log.flush?.();

    const content2 = fs.readFileSync(path.join(testLogDir, 'flush.log'), 'utf8');
    expect(content2).toContain('after-flush');
  });

  it('does not log raw paths when no matched route template is available', async () => {
    const log = createLogger({
      name: 'request-url-redaction',
      level: 'info',
      logDir: testLogDir,
      logFileName: 'request-url-redaction.log',
      enableFile: true,
      enableConsole: false,
    });

    log.info(
      {
        req: {
          method: 'GET',
          url: '/api/base.user?search=private-canary&token=query-token#private-fragment',
          hostname: 'localhost',
          remoteAddress: '127.0.0.1',
          remotePort: 3000,
        },
      },
      'request URL privacy probe'
    );
    log.info(
      { req: { method: 'GET', url: 'https://example.test/admin?token=absolute-token#private' } },
      'absolute URL privacy probe'
    );
    log.info(
      { req: { method: 'GET', url: 'http://user:malformed-secret@[' } },
      'malformed URL privacy probe'
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(path.join(testLogDir, 'request-url-redaction.log'), 'utf8');
    expect(content.match(/\[unmatched\]/g)).toHaveLength(3);
    for (const sensitiveValue of [
      'private-canary',
      'query-token',
      'private-fragment',
      'absolute-token',
      'example.test',
      'malformed-secret',
    ]) {
      expect(content).not.toContain(sensitiveValue);
    }
  });
});
