import { describe, expect, it } from 'vitest';
import { searchLocalRagDocuments, type LocalRagDocument } from '../src/local-rag.js';

describe('Local Offline Hybrid RAG Search (Wave D.22)', () => {
  const corpus: LocalRagDocument[] = [
    {
      id: 'task-1',
      kind: 'task',
      title: 'Fix EasyTier mesh reconnect',
      body: 'Investigate dhcp peer discovery and EasyTier mesh bootstrap stability.',
    },
    {
      id: 'doc-1',
      kind: 'doc',
      title: 'Offline Sync Engine Architecture',
      body: 'Lamport clock and CRDT field merge specification for bidirectional delta sync.',
    },
    {
      id: 'log-1',
      kind: 'log',
      title: 'mesh error',
      body: 'Failed with token sk-supersecretvalue1234567890 during mesh handshake.',
    },
  ];

  it('ranks BM25 exact matches and supports token-prefix fallback offline', () => {
    const res = searchLocalRagDocuments(corpus, 'lamport syn');
    expect(res.totalIndexed).toBe(3);
    expect(res.totalMatched).toBe(1);
    expect(res.hits[0]?.id).toBe('doc-1');
    expect(res.hits[0]?.matchedTerms).toEqual(['lamport', 'syn']);
  });

  it('redacts secrets from indexed log snippets and supports kind filtering', () => {
    const res = searchLocalRagDocuments(corpus, 'mesh', { kinds: ['log'] });
    expect(res.totalIndexed).toBe(1);
    expect(res.hits.length).toBe(1);
    expect(res.hits[0]?.id).toBe('log-1');
    expect(res.hits[0]?.snippet).not.toContain('sk-supersecretvalue1234567890');
    expect(res.hits[0]?.snippet).toContain('[REDACTED]');
  });
});
