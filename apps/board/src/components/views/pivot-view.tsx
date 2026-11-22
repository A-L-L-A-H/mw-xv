'use client';

import { useQuery } from '@tanstack/react-query';
import type { ResolvedViews } from '@moonwitness/client';
import { serializeCsv } from '@/lib/csv-export';
import { Button } from '@moonwitness/ui/components/button';
import { downloadTextFile } from '@/lib/action-result';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export function PivotView({ model, views }: { model: string; views: ResolvedViews }) {
  const metadata = views.pivot!;
  const query = useQuery({
    queryKey: scopedQueryKey([
      'records',
      model,
      'pivot',
      metadata.rowGroupBy,
      metadata.columnGroupBy,
      metadata.metric,
    ]),
    queryFn: () =>
      client.model(model).groupCount({
        groupBy: metadata.columnGroupBy
          ? [metadata.rowGroupBy, metadata.columnGroupBy]
          : [metadata.rowGroupBy],
        limit: 500,
      }),
  });
  const rows = query.data?.groups ?? [];
  const columns = Array.from(
    new Set(
      rows.map((row) =>
        String(row.values[metadata.columnGroupBy ?? metadata.rowGroupBy] ?? 'Unset')
      )
    )
  ).sort();
  const matrix = new Map<string, number>();
  for (const row of rows) {
    const rowKey = String(row.values[metadata.rowGroupBy] ?? 'Unset');
    const columnKey = String(row.values[metadata.columnGroupBy ?? metadata.rowGroupBy] ?? 'Unset');
    matrix.set(`${rowKey}\0${columnKey}`, row.count);
  }
  const rowKeys = Array.from(
    new Set(rows.map((row) => String(row.values[metadata.rowGroupBy] ?? 'Unset')))
  ).sort();
  const exportCsv = () => {
    if (rowKeys.length * columns.length > 5000) return;
    downloadTextFile(
      `${model}_pivot.csv`,
      serializeCsv(
        [metadata.rowGroupBy, ...columns],
        rowKeys.map((rowKey) => [
          rowKey,
          ...columns.map((column) => String(matrix.get(`${rowKey}\0${column}`) ?? 0)),
        ])
      )
    );
  };
  return (
    <section aria-label={`${views.title} pivot`} className="space-y-3">
      <div className="flex justify-between border-2 border-ink bg-paper px-4 py-3">
        <span className="font-mono text-xs">{rows.length} groups · max 500</span>
        <Button
          onClick={exportCsv}
          className="border-2 border-ink bg-primary px-3 py-1 font-bold text-primary-foreground"
        >
          Export CSV
        </Button>
      </div>
      <div className="overflow-auto border-2 border-ink bg-card" role="region" tabIndex={0}>
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="border border-ink/20 bg-paper px-3 py-2">
                {metadata.rowGroupBy}
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="border border-ink/20 bg-paper px-3 py-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((rowKey) => (
              <tr key={rowKey}>
                <th scope="row" className="border border-ink/20 bg-paper px-3 py-2 text-left">
                  {rowKey}
                </th>
                {columns.map((column) => (
                  <td key={column} className="border border-ink/20 px-3 py-2 font-mono">
                    {matrix.get(`${rowKey}\0${column}`) ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
