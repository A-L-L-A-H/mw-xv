import { describe, expect, it, vi } from 'vitest';

import { DiscoveryError, discoverGatewayModels } from '../src/freellmapi-discovery.js';

function gatewayResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FreeLLMAPI model discovery', () => {
  const env = { MW_AI_FREELLM_KEY: 'test-unified-inference-key' };

  it('reads real gateway model ids with the unified inference key', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://freellmapi:3001/v1/models?available=true');
      expect((init?.headers as Record<string, string>).authorization).toBe(
        'Bearer test-unified-inference-key'
      );
      expect(init?.redirect).toBe('error');
      return gatewayResponse({
        object: 'list',
        data: [
          { id: 'provider/real-model-1', owned_by: 'upstream', context_window: 128000 },
          { id: 'real-model-2', supports_tools: true },
          { id: 'bad id' },
        ],
      });
    });
    const models = await discoverGatewayModels({
      secretRef: 'MW_AI_FREELLM_KEY',
      env,
      fetch: fetchMock as never,
    });
    expect(models.map((m) => m.modelId)).toEqual(['provider/real-model-1', 'real-model-2']);
    expect(models[0].contextWindow).toBe(128000);
    expect(models[1].supportsTools).toBe(true);
  });

  it('fails closed on a missing key, unsafe origin and gateway errors', async () => {
    await expect(
      discoverGatewayModels({
        secretRef: 'MW_AI_FREELLM_KEY',
        env: {},
        fetch: (async () => gatewayResponse({})) as never,
      })
    ).rejects.toMatchObject({ code: 'SECRET_UNAVAILABLE' });

    await expect(
      discoverGatewayModels({
        origin: 'http://freellmapi:3001/v1',
        secretRef: 'MW_AI_FREELLM_KEY',
        env,
        fetch: (async () => gatewayResponse({})) as never,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });

    await expect(
      discoverGatewayModels({
        origin: 'http://evil.example:3001',
        secretRef: 'MW_AI_FREELLM_KEY',
        env,
        fetch: (async () => gatewayResponse({})) as never,
      })
    ).rejects.toMatchObject({ code: 'ORIGIN_NOT_APPROVED' });

    await expect(
      discoverGatewayModels({
        secretRef: 'MW_AI_FREELLM_KEY',
        env,
        fetch: (async () => gatewayResponse({ data: [] })) as never,
      })
    ).rejects.toBeInstanceOf(DiscoveryError);
  });
});
