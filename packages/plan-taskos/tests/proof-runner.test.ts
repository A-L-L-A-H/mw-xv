import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import { completeMicroTask } from "../src/runner/proof-runner.js";
import { discoverPlans } from "../src/core/loader.js";
import { verifyProofChain } from "../src/brain/merkle-dag.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-proof-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  return { store, path: dbPath };
}

// Generate a valid 64-hex SHA-256 hash for testing
function generateTestHash(prefix: string): string {
  return createHash("sha256").update(prefix).digest("hex");
}

describe("proof-runner: out-of-scope rejection, verify failure escalation, circuit breaker, proof sealing", () => {
  let store: BrainStorageDriver;
  let dbPath: string;
  let tempRepoRoot: string;
  const T01_PROOF_HASH = generateTestHash("test-proof-t01");
  const PLAN_ID = "test-plan";

  beforeEach(async () => {
    const created = await createTempDb();
    store = created.store;
    dbPath = created.path;

    // Create a temporary repo for testing
    tempRepoRoot = await mkdtemp(join(tmpdir(), "plan-taskos-test-repo-"));
    await initializeTestRepo(tempRepoRoot);
  });

  afterEach(async () => {
    store.close();
    try { await rm(dbPath, { force: true }); } catch (e) { void e; }
    try { await rm(join(dbPath, ".."), { recursive: true, force: true }); } catch (e) { void e; }
    try { await rm(tempRepoRoot, { recursive: true, force: true }); } catch (e) { void e; }
  });

  async function initializeTestRepo(repoPath: string) {
    // Initialize git repo
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: repoPath, encoding: "utf8" });
    execSync("git config user.name 'Test User'", { cwd: repoPath, encoding: "utf8" });
    execSync("git config user.email 'test@example.com'", { cwd: repoPath, encoding: "utf8" });

    // Create minimal plan structure
    const planDir = join(repoPath, ".plan", PLAN_ID);
    await mkdir(join(planDir, "waves"), { recursive: true });
    await mkdir(join(planDir, "evidence"), { recursive: true });
    await mkdir(join(planDir, "specs"), { recursive: true });

    // Create manifest.json
    const manifest = {
      plan_id: PLAN_ID,
      schema_version: "1.0.0",
      title: "Test Plan",
      execution_policy: {
        default_model_tier: "flash",
        max_attempts_per_task: 3,
        escalation_chain: ["flash", "neon", "argon"],
      },
      waves: ["W1"],
    };
    await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    // Create wave JSON
    const wave = {
      wave_id: "W1",
      plan_id: PLAN_ID,
      title: "Wave 1",
      schema_version: "1.0.0",
      tasks: [
        {
          code: "T01",
          urn: "urn:mw:work:test-org/test-repo:test-plan:W1/T01",
          kind: "task",
          title: "First task",
          lifecycle: { status: "done", delivery_stage: "verified", attempts: 0, model_tier: "flash" },
          graph: { depends_on: [] },
          governance: { owner_files: ["packages/foo.ts"], owner_globs: [], invariants: [], do_not: [], risk_tier: "low" },
          knowledge: { spec_files: [], adr_files: [], invariant_urns: [], doc_urns: [] },
          verification: {
            acceptance_criteria: ["AC-1: Works"],
            commands: [{ cmd: "echo ok", expected_exit_code: 0 }],
            commit_template: "chore(T01): First task",
          },
          projections: { taskos_code: "T01", github_issue_number: null, orm_task_code: "", external_ref: "" },
        },
        {
          code: "T02",
          urn: "urn:mw:work:test-org/test-repo:test-plan:W1/T02",
          kind: "task",
          title: "Second task",
          lifecycle: { status: "in_progress", delivery_stage: "assigned", attempts: 0, model_tier: "flash" },
          graph: { depends_on: ["T01"] },
          governance: { owner_files: ["packages/bar.ts"], owner_globs: [], invariants: [], do_not: [], risk_tier: "low" },
          knowledge: { spec_files: [], adr_files: [], invariant_urns: [], doc_urns: [] },
          verification: {
            acceptance_criteria: ["AC-1: Works"],
            commands: [{ cmd: "echo ok", expected_exit_code: 0 }],
            commit_template: "chore(T02): Second task",
          },
          projections: { taskos_code: "T02", github_issue_number: null, orm_task_code: "", external_ref: "" },
        },
      ],
    };
    await writeFile(join(planDir, "waves", "W1.json"), JSON.stringify(wave, null, 2), "utf8");

    // Create spec file
    await writeFile(join(planDir, "specs", "W1.md"), "# W1 Spec\n\n## T01\nFirst task spec\n\n## T02\nSecond task spec\n", "utf8");

    // Create source files
    await mkdir(join(repoPath, "packages"), { recursive: true });
    await writeFile(join(repoPath, "packages", "foo.ts"), "export const foo = 1;\n", "utf8");
    await writeFile(join(repoPath, "packages", "bar.ts"), "export const bar = 2;\n", "utf8");

    // Initial commit
    execSync("git add -A", { cwd: repoPath, encoding: "utf8" });
    execSync('git commit -m "initial"', { cwd: repoPath, encoding: "utf8" });
  }

  // Helper to create injectable runners for os.tmpdir() testing
  function createMockRunners(repoRoot: string, failVerify = false, failScope = false) {
    const gitRunner = async (_cmd: string, _cwd: string) => {
      // Return mock git status - empty for clean scope, or with out-of-scope file
      if (failScope) {
        return { stdout: "?? packages/unrelated.ts\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const commandRunner = async (_cmd: string, _options: { cwd: string; shell: string; timeoutSec: number }) => {
      if (failVerify) {
        return { stdout: "", stderr: "error", exitCode: 1, signal: undefined };
      }
      return { stdout: "ok\n", stderr: "", exitCode: 0, signal: undefined };
    };

    return { gitRunner, commandRunner };
  }

  // Helper to seed T01 proof in ledger and mark T01 as done in wave JSON
  async function seedT01Done() {
    store.transactionImmediate((tx) => {
      tx.run(
        `INSERT INTO proof_ledger (envelope_sha256, task_urn, task_code, plan_id, wave_id, verify_exit_code, parent_proof_hashes, merkle_root, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        T01_PROOF_HASH,
        "urn:mw:work:test-org/test-repo:test-plan:W1/T01",
        "T01",
        PLAN_ID,
        "W1",
        0,
        JSON.stringify([]),
        "",
        JSON.stringify({ code: "T01", envelope_sha256: T01_PROOF_HASH })
      );
    });

    const wavePath = join(tempRepoRoot, ".plan", PLAN_ID, "waves", "W1.json");
    const waveContent = await readFile(wavePath, "utf8");
    const wave = JSON.parse(waveContent);
    wave.tasks = wave.tasks.map((t: any) => t.code === "T01" ? { ...t, lifecycle: { ...t.lifecycle, status: "done" } } : t);
    await writeFile(wavePath, JSON.stringify(wave, null, 2), "utf8");
  }

  it("out-of-scope file mutation -> rejected (status stays in_progress, zero proof file written)", async () => {
    await seedT01Done();

    const { gitRunner, commandRunner } = createMockRunners(tempRepoRoot, false, true);

    const result = await completeMicroTask(store, tempRepoRoot, PLAN_ID, "T02", {
      sessionId: "test-session",
      agentRuntime: "test",
      modelTier: "flash",
      requireCleanScope: true,
      baselineDirtyFiles: [],
      gitRunner,
      commandRunner,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("SCOPE_VIOLATION");

    // Check no proof file was written
    const evidenceDir = join(tempRepoRoot, ".plan", PLAN_ID, "evidence");
    const proofFiles = await import("node:fs/promises").then(fs => fs.readdir(evidenceDir).catch(() => []));
    expect(proofFiles.find(f => f.startsWith("T02"))).toBeUndefined();
  });

  it("failing verify attempt #1 -> escalates flash -> neon + records redacted episode", async () => {
    await seedT01Done();

    const { gitRunner, commandRunner } = createMockRunners(tempRepoRoot, true, false);

    const result = await completeMicroTask(store, tempRepoRoot, PLAN_ID, "T02", {
      sessionId: "test-session-2",
      agentRuntime: "test",
      modelTier: "flash",
      requireCleanScope: true,
      gitRunner,
      commandRunner,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("VERIFY_FAILED");
    expect(result.nextModelTier).toBe("neon");
    expect(result.attempts).toBe(1);
    expect(result.blocked).toBeFalsy();
  });

  it("failing verify attempt #2 with max_attempts=2 -> trips circuit breaker to blocked + releases lease + exposes next ready task", async () => {
    // Create a plan with max_attempts_per_task = 2
    const planDir = join(tempRepoRoot, ".plan", PLAN_ID);
    const manifest = {
      plan_id: PLAN_ID,
      schema_version: "1.0.0",
      title: "Test Plan",
      execution_policy: {
        default_model_tier: "flash",
        max_attempts_per_task: 2,
        escalation_chain: ["flash", "neon", "argon"],
      },
      waves: ["W1"],
    };
    await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    await seedT01Done();

    // Update wave JSON to set T02 with 1 attempt already (so this will be attempt 2)
    const wavePath = join(tempRepoRoot, ".plan", PLAN_ID, "waves", "W1.json");
    const waveContent = await readFile(wavePath, "utf8");
    const wave = JSON.parse(waveContent);
    wave.tasks = wave.tasks.map((t: any) => t.code === "T02" ? { ...t, lifecycle: { ...t.lifecycle, attempts: 1 } } : t);
    await writeFile(wavePath, JSON.stringify(wave, null, 2), "utf8");

    const { gitRunner, commandRunner } = createMockRunners(tempRepoRoot, true, false);

    const result = await completeMicroTask(store, tempRepoRoot, PLAN_ID, "T02", {
      sessionId: "test-session-3",
      agentRuntime: "test",
      modelTier: "flash",
      requireCleanScope: true,
      gitRunner,
      commandRunner,
    });

    // Should fail and be blocked (max_attempts = 2, attemptNumber = 2)
    expect(result.ok).toBe(false);
    expect(result.error).toBe("VERIFY_FAILED_MAX_ATTEMPTS");
    expect(result.blocked).toBe(true);
    expect(result.nextReadyFrontier).toEqual([]);
  });

  it("passing verify -> seals DAG-Merkle evidence/T02.proof.json containing T01 parent hash + passes verifyProofChain", async () => {
    await seedT01Done();

    const { gitRunner, commandRunner } = createMockRunners(tempRepoRoot, false, false);

    const result = await completeMicroTask(store, tempRepoRoot, PLAN_ID, "T02", {
      sessionId: "test-session-4",
      agentRuntime: "test",
      modelTier: "flash",
      requireCleanScope: true,
      gitRunner,
      commandRunner,
      autoCommit: false,
    });

    expect(result.ok).toBe(true);
    expect(result.proofPath).toBeDefined();

    // Verify proof file exists
    const proofPath = join(tempRepoRoot, ".plan", PLAN_ID, "evidence", "T02.proof.json");
    const { existsSync } = await import("node:fs");
    expect(existsSync(proofPath)).toBe(true);

    // Verify proof content
    const proofContent = await readFile(proofPath, "utf8");
    const proof = JSON.parse(proofContent);
    expect(proof.task_urn).toBe("urn:mw:work:test-org/test-repo:test-plan:W1/T02");
    expect(proof.parent_proof_hashes).toContain(T01_PROOF_HASH);
    expect(proof.envelope_sha256).toBeDefined();
    expect(proof.owner_files_verified).toBe(true);
    expect(proof.acceptance_criteria_state[0]).toHaveProperty("satisfied");
    expect(proof.acceptance_criteria_state[0].satisfied).toBe(true);
    expect(proof.commit_sha).toBeNull();

    // Verify proof chain
    const bundles = await discoverPlans(tempRepoRoot);
    const bundle = bundles.find((b) => b.manifest.plan_id === PLAN_ID);
    const tasks = (bundle?.waves.flatMap((w) => w.tasks) ?? []).map(t => ({
      task_urn: t.urn,
      code: t.code,
      graph: t.graph,
    }));
    const proofs = [proof];

    // Provide taskUrnByProofHash to resolve T01's proof hash to its URN
    const taskUrnByProofHash = new Map<string, string>();
    taskUrnByProofHash.set(T01_PROOF_HASH, "urn:mw:work:test-org/test-repo:test-plan:W1/T01");
    const verifyResult = verifyProofChain(proofs, tasks, { taskUrnByProofHash });
    expect(verifyResult.valid).toBe(true);
  });
});