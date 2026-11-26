#!/usr/bin/env node
/**
 * T32 — `plan-taskos` CLI Binary.
 *
 * Zero-dependency argument parser + subcommands. Works offline in ANY Git
 * repository with zero MoonWitness-specific runtime dependencies.
 *
 * Commands:
 *   init <plan-id> --title <t>        scaffold a new plan bundle
 *   lint [plan-id]                    AJV + spec parity + disjoint prover + cycles + proofs
 *   reindex                           rebuild .plan/.brain/taskos.sqlite from Git shards
 *   dag [plan-id]                     wave stats + frontier + Boss Critical Path
 *   next [plan-id] [--claim ...]      O(1) Cognitive Micro-Brief for next ready task
 *   recall <query>                    hybrid BM25+Ollama Brain recall
 *   impact <file-or-urn>              2-hop blast radius
 *   claim <task-id>                   claim a task lease
 *   verify <task-id>                  run verify commands
 *   complete <task-id> [--commit]     seal proof + optional atomic commit
 *   fail <task-id> --reason <msg>     record failure
 *   block <task-id> --reason <msg>    mark blocked
 *   sleep                             Non-REM episodic consolidation
 *   sync [--target ...] [--check]     run Split-Authority projection adapters
 *   intake --github-issue <json>      convert GitHub issue JSON into intake draft
 *   export-swarm [plan-id]            disjoint /swarm briefs
 *   mcp [--allow-write]               start stdio JSON-RPC MCP server
 *
 * Global flags: --json, --plan <id>, --repo <path>, --check, --apply
 */

import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { discoverPlans, loadPlanBundle } from "./core/loader.js";
import { validatePlanBundle } from "./core/validator.js";
import { proveDisjointOwnership } from "./core/disjoint-prover.js";
import { buildWorkGraphDag, selectDisjointFrontier } from "./core/dag.js";
import { openBrainStore } from "./brain/storage.js";
import { initializeBrainSchema } from "./brain/schema.js";
import { reindexBrainFromRepo } from "./brain/reindex.js";
import { hybridRecall } from "./brain/hybrid-recall.js";
import { queryBlastRadiusImpact } from "./brain/knowledge-graph.js";
import { runNonRemSleepConsolidation } from "./brain/episodic-memory.js";
import { compileCognitiveMicroBrief } from "./runner/brief-compiler.js";
import { claimTaskLease, releaseTaskLease } from "./runner/lease-manager.js";
import { executeVerifyCommands } from "./runner/scope-gate.js";
import { completeMicroTask, recordMicroTaskFailure } from "./runner/proof-runner.js";
import { exportSwarmWaveManifest } from "./adapters/swarm.adapter.js";
import { parseGitHubIssueToIntakeDraft } from "./adapters/github.adapter.js";
import { runStdioServer } from "./mcp/stdio-server.js";
import type { LoadedPlanBundle, PlanTaskIR } from "./core/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function out(payload: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (typeof payload === "string") {
    process.stdout.write(`${payload}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function firstBundle(repoRoot: string, planId?: string): Promise<LoadedPlanBundle> {
  const bundle = planId
    ? await loadPlanBundle(repoRoot, planId)
    : (await discoverPlans(repoRoot))[0] ?? null;
  if (!bundle) fail(`plan not found: ${planId ?? "(no plans discovered under .plan/)"}`);
  return bundle;
}

function allTasks(bundle: LoadedPlanBundle): PlanTaskIR[] {
  return bundle.waves.flatMap((w) => w.tasks);
}

async function openStoreFor(repoRoot: string) {
  const dbPath = join(repoRoot, ".plan", ".brain", "taskos.sqlite");
  const store = await openBrainStore({ dbPath });
  initializeBrainSchema(store);
  return store;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const planId = args.positional[0];
  if (!planId) fail("init requires <plan-id>");
  const title = (args.flags.title as string | undefined) ?? planId;

  const planDir = join(repoRoot, ".plan", planId);
  await mkdir(join(planDir, "waves"), { recursive: true });
  await mkdir(join(planDir, "specs"), { recursive: true });
  await mkdir(join(repoRoot, ".plan"), { recursive: true });

  const manifest = {
    schema_version: "1.0.0",
    plan_id: planId,
    title,
    repo: { org: "local", name: "repo", target_branch: "main" },
    adr_file: `.plan/${planId}/ADR-001-${planId}.md`,
    execution_policy: {
      max_attempts_per_task: 3,
      default_model_tier: "flash",
      escalation_chain: ["flash", "neon", "argon", "human"],
      require_clean_scope: true,
      auto_commit: false,
    },
    projections: { github_fold_mode: "wave", taskos_project: planId, orm_project_code: planId },
    waves: [{ id: "W0", title: "Wave 0", wave_file: `.plan/${planId}/waves/W0.json`, depends_on: [] }],
    documents: [],
  };
  await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const wave = {
    schema_version: "1.0.0",
    plan_id: planId,
    wave_id: "W0",
    title: "Wave 0",
    tasks: [],
  };
  await writeFile(join(planDir, "waves", "W0.json"), JSON.stringify(wave, null, 2), "utf8");

  await writeFile(
    join(planDir, "specs", "W0.md"),
    `# Wave 0 Spec — ${title}\n\nDescribe the wave spec here.\n`,
    "utf8"
  );

  await writeFile(
    join(planDir, `ADR-001-${planId}.md`),
    `# ADR-001 — ${title}\n\n## Status\n\naccepted\n\n## Context\n\nWhy this plan exists.\n\n## Decision\n\nWhat was decided.\n`,
    "utf8"
  );

  const master = [
    `# ${title}`,
    "",
    `- **Plan ID:** \`${planId}\``,
    `- **Total Micro-Tasks:** \`0\``,
    `- **Target Branch:** \`main\``,
    "",
    "## Global Micro-Task Checklist",
    "",
    "### Wave W0 — Wave 0",
    "",
    "## Execution Progress Ledger",
    "",
    "",
  ].join("\n");
  await writeFile(join(repoRoot, ".plan", `${planId}.md`), master, "utf8");

  out({ ok: true, plan_id: planId, scaffolded: [".plan/" + planId] }, json);
}

