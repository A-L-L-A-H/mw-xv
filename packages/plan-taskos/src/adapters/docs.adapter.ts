/**
 * T26 — Docs & Second-Brain Adapter.
 *
 * INV-006 doc-impact detection from `owner_files[]` plus a deterministic
 * Markdown second-brain index renderer with Mermaid DAG (no broken links,
 * no HTML in node labels).
 */

import type { LoadedPlanBundle, PlanTaskIR, DocumentNodeIR } from "../core/types.js";

export type DocsImpact = "none" | "reference_regen" | "links_check";

export interface DocsImpactReport {
  readonly tasksNeedingReferenceRegen: readonly string[];
  readonly tasksNeedingLinksCheck: readonly string[];
  readonly docsImpact: DocsImpact;
  readonly commands: readonly string[];
}

const REFERENCE_REGEN_PATTERNS: readonly RegExp[] = [
  /^apps\/api\/src\/routes\//,
  /^packages\/orm-[^/]+\/src\/models/,
  /^package\.json$/,
];

const LINKS_CHECK_PATTERNS: readonly RegExp[] = [/^docs\//, /^README\.md$/];

/**
 * Detect INV-006 doc-impact triggers statically from task owner_files.
 */
export function analyzeDocsImpact(tasks: readonly PlanTaskIR[]): DocsImpactReport {
  const tasksNeedingReferenceRegen: string[] = [];
  const tasksNeedingLinksCheck: string[] = [];

  for (const task of tasks) {
    const files = [...task.governance.owner_files, ...(task.governance.owner_globs ?? [])];
    for (const file of files) {
      if (REFERENCE_REGEN_PATTERNS.some((re) => re.test(file))) {
        tasksNeedingReferenceRegen.push(task.code);
        break;
      }
    }
    for (const file of files) {
      if (LINKS_CHECK_PATTERNS.some((re) => re.test(file))) {
        tasksNeedingLinksCheck.push(task.code);
        break;
      }
    }
  }

  const docsImpact: DocsImpact =
    tasksNeedingReferenceRegen.length > 0
      ? "reference_regen"
      : tasksNeedingLinksCheck.length > 0
        ? "links_check"
        : "none";

  const commands: string[] = [];
  if (tasksNeedingReferenceRegen.length > 0) {
    commands.push("bun run docs:generate", "bun run architecture:generate");
  }
  if (tasksNeedingLinksCheck.length > 0) {
    commands.push("bun run docs:links");
  }

  return {
    tasksNeedingReferenceRegen: [...new Set(tasksNeedingReferenceRegen)],
    tasksNeedingLinksCheck: [...new Set(tasksNeedingLinksCheck)],
    docsImpact,
    commands,
  };
}

export interface SecondBrainProofRef {
  readonly code: string;
  readonly evidenceRef?: string;
  readonly envelopeSha256?: string;
}

export interface SecondBrainEpisode {
  readonly summary: string;
  readonly failurePattern?: string;
}

/**
 * Render a deterministic Markdown second-brain index card suitable for
 * `docs/second-brain/` or `docs/decisions/`: zero broken relative links
 * (all paths in backticks) and a deterministic Mermaid `flowchart TD` DAG.
 */
export function renderSecondBrainIndex(
  bundle: LoadedPlanBundle,
  proofs: readonly SecondBrainProofRef[],
  episodes: readonly SecondBrainEpisode[]
): string {
  const manifest = bundle.manifest;
  const allTasks = bundle.waves.flatMap((w) => w.tasks);
  const doneCount = allTasks.filter(
    (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
  ).length;

  const lines: string[] = [];

  lines.push(`# ${manifest.title} — Second-Brain Index`);
  lines.push("");
  lines.push(`- **Plan ID:** \`${manifest.plan_id}\``);
  lines.push(`- **Total tasks:** ${allTasks.length} (${doneCount} done)`);
  lines.push(`- **Source:** \`${bundle.source_path}\``);
  lines.push("");

  // Waves overview
  lines.push("## Waves");
  lines.push("");
  for (const wave of bundle.waves) {
    const done = wave.tasks.filter(
      (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
    ).length;
    lines.push(`- **${wave.wave_id}** — ${wave.title}: ${done}/${wave.tasks.length} done`);
  }
  lines.push("");

  // Proof ledger summary
  if (proofs.length > 0) {
    lines.push("## Sealed Proofs");
    lines.push("");
    for (const proof of proofs) {
      const hash8 = proof.envelopeSha256 ? proof.envelopeSha256.slice(0, 8) : "--------";
      lines.push(`- \`${proof.code}\` — proof \`${hash8}\`${proof.evidenceRef ? ` (evidence: \`${proof.evidenceRef}\`)` : ""}`);
    }
    lines.push("");
  }

  // Pitfalls
  if (episodes.length > 0) {
    lines.push("## Learned Pitfalls");
    lines.push("");
    for (const ep of episodes) {
      lines.push(`- ${ep.summary}${ep.failurePattern ? ` (pattern: \`${ep.failurePattern}\`)` : ""}`);
    }
    lines.push("");
  }

  // Deterministic Mermaid DAG
  lines.push("## Dependency DAG");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart TD");
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      if (task.graph.depends_on.length === 0) {
        lines.push(`  ${sanitizeNodeId(task.code)}["${sanitizeNodeLabel(task.code)}"]`);
      } else {
        for (const dep of task.graph.depends_on) {
          lines.push(`  ${sanitizeNodeId(dep)} --> ${sanitizeNodeId(task.code)}`);
        }
      }
    }
  }
  lines.push("```");
  lines.push("");

  // Linked documents
  if (bundle.documents.length > 0) {
    lines.push("## Linked Documents");
    lines.push("");
    for (const doc of bundle.documents) {
      lines.push(`- **${doc.title}** (\`${doc.layer}\`) — \`${doc.path}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Sanitize a Mermaid node id (alphanumeric + underscore only). */
function sanitizeNodeId(code: string): string {
  return `n_${code.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/**
 * Quote and escape Mermaid node labels: no HTML tags, parentheses and
 * brackets are safe inside double quotes.
 */
function sanitizeNodeLabel(code: string): string {
  return code.replace(/</g, "‹").replace(/>/g, "›").replace(/"/g, "'");
}
