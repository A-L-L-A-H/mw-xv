export interface CausalNode {
  readonly id: string;
  readonly label: string;
  readonly baselineValue: number;
}

export interface CausalEdge {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
}

export interface CausalGraph {
  readonly nodes: ReadonlyMap<string, CausalNode>;
  readonly edges: readonly CausalEdge[];
}

export type InterventionMap = ReadonlyMap<string, number>;

export interface ScenarioState {
  readonly id: string;
  readonly step: number;
  readonly parentScenarioId: string | null;
  readonly interventions: ReadonlyMap<string, number>;
  readonly values: ReadonlyMap<string, number>;
}

export interface ScenarioDiffEntry {
  readonly nodeId: string;
  readonly baseline: number;
  readonly counterfactual: number;
  readonly delta: number;
}

function topologicalOrder(graph: CausalGraph): readonly string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of graph.nodes.keys()) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) {
      throw new Error(`Causal edge references unknown node: ${edge.from} -> ${edge.to}`);
    }
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }
  queue.sort();

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      const nextDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  if (order.length !== graph.nodes.size) {
    throw new Error('CausalGraph contains a cycle; DAG required for do-calculus propagation');
  }

  return order;
}

export function propagateDoCalculus(
  graph: CausalGraph,
  interventions: InterventionMap = new Map(),
): ReadonlyMap<string, number> {
  const order = topologicalOrder(graph);
  const incoming = new Map<string, CausalEdge[]>();

  for (const id of graph.nodes.keys()) {
    incoming.set(id, []);
  }
  for (const edge of graph.edges) {
    incoming.get(edge.to)!.push(edge);
  }

  const values = new Map<string, number>();

  for (const nodeId of order) {
    if (interventions.has(nodeId)) {
      // do(X = x) severs incoming causal edges to X
      values.set(nodeId, interventions.get(nodeId)!);
      continue;
    }

    const node = graph.nodes.get(nodeId)!;
    const parents = incoming.get(nodeId) ?? [];
    let structuralSum = node.baselineValue;

    for (const edge of parents) {
      const parentValue = values.get(edge.from) ?? 0;
      const parentBaseline = graph.nodes.get(edge.from)?.baselineValue ?? 0;
      structuralSum += edge.weight * (parentValue - parentBaseline);
    }

    values.set(nodeId, structuralSum);
  }

  return values;
}

export function createBaselineScenario(graph: CausalGraph, scenarioId = 'baseline'): ScenarioState {
  const emptyInterventions = new Map<string, number>();
  return {
    id: scenarioId,
    step: 0,
    parentScenarioId: null,
    interventions: emptyInterventions,
    values: propagateDoCalculus(graph, emptyInterventions),
  };
}

export function branchScenario(
  graph: CausalGraph,
  parent: ScenarioState,
  branchId: string,
  additionalInterventions: InterventionMap,
): ScenarioState {
  const merged = new Map<string, number>(parent.interventions);
  for (const [nodeId, value] of additionalInterventions.entries()) {
    merged.set(nodeId, value);
  }

  return {
    id: branchId,
    step: parent.step + 1,
    parentScenarioId: parent.id,
    interventions: merged,
    values: propagateDoCalculus(graph, merged),
  };
}

export function compareScenarios(
  baseline: ScenarioState,
  counterfactual: ScenarioState,
): readonly ScenarioDiffEntry[] {
  const diffs: ScenarioDiffEntry[] = [];
  const nodeIds = Array.from(baseline.values.keys()).sort();

  for (const nodeId of nodeIds) {
    const baseVal = baseline.values.get(nodeId) ?? 0;
    const cfVal = counterfactual.values.get(nodeId) ?? 0;
    diffs.push({
      nodeId,
      baseline: baseVal,
      counterfactual: cfVal,
      delta: cfVal - baseVal,
    });
  }

  return diffs;
}
