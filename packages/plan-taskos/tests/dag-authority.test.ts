import { describe, it, expect } from "vitest";
import {
  buildWorkGraphDag,
  selectDisjointFrontier,
  dagFingerprint,
} from "../src/core/dag.js";
import { reconcileTaskPlanes, FIELD_AUTHORITY_MAP, mapWorkStatusToOrm } from "../src/core/authority.js";
import type { PlanTaskIR } from "../src/core/types.js";

function task(code: string, dependsOn: string[] = [], status: "backlog" | "todo" | "in_progress" | "review" | "done" | "blocked" | "skipped" | "cancelled" = "todo", ownerFiles: string[] = []): PlanTaskIR {
  return {
    urn: `urn:mw:work:moonwitness/test/plan:W1/${code}`,
    code,
    kind: "task",
    title: `task ${code}`,
    lifecycle: { status, delivery_stage: "local", attempts: 0 },
    governance: { owner_files: ownerFiles },
    graph: { depends_on: dependsOn },
    knowledge: {},
    verification: { commands: [{ cmd: "echo" }], acceptance_criteria: ["c1"] },
    projections: {},
  } as unknown as PlanTaskIR;
}

describe("dag + authority (Wave 1)", () => {
  it("detects cycles without infinite recursion", () => {
    const tasks = [task("T01", ["T02"]), task("T02", ["T03"]), task("T03", ["T01"])];
    const dag = buildWorkGraphDag(tasks);
    expect(dag.cycles.length).toBeGreaterThan(0);
  });

  it("computes topological depth and ready/blocked states", () => {
    const tasks = [
      task("T01", [], "done"),
      task("T02", ["T01"], "todo"),
      task("T03", ["T02"], "todo"),
    ];
    const dag = buildWorkGraphDag(tasks);
    const byCode = new Map(dag.nodes.map((n) => [n.code, n]));
    expect(byCode.get("T02")!.depth).toBeGreaterThan(byCode.get("T01")!.depth);
    expect(byCode.get("T02")!.state).toBe("ready");
  });

  it("selects disjoint parallel frontier prioritizing critical path", () => {
    const tasks = [
      task("T01", [], "todo", ["apps/api/src/a.ts"]),
      task("T02", [], "todo", ["apps/api/src/b.ts"]),
      task("T03", [], "todo", ["apps/api/src/shared.ts"]),
    ];
    const dag = buildWorkGraphDag(tasks);
    const frontier = selectDisjointFrontier(dag, 2);
    expect(frontier.length).toBeLessThanOrEqual(2);
    const codes = frontier.map((n) => n.code);
    // T03 overlaps T01/T02 via shared.ts only if shared; here a.ts/b.ts/shared.ts are disjoint
    expect(codes.sort()).toEqual(["T01", "T02"].sort());
  });

  it("authority.ts rejects github_human overwriting lifecycle.status (owned by proof_runner)", () => {
    const current = task("T01", [], "todo", ["a.ts"]);
    const incoming = {
      lifecycle: { status: "done" },
      projections: { github_issue_number: 42 },
    } as unknown as PlanTaskIR;
    const result = reconcileTaskPlanes(current, incoming, "github_human");
    expect(result.needsTriage).toBe(true);
    expect(result.rejectedFields).toContain("lifecycle.status");
  });

  it("authority.ts allows proof_runner to set lifecycle.status", () => {
    const current = task("T01", [], "todo", ["a.ts"]);
    const incoming = { lifecycle: { status: "done" } } as unknown as PlanTaskIR;
    const result = reconcileTaskPlanes(current, incoming, "proof_runner");
    expect(result.needsTriage).toBe(false);
    expect(result.rejectedFields).toBeUndefined();
    expect((result.merged.lifecycle as unknown as { status: string }).status).toBe("done");
  });

  it("authority.ts zero-loop idempotency", () => {
    const current = task("T01", [], "todo", ["a.ts"]);
    const incoming = { projections: { github_issue_number: 7 } } as unknown as PlanTaskIR;
    const first = reconcileTaskPlanes(current, incoming, "github_human");
    const second = reconcileTaskPlanes(first.merged, first.merged as unknown as PlanTaskIR, "github_human");
    expect(second.noop).toBe(true);
    expect(first.planeHash).toBe(second.planeHash);
  });

  it("FIELD_AUTHORITY_MAP covers all six planes", () => {
    const planes = new Set(FIELD_AUTHORITY_MAP.map((e) => e.plane));
    expect(planes.size).toBe(6);
  });

  it("mapWorkStatusToOrm bijective mapping", () => {
    expect(mapWorkStatusToOrm("in_progress")).toBe("in_progress");
    expect(mapWorkStatusToOrm("review")).toBe("code_review");
    expect(mapWorkStatusToOrm("done")).toBe("done");
  });

  it("dagFingerprint is stable", () => {
    const tasks = [task("T01", []), task("T02", ["T01"])];
    const dag = buildWorkGraphDag(tasks);
    expect(dagFingerprint(dag)).toBe(dagFingerprint(dag));
  });
});
