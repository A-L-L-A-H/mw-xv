/**
 * T19 — O(1) Cognitive Micro-Brief Compiler.
 *
 * Compiles a bounded, token-efficient micro-brief for a single task by extracting
 * ONLY that task's spec slice + 2-hop knowledge graph context + top-3 redacted pitfalls.
 * Output is O(1) regardless of plan size (10 or 500 tasks).
 */

import type { BrainStorageDriver } from "../brain/storage.js";
import type {
  LoadedPlanBundle,
  PlanTaskIR,
  WaveDefinition,
  ExecutionPolicy,
  ModelTier,
  RiskTier,
} from "../core/types.js";
import { queryTwoHopContext } from "../brain/knowledge-graph.js";
import { recallPitfallsForPaths } from "../brain/episodic-memory.js";

export interface CognitiveMicroBrief {
  readonly identity: {
    readonly urn: string;
    readonly code: string;
    readonly wave: string;
    readonly modelTier: ModelTier;
    readonly riskTier: RiskTier;
    readonly attempts: number;
    readonly maxAttempts: number;
  };
  readonly scope: {
    readonly ownerFiles: readonly string[];
    readonly readOnlyRefs: readonly string[];
  };
  readonly spec: {
    readonly title: string;
    readonly exactSpecExcerpt: string;
    readonly doNotExcerpt: string;
    readonly acceptanceCriteria: readonly string[];
    readonly verifyCommands: readonly string[];
    readonly commitTemplate: string;
  };
  readonly cognitiveContext: {
    readonly siblingProofs: readonly { code: string; envelopeSha256: string }[];
    readonly matchedInvariants: readonly { id: string; rule: string }[];
    readonly linkedAdrs: readonly { urn: string; title: string }[];
    readonly pitfalls: readonly { summary: string; failurePattern: string; file: string }[];
  };
  readonly renderedMarkdown: string;
}

/**
 * Compile a cognitive micro-brief for a single task.
 * O(1) bounded output: extracts only the target task + 2-hop context + top-3 pitfalls.
 */
export function compileCognitiveMicroBrief(
  store: BrainStorageDriver,
  bundle: LoadedPlanBundle,
  taskId: string,
  options: { maxChars?: number } = {}
): CognitiveMicroBrief {
  const maxChars = options.maxChars ?? 3200;

  // Find the target task across all waves
  let targetTask: PlanTaskIR | null = null;
  let targetWave: WaveDefinition | null = null;

  for (const wave of bundle.waves) {
    const found = wave.tasks.find((t) => t.code === taskId);
    if (found) {
      targetTask = found;
      targetWave = wave;
      break;
    }
  }

  if (!targetTask || !targetWave) {
    throw new Error(`Task ${taskId} not found in plan ${bundle.manifest.plan_id}`);
  }

  // 1. Identity
  const executionPolicy = bundle.manifest.execution_policy;
  const modelTier = targetTask.lifecycle.model_tier ?? executionPolicy.default_model_tier;
  const riskTier = targetTask.lifecycle.risk_tier ?? "R0";
  const attempts = targetTask.lifecycle.attempts;
  const maxAttempts = executionPolicy.max_attempts_per_task;

  // 2. Scope
  const ownerFiles = targetTask.governance.owner_files;
  const readOnlyRefs = targetTask.governance.owner_globs ?? [];

  // 3. Spec slice (O(1) — only this task's spec section)
  const specExcerpt = extractTaskSpec(bundle, targetTask.code);
  const doNotExcerpt = targetTask.governance.do_not?.join("\n") ?? "";

  // 4. Cognitive Context via 2-hop knowledge graph + episodic recall
  const twoHop = queryTwoHopContext(store, targetTask.urn);

  // Sibling proofs on same files (last 2)
  const siblingProofs = twoHop.siblingTasksOnSameFiles
    .slice(-2)
    .map((t) => ({ code: t.code, envelopeSha256: "" })); // proof hash not in TaskRow; placeholder

  // Matched invariants
  const matchedInvariants = twoHop.matchedInvariants.map((i) => ({
    id: i.urn.split(":").pop() ?? i.urn,
    rule: i.rule ?? "",
  }));

  // Linked ADRs
  const linkedAdrs = twoHop.linkedAdrs.map((a) => ({ urn: a.urn, title: a.title }));

  // Top-3 redacted pitfalls
  const pitfallsRaw = recallPitfallsForPaths(store, [...ownerFiles], 3);
  const pitfalls = pitfallsRaw.map((p) => ({
    summary: p.summary,
    failurePattern: p.failure_pattern,
    file: p.owner_files[0] ?? "",
  }));

  // 5. Render bounded Markdown
  const renderedMarkdown = renderMicroBrief({
    identity: {
      urn: targetTask.urn,
      code: targetTask.code,
      wave: targetWave.wave_id,
      modelTier,
      riskTier,
      attempts,
      maxAttempts,
    },
    scope: { ownerFiles, readOnlyRefs },
    spec: {
      title: targetTask.title,
      exactSpecExcerpt: specExcerpt,
      doNotExcerpt,
      acceptanceCriteria: targetTask.verification.acceptance_criteria,
      verifyCommands: targetTask.verification.commands.map((c) => c.cmd),
      commitTemplate: `chore(${taskId.toLowerCase()}): ${targetTask.title}`,
    },
    cognitiveContext: { siblingProofs, matchedInvariants, linkedAdrs, pitfalls },
  });

  // Enforce O(1) char budget
  const truncated = renderedMarkdown.slice(0, maxChars);

  return {
    identity: {
      urn: targetTask.urn,
      code: targetTask.code,
      wave: targetWave.wave_id,
      modelTier,
      riskTier,
      attempts,
      maxAttempts,
    },
    scope: { ownerFiles, readOnlyRefs },
    spec: {
      title: targetTask.title,
      exactSpecExcerpt: specExcerpt,
      doNotExcerpt,
      acceptanceCriteria: targetTask.verification.acceptance_criteria,
      verifyCommands: targetTask.verification.commands.map((c) => c.cmd),
      commitTemplate: `chore(${taskId.toLowerCase()}): ${targetTask.title}`,
    },
    cognitiveContext: { siblingProofs, matchedInvariants, linkedAdrs, pitfalls },
    renderedMarkdown: truncated,
  };
}

