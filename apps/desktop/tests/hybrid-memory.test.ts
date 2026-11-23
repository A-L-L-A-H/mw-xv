import { describe, expect, it, vi } from 'vitest';
import { searchHybridLocalMemory, type HybridMemoryRecord } from '../src/hybrid-memory.js';

const SAMPLE_RECORDS: readonly HybridMemoryRecord[] = [
  {
    id: 'doc-1',
    companyId: 1,
    kind: 'document',
    title: 'Billing Reconciliation Runbook',
    body: 'Verify Stripe invoice totals and ledger entries before closing monthly books.',
    tags: ['finance', 'billing'],
    updatedAt: '2026-11-20T10:00:00Z',
  },
  {
    id: 'task-2',
    companyId: 1,
    kind: 'task',
    title: 'Fix OAuth Token Refresh',
    body: 'Rotate Bearer sk-ant-secret1234567890abcdef and password=supersecretvalue in staging.',
    tags: ['auth'],
  },
  {
    id: 'note-3',
    companyId: 1,
    kind: 'run_note',
    title: 'Nightly Deployment Postmortem',
    body: 'Database connection pool exhausted during ledger migration.',
    tags: ['ops', 'database'],
  },
  {
    id: 'doc-other-company',
    companyId: 2,
    kind: 'document',
    title: 'Billing Reconciliation Runbook Company 2',
    body: 'Cross-company billing secret record that must never leak.',
    tags: ['billing'],
  },
];

describe('searchHybridLocalMemory', () => {
  it('ranks company-scoped documents/tasks/run-notes deterministically with BM25 and skips cross-company records', async () => {
    const result = await searchHybridLocalMemory({
      companyId: 1,
      query: 'billing ledger',
      records: SAMPLE_RECORDS,
    });

    expect(result.mode).toBe('lexical_only');
    expect(result.totalScanned).toBe(3);
    expect(result.skippedCrossCompany).toBe(1);
    expect(result.hits.every((hit) => hit.companyId === 1)).toBe(true);
    expect(result.hits[0]?.id).toBe('doc-1');
    expect(result.hits[0]?.lexicalScore).toBeGreaterThan(0);
    expect(result.hits[0]?.semanticScore).toBeNull();
  });

  it('redacts sensitive secrets from query, snippets, and embedding prompts', async () => {
    const capturedPrompts: string[] = [];
    const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
      if (parsed.prompt) capturedPrompts.push(parsed.prompt);
      return new Response(JSON.stringify({ embedding: [1, 0] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await searchHybridLocalMemory({
      companyId: 1,
      query: 'oauth token super-secret-known-token',
      records: SAMPLE_RECORDS,
      knownSecrets: ['super-secret-known-token'],
      ollamaEndpoint: 'http://127.0.0.1:11434',
      fetchFn: mockFetch,
    });

    expect(result.query).not.toContain('super-secret-known-token');
    expect(result.query).toContain('[REDACTED]');
    const taskHit = result.hits.find((hit) => hit.id === 'task-2');
    expect(taskHit).toBeDefined();
    expect(taskHit?.redacted).toBe(true);
    expect(taskHit?.snippet).not.toContain('sk-ant-secret1234567890abcdef');
    expect(taskHit?.snippet).not.toContain('supersecretvalue');
    expect(capturedPrompts.join('\n')).not.toContain('super-secret-known-token');
    expect(capturedPrompts.join('\n')).not.toContain('sk-ant-secret1234567890abcdef');
  });

  it('reranks candidates with loopback Ollama cosine similarity when available', async () => {
    const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
      const prompt = parsed.prompt ?? '';
      let embedding: number[];
      if (prompt.includes('outage')) {
        embedding = [1, 0];
      } else if (prompt.includes('Postmortem')) {
        embedding = [0.99, 0.01];
      } else {
        embedding = [0.05, 0.95];
      }
      return new Response(JSON.stringify({ embedding }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await searchHybridLocalMemory({
      companyId: 1,
      query: 'database outage',
      records: SAMPLE_RECORDS,
      ollamaEndpoint: 'http://127.0.0.1:11434',
      fetchFn: mockFetch,
    });

    expect(result.mode).toBe('hybrid');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.hits[0]?.id).toBe('note-3');
    expect(result.hits[0]?.semanticScore).toBeGreaterThan(0.95);
  });

  it('blocks non-loopback Ollama endpoints without calling fetch and falls back to lexical_only', async () => {
    const mockFetch = vi.fn();
    const result = await searchHybridLocalMemory({
      companyId: 1,
      query: 'billing',
      records: SAMPLE_RECORDS,
      ollamaEndpoint: 'https://ollama.evil.example',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.mode).toBe('lexical_only');
    expect(result.fallbackReason).toBe('NON_LOOPBACK_ENDPOINT_BLOCKED');
    expect(result.hits[0]?.id).toBe('doc-1');
  });

  it('gracefully falls back to lexical_only when Ollama is offline or errors', async () => {
    const mockFetch: typeof fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await searchHybridLocalMemory({
      companyId: 1,
      query: 'billing',
      records: SAMPLE_RECORDS,
      ollamaEndpoint: 'http://127.0.0.1:11434',
      fetchFn: mockFetch,
    });

    expect(result.mode).toBe('lexical_only');
    expect(result.fallbackReason).toBe('ECONNREFUSED');
    expect(result.hits[0]?.id).toBe('doc-1');
  });
});
