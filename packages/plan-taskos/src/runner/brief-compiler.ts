/**
 * T19 — O(1) Cognitive Micro-Brief Compiler.
 *
 * Compiles a bounded, token-efficient micro-brief for a single task by extracting
 * ONLY that task's spec slice + 2-hop knowledge graph context + top-3 redacted pitfalls.
 * Output is O(1) regardless of plan size (10 or 500 tasks).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BrainStorageDriver } from "../brain/storage.js";
import type {
  LoadedPlanBundle,
  PlanTaskIR,
  WaveDefinition,
  ExecutionPolicy,
  ModelTier,
  RiskTier,
  DocumentNodeIR,
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
  const specExcerpt = extractTaskSpec(store, bundle, targetTask.code, targetWave.wave_id);
  const doNotExcerpt = targetTask.governance.do_not?.join("\n") ?? "";

  // 4. Cognitive Context via 2-hop knowledge graph + episodic recall
  const twoHop = queryTwoHopContext(store, targetTask.urn);

  // Sibling proofs on same files (last 2) — envelope hashes come from proof_ledger
  const siblingProofs: { code: string; envelopeSha256: string }[] = [];
  for (const sibling of twoHop.siblingTasksOnSameFiles.slice(-2)) {
    const proof = store.get(
      `SELECT envelope_sha256 FROM proof_ledger WHERE task_code = ? ORDER BY recorded_at DESC LIMIT 1;`,
      sibling.code
    ) as { envelope_sha256: string } | undefined;
    siblingProofs.push({ code: sibling.code, envelopeSha256: proof?.envelope_sha256 ?? "" });
  }

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

/**
 * Return the exact spec excerpt for a single task.
 *
 * Resolution order:
 *   1. `manifest.waves[].spec_file` (WaveFileRef) — read from the plan bundle's
 *      spec documents / disk and slice out the `## Txx` section.
 *   2. The wave playbook itself (`wave_file`) — legacy plans embed the exact
 *      task spec inline in the wave playbook.
 *   3. Fallback: scan all `.plan/<planId>/wave-*.md` files for the task heading.
 *   4. Acceptance criteria from the task IR, as a last-resort fallback.
 */
function extractTaskSpec(
  store: BrainStorageDriver,
  bundle: LoadedPlanBundle,
  taskCode: string,
  waveId: string
): string {
  const waveRef = bundle.manifest.waves.find((w) => w.id === waveId);

  // 1. Dedicated spec file for this wave
  const specFile = waveRef?.spec_file;
  if (specFile) {
    const specContent = readDocContent(store, bundle, specFile);
    const section = specContent ? extractTaskSection(specContent, taskCode) : "";
    if (section) return section;
  }

  // 2. The wave playbook carries the task sections (legacy plans, and v2
  //    bundles whose specs live in wave-*.md playbooks).
  const playbookFile = waveRef?.wave_file;
  if (playbookFile) {
    const playbookContent = readDocContent(store, bundle, playbookFile);
    const section = playbookContent ? extractTaskSection(playbookContent, taskCode) : "";
    if (section) return section;
  }

  // 3. Fallback: scan all wave playbooks in the plan directory directly.
  //    This handles legacy bundles where manifest.waves is empty or wave_id
  //    mapping is synthetic.
  const repoRoot = findRepoRoot(bundle.manifest.plan_id);
  const planDir = join(repoRoot, ".plan", bundle.manifest.plan_id);
  const fallbackContent = scanPlanDirForTask(planDir, taskCode);
  if (fallbackContent) return fallbackContent;

  // 4. Fallback: acceptance criteria from the task IR.
  for (const wave of bundle.waves) {
    if (wave.wave_id === waveId) {
      const task = wave.tasks.find((t) => t.code === taskCode);
      if (task) {
        return task.verification.acceptance_criteria.join("\n");
      }
    }
  }
  return "Spec section not found in plan bundle.";
}

