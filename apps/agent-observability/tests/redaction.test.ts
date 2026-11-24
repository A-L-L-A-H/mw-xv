import { describe, expect, it } from 'vitest';
import { redactTelemetry } from '../src/redaction.js';

describe('telemetry redaction', () => {
  it('redacts sensitive keys and common secret formats', () => {
    const redacted = redactTelemetry({
      password: 'plain-password',
      nested: { apiKey: 'plain-api-key' },
      message: 'Authorization: Bearer abcdef123456',
      providerKey: 'sk-proj-12345678901234567890',
      url: 'https://example.test/path?token=secret-value',
      'http.request.header.x-api-key': 'header-secret',
      jsonBody: '{"api_key":"json-secret","authorization":"opaque-secret"}',
      safe: 'workspace.search',
    });

    expect(redacted).toEqual({
      password: '[redacted]',
      nested: { apiKey: '[redacted]' },
      message: 'Authorization: Bearer [REDACTED]',
      providerKey: '[REDACTED_API_KEY]',
      url: 'https://example.test/path?token=[REDACTED]',
      'http.request.header.x-api-key': '[redacted]',
      jsonBody: '{"api_key":"[redacted]","authorization":"[redacted]"}',
      safe: 'workspace.search',
    });
  });

  it('bounds cyclic and deeply nested values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(redactTelemetry(cyclic)).toEqual({ self: '[Circular]' });

    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let index = 0; index < 20; index += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    expect(JSON.stringify(redactTelemetry(root))).toContain('[MAX_DEPTH]');
  });
});
