'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AddonIcon, CodeIcon, GlobeIcon, KeyIcon, RefreshIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { useDesktopBridge } from '@/lib/desktop-bridge';
import { scopedQueryKey } from '@/lib/query-scope';
import { MeshFleetDrawer } from '@/components/ai/mesh-fleet-drawer';
import { PaasStudioPanel } from '@/components/cloud/paas-studio-panel';

interface CloudHealthPayload {
  controlPlane: 'connected' | 'unreachable';
  docker: string;
}

interface IspHealthPayload {
  runtime: 'connected' | 'unreachable';
  nasCount: number;
  subscriberCount: number;
}

interface CloudAppRecord {
  id: number;
  name: string;
  image: string;
  image_tag?: string;
  domain?: string;
  is_active: boolean;
}

interface CloudDeploymentRecord {
  id: number;
  app_id: number;
  status: string;
  container_id?: string | null;
  started_at?: string | null;
  log?: string | null;
  error_message?: string | null;
}

interface IspNasRecord {
  id: number;
  name: string;
  ip_address: string;
  vendor?: string | null;
  is_active: boolean;
}

interface IspSubscriberRecord {
  id: number;
  username: string;
  type: string;
  status: string;
  ip_address?: string | null;
}

interface LiveSessionsPayload {
  dbSessions: Array<{
    id: number;
    session_id: string;
    username: string;
    framed_ip?: string | null;
    acct_input_octets?: number;
    acct_output_octets?: number;
  }>;
  runtimeSessions: Array<{
    session_id: string;
    username: string;
    status: string;
    framed_ip?: string | null;
  }>;
}

