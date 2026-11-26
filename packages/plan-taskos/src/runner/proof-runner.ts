/**
 * T22 — Proof-Carrying Task Runner & Bounded-Attempt Circuit Breaker.
 *
 * End-to-end state machine: verify -> scope check -> seal DAG-Merkle evidence
 * -> bounded-attempt circuit breaker -> atomic `git commit --only`.
 */

import type { BrainStorageDriver } from "../brain/storage.js";
import type { LoadedPlanBundle, PlanTaskIR, ModelTier, TaskLifecycle, VerifyCommandIR } from "../core/types.js";
import { discoverPlans } from "../core/loader.js";
import { sealProofEnvelope } from "../brain/merkle-dag.js";
import { recordEpisode } from "../brain/episodic-memory.js";
import type { GitRunner, CommandRunner } from "./scope-gate.js";
import { inspectChangedFiles, checkOwnerFileScope, executeVerifyCommands, captureBaselineDirtyFiles } from "./scope-gate.js";
import { claimTaskLease, releaseTaskLease } from "./lease-manager.js";
import { join } from "node:path";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

export interface CompleteMicroTaskOptions {
  readonly autoCommit?: boolean;
  readonly requireCleanScope?: boolean;
  readonly sessionId: string;
  readonly agentRuntime: string;
  readonly modelTier?: ModelTier;
  readonly nowIso?: string;
  readonly baselineDirtyFiles?: readonly string[];
  readonly gitRunner?: GitRunner;
  readonly commandRunner?: CommandRunner;
}

export interface CompleteMicroTaskResult {
  readonly ok: boolean;
  readonly taskCode: string;
  readonly proofPath?: string;
  readonly commitSha?: string;
  readonly error?: string;
  readonly blocked?: boolean;
  readonly nextReadyFrontier?: readonly string[];
  readonly nextModelTier?: ModelTier;
  readonly attempts?: number;
}

export interface FailureInfo {
  readonly taskCode: string;
  readonly planId: string;
  readonly verifyResults: Awaited<ReturnType<typeof executeVerifyCommands>>;
  readonly scopeCheck: ReturnType<typeof checkOwnerFileScope>;
  readonly attemptNumber: number;
}

/**
 * Complete a micro-task: verify, scope check, seal proof, commit.
 */
