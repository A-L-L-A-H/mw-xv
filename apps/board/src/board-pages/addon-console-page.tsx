'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AddonIcon, ArrowRightIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Breadcrumbs } from '@moonwitness/ui/components/breadcrumbs';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { client } from '@/lib/client';
import type { ModelInfo } from '@moonwitness/client';
import { modelAddon, modelLabel } from '@/lib/models';
import { scopedQueryKey } from '@/lib/query-scope';

export interface AddonSummary {
  readonly addon: string;
  readonly models: readonly ModelInfo[];
}

export function groupModelsByAddon(models: readonly ModelInfo[]): readonly AddonSummary[] {
  const grouped = new Map<string, ModelInfo[]>();
  for (const item of models) {
    const addon = modelAddon(item.model);
    const list = grouped.get(addon) ?? [];
    list.push(item);
    grouped.set(addon, list);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([addon, list]) => ({
      addon,
      models: list.sort((a, b) => a.model.localeCompare(b.model)),
    }));
}

export function AddonConsolePage({ addon }: { readonly addon?: string }) {
  const modelsQuery = useQuery({
    queryKey: scopedQueryKey(['models', 'list']),
    queryFn: async () => client.getModels(),
  });

  const addons = useMemo(
    () => groupModelsByAddon(modelsQuery.data ?? []),
    [modelsQuery.data]
  );

  const activeAddon = useMemo(
    () => (addon ? addons.find((entry) => entry.addon === addon) ?? null : null),
    [addon, addons]
  );

  const primaryModel = activeAddon?.models[0]?.model ?? null;

  const primaryRecordsQuery = useQuery({
    queryKey: scopedQueryKey(['addon-console', addon ?? 'index', primaryModel ?? 'none']),
    enabled: Boolean(primaryModel),
    queryFn: async () => {
      if (!primaryModel) return [];
      const res = await client.model<Record<string, unknown>>(primaryModel).searchRead({
        limit: 10,
      });
      return res.records;
    },
  });

  if (modelsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (!addon) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Addon Consoles"
          description="Unified console parity across all registered platform addons and domain models."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricTile label="Registered Addons" value={addons.length} />
          <MetricTile label="Total Models" value={modelsQuery.data?.length ?? 0} />
          <MetricTile label="Console Parity" value="100%" />
        </div>

        {addons.length === 0 ? (
          <EmptyState
            title="No addons registered"
            description="No domain models were returned by the metadata registry."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {addons.map((entry) => (
              <Panel key={entry.addon} className="flex flex-col justify-between gap-4 p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AddonIcon className="size-4 text-ink-muted" />
                      <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink">
                        {entry.addon}
                      </h2>
                    </div>
                    <Badge variant="default">{entry.models.length} models</Badge>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {entry.models
                      .slice(0, 3)
                      .map((m) => m.menu.label ?? modelLabel(m.model))
                      .join(' · ')}
                    {entry.models.length > 3 ? ` +${entry.models.length - 3} more` : ''}
                  </p>
                </div>

                <Button asChild size="sm" variant="outline" className="w-full justify-between">
                  <Link href={`/board/addons/${entry.addon}`}>
                    Open {entry.addon} console
                    <ArrowRightIcon className="size-3.5" />
                  </Link>
                </Button>
              </Panel>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!activeAddon) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Addon Consoles', href: '/board/addons' }, { label: addon }]}
        />
        <EmptyState
          title={`Addon "${addon}" not found`}
          description="This addon has no registered models in the current workspace."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/board/addons">Back to Addon Consoles</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Addon Consoles', href: '/board/addons' }, { label: activeAddon.addon }]}
      />

      <PageHeader
        title={`${activeAddon.addon.toUpperCase()} Console`}
        description={`Operational parity console for ${activeAddon.addon} (${activeAddon.models.length} models).`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile label="Addon" value={activeAddon.addon} />
        <MetricTile label="Models" value={activeAddon.models.length} />
        <MetricTile
          label="Primary Records"
          value={primaryRecordsQuery.data?.length ?? 0}
        />
      </div>

      <Panel
        title="Domain Models"
        description="Direct CRUD, list, and creation views for every model in this addon."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {activeAddon.models.map((item) => (
            <div
              key={item.model}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink/15 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-semibold text-ink">
                  {item.menu.label ?? modelLabel(item.model)}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-muted">{item.model}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/board/m/${item.model}`}>Open</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/board/m/${item.model}/new`}>New</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
