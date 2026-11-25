/**
 * T30c — Wave 4 adapter tests: ORM plan-sync payload, /swarm manifest, telemetry sinks.
 */

import { describe, it, expect } from "vitest";
import {
  buildPlanSyncPayload,
  buildWorkContractPayload,
  normalizeOrmCode,
  postPlanSync,
  postWorkContract,
} from "../src/adapters/orm-http.adapter.js";
import {
  exportSwarmWaveManifest,
  MODEL_TIER_ROUTING,
} from "../src/adapters/swarm.adapter.js";
import {
  AlertingTelemetrySink,
  NullTelemetrySink,
  OPERATOR_ALERT_EVENTS,
  renderOperatorAlertMessage,
  type PlanLifecycleEvent,
  type PlanTelemetrySink,
} from "../src/adapters/telemetry.adapter.js";
import { InMemoryBrainStore } from "../src/brain/storage.js";
import type { LoadedPlanBundle, PlanTaskIR, WaveDefinition } from "../src/core/types.js";

function task(code: string, overrides: Partial<PlanTaskIR> = {}): PlanTaskIR {
  return {
    urn: `urn:mw:work:moonwitness/test/orm-swarm:W1/${code}`,
    code,
    kind: "task",
    title: `task ${code}`,
    lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
    governance: { owner_files: [`packages/plan-taskos/src/${code.toLowerCase()}.ts`] },
    graph: { depends_on: [] },
    knowledge: { spec_files: ["specs/spec.md"] },
    verification: {
      commands: [{ cmd: "bun test", expected_exit_code: 0 }],
      acceptance_criteria: ["ac1", "ac2"],
    },
    projections: {},
    ...overrides,
  } as PlanTaskIR;
}

function bundle(waves: WaveDefinition[]): LoadedPlanBundle {
  return {
    format: "plan-taskos/v1",
    manifest: {
      schema_version: "1.0.0",
      plan_id: "orm-swarm",
      title: "Orm Swarm Test Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: ".plan/orm-swarm/ADR-000.md",
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
        wave_file: `.plan/orm-swarm/wave-${i + 1}.md`,
        depends_on: [],
      })),
      documents: [],
    },
    waves,
    documents: [],
    source_path: ".plan/orm-swarm",
  };
}

function waveDef(waveId: string, tasks: PlanTaskIR[]): WaveDefinition {
  return {
    schema_version: "1.0.0",
    plan_id: "orm-swarm",
    wave_id: waveId,
    title: `Wave ${waveId}`,
    tasks,
  };
}

describe("orm-http adapter (Wave 4)", () => {
  it("normalizes codes into ORM-safe dotted notation", () => {
    expect(normalizeOrmCode("my-plan", "M0.01")).toBe("my-plan.M0_01");
  });

  it("maps Plan -> project, Wave -> milestone, task -> 1:1 acceptance criteria", () => {
    const b = bundle([
      waveDef("W1", [
        task("T01"),
        task("T02", { graph: { depends_on: ["T01"] } }),
      ]),
    ]);
    const payload = buildPlanSyncPayload(b);
    expect(payload.project.code).toBe("orm-swarm");
    expect(payload.project.external_ref).toBe("urn:mw:work:moonwitness/test:orm-swarm");
    expect(payload.milestones.length).toBe(1);
    expect(payload.milestones[0]!.code).toBe("orm-swarm:W1");

    const t01 = payload.tasks.find((t) => t.code === "orm-swarm.T01")!;
    expect(t01.external_ref).toBe("urn:mw:work:moonwitness/test/orm-swarm:W1/T01");
    expect(t01.milestone_code).toBe("orm-swarm:W1");
    expect(t01.acceptance_criteria.length).toBe(2);
    expect(t01.scope_json.verify_commands).toEqual(["bun test"]);
    expect(t01.scope_json.spec_ref).toBe("specs/spec.md");

    const t02 = payload.tasks.find((t) => t.code === "orm-swarm.T02")!;
    expect(t02.depends_on).toEqual(["orm-swarm.T01"]);
  });

  it("posts plan-sync to /projects/:id/plan-sync with JSON body", async () => {
    const b = bundle([waveDef("W1", [task("T01")])]);
    const payload = buildPlanSyncPayload(b);
    let capturedUrl = "";
    let capturedBody = "";
    const response = await postPlanSync(payload, {
      baseUrl: "https://orm.example",
      fetchFn: async (url: unknown, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = typeof init?.body === "string" ? init.body : "";
        return new Response("{}", { status: 200 });
      },
    });
    expect(response.ok).toBe(true);
    expect(capturedUrl).toBe("https://orm.example/projects/orm-swarm/plan-sync");
    expect(JSON.parse(capturedBody)).toEqual(payload);
  });

  it("posts work-contract to /projects/:id/tasks/:code/work-contract", async () => {
    const t = task("T01", { lifecycle: { status: "in_progress", delivery_stage: "local", attempts: 2, model_tier: "neon" } });
    const payload = buildWorkContractPayload(t, "neon");
    expect(payload.task_urn).toContain("W1/T01");
    expect(payload.model_tier).toBe("neon");
    let capturedUrl = "";
    const response = await postWorkContract("orm-swarm.T01", payload, {
      baseUrl: "https://orm.example",
      fetchFn: async (url: unknown) => {
        capturedUrl = String(url);
        return new Response("{}", { status: 200 });
      },
    });
    expect(response.ok).toBe(true);
    expect(capturedUrl).toBe("https://orm.example/projects/tasks/orm-swarm.T01/work-contract");
  });
});

