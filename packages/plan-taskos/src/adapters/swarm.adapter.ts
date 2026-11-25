/**
 * T28b — `/swarm` Model-Tier Wave Manifest Exporter.
 *
 * Generates ready-to-dispatch disjoint `/swarm` worker briefs using
 * `selectDisjointFrontier` + `compileCognitiveMicroBrief` + hybrid model
 * routing (INV-008).
 */

import type { BrainStorageDriver } from "../brain/storage.js";
import type { LoadedPlanBundle, ModelTier, PlanTaskIR } from "../core/types.js";
import { compileCognitiveMicroBrief, type CognitiveMicroBrief } from "../runner/brief-compiler.js";
import { buildWorkGraphDag, selectDisjointFrontier } from "../core/dag.js";

/** INV-008 hybrid model routing. */
export const MODEL_TIER_ROUTING: Readonly<Record<Exclude<ModelTier, "human">, string>> = {
  flash: "gemini-3.8-flash-low",
  neon: "gemini-4-neon-low",
  argon: "gemini-4-argon-low",
};

export interface SwarmWorkerBrief {
  readonly taskCode: string;
  readonly taskUrn: string;
  readonly modelTier: ModelTier;
  readonly routedModel: string;
  readonly brief: CognitiveMicroBrief;
}

export interface SwarmWaveManifest {
  readonly planId: string;
  readonly waveId: string;
  readonly maxParallel: number;
  readonly workers: readonly SwarmWorkerBrief[];
}

/**
 * Export a disjoint `/swarm` wave manifest with model-tier routed briefs.
 */
export function exportSwarmWaveManifest(
  store: BrainStorageDriver,
  bundle: LoadedPlanBundle,
  options: { waveId?: string; maxParallel?: number } = {}
): SwarmWaveManifest {
  const maxParallel = options.maxParallel ?? 4;
  const planId = bundle.manifest.plan_id;

  const wave = options.waveId
    ? bundle.waves.find((w) => w.wave_id === options.waveId)
    : bundle.waves.find((w) => w.tasks.some((t) => isReady(t, bundle)));

  if (!wave) {
    return { planId, waveId: options.waveId ?? "", maxParallel, workers: [] };
  }

  // Build the wave-scoped DAG and select a disjoint frontier (bounded by
  // maxParallel). Cross-wave dependencies already satisfied (`done`/`skipped`)
  // are intentionally out of scope here: `unmetDependencies` ignores deps
  // absent from the wave-local task map.
  const readyTasks = wave.tasks.filter((t) => isReady(t, bundle));
  const dag = buildWorkGraphDag(wave.tasks);
  const frontierNodes = selectDisjointFrontier(dag, maxParallel)
    .filter((node) => readyTasks.some((r) => r.code === node.code));

  const taskByCode = new Map(wave.tasks.map((t) => [t.code, t] as const));

  const workers: SwarmWorkerBrief[] = frontierNodes.map((node) => {
    const task = taskByCode.get(node.code);
    if (!task) throw new Error(`Task ${node.code} not found in wave`);
    const modelTier = task.lifecycle.model_tier ?? bundle.manifest.execution_policy.default_model_tier;
    const brief = compileCognitiveMicroBrief(store, bundle, task.code);
    return {
      taskCode: task.code,
      taskUrn: task.urn,
      modelTier,
      routedModel: modelTier === "human" ? "human" : MODEL_TIER_ROUTING[modelTier],
      brief,
    };
  });

  return { planId, waveId: wave.wave_id, maxParallel, workers };
}

function isReady(task: PlanTaskIR, bundle: LoadedPlanBundle): boolean {
  if (task.lifecycle.status !== "todo" && task.lifecycle.status !== "backlog") {
    return false;
  }
  const allTasks = bundle.waves.flatMap((w) => w.tasks);
  return task.graph.depends_on.every((dep) => {
    const depTask = allTasks.find((t) => t.code === dep);
    return depTask?.lifecycle.status === "done" || depTask?.lifecycle.status === "skipped";
  });
}
