'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Domain, ResolvedViews } from '@moonwitness/client';
import { Button } from '@moonwitness/ui/components/button';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

type RecordData = Record<string, unknown> & { id: number };

export function GroupRecords({
  model,
  views: _views,
  groupBy,
  value,
  domain,
  onOpenRecord,
}: {
  model: string;
  views: ResolvedViews;
  groupBy: string;
  value: string;
  domain: Domain;
  onOpenRecord: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: scopedQueryKey(['group-records', model, groupBy, value, domain]),
    queryFn: () =>
      client
        .model<RecordData>(model)
        .searchRead({ domain: [...domain, [groupBy, '=', value]], limit: 20 }),
    enabled: expanded,
  });
  return (
    <section aria-label={`Group ${value}`} className="border-2 border-ink bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="font-display text-sm uppercase">{value}</h3>
        <Button size="xs" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Hide' : 'Expand'}
        </Button>
      </div>
      {expanded &&
        (query.isLoading ? (
          <p className="px-3 pb-3 font-mono text-xs">Loading records…</p>
        ) : (
          <ul className="space-y-1 px-3 pb-3">
            {query.data?.records.map((record) => (
              <li key={record.id}>
                <Button variant="ghost" size="xs" onClick={() => onOpenRecord(record.id)}>
                  {String(record.name ?? `#${record.id}`)}
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
