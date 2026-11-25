'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Toolbar } from '@moonwitness/ui/components/toolbar';
import {
  ActivityIcon,
  CurrencyIcon,
  KeyIcon,
  LockIcon,
  RefreshIcon,
  SettingsIcon,
} from '@moonwitness/ui/icons';
import {
  formatMicrosAsUsd,
  sanitizeSecretReferenceName,
  useAiProviders,
  useAiRuns,
} from '@/components/ai/ai-api';
import { MissionControlShell, ProvenanceBadge } from '@/components/ai/mission-control-chrome';
import { CloudProviderDefaultPanel } from '../_components/cloud-agent-panels';

export default function AiProvidersPage() {
  const providersQuery = useAiProviders();
  const runsQuery = useAiRuns();

  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');

  const providers = providersQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  const searchNorm = searchQuery.trim().toLowerCase();
  const filteredProviders = providers.filter((provider) => {
    if (kindFilter !== 'all' && provider.kind !== kindFilter) return false;
    if (classificationFilter !== 'all' && provider.data_classification !== classificationFilter) {
      return false;
    }
    if (!searchNorm) return true;
    const safeRef = sanitizeSecretReferenceName(provider.secret_ref);
    const hay = `${provider.code} ${provider.name} ${provider.kind} ${safeRef}`.toLowerCase();
    return hay.includes(searchNorm);
  });

  const allModels = providers.flatMap((provider) =>
    (provider.models ?? []).map((model) => ({
      ...model,
      providerName: provider.name,
      providerKind: provider.kind,
    }))
  );

  const totalInputTokens = runs.reduce((acc, r) => acc + (r.input_tokens ?? 0), 0);
  const totalOutputTokens = runs.reduce((acc, r) => acc + (r.output_tokens ?? 0), 0);
  const totalCostMicros = runs.reduce((acc, r) => acc + (r.estimated_cost_micros ?? 0), 0);

  return (
    <MissionControlShell
      activeRoute="/board/ai/providers"
      title="Models, Providers"
      accentTitle="& Cost Accounting"
      breadcrumbLabel="Models & Providers"
      description="Governed local and cloud provider profiles with masked MW_AI_* environment secret references, data classification routing rules, and token cost reporting."
      errorAlert={
        providersQuery.isError
          ? providersQuery.error instanceof Error
            ? providersQuery.error.message
            : 'Unable to load provider profiles.'
          : null
      }
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void providersQuery.refetch();
            void runsQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Providers
        </Button>
      }
    >
      {/* Provider & Cost KPIs */}
      <section
        aria-label="Provider and cost metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Provider Profiles"
          value={String(providers.length)}
          detail="Persisted ai.provider_profile records"
          accent="magenta"
          icon={<SettingsIcon className="size-5" />}
        />
        <MetricTile
          label="Model Profiles"
          value={String(allModels.length)}
          detail="Registered model capability profiles"
          accent="cyan"
          icon={<KeyIcon className="size-5" />}
        />
        <MetricTile
          label="Token Volume (In / Out)"
          value={`${totalInputTokens} / ${totalOutputTokens}`}
          detail="Derived from durable agent runs"
          accent="yellow"
          icon={<ActivityIcon className="size-5" />}
        />
        <MetricTile
          label="Total Estimated Cost"
          value={formatMicrosAsUsd(totalCostMicros)}
          detail="Derived micro-USD usage rollup"
          accent="green"
          icon={<CurrencyIcon className="size-5" />}
        />
      </section>

      {/* Filter Toolbar */}
      <Toolbar
        aria-label="Filter provider profiles"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="provider-search">
              Search providers
            </label>
            <Input
              id="provider-search"
              type="search"
              data-filter="provider-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter providers by code, name, or MW_AI_* ref…"
              className="w-full sm:w-64"
            />

            <label className="sr-only" htmlFor="provider-kind-filter">
              Filter by provider kind
            </label>
            <SelectField
              id="provider-kind-filter"
              data-filter="provider-kind"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value)}
            >
              <option value="all">All Provider Kinds</option>
              <option value="mock">mock (Deterministic Test)</option>
              <option value="ollama">ollama (Local Loopback)</option>
              <option value="openai">openai (Cloud HTTPS)</option>
              <option value="anthropic">anthropic (Cloud HTTPS)</option>
            </SelectField>

            <label className="sr-only" htmlFor="provider-class-filter">
              Filter by data classification
            </label>
            <SelectField
              id="provider-class-filter"
              data-filter="provider-classification"
              value={classificationFilter}
              onChange={(event) => setClassificationFilter(event.target.value)}
            >
              <option value="all">All Classifications</option>
              <option value="local_only">local_only</option>
              <option value="cloud_eligible">cloud_eligible</option>
              <option value="restricted">restricted</option>
            </SelectField>
          </div>
        }
        actions={
          <Link
            href="/board/ai/operations"
            className="inline-flex items-center border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
          >
            Run Usage Timeline →
          </Link>
        }
      />

      {/* Provider Profiles Table with Masked Secret References */}
      <Panel
        title="Provider Profiles & Masked Secret References"
        description="ORM stores environment variable names (MW_AI_*) only; raw API keys and bearer tokens never enter the database, API responses, or DOM."
        actions={
          <div className="flex items-center gap-1.5">
            <LockIcon className="size-4" />
            <ProvenanceBadge kind="persisted" />
          </div>
        }
      >
        {providersQuery.isLoading ? (
          <Skeleton className="h-40 w-full bg-ink/10" />
        ) : (
          <Table scrollLabel="Provider profiles table" density="compact">
            <TableHead>
              <TableRow>
                <TableHeader>Provider Code &amp; Name</TableHeader>
                <TableHeader>Kind &amp; Endpoint</TableHeader>
                <TableHeader>Masked Secret Reference</TableHeader>
                <TableHeader>Classification</TableHeader>
                <TableHeader>Limits</TableHeader>
                <TableHeader>Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredProviders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="font-mono text-xs text-ink-soft">
                    No provider profiles match the active filters. Configured provider ref:
                    MW_AI_OLLAMA_LOCAL (masked ••••••••).
                  </TableCell>
                </TableRow>
              ) : (
                filteredProviders.map((provider) => {
                  const safeRef = sanitizeSecretReferenceName(provider.secret_ref);
                  return (
                    <TableRow key={provider.id}>
                      <TableCell>
                        <div className="font-bold text-ink">{provider.name}</div>
                        <div className="font-mono text-xs text-ink-faint">{provider.code}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div className="uppercase font-bold">{provider.kind}</div>
                        <div className="text-ink-faint">
                          {provider.endpoint_url ?? 'loopback / default'}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>Configured provider ref: {safeRef}</div>
                        <div className="text-ink-faint">
                          Value: {provider.secret_masked ?? '••••••••'} (env ref only)
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className="font-mono text-xs">{provider.data_classification}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {provider.timeout_ms}ms · {provider.max_concurrency}x ·{' '}
                        {provider.rate_limit_rpm} rpm
                      </TableCell>
                      <TableCell>
                        <Badge variant={provider.enabled ? 'primary' : 'default'}>
                          {provider.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Model Profiles & Cost Breakdown */}
      <Panel
        title="Model Capability Matrix & Cost Rates"
        description="Context windows, structured-output support, and micro-USD rates per 1K tokens."
        actions={
          <div className="flex items-center gap-1.5">
            <ProvenanceBadge kind="derived" />
            <ProvenanceBadge kind="ephemeral" />
          </div>
        }
      >
        <Table scrollLabel="Model capability matrix table" density="compact">
          <TableHead>
            <TableRow>
              <TableHeader>Model Profile</TableHeader>
              <TableHeader>Provider</TableHeader>
              <TableHeader>Context / Output</TableHeader>
              <TableHeader>Capabilities</TableHeader>
              <TableHeader>Rate (Micro-USD / 1K)</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {allModels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="font-mono text-xs text-ink-soft">
                  No model profiles configured yet for this company context.
                </TableCell>
              </TableRow>
            ) : (
              allModels.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="font-mono text-xs">
                    <div className="font-bold text-ink">{model.name}</div>
                    <div className="text-ink-faint">{model.model_id}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {model.providerName} ({model.providerKind})
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {model.context_window} ctx / {model.max_output_tokens} max out
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    Tools: {model.supports_tools ? 'Yes' : 'No'} · Schema:{' '}
                    {model.supports_structured_output ? 'Yes' : 'No'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    In: {model.input_cost_micros_per_1k} µ$ · Out: {model.output_cost_micros_per_1k}{' '}
                    µ$
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      <CloudProviderDefaultPanel
        providers={providers}
        onChanged={() => {
          void providersQuery.refetch();
        }}
      />
    </MissionControlShell>
  );
}
