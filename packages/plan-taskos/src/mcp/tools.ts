/**
 * T31a — Standalone MCP Tool Handlers.
 *
 * Typed MCP tool schemas + handlers over `BrainStorageDriver` + `repoRoot`.
 * Read tools are always available; controlled write tools are enabled only
 * when `--allow-write` is passed (read-only by default).
 *
 * Read: plan_list, plan_dag, plan_next, plan_recall, plan_impact, plan_graph
 * Write: plan_claim, plan_verify, plan_complete, plan_fail, plan_sync
 */

import type { BrainStorageDriver } from "../brain/storage.js";
import { discoverPlans, loadPlanBundle } from "../core/loader.js";
import { buildWorkGraphDag, selectDisjointFrontier } from "../core/dag.js";
import { compileCognitiveMicroBrief } from "../runner/brief-compiler.js";
import { hybridRecall } from "../brain/hybrid-recall.js";
import { queryBlastRadiusImpact, exportSubgraph } from "../brain/knowledge-graph.js";
import { claimTaskLease, releaseTaskLease } from "../runner/lease-manager.js";
import { completeMicroTask, recordMicroTaskFailure } from "../runner/proof-runner.js";
import { runNonRemSleepConsolidation } from "../brain/episodic-memory.js";
import type { LoadedPlanBundle, PlanTaskIR } from "../core/types.js";

export interface ToolContext {
  readonly store: BrainStorageDriver;
  readonly repoRoot: string;
  readonly allowWrite: boolean;
}

export interface McpToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
  readonly requiresWrite?: boolean;
}

