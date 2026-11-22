'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AddonIcon, GlobeIcon, RefreshIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

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

export function CloudIspPage() {
  const queryClient = useQueryClient();

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

  const deployAppMutation = useMutation({
    mutationFn: async (appId: number) =>
      client.request<{ success: boolean; data: { containerId?: string; status: string } }>(
        `/api/cloud/apps/${appId}/deploy`,
        { method: 'POST' }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cloud'] });
      toast.success('Deployment triggered through Docker Agent.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to deploy cloud application.');
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

  const refreshAll = async () => {
    await Promise.all([
      cloudHealthQuery.refetch(),
      ispHealthQuery.refetch(),
      appsQuery.refetch(),
      deploymentsQuery.refetch(),
      nasQuery.refetch(),
      subscribersQuery.refetch(),
    ]);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cloud & ISP"
        accentTitle="Operations"
        description="Trigger container deployments via the local Docker Agent and manage ISP RADIUS gateways and subscribers."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
            <RefreshIcon className="mr-2 size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Docker Agent"
          value={cloudHealthQuery.data?.controlPlane ?? (cloudHealthQuery.isLoading ? '...' : 'error')}
          detail={`Docker: ${cloudHealthQuery.data?.docker ?? 'unknown'}`}
        />
        <MetricTile
          label="ISP RADIUS"
          value={ispHealthQuery.data?.runtime ?? (ispHealthQuery.isLoading ? '...' : 'error')}
          detail="Control API :3002"
        />
        <MetricTile
          label="NAS Devices"
          value={String(ispHealthQuery.data?.nasCount ?? nasQuery.data?.length ?? 0)}
          detail="Active gateways"
        />
        <MetricTile
          label="Subscribers"
          value={String(ispHealthQuery.data?.subscriberCount ?? subscribersQuery.data?.length ?? 0)}
          detail="Managed accounts"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Cloud Applications" description="Managed through /api/cloud/apps/:id/deploy">
          {appsQuery.isLoading ? (
            <Skeleton className="h-24 bg-ink/10" />
          ) : appsQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load cloud applications.</p>
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

          {deploymentsQuery.data && deploymentsQuery.data.length > 0 && (
            <div className="mt-4 space-y-2 border-t-2 border-ink/15 pt-4">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                Recent Deployments
              </p>
              {deploymentsQuery.data.slice(0, 5).map((dep) => (
                <div key={dep.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono">
                    #{dep.id} · {dep.container_id ?? 'no-container'}
                  </span>
                  <Badge variant={dep.status === 'running' ? 'cyan' : 'magenta'}>
                    {dep.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="ISP Gateways & Subscribers" description="Sync NAS devices and manage access">
          <div className="space-y-4">
            <div>
              <p className="mb-2 font-mono text-xs uppercase tracking-wider text-ink-faint">
                NAS Gateways
              </p>
              {nasQuery.isLoading ? (
                <Skeleton className="h-20 bg-ink/10" />
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncNasMutation.isPending}
                        onClick={() => syncNasMutation.mutate(nas.id)}
                      >
                        Sync RADIUS
                      </Button>
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
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={sub.status === 'suspended' || suspendSubscriberMutation.isPending}
                        onClick={() => suspendSubscriberMutation.mutate(sub.id)}
                      >
                        Suspend
                      </Button>
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
