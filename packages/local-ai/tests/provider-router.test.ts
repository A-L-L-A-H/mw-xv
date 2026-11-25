import { describe, expect, it } from 'vitest';
import {
  isLoopbackEndpointUrl,
  ProviderRouterError,
  createMultiProviderLlmRouter,
  type RouterProviderConfig,
} from '../src/index.js';

const PROVIDERS: readonly RouterProviderConfig[] = [
  {
    id: 'local-ollama',
    kind: 'ollama',
    locality: 'local',
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b',
    initialLatencyMs: 90,
    costPer1kTokensUsd: 0,
  },
  {
    id: 'local-lmstudio',
    kind: 'lm-studio',
    locality: 'local',
    endpoint: 'http://localhost:1234',
    model: 'llama-3.1-8b',
    initialLatencyMs: 60,
    costPer1kTokensUsd: 0,
  },
  {
    id: 'local-llamacpp',
    kind: 'llama-cpp',
    locality: 'local',
    endpoint: 'http://[::1]:8080',
    model: 'mistral-7b',
    initialLatencyMs: 140,
    costPer1kTokensUsd: 0,
  },
  {
    id: 'cloud-openai',
    kind: 'openai-compatible',
    locality: 'cloud',
    endpoint: 'https://api.example-cloud.test/v1',
    model: 'gpt-4o-mini',
    initialLatencyMs: 250,
    costPer1kTokensUsd: 0.002,
  },
];

