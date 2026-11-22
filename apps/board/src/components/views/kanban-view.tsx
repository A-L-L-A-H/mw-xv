'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Domain, ResolvedViews } from '@moonwitness/client';
import { toast } from '@moonwitness/ui/components/toast';
import { Doodle } from '@moonwitness/ui/components/effects';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Button } from '@moonwitness/ui/components/button';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

type RecordData = Record<string, unknown> & { id: number };

interface KanbanViewProps {
  model: string;
  views: ResolvedViews;
  onOpenRecord: (id: number) => void;
}

export function KanbanView({ model, views, onOpenRecord }: KanbanViewProps) {
  const metadata = views.kanban;
  const queryClient = useQueryClient();
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const domain: Domain = [];

  const listQuery = useQuery({
    queryKey: scopedQueryKey(['records', model, 'kanban', domain]),
    queryFn: () => client.model<RecordData>(model).searchRead({ domain, limit: 500, count: true }),
    enabled: Boolean(metadata),
  });
  const countsQuery = useQuery({
    queryKey: scopedQueryKey(['records', model, 'kanban-counts', domain, metadata?.groupBy]),
    queryFn: () =>
      client.model(model).groupCount({ domain, groupBy: [metadata!.groupBy], limit: 500 }),
    enabled: Boolean(metadata),
  });
  const move = useMutation({
    mutationFn: ({
      recordId,
      stage,
      writeDate,
    }: {
      recordId: number;
      stage: string;
      writeDate?: string;
    }) =>
      client
        .model<RecordData>(model)
        .write(recordId, { [metadata!.groupBy]: stage }, { writeDate }),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not move record'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', model] });
      toast.success('Record moved');
    },
  });

  if (!metadata || columns(metadata.stageOrder).length === 0) {
    return (
      <div className="ink-panel border-2 border-dashed bg-card p-12 text-center">
        <Doodle kind="star" className="mx-auto size-10 text-magenta-readable" />
        <h2 className="font-display text-xl uppercase">No Kanban stages</h2>
        <p className="mt-1 text-sm text-ink-soft">This model has no Kanban metadata yet.</p>
      </div>
    );
  }

  const stages = columns(metadata.stageOrder);
  const records = listQuery.data?.records ?? [];
  const countFor = (stage: string) =>
    countsQuery.data?.groups.find((group) => String(group.values[metadata.groupBy]) === stage)
      ?.count ?? 0;

  return (
    <div
      role="group"
      aria-label={`${views.title} Kanban`}
      className="flex items-start gap-4 overflow-x-auto pb-6"
    >
      {stages.map((stage) => {
        const stageRecords = records.filter(
          (record) => String(record[metadata.groupBy] ?? '') === stage
        );
        return (
          <section
            key={stage}
            aria-label={stage}
            className="w-80 shrink-0 border-2 border-ink bg-paper shadow-ink"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggingId !== null)
                move.mutate({ recordId: draggingId, stage, writeDate: undefined });
              setDraggingId(null);
            }}
          >
            <header className="flex items-center justify-between border-b-2 border-ink bg-paper-raised px-3 py-2">
              <h2 className="font-display text-xs uppercase tracking-wider">{stage}</h2>
              <span className="border border-ink bg-paper px-2 font-mono text-xs">
                {countFor(stage)}
              </span>
            </header>
            <div className="min-h-[350px] max-h-[600px] space-y-2 overflow-y-auto bg-paper/40 p-2">
              {stageRecords.map((record) => (
                <article
                  key={record.id}
                  tabIndex={0}
                  draggable
                  onDragStart={() => setDraggingId(record.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    const next =
                      stages[stages.indexOf(stage) + (event.key === 'ArrowRight' ? 1 : -1)];
                    if (next) {
                      event.preventDefault();
                      move.mutate({ recordId: record.id, stage: next, writeDate: undefined });
                    }
                  }}
                  className="cursor-pointer border-2 border-ink bg-paper-raised p-3 shadow-ink-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onOpenRecord(record.id)}
                    className="w-full text-left"
                  >
                    <span className="font-mono text-xs">#{record.id}</span>
                    <span className="mt-1 block font-display text-sm uppercase">
                      {String(record.name ?? `#${record.id}`)}
                    </span>
                  </Button>
                  <label className="mt-2 block font-mono text-xs">
                    Move stage
                    <SelectField
                      value={stage}
                      onChange={(event) =>
                        move.mutate({
                          recordId: record.id,
                          stage: event.target.value,
                          writeDate: undefined,
                        })
                      }
                      className="mt-1 h-8 w-full border-2 border-ink bg-paper px-2"
                    >
                      {stages.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                </article>
              ))}
              {stageRecords.length === 0 && (
                <p className="border-2 border-dashed border-ink/20 p-6 text-center font-mono text-xs">
                  Empty stage
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function columns(stageOrder: readonly string[] | undefined): string[] {
  return stageOrder?.length ? [...stageOrder] : [];
}
