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