export async function completeMicroTask(
  store: BrainStorageDriver,
  repoRoot: string,
  planId: string,
  taskId: string,
  options: CompleteMicroTaskOptions
): Promise<CompleteMicroTaskResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();

  // 1. Load the plan bundle and find the task
  const bundles = await discoverPlans(repoRoot);
  const bundle = bundles.find((b) => b.manifest.plan_id === planId);
  if (!bundle) {
    return { ok: false, taskCode: taskId, error: `Plan ${planId} not found` };
  }

  let targetTask: PlanTaskIR | null = null;
  for (const wave of bundle.waves) {
    const found = wave.tasks.find((t) => t.code === taskId);
    if (found) {
      targetTask = found;
      break;
    }
  }

  if (!targetTask) {
    return { ok: false, taskCode: taskId, error: `Task ${taskId} not found in plan ${planId}` };
  }

  const executionPolicy = bundle.manifest.execution_policy;
  const maxAttempts = executionPolicy.max_attempts_per_task;
  const currentAttempts = targetTask.lifecycle.attempts;
  const attemptNumber = currentAttempts + 1;

  // 2. Check dependencies are done/skipped and collect parent proof hashes
  const parentProofHashes = await collectParentProofHashes(store, targetTask, bundle, planId);
  if (parentProofHashes.length < targetTask.graph.depends_on.length) {
    return { ok: false, taskCode: taskId, error: "DEPENDENCY_NOT_DONE: predecessor tasks not completed" };
  }

  // 3. Claim lease (or verify we hold it)
  const leaseResult = await claimTaskLease(store, {
    taskUrn: targetTask.urn,
    agentRuntime: options.agentRuntime,
    sessionId: options.sessionId,
    modelTier: options.modelTier,
    ttlSec: 1800, // 30 min
    nowIso,
  });

  if (!leaseResult.ok) {
    return { ok: false, taskCode: taskId, error: leaseResult.error ?? "LEASE_FAILED" };
  }

  // 4. Capture baseline dirty files if requireCleanScope
  // Use provided baselineDirtyFiles or capture if not provided and requireCleanScope is true
  let baselineDirtyFiles: string[] = [];
  if (options.requireCleanScope) {
    baselineDirtyFiles = options.baselineDirtyFiles !== undefined
      ? [...options.baselineDirtyFiles]
      : await captureBaselineDirtyFiles(repoRoot, { gitRunner: options.gitRunner });
  }

  try {
    // 5. Run verify commands
    const verifyCommands = targetTask.verification.commands.map((c: VerifyCommandIR) => ({
      cmd: c.cmd,
      timeoutSec: 120,
      expectedExitCode: c.expected_exit_code ?? 0,
    }));

    const verifyResults = await executeVerifyCommands(verifyCommands, { cwd: repoRoot, runner: options.commandRunner });

    // 6. Scope check
    const changedFilesResult = await inspectChangedFiles(repoRoot, { gitRunner: options.gitRunner });
    const scopeCheck = checkOwnerFileScope(
      changedFilesResult.all,
      [...targetTask.governance.owner_files],
      [], // allowedPlanFiles
      baselineDirtyFiles
    );

    // 7. Check if any verify command failed
    // Use the actual expectedExitCode from verifyResults
    const verifyFailed = verifyResults.some((r) => r.exitCode !== r.expectedExitCode);
    const hasScopeViolation = !scopeCheck.ok;

    if (verifyFailed || hasScopeViolation) {
      // Record failure episode
      await recordFailureEpisode(store, repoRoot, {
        taskCode: taskId,
        planId,
        verifyResults,
        scopeCheck,
        attemptNumber,
      });

      // Circuit breaker logic
      if (attemptNumber >= maxAttempts) {
        // Block the task
        await blockTask(store, repoRoot, planId, taskId, {
          reason: verifyFailed ? "VERIFY_FAILED_MAX_ATTEMPTS" : "SCOPE_VIOLATION_MAX_ATTEMPTS",
          attempts: attemptNumber,
          modelTier: options.modelTier ?? "flash",
        });

        // Release lease
        await releaseTaskLease(store, targetTask.urn, options.sessionId);

        // Get next ready frontier
        const nextReady = await getNextReadyFrontier(store, repoRoot, planId);

        return {
          ok: false,
          taskCode: taskId,
          error: verifyFailed ? "VERIFY_FAILED_MAX_ATTEMPTS" : "SCOPE_VIOLATION_MAX_ATTEMPTS",
          blocked: true,
          nextReadyFrontier: nextReady,
        };
      }

      // Escalate model tier
      const escalationChain = executionPolicy.escalation_chain ?? ["flash", "neon", "argon"];
      const currentTier = options.modelTier ?? targetTask.lifecycle.model_tier ?? executionPolicy.default_model_tier;
      const currentIndex = escalationChain.indexOf(currentTier);
      const nextTier = currentIndex >= 0 && currentIndex + 1 < escalationChain.length
        ? escalationChain[currentIndex + 1]
        : currentTier;

      // Persist the escalation: update wave JSON (task.lifecycle) and brain nodes table
      await persistEscalation(store, repoRoot, planId, taskId, attemptNumber, nextTier);

      // Release lease on non-terminal failure
      await releaseTaskLease(store, targetTask.urn, options.sessionId);

      return {
        ok: false,
        taskCode: taskId,
        error: verifyFailed ? "VERIFY_FAILED" : "SCOPE_VIOLATION",
        nextReadyFrontier: [],
        nextModelTier: nextTier,
        attempts: attemptNumber,
      };
    }

    // 8. Success path - seal proof envelope
    const proofEnvelope = sealProofEnvelope({
      schema_version: "1.0.0",
      task_urn: targetTask.urn,
      code: targetTask.code,
      parent_proof_hashes: parentProofHashes,
      commands: verifyResults.map((r) => ({
        cmd: r.cmd,
        exit_code: r.exitCode,
        duration_ms: r.durationMs,
        stdout_sha256: r.stdoutSha256,
        stderr_sha256: r.stderrSha256,
        redacted_excerpt: r.redactedExcerpt,
      })),
      diff_files: scopeCheck.ownedChanged,
      owner_files_verified: scopeCheck.ok, // boolean per schema
      acceptance_criteria_state: targetTask.verification.acceptance_criteria.map((c) => ({
        criterion: c,
        satisfied: true,
      })),
      commit_sha: null, // null per schema, not undefined
      model_tier: options.modelTier ?? targetTask.lifecycle.model_tier ?? executionPolicy.default_model_tier,
      agent_runtime: options.agentRuntime,
      verified_at: nowIso,
    }, parentProofHashes);

    // 9. Write evidence proof file
    const evidenceDir = join(repoRoot, ".plan", planId, "evidence");
    await mkdir(evidenceDir, { recursive: true });
    const proofPath = join(evidenceDir, `${taskId}.proof.json`);
    await writeFile(proofPath, JSON.stringify(proofEnvelope, null, 2), "utf8");

    // 10. Update proof ledger
    await updateProofLedger(store, proofEnvelope, planId);

    // 11. Update wave JSON status - only valid lifecycle fields
    await updateWaveJson(repoRoot, planId, taskId, {
      status: "done",
      delivery_stage: "verified_dev",
      // evidence_ref and commit_sha are in proof envelope, not wave JSON (schema additionalProperties: false)
    });

    // 12. Record fixed_by episode if there were previous attempts
    if (attemptNumber > 1) {
      await recordEpisode(store, repoRoot, {
        summary: `Task ${taskId} fixed after ${attemptNumber - 1} failed attempts`,
        kind: "fix",
        failure_pattern: "retry_success",
        owner_files: [...targetTask.governance.owner_files],
        task_urn: targetTask.urn,
        plan_id: planId,
        importance_bps: 7000,
      });
    }

    // 13. Release lease
    await releaseTaskLease(store, targetTask.urn, options.sessionId);

    // 14. Auto-commit if requested
    let commitSha: string | undefined;
    if (options.autoCommit) {
      commitSha = await atomicCommit(
        repoRoot,
        scopeCheck.ownedChanged,
        bundle,
        taskId,
        targetTask
      );
    }

    return {
      ok: true,
      taskCode: taskId,
      proofPath,
      commitSha,
    };
  } catch (e) {
    await releaseTaskLease(store, targetTask.urn, options.sessionId);
    const err = e as Error;
    return { ok: false, taskCode: taskId, error: err.message };
  }
}

