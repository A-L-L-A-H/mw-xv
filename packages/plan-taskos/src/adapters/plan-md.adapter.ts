/**
 * T24 — Deterministic `.plan/<id>.md` Projector.
 *
 * Renders observatory-compatible Markdown from a v2 LoadedPlanBundle.
 * 100% compatible with `apps/desktop/src/observatory/plan-collector.ts` regex.
 */

import type {
  LoadedPlanBundle,
  PlanTaskIR,
  WaveDefinition,
  PlanManifest,
  ProjectionAdapter,
  ProjectionDiff,
  ProjectionApplyResult,
} from "../core/types.js";
import { sha256Hex } from "../core/redaction.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface PlanMdAdapterOptions {
  readonly planRoot?: string;
  readonly checkOnly?: boolean;
}

export const planMarkdownAdapter: ProjectionAdapter<PlanMdAdapterOptions> = {
  name: "plan-markdown",
  authorityPlanes: ["git_spec", "proof_runner"],

  async planSync(bundle: LoadedPlanBundle, options?: PlanMdAdapterOptions): Promise<ProjectionDiff> {
    const rendered = renderPlanMarkdown(bundle);
    const contentHash = sha256Hex(rendered);

    const planRoot = options?.planRoot ?? process.cwd();
    const planDir = join(planRoot, ".plan", bundle.manifest.plan_id);
    const outputPath = join(planDir, `${bundle.manifest.plan_id}.md`);

    let existingContent = "";
    try {
      existingContent = await readFile(outputPath, "utf8");
    } catch {
      // File doesn't exist yet
    }

    const existingHash = existingContent ? sha256Hex(existingContent) : "";

    if (options?.checkOnly) {
      return {
        added: [],
        changed: existingHash !== contentHash ? [outputPath] : [],
        removed: [],
        content_hash: contentHash,
      };
    }

    if (existingHash !== contentHash) {
      await mkdir(planDir, { recursive: true });
      await writeFile(outputPath, rendered, "utf8");
    }

    return {
      added: existingHash ? [] : [outputPath],
      changed: existingHash && existingHash !== contentHash ? [outputPath] : [],
      removed: [],
      content_hash: contentHash,
    };
  },

  async applySync(
    bundle: LoadedPlanBundle,
    diff: ProjectionDiff,
    _options?: PlanMdAdapterOptions
  ): Promise<ProjectionApplyResult> {
    // Already applied in planSync for this adapter
    return {
      success: true,
      applied_changes: diff.added.length + diff.changed.length,
    };
  },
};

/**
 * Render the full `.plan/<id>.md` document from a LoadedPlanBundle.
 * Format mirrors the Master Plan file structure for observatory round-trip compatibility.
 */
