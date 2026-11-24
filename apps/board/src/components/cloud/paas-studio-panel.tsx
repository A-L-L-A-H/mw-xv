'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { LogConsole, type LogConsoleEntry } from '@moonwitness/ui/components/log-console';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
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
import { ConfirmDialog } from '@/components/views/confirm-dialog';
import { MeshTopologyPanel } from './mesh-topology-panel';
import { PaasTemplateCatalog } from './paas-template-catalog';
import type { PaasTemplateDefinition } from './paas-template-data';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNodeMetrics(value: unknown): PaasStudioNodeMetrics | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.nodeId !== 'string' ||
    typeof value.meshIp !== 'string' ||
    !isFiniteNumber(value.cpuPercent) ||
    !isFiniteNumber(value.memoryUsedMb) ||
    !isFiniteNumber(value.memoryTotalMb) ||
    !isFiniteNumber(value.memoryPercent) ||
    !isFiniteNumber(value.runningApps)
  ) {
    return null;
  }
  return value as unknown as PaasStudioNodeMetrics;
}

function parseApps(value: unknown): readonly PaasStudioApp[] | null {
  if (!Array.isArray(value)) return null;
  const apps: PaasStudioApp[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.slug !== 'string' ||
      typeof item.image !== 'string' ||
      typeof item.status !== 'string'
    ) {
      return null;
    }
    apps.push(item as unknown as PaasStudioApp);
  }
  return apps;
}

function parsePostgresBackup(value: unknown): PostgresBackupRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.filename !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isFiniteNumber(value.sizeMb) ||
    typeof value.sha256 !== 'string' ||
    typeof value.verified !== 'boolean'
  ) {
    return null;
  }
  return value as unknown as PostgresBackupRecord;
}

function statusBadgeVariant(status: string): 'primary' | 'cyan' | 'destructive' | 'default' {
  const normalized = status.toLowerCase();
  if (normalized === 'running' || normalized === 'healthy') return 'primary';
  if (normalized === 'deploying' || normalized === 'starting') return 'cyan';
  if (normalized === 'failed' || normalized === 'error' || normalized === 'stopped') {
    return 'destructive';
  }
  return 'default';
}

const initialLogTimestamp = () => new Date().toISOString();

