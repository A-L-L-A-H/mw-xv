'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import {
  ActivityIcon,
  BoltIcon,
  CodeIcon,
  DeleteIcon,
  GlobeIcon,
  PauseIcon,
  RefreshIcon,
  SignalIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';

export interface PaasStudioNodeMetrics {
  readonly nodeId: string;
  readonly meshIp: string;
  readonly cpuPercent: number;
  readonly memoryUsedMb: number;
  readonly memoryTotalMb: number;
  readonly memoryPercent: number;
  readonly runningApps: number;
}

export interface PaasStudioApp {
  readonly id: string;
  readonly slug: string;
  readonly image: string;
  readonly status: string;
  readonly domain?: string;
  readonly port?: number;
  readonly tenant?: string;
}

export interface PaasStudioPanelProps {
  readonly apiBase?: string;
  readonly tenants?: readonly string[];
}

type AppAction = 'restart' | 'stop' | 'logs' | 'delete';

const DEFAULT_TENANTS = ['default', 'production', 'staging'] as const;

function statusBadgeVariant(status: string): 'primary' | 'cyan' | 'destructive' | 'default' {
  const normalized = status.toLowerCase();
  if (normalized === 'running' || normalized === 'healthy') return 'primary';
  if (normalized === 'deploying' || normalized === 'starting') return 'cyan';
  if (normalized === 'failed' || normalized === 'error' || normalized === 'stopped') {
    return 'destructive';
  }
  return 'default';
}

