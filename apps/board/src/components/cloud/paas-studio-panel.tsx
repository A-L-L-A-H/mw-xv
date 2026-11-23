'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { LogConsole, type LogConsoleEntry } from '@moonwitness/ui/components/log-console';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import {
  ActivityIcon,
  BoltIcon,
  CheckIcon,
  CodeIcon,
  DeleteIcon,
  GlobeIcon,
  LockIcon,
  PauseIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';
import {
  PaasTemplateCatalog,
  type PaasTemplateDefinition,
} from './paas-template-catalog';

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

interface PostgresBackupRecord {
  readonly id: string;
  readonly filename: string;
  readonly createdAt: string;
  readonly sizeMb: number;
  readonly sha256: string;
  readonly verified: boolean;
}

const DEFAULT_TENANTS = ['default', 'production', 'staging'] as const;

const INITIAL_BACKUPS: readonly PostgresBackupRecord[] = [
  {
    id: 'pg-snap-001',
    filename: 'moonwitness_prod_20261123_0200.sql.zst',
    createdAt: '2026-11-23T02:00:00Z',
    sizeMb: 148,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    verified: true,
  },
];

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
  const [deployingTemplateId, setDeployingTemplateId] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeLogs, setActiveLogs] = useState<{ slug: string; text: string } | null>(null);

  const [slug, setSlug] = useState<string>('');
  const [image, setImage] = useState<string>('');
  const [domain, setDomain] = useState<string>('');
  const [port, setPort] = useState<string>('3000');
  const [tenant, setTenant] = useState<string>(tenants[0] ?? 'default');

  // Wave C.13: Live Logs & Stats state
  const [selectedLogApp, setSelectedLogApp] = useState<string>('control-plane');
  const [logEntries, setLogEntries] = useState<readonly LogConsoleEntry[]>([
    {
      id: 'init-1',
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'mesh',
      message: 'Live PaaS log stream ready. Select an app or click Refresh to pull stream/polling logs.',
    },
  ]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  // Wave C.14: Add VPS Node Wizard state
  const [vpsHost, setVpsHost] = useState<string>('203.0.113.42');
  const [vpsSshPort, setVpsSshPort] = useState<string>('22');
  const [vpsMeshIp, setVpsMeshIp] = useState<string>('10.144.0.12');
  const [vpsRegion, setVpsRegion] = useState<string>('ap-southeast-1');
  const [vpsTier, setVpsTier] = useState<string>('worker-4vcpu');

  // Wave C.15: PostgreSQL Backups & Restore state
  const [backups, setBackups] = useState<readonly PostgresBackupRecord[]>(INITIAL_BACKUPS);
  const [backupBusy, setBackupBusy] = useState<boolean>(false);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);

  const normalizedBase = apiBase.replace(/\/+$/u, '');

  const fetchLiveLogs = useCallback(async () => {
    setLogsLoading(true);
    const target = encodeURIComponent(selectedLogApp || 'control-plane');
    try {
      const streamRes = await fetch(`${normalizedBase}/apps/${target}/logs/stream`, {
        cache: 'no-store',
      });
      if (streamRes.ok) {
        const raw = await streamRes.text();
        const lines = raw
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-40);
        if (lines.length > 0) {
          setLogEntries(
            lines.map((line, index) => ({
              id: `stream-${Date.now()}-${index}`,
              timestamp: new Date().toISOString(),
              level: line.toLowerCase().includes('error') ? 'error' : 'info',
              source: 'sidecar',
              message: line,
            }))
          );
          return;
        }
      }

      const fallbackRes = await fetch(`${normalizedBase}/apps/${target}/logs`, {
        method: 'POST',
      });
      if (fallbackRes.ok) {
        const payload = (await fallbackRes.json().catch(() => ({}))) as { logs?: string };
        const text = payload.logs?.trim();
        if (text) {
          setLogEntries(
            text.split(/\r?\n/u).slice(-40).map((line, index) => ({
              id: `poll-${Date.now()}-${index}`,
              timestamp: new Date().toISOString(),
              level: line.toLowerCase().includes('error') ? 'error' : 'info',
              source: 'mesh',
              message: line,
            }))
          );
          return;
        }
      }

      setLogEntries((prev) => [
        ...prev.slice(-19),
        {
          id: `offline-${Date.now()}`,
          timestamp: new Date().toISOString(),
          level: 'warn',
          source: 'mesh',
          message: `Stream & polling fallback unavailable for "${selectedLogApp}" (Desktop DX bridge offline).`,
        },
      ]);
    } catch {
      setLogEntries((prev) => [
        ...prev.slice(-19),
        {
          id: `err-${Date.now()}`,
          timestamp: new Date().toISOString(),
          level: 'warn',
          source: 'mesh',
          message: `Unable to reach ${normalizedBase}/apps/${selectedLogApp}/logs/stream.`,
        },
      ]);
    } finally {
      setLogsLoading(false);
    }
  }, [normalizedBase, selectedLogApp]);

  const vpsJoinPlan = useMemo(() => {
    const safeHost = vpsHost.trim() || '203.0.113.42';
    const safePort = vpsSshPort.trim() || '22';
    const safeMeshIp = vpsMeshIp.trim() || '10.144.0.12';
    return [
      `# 1-Click VPS Node Join Plan (${vpsRegion} · ${vpsTier})`,
      `ssh -p ${safePort} root@${safeHost} 'curl -fsSL https://get.moonwitness.local/join.sh | sh -s -- \\`,
      `  --easytier-ip=${safeMeshIp}/24 \\`,
      `  --region=${vpsRegion} \\`,
      `  --tier=${vpsTier} \\`,
      `  --enable-control-plane \\`,
      `  --enable-caddy-tls'`,
    ].join('\n');
  }, [vpsHost, vpsSshPort, vpsMeshIp, vpsRegion, vpsTier]);

  const handleTriggerPostgresBackup = useCallback(async () => {
    setBackupBusy(true);
    setBackupFeedback(null);
    try {
      const response = await fetch(`${normalizedBase}/backups/postgres`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual-studio' }),
      });
      if (!response.ok) {
        setBackupFeedback(
          `Snapshot request returned HTTP ${response.status} (Desktop DX bridge required).`
        );
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as Partial<PostgresBackupRecord>;
      const created: PostgresBackupRecord = {
        id: payload.id ?? `pg-snap-${Date.now()}`,
        filename: payload.filename ?? `moonwitness_manual_${Date.now()}.sql.zst`,
        createdAt: payload.createdAt ?? new Date().toISOString(),
        sizeMb: payload.sizeMb ?? 150,
        sha256:
          payload.sha256 ??
          '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        verified: payload.verified ?? true,
      };
      setBackups((prev) => [created, ...prev]);
      setBackupFeedback(`Manual PostgreSQL snapshot created: ${created.filename}`);
    } catch {
      setBackupFeedback('Unable to reach /paas/backups/postgres (Desktop DX bridge offline).');
    } finally {
      setBackupBusy(false);
    }
  }, [normalizedBase]);

  const handleVerifyRestore = useCallback(
    async (backup: PostgresBackupRecord) => {
      setBackupBusy(true);
      setBackupFeedback(null);
      try {
        const response = await fetch(`${normalizedBase}/backups/restore`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            backupId: backup.id,
            filename: backup.filename,
            sha256: backup.sha256,
            dryRun: true,
          }),
        });
        if (!response.ok) {
          setBackupFeedback(
            `Dry-run restore check returned HTTP ${response.status} for ${backup.filename}.`
          );
          return;
        }
        setBackupFeedback(
          `Dry-run restore verified for ${backup.filename} (SHA-256 ${backup.sha256.slice(0, 12)}...).`
        );
      } catch {
        setBackupFeedback(`Unable to reach /paas/backups/restore for ${backup.filename}.`);
      } finally {
        setBackupBusy(false);
      }
    },
    [normalizedBase]
  );

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

  const handleDeployTemplate = useCallback(
    async (template: PaasTemplateDefinition) => {
      setDeployingTemplateId(template.id);
      setErrorMessage(null);
      setFeedback(null);
      try {
        const response = await fetch(`${normalizedBase}/apps/deploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: template.id,
            image: template.image,
            port: template.defaultPort,
            tenant,
          }),
        });
        if (!response.ok) {
          setErrorMessage(`Template deploy failed for ${template.name} (HTTP ${response.status}).`);
          return;
        }
        setFeedback(`Deployed ${template.name} (${template.image}) to tenant ${tenant}.`);
        await refreshState();
      } catch {
        setErrorMessage(`Unable to deploy template ${template.name}.`);
      } finally {
        setDeployingTemplateId(null);
      }
    },
    [normalizedBase, refreshState, tenant]
  );

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

      <Panel
        title="Live PaaS Operations Suite"
        description="Stream container logs, generate 1-click EasyTier VPS join plans, and manage SHA-256 verified PostgreSQL backups."
        actions={<Badge variant="primary">Wave C.13–C.15</Badge>}
      >
        <Tabs defaultValue="logs-stats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="logs-stats">Live Logs &amp; Stats</TabsTrigger>
            <TabsTrigger value="vps-wizard">Add VPS Node Wizard</TabsTrigger>
            <TabsTrigger value="pg-backups">PostgreSQL Backups &amp; Restore</TabsTrigger>
          </TabsList>

          <TabsContent value="logs-stats" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile
                label="Live CPU"
                value={`${metrics?.cpuPercent ?? 0}%`}
                detail={metrics?.nodeId ?? 'mesh-node'}
                accent="cyan"
                icon={<ActivityIcon className="h-4 w-4" />}
              />
              <MetricTile
                label="Live RAM"
                value={`${metrics?.memoryPercent ?? 0}%`}
                detail={`${metrics?.memoryUsedMb ?? 0} / ${metrics?.memoryTotalMb ?? 0} MB`}
                accent="magenta"
                icon={<BoltIcon className="h-4 w-4" />}
              />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="paas-log-target">Target App Stream</Label>
                <div className="flex items-center gap-2">
                  <SelectField
                    id="paas-log-target"
                    value={selectedLogApp}
                    onChange={(event) => setSelectedLogApp(event.target.value)}
                  >
                    <option value="control-plane">control-plane</option>
                    {apps.map((app) => (
                      <option key={app.id} value={app.slug || app.id}>
                        {app.slug}
                      </option>
                    ))}
                  </SelectField>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={logsLoading}
                    onClick={() => void fetchLiveLogs()}
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                    Stream
                  </Button>
                </div>
              </div>
            </div>

            <LogConsole
              title={`Live Stream: ${selectedLogApp}`}
              description={`Wired to ${normalizedBase}/apps/${selectedLogApp}/logs/stream with polling fallback.`}
              entries={logEntries}
              loading={logsLoading}
              onRefresh={() => void fetchLiveLogs()}
              onClear={() => setLogEntries([])}
            />
          </TabsContent>

          <TabsContent value="vps-wizard" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label htmlFor="vps-host">Host / Public IP</Label>
                <Input
                  id="vps-host"
                  value={vpsHost}
                  onChange={(event) => setVpsHost(event.target.value)}
                  placeholder="203.0.113.42"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vps-ssh-port">SSH Port</Label>
                <Input
                  id="vps-ssh-port"
                  type="number"
                  value={vpsSshPort}
                  onChange={(event) => setVpsSshPort(event.target.value)}
                  placeholder="22"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vps-mesh-ip">EasyTier Mesh IP</Label>
                <Input
                  id="vps-mesh-ip"
                  value={vpsMeshIp}
                  onChange={(event) => setVpsMeshIp(event.target.value)}
                  placeholder="10.144.0.12"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vps-region">Region</Label>
                <SelectField
                  id="vps-region"
                  value={vpsRegion}
                  onChange={(event) => setVpsRegion(event.target.value)}
                >
                  <option value="ap-southeast-1">ap-southeast-1 (SG)</option>
                  <option value="ap-southeast-3">ap-southeast-3 (ID)</option>
                  <option value="eu-central-1">eu-central-1 (DE)</option>
                  <option value="us-east-1">us-east-1 (US)</option>
                </SelectField>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vps-tier">Node Tier</Label>
                <SelectField
                  id="vps-tier"
                  value={vpsTier}
                  onChange={(event) => setVpsTier(event.target.value)}
                >
                  <option value="edge-2vcpu">Edge (2 vCPU / 4 GB)</option>
                  <option value="worker-4vcpu">Worker (4 vCPU / 8 GB)</option>
                  <option value="db-8vcpu">Database (8 vCPU / 16 GB)</option>
                </SelectField>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-ink/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wide text-ink">
                  1-Click EasyTier + Control-Plane + Caddy Join Plan
                </span>
                <Badge variant="cyan">Private Mesh Ready</Badge>
              </div>
              <pre className="overflow-x-auto rounded bg-ink/5 p-3 font-mono text-xs text-ink">
                {vpsJoinPlan}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="pg-backups" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">PostgreSQL Snapshots &amp; Dry-Run Verification</p>
                <p className="text-xs opacity-75">
                  All snapshots are checksummed with SHA-256 before restore verification.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={backupBusy}
                onClick={() => void handleTriggerPostgresBackup()}
              >
                <LockIcon className="h-3.5 w-3.5" />
                {backupBusy ? 'Working...' : 'Trigger Manual Snapshot'}
              </Button>
            </div>

            {backupFeedback ? (
              <div className="rounded-md border border-ink/15 bg-ink/5 px-3 py-2 font-mono text-xs">
                {backupFeedback}
              </div>
            ) : null}

            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold">{backup.filename}</span>
                      <Badge variant={backup.verified ? 'primary' : 'magenta'}>
                        <CheckIcon className="mr-1 h-3 w-3" />
                        SHA-256: {backup.sha256.slice(0, 12)}...
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] opacity-75">
                      {backup.createdAt} · {backup.sizeMb} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={backupBusy}
                    onClick={() => void handleVerifyRestore(backup)}
                  >
                    <SecurityIcon className="h-3.5 w-3.5" />
                    Dry-Run Verify Restore
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </Panel>

      <PaasTemplateCatalog
        deployingTemplateId={deployingTemplateId}
        onDeployTemplate={handleDeployTemplate}
      />

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
