/**
 * T21 — Runtime `git diff` Scope Membrane & Verification Executor.
 *
 * Enforces that micro-tasks only edit files within their declared `owner_files`
 * allowlist. Runs verification commands with redacted stdout/stderr capture.
 */

import { redactSensitiveText } from "../core/redaction.js";
import { sha256Hex } from "../core/redaction.js";
import { execSync } from "node:child_process";

export interface ChangedFilesResult {
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly all: readonly string[];
}

export interface GitRunner {
  (cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface CommandRunner {
  (cmd: string, options: { cwd: string; shell: string; timeoutSec: number }): Promise<{ stdout: string; stderr: string; exitCode: number; signal?: string }>;
}

/**
 * Parse git status --porcelain output into ChangedFilesResult.
 */
function parseGitStatus(output: string): ChangedFilesResult {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const path = line.slice(3).replace(/\\/g, "/"); // normalize to POSIX
    if (status[0] !== " " && status[0] !== "?") {
      staged.push(path);
    }
    if (status[1] !== " " && status[1] !== "?") {
      unstaged.push(path);
    }
    if (status === "??") {
      untracked.push(path);
    }
  }

  const all = [...new Set([...staged, ...unstaged, ...untracked])];
  return { staged, unstaged, untracked, all };
}

/**
 * Collect changed files from git status --porcelain.
 * Returns repo-relative POSIX paths.
 */
export async function inspectChangedFiles(
  repoRoot: string,
  options?: { gitRunner?: GitRunner }
): Promise<ChangedFilesResult> {
  const gitRunner = options?.gitRunner;

  if (gitRunner) {
    const result = await gitRunner("git status --porcelain", repoRoot);
    return parseGitStatus(result.stdout);
  }

  const output = execSync("git status --porcelain", {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  return parseGitStatus(output);
}

export interface ScopeCheckResult {
  readonly ok: boolean;
  readonly ownedChanged: readonly string[];
  readonly outOfScopeFiles: readonly string[];
  readonly baselineDirtyFiles?: readonly string[];
}

/**
 * Check that all changed files are within the task's owner_files allowlist.
 * If baselineDirtyFiles is provided (captured at lease claim time), allows
 * pre-existing dirty files but rejects NEW out-of-scope edits.
 */
export function checkOwnerFileScope(
  changedFiles: readonly string[],
  ownerFiles: readonly string[],
  allowedPlanFiles: readonly string[] = [],
  baselineDirtyFiles?: readonly string[]
): ScopeCheckResult {
  const allowed = new Set([...ownerFiles, ...allowedPlanFiles]);
  const baseline = new Set(baselineDirtyFiles ?? []);

  const ownedChanged: string[] = [];
  const outOfScopeFiles: string[] = [];

  for (const file of changedFiles) {
    const isAllowed = Array.from(allowed).some((allowedFile) => {
      if (allowedFile.endsWith("/**") || allowedFile.endsWith("*")) {
        const prefix = allowedFile.replace(/\/\*\*$/, "").replace(/\*$/, "");
        return file.startsWith(prefix);
      }
      return file === allowedFile;
    });

    if (isAllowed) {
      ownedChanged.push(file);
    } else if (!baseline.has(file)) {
      // Only flag as out-of-scope if it wasn't already dirty at claim time
      outOfScopeFiles.push(file);
    }
  }

  return {
    ok: outOfScopeFiles.length === 0,
    ownedChanged,
    outOfScopeFiles,
    baselineDirtyFiles: baselineDirtyFiles ?? [],
  };
}

export interface VerifyCommandResult {
  readonly cmd: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly redactedExcerpt: string;
  readonly expectedExitCode: number;
}

/**
 * Execute verification commands with timeout, capturing exit code, duration,
 * stdout/stderr SHA-256, and bounded redacted excerpt (<= 400 chars).
 * On Windows, uses powershell.exe -NoProfile -Command.
 */
export async function executeVerifyCommands(
  commands: readonly { cmd: string; timeoutSec?: number; expectedExitCode?: number }[],
  options: { cwd?: string; shell?: string; runner?: CommandRunner } = {}
): Promise<VerifyCommandResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const isWindows = process.platform === "win32";
  const shell = options.shell ?? (isWindows ? "powershell.exe" : "/bin/sh");
  const runner = options.runner;

  const results: VerifyCommandResult[] = [];

  for (const { cmd, timeoutSec = 120, expectedExitCode = 0 } of commands) {
    const start = Date.now();
    let stdout: string;
    let stderr: string;
    let exitCode: number;

    if (runner) {
      const result = await runner(cmd, { cwd, shell, timeoutSec });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } else {
      try {
        const output = execSync(cmd, {
          cwd,
          shell,
          timeout: timeoutSec * 1000,
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
          windowsHide: true,
        });
        stdout = output;
        stderr = "";
        exitCode = 0;
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; status?: number; signal?: string };
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        exitCode = err.status ?? (err.signal ? 128 + (err.signal === "SIGTERM" ? 15 : 1) : 1);
      }
    }

    const durationMs = Date.now() - start;

    // SHA-256 of raw stdout/stderr
    const stdoutSha256 = sha256Hex(stdout);
    const stderrSha256 = sha256Hex(stderr);

    // Redact and bound excerpt (<= 400 chars total)
    const combined = stdout + "\n" + stderr;
    const redacted = redactSensitiveText(combined, []).text;
    const excerpt = redacted.slice(0, 400);

    results.push({
      cmd,
      exitCode,
      durationMs,
      stdoutSha256,
      stderrSha256,
      redactedExcerpt: excerpt,
      expectedExitCode,
    });

    // If a command fails with non-zero exit code, stop early
    if (exitCode !== expectedExitCode) {
      break;
    }
  }

  return results;
}

/**
 * Capture baseline dirty files at lease claim time.
 */
export async function captureBaselineDirtyFiles(repoRoot: string, options?: { gitRunner?: GitRunner }): Promise<string[]> {
  const result = await inspectChangedFiles(repoRoot, options);
  return [...result.all];
}