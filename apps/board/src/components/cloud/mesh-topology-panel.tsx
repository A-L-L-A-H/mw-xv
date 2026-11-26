'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import {
  ActivityIcon,
  CheckIcon,
  GlobeIcon,
  LockIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';
import { MeshNodeCard } from './mesh-node-card';
import {
  L7TopologyCanvas,
  type L7TopologyEdge,
  type L7TopologyNode,
} from './l7-topology-canvas';

export type MeshPeerHealth = 'healthy' | 'degraded' | 'offline';
export type MeshPeerRole = 'primary' | 'standby';

export interface MeshTopologyPeer {
  readonly id: string;
  readonly label: string;
  readonly tier: 'VPS Node' | 'Desktop Edge' | 'AI Swarm Node';
  readonly meshIp: string;
  readonly region: string;
  readonly health: MeshPeerHealth;
  readonly rttMs: number;
  readonly role: MeshPeerRole;
}

export interface MeshEdgeRoute {
  readonly domain: string;
  readonly upstream: string;
  readonly tlsStatus: 'active' | 'provisioning' | 'offline';
}

export interface MeshTopologySnapshot {
  readonly bridgeOnline: boolean;
  readonly gatewayStatus: 'active' | 'degraded' | 'offline';
  readonly gatewayVersion: string;
  readonly routes: readonly MeshEdgeRoute[];
  readonly peers: readonly MeshTopologyPeer[];
  readonly merkleRoot: string;
  readonly merkleHeight: number;
  readonly a2aZeroTrustStatus: 'enforced' | 'verifying' | 'offline';
  readonly updatedAt: string;
}

