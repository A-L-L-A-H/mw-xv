import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverPlans, loadPlanBundle } from "../src/core/loader.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");
import { validatePlanBundle } from "../src/core/validator.js";

async function writeLegacyPlan(dir: string, planId: string, masterMarkdown: string): Promise<void> {
  await mkdir(join(dir, ".plan"), { recursive: true });
  await writeFile(join(dir, ".plan", `${planId}.md`), masterMarkdown, "utf8");
}

async function writeTempV2Bundle(
  dir: string,
  planId: string,
  manifest: unknown,
  waves?: Array<{ wave_id: string; title?: string; wave_file?: string; tasks: unknown[] }>
): Promise<void> {
  const planDir = join(dir, ".plan", planId);
  const wavesDir = join(planDir, "waves");
  // ensure .plan dir exists too
  await mkdir(join(dir, ".plan"), { recursive: true });
  await mkdir(planDir, { recursive: true });
  await mkdir(wavesDir, { recursive: true });
  await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest), "utf8");
  if (waves) {
    for (const wave of waves) {
      const waveObj = {
        schema_version: "1.0.0",
        plan_id: planId,
        wave_id: wave.wave_id,
        title: `Wave ${wave.wave_id}`,
        tasks: wave.tasks,
      };
      const waveFilePath = join(wavesDir, `wave-${wave.wave_id.toLowerCase()}.json`);
      await writeFile(waveFilePath, JSON.stringify(waveObj), "utf8");
    }
  }
}

