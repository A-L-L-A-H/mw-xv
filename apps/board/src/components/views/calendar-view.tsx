'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Domain, ResolvedViews } from '@moonwitness/client';
import { Button } from '@moonwitness/ui/components/button';
import { LoadingSpinner } from '@moonwitness/ui/components/effects';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import {
  buildCalendarRange,
  calendarRecordDay,
  formatLocalDate,
  navigateCalendar,
} from '@/lib/calendar-range';

type RecordData = Record<string, unknown> & { id: number };

interface CalendarViewProps {
  model: string;
  views: ResolvedViews;
  onOpenRecord: (id: number) => void;
}

export function CalendarView({ model, views, onOpenRecord }: CalendarViewProps) {
  const metadata = views.calendar!;
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => new Date());

  const range = useMemo(() => buildCalendarRange(cursor, mode), [cursor, mode]);

  const domain = useMemo<Domain>(
    () => [
      [metadata.dateField, '>=', range.start.toISOString()],
      [metadata.dateField, '<=', range.end.toISOString()],
    ],
    [metadata.dateField, range]
  );
  const query = useQuery({
    queryKey: scopedQueryKey(['records', model, 'calendar', domain, mode]),
    queryFn: () => client.model<RecordData>(model).searchRead({ domain, limit: 500 }),
  });
  const recordsByDay = useMemo(() => {
    const map = new Map<string, RecordData[]>();
    for (const record of query.data?.records ?? []) {
      const key = calendarRecordDay(record[metadata.dateField]);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), record]);
    }
    return map;
  }, [metadata.dateField, query.data]);
  const navigate = (direction: -1 | 1) => {
    setCursor((current) => navigateCalendar(current, direction, mode));
  };

  return (
    <section aria-label={`${views.title} calendar`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-paper px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(1)}>
            Next
          </Button>
          <span className="font-mono text-xs">
            {formatLocalDate(range.start)} – {formatLocalDate(range.end)}
          </span>
        </div>
        <div className="flex gap-2">
          {(['month', 'week'] as const).map((option) => (
            <Button
              key={option}
              data-active={mode === option}
              onClick={() => setMode(option)}
              className="sticker text-xs"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>
      {query.isLoading ? (
        <LoadingSpinner className="size-6" />
      ) : query.isError ? (
        <ErrorState
          role="alert"
          headingLevel={2}
          title="Could not load calendar records"
          description={
            query.error instanceof Error
              ? query.error.message
              : 'Unable to fetch calendar records.'
          }
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="divide-y divide-ink/20 border-2 border-ink bg-card sm:hidden">
            {range.days.map((day) => {
              const key = formatLocalDate(day);
              const items = recordsByDay.get(key) ?? [];
              return (
                <div key={key} className="space-y-1.5 p-3">
                  <p className="font-mono text-xs font-bold text-ink-faint">{key}</p>
                  {items.length === 0 ? (
                    <p className="font-mono text-[11px] text-ink-faint">No scheduled records</p>
                  ) : (
                    <div className="space-y-1">
                      {items.map((record) => (
                        <Button
                          key={record.id}
                          variant="outline"
                          size="xs"
                          className="w-full justify-start truncate border border-ink bg-paper-raised px-2 text-left font-mono text-xs"
                          onClick={() => onOpenRecord(record.id)}
                        >
                          {String(record[metadata.titleField ?? 'name'] ?? `#${record.id}`)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div
            role="region"
            tabIndex={0}
            aria-label={`${views.title} calendar horizontal scroll`}
            className="hidden overflow-x-auto border-2 border-ink bg-card sm:block"
          >
            <div
              className={
                mode === 'month'
                  ? 'grid min-w-[42rem] grid-cols-7 gap-1'
                  : 'grid min-w-[42rem] grid-cols-7 gap-2'
              }
            >
              {range.days.map((day) => {
                const key = formatLocalDate(day);
                const items = recordsByDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className={
                      mode === 'month'
                        ? 'min-h-24 border border-ink/20 p-1'
                        : 'min-h-48 border border-ink/20 p-2'
                    }
                  >
                    <p className="font-mono text-[10px] text-ink-faint">{key.slice(5)}</p>
                    {items.map((record) => (
                      <Button
                        key={record.id}
                        variant="outline"
                        size="xs"
                        className="mt-1 w-full truncate border border-ink bg-paper-raised px-1 text-left font-mono text-[10px]"
                        onClick={() => onOpenRecord(record.id)}
                      >
                        {String(record[metadata.titleField ?? 'name'] ?? `#${record.id}`)}
                      </Button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
