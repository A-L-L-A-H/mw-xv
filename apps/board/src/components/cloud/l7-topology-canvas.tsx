'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Panel } from '@moonwitness/ui/components/panel';
import { GlobeIcon, LockIcon, RefreshIcon } from '@moonwitness/ui/icons';

export type L7Protocol = 'HTTPS' | 'gRPC' | 'WSS' | 'HTTP/2';
export type L7HealthStatus = 'healthy' | 'degraded' | 'offline';
export type L7NodeKind = 'ingress' | 'service' | 'peer';

export interface L7TopologyNode {
  readonly id: string;
  readonly label: string;
  readonly kind: L7NodeKind;
  readonly protocol: L7Protocol;
  readonly health: L7HealthStatus;
  readonly rttMs?: number;
  readonly rps?: number;
  readonly region?: string;
  readonly endpoint?: string;
}

export interface L7TopologyEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly protocol: L7Protocol;
  readonly tlsEnabled: boolean;
  readonly health: L7HealthStatus;
  readonly rps?: number;
  readonly latencyMs?: number;
}

export interface L7TopologyCanvasProps {
  readonly nodes: readonly L7TopologyNode[];
  readonly edges: readonly L7TopologyEdge[];
  readonly title?: string;
  readonly onSelectNode?: (node: L7TopologyNode | null) => void;
  readonly onSelectEdge?: (edge: L7TopologyEdge | null) => void;
}

export interface PositionedL7Node extends L7TopologyNode {
  readonly x: number;
  readonly y: number;
}

const KIND_X: Record<L7NodeKind, number> = {
  ingress: 120,
  service: 400,
  peer: 680,
};

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 1.8;
export const ZOOM_STEP = 0.2;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2))));
}

export function layoutL7Nodes(nodes: readonly L7TopologyNode[]): readonly PositionedL7Node[] {
  const buckets: Record<L7NodeKind, L7TopologyNode[]> = {
    ingress: [],
    service: [],
    peer: [],
  };

  for (const node of nodes) {
    buckets[node.kind].push(node);
  }

  const positioned: PositionedL7Node[] = [];
  const kinds: readonly L7NodeKind[] = ['ingress', 'service', 'peer'];

  for (const kind of kinds) {
    const group = buckets[kind];
    const spacing = 104;
    const startY = Math.max(70, 210 - ((group.length - 1) * spacing) / 2);
    group.forEach((node, idx) => {
      positioned.push({
        ...node,
        x: KIND_X[kind],
        y: startY + idx * spacing,
      });
    });
  }

  return positioned;
}

