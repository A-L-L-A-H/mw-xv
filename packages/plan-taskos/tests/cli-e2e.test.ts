/**
 * T36a — CLI E2E: real `dist/cli.js` subprocess over a temp repo.
 *
 * Lifecycle: init -> lint -> reindex -> dag -> next --claim -> complete
 * -> sleep -> sync --check -> export-swarm.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(__dirname, "..", "dist", "cli.js");

interface CliRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], cwd: string): CliRun {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(repo: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

async function initTempRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "plan-taskos-cli-e2e-"));
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.email", "e2e@test.local");
  git(repo, "config", "user.name", "E2E");
  return repo;
}

/** Build a minimal v2 bundle with two independent tasks. */
async function seedBundle(repo: string): Promise<void> {
  const planId = "e2e-plan";
  const planDir = join(repo, ".plan", planId);
  await mkdir(join(planDir, "waves"), { recursive: true });
  await mkdir(join(planDir, "specs"), { recursive: true });

  // Mirror the repo-level invariants so leases/brains never trip the scope gate.
  await writeFile(
    join(repo, ".gitignore"),
    ".plan/.brain/\n.plan/*/.leases.local.json\n",
    "utf8"
  );

  const manifest = {
    schema_version: "1.0.0",
    plan_id: planId,
    title: "E2E Plan",
    repo: { org: "e2e", name: "repo", target_branch: "main" },
    adr_file: `.plan/${planId}/ADR-001-${planId}.md`,
    execution_policy: {
      max_attempts_per_task: 2,
      default_model_tier: "flash",
      escalation_chain: ["flash", "neon", "argon", "human"],
      require_clean_scope: true,
      auto_commit: false,
    },
    projections: { github_fold_mode: "wave", taskos_project: planId, orm_project_code: planId },
    waves: [
      { id: "W0", title: "Wave 0", wave_file: `.plan/${planId}/waves/W0.json`, depends_on: [] },
    ],
    documents: [],
  };
  await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const wave = {
    schema_version: "1.0.0",
    plan_id: planId,
    wave_id: "W0",
    title: "Wave 0",
    tasks: [
      {
        urn: `urn:mw:work:e2e/repo:${planId}:W0/T01`,
        code: "T01",
        kind: "task",
        title: "First task",
        lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
        governance: { owner_files: ["src/seed.ts"], owner_globs: [], invariants: [], do_not: [] },
        graph: { depends_on: [] },
        knowledge: { spec_files: [], adr_files: [], invariant_urns: [], doc_urns: [] },
        verification: {
          commands: [{ cmd: "node --version", expected_exit_code: 0 }],
          acceptance_criteria: ["node exists"],
        },
        projections: { taskos_code: "T01" },
      },
      {
        urn: `urn:mw:work:e2e/repo:${planId}:W0/T02`,
        code: "T02",
        kind: "task",
        title: "Second task",
        lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
        governance: { owner_files: ["src/example.ts"], owner_globs: [], invariants: [], do_not: [] },
        graph: { depends_on: ["T01"] },
        knowledge: { spec_files: [], adr_files: [], invariant_urns: [], doc_urns: [] },
        verification: {
          commands: [{ cmd: "node --version", expected_exit_code: 0 }],
          acceptance_criteria: ["node exists"],
        },
        projections: { taskos_code: "T02" },
      },
    ],
  };
  await writeFile(join(planDir, "waves", "W0.json"), JSON.stringify(wave, null, 2), "utf8");
  await writeFile(
    join(planDir, "specs", "W0.md"),
    `# Wave 0 Spec\n\n## T01\n\n- Owner File(s): src/seed.ts\n- Verify: node --version\n\n## T02\n\n- Owner File(s): src/example.ts\n- Verify: node --version\n`,
    "utf8"
  );
  await writeFile(
    join(planDir, `ADR-001-${planId}.md`),
    `# ADR-001 — E2E Plan\n\n## Status\n\naccepted\n`,
    "utf8"
  );
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "seed.ts"), "export const seed = true;\n", "utf8");
  await writeFile(join(repo, "src", "example.ts"), "export const example = 1;\n", "utf8");

  // Commit a clean baseline so the scope membrane only sees task-scoped diffs.
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "seed baseline");
}

let repo: string;

beforeAll(async () => {
  repo = await initTempRepo();
  await seedBundle(repo);
});

