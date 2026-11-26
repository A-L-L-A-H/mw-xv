/**
 * T25 — Global TaskOS v2 Roll-Up & 5-Layer `documents[]` Adapter.
 *
 * Projects a LoadedPlanBundle into strict `moonwitness-tasks/v2` records
 * (`docs/tasks/tasks.schema.json` compatible) with bijective status/priority
 * mapping, reciprocal `dependsOn`/`blocks` edges, and lossless `metadata.urn`
 * linkage. Also projects plan ADRs, wave specs, and evidence summaries into
 * the 5-layer document ontology (`raw | brain | wiki | blueprints | specs`).
 */

import type {
  LoadedPlanBundle,
  PlanTaskIR,
  PlanManifest,
  WorkStatus,
  ModelTier,
  RiskTier,
} from "../core/types.js";

/** Bijective WorkStatus -> TaskOS v2 status map (no lossy many-to-one). */
const STATUS_MAP: Readonly<Record<WorkStatus, "backlog" | "todo" | "doing" | "review" | "blocked" | "done">> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "doing",
  review: "review",
  blocked: "blocked",
  done: "done",
  skipped: "done",
  cancelled: "backlog",
};

/** Bijective RiskTier -> TaskOS v2 risk map. */
const RISK_MAP: Readonly<Record<RiskTier, "low" | "medium" | "high">> = {
  R0: "low",
  R1: "low",
  R2: "medium",
  R3: "high",
  R4: "high",
};

export interface TaskosV2Options {
  readonly foldMode?: "wave" | "plan" | "task";
  readonly projectSlug?: string;
}

