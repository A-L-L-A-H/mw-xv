/**
 * T30a — Wave 4 adapter tests: plan-md projector + TaskOS v2 roll-up.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planMarkdownAdapter } from "../src/adapters/plan-md.adapter.js";
import { projectBundleToTaskosV2, mergeTaskosV2Patch } from "../src/adapters/taskos-v2.adapter.js";
import type { LoadedPlanBundle, PlanTaskIR, WaveDefinition } from "../src/core/types.js";

function task(overrides: Partial<PlanTaskIR> & { code: string }): PlanTaskIR {
  return {
    urn: `urn:mw:work:moonwitness/test/adapters:W1/${overrides.code}`,
    kind: "task",
    title: `task ${overrides.code}`,
    lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
    governance: { owner_files: [`packages/plan-taskos/src/${overrides.code.toLowerCase()}.ts`] },
    graph: { depends_on: [] },
    knowledge: {},
    verification: { commands: [{ cmd: "echo ok" }], acceptance_criteria: ["ac1", "ac2"] },
    projections: {},
    ...overrides,
  } as PlanTaskIR;
}

function wave(waveId: string, tasks: PlanTaskIR[], title = `Wave ${waveId}`): WaveDefinition {
  return { schema_version: "1.0.0", plan_id: "adapters", wave_id: waveId, title, tasks };
}

function bundle(waves: WaveDefinition[]): LoadedPlanBundle {
  return {
    format: "plan-taskos/v1",
    manifest: {
      schema_version: "1.0.0",
      plan_id: "adapters",
      title: "Adapters Test Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: ".plan/adapters/ADR-000.md",
      execution_policy: {
        max_attempts_per_task: 3,
        default_model_tier: "flash",
        escalation_chain: ["flash", "neon", "argon", "human"],
        require_clean_scope: true,
        auto_commit: false,
      },
      projections: { github_fold_mode: "wave", taskos_project: "test", orm_project_code: "TEST" },
      waves: waves.map((w, i) => ({
        id: w.wave_id,
        title: w.title,
        wave_file: `.plan/adapters/wave-${i + 1}.md`,
        depends_on: [],
      })),
      documents: [],
    },
    waves,
    documents: [],
    source_path: ".plan/adapters",
  };
}

describe("plan-md adapter (Wave 4)", () => {
  it("writes the projected plan file and reports it as added", async () => {
    const planRoot = await mkdtemp(join(tmpdir(), "plan-md-write-"));
    const b = bundle([wave("W1", [task({ code: "T01" })])]);
    const diff = await planMarkdownAdapter.planSync(b, { planRoot });
    expect(diff.added.length).toBe(1);
    const written = await readFile(join(planRoot, ".plan", "adapters", "adapters.md"), "utf8");
    expect(written).toContain("Plan ID:");
    expect(written).toContain("T01");
  });

  it("renders deterministically: identical bundles produce identical hashes", async () => {
    const b = bundle([
      wave("W1", [
        task({ code: "T01" }),
        task({
          code: "T02",
          lifecycle: { status: "done", delivery_stage: "local", attempts: 1 },
        }),
      ]),
    ]);
    const first = await planMarkdownAdapter.planSync(b, {
      planRoot: await mkdtemp(join(tmpdir(), "plan-md-det-1-")),
    });
    const second = await planMarkdownAdapter.planSync(b, {
      planRoot: await mkdtemp(join(tmpdir(), "plan-md-det-2-")),
    });
    expect(first.content_hash).toBe(second.content_hash);
  });

  it("checkOnly mode reports drift without writing", async () => {
    const planRoot = await mkdtemp(join(tmpdir(), "plan-md-check-"));
    const b = bundle([wave("W1", [task({ code: "T01" })])]);
    const drifted = await planMarkdownAdapter.planSync(b, { planRoot, checkOnly: true });
    expect(drifted.changed.length).toBe(1);
    // After a real sync, checkOnly must report no changes (drift-free).
    await planMarkdownAdapter.planSync(b, { planRoot });
    const clean = await planMarkdownAdapter.planSync(b, { planRoot, checkOnly: true });
    expect(clean.changed).toEqual([]);
  });

  it("task checklist marks done tasks with [x] and pending with [ ]", async () => {
    const planRoot = await mkdtemp(join(tmpdir(), "plan-md-checklist-"));
    const b = bundle([
      wave("W1", [
        task({ code: "T01", lifecycle: { status: "done", delivery_stage: "local", attempts: 1 } }),
        task({ code: "T02" }),
      ]),
    ]);
    await planMarkdownAdapter.planSync(b, { planRoot });
    const written = await readFile(join(planRoot, ".plan", "adapters", "adapters.md"), "utf8");
    expect(written).toContain("- [x] **T01**");
    expect(written).toContain("- [ ] **T02**");
  });
});

describe("taskos-v2 adapter (Wave 4)", () => {
  it("folds wave mode: one record per wave with 1:1 acceptance criteria", () => {
    const b = bundle([
      wave("W1", [
        task({ code: "T01" }),
        task({ code: "T02", lifecycle: { status: "done", delivery_stage: "local", attempts: 1 } }),
      ]),
    ]);
    const projected = projectBundleToTaskosV2(b, { foldMode: "wave", projectSlug: "test" });
    expect(projected.tasks.length).toBe(1);
    const waveTask = projected.tasks[0]!;
    expect(waveTask.code).toBe("adapters:W1");
    // 2 tasks x 2 ACs each = 4 criteria, done flag follows the source task.
    expect(waveTask.acceptanceCriteria.length).toBe(4);
    const doneFlags = waveTask.acceptanceCriteria.map((c) => c.done);
    expect(doneFlags.filter(Boolean).length).toBe(2);
  });

  it("folds task mode: one record per micro-task with metadata urn", () => {
    const b = bundle([wave("W1", [task({ code: "T01" })])]);
    const projected = projectBundleToTaskosV2(b, { foldMode: "task", projectSlug: "test" });
    expect(projected.tasks.length).toBe(1);
    const record = projected.tasks[0]!;
    expect(record.code).toBe("T01");
    expect(record.metadata.plan_urn).toBe("urn:mw:work:moonwitness/test/adapters:W1/T01");
    expect(record.validation.commands).toEqual(["echo ok"]);
  });

  it("merge preserves unrelated registry records untouched", () => {
    const existing = {
      tasks: [
        {
          code: "HUMAN-001",
          project: "portfolio",
          dependsOn: ["HUMAN-000"],
          blocks: [] as string[],
          title: "human record",
        },
      ],
    };
    const b = bundle([wave("W1", [task({ code: "T01" })])]);
    const projected = projectBundleToTaskosV2(b, { foldMode: "task", projectSlug: "test" });
    const merged = mergeTaskosV2Patch(existing, projected.tasks as never);
    expect(merged.tasks.length).toBe(2);
    const human = merged.tasks.find((t) => t.code === "HUMAN-001")!;
    expect(human.title).toBe("human record");
    expect(human.dependsOn).toEqual(["HUMAN-000"]);
  });

  it("merge enforces reciprocal dependsOn/blocks edges", () => {
    const b = bundle([
      wave("W1", [
        task({ code: "T01" }),
        task({ code: "T02", graph: { depends_on: ["T01"] } }),
      ]),
    ]);
    const projected = projectBundleToTaskosV2(b, { foldMode: "task", projectSlug: "test" });
    const merged = mergeTaskosV2Patch({ tasks: [] }, projected.tasks as never) as unknown as {
      tasks: (typeof projected.tasks)[number][];
    };
    const t01 = merged.tasks.find((t) => t.code === "T01")!;
    const t02 = merged.tasks.find((t) => t.code === "T02")!;
    expect(t02!.dependsOn).toContain("T01");
    expect(t01!.blocks).toContain("T02");
  });
});
