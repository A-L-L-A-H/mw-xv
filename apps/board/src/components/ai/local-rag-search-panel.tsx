'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Input } from '@moonwitness/ui/components/input';
import { Panel } from '@moonwitness/ui/components/panel';
import { toast } from '@moonwitness/ui/components/toast';
import { KnowledgeIcon, SearchIcon } from '@moonwitness/ui/icons';
import { client } from '@/lib/client';

type LocalRagDocumentKind = 'task' | 'doc' | 'log';

interface LocalRagSearchHit {
  id: string;
  kind: LocalRagDocumentKind;
  title: string;
  snippet: string;
  score: number;
  matchedTerms: string[];
  metadata?: Record<string, unknown>;
}

interface LocalRagSearchResult {
  query: string;
  totalIndexed: number;
  totalMatched: number;
  hits: LocalRagSearchHit[];
}

const KIND_OPTIONS: Array<{ id: LocalRagDocumentKind; label: string }> = [
  { id: 'task', label: 'Tasks' },
  { id: 'doc', label: 'Docs' },
  { id: 'log', label: 'Logs' },
];

function badgeVariantForKind(kind: LocalRagDocumentKind): 'cyan' | 'primary' | 'magenta' {
  if (kind === 'task') return 'cyan';
  if (kind === 'doc') return 'primary';
  return 'magenta';
}

export function LocalRagSearchPanel() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<LocalRagDocumentKind[]>([
    'task',
    'doc',
    'log',
  ]);
  const [result, setResult] = useState<LocalRagSearchResult | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (payload: { query: string; kinds: LocalRagDocumentKind[] }) => {
      const response = await client.request<{
        success: boolean;
        data: LocalRagSearchResult;
      }>('/api/desktop/ai/local-search', {
        method: 'POST',
        body: {
          query: payload.query,
          kinds: payload.kinds,
          limit: 20,
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Local RAG search failed.');
    },
  });

  const toggleKind = (kind: LocalRagDocumentKind) => {
    setSelectedKinds((prev) => {
      if (prev.includes(kind)) {
        return prev.length > 1 ? prev.filter((k) => k !== kind) : prev;
      }
      return [...prev, kind];
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      toast.error('Enter a search query.');
      return;
    }
    searchMutation.mutate({ query: trimmed, kinds: selectedKinds });
  };

  const handleOpenHit = (hit: LocalRagSearchHit) => {
    if (hit.kind === 'task') {
      router.push('/board/projects');
      return;
    }
    if (hit.kind === 'doc') {
      router.push('/board/knowledge');
      return;
    }
    toast.info(`Log source: ${hit.title}`);
  };

  return (
    <Panel className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <KnowledgeIcon className="size-5 text-primary" />
          <h2 className="font-display text-xl uppercase tracking-wide">
            Offline Local RAG Hybrid Search
          </h2>
          <Badge variant="cyan">100% Offline BM25</Badge>
        </div>
        <p className="text-sm text-ink-soft">
          Search local Kanban tasks, docs, and runtime logs with BM25 relevance scoring — zero cloud
          or internet required.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search local tasks, docs, or logs..."
            aria-label="Local RAG search query"
            className="min-w-[220px] flex-1"
          />
          <Button type="submit" disabled={searchMutation.isPending}>
            <SearchIcon className="mr-1.5 size-4" />
            {searchMutation.isPending ? 'Searching...' : 'Search'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {KIND_OPTIONS.map((option) => {
            const active = selectedKinds.includes(option.id);
            return (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                onClick={() => toggleKind(option.id)}
              >
                {option.label}
              </Button>
            );
          })}
          {result && (
            <span className="ml-auto font-mono text-xs text-ink-faint">
              {result.totalMatched} match(es) across {result.totalIndexed} indexed item(s)
            </span>
          )}
        </div>
      </form>

      {result && result.hits.length === 0 ? (
        <EmptyState
          title="No local matches"
          description={`No indexed tasks, docs, or logs matched "${result.query}".`}
        />
      ) : result && result.hits.length > 0 ? (
        <div className="space-y-2.5">
          {result.hits.map((hit) => (
            <div key={hit.id} className="space-y-2 border-2 border-ink/25 bg-paper p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenHit(hit)}
                    className="h-auto px-2 py-0.5 font-mono text-[11px] uppercase"
                  >
                    <Badge variant={badgeVariantForKind(hit.kind)}>{hit.kind}</Badge>
                    <span className="ml-1.5">{hit.id}</span>
                  </Button>
                  <span className="font-display text-sm uppercase tracking-wide text-ink">
                    {hit.title}
                  </span>
                </div>
                <Badge variant="default" className="font-mono text-[11px]">
                  BM25 {hit.score.toFixed(2)}
                </Badge>
              </div>
              <p className="text-xs text-ink-soft">{hit.snippet}</p>
              {hit.matchedTerms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {hit.matchedTerms.map((term) => (
                    <Badge key={term} variant="default" className="font-mono text-[10px]">
                      {term}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