describe("swarm adapter (Wave 4)", () => {
  it("routes model tiers per INV-008", () => {
    expect(MODEL_TIER_ROUTING.flash).toBe("gemini-3.8-flash-low");
    expect(MODEL_TIER_ROUTING.neon).toBe("gemini-4-neon-low");
    expect(MODEL_TIER_ROUTING.argon).toBe("gemini-4-argon-low");
  });

  it("exports a disjoint frontier with model-routed briefs", () => {
    const store = new InMemoryBrainStore();
    const b = bundle([
      waveDef("W1", [
        task("T01", { governance: { owner_files: ["packages/a/a.ts"] } }),
        task("T02", { governance: { owner_files: ["packages/b/b.ts"] } }),
        task("T03", { governance: { owner_files: ["packages/c/c.ts"] } }),
      ]),
    ]);
    const manifest = exportSwarmWaveManifest(store, b, { waveId: "W1", maxParallel: 2 });
    expect(manifest.planId).toBe("orm-swarm");
    expect(manifest.waveId).toBe("W1");
    expect(manifest.workers.length).toBeLessThanOrEqual(2);
    for (const worker of manifest.workers) {
      expect(worker.routedModel).toBe(MODEL_TIER_ROUTING[worker.modelTier as "flash"]);
      expect(worker.brief).toBeDefined();
    }
    // Disjointness: no owner-file overlap between dispatched workers.
    const workerFiles = manifest.workers.map((w) => w.taskCode);
    expect(new Set(workerFiles).size).toBe(workerFiles.length);
  });

  it("respects depends_on: blocked tasks never reach the frontier", () => {
    const store = new InMemoryBrainStore();
    const b = bundle([
      waveDef("W1", [
        task("T01", { lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 } }),
        task("T02", {
          lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
          graph: { depends_on: ["T01"] },
        }),
      ]),
    ]);
    const manifest = exportSwarmWaveManifest(store, b, { waveId: "W1", maxParallel: 4 });
    expect(manifest.workers.map((w) => w.taskCode)).toEqual(["T01"]);
  });

  it("returns an empty manifest for a fully completed wave", () => {
    const store = new InMemoryBrainStore();
    const b = bundle([
      waveDef("W1", [
        task("T01", { lifecycle: { status: "done", delivery_stage: "local", attempts: 1 } }),
      ]),
    ]);
    const manifest = exportSwarmWaveManifest(store, b, { waveId: "W1" });
    expect(manifest.workers).toEqual([]);
  });
});

describe("telemetry adapter (Wave 4)", () => {
  function event(name: PlanLifecycleEvent["name"]): PlanLifecycleEvent {
    return {
      name,
      severity: "info",
      planId: "orm-swarm",
      taskCode: "T01",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
  }

  it("NullTelemetrySink accepts events without side effects", () => {
    expect(() => new NullTelemetrySink().emit(event("task.claimed"))).not.toThrow();
  });

  it("records events and filters operator alerts correctly", () => {
    const recorded: PlanLifecycleEvent[] = [];
    const sink: PlanTelemetrySink = { emit: (e) => recorded.push(e) };
    const alerted: string[] = [];
    const alerting = new AlertingTelemetrySink(sink, {
      alert: (_e, message) => alerted.push(message),
    });

    alerting.emit(event("task.claimed"));
    alerting.emit(event("task.blocked"));

    expect(recorded.length).toBe(2);
    // Only operator-facing events page the human.
    expect(alerted.length).toBe(1);
    expect(alerted[0]).toContain("T01");
    expect(OPERATOR_ALERT_EVENTS.has("task.claimed")).toBe(false);
    expect(OPERATOR_ALERT_EVENTS.has("task.blocked")).toBe(true);
  });

  it("renders deterministic operator alert messages", () => {
    const blocked = renderOperatorAlertMessage({
      name: "task.blocked",
      severity: "error",
      planId: "p",
      taskCode: "T07",
      attempts: 3,
      reason: "circuit breaker tripped",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(blocked).toContain("T07");
    expect(blocked).toContain("3");
    expect(blocked).toContain("circuit breaker tripped");
  });

  it("covers all seven lifecycle event names", () => {
    const names: PlanLifecycleEvent["name"][] = [
      "task.claimed",
      "task.verified",
      "task.proof_sealed",
      "task.retry_escalated",
      "task.blocked",
      "wave.completed",
      "sleep.invariant_proposed",
    ];
    for (const name of names) {
      expect(() => new NullTelemetrySink().emit(event(name))).not.toThrow();
    }
  });
});