describe('Mega-Wave I.4: Deterministic Multi-Provider Local/Edge LLM Router', () => {
  it('enforces offline-strict privacy tier by unconditionally blocking cloud endpoints', async () => {
    const router = createMultiProviderLlmRouter({
      privacyTier: 'offline-strict',
      providers: [PROVIDERS[3]], // cloud only
    });

    await expect(
      router.route({ prompt: 'summarize' }, async () => ({
        text: 'ok',
        promptTokens: 5,
        completionTokens: 5,
        latencyMs: 50,
      }))
    ).rejects.toMatchObject({
      name: 'ProviderRouterError',
      code: 'PRIVACY_BLOCKED',
    });
  });

  it('allows hybrid fallback to cloud ONLY for non-sensitive prompts and blocks cloud for sensitive prompts', async () => {
    const router = createMultiProviderLlmRouter({
      privacyTier: 'hybrid',
      providers: [PROVIDERS[0], PROVIDERS[3]],
    });

    // Non-sensitive prompt falls back to cloud when local fails
    const nonSensitive = await router.route(
      { prompt: 'public docs', sensitive: false },
      async (p) => {
        if (p.locality === 'local') throw new Error('ollama timeout');
        return { text: 'cloud-answer', promptTokens: 20, completionTokens: 30, latencyMs: 180 };
      }
    );
    expect(nonSensitive.providerId).toBe('cloud-openai');
    expect(nonSensitive.locality).toBe('cloud');
    expect(nonSensitive.attempts).toHaveLength(2);

    // Sensitive prompt must NEVER hit cloud even if local fails
    const calledProviders: string[] = [];
    await expect(
      router.route({ prompt: 'confidential PII', sensitive: true }, async (p) => {
        calledProviders.push(p.id);
        throw new Error('local down');
      })
    ).rejects.toBeInstanceOf(ProviderRouterError);
    expect(calledProviders).toEqual(['local-ollama']);
  });

  it('selects providers deterministically by latency weight and updates EWMA latency', async () => {
    const router = createMultiProviderLlmRouter({
      privacyTier: 'offline-strict',
      providers: PROVIDERS,
    });

    const eligible = router.getEligibleProviders({ prompt: 'hello' });
    // local-lmstudio (60ms) < local-ollama (90ms) < local-llamacpp (140ms); cloud excluded
    expect(eligible.map((p) => p.id)).toEqual(['local-lmstudio', 'local-ollama', 'local-llamacpp']);

    // Slow down local-lmstudio via high observed latency so local-ollama overtakes it
    for (let i = 0; i < 4; i += 1) {
      await router.route({ prompt: 'ping', preferredProviderId: 'local-lmstudio' }, async () => ({
        text: 'pong',
        promptTokens: 2,
        completionTokens: 2,
        latencyMs: 300,
      }));
    }

    const reordered = router.getEligibleProviders({ prompt: 'hello' });
    expect(reordered[0].id).toBe('local-ollama');
  });

  it('opens sliding-window circuit breaker on consecutive errors and recovers after cooldown', async () => {
    let clockMs = 1_000;
    const router = createMultiProviderLlmRouter({
      privacyTier: 'offline-strict',
      providers: [PROVIDERS[1], PROVIDERS[0]],
      circuitBreaker: { failureThreshold: 2, windowSize: 4, cooldownMs: 10_000 },
      now: () => clockMs,
    });

    // Fail local-lmstudio twice -> falls back to local-ollama and opens local-lmstudio circuit
    for (let i = 0; i < 2; i += 1) {
      const res = await router.route({ prompt: 'test' }, async (p) => {
        if (p.id === 'local-lmstudio') throw new Error('ECONNREFUSED');
        return { text: 'from-ollama', promptTokens: 4, completionTokens: 6, latencyMs: 85 };
      });
      expect(res.providerId).toBe('local-ollama');
    }

    const healthOpen = router.getHealthSnapshot().find((h) => h.providerId === 'local-lmstudio');
    expect(healthOpen?.circuitState).toBe('open');
    expect(router.getEligibleProviders({ prompt: 'test' }).map((p) => p.id)).toEqual([
      'local-ollama',
    ]);

    // Advance clock past cooldown -> half-open -> succeeds -> closed
    clockMs += 10_001;
    const healthHalfOpen = router
      .getHealthSnapshot()
      .find((h) => h.providerId === 'local-lmstudio');
    expect(healthHalfOpen?.circuitState).toBe('half-open');

    const recovered = await router.route({ prompt: 'recover' }, async (p) => ({
      text: `ok:${p.id}`,
      promptTokens: 4,
      completionTokens: 4,
      latencyMs: 50,
    }));
    expect(recovered.providerId).toBe('local-lmstudio');
    expect(
      router.getHealthSnapshot().find((h) => h.providerId === 'local-lmstudio')?.circuitState
    ).toBe('closed');
  });

  it('enforces strict token and cost budget ceilings', async () => {
    const router = createMultiProviderLlmRouter({
      privacyTier: 'hybrid',
      providers: [PROVIDERS[3]],
      budget: {
        maxRequestTokens: 500,
        maxTotalTokens: 600,
        maxTotalCostUsd: 0.001,
      },
    });

    // Exceeds maxRequestTokens
    await expect(
      router.route({ prompt: 'x'.repeat(200), maxOutputTokens: 600 }, async () => ({
        text: 'never',
        promptTokens: 50,
        completionTokens: 600,
        latencyMs: 100,
      }))
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });

    // First call succeeds (400 tokens -> $0.0008 <= $0.001)
    const first = await router.route({ prompt: 'hello', maxOutputTokens: 100 }, async () => ({
      text: 'ok',
      promptTokens: 100,
      completionTokens: 300,
      latencyMs: 120,
    }));
    expect(first.totalTokens).toBe(400);
    expect(router.getBudgetUsage().totalTokensUsed).toBe(400);

    // Second call would exceed maxTotalTokens (400 + ~258 > 600)
    await expect(
      router.route({ prompt: 'second', maxOutputTokens: 250 }, async () => ({
        text: 'never',
        promptTokens: 10,
        completionTokens: 250,
        latencyMs: 120,
      }))
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('rejects non-HTTP(S) schemes, credentials, and invalid circuitBreaker bounds on loopback checks', () => {
    expect(isLoopbackEndpointUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackEndpointUrl('https://localhost:8443')).toBe(true);
    expect(isLoopbackEndpointUrl('ftp://localhost:21')).toBe(false);
    expect(isLoopbackEndpointUrl('file://localhost/etc/passwd')).toBe(false);
    expect(isLoopbackEndpointUrl('http://user:pass@127.0.0.1:11434')).toBe(false);
    expect(isLoopbackEndpointUrl('http://127.0.0.1:11434?token=leak')).toBe(false);

    expect(() =>
      createMultiProviderLlmRouter({
        privacyTier: 'offline-strict',
        providers: [
          {
            ...PROVIDERS[0],
            endpoint: 'http://user:pass@127.0.0.1:11434',
          },
        ],
      }).getEligibleProviders({ prompt: 'test' })
    ).toThrow(ProviderRouterError);

    expect(() =>
      createMultiProviderLlmRouter({
        privacyTier: 'offline-strict',
        providers: [PROVIDERS[0]],
        circuitBreaker: { failureThreshold: 0 },
      })
    ).toThrow(/circuitBreaker/u);
  });
});