export function CloudIspPage() {
  const queryClient = useQueryClient();
  const { isDesktop } = useDesktopBridge();
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [terraformPreview, setTerraformPreview] = useState<string | null>(null);

  const cloudHealthQuery = useQuery({
    queryKey: scopedQueryKey(['cloud', 'health']),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: CloudHealthPayload }>(
        '/api/cloud/health'
      );
      return response.data;
    },
  });

  const ispHealthQuery = useQuery({
    queryKey: scopedQueryKey(['isp', 'health']),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: IspHealthPayload }>(
        '/api/isp/health'
      );
      return response.data;
    },
  });

  const appsQuery = useQuery({
    queryKey: scopedQueryKey(['cloud', 'apps']),
    queryFn: async () => {
      const res = await client.model<CloudAppRecord>('cloud.app').searchRead({ limit: 25 });
      return res.records;
    },
  });

  const deploymentsQuery = useQuery({
    queryKey: scopedQueryKey(['cloud', 'deployments']),
    queryFn: async () => {
      const res = await client
        .model<CloudDeploymentRecord>('cloud.deployment')
        .searchRead({ limit: 10 });
      return res.records;
    },
  });

  const nasQuery = useQuery({
    queryKey: scopedQueryKey(['isp', 'nas']),
    queryFn: async () => {
      const res = await client.model<IspNasRecord>('isp.nas').searchRead({ limit: 25 });
      return res.records;
    },
  });

  const subscribersQuery = useQuery({
    queryKey: scopedQueryKey(['isp', 'subscribers']),
    queryFn: async () => {
      const res = await client
        .model<IspSubscriberRecord>('isp.subscriber')
        .searchRead({ limit: 25 });
      return res.records;
    },
  });

  const liveSessionsQuery = useQuery({
    queryKey: scopedQueryKey(['isp', 'sessions', 'live']),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: LiveSessionsPayload }>(
        '/api/isp/sessions/live'
      );
      return response.data;
    },
    refetchInterval: 10_000,
  });

  const deployAppMutation = useMutation({
    mutationFn: async (appId: number) =>
      client.request<{ success: boolean; data: { deploymentId: number; status: string } }>(
        `/api/cloud/apps/${appId}/deploy`,
        { method: 'POST' }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cloud'] });
      toast.success('Deployment triggered through provider.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to deploy cloud application.');
    },
  });

  const loadDeploymentLogMutation = useMutation({
    mutationFn: async (deploymentId: number) =>
      client.request<{
        success: boolean;
        data: { id: number; status: string; log: string; errorMessage: string | null };
      }>(`/api/cloud/deployments/${deploymentId}/logs`),
    onSuccess: (res) => {
      setSelectedLog(
        `Deployment #${res.data.id} [${res.data.status}]\n${res.data.log || res.data.errorMessage || 'No log output yet.'}`
      );
    },
  });

  const exportTerraformMutation = useMutation({
    mutationFn: async () => client.request<string>('/api/cloud/export/terraform'),
    onSuccess: (hcl) => {
      setTerraformPreview(typeof hcl === 'string' ? hcl : JSON.stringify(hcl, null, 2));
      toast.success('Terraform HCL generated.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to export Terraform HCL.');
    },
  });

  const syncNasMutation = useMutation({
    mutationFn: async (nasId: number) =>
      client.request<{ success: boolean }>(`/api/isp/nas/${nasId}/sync`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['isp'] });
      toast.success('NAS gateway synced to ISP RADIUS runtime.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to sync NAS device.');
    },
  });

  const rotateNasSecretMutation = useMutation({
    mutationFn: async (nasId: number) =>
      client.request<{ success: boolean; data: { rotated?: boolean; runtimeSynced: boolean } }>(
        `/api/isp/nas/${nasId}/rotate-secret`,
        { method: 'POST', body: {} }
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['isp'] });
      if (result?.data?.runtimeSynced === false) {
        toast.error('NAS secret rotation did not sync to ISP RADIUS runtime.');
        return;
      }
      toast.success('NAS secret rotated and synced to ISP RADIUS runtime.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to rotate NAS secret.');
    },
  });

  const syncSubscriberMutation = useMutation({
    mutationFn: async (subscriberId: number) =>
      client.request<{ success: boolean }>(`/api/isp/subscribers/${subscriberId}/sync`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['isp'] });
      toast.success('Subscriber synced to ISP RADIUS.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to sync subscriber.');
    },
  });

  const suspendSubscriberMutation = useMutation({
    mutationFn: async (subscriberId: number) =>
      client.request<{ success: boolean }>(`/api/isp/subscribers/${subscriberId}/suspend`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['isp'] });
      toast.success('Subscriber suspended and RADIUS disconnect queued.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to suspend subscriber.');
    },
  });

  const runMeteringMutation = useMutation({
    mutationFn: async () =>
      client.request<{ success: boolean; data: { createdInvoiceLines: number } }>(
        '/api/isp/metering/run',
        { method: 'POST', body: {} }
      ),
    onSuccess: (res) => {
      toast.success(`Usage metering complete: ${res.data.createdInvoiceLines} line(s) created.`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to run usage metering.');
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      cloudHealthQuery.refetch(),
      ispHealthQuery.refetch(),
      appsQuery.refetch(),
      deploymentsQuery.refetch(),
      nasQuery.refetch(),
      subscribersQuery.refetch(),
      liveSessionsQuery.refetch(),
    ]);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cloud & ISP"
        accentTitle="Operations"
        description="Deploy containers via Docker Agent or Coolify, export Terraform HCL, and operate ISP RADIUS gateways."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exportTerraformMutation.isPending}
              onClick={() => exportTerraformMutation.mutate()}
            >
              <CodeIcon className="mr-2 size-4" />
              Export Terraform
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
              <RefreshIcon className="mr-2 size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Docker Agent"
          value={
            cloudHealthQuery.data?.controlPlane ?? (cloudHealthQuery.isLoading ? '...' : '—')
          }
          detail={`Docker: ${cloudHealthQuery.data?.docker ?? 'unknown'}`}
          error={cloudHealthQuery.isError ? cloudHealthQuery.error?.message : undefined}
        />
        <MetricTile
          label="ISP RADIUS"
          value={ispHealthQuery.data?.runtime ?? (ispHealthQuery.isLoading ? '...' : '—')}
          detail="Control API :3002"
          error={ispHealthQuery.isError ? ispHealthQuery.error?.message : undefined}
        />
        <MetricTile
          label="NAS Devices"
          value={String(ispHealthQuery.data?.nasCount ?? nasQuery.data?.length ?? 0)}
          detail={ispHealthQuery.isError && nasQuery.isError ? 'Load failed' : 'Active gateways'}
          error={(ispHealthQuery.isError || nasQuery.isError) ? (ispHealthQuery.error?.message ?? nasQuery.error?.message) : undefined}
        />
        <MetricTile
          label="Live Sessions"
          value={String(liveSessionsQuery.data?.runtimeSessions.length ?? 0)}
          detail={
            ispHealthQuery.isError && subscribersQuery.isError
              ? 'Load failed'
              : `${ispHealthQuery.data?.subscriberCount ?? subscribersQuery.data?.length ?? 0} subscribers`
          }
          error={liveSessionsQuery.isError ? liveSessionsQuery.error?.message : undefined}
        />
      </div>

      {isDesktop ? <MeshFleetDrawer /> : null}

      <PaasStudioPanel />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Cloud Applications" description="Managed through /api/cloud/apps/:id/deploy">
          {appsQuery.isLoading ? (
            <Skeleton className="h-24 bg-ink/10" />
          ) : appsQuery.isError ? (
            <ErrorState
              role="alert"
              headingLevel={3}
              title="Could not load cloud applications"
              description={
                appsQuery.error instanceof Error
                  ? appsQuery.error.message
                  : 'Unable to fetch cloud applications.'
              }
              retrying={appsQuery.isFetching}
              onRetry={() => void appsQuery.refetch()}
            />
          ) : !appsQuery.data?.length ? (
            <p className="text-sm text-ink-faint">No cloud applications configured yet.</p>
          ) : (
            <div className="space-y-3">
              {appsQuery.data.map((app) => (
                <div
                  key={app.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/20 bg-surface p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AddonIcon className="size-4 shrink-0" />
                      <span className="font-display text-sm uppercase">{app.name}</span>
                      <Badge variant={app.is_active ? 'cyan' : 'default'}>
                        {app.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink-faint">
                      {app.image}:{app.image_tag ?? 'latest'}
                      {app.domain ? ` · ${app.domain}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={deployAppMutation.isPending}
                    onClick={() => deployAppMutation.mutate(app.id)}
                  >
                    Deploy
                  </Button>
                </div>
              ))}
            </div>
          )}

          {deploymentsQuery.isError ? (
            <div className="mt-4 border-t-2 border-ink/15 pt-4">
              <ErrorState
                role="alert"
                headingLevel={3}
                title="Could not load deployments"
                description={
                  deploymentsQuery.error instanceof Error
                    ? deploymentsQuery.error.message
                    : 'Unable to fetch recent deployments.'
                }
                retrying={deploymentsQuery.isFetching}
                onRetry={() => void deploymentsQuery.refetch()}
              />
            </div>
          ) : deploymentsQuery.data && deploymentsQuery.data.length > 0 ? (
            <div className="mt-4 space-y-2 border-t-2 border-ink/15 pt-4">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                Recent Deployments
              </p>
              {deploymentsQuery.data.slice(0, 5).map((dep) => (
                <div key={dep.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">
                    #{dep.id} · {dep.container_id ?? 'no-container'}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant={dep.status === 'running' ? 'cyan' : 'magenta'}>
                      {dep.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => loadDeploymentLogMutation.mutate(dep.id)}
                    >
                      Logs
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {selectedLog && (
            <pre className="mt-4 overflow-x-auto border-2 border-ink/20 bg-paper p-3 font-mono text-xs">
              {selectedLog}
            </pre>
          )}
          {terraformPreview && (
            <pre className="mt-4 overflow-x-auto border-2 border-ink/20 bg-paper p-3 font-mono text-xs">
              {terraformPreview}
            </pre>
          )}
        </Panel>

        <Panel
          title="ISP Gateways, Subscribers & Sessions"
          description="Sync NAS devices, rotate secrets, and meter RADIUS usage"
        >
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                  NAS Gateways
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runMeteringMutation.isPending}
                  onClick={() => runMeteringMutation.mutate()}
                >
                  Run Metering
                </Button>
              </div>
              {nasQuery.isLoading ? (
                <Skeleton className="h-20 bg-ink/10" />
              ) : nasQuery.isError ? (
                <ErrorState
                  role="alert"
                  headingLevel={3}
                  title="Could not load NAS gateways"
                  description={
                    nasQuery.error instanceof Error
                      ? nasQuery.error.message
                      : 'Unable to fetch NAS gateways.'
                  }
                  retrying={nasQuery.isFetching}
                  onRetry={() => void nasQuery.refetch()}
                />
              ) : !nasQuery.data?.length ? (
                <p className="text-sm text-ink-faint">No NAS devices configured.</p>
              ) : (
                <div className="space-y-2">
                  {nasQuery.data.map((nas) => (
                    <div
                      key={nas.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink/20 bg-surface p-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <GlobeIcon className="size-4" />
                          <span className="font-display text-sm uppercase">{nas.name}</span>
                        </div>
                        <p className="font-mono text-xs text-ink-faint">
                          {nas.ip_address}
                          {nas.vendor ? ` · ${nas.vendor}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={syncNasMutation.isPending}
                          onClick={() => syncNasMutation.mutate(nas.id)}
                        >
                          Sync RADIUS
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rotateNasSecretMutation.isPending}
                          onClick={() => rotateNasSecretMutation.mutate(nas.id)}
                        >
                          <KeyIcon className="mr-1 size-3" />
                          Rotate Secret
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t-2 border-ink/15 pt-4">
              <p className="mb-2 font-mono text-xs uppercase tracking-wider text-ink-faint">
                Subscribers
              </p>
              {subscribersQuery.isLoading ? (
                <Skeleton className="h-20 bg-ink/10" />
              ) : subscribersQuery.isError ? (
                <ErrorState
                  role="alert"
                  headingLevel={3}
                  title="Could not load subscribers"
                  description={
                    subscribersQuery.error instanceof Error
                      ? subscribersQuery.error.message
                      : 'Unable to fetch ISP subscribers.'
                  }
                  retrying={subscribersQuery.isFetching}
                  onRetry={() => void subscribersQuery.refetch()}
                />
              ) : !subscribersQuery.data?.length ? (
                <p className="text-sm text-ink-faint">No ISP subscribers yet.</p>
              ) : (
                <div className="space-y-2">
                  {subscribersQuery.data.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink/20 bg-surface p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{sub.username}</span>
                        <Badge variant={sub.status === 'active' ? 'cyan' : 'magenta'}>
                          {sub.status}
                        </Badge>
                        <span className="font-mono text-xs text-ink-faint">{sub.type}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={syncSubscriberMutation.isPending}
                          onClick={() => syncSubscriberMutation.mutate(sub.id)}
                        >
                          Sync
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            sub.status === 'suspended' || suspendSubscriberMutation.isPending
                          }
                          onClick={() => suspendSubscriberMutation.mutate(sub.id)}
                        >
                          Suspend
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t-2 border-ink/15 pt-4">
              <p className="mb-2 font-mono text-xs uppercase tracking-wider text-ink-faint">
                Live RADIUS Feed
              </p>
              {liveSessionsQuery.isError ? (
                <ErrorState
                  role="alert"
                  headingLevel={3}
                  title="Could not load live RADIUS sessions"
                  description={
                    liveSessionsQuery.error instanceof Error
                      ? liveSessionsQuery.error.message
                      : 'Unable to fetch live RADIUS sessions.'
                  }
                  retrying={liveSessionsQuery.isFetching}
                  onRetry={() => void liveSessionsQuery.refetch()}
                />
              ) : !liveSessionsQuery.data?.runtimeSessions.length ? (
                <p className="text-xs text-ink-faint">No live RADIUS sessions reported.</p>
              ) : (
                <div className="space-y-1">
                  {liveSessionsQuery.data.runtimeSessions.slice(0, 5).map((sess) => (
                    <div key={sess.session_id} className="flex justify-between font-mono text-xs">
                      <span>
                        {sess.username} ({sess.framed_ip ?? 'dynamic'})
                      </span>
                      <Badge variant="cyan">{sess.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