export function PaasStudioPanel({
  apiBase = '/api/desktop/paas',
  tenants = DEFAULT_TENANTS,
}: PaasStudioPanelProps) {
  const [metrics, setMetrics] = useState<PaasStudioNodeMetrics | null>(null);
  const [apps, setApps] = useState<readonly PaasStudioApp[]>([]);
  const [desktopModeAvailable, setDesktopModeAvailable] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [deploying, setDeploying] = useState<boolean>(false);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeLogs, setActiveLogs] = useState<{ slug: string; text: string } | null>(null);

  const [slug, setSlug] = useState<string>('');
  const [image, setImage] = useState<string>('');
  const [domain, setDomain] = useState<string>('');
  const [port, setPort] = useState<string>('3000');
  const [tenant, setTenant] = useState<string>(tenants[0] ?? 'default');

  const normalizedBase = apiBase.replace(/\/+$/u, '');

  const refreshState = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [metricsRes, appsRes] = await Promise.all([
        fetch(`${normalizedBase}/metrics`, { cache: 'no-store' }),
        fetch(`${normalizedBase}/apps`, { cache: 'no-store' }),
      ]);

      if (metricsRes.status === 404 || appsRes.status === 404) {
        setDesktopModeAvailable(false);
        setMetrics(null);
        setApps([]);
        return;
      }

      if (!metricsRes.ok || !appsRes.ok) {
        setDesktopModeAvailable(false);
        setErrorMessage('MoonWitness Mesh PaaS control-plane bridge is currently offline.');
        return;
      }

      setDesktopModeAvailable(true);
      const metricsData = (await metricsRes.json()) as PaasStudioNodeMetrics;
      const appsPayload = (await appsRes.json()) as
        | { apps?: PaasStudioApp[] }
        | PaasStudioApp[];

      setMetrics(metricsData);
      setApps(Array.isArray(appsPayload) ? appsPayload : (appsPayload.apps ?? []));
    } catch {
      setDesktopModeAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [normalizedBase]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const handleDeploy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!slug.trim() || !image.trim()) {
      setErrorMessage('App Slug and Docker Image are required.');
      return;
    }

    setDeploying(true);
    setErrorMessage(null);
    setFeedback(null);

    try {
      const parsedPort = Number.parseInt(port, 10);
      const response = await fetch(`${normalizedBase}/apps/deploy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slug.trim(),
          image: image.trim(),
          domain: domain.trim() || undefined,
          port: Number.isFinite(parsedPort) ? parsedPort : 3000,
          tenant,
        }),
      });

      if (!response.ok) {
        setErrorMessage(`Deploy failed (${response.status}).`);
        return;
      }

      setFeedback(`Deployment triggered for ${slug.trim()}.`);
      setSlug('');
      setImage('');
      setDomain('');
      await refreshState();
    } catch {
      setErrorMessage('Unable to reach Desktop PaaS bridge.');
    } finally {
      setDeploying(false);
    }
  };

  const handleAppAction = async (app: PaasStudioApp, action: AppAction) => {
    setBusyAppId(app.id);
    setErrorMessage(null);
    setFeedback(null);

    try {
      const target = encodeURIComponent(app.slug || app.id);
      const url = `${normalizedBase}/apps/${target}/${action}`;

      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        setErrorMessage(`Action "${action}" failed for ${app.slug} (${response.status}).`);
        return;
      }

      const payload = (await response.json()) as { logs?: string; message?: string };
      if (action === 'logs') {
        setActiveLogs({
          slug: app.slug,
          text: payload.logs ?? 'No log output returned.',
        });
      } else {
        setFeedback(payload.message ?? `Action "${action}" completed for ${app.slug}.`);
        await refreshState();
      }
    } catch {
      setErrorMessage(`Failed to execute "${action}" on ${app.slug}.`);
    } finally {
      setBusyAppId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Panel
        title="MoonWitness Mesh PaaS Studio"
        description="Deploy and manage containerized workloads over private mesh VPS nodes."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshState()}
            disabled={loading}
          >
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </Button>
        }
      >
        {!desktopModeAvailable ? (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm">
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Desktop DX Mode Required for Live Mesh PaaS</p>
              <p className="opacity-80">
                You are currently viewing PaaS Studio in Web Mode. Launch MoonWitness Desktop DX
                to connect directly to your private mesh control-plane via{' '}
                <code>{normalizedBase}/*</code>.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="CPU Load"
              value={`${metrics?.cpuPercent ?? 0}%`}
              detail={metrics?.nodeId ?? 'mesh-node'}
              accent="cyan"
              icon={<ActivityIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Memory"
              value={`${metrics?.memoryPercent ?? 0}%`}
              detail={`${metrics?.memoryUsedMb ?? 0} / ${metrics?.memoryTotalMb ?? 0} MB`}
              accent="magenta"
              icon={<BoltIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Mesh IP"
              value={metrics?.meshIp ?? '—'}
              detail="Private WireGuard / Tailscale"
              accent="green"
              icon={<SignalIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Running Apps"
              value={String(metrics?.runningApps ?? apps.length)}
              detail="Active containers"
              accent="violet"
              icon={<GlobeIcon className="h-4 w-4" />}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Deploy Container App"
        description="Provision a new app with automatic TLS routing on your private mesh node."
      >
        <form onSubmit={(event) => void handleDeploy(event)} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="paas-app-slug">App Slug</Label>
            <Input
              id="paas-app-slug"
              placeholder="billing-api"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={!desktopModeAvailable || deploying}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="paas-docker-image">Docker Image</Label>
            <Input
              id="paas-docker-image"
              placeholder="ghcr.io/moonwitness/app:latest"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              disabled={!desktopModeAvailable || deploying}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="paas-domain-tls">Domain TLS</Label>
            <Input
              id="paas-domain-tls"
              placeholder="app.example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              disabled={!desktopModeAvailable || deploying}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="paas-port">Port</Label>
              <Input
                id="paas-port"
                type="number"
                placeholder="3000"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                disabled={!desktopModeAvailable || deploying}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paas-tenant">Tenant</Label>
              <SelectField
                id="paas-tenant"
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                disabled={!desktopModeAvailable || deploying}
              >
                {tenants.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <div className="text-sm">
              {errorMessage ? <span className="text-destructive">{errorMessage}</span> : null}
              {!errorMessage && feedback ? <span>{feedback}</span> : null}
            </div>
            <Button type="submit" disabled={!desktopModeAvailable || deploying}>
              <BoltIcon className="h-4 w-4" />
              {deploying ? 'Deploying...' : 'Deploy App'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Deployed Apps"
        description="Inspect container status, stream logs, or control lifecycle."
      >
        {apps.length === 0 ? (
          <p className="text-sm opacity-75">
            {desktopModeAvailable
              ? 'No PaaS apps deployed on this mesh node yet.'
              : 'Connect via Desktop DX to view and manage deployed apps.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {apps.map((app) => {
              const isBusy = busyAppId === app.id;
              return (
                <div
                  key={app.id}
                  className="flex flex-col justify-between gap-4 rounded-md border p-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{app.slug}</span>
                      <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
                    </div>
                    <p className="text-xs opacity-80">{app.image}</p>
                    <div className="flex flex-wrap gap-2 text-xs opacity-75">
                      {app.domain ? <span>TLS: {app.domain}</span> : null}
                      {app.port ? <span>Port: {app.port}</span> : null}
                      {app.tenant ? <span>Tenant: {app.tenant}</span> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void handleAppAction(app, 'restart')}
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                      Restart
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void handleAppAction(app, 'stop')}
                    >
                      <PauseIcon className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void handleAppAction(app, 'logs')}
                    >
                      <CodeIcon className="h-3.5 w-3.5" />
                      Logs
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={() => void handleAppAction(app, 'delete')}
                    >
                      <DeleteIcon className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {activeLogs ? (
        <Panel
          title={`Logs: ${activeLogs.slug}`}
          actions={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setActiveLogs(null)}
            >
              Close
            </Button>
          }
        >
          <pre className="max-h-64 overflow-auto rounded-md border p-3 text-xs">
            {activeLogs.text}
          </pre>
        </Panel>
      ) : null}
    </div>
  );
}