/**
 * Record a micro-task failure.
 */
export async function recordMicroTaskFailure(
  store: BrainStorageDriver,
  repoRoot: string,
  planId: string,
  taskId: string,
  failureInfo: FailureInfo
): Promise<void> {
  await recordEpisode(store, repoRoot, {
    summary: `Task ${taskId} attempt ${failureInfo.attemptNumber} failed: ${failureInfo.verifyResults.map((r) => r.exitCode !== 0 ? r.cmd : "").filter(Boolean).join(", ") || "scope violation"}`,
    kind: "failure",
    failure_pattern: failureInfo.scopeCheck.ok ? "verify_failed" : "scope_violation",
    owner_files: failureInfo.scopeCheck.ownedChanged,
    task_urn: `urn:mw:work:${planId}:${taskId}`,
    plan_id: planId,
    importance_bps: 8000,
  });
}

async function collectParentProofHashes(
  store: BrainStorageDriver,
  task: PlanTaskIR,
  bundle: LoadedPlanBundle,
  planId: string
): Promise<string[]> {
  const hashes: string[] = [];
  for (const depCode of task.graph.depends_on) {
    // Find the dependency task in the bundle
    const depTask = bundle.waves.flatMap((w) => w.tasks).find((t) => t.code === depCode);
    if (depTask) {
      // Check if dependency is done or skipped
      if (depTask.lifecycle.status === "done" || depTask.lifecycle.status === "skipped") {
        // Query proof_ledger by plan_id and task_code
        const proof = store.get(
          `SELECT envelope_sha256 FROM proof_ledger WHERE plan_id = ? AND task_code = ? ORDER BY recorded_at DESC LIMIT 1;`,
          planId,
          depCode
        ) as { envelope_sha256: string } | undefined;
        if (proof) {
          hashes.push(proof.envelope_sha256);
        }
      }
    }
  }
  return hashes.sort();
}