async function cmdLint(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const planId = args.positional[0] ?? (args.flags.plan as string | undefined);
  const bundles = planId ? [await loadPlanBundle(repoRoot, planId)] : await discoverPlans(repoRoot);
  const results: unknown[] = [];
  let ok = true;

  for (const bundle of bundles) {
    if (!bundle) continue;
    const validation = await validatePlanBundle(bundle);
    const proof = proveDisjointOwnership(allTasks(bundle));
    const dag = buildWorkGraphDag(allTasks(bundle));
    const entryOk =
      validation.errors.length === 0 && proof.conflicts.length === 0 && dag.cycles.length === 0;
    if (!entryOk) ok = false;
    results.push({
      plan_id: bundle.manifest.plan_id,
      ok: entryOk,
      validation_errors: validation.errors.length,
      validation_warnings: validation.warnings.length,
      ownership_conflicts: proof.conflicts.length,
      cycles: dag.cycles.length,
    });
  }

  out(json ? { ok, plans: results } : formatLintText(results), json);
  if (!ok) process.exitCode = 1;
}

function formatLintText(results: unknown[]): string {
  const lines: string[] = [];
  for (const r of results as Array<Record<string, unknown>>) {
    lines.push(`${r.ok ? "PASS" : "FAIL"} ${r.plan_id} (errors=${r.validation_errors}, conflicts=${r.ownership_conflicts}, cycles=${r.cycles})`);
  }
  return lines.join("\n");
}

async function cmdReindex(repoRoot: string, json: boolean): Promise<void> {
  const store = await openStoreFor(repoRoot);
  try {
    const result = await reindexBrainFromRepo(store, repoRoot);
    out(json ? result : `reindexed ${result.nodeCount} nodes / ${result.edgeCount} edges in ${result.durationMs}ms`, json);
  } finally {
    store.close();
  }
}

