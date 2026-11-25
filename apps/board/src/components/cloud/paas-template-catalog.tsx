'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { Panel } from '@moonwitness/ui/components/panel';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  PAAS_MARKETPLACE_TEMPLATES,
  type PaasTemplateCategory,
  type PaasTemplateDefinition,
} from './paas-template-data';
import {
  ActivityIcon,
  BoltIcon,
  CodeIcon,
  GlobeIcon,
  SignalIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from '@moonwitness/ui/icons';

export interface PaasTemplateCatalogProps {
  readonly templates?: readonly PaasTemplateDefinition[];
  readonly deployingTemplateId?: string | null;
  readonly onDeployTemplate: (template: PaasTemplateDefinition) => void | Promise<void>;
  /** Cloud mode: set to a cloud API base (e.g. /api/cloud/paas) to enable server-side catalog. */
  readonly apiBase?: string;
  readonly fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly wildcardDomain?: string;
  readonly publicIpv4?: string;
  readonly onStackDeployed?: () => void | Promise<void>;
}

interface CloudTemplateSummary {
  id: string;
  name: string;
  slogan?: string;
  category: string;
  tags?: string[];
  compatibility: 'ready' | 'inline_config' | 'restricted';
  serviceCount?: number;
  docsUrl?: string;
}

interface CloudTemplateList {
  items: CloudTemplateSummary[];
  total: number;
  page: number;
  limit: number;
  categories: Array<{ id: string; count: number }>;
}

function categoryBadgeVariant(category: PaasTemplateCategory): 'primary' | 'cyan' | 'default' {
  if (category === 'Platform' || category === 'AI') return 'primary';
  if (category === 'Database' || category === 'Cache') return 'cyan';
  return 'default';
}

function compatVariant(
  compatibility: CloudTemplateSummary['compatibility']
): 'cyan' | 'default' | 'destructive' {
  if (compatibility === 'ready') return 'cyan';
  if (compatibility === 'inline_config') return 'default';
  return 'destructive';
}

function compatLabel(compatibility: CloudTemplateSummary['compatibility']): string {
  if (compatibility === 'ready') return 'Ready';
  if (compatibility === 'inline_config') return 'Inline Config';
  return 'Restricted';
}

function renderTemplateIcon(category: PaasTemplateCategory) {
  switch (category) {
    case 'Database':
    case 'Cache':
      return <ActivityIcon className="h-4 w-4 text-primary" />;
    case 'AI':
      return <BoltIcon className="h-4 w-4 text-primary" />;
    case 'Frontend':
      return <GlobeIcon className="h-4 w-4 text-primary" />;
    case 'Backend':
      return <CodeIcon className="h-4 w-4 text-primary" />;
    case 'Platform':
      return <SignalIcon className="h-4 w-4 text-primary" />;
  }
}

function CloudCatalog({
  apiBase,
  fetchFn,
}: {
  apiBase: string;
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
}) {
  const base = apiBase.replace(/\/+$/u, '');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CloudTemplateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<CloudTemplateSummary | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '24' });
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (category) params.set('category', category);
      const res = await fetchFn(`${base}/templates?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Template catalog failed (${res.status})`);
      const body = (await res.json()) as { success?: boolean; data?: CloudTemplateList };
      setCatalog(body.data ?? (body as unknown as CloudTemplateList));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template catalog');
    } finally {
      setLoading(false);
    }
  }, [base, category, debouncedQuery, fetchFn, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = catalog ? Math.max(1, Math.ceil(catalog.total / catalog.limit)) : 1;

  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            1-Click PaaS Template Marketplace
          </h3>
          <p className="text-xs text-muted-foreground">
            {catalog ? (
              <Badge variant="default">{catalog.total} templates</Badge>
            ) : null}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Input
            aria-label="Search PaaS templates"
            placeholder="Search templates..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Category filter">
        <Button
          type="button"
          size="sm"
          variant={category === '' ? 'default' : 'outline'}
          onClick={() => {
            setCategory('');
            setPage(1);
          }}
        >
          All
        </Button>
        {catalog?.categories.slice(0, 12).map((cat) => (
          <Button
            key={cat.id}
            type="button"
            size="sm"
            variant={category === cat.id ? 'default' : 'outline'}
            onClick={() => {
              setCategory(cat.id);
              setPage(1);
            }}
          >
            {cat.id} ({cat.count})
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState
          title="Template catalog unavailable"
          description={error}
          onRetry={() => void load()}
          headingLevel={3}
        />
      ) : null}

      {loading && !catalog ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {catalog?.items.map((tpl) => (
            <Panel key={tpl.id} className="flex flex-col justify-between gap-3 p-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{tpl.name}</span>
                  <Badge variant={compatVariant(tpl.compatibility)}>
                    {compatLabel(tpl.compatibility)}
                  </Badge>
                </div>
                {tpl.slogan ? (
                  <p className="text-xs text-muted-foreground">{tpl.slogan}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="default">{tpl.category}</Badge>
                  {typeof tpl.serviceCount === 'number' ? (
                    <Badge variant="default">{tpl.serviceCount} services</Badge>
                  ) : null}
                  {tpl.docsUrl ? (
                    <a
                      className="text-xs underline"
                      href={tpl.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Docs
                    </a>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={tpl.compatibility === 'restricted'}
                onClick={() => setConfiguring(tpl)}
              >
                Configure &amp; Deploy <ChevronRightIcon aria-hidden />
              </Button>
            </Panel>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Badge variant="default">
          Page {page} / {totalPages}
        </Badge>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronsLeftIcon aria-hidden /> Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronsRightIcon aria-hidden />
          </Button>
        </div>
      </div>

      {configuring ? (
        <Panel title={`Configure ${configuring.name}`} density="compact" headingLevel={3}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="cloud-slug">App Slug</Label>
              <Input id="cloud-slug" defaultValue={configuring.id} />
            </div>
            <p className="text-xs text-muted-foreground">
              Configure &amp; Deploy options are completed in the following step.
            </p>
          </div>
        </Panel>
      ) : null}
    </Panel>
  );
}

export function PaasTemplateCatalog({
  templates = PAAS_MARKETPLACE_TEMPLATES,
  deployingTemplateId = null,
  onDeployTemplate,
  apiBase,
  fetchFn,
  wildcardDomain: _wildcardDomain,
  publicIpv4: _publicIpv4,
  onStackDeployed: _onStackDeployed,
}: PaasTemplateCatalogProps) {
  const isCloudApi = Boolean(apiBase?.startsWith('/api/cloud/'));
  const [query, setQuery] = useState<string>('');

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return templates;
    return templates.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(normalized) ||
        tpl.category.toLowerCase().includes(normalized) ||
        tpl.description.toLowerCase().includes(normalized)
    );
  }, [query, templates]);

  if (isCloudApi) {
    return <CloudCatalog apiBase={apiBase!} fetchFn={fetchFn ?? fetch} />;
  }

  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            1-Click PaaS Template Marketplace
          </h3>
          <p className="text-xs text-muted-foreground">
            Deploy pre-hardened services across your private EasyTier VPS mesh.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Input
            aria-label="Filter PaaS templates"
            placeholder="Filter templates..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filteredTemplates.map((template) => {
          const isDeploying = deployingTemplateId === template.id;
          return (
            <Panel key={template.id} className="flex flex-col justify-between gap-3 p-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderTemplateIcon(template.category)}
                    <span className="text-sm font-semibold">{template.name}</span>
                  </div>
                  <Badge variant={categoryBadgeVariant(template.category)}>
                    {template.category}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">{template.description}</p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="default">{template.recommendedRamMb} MB RAM</Badge>
                  <Badge variant="default">Port {template.defaultPort}</Badge>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isDeploying}
                onClick={() => {
                  void onDeployTemplate(template);
                }}
              >
                <BoltIcon className="mr-1.5 h-3.5 w-3.5" />
                {isDeploying ? 'Deploying...' : 'Deploy Template'}
              </Button>
            </Panel>
          );
        })}
      </div>
    </Panel>
  );
}
