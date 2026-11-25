'use client';

import { useQuery } from '@tanstack/react-query';
import type { ResolvedViews } from '@moonwitness/client';
import { BarChart, LineChart } from '@moonwitness/ui/components/chart';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export function GraphView({ model, views }: { model: string; views: ResolvedViews }) {
  const metadata = views.graph!;
  const query = useQuery({
    queryKey: scopedQueryKey(['records', model, 'graph', metadata.groupBy, metadata.metric]),
    queryFn: () => client.model(model).groupCount({ groupBy: [metadata.groupBy], limit: 100 }),
  });

  if (query.isError) {
    return (
      <ErrorState
        role="alert"
        headingLevel={2}
        title={`Could not load ${views.title} chart`}
        description={
          query.error instanceof Error ? query.error.message : 'Unable to load grouped chart data.'
        }
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const groups = query.data?.groups ?? [];
  const labels = groups.map((group) => String(group.values[metadata.groupBy] ?? 'Unset'));
  const series = [{ label: views.title, values: groups.map((group) => group.count) }];
  return metadata.type === 'line' ? (
    <LineChart
      title={`${views.title} by ${metadata.groupBy}`}
      labels={labels}
      series={series}
      loading={query.isLoading}
    />
  ) : (
    <BarChart
      title={`${views.title} by ${metadata.groupBy}`}
      data={groups.map((group) => ({
        label: String(group.values[metadata.groupBy] ?? 'Unset'),
        value: group.count,
      }))}
      loading={query.isLoading}
    />
  );
}