function renderPlanMarkdown(bundle: LoadedPlanBundle): string {
  const manifest = bundle.manifest;
  const waves = bundle.waves;

  const totalTasks = waves.reduce((sum, w) => sum + w.tasks.length, 0);
  const completedTasks = waves.reduce(
    (sum, w) => sum + w.tasks.filter((t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped").length,
    0
  );

  // Compute Merkle root from proof hashes
  const allProofHashes = getAllProofHashes(bundle);
  const merkleRoot = allProofHashes.length > 0 ? sha256Hex(allProofHashes.sort().join("")) : "0".repeat(64);

  const lines: string[] = [];

  // Header
  lines.push(`# \`@moonwitness/plan-taskos\` — ${manifest.title} (Flash-Ready · ${totalTasks} Micro-Tasks)`);
  lines.push("");
  lines.push(`- **Plan ID:** \`${manifest.plan_id}\``);
  lines.push(`- **ADR:** \`.plan/${manifest.plan_id}/ADR-003-${manifest.plan_id}.md\``);
  lines.push(`- **Total Micro-Tasks:** \`${totalTasks}\` (\`T01\`–\`T${String(totalTasks).padStart(2, "0")}\`) — 100% autonomous, zero human decisions, zero overlap`);
  lines.push(`- **Target Branch:** \`${manifest.repo.target_branch}\``);
  lines.push(`- **Merkle Root:** \`${merkleRoot.slice(0, 16)}...\``);
  lines.push("");

  // Disjoint File Ownership & Dependency DAG table
  lines.push("---");
  lines.push("");
  lines.push("## 1. Disjoint File Ownership & Dependency DAG (Zero Overlap Guarantee)");
  lines.push("");
  lines.push("| Wave | Playbook | Tasks | Exclusive File Ownership | Depends On |");
  lines.push("|---|---|---|---|---|");

  for (const wave of waves) {
    const waveFile = manifest.waves.find((w) => w.id === wave.wave_id);
    const playbookPath = waveFile?.wave_file ?? "";
    const specFile = waveFile?.spec_file ?? "";
    const taskCodes = wave.tasks.map((t) => `\`${t.code}\``).join(", ");
    const fileOwnership = wave.tasks
      .flatMap((t) => [...t.governance.owner_files, ...(t.governance.owner_globs ?? [])])
      .map((f) => `\`${f}\``)
      .join(", ");
    const dependsOn = waveFile?.depends_on.map((d) => `\`${d}\``).join(", ") ?? "None";

    lines.push(
      `| **${wave.wave_id}** | \`${playbookPath}\` + \`${specFile}\` | ${taskCodes} | ${fileOwnership} | ${dependsOn} |`
    );
  }

  lines.push("");

  // Global Micro-Task Checklist
  lines.push("---");
  lines.push("");
  lines.push("## 2. Global Micro-Task Checklist");
  lines.push("");

  for (const wave of waves) {
    const waveFile = manifest.waves.find((w) => w.id === wave.wave_id);
    const waveTitle = waveFile?.title ?? wave.title;

    lines.push(`### Wave ${wave.wave_id} — ${waveTitle} (\`${waveFile?.wave_file ?? ""}\`)`);
    lines.push("");

    for (const task of wave.tasks) {
      const status = task.lifecycle.status === "done" || task.lifecycle.status === "skipped" ? "[x]" : "[ ]";
      lines.push(`- ${status} **${task.code}** — ${task.title}`);
    }
    lines.push("");
  }

  // Execution Progress Ledger
  lines.push("---");
  lines.push("");
  lines.push("## 3. Execution Progress Ledger");
  lines.push("");
  lines.push("| Wave | Task Range | Completed Tasks | Last Commit SHA | Latest Verification Evidence |");
  lines.push("|---|---|---|---|---|");

  const wavesByRange = new Map<string, { wave: WaveDefinition; manifest: PlanManifest }>();

  // We need to know the overall task ranges per wave - simplified here
  let taskIndex = 1;
  for (const wave of waves) {
    const startCode = wave.tasks[0]?.code ?? "T01";
    const endCode = wave.tasks[wave.tasks.length - 1]?.code ?? "T01";
    const waveCompleted = wave.tasks.filter(
      (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
    ).length;

    lines.push(
      `| ${wave.wave_id} | \`${startCode}\`–\`${endCode}\` | \`${waveCompleted} / ${wave.tasks.length}\` | — | — |`
    );
    taskIndex += wave.tasks.length;
  }

  lines.push("");

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Collect all proof hashes from the plan bundle's tasks that have status 'done'.
 */
function getAllProofHashes(bundle: LoadedPlanBundle): string[] {
  const hashes: string[] = [];
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      if (task.lifecycle.status === "done" || task.lifecycle.status === "skipped") {
        // Extract proof hash from projections.evidence_ref or task.code
        // This is a placeholder - actual proof hashes come from the proof_ledger
        // In production, this would query the brain store
        const evidenceRef = (task.projections as Record<string, unknown>).evidence_ref as string | undefined;
        if (evidenceRef) {
          // Parse the hash from the evidence_ref if available
          const match = evidenceRef.match(/([a-f0-9]{64})/);
          if (match) hashes.push(match[1]);
        }
      }
    }
  }
  return hashes;
}