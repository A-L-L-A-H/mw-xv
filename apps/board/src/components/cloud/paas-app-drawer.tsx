'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { Badge } from '@moonwitness/ui/components/badge';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { LogConsole, type LogConsoleEntry } from '@moonwitness/ui/components/log-console';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@moonwitness/ui/components/tabs';
import { CloseIcon, ExternalLinkIcon } from '@moonwitness/ui/icons';

export interface PaasAppDrawerProps {
  slug: string;
  apiBase: string;
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}

interface AppDetail {
  name: string;
  image?: string;
  domain?: string | null;
  deployMode?: string;
  deploy_mode?: string;
  ingressRoutes?: unknown;
  env_vars?: Record<string, string>;
  deployments?: Array<{
    id?: number;
    status?: string;
    version?: string;
    trigger?: string;
    started_at?: string;
    log?: string;
  }>;
  containerState?: { state?: string; status?: string };
}

interface AppStats {
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsed?: string;
  memoryLimit?: string;
}

function asRecord(value: unknown): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return {};
}

export function PaasAppDrawer({ slug, apiBase, fetchFn, onClose, onUpdated }: PaasAppDrawerProps) {
  const base = apiBase.replace(/\/+$/u, '');
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [stats, setStats] = useState<AppStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([]);
  const [envBusy, setEnvBusy] = useState(false);
  const [envMessage, setEnvMessage] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMessage, setDomainMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogConsoleEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, statsRes] = await Promise.all([
        fetchFn(`${base}/apps/${encodeURIComponent(slug)}`, { cache: 'no-store' }),
        fetchFn(`${base}/apps/${encodeURIComponent(slug)}/stats`, { cache: 'no-store' }).catch(
          () => null
        ),
      ]);
      if (!detailRes.ok) throw new Error(`App detail failed (${detailRes.status})`);
      const detailBody = (await detailRes.json()) as { success?: boolean; data?: AppDetail };
      const data = detailBody.data ?? (detailBody as unknown as AppDetail);
      setDetail(data);
      setEnvPairs(
        Object.entries(asRecord(data.env_vars)).map(([key, value]) => ({ key, value }))
      );
      setDomain(data.domain ?? '');
      if (statsRes?.ok) {
        const statsBody = (await statsRes.json()) as { success?: boolean; data?: AppStats };
        setStats(statsBody.data ?? (statsBody as unknown as AppStats));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load app details');
    } finally {
      setLoading(false);
    }
  }, [base, fetchFn, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stream logs via EventSource when possible; fall back to a single fetch.
  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    try {
      source = new EventSource(`${base}/apps/${encodeURIComponent(slug)}/logs/stream`);
      source.onmessage = (event) => {
        if (cancelled) return;
        const message = typeof event.data === 'string' ? event.data : '';
        setLogs((current) => [
          ...current.slice(-199),
          {
            id: `${Date.now()}-${current.length}`,
            timestamp: new Date().toISOString(),
            level: /error|fail/iu.test(message) ? 'error' : /warn/iu.test(message) ? 'warn' : 'info',
            source: 'mesh',
            message,
          },
        ]);
      };
    } catch {
      source = null;
    }
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [base, slug]);

  async function saveEnv() {
    setEnvBusy(true);
    setEnvMessage(null);
    try {
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) env[pair.key.trim()] = pair.value;
      }
      const res = await fetchFn(`${base}/apps/${encodeURIComponent(slug)}/env`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env, merge: true, redeploy: true }),
      });
      if (!res.ok) throw new Error(`Env update failed (${res.status})`);
      setEnvMessage('Environment saved. [REDACTED] values were preserved.');
      await load();
      await onUpdated();
    } catch (err) {
      setEnvMessage(err instanceof Error ? err.message : 'Failed to save environment');
    } finally {
      setEnvBusy(false);
    }
  }

  async function updateDomain() {
    setDomainBusy(true);
    setDomainMessage(null);
    try {
      const res = await fetchFn(`${base}/apps/${encodeURIComponent(slug)}/domain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) throw new Error(`Domain update failed (${res.status})`);
      setDomainMessage('Domain updated; proxy reloaded.');
      await load();
      await onUpdated();
    } catch (err) {
      setDomainMessage(err instanceof Error ? err.message : 'Failed to update domain');
    } finally {
      setDomainBusy(false);
    }
  }

  const deployMode = detail?.deployMode ?? detail?.deploy_mode ?? 'unknown';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/50" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-background p-4">
        <Panel
          title={`App: ${slug}`}
          description="Inspect live stats and manage this application."
          actions={
            <Button size="sm" variant="outline" onClick={onClose} aria-label="Close app drawer">
              <CloseIcon aria-hidden />
            </Button>
          }
        >
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error || !detail ? (
            <ErrorState
              title="App unavailable"
              description={error ?? 'App not found'}
              onRetry={() => void load()}
              headingLevel={3}
            />
          ) : (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="env">Env Vault</TabsTrigger>
                <TabsTrigger value="domain">Domain</TabsTrigger>
                <TabsTrigger value="history">History &amp; Logs</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="cyan">{deployMode}</Badge>
                  {detail.containerState?.state ? (
                    <Badge variant="default">State: {detail.containerState.state}</Badge>
                  ) : null}
                  {detail.image ? <Badge variant="default">{detail.image}</Badge> : null}
                </div>
                {detail.domain ? (
                  <a
                    className="flex items-center gap-1 text-sm underline"
                    href={`https://${detail.domain}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://{detail.domain} <ExternalLinkIcon aria-hidden />
                  </a>
                ) : null}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MetricTile label="CPU" value={`${stats?.cpuPercent ?? 0}%`} size="compact" />
                  <MetricTile label="Memory" value={stats?.memoryUsed ?? '—'} size="compact" />
                  <MetricTile
                    label="Memory %"
                    value={`${stats?.memoryPercent ?? 0}%`}
                    size="compact"
                  />
                  <MetricTile label="Limit" value={stats?.memoryLimit ?? '—'} size="compact" />
                </div>
              </TabsContent>

              <TabsContent value="env" className="space-y-3 pt-4">
                <p className="text-xs text-muted-foreground">
                  Values shown as [REDACTED] are preserved untouched on save.
                </p>
                {envPairs.map((pair, index) => (
                  <div key={`${pair.key}-${index}`} className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`env-key-${index}`}>Key</Label>
                      <Input
                        id={`env-key-${index}`}
                        value={pair.key}
                        onChange={(e) =>
                          setEnvPairs((current) =>
                            current.map((p, i) => (i === index ? { ...p, key: e.target.value } : p))
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`env-value-${index}`}>Value</Label>
                      <Input
                        id={`env-value-${index}`}
                        value={pair.value}
                        onChange={(e) =>
                          setEnvPairs((current) =>
                            current.map((p, i) =>
                              i === index ? { ...p, value: e.target.value } : p
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEnvPairs((current) => [...current, { key: '', value: '' }])}
                  >
                    Add variable
                  </Button>
                  {envPairs.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEnvPairs((current) => current.slice(0, -1))}
                    >
                      Remove last
                    </Button>
                  ) : null}
                  <Button size="sm" variant="default" disabled={envBusy} onClick={() => void saveEnv()}>
                    Save &amp; Redeploy
                  </Button>
                </div>
                {envMessage ? <p className="text-xs" aria-live="polite">{envMessage}</p> : null}
              </TabsContent>

              <TabsContent value="domain" className="space-y-3 pt-4">
                <div className="space-y-1">
                  <Label htmlFor="app-domain">Domain (blank to detach)</Label>
                  <Input
                    id="app-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="app.apps.example.com"
                  />
                </div>
                <Button size="sm" variant="default" disabled={domainBusy} onClick={() => void updateDomain()}>
                  Update Domain
                </Button>
                {domainMessage ? (
                  <p className="text-xs" aria-live="polite">{domainMessage}</p>
                ) : null}
              </TabsContent>

              <TabsContent value="history" className="space-y-3 pt-4">
                <h3 className="text-sm font-semibold">Deployment History</h3>
                {detail.deployments?.length ? (
                  <ul className="space-y-2 text-sm">
                    {detail.deployments.map((dep, index) => (
                      <li key={dep.id ?? index} className="flex flex-wrap justify-between gap-2">
                        <span>{dep.version ?? 'latest'}</span>
                        <Badge variant="default">{dep.status ?? 'unknown'}</Badge>
                        <span className="text-xs opacity-70">{dep.started_at ?? ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No deployments" description="Deployments appear here after a deploy." />
                )}
                <LogConsole
                  title="Live Logs"
                  entries={logs}
                  emptyMessage="Waiting for log stream…"
                />
              </TabsContent>
            </Tabs>
          )}
        </Panel>
      </div>
    </div>
  );
}
