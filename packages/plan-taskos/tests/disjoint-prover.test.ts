import { describe, it, expect } from "vitest";
import { proveDisjointOwnership } from "../src/core/disjoint-prover.js";
import type { PlanTaskIR } from "../src/core/types.js";

function task(code: string, ownerFiles: string[], dependsOn: string[] = [], status: "todo" | "done" | "skipped" | "cancelled" = "todo"): PlanTaskIR {
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

describe("disjoint-prover (Wave 1)", () => {
  it("flags overlapping globs between concurrent tasks", () => {
    const tasks = [
      task("T01", ["packages/orm-cloud/src/**"]),
      task("T02", ["packages/orm-cloud/src/http.ts"]),
    ];
    const proof = proveDisjointOwnership(tasks);
    expect(proof.disjoint).toBe(false);
    expect(proof.conflicts.length).toBeGreaterThan(0);
    expect(proof.conflicts[0].patternA).toBe("packages/orm-cloud/src/**");
    expect(proof.conflicts[0].patternB).toBe("packages/orm-cloud/src/http.ts");
  });

  it("resolves conflict via depends_on serialization", () => {
    const tasks = [
      task("T01", ["packages/orm-cloud/src/**"]),
      task("T02", ["packages/orm-cloud/src/http.ts"], ["T01"]),
    ];
    const proof = proveDisjointOwnership(tasks);
    expect(proof.disjoint).toBe(true);
    expect(proof.conflicts).toEqual([]);
  });

  it("serializes tasks sharing mutex_resources token", () => {
    const tasks = [
      task("T01", ["packages/orm-cloud/src/**"], [], "todo"),
      task("T02", ["packages/orm-cloud/src/**"], [], "todo"),
    ];
    (tasks[0] as unknown as { projections?: { mutex_resources?: string[] } }).projections = {
      mutex_resources: ["orm-cloud-lock"],
    };
    (tasks[1] as unknown as { projections?: { mutex_resources?: string[] } }).projections = {
      mutex_resources: ["orm-cloud-lock"],
    };
    const proof = proveDisjointOwnership(tasks);
    expect(proof.disjoint).toBe(true);
  });

  it("skips terminal tasks", () => {
    const tasks = [
      task("T01", ["packages/orm-cloud/src/**"], [], "done"),
      task("T02", ["packages/orm-cloud/src/http.ts"], [], "done"),
    ];
    const proof = proveDisjointOwnership(tasks);
    expect(proof.disjoint).toBe(true);
    expect(proof.checkedPairs).toBe(0);
  });

  it("multi-wave parallel safety: disjoint tasks pass", () => {
    const tasks = [
      task("W1.T01", ["apps/api/src/routes.ts"]),
      task("W2.T01", ["apps/board/src/components.ts"]),
      task("W3.T01", ["packages/types/src/constants.ts"]),
    ];
    const proof = proveDisjointOwnership(tasks);
    expect(proof.disjoint).toBe(true);
    expect(proof.checkedPairs).toBe(3);
  });

  it("proof is deterministic across runs", () => {
    const tasks = [
      task("T01", ["packages/a/src/**"]),
      task("T02", ["packages/a/src/index.ts"]),
    ];
    const p1 = proveDisjointOwnership(tasks);
    const p2 = proveDisjointOwnership(tasks);
    expect(p1.proofSha256).toBe(p2.proofSha256);
  });
});