export function filterL7Topology(
  nodes: readonly L7TopologyNode[],
  edges: readonly L7TopologyEdge[],
  protocolFilter: L7Protocol | 'ALL',
  healthFilter: L7HealthStatus | 'ALL'
): { readonly nodes: readonly L7TopologyNode[]; readonly edges: readonly L7TopologyEdge[] } {
  const filteredNodes = nodes.filter((node) => {
    const matchesProtocol = protocolFilter === 'ALL' || node.protocol === protocolFilter;
    const matchesHealth = healthFilter === 'ALL' || node.health === healthFilter;
    return matchesProtocol && matchesHealth;
  });

  const visibleIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (edge) =>
      visibleIds.has(edge.sourceId) &&
      visibleIds.has(edge.targetId) &&
      (protocolFilter === 'ALL' || edge.protocol === protocolFilter)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

function healthStroke(health: L7HealthStatus): string {
  if (health === 'healthy') return '#10b981';
  if (health === 'degraded') return '#06b6d4';
  return '#ef4444';
}

function healthBadgeVariant(health: L7HealthStatus): 'primary' | 'cyan' | 'destructive' {
  if (health === 'healthy') return 'primary';
  if (health === 'degraded') return 'cyan';
  return 'destructive';
}

export function L7TopologyCanvas({
  nodes,
  edges,
  title = 'Interactive L7 Topology Canvas',
  onSelectNode,
  onSelectEdge,
}: L7TopologyCanvasProps) {
  const [protocolFilter, setProtocolFilter] = useState<L7Protocol | 'ALL'>('ALL');
  const [healthFilter, setHealthFilter] = useState<L7HealthStatus | 'ALL'>('ALL');
  const [zoom, setZoom] = useState<number>(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterL7Topology(nodes, edges, protocolFilter, healthFilter),
    [nodes, edges, protocolFilter, healthFilter]
  );

  const positionedNodes = useMemo(() => layoutL7Nodes(filtered.nodes), [filtered.nodes]);
  const nodeById = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes]
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId
    ? filtered.edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  const handleSelectNode = (node: PositionedL7Node) => {
    setSelectedEdgeId(null);
    const nextId = selectedNodeId === node.id ? null : node.id;
    setSelectedNodeId(nextId);
    onSelectNode?.(nextId ? node : null);
    onSelectEdge?.(null);
  };

  const handleSelectEdge = (edge: L7TopologyEdge) => {
    setSelectedNodeId(null);
    const nextId = selectedEdgeId === edge.id ? null : edge.id;
    setSelectedEdgeId(nextId);
    onSelectEdge?.(nextId ? edge : null);
    onSelectNode?.(null);
  };

  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GlobeIcon className="size-4 text-ink-muted" />
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">{title}</h3>
          <Badge variant="default">
            {positionedNodes.length} nodes · {filtered.edges.length} L7 links
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-ink/15 p-0.5">
            {(['ALL', 'HTTPS', 'gRPC', 'WSS', 'HTTP/2'] as const).map((proto) => (
              <Button
                key={proto}
                type="button"
                size="sm"
                variant={protocolFilter === proto ? 'default' : 'ghost'}
                onClick={() => setProtocolFilter(proto)}
              >
                {proto}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-ink/15 p-0.5">
            {(['ALL', 'healthy', 'degraded', 'offline'] as const).map((health) => (
              <Button
                key={health}
                type="button"
                size="sm"
                variant={healthFilter === health ? 'default' : 'ghost'}
                onClick={() => setHealthFilter(health)}
              >
                {health}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            >
              -
            </Button>
            <span className="min-w-12 text-center font-mono text-xs text-ink-muted">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            >
              +
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Reset zoom"
              onClick={() => {
                setZoom(1);
                setProtocolFilter('ALL');
                setHealthFilter('ALL');
              }}
            >
              <RefreshIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {positionedNodes.length === 0 ? (
        <EmptyState
          title="No L7 topology nodes match"
          description="Adjust the protocol or health filter to inspect active L7 routes and peers."
        />
      ) : (
        <div
          role="region"
          aria-label="L7 Topology Graph"
          className="overflow-auto rounded-lg border border-ink/15 bg-surface/60 p-4"
        >
          <div
            className="grid min-w-[680px] grid-cols-3 gap-6 transition-transform"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {(['ingress', 'service', 'peer'] as const).map((kind) => {
              const columnNodes = positionedNodes.filter((n) => n.kind === kind);
              return (
                <div key={kind} className="space-y-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                    {kind} ({columnNodes.length})
                  </p>
                  <div className="space-y-2">
                    {columnNodes.map((node) => {
                      const isSelected = selectedNodeId === node.id;
                      return (
                        <Button
                          key={node.id}
                          type="button"
                          variant={isSelected ? 'secondary' : 'outline'}
                          onClick={() => handleSelectNode(node)}
                          className="h-auto w-full flex-col items-stretch p-3 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs font-semibold text-ink">
                              {node.label}
                            </span>
                            <Badge variant={healthBadgeVariant(node.health)}>{node.health}</Badge>
                          </div>
                          <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-ink-muted">
                            <span>{node.protocol}</span>
                            {typeof node.rttMs === 'number' && <span>{node.rttMs} ms</span>}
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.edges.length > 0 && (
            <div className="mt-4 border-t border-ink/10 pt-3">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                Active L7 Links ({filtered.edges.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {filtered.edges.map((edge) => {
                  const isSelected = selectedEdgeId === edge.id;
                  return (
                    <Button
                      key={edge.id}
                      type="button"
                      size="sm"
                      variant={isSelected ? 'secondary' : 'outline'}
                      onClick={() => handleSelectEdge(edge)}
                      className="gap-2 font-mono text-[11px]"
                    >
                      <Badge variant={healthBadgeVariant(edge.health)}>{edge.protocol}</Badge>
                      <span>
                        {edge.sourceId} → {edge.targetId}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {(selectedNode || selectedEdge) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/15 bg-surface px-4 py-3">
          {selectedNode && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={healthBadgeVariant(selectedNode.health)}>{selectedNode.health}</Badge>
              <span className="font-mono text-xs font-semibold text-ink">{selectedNode.label}</span>
              <span className="font-mono text-xs text-ink-muted">{selectedNode.protocol}</span>
              {selectedNode.endpoint && (
                <span className="font-mono text-xs text-ink-muted">{selectedNode.endpoint}</span>
              )}
              {typeof selectedNode.rttMs === 'number' && (
                <span className="font-mono text-xs text-ink-muted">{selectedNode.rttMs} ms</span>
              )}
            </div>
          )}
          {selectedEdge && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={healthBadgeVariant(selectedEdge.health)}>{selectedEdge.health}</Badge>
              <span className="font-mono text-xs font-semibold text-ink">
                {selectedEdge.sourceId} → {selectedEdge.targetId}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-xs text-ink-muted">
                <LockIcon className="size-3" />
                {selectedEdge.tlsEnabled ? 'mTLS/TLS' : 'Plaintext'}
              </span>
              {typeof selectedEdge.rps === 'number' && (
                <span className="font-mono text-xs text-ink-muted">{selectedEdge.rps} req/s</span>
              )}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              onSelectNode?.(null);
              onSelectEdge?.(null);
            }}
          >
            Clear selection
          </Button>
        </div>
      )}
    </Panel>
  );
}
