'use client';

import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useViews } from '@/hooks/use-model';
import { Button } from '@moonwitness/ui/components/button';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Doodle } from '@moonwitness/ui/components/effects';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { ListView } from '@/components/views/list-view';
import { FormView } from '@/components/views/form-view';
import { availableViews, parseViewName, type BoardViewName } from '@/lib/action-result';

const viewFallback = () => <Skeleton className="h-96 w-full bg-ink/10" />;

const KanbanView = dynamic(
  () => import('@/components/views/kanban-view').then((mod) => mod.KanbanView),
  { ssr: false, loading: viewFallback }
);
const CalendarView = dynamic(
  () => import('@/components/views/calendar-view').then((mod) => mod.CalendarView),
  { ssr: false, loading: viewFallback }
);
const GraphView = dynamic(
  () => import('@/components/views/graph-view').then((mod) => mod.GraphView),
  { ssr: false, loading: viewFallback }
);
const PivotView = dynamic(
  () => import('@/components/views/pivot-view').then((mod) => mod.PivotView),
  { ssr: false, loading: viewFallback }
);

export function ModelPage() {
  const params = useParams<{ model: string; id?: string }>();
  const model = params?.model ?? '';
  const id = params?.id;
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: views, isLoading, error } = useViews(model);

  const isCreate = id === 'new' || searchParams?.get('create') === '1';
  const isEdit = !isCreate && Boolean(id);
  const recordId = isEdit && id ? parseInt(id, 10) : undefined;
  const relationParentModel = searchParams?.get('relation_parent_model');
  const relationParentIdValue = searchParams?.get('relation_parent_id');
  const relationParentField = searchParams?.get('relation_field');
  const parsedRelationParentId =
    relationParentIdValue && /^\d+$/u.test(relationParentIdValue)
      ? Number(relationParentIdValue)
      : Number.NaN;
  const relationField = views?.fields.find(
    (field) =>
      field.name === relationParentField &&
      field.type === 'many2one' &&
      field.relation === relationParentModel &&
      !field.readonly &&
      !field.writeOnly
  );
  const relationParent =
    isCreate &&
    relationField &&
    Number.isSafeInteger(parsedRelationParentId) &&
    parsedRelationParentId > 0
      ? { model: relationField.relation!, id: parsedRelationParentId, field: relationField.name }
      : undefined;

  const breadcrumbs = views
    ? [
        {
          label: views.title,
          to: id ? `/board/m/${model}` : undefined,
        },
        ...(isCreate ? [{ label: 'New Record' }] : []),
        ...(isEdit ? [{ label: `#${id}` }] : []),
      ]
    : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48 bg-ink/10" />
        <Skeleton className="h-14 w-72 bg-ink/10" />
        <Skeleton className="h-96 w-full bg-ink/10" />
      </div>
    );
  }

  if (error || !views) {
    return (
      <EmptyState
        className="ink-panel bg-card p-12 text-center"
        icon={<Doodle kind="star" className="mx-auto size-10 text-destructive" />}
        title="Failed to load model views"
        description={`Model '${model}' might not exist or you do not have permission to view it.`}
      />
    );
  }

  const supportedViews = availableViews(views);
  const activeView = parseViewName(searchParams?.get('view') ?? null, views);
  const switchView = (nextView: BoardViewName) => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextView === 'list') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    const query = nextParams.toString();
    router.replace(query ? `/board/m/${model}?${query}` : `/board/m/${model}`);
  };
  const openRecord = (recId: number) => router.push(`/board/m/${model}/${recId}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={breadcrumbs} />
        {!isCreate && !isEdit && supportedViews.length > 1 && (
          <div
            className="flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label="View switcher"
          >
            {supportedViews.map((viewName) => (
              <Button
                key={viewName}
                type="button"
                role="tab"
                aria-selected={activeView === viewName}
                variant={activeView === viewName ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchView(viewName)}
                className="uppercase"
              >
                {viewName}
              </Button>
            ))}
          </div>
        )}
      </div>

      {isCreate ? (
        <FormView
          model={model}
          views={views}
          initialValues={relationParent ? { [relationParent.field]: relationParent.id } : undefined}
          onBack={() =>
            router.push(
              relationParent
                ? `/board/m/${relationParent.model}/${relationParent.id}`
                : `/board/m/${model}`
            )
          }
          onSaved={(newId) =>
            router.replace(
              relationParent
                ? `/board/m/${relationParent.model}/${relationParent.id}`
                : `/board/m/${model}/${newId}`
            )
          }
        />
      ) : isEdit && recordId !== undefined && !Number.isNaN(recordId) ? (
        <FormView
          model={model}
          views={views}
          recordId={recordId}
          onBack={() => router.push(`/board/m/${model}`)}
        />
      ) : activeView === 'kanban' ? (
        <KanbanView model={model} views={views} onOpenRecord={openRecord} />
      ) : activeView === 'calendar' ? (
        <CalendarView model={model} views={views} onOpenRecord={openRecord} />
      ) : activeView === 'graph' ? (
        <GraphView model={model} views={views} />
      ) : activeView === 'pivot' ? (
        <PivotView model={model} views={views} />
      ) : (
        <ListView
          model={model}
          views={views}
          onOpenRecord={openRecord}
          onCreateRecord={() => router.push(`/board/m/${model}/new`)}
        />
      )}
    </div>
  );
}