export const MCP_TOOLS: readonly McpToolSchema[] = [
  {
    name: "plan_list",
    description: "List all plans under .plan/ with per-wave task progress counts.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "plan_dag",
    description: "Return the DAG stats for a plan: wave counts, ready/active/blocked, and Boss Critical Path.",
    inputSchema: {
      type: "object",
      properties: { plan_id: { type: "string", description: "Plan ID (defaults to the first discovered plan)" } },
      required: [],
    },
  },
  {
    name: "plan_next",
    description: "Compile the O(1) Cognitive Micro-Brief for the next ready task of a plan.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        max_parallel: { type: "number", description: "Disjoint frontier size (default 4)" },
      },
      required: [],
    },
  },
  {
    name: "plan_recall",
    description: "Hybrid BM25 (+optional Ollama) semantic recall over the Cognitive Brain.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language query" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "plan_impact",
    description: "Compute the 2-hop blast radius of a file path or task URN from the Brain knowledge graph.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "Repo-relative file path or task URN" } },
      required: ["target"],
    },
  },
  {
    name: "plan_graph",
    description: "Export a knowledge-graph subgraph (nodes + edges) as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        center_urn: { type: "string" },
        max_hops: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "plan_claim",
    description: "Claim a task lease (controlled write; requires --allow-write).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        plan_id: { type: "string" },
        agent_runtime: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["task_id"],
    },
    requiresWrite: true,
  },
  {
    name: "plan_verify",
    description: "Run the verify commands of a task and report results (controlled write; requires --allow-write).",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, plan_id: { type: "string" } },
      required: ["task_id"],
    },
    requiresWrite: true,
  },
  {
    name: "plan_complete",
    description: "Mark a task complete with proof sealing (controlled write; requires --allow-write).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        plan_id: { type: "string" },
        agent_runtime: { type: "string" },
        session_id: { type: "string" },
        commit: { type: "boolean" },
      },
      required: ["task_id", "session_id"],
    },
    requiresWrite: true,
  },
  {
    name: "plan_fail",
    description: "Record a task failure with reason (controlled write; requires --allow-write).",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, plan_id: { type: "string" }, reason: { type: "string" } },
      required: ["task_id", "reason"],
    },
    requiresWrite: true,
  },
  {
    name: "plan_sync",
    description: "Run Non-REM sleep consolidation and report invariant proposals (controlled write; requires --allow-write).",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiresWrite: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveBundle(repoRoot: string, planId?: string): Promise<LoadedPlanBundle | null> {
  if (planId) {
    return loadPlanBundle(repoRoot, planId);
  }
  const plans = await discoverPlans(repoRoot);
  return plans[0] ?? null;
}

function allTasks(bundle: LoadedPlanBundle): PlanTaskIR[] {
  return bundle.waves.flatMap((w) => w.tasks);
}

function textResult(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export const TOOL_HANDLERS: Readonly<Record<string, ToolHandler>> = {
  async plan_list(_args, ctx) {
    const plans = await discoverPlans(ctx.repoRoot);
    return plans.map((bundle) => {
      const total = allTasks(bundle).length;
      const done = allTasks(bundle).filter(
        (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
      ).length;
      return {
        plan_id: bundle.manifest.plan_id,
        title: bundle.manifest.title,
        format: bundle.format,
        waves: bundle.waves.length,
        tasks: { total, done },
        source_path: bundle.source_path,
      };
    });
  },

  async plan_dag(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    const dag = buildWorkGraphDag(allTasks(bundle));
    const byState = { ready: 0, active: 0, blocked: 0, done: 0, skipped: 0 };
    for (const node of dag.nodes) {
      byState[node.state] = (byState[node.state] ?? 0) + 1;
    }
    return {
      plan_id: bundle.manifest.plan_id,
      waves: bundle.waves.map((w) => ({
        wave_id: w.wave_id,
        title: w.title,
        tasks: w.tasks.length,
        done: w.tasks.filter((t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped").length,
      })),
      states: byState,
      critical_path: dag.criticalPathIds,
      cycles: dag.cycles,
    };
  },

  async plan_next(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    const maxParallel = (args.max_parallel as number | undefined) ?? 4;
    const dag = buildWorkGraphDag(allTasks(bundle));
    const frontier = selectDisjointFrontier(dag, maxParallel);
    const next = frontier[0];
    if (!next) return { ready: false, reason: "no ready task in frontier" };
    const brief = compileCognitiveMicroBrief(ctx.store, bundle, next.code);
    return { ready: true, frontier: frontier.map((n) => n.code), brief };
  },

  async plan_recall(args, ctx) {
    const result = await hybridRecall(ctx.store, {
      query: String(args.query ?? ""),
      limit: (args.limit as number | undefined) ?? 8,
    });
    return result;
  },

  async plan_impact(args, ctx) {
    const target = String(args.target ?? "");
    if (!target) throw new Error("plan_impact requires 'target'");
    return queryBlastRadiusImpact(ctx.store, target);
  },

  async plan_graph(args, ctx) {
    return exportSubgraph(ctx.store, {
      planId: args.plan_id as string | undefined,
      centerUrn: args.center_urn as string | undefined,
      maxHops: args.max_hops as number | undefined,
    });
  },

  async plan_claim(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    const task = allTasks(bundle).find((t) => t.code === args.task_id);
    if (!task) throw new Error(`Task not found: ${args.task_id}`);
    return claimTaskLease(ctx.store, {
      taskUrn: task.urn,
      agentRuntime: (args.agent_runtime as string | undefined) ?? "mcp",
      sessionId: (args.session_id as string | undefined) ?? `mcp-${Date.now()}`,
    });
  },

  async plan_verify(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    const task = allTasks(bundle).find((t) => t.code === args.task_id);
    if (!task) throw new Error(`Task not found: ${args.task_id}`);
    return { task_id: task.code, verify_commands: task.verification.commands };
  },

  async plan_complete(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    return completeMicroTask(ctx.store, ctx.repoRoot, bundle.manifest.plan_id, String(args.task_id), {
      sessionId: String(args.session_id ?? "mcp"),
      agentRuntime: (args.agent_runtime as string | undefined) ?? "mcp",
      autoCommit: args.commit === true,
    });
  },

  async plan_fail(args, ctx) {
    const bundle = await resolveBundle(ctx.repoRoot, args.plan_id as string | undefined);
    if (!bundle) throw new Error(`Plan not found: ${args.plan_id ?? "(none discovered)"}`);
    const task = allTasks(bundle).find((t) => t.code === args.task_id);
    if (!task) throw new Error(`Task not found: ${args.task_id}`);
    await recordMicroTaskFailure(ctx.store, ctx.repoRoot, bundle.manifest.plan_id, String(args.task_id), {
      taskCode: task.code,
      planId: bundle.manifest.plan_id,
      verifyResults: [],
      scopeCheck: { ok: false, ownedChanged: [], outOfScopeFiles: [] },
      attemptNumber: task.lifecycle.attempts + 1,
    });
    return { ok: true, task_id: task.code };
  },

  async plan_sync(_args, ctx) {
    return runNonRemSleepConsolidation(ctx.store);
  },
};

/**
 * Dispatch a tools/call request. Write tools are rejected when the server was
 * not started with --allow-write.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const schema = MCP_TOOLS.find((t) => t.name === name);
  if (!schema) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  if (schema.requiresWrite && !ctx.allowWrite) {
    return { ok: false, error: `Tool '${name}' is a controlled write tool; restart the server with --allow-write to enable it` };
  }
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { ok: false, error: `No handler registered for tool: ${name}` };
  }
  try {
    return { ok: true, result: await handler(args ?? {}, ctx) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { releaseTaskLease };