async function recordFailureEpisode(
  store: BrainStorageDriver,
  repoRoot: string,
  params: {
    taskCode: string;
    planId: string;
    verifyResults: Awaited<ReturnType<typeof executeVerifyCommands>>;
    scopeCheck: ReturnType<typeof checkOwnerFileScope>;
    attemptNumber: number;
  }
): Promise<void> {
  const { taskCode, planId, verifyResults, scopeCheck, attemptNumber } = params;

  const failedCommands = verifyResults.filter((r) => r.exitCode !== 0).map((r) => r.cmd);
  const scopeViolations = scopeCheck.outOfScopeFiles;

  await recordEpisode(store, repoRoot, {
    summary: `Task ${taskCode} attempt ${attemptNumber} failed: ${failedCommands.join(", ") || (scopeViolations.length > 0 ? `scope violation: ${scopeViolations.join(", ")}` : "unknown")}`,
    kind: "failure",
    failure_pattern: scopeViolations.length > 0 ? "scope_violation" : "verify_failed",
    owner_files: scopeCheck.ownedChanged,
    task_urn: `urn:mw:work:${planId}:${taskCode}`,
    plan_id: planId,
    importance_bps: 8000,
  });
}

async function blockTask(
  store: BrainStorageDriver,
  repoRoot: string,
  planId: string,
  taskId: string,
  params: { reason: string; attempts: number; modelTier: ModelTier }
): Promise<void> {
  const { reason, attempts, modelTier } = params;

  store.transactionImmediate((tx) => {
    tx.run(
      `UPDATE nodes SET status = 'blocked', delivery_stage = 'na', metadata_json = ?
       WHERE code = ? AND plan_id = ?;`,
      JSON.stringify({ blocked_reason: reason, blocked_at: new Date().toISOString(), attempts, model_tier: modelTier }),
      taskId,
      planId
    );
  });

  // Update wave JSON properly - only lifecycle fields
  await updateWaveJson(repoRoot, planId, taskId, {
    status: "blocked",
    delivery_stage: "na",
    attempts,
    model_tier: modelTier,
    blocked_reason: reason, // stored in metadata_json via updateWaveJson
  });
}

/**
 * Persist escalation state: update wave JSON task.lifecycle and brain nodes table
 */
async function persistEscalation(
  store: BrainStorageDriver,
  repoRoot: string,
  planId: string,
  taskId: string,
  attempts: number,
  modelTier: ModelTier
): Promise<void> {
  // Update brain nodes table
  store.transactionImmediate((tx) => {
    tx.run(
      `UPDATE nodes SET attempts = ?, metadata_json = json_set(
         COALESCE(metadata_json, '{}'),
         '$.model_tier',
         ?
       ) WHERE code = ? AND plan_id = ?;`,
      attempts,
      modelTier,
      taskId,
      planId
    );
  });

  // Update wave JSON task.lifecycle
  await updateWaveJson(repoRoot, planId, taskId, {
    attempts,
    model_tier: modelTier,
  });
}