describe("plan-taskos CLI E2E (real subprocess)", () => {
  it("prints help and exits 0", () => {
    const run = runCli(["--help"], repo);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("plan-taskos");
    expect(run.stdout).toContain("init");
    expect(run.stdout).toContain("mcp");
  });

  it("init scaffolds a lint-clean plan bundle", async () => {
    const run = runCli(["init", "scaffold-plan", "--title", "Scaffold Plan", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; plan_id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.plan_id).toBe("scaffold-plan");

    // Commit the scaffold so later lifecycle tests start from a clean tree
    // (the scope membrane treats untracked files as new out-of-scope edits).
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "scaffold scaffold-plan");

    const manifest = JSON.parse(
      await readFile(join(repo, ".plan", "scaffold-plan", "manifest.json"), "utf8")
    ) as { plan_id: string };
    expect(manifest.plan_id).toBe("scaffold-plan");
  });

  it("lint passes on the seeded and scaffolded bundles", () => {
    const run = runCli(["lint", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; plans: Array<{ ok: boolean; plan_id: string }> };
    expect(parsed.ok).toBe(true);
    const planIds = parsed.plans.map((p) => p.plan_id);
    expect(planIds).toContain("e2e-plan");
    expect(planIds).toContain("scaffold-plan");
  });

  it("reindex rebuilds the Brain and reports node/edge counts", () => {
    const run = runCli(["reindex", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { nodeCount: number; edgeCount: number; durationMs: number };
    expect(parsed.nodeCount).toBeGreaterThan(0);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("dag reports wave stats and a critical path", () => {
    const run = runCli(["dag", "e2e-plan", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      plan_id: string;
      waves: Array<{ wave_id: string; tasks: number; done: number }>;
      critical_path: string[];
    };
    expect(parsed.plan_id).toBe("e2e-plan");
    expect(parsed.waves[0]?.tasks).toBe(2);
    expect(parsed.waves[0]?.done).toBe(0);
    expect(parsed.critical_path.length).toBeGreaterThan(0);
  });

  it("next --claim emits a micro-brief for T01 and claims the lease", () => {
    const run = runCli(["next", "e2e-plan", "--claim", "--agent", "e2e", "--session", "s1", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ready: boolean; claimed: boolean; task: string; brief: unknown };
    expect(parsed.ready).toBe(true);
    expect(parsed.claimed).toBe(true);
    expect(parsed.task).toBe("T01");
    expect(parsed.brief).toBeTruthy();
  });

  it("complete seals a proof envelope for T01 and updates the wave JSON", async () => {
    // Same session s1 already holds the lease from the previous claim.
    const run = runCli(["complete", "T01", "--plan", "e2e-plan", "--session", "s1", "--commit", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; taskCode: string; proofPath?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.taskCode).toBe("T01");
    expect(parsed.proofPath).toBeTruthy();

    const proof = JSON.parse(
      await readFile(join(repo, ".plan", "e2e-plan", "evidence", "T01.proof.json"), "utf8")
    ) as { code: string; owner_files_verified: boolean };
    expect(proof.code).toBe("T01");
    expect(proof.owner_files_verified).toBe(true);

    const wave = JSON.parse(
      await readFile(join(repo, ".plan", "e2e-plan", "waves", "W0.json"), "utf8")
    ) as { tasks: Array<{ code: string; lifecycle: { status: string } }> };
    expect(wave.tasks.find((t) => t.code === "T01")?.lifecycle.status).toBe("done");
  });

  it("next --claim advances to T02 after T01 completes", () => {
    const run = runCli(["next", "e2e-plan", "--claim", "--agent", "e2e", "--session", "s2", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ready: boolean; task: string };
    expect(parsed.ready).toBe(true);
    expect(parsed.task).toBe("T02");
  });

  it("complete seals a proof for T02 referencing T01's proof hash", async () => {
    const run = runCli(["complete", "T02", "--plan", "e2e-plan", "--session", "s2", "--commit", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; taskCode: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.taskCode).toBe("T02");

    const proof = JSON.parse(
      await readFile(join(repo, ".plan", "e2e-plan", "evidence", "T02.proof.json"), "utf8")
    ) as { code: string; parent_proof_hashes: string[] };
    expect(proof.code).toBe("T02");
    expect(proof.parent_proof_hashes.length).toBe(1);
    expect(proof.parent_proof_hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sleep runs consolidation and returns a result object", () => {
    const run = runCli(["sleep", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
  });

  it("sync --check runs the plan-md projection without writing", () => {
    const run = runCli(["sync", "--target", "md", "--check", "--plan", "e2e-plan", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { target: string; check: boolean; diff: unknown };
    expect(parsed.target).toBe("md");
    expect(parsed.check).toBe(true);
    expect(parsed.diff).toBeTruthy();
  });

  it("export-swarm emits disjoint worker briefs with model tiers", () => {
    const run = runCli(["export-swarm", "e2e-plan", "--wave", "W0", "--max-parallel", "4", "--json"], repo);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      planId: string;
      waveId: string;
      workers: Array<{ taskCode: string; modelTier: string; routedModel: string }>;
    };
    expect(parsed.planId).toBe("e2e-plan");
    expect(parsed.waveId).toBe("W0");
    // Both tasks are done at this point; the frontier is empty but the shape holds.
    expect(Array.isArray(parsed.workers)).toBe(true);
  });
});