import { randomUUID } from 'node:crypto';
import type { DesktopCapabilityBridge, DesktopActionAuthContext } from './types.js';
import type { DesktopUpstreamSyncClient } from './sync-client.js';

export interface AutonomousTaskExecutionOptions {
  readonly runId?: string;
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly riskTier?: string;
  readonly commitMessage?: string;
}

export interface AutonomousTaskExecutionResult {
  readonly taskId: number;
  readonly workContractId: number;
  readonly workContractCode: string;
  readonly worktreePath: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly committed: boolean;
  readonly advanced: boolean;
  readonly taskStatus: string;
  readonly workContractStatus: string;
}

/**
 * End-to-end loop:
 * Task -> WorkContract -> Desktop Worktree Sandbox -> PTY Verification -> Commit -> Sync Stage
 */
export async function executeProjectTaskInSandbox(
  bridge: DesktopCapabilityBridge,
  syncClient: DesktopUpstreamSyncClient,
  taskId: number,
  auth: DesktopActionAuthContext,
  options: AutonomousTaskExecutionOptions = {}
): Promise<AutonomousTaskExecutionResult> {
  const contractInfo = await syncClient.dispatchTaskWorkContract(taskId, {
    riskTier: options.riskTier,
  });

  const runId = options.runId ?? `run-${randomUUID()}`;
  const lease = await bridge.worktree.acquire({
    runId,
  });

  let exitCode: number | null;
  let timedOut: boolean;
  let committed = false;

  try {
    const cmd = options.command ?? 'git';
    const args = options.commandArgs ?? ['status', '--short'];

    const ptyResult = await bridge.pty.execute(
      {
        runId,
        command: cmd,
        args,
        timeoutMs: 15_000,
      },
      auth
    );

    exitCode = ptyResult.exitCode;
    timedOut = ptyResult.timedOut;

    if (exitCode === 0 && !timedOut) {
      const commitMsg =
        options.commitMessage ??
        `feat(task): complete autonomous task #${taskId} (${contractInfo.code})`;
      try {
        await bridge.worktree.commit(runId, commitMsg, auth);
        committed = true;
      } catch {
        committed = false;
      }
    }
  } finally {
    await bridge.worktree.release(runId);
  }

  const stageResult = await syncClient.syncTaskWorkContractStage(taskId);

  return {
    taskId,
    workContractId: contractInfo.workContractId,
    workContractCode: contractInfo.code,
    worktreePath: lease.worktreePath,
    exitCode,
    timedOut,
    committed,
    advanced: stageResult.advanced,
    taskStatus: stageResult.taskStatus,
    workContractStatus: stageResult.workContractStatus,
  };
}
