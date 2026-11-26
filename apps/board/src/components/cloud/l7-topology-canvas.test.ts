import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  filterL7Topology,
  layoutL7Nodes,
  MAX_ZOOM,
  MIN_ZOOM,
  type L7TopologyEdge,
  type L7TopologyNode,
} from './l7-topology-helpers';

const SAMPLE_NODES: readonly L7TopologyNode[] = [
  {
    id: 'ingress-1',
    label: 'api.moonwitness.io',
    kind: 'ingress',
    protocol: 'HTTPS',
    health: 'healthy',
    endpoint: 'https://api.moonwitness.io',
  },
  {
    id: 'svc-1',
    label: 'control-plane',
    kind: 'service',
    protocol: 'gRPC',
    health: 'degraded',
    rttMs: 42,
  },
  {
    id: 'peer-1',
    label: 'vps-sg-01',
    kind: 'peer',
    protocol: 'HTTP/2',
    health: 'healthy',
    rttMs: 14,
  },
];

const SAMPLE_EDGES: readonly L7TopologyEdge[] = [
  {
    id: 'e1',
    sourceId: 'ingress-1',
    targetId: 'svc-1',
    protocol: 'gRPC',
    tlsEnabled: true,
    health: 'degraded',
    rps: 120,
  },
  {
    id: 'e2',
    sourceId: 'svc-1',
    targetId: 'peer-1',
    protocol: 'HTTPS',
    tlsEnabled: true,
    health: 'healthy',
    rps: 80,
  },
];

describe('L7TopologyCanvas helpers', () => {
  it('clamps zoom within MIN_ZOOM and MAX_ZOOM', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(1.2)).toBe(1.2);
  });

  it('positions nodes by kind column', () => {
    const positioned = layoutL7Nodes(SAMPLE_NODES);
    expect(positioned).toHaveLength(3);
    const ingress = positioned.find((n) => n.kind === 'ingress');
    const service = positioned.find((n) => n.kind === 'service');
    const peer = positioned.find((n) => n.kind === 'peer');
    expect(ingress && service && peer).toBeTruthy();
    expect(ingress!.x).toBeLessThan(service!.x);
    expect(service!.x).toBeLessThan(peer!.x);
  });

  it('filters nodes and edges by protocol and health', () => {
    const byHealth = filterL7Topology(SAMPLE_NODES, SAMPLE_EDGES, 'ALL', 'healthy');
    expect(byHealth.nodes.map((n) => n.id)).toEqual(['ingress-1', 'peer-1']);
    expect(byHealth.edges).toHaveLength(0);

    const byProto = filterL7Topology(SAMPLE_NODES, SAMPLE_EDGES, 'gRPC', 'ALL');
    expect(byProto.nodes.map((n) => n.id)).toEqual(['svc-1']);
    expect(byProto.edges).toHaveLength(0);
  });
});