function extractTaskSpec(bundle: LoadedPlanBundle, taskCode: string): string {
  // Find the spec file for this task's wave
  for (const wave of bundle.waves) {
    const task = wave.tasks.find((t) => t.code === taskCode);
    if (task) {
      // Try to find the corresponding WaveFileRef with spec_file
      const waveRef = bundle.manifest.waves.find((w) => w.id === wave.wave_id);
      const specFile = waveRef?.spec_file;
      if (specFile) {
        // The spec content would be loaded from bundle.documents
        // For now, return the acceptance criteria as the spec excerpt
        return task.verification.acceptance_criteria.join("\n");
      }
    }
  }
  return "Spec section not found in v2 bundle.";
}

interface RenderContext {
  identity: {
    urn: string;
    code: string;
    wave: string;
    modelTier: ModelTier;
    riskTier: RiskTier;
    attempts: number;
    maxAttempts: number;
  };
  scope: { ownerFiles: readonly string[]; readOnlyRefs: readonly string[] };
  spec: {
    title: string;
    exactSpecExcerpt: string;
    doNotExcerpt: string;
    acceptanceCriteria: readonly string[];
    verifyCommands: readonly string[];
    commitTemplate: string;
  };
  cognitiveContext: {
    siblingProofs: readonly { code: string; envelopeSha256: string }[];
    matchedInvariants: readonly { id: string; rule: string }[];
    linkedAdrs: readonly { urn: string; title: string }[];
    pitfalls: readonly { summary: string; failurePattern: string; file: string }[];
  };
}

function renderMicroBrief(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push(`# Micro-Brief: ${ctx.identity.code} (${ctx.identity.wave})`);
  lines.push("");
  lines.push(`**URN:** \`${ctx.identity.urn}\``);
  lines.push(`**Model:** ${ctx.identity.modelTier} | **Risk:** ${ctx.identity.riskTier} | **Attempt:** ${ctx.identity.attempts}/${ctx.identity.maxAttempts}`);
  lines.push("");

  lines.push("## Scope (Write Allowlist)");
  for (const f of ctx.scope.ownerFiles) lines.push(`- \`${f}\``);
  if (ctx.scope.readOnlyRefs.length > 0) {
    lines.push("");
    lines.push("### Read-Only Refs");
    for (const f of ctx.scope.readOnlyRefs) lines.push(`- \`${f}\``);
  }
  lines.push("");

  lines.push("## Exact Spec & DO / DO-NOT");
  lines.push("");
  lines.push("### Spec");
  lines.push(ctx.spec.exactSpecExcerpt || "_(none)_");
  lines.push("");
  if (ctx.spec.doNotExcerpt) {
    lines.push("### DO NOT");
    lines.push(ctx.spec.doNotExcerpt);
    lines.push("");
  }
  lines.push("### Acceptance Criteria");
  for (const ac of ctx.spec.acceptanceCriteria) lines.push(`- [ ] ${ac}`);
  lines.push("");
  lines.push("### Verify Commands");
  for (const cmd of ctx.spec.verifyCommands) lines.push(`\`\`\`sh\n${cmd}\n\`\`\``);
  lines.push("");
  lines.push("### Commit Template");
  lines.push(`\`${ctx.spec.commitTemplate}\``);
  lines.push("");

  lines.push("## Cognitive Context (2-Hop + Pitfalls)");
  lines.push("");

  if (ctx.cognitiveContext.siblingProofs.length > 0) {
    lines.push("### Last 2 Sibling Proofs (Same Files)");
    for (const s of ctx.cognitiveContext.siblingProofs) {
      lines.push(`- \`${s.code}\` → \`${s.envelopeSha256.slice(0, 16)}...\``);
    }
    lines.push("");
  }

  if (ctx.cognitiveContext.matchedInvariants.length > 0) {
    lines.push("### Matched Invariants");
    for (const i of ctx.cognitiveContext.matchedInvariants) {
      lines.push(`- **${i.id}**: ${i.rule}`);
    }
    lines.push("");
  }

  if (ctx.cognitiveContext.linkedAdrs.length > 0) {
    lines.push("### Linked ADRs");
    for (const a of ctx.cognitiveContext.linkedAdrs) {
      lines.push(`- \`${a.urn}\` — ${a.title}`);
    }
    lines.push("");
  }

  if (ctx.cognitiveContext.pitfalls.length > 0) {
    lines.push("### Top 3 Redacted Pitfalls");
    for (const p of ctx.cognitiveContext.pitfalls) {
      lines.push(`- **${p.file}**: ${p.summary} (pattern: \`${p.failurePattern}\`)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}