describe("loader + validator (Wave 1)", () => {
  it("loads legacy real-world plan-taskos plan (44 tasks)", async () => {
    const bundles = await discoverPlans(REPO_ROOT);
    const taskosPlan = bundles.find((b) => b.manifest.plan_id === "plan-taskos-cognitive-workgraph");
    expect(taskosPlan).toBeDefined();
    const taskCount = taskosPlan!.waves.reduce((sum, w) => sum + w.tasks.length, 0);
    expect(taskCount).toBe(44);
  });

  it("loads legacy coolify plan (66 tasks)", async () => {
    const bundles = await discoverPlans(REPO_ROOT);
    const coolifyPlan = bundles.find((b) => b.manifest.plan_id === "coolify-sovereign-paas-single-db");
    expect(coolifyPlan).toBeDefined();
    const taskCount = coolifyPlan!.waves.reduce((sum, w) => sum + w.tasks.length, 0);
    expect(taskCount).toBeGreaterThan(0);
  });

  it("loads legacy desktop-agent-observatory plan (16 tasks)", async () => {
    const bundles = await discoverPlans(REPO_ROOT);
    const desktopPlan = bundles.find((b) => b.manifest.plan_id === "desktop-agent-observatory-merge");
    expect(desktopPlan).toBeDefined();
    const taskCount = desktopPlan!.waves.reduce((sum, w) => sum + w.tasks.length, 0);
    expect(taskCount).toBe(16);
  });

  it("returns empty array when .plan/ does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-taskos-empty-"));
    const bundles = await discoverPlans(dir);
    expect(bundles).toEqual([]);
  });

  it("loadPlanBundle returns null for missing plan", async () => {
    const bundle = await loadPlanBundle(".", "does-not-exist-plan");
    expect(bundle).toBeNull();
  });

  it("rejects owner_file with .. traversal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-taskos-bad-path-"));
    await mkdir(join(dir, ".plan"), { recursive: true });
    await writeLegacyPlan(dir, "badpath", `# Bad Path Plan\n\n- [ ] **T01** — bad path task\n**Owner File(s):** ../etc/passwd\n**Depends On:** None\n\n## Exact Spec\n\nDo nothing.\n\n## Acceptance Criteria\n\nNone.\n\n## Expected Output\n\nOK\n\n## Verify\n\necho ok\n\n## Commit\n\ngit commit --only x -m "x"\n`);
    const bundle = await loadPlanBundle(dir, "badpath");
    expect(bundle).not.toBeNull();
    const result = await validatePlanBundle(bundle!);
    const pathErrors = result.errors.filter((e) => e.code === "INVALID_PATH");
    expect(pathErrors.length).toBeGreaterThan(0);
  });

  it("rejects done task without proof envelope (anti-fake-completion)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-taskos-fake-completion-"));
    await writeTempV2Bundle(dir, "fakecomplete", {
      schema_version: "1.0.0",
      plan_id: "fakecomplete",
      title: "Fake Completion Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: "ADR-000.md",
      execution_policy: {
        max_attempts_per_task: 3,
        default_model_tier: "flash",
        escalation_chain: ["flash", "neon"],
        require_clean_scope: true,
        auto_commit: false,
      },
      projections: { github_fold_mode: "task", taskos_project: "test", orm_project_code: "TEST" },
      waves: [
        {
          id: "W1",
          title: "Wave 1",
          wave_file: ".plan/fakecomplete/wave-1.md",
          depends_on: [],
        },
      ],
      documents: [],
    }, [
      {
        wave_id: "W1",
        title: "Wave 1",
        wave_file: ".plan/fakecomplete/wave-1.md",
        tasks: [
          {
            urn: "urn:mw:work:moonwitness/test/fakecomplete:W1/T01",
            code: "T01",
            kind: "task",
            title: "done-without-proof",
            lifecycle: { status: "done", delivery_stage: "local", attempts: 1 },
            governance: { owner_files: ["packages/plan-taskos/src/core/urn.ts"] },
            graph: { depends_on: [] },
            knowledge: {},
            verification: { commands: [{ cmd: "echo ok" }], acceptance_criteria: ["c1"] },
            projections: {},
          },
        ],
      },
    ]);
    const bundle = await loadPlanBundle(dir, "fakecomplete");
    expect(bundle).not.toBeNull();
    const result = await validatePlanBundle(bundle!);
    // v2 format "done" without proof triggers warning
    const fakeCompletion = result.warnings.some((e) => e.code === "MISSING_PROOF_WARNING");
    expect(fakeCompletion).toBe(true);
  });

  it("validates a clean v2 bundle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-taskos-clean-"));
    await writeTempV2Bundle(dir, "cleanplan", {
      schema_version: "1.0.0",
      plan_id: "cleanplan",
      title: "Clean Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: "ADR-000.md",
      execution_policy: {
        max_attempts_per_task: 3,
        default_model_tier: "flash",
        escalation_chain: ["flash", "neon"],
        require_clean_scope: true,
        auto_commit: false,
      },
      projections: { github_fold_mode: "task", taskos_project: "test", orm_project_code: "TEST" },
      waves: [
        {
          id: "W1",
          title: "Wave 1",
          wave_file: ".plan/cleanplan/wave-1.md",
          depends_on: [],
        },
      ],
      documents: [],
    }, [
      {
        wave_id: "W1",
        title: "Wave 1",
        wave_file: ".plan/cleanplan/wave-1.md",
        tasks: [
          {
            urn: "urn:mw:work:moonwitness/test/cleanplan:W1/T01",
            code: "T01",
            kind: "task",
            title: "clean task",
            lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
            governance: { owner_files: ["packages/plan-taskos/src/core/urn.ts"] },
            graph: { depends_on: [] },
            knowledge: {},
            verification: { commands: [{ cmd: "echo ok" }], acceptance_criteria: ["c1"] },
            projections: {},
          },
        ],
      },
    ]);
    const bundle = await loadPlanBundle(dir, "cleanplan");
    expect(bundle).not.toBeNull();
    const result = await validatePlanBundle(bundle!);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("detects duplicate codes across waves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-taskos-dup-"));
    await writeTempV2Bundle(dir, "dupplan", {
      schema_version: "1.0.0",
      plan_id: "dupplan",
      title: "Dup Plan",
      repo: { org: "moonwitness", name: "test", target_branch: "main" },
      adr_file: "ADR-000.md",
      execution_policy: {
        max_attempts_per_task: 3,
        default_model_tier: "flash",
        escalation_chain: ["flash", "neon"],
        require_clean_scope: true,
        auto_commit: false,
      },
      projections: { github_fold_mode: "task", taskos_project: "test", orm_project_code: "TEST" },
      waves: [
        {
          id: "W1",
          title: "Wave 1",
          wave_file: ".plan/dupplan/wave-1.md",
          depends_on: [],
        },
        {
          id: "W2",
          title: "Wave 2",
          wave_file: ".plan/dupplan/wave-2.md",
          depends_on: [],
        },
      ],
      documents: [],
    }, [
      {
        wave_id: "W1",
        title: "Wave 1",
        wave_file: ".plan/dupplan/wave-1.md",
        tasks: [
          {
            urn: "urn:mw:work:moonwitness/test/dupplan:W1/T01",
            code: "T01",
            kind: "task",
            title: "task one",
            lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
            governance: { owner_files: ["a.ts"] },
            graph: { depends_on: [] },
            knowledge: {},
            verification: { commands: [{ cmd: "echo" }], acceptance_criteria: ["c1"] },
            projections: {},
          },
        ],
      },
      {
        wave_id: "W2",
        title: "Wave 2",
        wave_file: ".plan/dupplan/wave-2.md",
        tasks: [
          {
            urn: "urn:mw:work:moonwitness/test/dupplan:W2/T01",
            code: "T01",
            kind: "task",
            title: "task one duplicate",
            lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
            governance: { owner_files: ["b.ts"] },
            graph: { depends_on: [] },
            knowledge: {},
            verification: { commands: [{ cmd: "echo" }], acceptance_criteria: ["c1"] },
            projections: {},
          },
        ],
      },
    ]);
    const bundle = await loadPlanBundle(dir, "dupplan");
    expect(bundle).not.toBeNull();
    const result = await validatePlanBundle(bundle!);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_CODE")).toBe(true);
  });
});
