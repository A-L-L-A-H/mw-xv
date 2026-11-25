'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Domain, ResolvedViews } from '@moonwitness/client';
import { useSfx } from '@moonwitness/ui/components/audio';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { KanbanBoard, type KanbanColumn } from '@moonwitness/ui/components/kanban-board';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
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
  const { play } = useSfx();
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
    onError: (error: unknown) => {
      play('alert');
      toast.error(error instanceof Error ? error.message : 'Could not move record');
    },
    onSuccess: () => {
      play('signal');
      queryClient.invalidateQueries({ queryKey: ['records', model] });
      toast.success('Record moved');
    },
  });

  if (!metadata || columns(metadata.stageOrder).length === 0) {
    return (
      <EmptyState
        illustration="empty-collection"
        headingLevel={2}
        className="ink-panel border-2 border-dashed bg-card p-12 text-center"
        title="No Kanban stages"
        description="This model has no Kanban metadata yet."
      />
    );
  }

  if (listQuery.isError || countsQuery.isError) {
    const err = listQuery.error ?? countsQuery.error;
    return (
      <ErrorState
        role="alert"
        headingLevel={2}
        title="Could not load Kanban board"
        description={
          err instanceof Error
            ? err.message
            : 'Unable to fetch Kanban stage records. Check your connection and try again.'
        }
        retrying={listQuery.isFetching || countsQuery.isFetching}
        onRetry={() => {
          void listQuery.refetch();
          void countsQuery.refetch();
        }}
      />
    );
  }

  if (listQuery.isLoading || countsQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            label={i === 0 ? 'Loading Kanban stages' : undefined}
            className="h-72 border-2 border-ink/20 bg-card"
          />
        ))}
      </div>
    );
  }

  const stages = columns(metadata.stageOrder);
  const records = listQuery.data?.records ?? [];
  const countFor = (stage: string) =>
    countsQuery.data?.groups.find((group) => String(group.values[metadata.groupBy]) === stage)
      ?.count ?? 0;

  const boardColumns: KanbanColumn[] = stages.map((stage) => {
    const stageRecords = records.filter(
      (record) => String(record[metadata.groupBy] ?? '') === stage
    );
    return {
      id: stage,
      title: stage,
      count: countFor(stage),
      emptyState: 'Empty stage',
      cards: stageRecords.map((record) => ({
        id: String(record.id),
        title: String(record.name ?? `#${record.id}`),
        detail: `#${record.id}`,
      })),
    };
  });

  return (
    <KanbanBoard
      role="group"
      aria-label={`${views.title} Kanban`}
      columns={boardColumns}
      onCardAction={(cardId) => onOpenRecord(Number(cardId))}
      onCardMove={(cardId, _fromColumnId, toColumnId) => {
        const record = records.find((item) => String(item.id) === cardId);
        move.mutate({
          recordId: Number(cardId),
          stage: toColumnId,
          writeDate: typeof record?.write_date === 'string' ? record.write_date : undefined,
        });
      }}
    />
  );
}

function columns(stageOrder: readonly string[] | undefined): string[] {
  return stageOrder?.length ? [...stageOrder] : [];
}
