import { describe, expect, it } from 'vitest';

import { FREELMAPI_COMPOSE_ORIGIN, PROVIDER_KINDS } from '../src/models/constants.js';
import { AI_AGENT_WORKFORCE_SEED } from '../src/seed.js';
import {
  isAllowedClassificationRoute,
  isApprovedFreellmOrigin,
  isValidProviderEndpoint,
} from '../src/validation.js';

describe('FreeLLMAPI provider taxonomy and routing', () => {
  it('registers freellmapi as an explicit provider kind', () => {
    expect(PROVIDER_KINDS).toContain('freellmapi');
  });

  it('accepts only the exact origin and rejects paths, queries, credentials and alternate ports', () => {
    expect(FREELMAPI_COMPOSE_ORIGIN).toBe('http://freellmapi:3001');
    expect(isApprovedFreellmOrigin(FREELMAPI_COMPOSE_ORIGIN)).toBe(true);
    expect(isValidProviderEndpoint('freellmapi', FREELMAPI_COMPOSE_ORIGIN)).toBe(true);
    expect(isValidProviderEndpoint('freellmapi', undefined)).toBe(true);
    for (const endpoint of [
      'http://freellmapi:3001/v1',
      'http://freellmapi:3001/?a=1',
      'http://user:pass@freellmapi:3001',
      'http://freellmapi:3001#frag',
      'http://freellmapi:3002',
      'https://freellmapi:3001',
      'http://evil.example.com:3001',
    ]) {
      expect(isValidProviderEndpoint('freellmapi', endpoint)).toBe(false);
    }
  });

  it('treats freellmapi as cloud egress for classification', () => {
    expect(isAllowedClassificationRoute('cloud_eligible', 'freellmapi', 'cloud_eligible')).toBe(
      true
    );
    expect(isAllowedClassificationRoute('local_only', 'freellmapi', 'cloud_eligible', true)).toBe(
      false
    );
    expect(isAllowedClassificationRoute('restricted', 'freellmapi', 'cloud_eligible', true)).toBe(
      false
    );
    expect(isAllowedClassificationRoute('cloud_eligible', 'freellmapi', 'local_only')).toBe(false);
  });

  it('seeds a default-off, secret-reference-only provider', () => {
    const provider = AI_AGENT_WORKFORCE_SEED.find(
      (entry: { id?: string }) => entry.id === 'ai.provider_freellmapi_default'
    ) as unknown as
      | {
          values?: Record<string, unknown>;
        }
      | undefined;
    expect(provider).toBeDefined();
    const data = provider?.values ?? {};
    expect(data.code).toBe('freellmapi_default');
    expect(data.kind).toBe('freellmapi');
    expect(data.endpoint_url).toBe(FREELMAPI_COMPOSE_ORIGIN);
    expect(data.secret_ref).toBe('MW_AI_FREELLM_KEY');
    expect(data.data_classification).toBe('cloud_eligible');
    expect(data.enabled).toBe(false);
  });
});
