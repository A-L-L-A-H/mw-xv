'use client';

import type { InteractiveSessionEventDto, InteractiveSessionSnapshotDto } from './interactive-session-api';

function redactInteractiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/\b(?:password|secret|api[_-]?key|token)\s*[:=]\s*\S+/giu, '$1=[redacted]');
}

export function InteractiveSessionTimeline({
  snapshot,
  events,
}: {
  readonly snapshot?: InteractiveSessionSnapshotDto;
  readonly events: readonly InteractiveSessionEventDto[];
}) {
  const visible = events.slice(-100);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-ink-soft">
        <span>Sequence timeline</span>
        <span>
          Applied {snapshot?.lastSequence ?? snapshot?.sequence ?? visible.at(-1)?.sequence ?? 0} · Showing {visible.length} of{' '}
          {events.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <p role="status" className="border border-dashed border-ink/25 p-4 font-mono text-xs text-ink-soft">
          No session events have been recorded yet.
        </p>
      ) : (
        <ol aria-label="Interactive session event timeline" className="space-y-2">
          {visible.map((event) => {
            const detail = event.summary ?? event.message;
            return (
              <li
                key={event.sequence}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 border-l-2 border-ink/25 bg-paper-raised p-2 font-mono text-xs"
              >
                <span className="text-ink-faint">#{event.sequence}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold break-all text-ink">{event.type}</span>
                    {event.status ? <span className="text-ink-soft">{event.status}</span> : null}
                  </div>
                  {detail ? (
                    <p className="mt-1 break-words text-ink-soft">{redactInteractiveText(detail)}</p>
                  ) : null}
                  {event.createdAt ? (
                    <time className="mt-1 block text-[10px] text-ink-faint" dateTime={event.createdAt}>
                      {event.createdAt}
                    </time>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