export interface MeshTopologyPanelProps {
  readonly apiBase?: string;
  readonly fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface MeshStatusApiPayload {
  readonly mesh?: {
    nodeId?: string;
    meshIp?: string;
    cpuPercent?: number;
    memoryUsedMb?: number;
    memoryTotalMb?: number;
    runningApps?: number;
  };
  readonly containers?: readonly { name?: string; state?: string; status?: string }[];
  readonly routes?: readonly { domain?: string; upstream?: string }[];
  readonly previewListeners?: readonly { slug?: string; port?: number }[];
  readonly gatewayStatus?: 'active' | 'degraded' | 'offline';
  readonly gatewayVersion?: string;
  readonly peers?: readonly MeshTopologyPeer[];
  readonly merkleRoot?: string;
  readonly merkleHeight?: number;
  readonly a2aZeroTrustStatus?: 'enforced' | 'verifying' | 'offline';
  readonly updatedAt?: string;
}

const EMPTY_SNAPSHOT: MeshTopologySnapshot = {
  bridgeOnline: false,
  gatewayStatus: 'offline',
  gatewayVersion: '',
  routes: [],
  peers: [],
  merkleRoot: '',
  merkleHeight: 0,
  a2aZeroTrustStatus: 'offline',
  updatedAt: '',
};

function healthBadgeVariant(health: MeshPeerHealth): 'primary' | 'cyan' | 'destructive' {
  if (health === 'healthy') return 'primary';
  if (health === 'degraded') return 'cyan';
  return 'destructive';
}

function gatewayBadgeVariant(
  status: MeshTopologySnapshot['gatewayStatus']
): 'primary' | 'cyan' | 'destructive' {
  if (status === 'active') return 'primary';
  if (status === 'degraded') return 'cyan';
  return 'destructive';
}

export function MeshTopologyPanel({
  apiBase = '/api/desktop/paas',
  fetchFn,
}: MeshTopologyPanelProps) {
  const [snapshot, setSnapshot] = useState<MeshTopologySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const normalizedBase = apiBase.replace(/\/+$/u, '');

  const refreshTopology = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const doFetch = fetchFn ?? fetch;
      const response = await doFetch(`${normalizedBase}/mesh/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Mesh status failed (${response.status})`);

      const raw = (await response.json().catch(() => ({}))) as
        | MeshStatusApiPayload
        | { success?: boolean; data?: MeshStatusApiPayload };
      const payload =
        'data' in raw && raw.data && typeof raw.data === 'object'
          ? raw.data
          : (raw as MeshStatusApiPayload);

      const meshIp = payload.mesh?.meshIp ?? '';
      const peers: readonly MeshTopologyPeer[] =
        payload.peers && payload.peers.length > 0
          ? payload.peers
          : meshIp
            ? [
                {
                  id: payload.mesh?.nodeId ?? 'vps-node',
                  label: 'VPS Node',
                  tier: 'VPS Node',
                  meshIp,
                  region: '',
                  health: 'healthy',
                  rttMs: 0,
                  role: 'primary',
                },
              ]
            : [];

      setSnapshot({
        bridgeOnline: true,
        gatewayStatus: payload.gatewayStatus ?? 'active',
        gatewayVersion: payload.gatewayVersion ?? 'Caddy (verified)',
        routes: (payload.routes ?? []).map((route) => ({
          domain: route.domain ?? '',
          upstream: route.upstream ?? '',
          tlsStatus: route.domain?.startsWith('https') ? 'active' : 'provisioning',
        })),
        peers,
        merkleRoot: payload.merkleRoot ?? '',
        merkleHeight: payload.merkleHeight ?? 0,
        a2aZeroTrustStatus: payload.a2aZeroTrustStatus ?? 'verifying',
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mesh telemetry unreachable');
      setSnapshot(EMPTY_SNAPSHOT);
    } finally {
      setLoading(false);
    }
  }, [fetchFn, normalizedBase]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshTopology();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTopology]);

  if (loading) {
    return (
      <Panel title="Mesh Topology" description="Live EasyTier mesh telemetry.">
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Mesh Topology" description="Live EasyTier mesh telemetry.">
        <ErrorState
          title="Mesh telemetry offline"
          description={error}
          onRetry={() => void refreshTopology()}
          headingLevel={3}
        />
      </Panel>
    );
  }

  if (!snapshot) {
    return (
      <Panel title="Mesh Topology">
        <EmptyState title="No mesh data" description="Refresh to load live telemetry." />
      </Panel>
    );
  }

  const healthyPeersCount = snapshot.peers.filter((peer) => peer.health === 'healthy').length;
  const averageRttMs =
    snapshot.peers.length > 0
      ? Math.round(
          snapshot.peers.reduce((sum, peer) => sum + peer.rttMs, 0) / snapshot.peers.length
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-wide">MOONWITNESS MESH</span>
            <Badge variant={snapshot.bridgeOnline ? 'primary' : 'cyan'}>
              {snapshot.bridgeOnline ? 'Live Mesh Telemetry' : 'Offline'}
            </Badge>
          </div>
          <p className="text-xs opacity-75">
            Cloud L7 Decentralized Mesh Topology · Updated: {snapshot.updatedAt}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void refreshTopology()}
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          {loading ? 'Polling...' : 'Refresh Topology'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          label="L7 Edge Routes"
          value={String(snapshot.routes.length)}
          detail={snapshot.gatewayVersion}
          accent="cyan"
          icon={<GlobeIcon className="h-4 w-4" />}
        />
        <MetricTile
          label="Mesh Quorum"
          value={`${healthyPeersCount} / ${snapshot.peers.length}`}
          detail={`Avg RTT ${averageRttMs} ms`}
          accent="green"
          icon={<SignalIcon className="h-4 w-4" />}
        />
        <MetricTile
          label="Audit Log Height"
          value={`#${snapshot.merkleHeight}`}
          detail="RFC 6962 Merkle Tree"
          accent="violet"
          icon={<SecurityIcon className="h-4 w-4" />}
        />
      </div>

      <Panel
        title="Tier 1 · L7 Edge Layer"
        description="Caddy Auto-HTTPS reverse-proxy gateway and active domain routes."
        actions={
          <Badge variant={gatewayBadgeVariant(snapshot.gatewayStatus)}>
            <GlobeIcon className="mr-1 h-3 w-3" />
            Caddy {snapshot.gatewayStatus.toUpperCase()}
          </Badge>
        }
      >
        {snapshot.routes.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {snapshot.routes.map((route) => (
              <div
                key={route.domain}
                className="flex flex-col justify-between gap-2 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">{route.domain}</span>
                  <Badge variant={route.tlsStatus === 'active' ? 'primary' : 'cyan'}>
                    <LockIcon className="mr-1 h-3 w-3" />
                    TLS {route.tlsStatus}
                  </Badge>
                </div>
                <p className="font-mono text-[11px] opacity-75">{route.upstream}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No active routes" description="Configure a domain to create routes." />
        )}
      </Panel>

      <Panel
        title="Tier 2 · P2P Full-Mesh Ring"
        description="Encrypted EasyTier peer ring with HA failover."
        actions={<Badge variant="primary">10.144.0.0/24 Ring</Badge>}
      >
        {snapshot.peers.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {snapshot.peers.map((peer) => (
              <MeshNodeCard
                key={peer.id}
                title={peer.tier}
                metaLines={[`Mesh IP: ${peer.meshIp}`, `Region: ${peer.region || 'local'}`]}
                statusLabel={peer.health}
                statusVariant={healthBadgeVariant(peer.health)}
                className="rounded-md bg-transparent p-3"
                footerBadges={[
                  {
                    key: 'rtt',
                    label: `${peer.rttMs} ms RTT`,
                    variant: 'cyan',
                    icon: <ActivityIcon className="mr-1 h-3 w-3" />,
                  },
                  {
                    key: 'role',
                    label: `HA ${peer.role.toUpperCase()}`,
                    variant: peer.role === 'primary' ? 'primary' : 'default',
                  },
                ]}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No peers" description="No mesh peers are currently reachable." />
        )}
      </Panel>

      <L7TopologyCanvas
        nodes={[
          ...snapshot.routes.map(
            (route): L7TopologyNode => ({
              id: `route:${route.domain}`,
              label: route.domain,
              kind: 'ingress',
              protocol: 'HTTPS',
              health:
                route.tlsStatus === 'active'
                  ? 'healthy'
                  : route.tlsStatus === 'provisioning'
                    ? 'degraded'
                    : 'offline',
              endpoint: route.upstream,
            })
          ),
          ...snapshot.peers.map(
            (peer): L7TopologyNode => ({
              id: `peer:${peer.id}`,
              label: peer.label,
              kind: peer.tier === 'AI Swarm Node' ? 'service' : 'peer',
              protocol: peer.tier === 'AI Swarm Node' ? 'gRPC' : 'HTTP/2',
              health: peer.health,
              rttMs: peer.rttMs,
              region: peer.region,
              endpoint: peer.meshIp,
            })
          ),
        ]}
        edges={snapshot.routes.flatMap((route): L7TopologyEdge[] =>
          snapshot.peers.slice(0, 2).map((peer) => ({
            id: `edge:${route.domain}->${peer.id}`,
            sourceId: `route:${route.domain}`,
            targetId: `peer:${peer.id}`,
            protocol: peer.tier === 'AI Swarm Node' ? 'gRPC' : 'HTTPS',
            tlsEnabled: route.tlsStatus === 'active',
            health: peer.health,
            latencyMs: peer.rttMs,
          }))
        )}
      />

      <Panel
        title="Tier 3 · Constitutional & Audit Core"
        description="Immutable RFC 6962 Merkle transparency log and A2A Zero-Trust Mesh enforcement."
        actions={
          <Badge variant={snapshot.a2aZeroTrustStatus === 'enforced' ? 'primary' : 'cyan'}>
            {snapshot.a2aZeroTrustStatus === 'enforced' ? (
              <CheckIcon className="mr-1 h-3 w-3" />
            ) : (
              <WarningIcon className="mr-1 h-3 w-3" />
            )}
            A2A Zero-Trust: {snapshot.a2aZeroTrustStatus.toUpperCase()}
          </Badge>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold uppercase">RFC 6962 Merkle Root</span>
              <Badge variant="primary">Height #{snapshot.merkleHeight}</Badge>
            </div>
            <p className="break-all font-mono text-xs opacity-80">
              {snapshot.merkleRoot || 'No audit root reported'}
            </p>
          </div>

          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold uppercase">A2A Zero-Trust Mesh</span>
              <Badge variant="cyan">mTLS + Signed Attestation</Badge>
            </div>
            <p className="text-xs opacity-80">
              Inter-node swarm RPCs and L7 control-plane mutations are cryptographically signed.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