async function updateProofLedger(
  store: BrainStorageDriver,
  proofEnvelope: ReturnType<typeof sealProofEnvelope>,
  planId: string
): Promise<void> {
  // Extract wave_id from task_urn: urn:mw:work:org/repo:planId:W1/T01
  const waveIdMatch = proofEnvelope.task_urn.match(/:(W\d+)\//);
  const waveId = waveIdMatch ? waveIdMatch[1] : "";

  store.transactionImmediate((tx) => {
    tx.run(
      `INSERT OR REPLACE INTO proof_ledger
       (envelope_sha256, task_urn, task_code, plan_id, wave_id, verify_exit_code, parent_proof_hashes, merkle_root, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      proofEnvelope.envelope_sha256,
      proofEnvelope.task_urn,
      proofEnvelope.code,
      planId,
      waveId,
      0,
      JSON.stringify(proofEnvelope.parent_proof_hashes),
      "", // merkle_root - would need to compute
      JSON.stringify(proofEnvelope)
    );
  });
}

async function updateWaveJson(
  repoRoot: string,
  planId: string,
  taskId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const waveDir = join(repoRoot, ".plan", planId, "waves");
  try {
    const files = await readdir(waveDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const wavePath = join(waveDir, file);
        const content = await readFile(wavePath, "utf8");
        const wave = JSON.parse(content);
        const task = wave.tasks.find((t: PlanTaskIR) => t.code === taskId);
        if (task) {
          // Properly update task.lifecycle and task.projections per schema
          // Only fields defined in TaskLifecycle schema: status, delivery_stage, model_tier, risk_tier, attempts
          const updatedLifecycle: TaskLifecycle = {
            ...task.lifecycle,
            status: (updates.status as TaskLifecycle["status"]) ?? task.lifecycle.status,
            delivery_stage: (updates.delivery_stage as TaskLifecycle["delivery_stage"]) ?? task.lifecycle.delivery_stage,
            model_tier: (updates.model_tier as ModelTier) ?? task.lifecycle.model_tier,
            risk_tier: task.lifecycle.risk_tier,
            attempts: (typeof updates.attempts === "number" ? updates.attempts : task.lifecycle.attempts),
          };

          // Update projections - only fields defined in TaskProjections schema
          // evidence_ref is not in TaskProjections schema, but we track it for internal use
          // The proof envelope already contains the evidence path
          const updatedProjections = {
            ...task.projections,
            // No evidence_ref in schema - proof is in .plan/{planId}/evidence/{taskId}.proof.json
          };

          // For blocked_reason, store in lifecycle metadata if we had such a field
          // Since schema has additionalProperties: false, we cannot add arbitrary fields
          // The brain nodes table metadata_json already stores blocked_reason

          const updatedTask: PlanTaskIR = {
            ...task,
            lifecycle: updatedLifecycle,
            projections: updatedProjections,
          } as PlanTaskIR;
          const updatedWave = { ...wave, tasks: wave.tasks.map((t: PlanTaskIR) => t.code === taskId ? updatedTask : t) };
          await writeFile(wavePath, JSON.stringify(updatedWave, null, 2), "utf8");
          break;
        }
      }
    }
  } catch {
    // wave dir doesn't exist
  }
}

async function getNextReadyFrontier(
  store: BrainStorageDriver,
  repoRoot: string,
  planId: string
): Promise<string[]> {
  const bundles = await discoverPlans(repoRoot);
  const bundle = bundles.find((b) => b.manifest.plan_id === planId);
  if (!bundle) return [];

  const ready: string[] = [];
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      if (task.lifecycle.status === "todo" || task.lifecycle.status === "backlog") {
        const depsDone = task.graph.depends_on.every((depCode) => {
          const depTask = bundle.waves.flatMap((w) => w.tasks).find((t) => t.code === depCode);
          return depTask?.lifecycle.status === "done";
        });
        if (depsDone) {
          ready.push(task.code);
        }
      }
    }
  }
  return ready;
}

async function atomicCommit(
  repoRoot: string,
  ownedChanged: readonly string[],
  bundle: LoadedPlanBundle,
  taskId: string,
  task: PlanTaskIR
): Promise<string> {
  // Stage only owned files + plan files
  const planFiles = [
    `.plan/${bundle.manifest.plan_id}/waves/`,
    `.plan/${bundle.manifest.plan_id}/evidence/${taskId}.proof.json`,
  ];

  // Build commit message
  const commitMsg = `chore(${taskId.toLowerCase()}): ${task.title}`;

  try {
    // Stage files
    execFileSync("git", ["add", ...ownedChanged, ...planFiles], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    // Commit with retry on pre-commit fix
    let committed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        execFileSync("git", ["commit", "--only", ...ownedChanged, ...planFiles, "-m", commitMsg], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        committed = true;
        break;
      } catch {
        if (attempt === 0) {
          // Pre-commit may have auto-fixed; retry once
          continue;
        }
        throw new Error("Commit failed after pre-commit retry");
      }
    }

    if (!committed) {
      throw new Error("Commit failed");
    }

    // Get commit SHA
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    return sha;
  } catch (e) {
    throw new Error(`Atomic commit failed: ${(e as Error).message}`, { cause: e });
  }
}