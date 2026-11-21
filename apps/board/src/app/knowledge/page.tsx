'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { BookOpenIcon } from '@moonwitness/ui/icons';

interface PublicCitation {
  readonly source_id: string;
  readonly edition_id: string;
  readonly locator: string;
  readonly content_sha256: string;
  readonly rights_evidence_ref: string;
}

interface ApprovedPublicationItem {
  readonly publication_id: string;
  readonly revision: number;
  readonly subject_id: string;
  readonly title: string;
  readonly summary: string;
  readonly citations: readonly PublicCitation[];
  readonly projection_digest: string;
  readonly recorded_at: string;
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly ApprovedPublicationItem[] }
  | { readonly status: 'unavailable'; readonly message: string };

const sha256Pattern = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCitation(value: unknown): value is PublicCitation {
  return (
    isRecord(value) &&
    typeof value.source_id === 'string' &&
    value.source_id.trim().length > 0 &&
    typeof value.edition_id === 'string' &&
    value.edition_id.trim().length > 0 &&
    typeof value.locator === 'string' &&
    value.locator.trim().length > 0 &&
    typeof value.content_sha256 === 'string' &&
    sha256Pattern.test(value.content_sha256) &&
    typeof value.rights_evidence_ref === 'string' &&
    value.rights_evidence_ref.trim().length > 0
  );
}

function isValidApprovedPublication(value: unknown): value is ApprovedPublicationItem {
  return (
    isRecord(value) &&
    typeof value.publication_id === 'string' &&
    value.publication_id.startsWith('mw:publication:') &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    typeof value.subject_id === 'string' &&
    value.subject_id.trim().length > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    typeof value.summary === 'string' &&
    value.summary.trim().length > 0 &&
    Array.isArray(value.citations) &&
    value.citations.length > 0 &&
    value.citations.every(isValidCitation) &&
    typeof value.projection_digest === 'string' &&
    sha256Pattern.test(value.projection_digest) &&
    typeof value.recorded_at === 'string' &&
    value.recorded_at.trim().length > 0
  );
}

export default function PublicKnowledgeShellPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const fetchPublications = useCallback(async (signal?: AbortSignal): Promise<LoadState> => {
    try {
      const response = await fetch('/api/public/publications', {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        return {
          status: 'unavailable',
          message: 'Approved public projections are currently unavailable.',
        };
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !Array.isArray(payload.data) ||
        !payload.data.every(isValidApprovedPublication)
      ) {
        return {
          status: 'unavailable',
          message: 'Public publication payload failed fail-closed verification.',
        };
      }
      return { status: 'ready', items: payload.data };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'loading' };
      }
      return {
        status: 'unavailable',
        message: 'Public knowledge endpoint could not be reached.',
      };
    }
  }, []);

  const loadPublications = useCallback(async () => {
    setState({ status: 'loading' });
    const nextState = await fetchPublications();
    setState(nextState);
  }, [fetchPublications]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublications(controller.signal).then((nextState) => {
      if (!controller.signal.aborted) {
        setState(nextState);
      }
    });
    return () => controller.abort();
  }, [fetchPublications]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Public Knowledge Projections"
        description="Read-only shell displaying strictly PUBLIC_APPROVED, rights-cleared, digest-verified snapshots."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void loadPublications();
              }}
            >
              Refresh projections
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">Workspace Home</Link>
            </Button>
          </div>
        }
      />

      <div role="status" aria-live="polite" className="text-sm text-[var(--mw-color-ink-muted)]">
        {state.status === 'loading'
          ? 'Loading approved publication projections…'
          : state.status === 'unavailable'
            ? state.message
            : `${state.items.length} approved public projection(s) available.`}
      </div>

      {state.status === 'loading' ? (
        <Panel title="Checking public projections" surface="paper">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </Panel>
      ) : null}

      {state.status === 'unavailable' ? (
        <EmptyState
          icon={<BookOpenIcon size={20} />}
          title="Public projections unavailable"
          description={state.message}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void loadPublications();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : null}

      {state.status === 'ready' && state.items.length === 0 ? (
        <EmptyState
          icon={<BookOpenIcon size={20} />}
          title="No approved public projections"
          description="Only explicitly reviewed, rights-cleared PUBLIC_APPROVED snapshots appear here. Draft, internal, restricted, and taken-down records remain withheld."
        />
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <div className="flex flex-col gap-4">
          {state.items.map((item) => (
            <Panel
              key={`${item.publication_id}@${item.revision}`}
              title={item.title}
              description={`${item.publication_id} · rev ${item.revision}`}
              surface="paper"
              actions={<Badge variant="primary">PUBLIC_APPROVED</Badge>}
            >
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed">{item.summary}</p>
                <div className="flex flex-wrap gap-2 text-xs text-[var(--mw-color-ink-muted)]">
                  <span>Digest: {item.projection_digest.slice(0, 16)}…</span>
                  <span>Subject: {item.subject_id}</span>
                  <span>Recorded: {item.recorded_at}</span>
                </div>
                <ul className="flex flex-col gap-1 text-xs text-[var(--mw-color-ink-muted)]">
                  {item.citations.map((citation, index) => (
                    <li key={`${citation.source_id}-${citation.locator}-${index}`}>
                      {citation.source_id} · {citation.edition_id} · {citation.locator} (
                      {citation.rights_evidence_ref})
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          ))}
        </div>
      ) : null}
    </main>
  );
}
