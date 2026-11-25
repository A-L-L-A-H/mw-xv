'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CodeIcon,
  GlobeIcon,
  LockIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
} from '@moonwitness/ui/icons';
import { MeshNodeCard, type MeshNodeContainerItem } from '@/components/cloud/mesh-node-card';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { useDesktopMode } from '@/lib/desktop-mode';
import { scopedQueryKey } from '@/lib/query-scope';
import { VpsOnboardingCard } from './vps-onboarding-card';

export type MeshRemoteContainer = MeshNodeContainerItem;

export interface MeshFleetNode {
  id: string;
  hostname: string;
  meshIp: string;
  status: 'online' | 'degraded' | 'offline';
  containers: MeshRemoteContainer[];
}

export interface DesktopMeshStatusPayload {
  configured: boolean;
  networkName: string;
  subnet: string;
  redactedSecret: string;
  secretRefPath: string;
  created?: boolean;
  joinCommand: string;
  nodes: MeshFleetNode[];
}

function getNodeStatusBadgeVariant(
  status: MeshFleetNode['status']
): 'cyan' | 'magenta' | 'destructive' {
  if (status === 'online') return 'cyan';
  if (status === 'degraded') return 'magenta';
  return 'destructive';
}

export function MeshFleetDrawer() {
  const queryClient = useQueryClient();
  const { mode: desktopMode } = useDesktopMode();
  const [copiedJoin, setCopiedJoin] = useState(false);

  const meshStatusQuery = useQuery({
    queryKey: scopedQueryKey(['desktop', 'mesh', 'status']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: DesktopMeshStatusPayload;
      }>('/api/desktop/mesh/status');
      return response.data;
    },
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: DesktopMeshStatusPayload;
      }>('/api/desktop/mesh/bootstrap', { method: 'POST', body: {} });
      return response.data;
    },
    onSuccess: async (payload) => {
      queryClient.setQueryData(scopedQueryKey(['desktop', 'mesh', 'status']), payload);
      toast.success(
        payload.created
          ? 'Private P2P mesh initialized in ~/.moonwitness/mesh.env.'
          : 'Private P2P mesh status refreshed.'
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to initialize or refresh mesh.');
    },
  });

  const connectMeshMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: { state: string; dhcp: boolean; networkName: string };
      }>('/api/desktop/mesh/connect', { method: 'POST', body: {} });
      return response.data;
    },
    onSuccess: async (payload) => {
      toast.success(`Mesh client ${payload.state} (--dhcp) on ${payload.networkName}.`);
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['desktop', 'mesh', 'status']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to connect EasyTier mesh.');
    },
  });

  const mesh = meshStatusQuery.data;
  const nodes = mesh?.nodes ?? [];
  const totalContainers = nodes.reduce((sum, node) => sum + node.containers.length, 0);
  const healthyContainers = nodes.reduce(
    (sum, node) => sum + node.containers.filter((c) => c.health === 'healthy').length,
    0
  );

  const handleCopyJoinCommand = async () => {
    if (!mesh?.joinCommand) return;
    try {
      await navigator.clipboard.writeText(mesh.joinCommand);
      setCopiedJoin(true);
      toast.success('Redacted VPS join command copied.');
      window.setTimeout(() => setCopiedJoin(false), 2000);
    } catch {
      toast.error('Clipboard access unavailable.');
    }
  };

  return (
    <Panel className="space-y-6 border-primary/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <SecurityIcon className="size-5 text-primary" />
            <h2 className="text-base font-semibold">VPS Mesh Fleet &amp; Remote Docker</h2>
            <Badge variant={mesh?.configured ? 'cyan' : 'default'}>
              {mesh?.configured ? 'P2P Ready' : 'Uninitialized'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Desktop loopback control plane for private EasyTier P2P mesh credentials and remote VPS
            Docker nodes. Secrets stay redacted in UI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={connectMeshMutation.isPending}
            onClick={() => connectMeshMutation.mutate()}
          >
            <SignalIcon className="mr-2 size-4" />
            {connectMeshMutation.isPending ? 'Connecting...' : 'Connect Mesh (--dhcp)'}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={bootstrapMutation.isPending}
            onClick={() => bootstrapMutation.mutate()}
          >
            <RefreshIcon className="mr-2 size-4" />
            {bootstrapMutation.isPending ? 'Initializing...' : 'Initialize / Refresh Mesh'}
          </Button>
        </div>
      </div>

      {meshStatusQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Mesh Network"
            value={mesh?.networkName ?? 'unconfigured'}
            detail={mesh?.redactedSecret ? `Secret: ${mesh.redactedSecret}` : 'No credentials yet'}
          />
          <MetricTile
            label="Private Subnet"
            value={mesh?.subnet ?? '10.144.0.0/24'}
            detail="Zero public 0.0.0.0 bind"
          />
          <MetricTile
            label="Connected VPS Nodes"
            value={String(nodes.filter((n) => n.status === 'online').length)}
            detail={`${nodes.length} registered node(s)`}
          />
          <MetricTile
            label="Remote Containers"
            value={String(totalContainers)}
            detail={`${healthyContainers} healthy`}
          />
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <CodeIcon className="size-4 text-primary" />
            <span>Redacted VPS Join Hint</span>
          </div>
          <Badge variant="default">
            <LockIcon className="mr-1 size-3" />
            Secret Redacted
          </Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            aria-label="Redacted VPS join command"
            value={
              mesh?.joinCommand ??
              'Click "Initialize / Refresh Mesh" to generate ~/.moonwitness/mesh.env and VPS join command.'
            }
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!mesh?.joinCommand}
            onClick={() => void handleCopyJoinCommand()}
          >
            {copiedJoin ? (
              <CheckIcon className="mr-2 size-4" />
            ) : (
              <GlobeIcon className="mr-2 size-4" />
            )}
            {copiedJoin ? 'Copied' : 'Copy Hint'}
          </Button>
        </div>
        {mesh?.secretRefPath ? (
          <p className="text-[11px] text-muted-foreground">
            Local env file: <span className="font-mono">{mesh.secretRefPath}</span>
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SignalIcon className="size-4 text-primary" />
            <span>Remote Docker Fleet</span>
          </div>
          <Badge variant="default">{nodes.length} node(s)</Badge>
        </div>

        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
            No remote VPS nodes connected to this private mesh yet. Run the VPS installer on your
            control-plane host using the credentials in{' '}
            <span className="font-mono">~/.moonwitness/mesh.env</span>.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {nodes.map((node) => (
              <MeshNodeCard
                key={node.id}
                title={node.hostname}
                subtitle={node.meshIp}
                statusLabel={node.status}
                statusVariant={getNodeStatusBadgeVariant(node.status)}
                containers={node.containers}
                emptyContainersText="No remote containers reported."
              />
            ))}
          </div>
        )}
      </div>
      {desktopMode === 'developer' ? <VpsOnboardingCard /> : null}
    </Panel>
  );
}