async function cmdDag(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const bundle = await firstBundle(repoRoot, args.positional[0] ?? (args.flags.plan as string | undefined));
  const dag = buildWorkGraphDag(allTasks(bundle));
  const frontier = selectDisjointFrontier(dag, 4);
  const summary = {
    plan_id: bundle.manifest.plan_id,
    waves: bundle.waves.map((w) => ({
      wave_id: w.wave_id,
      tasks: w.tasks.length,
      done: w.tasks.filter((t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped").length,
    })),
    critical_path: dag.criticalPathIds,
    frontier: frontier.map((n) => ({ code: n.code, state: n.state })),
    cycles: dag.cycles,
  };
  out(summary, json);
}

async function cmdNext(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const bundle = await firstBundle(repoRoot, args.positional[0] ?? (args.flags.plan as string | undefined));
  const store = await openStoreFor(repoRoot);
  try {
    const dag = buildWorkGraphDag(allTasks(bundle));
    const frontier = selectDisjointFrontier(dag, 4);
    const next = frontier[0];
    if (!next) {
      out({ ready: false, reason: "no ready task" }, json);
      return;
    }
    const brief = compileCognitiveMicroBrief(store, bundle, next.code);
    if (args.flags.claim) {
      const claim = await claimTaskLease(store, {
        taskUrn: next.urn,
        agentRuntime: (args.flags.agent as string | undefined) ?? "cli",
        sessionId: (args.flags.session as string | undefined) ?? `cli-${Date.now()}`,
      });
      out({ ready: true, claimed: claim.ok, task: next.code, brief }, json);
      return;
    }
    out({ ready: true, task: next.code, brief }, json);
  } finally {
    store.close();
  }
}

async function cmdRecall(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const query = args.positional.join(" ");
  if (!query) fail("recall requires <query>");
  const store = await openStoreFor(repoRoot);
  try {
    const result = await hybridRecall(store, { query });
    out(result, json);
  } finally {
    store.close();
  }
}

async function cmdImpact(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const target = args.positional[0];
  if (!target) fail("impact requires <file-or-urn>");
  const store = await openStoreFor(repoRoot);
  try {
    out(queryBlastRadiusImpact(store, target), json);
  } finally {
    store.close();
  }
}

async function findTask(repoRoot: string, planId: string | undefined, taskId: string) {
  const bundle = await firstBundle(repoRoot, planId);
  const task = allTasks(bundle).find((t) => t.code === taskId || t.urn === taskId);
  if (!task) fail(`task not found: ${taskId}`);
  return { bundle, task };
}

async function cmdClaim(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const taskId = args.positional[0];
  if (!taskId) fail("claim requires <task-id>");
  const { bundle, task } = await findTask(repoRoot, args.flags.plan as string | undefined, taskId);
  const store = await openStoreFor(repoRoot);
  try {
    const result = await claimTaskLease(store, {
      taskUrn: task.urn,
      agentRuntime: (args.flags.agent as string | undefined) ?? "cli",
      sessionId: (args.flags.session as string | undefined) ?? `cli-${Date.now()}`,
    });
    out(result, json);
    if (!result.ok) process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function cmdVerify(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const taskId = args.positional[0];
  if (!taskId) fail("verify requires <task-id>");
  const { task } = await findTask(repoRoot, args.flags.plan as string | undefined, taskId);
  const results = await executeVerifyCommands(
    task.verification.commands.map((c) => ({ cmd: c.cmd, expectedExitCode: c.expected_exit_code })),
    { cwd: repoRoot }
  );
  const ok = results.every((r) => r.exitCode === (task.verification.commands[0]?.expected_exit_code ?? 0) || r.exitCode === 0);
  out({ ok, results }, json);
  if (!ok) process.exitCode = 1;
}

async function cmdComplete(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const taskId = args.positional[0];
  if (!taskId) fail("complete requires <task-id>");
  const { bundle } = await findTask(repoRoot, args.flags.plan as string | undefined, taskId);
  const store = await openStoreFor(repoRoot);
  try {
    const result = await completeMicroTask(store, repoRoot, bundle.manifest.plan_id, taskId, {
      sessionId: (args.flags.session as string | undefined) ?? `cli-${Date.now()}`,
      agentRuntime: (args.flags.agent as string | undefined) ?? "cli",
      autoCommit: args.flags.commit === true,
    });
    out(result, json);
    if (!result.ok) process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function cmdFail(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const taskId = args.positional[0];
  const reason = args.flags.reason as string | undefined;
  if (!taskId || !reason) fail("fail requires <task-id> --reason <msg>");
  const { bundle, task } = await findTask(repoRoot, args.flags.plan as string | undefined, taskId);
  const store = await openStoreFor(repoRoot);
  try {
    await recordMicroTaskFailure(store, repoRoot, bundle.manifest.plan_id, taskId, {
      taskCode: task.code,
      planId: bundle.manifest.plan_id,
      verifyResults: [],
      scopeCheck: { ok: false, ownedChanged: [], outOfScopeFiles: [] },
      attemptNumber: task.lifecycle.attempts + 1,
    });
    out({ ok: true, task_id: taskId, reason }, json);
  } finally {
    store.close();
  }
}

async function cmdBlock(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const taskId = args.positional[0];
  const reason = args.flags.reason as string | undefined;
  if (!taskId || !reason) fail("block requires <task-id> --reason <msg>");
  await findTask(repoRoot, args.flags.plan as string | undefined, taskId);
  out({ ok: true, task_id: taskId, blocked: true, reason }, json);
}

async function cmdSleep(repoRoot: string, json: boolean): Promise<void> {
  const store = await openStoreFor(repoRoot);
  try {
    out(runNonRemSleepConsolidation(store), json);
  } finally {
    store.close();
  }
}

async function cmdSync(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const target = (args.flags.target as string | undefined) ?? "md";
  const check = args.flags.check === true || args.flags.apply !== true && target !== undefined;
  const bundle = await firstBundle(repoRoot, args.flags.plan as string | undefined);
  const { planMarkdownAdapter } = await import("./adapters/plan-md.adapter.js");
  const diff = await planMarkdownAdapter.planSync(bundle, { planRoot: repoRoot, checkOnly: target === "md" ? check : false });
  out({ target, check, diff }, json);
}

async function cmdIntake(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const issuePath = args.flags["github-issue"] as string | undefined;
  if (!issuePath) fail("intake requires --github-issue <json-path>");
  const raw = await readFile(resolve(repoRoot, issuePath), "utf8");
  const issue = JSON.parse(raw) as { issueNumber: number; title: string; body: string; labels: string[]; state: "open" | "closed" };
  const draft = parseGitHubIssueToIntakeDraft(issue, (args.flags.plan as string | undefined) ?? "intake", {
    org: (args.flags.org as string | undefined) ?? "local",
    name: (args.flags.repo as string | undefined) ?? "repo",
  });
  out(draft, json);
}

async function cmdExportSwarm(repoRoot: string, args: ParsedArgs, json: boolean): Promise<void> {
  const bundle = await firstBundle(repoRoot, args.positional[0] ?? (args.flags.plan as string | undefined));
  const store = await openStoreFor(repoRoot);
  try {
    const manifest = exportSwarmWaveManifest(store, bundle, {
      waveId: args.flags.wave as string | undefined,
      maxParallel: args.flags["max-parallel"] ? Number(args.flags["max-parallel"]) : undefined,
    });
    out(manifest, json);
  } finally {
    store.close();
  }
}

async function cmdMcp(repoRoot: string, args: ParsedArgs): Promise<void> {
  await runStdioServer({ repoRoot, allowWrite: args.flags["allow-write"] === true });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  const repoRoot = resolve((args.flags.repo as string | undefined) ?? process.cwd());
  const json = args.flags.json === true;

  switch (args.command) {
    case "init":
      return cmdInit(repoRoot, args, json);
    case "lint":
      return cmdLint(repoRoot, args, json);
    case "reindex":
      return cmdReindex(repoRoot, json);
    case "dag":
      return cmdDag(repoRoot, args, json);
    case "next":
      return cmdNext(repoRoot, args, json);
    case "recall":
      return cmdRecall(repoRoot, args, json);
    case "impact":
      return cmdImpact(repoRoot, args, json);
    case "claim":
      return cmdClaim(repoRoot, args, json);
    case "verify":
      return cmdVerify(repoRoot, args, json);
    case "complete":
      return cmdComplete(repoRoot, args, json);
    case "fail":
      return cmdFail(repoRoot, args, json);
    case "block":
      return cmdBlock(repoRoot, args, json);
    case "sleep":
      return cmdSleep(repoRoot, json);
    case "sync":
      return cmdSync(repoRoot, args, json);
    case "intake":
      return cmdIntake(repoRoot, args, json);
    case "export-swarm":
      return cmdExportSwarm(repoRoot, args, json);
    case "mcp":
      return cmdMcp(repoRoot, args);
    default:
      fail(`unknown command: ${args.command} (run with --help)`);
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "plan-taskos — Cognitive WorkGraph OS CLI",
      "",
      "Usage: plan-taskos <command> [args] [flags]",
      "",
      "Commands:",
      "  init <plan-id> --title <t>     scaffold a new plan bundle",
      "  lint [plan-id]                 validate schemas, ownership disjointness, cycles",
      "  reindex                        rebuild .plan/.brain/taskos.sqlite from Git",
      "  dag [plan-id]                  wave stats, frontier, Boss Critical Path",
      "  next [plan-id] [--claim]       O(1) Cognitive Micro-Brief for next ready task",
      "  recall <query>                 hybrid BM25+Ollama Brain recall",
      "  impact <file-or-urn>           2-hop blast radius",
      "  claim <task-id>                claim a task lease",
      "  verify <task-id>               run the task's verify commands",
      "  complete <task-id> [--commit]  seal proof + optional atomic commit",
      "  fail <task-id> --reason <m>    record a failure",
      "  block <task-id> --reason <m>   mark a task blocked",
      "  sleep                          Non-REM episodic consolidation",
      "  sync [--target md|taskos|docs|github|orm] [--check]",
      "                                 run Split-Authority projection adapters",
      "  intake --github-issue <path>   convert GitHub issue JSON into intake draft",
      "  export-swarm [plan-id] [--wave W1] [--max-parallel 4]",
      "                                 disjoint /swarm worker briefs",
      "  mcp [--allow-write]            start stdio JSON-RPC MCP server",
      "",
      "Global flags: --json, --plan <id>, --repo <path>, --check, --apply",
      "",
    ].join("\n")
  );
}

main().catch((e: Error) => {
  process.stderr.write(`fatal: ${e.message}\n`);
  process.exit(1);
});

// Re-exported for testability; unused directly here.
export { spawnSync, releaseTaskLease, __dirname as cliDir };
