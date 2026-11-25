/**
 * T30b — Wave 4 adapter tests: docs impact + GitHub split-authority adapter.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeDocsImpact,
  renderSecondBrainIndex,
} from "../src/adapters/docs.adapter.js";
import {
  planGitHubOperations,
  applyGitHubOperations,
  canCloseIssue,
  parseGitHubIssueToIntakeDraft,
  splitManagedBlock,
  computeManagedContentHash,
  MANAGED_BEGIN,
  MANAGED_END,
  MAX_APPLY_BATCH,
} from "../src/adapters/github.adapter.js";
import type { LoadedPlanBundle, PlanTaskIR, WaveDefinition } from "../src/core/types.js";
import type { GitHubIssue as AdapterGitHubIssue } from "../src/adapters/github.adapter.js";

function task(code: string, ownerFiles: string[], dependsOn: string[] = [], title?: string): PlanTaskIR {
  return {
    urn: `urn:mw:work:moonwitness/test/docs-github:W1/${code}`,
    code,
    kind: "task",
    title: title ?? `task ${code}`,
    lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
    governance: { owner_files: ownerFiles },
    graph: { depends_on: dependsOn },
    knowledge: {},
    verification: { commands: [{ cmd: "echo ok" }], acceptance_criteria: ["ac1"] },
    projections: {},
  } as PlanTaskIR;
}

function bundle(waves: WaveDefinition[]): LoadedPlanBundle {
  return {
    format: "plan-taskos/v1",
    manifest: {
      schema_version: "1.0.0",
      plan_id: "docs-github",
      title: "Docs GitHub Test Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: ".plan/docs-github/ADR-000.md",
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
        wave_file: `.plan/docs-github/wave-${i + 1}.md`,
        depends_on: [],
      })),
      documents: [],
    },
    waves,
    documents: [],
    source_path: ".plan/docs-github",
  };
}

function waveDef(tasks: PlanTaskIR[]): WaveDefinition {
  return {
    schema_version: "1.0.0",
    plan_id: "docs-github",
    wave_id: "W1",
    title: "Wave W1",
    tasks,
  };
}

function issue(issueNumber: number, body: string, state: "open" | "closed" = "open"): AdapterGitHubIssue {
  return { issueNumber, title: `Issue #${issueNumber}`, body, labels: [], state };
}

describe("docs adapter (Wave 4)", () => {
  it("detects reference_regen for api routes / orm models / root package.json", () => {
    const report = analyzeDocsImpact([
      task("T01", ["apps/api/src/routes/plans.ts"]),
      task("T02", ["packages/orm-project/src/models/index.ts"]),
    ]);
    expect(report.docsImpact).toBe("reference_regen");
    expect(report.tasksNeedingReferenceRegen).toEqual(["T01", "T02"]);
    expect(report.commands).toContain("bun run docs:generate");
    expect(report.commands).toContain("bun run architecture:generate");
  });

  it("detects links_check for docs/ and README.md", () => {
    const report = analyzeDocsImpact([task("T03", ["docs/guide.md"]), task("T04", ["README.md"])]);
    expect(report.docsImpact).toBe("links_check");
    expect(report.tasksNeedingLinksCheck).toEqual(["T03", "T04"]);
    expect(report.commands).toContain("bun run docs:links");
  });

  it("reports none for untouched doc surfaces", () => {
    const report = analyzeDocsImpact([task("T05", ["packages/plan-taskos/src/core/urn.ts"])]);
    expect(report.docsImpact).toBe("none");
    expect(report.commands).toEqual([]);
  });

  it("renders a second-brain index with a valid Mermaid DAG and no broken links", () => {
    const b = bundle([
      waveDef([
        task("T01", ["a.ts"]),
        task("T02", ["b.ts"], ["T01"]),
        task("T03", ["c.ts"], ["T02"]),
      ]),
    ]);
    const markdown = renderSecondBrainIndex(
      b,
      [{ code: "T01", evidenceRef: "evidence/T01.proof.json", envelopeSha256: "a".repeat(64) }],
      [{ summary: "always verify scope before seal", failurePattern: "scope-leak" }]
    );
    expect(markdown).toContain("flowchart TD");
    expect(markdown).toContain("n_T01 --> n_T02");
    expect(markdown).toContain("n_T02 --> n_T03");
    expect(markdown).toContain('n_T01["T01"]');
    // All repo paths are backticked, never bare relative markdown links.
    expect(markdown).not.toMatch(/\]\(\.?\/?packages\//);
  });
});

describe("github adapter (Wave 4)", () => {
  const context = { repoId: "moonwitness/test", foldMode: "wave" as const };

  it("creates issues for fresh remote state", () => {
    const b = bundle([waveDef([task("T01", ["a.ts"])])]);
    const ops = planGitHubOperations({ bundle: b, context, remoteIssues: [] });
    expect(ops.length).toBe(1);
    expect(ops[0]!.operation).toBe("create");
    expect(ops[0]!.body).toContain(MANAGED_BEGIN);
    expect(ops[0]!.body).toContain(MANAGED_END);
  });

  it("is idempotent: identical remote state yields noop", () => {
    const b = bundle([waveDef([task("T01", ["a.ts"])])]);
    const first = planGitHubOperations({ bundle: b, context, remoteIssues: [] });
    const renderedBody = first[0]!.body!;
    const remote = [issue(10, renderedBody)];
    const second = planGitHubOperations({ bundle: b, context, remoteIssues: remote });
    expect(second[0]!.operation).toBe("noop");
  });

  it("preserves human maintainer notes across updates", () => {
    const b = bundle([waveDef([task("T01", ["a.ts"])])]);
    const first = planGitHubOperations({ bundle: b, context, remoteIssues: [] });
    const managedBody = first[0]!.body!;
    const remoteBody = `${managedBody}\n\n## Catatan maintainer\n\nkeep this note`;
    // Change the task title so the managed hash drifts -> update path.
    const changed = bundle([waveDef([task("T01-renamed", ["a.ts"])])]);
    const ops = planGitHubOperations({
      bundle: changed,
      context,
      remoteIssues: [issue(10, remoteBody)],
    });
    expect(ops[0]!.operation).toBe("update");
    expect(ops[0]!.body).toContain("## Catatan maintainer");
    expect(ops[0]!.body).toContain("keep this note");
  });

  it("flags duplicate managed markers as conflict", () => {
    const b = bundle([waveDef([task("T01", ["a.ts"])])]);
    const first = planGitHubOperations({ bundle: b, context, remoteIssues: [] });
    const managedBody = first[0]!.body!;
    const ops = planGitHubOperations({
      bundle: b,
      context,
      remoteIssues: [issue(10, managedBody), issue(11, managedBody)],
    });
    expect(ops[0]!.operation).toBe("conflict");
  });

  it("flags manual close with drifted content as needs-triage, never reopens", () => {
    const b = bundle([waveDef([task("T01", ["a.ts"])])]);
    const first = planGitHubOperations({ bundle: b, context, remoteIssues: [] });
    const staleBody = first[0]!.body!;
    const changed = bundle([waveDef([task("T01", ["a.ts"], [], "T01-renamed")])]);
    const ops = planGitHubOperations({
      bundle: changed,
      context,
      remoteIssues: [issue(10, staleBody, "closed")],
    });
    expect(ops[0]!.operation).toBe("needs-triage");
  });

  it("caps apply batch at MAX_APPLY_BATCH (5)", async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task(`T${String(i + 1).padStart(2, "0")}`, [`f${i}.ts`]));
    const b = bundle([waveDef(tasks)]);
    const taskFoldContext = { repoId: "moonwitness/test", foldMode: "task" as const };
    const ops = planGitHubOperations({ bundle: b, context: taskFoldContext, remoteIssues: [] });
    expect(ops.length).toBe(8);
    expect(MAX_APPLY_BATCH).toBe(5);
    const created: string[] = [];
    const transport = {
      async listIssues() {
        return [];
      },
      async getIssue() {
        return { issueNumber: null };
      },
      async createIssue(input: { title: string }) {
        created.push(input.title);
        return issue(created.length, "");
      },
      async updateIssue() {
        throw new Error("should not update");
      },
      async addComment() {
        /* noop */
      },
    };
    const report = await applyGitHubOperations(ops, transport);
    expect(created.length).toBe(5);
    expect(report.applied).toBe(5);
    expect(report.skipped).toBe(3);
  });

  it("close gate requires BOTH done status and satisfying delivery stage", () => {
    const doneTask = task("T01", ["a.ts"]);
    (doneTask.lifecycle as { status: string }).status = "done";
    expect(canCloseIssue(doneTask).closeable).toBe(false); // delivery_stage: local

    const releasable = task("T02", ["a.ts"]);
    (releasable.lifecycle as { status: string }).status = "done";
    (releasable.lifecycle as { delivery_stage: string }).delivery_stage = "released";
    expect(canCloseIssue(releasable).closeable).toBe(true);

    expect(canCloseIssue(task("T03", ["a.ts"])).closeable).toBe(false);
  });

  it("intake parses human issue into clean backlog draft", () => {
    const draft = parseGitHubIssueToIntakeDraft(
      issue(42, "please add dark mode to the board"),
      "my-plan",
      { org: "moonwitness", name: "test" }
    );
    expect(draft.status).toBe("backlog");
    expect(draft.code).toBe("GH-42");
    expect(draft.title).toBe("Issue #42");
    expect(draft.githubIssueNumber).toBe(42);
    expect(draft.urn).toContain("urn:mw:work:moonwitness/test:my-plan:intake/");
  });

  it("splitManagedBlock separates managed content from human text verbatim", () => {
    const body = `${MANAGED_BEGIN}\nmanaged\n${MANAGED_END}\n\nhuman note`;
    const { managed, human } = splitManagedBlock(body);
    expect(managed).toContain("managed");
    expect(human).toBe("human note");
  });

  it("content hash normalizes CRLF and label order for no-op detection", () => {
    const base = { body: `${MANAGED_BEGIN}\nline\n${MANAGED_END}`, labels: ["b", "a"] };
    const same = { body: base.body.replace(/\n/g, "\r\n"), labels: ["a", "b"] };
    expect(computeManagedContentHash(base)).toBe(computeManagedContentHash(same));
    const different = { body: `${MANAGED_BEGIN}\nline2\n${MANAGED_END}`, labels: ["a", "b"] };
    expect(computeManagedContentHash(base)).not.toBe(computeManagedContentHash(different));
  });
});