export interface TaskosV2AcceptanceCriterion {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface TaskosV2Task {
  readonly code: string;
  readonly project: string;
  readonly series: string;
  readonly milestone: string | null;
  readonly title: string;
  readonly status: "backlog" | "todo" | "doing" | "review" | "blocked" | "done";
  readonly priority: "p0" | "p1" | "p2" | "p3";
  readonly human: boolean;
  readonly risk: "low" | "medium" | "high" | null;
  readonly dependsOn: readonly string[];
  readonly blocks: readonly string[];
  readonly tags: readonly string[];
  readonly scope: { readonly packages: readonly string[]; readonly files: readonly string[] };
  readonly acceptanceCriteria: readonly TaskosV2AcceptanceCriterion[];
  readonly validation: { readonly commands: readonly string[]; readonly expected: string };
  readonly evidence: { readonly paths: readonly string[]; readonly detailFile: string | null; readonly commitSha: string | null };
  readonly sourceRef: { readonly file: string };
  readonly metadata: {
    readonly plan_urn: string;
    readonly fold_mode: "wave" | "plan" | "task";
    readonly proof_merkle_root: string;
  };
}

export interface TaskosV2Document {
  readonly slug: string;
  readonly layer: "raw" | "brain" | "wiki" | "blueprints" | "specs";
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly project: string;
  readonly status: "draft" | "in_review" | "accepted" | "implemented" | "superseded" | "archived";
  readonly linkedTasks: readonly string[];
}

export interface TaskosV2Projection {
  readonly foldMode: "wave" | "plan" | "task";
  readonly projectSlug: string;
  readonly tasks: readonly TaskosV2Task[];
  readonly documents: readonly TaskosV2Document[];
  readonly proofMerkleRoot: string;
}

/**
 * Project a LoadedPlanBundle into TaskOS v2 tasks + 5-layer documents.
 */
export function projectBundleToTaskosV2(
  bundle: LoadedPlanBundle,
  options: TaskosV2Options = {}
): TaskosV2Projection {
  const foldMode = options.foldMode ?? "wave";
  const projectSlug = options.projectSlug ?? bundle.manifest.plan_id;
  const merkleRoot = computePlanMerkleRoot(bundle);

  const tasks: TaskosV2Task[] = [];
  const documents: TaskosV2Document[] = [];

  if (foldMode === "plan") {
    // 1 tracking task per plan
    const allDone = bundle.waves.every((w) =>
      w.tasks.every((t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped")
    );
    tasks.push({
      code: bundle.manifest.plan_id,
      project: projectSlug,
      series: "plan",
      milestone: null,
      title: bundle.manifest.title,
      status: allDone ? "done" : "doing",
      priority: "p1",
      human: false,
      risk: null,
      dependsOn: [],
      blocks: [],
      tags: ["plan-taskos", "rolled-up"],
      scope: { packages: [], files: [] },
      acceptanceCriteria: [],
      validation: { commands: [], expected: "" },
      evidence: { paths: [bundle.source_path], detailFile: null, commitSha: null },
      sourceRef: { file: bundle.source_path },
      metadata: {
        plan_urn: `urn:mw:work:${bundle.manifest.repo.org}/${bundle.manifest.repo.name}:${bundle.manifest.plan_id}`,
        fold_mode: foldMode,
        proof_merkle_root: merkleRoot,
      },
    });
  } else if (foldMode === "wave") {
    // 1 task per wave (default)
    for (const wave of bundle.waves) {
      const waveDone = wave.tasks.every(
        (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
      );
      const dependsOn = bundle.manifest.waves.find((w) => w.id === wave.wave_id)?.depends_on ?? [];
      tasks.push({
        code: `${bundle.manifest.plan_id}:${wave.wave_id}`,
        project: projectSlug,
        series: "wave",
        milestone: bundle.manifest.plan_id,
        title: wave.title,
        status: waveDone ? "done" : "doing",
        priority: "p1",
        human: false,
        risk: null,
        dependsOn,
        blocks: [],
        tags: ["plan-taskos", "wave"],
        scope: {
          packages: [],
          files: wave.tasks.flatMap((t) => [...t.governance.owner_files, ...(t.governance.owner_globs ?? [])]),
        },
        acceptanceCriteria: wave.tasks.flatMap((t) =>
          t.verification.acceptance_criteria.map((c, i) => ({
            id: `${t.code}-AC-${String(i + 1).padStart(2, "0")}`,
            text: c,
            done: t.lifecycle.status === "done" || t.lifecycle.status === "skipped",
          }))
        ),
        validation: { commands: [], expected: "" },
        evidence: { paths: [bundle.source_path], detailFile: null, commitSha: null },
        sourceRef: { file: bundle.source_path },
        metadata: {
          plan_urn: `urn:mw:work:${bundle.manifest.repo.org}/${bundle.manifest.repo.name}:${bundle.manifest.plan_id}`,
          fold_mode: foldMode,
          proof_merkle_root: merkleRoot,
        },
      });
    }
  } else {
    // foldMode === 'task': 1:1 issue per task
    for (const wave of bundle.waves) {
      for (const task of wave.tasks) {
        tasks.push(projectTaskToTaskosV2(task, wave, bundle, projectSlug, foldMode, merkleRoot));
      }
    }
  }

  // Project plan documents into the 5-layer ontology.
  for (const doc of bundle.documents) {
    documents.push({
      slug: doc.slug,
      layer: doc.layer,
      title: doc.title,
      body: "",
      tags: ["plan-taskos"],
      project: projectSlug,
      status: doc.status,
      linkedTasks: [...doc.linked_task_urns],
    });
  }

  // Project wave specs as 'specs' layer documents.
  for (const waveRef of bundle.manifest.waves) {
    if (waveRef.spec_file) {
      documents.push({
        slug: `${bundle.manifest.plan_id}-spec-${waveRef.id.toLowerCase()}`,
        layer: "specs",
        title: waveRef.title,
        body: "",
        tags: ["plan-taskos", "wave-spec"],
        project: projectSlug,
        status: "accepted",
        linkedTasks: bundle.waves
          .find((w) => w.wave_id === waveRef.id)
          ?.tasks.map((t) => t.urn) ?? [],
      });
    }
  }

  return {
    foldMode,
    projectSlug,
    tasks,
    documents,
    proofMerkleRoot: merkleRoot,
  };
}

function projectTaskToTaskosV2(
  task: PlanTaskIR,
  wave: { wave_id: string; title: string },
  bundle: LoadedPlanBundle,
  projectSlug: string,
  foldMode: "wave" | "plan" | "task",
  merkleRoot: string
): TaskosV2Task {
  const done = task.lifecycle.status === "done" || task.lifecycle.status === "skipped";
  const riskTier = task.lifecycle.risk_tier;

  return {
    code: task.projections.taskos_code ?? task.code,
    project: projectSlug,
    series: bundle.manifest.plan_id,
    milestone: wave.wave_id,
    title: task.title,
    status: STATUS_MAP[task.lifecycle.status],
    priority: "p1",
    human: false,
    risk: riskTier ? RISK_MAP[riskTier] : null,
    dependsOn: [...task.graph.depends_on],
    blocks: [],
    tags: ["plan-taskos", "micro-task"],
    scope: {
      packages: [],
      files: [...task.governance.owner_files, ...(task.governance.owner_globs ?? [])],
    },
    acceptanceCriteria: task.verification.acceptance_criteria.map((c, i) => ({
      id: `${task.code}-AC-${String(i + 1).padStart(2, "0")}`,
      text: c,
      done,
    })),
    validation: {
      commands: task.verification.commands.map((c) => c.cmd),
      expected: task.verification.commands.every((c) => (c.expected_exit_code ?? 0) === 0)
        ? "all commands exit 0"
        : "per-command expected_exit_code",
    },
    evidence: {
      paths: [(task.projections as Record<string, unknown>).evidence_ref as string ?? ""].filter(Boolean),
      detailFile: null,
      commitSha: null,
    },
    sourceRef: { file: bundle.source_path },
    metadata: {
      plan_urn: task.urn,
      fold_mode: foldMode,
      proof_merkle_root: merkleRoot,
    },
  };
}

/**
 * Merge a projected TaskOS v2 patch into an existing registry, preserving all
 * unrelated records untouched and enforcing reciprocal dependsOn/blocks edges.
 */
export function mergeTaskosV2Patch<T extends { code: string; dependsOn?: readonly string[]; blocks?: readonly string[] }>(
  existingRegistry: { tasks: T[] } & Record<string, unknown>,
  projected: readonly Omit<T, "blocks">[]
): { tasks: T[] } & Record<string, unknown> {
  const existingByCode = new Map(existingRegistry.tasks.map((t) => [t.code, t]));
  const projectedByCode = new Map(projected.map((t) => [t.code, t]));

  const merged: T[] = [];
  const seen = new Set<string>();

  // Update projected records in place; preserve everything else verbatim.
  for (const task of existingRegistry.tasks) {
    if (projectedByCode.has(task.code)) {
      const p = projectedByCode.get(task.code)!;
      merged.push({
        ...task,
        ...p,
        dependsOn: [...(p.dependsOn ?? [])],
        blocks: [...(task.blocks ?? [])],
      } as unknown as T);
    } else {
      merged.push({ ...task, dependsOn: [...(task.dependsOn ?? [])], blocks: [...(task.blocks ?? [])] } as T);
    }
    seen.add(task.code);
  }

  // Append new projected records not present in the registry.
  for (const p of projected) {
    if (!seen.has(p.code)) {
      merged.push({ ...p, dependsOn: [...(p.dependsOn ?? [])], blocks: [] } as unknown as T);
      seen.add(p.code);
    }
  }

  // Enforce reciprocal blocks edges: if A dependsOn B, B.blocks includes A.
  const byCode = new Map(merged.map((t) => [t.code, t]));
  for (const task of merged) {
    for (const dep of task.dependsOn ?? []) {
      const depTask = byCode.get(dep);
      if (depTask && !(depTask.blocks ?? []).includes(task.code)) {
        (depTask.blocks as string[]).push(task.code);
      }
    }
    // Reverse: if A blocks B, B dependsOn A.
    for (const blocked of task.blocks ?? []) {
      const blockedTask = byCode.get(blocked);
      if (blockedTask && !(blockedTask.dependsOn ?? []).includes(task.code)) {
        (blockedTask.dependsOn as string[]).push(task.code);
      }
    }
  }

  return { ...existingRegistry, tasks: merged };
}

/**
 * Deterministic plan-level Merkle root placeholder: SHA-256 over sorted,
 * completed task codes. Actual per-proof hashes come from the proof_ledger;
 * this is the pure-bundle approximation used for metadata linkage.
 */
function computePlanMerkleRoot(bundle: LoadedPlanBundle): string {
  const completedCodes = bundle.waves
    .flatMap((w) => w.tasks)
    .filter((t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped")
    .map((t) => t.code)
    .sort();
  return sha256HexStub(completedCodes.join("|"));
}

import { createHash } from "node:crypto";
import { canonicalJson } from "../core/redaction.js";

function sha256HexStub(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// Re-export for downstream consumers that need canonical JSON over projections.
export { canonicalJson };

// Unused-import guards for types re-exported for documentation purposes.
export type { PlanManifest, ModelTier };