/**
 * Read the full text of a plan document.
 *
 * `bundle.documents` stores document metadata only (urn/slug/path), not body
 * content, so the file is read from disk. `bundle.source_path` is repo-relative
 * (`.plan/<id>` or `.plan/<id>.md`); document paths are repo-relative.
 * `docRef` may be a repo-relative path (`.plan/<id>/specs/W1.md`), a path
 * relative to the plan dir (`specs/W1.md`, `wave-1-x.md`), or a bare filename.
 */
function readDocContent(
  store: BrainStorageDriver,
  bundle: LoadedPlanBundle,
  docRef: string
): string {
  const normalized = docRef.replaceAll("\\", "/");
  const doc = findBundleDoc(bundle, normalized);

  // bundle.source_path is repo-relative (`.plan/<id>` for v2 bundles, `.plan/<id>.md` for legacy).
  // Plan directory on disk is `.plan/<planId>/` at repo root. Because
  // `source_path` is repo-relative, the repo root is found by walking up from
  // the process cwd until the plan directory exists.
  const repoRoot = findRepoRoot(bundle.manifest.plan_id);
  const planDir = join(repoRoot, ".plan", bundle.manifest.plan_id);

  const candidates: string[] = [];
  if (doc) {
    candidates.push(resolve(planDir, doc.path));
  }
  candidates.push(resolve(planDir, normalized));
  candidates.push(resolve(planDir, normalized.replace(/^\.plan\//, "")));

  for (const candidate of candidates) {
    const content = readTextIfExists(candidate);
    if (content) return content;
  }

  // Last resort: some brain stores mirror document bodies into fts_index.
  const slug = doc?.slug ?? normalized.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const content = store.get(
    `SELECT body FROM fts_index WHERE urn = ? LIMIT 1;`,
    `urn:mw:doc:${bundle.manifest.repo.org}/${bundle.manifest.repo.name}:${slug}`
  ) as { body: string } | undefined;
  return content?.body ?? "";
}

function findBundleDoc(bundle: LoadedPlanBundle, normalizedRef: string): DocumentNodeIR | undefined {
  const base = normalizedRef.split("/").pop() ?? normalizedRef;
  const slug = base.replace(/\.md$/, "");
  return bundle.documents.find(
    (d) =>
      d.path === normalizedRef ||
      d.path.endsWith(`/${normalizedRef}`) ||
      d.slug === slug ||
      d.urn.endsWith(`:${slug}`)
  );
}

function readTextIfExists(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Find the repo root that contains `.plan/<planId>`. Plan bundle paths are
 * repo-relative, and the process cwd may be a package dir inside the repo, so
 * walk up from cwd until `.plan/<planId>` exists. Falls back to the current
 * working directory.
 */
function findRepoRoot(planId: string): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".plan", planId))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd());
}

/**
 * Scan a plan directory (`.plan/<planId>`) for the task's spec section by
 * looking through all `wave-*.md` files. Returns the first matching section.
 */
function scanPlanDirForTask(planDir: string, taskCode: string): string {
  let waveFiles: string[] = [];
  try {
    waveFiles = readdirSync(planDir)
      .filter(f => f.startsWith("wave-") && f.endsWith(".md"))
      .map(f => join(planDir, f));
  } catch {
    return "";
  }
  for (const waveFile of waveFiles) {
    const content = readTextIfExists(waveFile);
    const section = content ? extractTaskSection(content, taskCode) : "";
    if (section) return section;
  }
  return "";
}

/**
 * Extract the `## Txx` section for a task from spec content. Returns "" when
 * no such section exists.
 */
function extractTaskSection(specContent: string, taskCode: string): string {
  const lines = specContent.split(/\r?\n/);
  const taskHeadingRe = new RegExp(`^#{2,3}\\s+(?:-\\s+)?(?:\\[[ xX]\\]\\s+)?${taskCode}\\b`);
  let inTask = false;
  const taskSection: string[] = [];

  for (const line of lines) {
    if (!inTask) {
      if (taskHeadingRe.test(line.trim())) {
        inTask = true;
        taskSection.push(line);
      }
      continue;
    }
    if (/^#{1,2}\s+/.test(line.trim())) {
      break; // Next task section (## or higher heading)
    }
    taskSection.push(line);
  }
  return taskSection.join("\n").trim();
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