export function PaasStudioPanel({
  apiBase = '/api/desktop/paas',
  tenants = DEFAULT_TENANTS,
}: PaasStudioPanelProps) {
  const [metrics, setMetrics] = useState<PaasStudioNodeMetrics | null>(null);
  const [apps, setApps] = useState<readonly PaasStudioApp[] | null>(null);
  const [desktopModeAvailable, setDesktopModeAvailable] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [deploying, setDeploying] = useState<boolean>(false);
  const [deployingTemplateId, setDeployingTemplateId] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [pendingAppAction, setPendingAppAction] = useState<{
    app: PaasStudioApp;
    action: 'stop' | 'delete';
  } | null>(null);
  const [activeLogs, setActiveLogs] = useState<{ slug: string; text: string } | null>(null);

  const [slug, setSlug] = useState<string>('');
  const [image, setImage] = useState<string>('');
  const [domain, setDomain] = useState<string>('');
  const [port, setPort] = useState<string>('3000');
  const [tenant, setTenant] = useState<string>(tenants[0] ?? 'default');

  // Wave C.13: Live Logs & Stats state
  const [selectedLogApp, setSelectedLogApp] = useState<string>('control-plane');
  const [logEntries, setLogEntries] = useState<readonly LogConsoleEntry[]>(() => [
    {
      id: 'init-1',
      timestamp: initialLogTimestamp(),
      level: 'info',
      source: 'mesh',
      message:
        'Live PaaS log stream ready. Select an app or click Refresh to pull stream/polling logs.',
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
  const [backups, setBackups] = useState<readonly PostgresBackupRecord[]>([]);
  const [backupsLoaded, setBackupsLoaded] = useState<boolean>(false);
  const [backupBusy, setBackupBusy] = useState<boolean>(false);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(
    'Live PostgreSQL backup inventory is not exposed by the current Desktop bridge.'
  );

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
            text
              .split(/\r?\n/u)
              .slice(-40)
              .map((line, index) => ({
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
    setBackupError(null);
    try {
      const response = await fetch(`${normalizedBase}/backups/postgres`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual-studio' }),
      });
      if (!response.ok) {
        setBackupError(
          `Snapshot request returned HTTP ${response.status} (Desktop DX bridge required).`
        );
        return;
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      const created = isRecord(payload) && payload.success === true
        ? parsePostgresBackup(payload.data)
        : null;
      if (!created) {
        setBackupError(
          'Snapshot response did not include complete live backup metadata; no fixture was created.'
        );
        setBackupFeedback(null);
        return;
      }
      setBackups((prev) => [created, ...prev.filter((backup) => backup.id !== created.id)]);
      setBackupsLoaded(true);
      setBackupError(null);
      setBackupFeedback(`Manual PostgreSQL snapshot created: ${created.filename}`);
    } catch {
      setBackupError('Unable to reach /paas/backups/postgres (Desktop DX bridge offline).');
    } finally {
      setBackupBusy(false);
    }
  }, [normalizedBase]);

  const handleVerifyRestore = useCallback(
    async (backup: PostgresBackupRecord) => {
      setBackupBusy(true);
      setBackupFeedback(null);
      setBackupError(null);
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
          setBackupError(
            `Dry-run restore check returned HTTP ${response.status} for ${backup.filename}.`
          );
          return;
        }
        const payload = (await response.json().catch(() => null)) as unknown;
        const result = isRecord(payload) && payload.success === true && isRecord(payload.data)
          ? payload.data
          : null;
        if (!result || (result.verified !== true && result.ok !== true)) {
          setBackupError(
            `Dry-run response did not confirm verification for ${backup.filename}.`
          );
          setBackupFeedback(null);
          return;
        }
        setBackupError(null);
        setBackupFeedback(
          `Dry-run restore verified for ${backup.filename} (SHA-256 ${backup.sha256.slice(0, 12)}...).`
        );
      } catch {
        setBackupError(`Unable to reach /paas/backups/restore for ${backup.filename}.`);
      } finally {
        setBackupBusy(false);
      }
    },
    [normalizedBase]
  );

  const refreshState = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    setStateError(null);
    try {
      const [metricsRes, appsRes] = await Promise.all([
        fetch(`${normalizedBase}/metrics`, { cache: 'no-store' }),
        fetch(`${normalizedBase}/apps`, { cache: 'no-store' }),
      ]);

      if (metricsRes.status === 404 || appsRes.status === 404) {
        setDesktopModeAvailable(false);
        setMetrics(null);
        setApps(null);
        return;
      }

      if (!metricsRes.ok || !appsRes.ok) {
        setDesktopModeAvailable(false);
        setMetrics(null);
        setApps(null);
        setStateError('MoonWitness Mesh PaaS control-plane telemetry could not be loaded.');
        return;
      }

      const [metricsPayload, appsPayload] = (await Promise.all([
        metricsRes.json().catch(() => null),
        appsRes.json().catch(() => null),
      ])) as unknown[];
      const metricsData =
        isRecord(metricsPayload) && metricsPayload.success === true
          ? parseNodeMetrics(metricsPayload.data)
          : null;
      const appsData =
        isRecord(appsPayload) && appsPayload.success === true
          ? parseApps(appsPayload.data)
          : null;
      if (!metricsData || !appsData) {
        setDesktopModeAvailable(false);
        setMetrics(null);
        setApps(null);
        setStateError('The PaaS bridge returned incomplete telemetry; no values were inferred.');
        return;
      }

      setMetrics(metricsData);
      setApps(appsData);
      setDesktopModeAvailable(true);
    } catch {
      setDesktopModeAvailable(false);
      setMetrics(null);
      setApps(null);
      setStateError('Unable to reach the MoonWitness Mesh PaaS control-plane bridge.');
    } finally {
      setLoading(false);
    }
  }, [normalizedBase]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshState();
    });
    return () => {
      cancelled = true;
    };
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

      const payload = (await response.json().catch(() => null)) as unknown;
      const result = isRecord(payload) && payload.success === true && isRecord(payload.data)
        ? payload.data
        : null;
      if (!result || result.ok === false) {
        setErrorMessage(`Action "${action}" returned no successful result for ${app.slug}.`);
        return;
      }
      if (action === 'logs') {
        setActiveLogs({
          slug: app.slug,
          text: typeof result.logs === 'string' ? result.logs : 'No log output returned.',
        });
      } else {
        setFeedback(
          typeof result.message === 'string'
            ? result.message
            : `Action "${action}" completed for ${app.slug}.`
        );
        await refreshState();
      }
    } catch {
      setErrorMessage(`Failed to execute "${action}" on ${app.slug}.`);
    } finally {
      setBusyAppId(null);
    }
  };

  const confirmPendingAppAction = async () => {
    if (!pendingAppAction || busyAppId) return;
    const { app, action } = pendingAppAction;
    await handleAppAction(app, action);
    setPendingAppAction(null);
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
        {loading ? (
          <div role="status" aria-label="Loading PaaS telemetry" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : stateError ? (
          <EmptyState
            role="alert"
            title="Live PaaS telemetry unavailable"
            description={stateError}
            action={
              <Button variant="outline" onClick={() => void refreshState()}>
                Retry
              </Button>
            }
          />
        ) : !desktopModeAvailable ? (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm">
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Desktop DX Mode Required for Live Mesh PaaS</p>
              <p className="opacity-80">
                Launch MoonWitness Desktop DX to connect directly to your private mesh control-plane
                via <code>{normalizedBase}/*</code>.
              </p>
            </div>
          </div>
        ) : metrics && apps ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="CPU Load"
              value={`${metrics.cpuPercent}%`}
              detail={metrics.nodeId}
              accent="cyan"
              icon={<ActivityIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Memory"
              value={`${metrics.memoryPercent}%`}
              detail={`${metrics.memoryUsedMb} / ${metrics.memoryTotalMb} MB`}
              accent="magenta"
              icon={<BoltIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Mesh IP"
              value={metrics.meshIp}
              detail="Private WireGuard / Tailscale"
              accent="green"
              icon={<SignalIcon className="h-4 w-4" />}
            />
            <MetricTile
              label="Running Apps"
              value={String(metrics.runningApps)}
              detail="Active containers"
              accent="violet"
              icon={<GlobeIcon className="h-4 w-4" />}
            />
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Deploy Container App"
        description="Provision a new app with automatic TLS routing on your private mesh node."
      >
        <form
          onSubmit={(event) => void handleDeploy(event)}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
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
              {errorMessage ? (
                <span role="alert" className="text-destructive">
                  {errorMessage}
                </span>
              ) : null}
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
        {loading ? (
          <div role="status" aria-label="Loading deployed apps" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : stateError ? (
          <EmptyState
            role="alert"
            title="Deployed apps unavailable"
            description="The live app inventory failed to load; no previous or fixture apps are shown."
            action={
              <Button variant="outline" onClick={() => void refreshState()}>
                Retry
              </Button>
            }
          />
        ) : !desktopModeAvailable ? (
          <p className="text-sm opacity-75">
            Connect via Desktop DX to view and manage deployed apps.
          </p>
        ) : apps && apps.length === 0 ? (
          <p className="text-sm opacity-75">No PaaS apps deployed on this mesh node yet.</p>
        ) : apps ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {apps.map((app) => {
              const isBusy = busyAppId === app.id;
              return (
                <div
                  key={app.id}
                  aria-busy={isBusy}
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
                      disabled={busyAppId !== null}
                      onClick={() => void handleAppAction(app, 'restart')}
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                      Restart
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      disabled={busyAppId !== null}
                      onClick={() => setPendingAppAction({ app, action: 'stop' })}
                    >
                      <PauseIcon className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busyAppId !== null}
                      onClick={() => void handleAppAction(app, 'logs')}
                    >
                      <CodeIcon className="h-3.5 w-3.5" />
                      Logs
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      disabled={busyAppId !== null}
                      onClick={() => setPendingAppAction({ app, action: 'delete' })}
                    >
                      <DeleteIcon className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Live PaaS Operations Suite"
        description="Stream container logs, generate EasyTier VPS join plans, and inspect live PostgreSQL backup metadata."
        actions={<Badge variant="primary">Wave C.13–C.15</Badge>}
      >
        <Tabs defaultValue="logs-stats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="mesh-topology">Mesh Topology</TabsTrigger>
            <TabsTrigger value="logs-stats">Live Logs &amp; Stats</TabsTrigger>
            <TabsTrigger value="vps-wizard">Add VPS Node Wizard</TabsTrigger>
            <TabsTrigger value="pg-backups">PostgreSQL Backups &amp; Restore</TabsTrigger>
          </TabsList>

          <TabsContent value="mesh-topology">
            <MeshTopologyPanel apiBase={normalizedBase} />
          </TabsContent>

          <TabsContent value="logs-stats" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metrics ? (
                <>
                  <MetricTile
                    label="Live CPU"
                    value={`${metrics.cpuPercent}%`}
                    detail={metrics.nodeId}
                    accent="cyan"
                    icon={<ActivityIcon className="h-4 w-4" />}
                  />
                  <MetricTile
                    label="Live RAM"
                    value={`${metrics.memoryPercent}%`}
                    detail={`${metrics.memoryUsedMb} / ${metrics.memoryTotalMb} MB`}
                    accent="magenta"
                    icon={<BoltIcon className="h-4 w-4" />}
                  />
                </>
              ) : (
                <EmptyState
                  role={stateError ? 'alert' : undefined}
                  className="p-4 sm:col-span-2"
                  title={loading ? 'Loading live metrics' : 'Live metrics unavailable'}
                  description={
                    stateError ?? 'Live node metrics are only shown after a successful read.'
                  }
                  action={
                    stateError ? (
                      <Button variant="outline" size="sm" onClick={() => void refreshState()}>
                        Retry
                      </Button>
                    ) : undefined
                  }
                />
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="paas-log-target">Target App Stream</Label>
                <div className="flex items-center gap-2">
                  <SelectField
                    id="paas-log-target"
                    value={selectedLogApp}
                    onChange={(event) => setSelectedLogApp(event.target.value)}
                  >
                    <option value="control-plane">control-plane</option>
                    {apps?.map((app) => (
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
                <Badge variant="cyan">Plan Only · Not Provisioned</Badge>
              </div>
              <pre className="overflow-x-auto rounded bg-ink/5 p-3 font-mono text-xs text-ink">
                {vpsJoinPlan}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="pg-backups" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">
                  PostgreSQL Snapshots &amp; Dry-Run Verification
                </p>
                <p className="text-xs opacity-75">
                  Verification is shown only when the live bridge explicitly confirms it.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={backupBusy || !desktopModeAvailable}
                onClick={() => void handleTriggerPostgresBackup()}
              >
                <LockIcon className="h-3.5 w-3.5" />
                {backupBusy ? 'Working...' : 'Trigger Manual Snapshot'}
              </Button>
            </div>

            {backupError ? (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {backupError}
              </div>
            ) : null}
            {backupFeedback ? (
              <div role="status" className="rounded-md border border-ink/15 bg-ink/5 px-3 py-2 font-mono text-xs">
                {backupFeedback}
              </div>
            ) : null}

            {backups.length === 0 ? (
              <EmptyState
                className="p-6"
                title={backupsLoaded ? 'No PostgreSQL snapshots' : 'No live backup metadata loaded'}
                description={
                  backupsLoaded
                    ? 'The live inventory succeeded and returned no snapshots.'
                    : 'The current Desktop bridge does not expose a PostgreSQL backup inventory. No fixture backups are shown.'
                }
              />
            ) : (
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
                        {backup.verified ? (
                          <CheckIcon className="mr-1 h-3 w-3" />
                        ) : (
                          <WarningIcon className="mr-1 h-3 w-3" />
                        )}
                        {backup.verified ? 'Verified · ' : 'Unverified · '}
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
            )}
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
            <Button type="button" size="xs" variant="ghost" onClick={() => setActiveLogs(null)}>
              Close
            </Button>
          }
        >
          <pre className="max-h-64 overflow-auto rounded-md border p-3 text-xs">
            {activeLogs.text}
          </pre>
        </Panel>
      ) : null}

      <ConfirmDialog
        open={pendingAppAction !== null}
        title={pendingAppAction?.action === 'delete' ? 'Delete app' : 'Stop app'}
        description={
          pendingAppAction
            ? `${pendingAppAction.action === 'delete' ? 'Delete' : 'Stop'} ${pendingAppAction.app.slug}. The live inventory will update only after the control-plane confirms the action.`
            : ''
        }
        confirmLabel={pendingAppAction?.action === 'delete' ? 'Delete app' : 'Stop app'}
        destructive
        busy={pendingAppAction ? busyAppId === pendingAppAction.app.id : false}
        onConfirm={() => void confirmPendingAppAction()}
        onCancel={() => setPendingAppAction(null)}
      />
    </div>
  );
}
