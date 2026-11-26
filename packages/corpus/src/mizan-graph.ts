export interface MizanNode {
  readonly id: string;
  readonly epistemicWeight: number;
  readonly ethicalWeight: number;
}

export interface MizanEdge {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
}

export interface MizanGraph {
  readonly nodes: ReadonlyMap<string, MizanNode>;
  readonly edges: readonly MizanEdge[];
}

export interface MizanTraversalResult {
  readonly visitedOrder: readonly string[];
  readonly cyclesDetected: number;
}

export interface MizanScoreSummary {
  readonly rootNodeId: string;
  readonly reachableCount: number;
  readonly epistemicScore: number;
  readonly ethicalScore: number;
  readonly balanceIndex: number;
  readonly cyclesDetected: number;
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function traverseMizanGraph(graph: MizanGraph, startNodeId: string): MizanTraversalResult {
  if (!graph.nodes.has(startNodeId)) {
    return { visitedOrder: [], cyclesDetected: 0 };
  }

  const adjacency = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) {
    adjacency.set(id, []);
  }
  for (const edge of graph.edges) {
    if (adjacency.has(edge.from) && graph.nodes.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
    }
  }

  const visited = new Set<string>();
  const activeStack = new Set<string>();
  const visitedOrder: string[] = [];
  let cyclesDetected = 0;

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    activeStack.add(nodeId);
    visitedOrder.push(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const nextId of neighbors) {
      if (activeStack.has(nextId)) {
        cyclesDetected += 1;
        continue;
      }
      if (!visited.has(nextId)) {
        dfs(nextId);
      }
    }

    activeStack.delete(nodeId);
  }

  dfs(startNodeId);

  return {
    visitedOrder,
    cyclesDetected,
  };
}

export function aggregateMizanScores(graph: MizanGraph, rootNodeId: string): MizanScoreSummary {
  const traversal = traverseMizanGraph(graph, rootNodeId);
  if (traversal.visitedOrder.length === 0) {
    return {
      rootNodeId,
      reachableCount: 0,
      epistemicScore: 0,
      ethicalScore: 0,
      balanceIndex: 0,
      cyclesDetected: 0,
    };
  }

  const incomingWeight = new Map<string, number>();
  for (const id of traversal.visitedOrder) {
    incomingWeight.set(id, id === rootNodeId ? 1 : 0);
  }

  const reachableSet = new Set(traversal.visitedOrder);
  for (const edge of graph.edges) {
    if (reachableSet.has(edge.from) && reachableSet.has(edge.to)) {
      const current = incomingWeight.get(edge.to) ?? 0;
      incomingWeight.set(edge.to, current + Math.max(0, edge.weight));
    }
  }

  let totalWeight = 0;
  let weightedEpistemic = 0;
  let weightedEthical = 0;

  for (const id of traversal.visitedOrder) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const w = Math.max(0.01, incomingWeight.get(id) ?? 1);
    totalWeight += w;
    weightedEpistemic += clampUnit(node.epistemicWeight) * w;
    weightedEthical += clampUnit(node.ethicalWeight) * w;
  }

  const epistemicScore = totalWeight > 0 ? weightedEpistemic / totalWeight : 0;
  const ethicalScore = totalWeight > 0 ? weightedEthical / totalWeight : 0;
  const balanceIndex = 1 - Math.abs(epistemicScore - ethicalScore);

  return {
    rootNodeId,
    reachableCount: traversal.visitedOrder.length,
    epistemicScore,
    ethicalScore,
    balanceIndex,
    cyclesDetected: traversal.cyclesDetected,
  };
}
