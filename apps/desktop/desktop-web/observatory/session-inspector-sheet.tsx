import { Badge } from '@moonwitness/ui/components/badge';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { Panel } from '@moonwitness/ui/components/panel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@moonwitness/ui/components/sheet';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import type { ObservatorySessionDetailDto } from './types';

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(diffSec)) return '—';
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export interface SessionInspectorSheetProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly detail: ObservatorySessionDetailDto | null;
  readonly onOpenChange: (open: boolean) => void;
}

export function SessionInspectorSheet({
  open,
  loading,
  error,
  detail,
  onOpenChange,
}: SessionInspectorSheetProps) {
  const events = (detail?.detail.events ?? detail?.recentEvents ?? []).slice().reverse();
  const subagents = detail?.detail.subagents ?? detail?.subagents ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(42rem,95vw)] overflow-y-auto border-l-4 border-ink bg-paper p-5 text-ink"
      >
        <SheetHeader className="border-b-2 border-ink/20 pb-3">
          <SheetTitle className="font-display text-lg uppercase tracking-wide">
            {detail?.title ?? 'Session Inspector'}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs text-ink-faint">
            {detail
              ? `${detail.runtimeLabel} · ${detail.model} · ${detail.status.toUpperCase()} · ${formatCompactNumber(detail.tokens.total)} tokens`
              : 'Reading agent transcript tail…'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <ErrorState title="Session detail unavailable" description={error} headingLevel={2} />
          ) : !detail ? (
            <EmptyState
              title="No session selected"
              description="Select any coding agent card to inspect its recent tool calls and subagents."
            />
          ) : (
            <>
              <Panel surface="paper" title="Session Metadata">
                <div className="grid grid-cols-1 gap-2 font-mono text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-ink-faint">Session ID: </span>
                    <span>{detail.id}</span>
                  </div>
                  <div>
                    <span className="text-ink-faint">Branch: </span>
                    <span>{detail.branch ?? '—'}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-ink-faint">Workspace: </span>
                    <span className="break-all">{detail.cwd ?? '—'}</span>
                  </div>
                </div>
              </Panel>

              {subagents.length > 0 ? (
                <Panel surface="paper" title={`Subagents (${subagents.length})`}>
                  <div className="flex flex-wrap gap-1.5">
                    {subagents.map((sub) => (
                      <Badge key={`${sub.id}-${sub.role}`} variant="default" className="font-mono text-xs">
                        {sub.role} ({sub.type})
                      </Badge>
                    ))}
                  </div>
                </Panel>
              ) : null}

              <Panel surface="paper" title={`Recent Tool Calls & Events (${events.length})`}>
                {events.length === 0 ? (
                  <EmptyState
                    title="No recent events"
                    description="No tool calls or log entries found in the transcript tail."
                  />
                ) : (
                  <div className="space-y-2">
                    {events.map((ev, idx) => (
                      <div
                        key={`${ev.at}-${ev.tool}-${idx}`}
                        className="border-2 border-ink/20 bg-paper-raised p-2.5 font-mono text-xs"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-ink-faint">
                          <Badge
                            variant={ev.kind === 'error' ? 'destructive' : 'default'}
                            className="font-mono text-[11px]"
                          >
                            {ev.tool || ev.kind}
                          </Badge>
                          <span>{formatRelativeTime(ev.at)}</span>
                        </div>
                        <p className="break-words text-ink">{ev.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
