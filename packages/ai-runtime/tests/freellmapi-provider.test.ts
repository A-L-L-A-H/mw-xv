import { describe, expect, it } from 'vitest';

import { isProviderCloudEgress } from '../src/classification-router.js';
import { CloudProviderAdapter } from '../src/domain-services.js';

describe('FreeLLMAPI cloud-egress provider classification', () => {
  it('is always cloud egress, even when a local deployment zone is supplied', () => {
    expect(isProviderCloudEgress({ kind: 'freellmapi' })).toBe(true);
    expect(isProviderCloudEgress({ kind: 'freellmapi' }, 'local')).toBe(true);
    expect(isProviderCloudEgress({ kind: 'freellmapi' }, 'cloud')).toBe(true);
  });

  it('keeps the existing deployment-zone behavior for other providers', () => {
    expect(isProviderCloudEgress({ kind: 'openai' }, 'local')).toBe(false);
    expect(isProviderCloudEgress({ kind: 'openai' }, 'cloud')).toBe(true);
    expect(isProviderCloudEgress({ kind: 'openai' })).toBe(true);
    expect(isProviderCloudEgress({ kind: 'ollama' })).toBe(false);
  });

  it('delegates freellmapi to the OpenAI-compatible transport without a fallback credential', () => {
    const adapter = new CloudProviderAdapter({
      id: 'freellmapi_default',
      kind: 'freellmapi',
    });
    expect(adapter.kind).toBe('freellmapi');
    expect(adapter.id).toBe('freellmapi_default');
  });

  it('accepts only the exact approved private origin', () => {
    expect(
      () =>
        new CloudProviderAdapter({
          id: 'freellmapi_default',
          kind: 'freellmapi',
          baseUrl: 'http://freellmapi:3001',
        })
    ).not.toThrow();
    for (const baseUrl of [
      'http://freellmapi:3001/v1',
      'http://freellmapi:3001?x=1',
      'http://freellmapi:3002',
      'http://evil.example.com:3001',
    ]) {
      expect(
        () => new CloudProviderAdapter({ id: 'freellmapi_default', kind: 'freellmapi', baseUrl })
      ).toThrow();
    }
  });
});
