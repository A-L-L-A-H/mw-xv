#!/usr/bin/env node
/**
 * V72 — Sovereign Empire v3.0 GA Readiness Gate
 *
 * Verifies repository upstream synchronization, workspace cleanliness, and
 * emits a deterministic SHA-256 signed JSON proof ledger.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GA_V3_SCHEMA_VERSION = "ga-v3-readiness.v1";
export const GA_V3_RELEASE_ID = "sovereign-empire-v3.0-ga";

/**
 * Recursively sorts object keys so JSON serialization is 100% deterministic.
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalizeForHash(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForHash(entry));
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeForHash(entry);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Computes a deterministic SHA-256 hex digest over canonical JSON.
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
export function computeLedgerSignature(payload) {
  const canonicalJson = JSON.stringify(canonicalizeForHash(payload));
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

/**
 * Verifies that a signed proof ledger's SHA-256 signature matches its payload.
 * @param {Record<string, unknown>} ledger
 * @returns {boolean}
 */
export function verifyLedgerSignature(ledger) {
  if (!ledger || typeof ledger !== "object" || typeof ledger.signature !== "string") {
    return false;
  }
  const { signature, ...unsignedPayload } = ledger;
  return computeLedgerSignature(unsignedPayload) === signature;
}

/**
 * Parses `git rev-list --left-right --count @{u}...HEAD` output.
 * @param {string} raw
 * @returns {{ behind: number, ahead: number, synced: boolean, valid: boolean }}
 */
export function parseBehindAhead(raw) {
  const trimmed = String(raw ?? "").trim();
  const match = /^(\d+)\s+(\d+)$/.exec(trimmed);
  if (!match) {
    return { behind: -1, ahead: -1, synced: false, valid: false };
  }
  const behind = Number.parseInt(match[1], 10);
  const ahead = Number.parseInt(match[2], 10);
  return {
    behind,
    ahead,
    synced: behind === 0 && ahead === 0,
    valid: true,
  };
}

/**
 * Parses `git status --porcelain` output.
 * @param {string} raw
 * @returns {{ clean: boolean, dirtyCount: number, entries: string[] }}
 */
export function parseWorkspaceStatus(raw) {
  const entries = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return {
    clean: entries.length === 0,
    dirtyCount: entries.length,
    entries,
  };
}

/**
 * Evaluates GA v3.0 readiness from collected repository state and signs the ledger.
 * @param {{
 *   branch: string,
 *   headCommit: string,
 *   upstreamRef: string | null,
 *   behindAheadRaw: string | null,
 *   statusPorcelainRaw: string,
 *   allowDirty?: boolean,
 *   allowUnsynced?: boolean,
 *   extraChecks?: Array<{ id: string, passed: boolean, detail: string }>
 * }} input
 */
export function evaluateGaV3Readiness(input) {
  const allowDirty = Boolean(input.allowDirty);
  const allowUnsynced = Boolean(input.allowUnsynced);

  const workspace = parseWorkspaceStatus(input.statusPorcelainRaw);
  const hasUpstream = Boolean(input.upstreamRef && input.behindAheadRaw !== null);
  const sync = hasUpstream
    ? parseBehindAhead(input.behindAheadRaw ?? "")
    : { behind: -1, ahead: -1, synced: false, valid: false };

  const checks = [
    {
      id: "repo-upstream-sync",
      passed: allowUnsynced || (hasUpstream && sync.valid && sync.synced),
      detail: hasUpstream && sync.valid
        ? `behind=${sync.behind} ahead=${sync.ahead} upstream=${input.upstreamRef}`
        : "upstream tracking branch unavailable or unreadable",
    },
    {
      id: "workspace-cleanliness",
      passed: allowDirty || workspace.clean,
      detail: workspace.clean
        ? "working tree clean (0 uncommitted entries)"
        : `working tree dirty (${workspace.dirtyCount} uncommitted entries)`,
    },
    ...(input.extraChecks ?? []),
  ];

  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.id);
  const ready = failedChecks.length === 0;

  const unsignedLedger = {
    schemaVersion: GA_V3_SCHEMA_VERSION,
    release: GA_V3_RELEASE_ID,
    ready,
    repository: {
      branch: input.branch,
      headCommit: input.headCommit,
      upstreamRef: input.upstreamRef,
      behind: sync.behind,
      ahead: sync.ahead,
      synced: sync.synced,
      clean: workspace.clean,
      dirtyCount: workspace.dirtyCount,
    },
    checks,
    summary: {
      totalChecks: checks.length,
      passedChecks: checks.length - failedChecks.length,
      failedChecks,
    },
    signatureAlgorithm: "sha256",
  };

  return {
    ...unsignedLedger,
    signature: computeLedgerSignature(unsignedLedger),
  };
}

/**
 * Default git command runner.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Executes the GA v3.0 readiness gate against a Git repository.
 * @param {{
 *   cwd?: string,
 *   allowDirty?: boolean,
 *   allowUnsynced?: boolean,
 *   runGit?: (args: string[], cwd: string) => string,
 *   extraChecks?: Array<{ id: string, passed: boolean, detail: string }>
 * }} [options]
 */
export function runGaV3ReadinessGate(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const runGit = options.runGit ?? defaultRunGit;

  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const headCommit = runGit(["rev-parse", "HEAD"], cwd);
  const statusPorcelainRaw = runGit(["status", "--porcelain"], cwd);

  let upstreamRef = null;
  let behindAheadRaw = null;
  try {
    const resolvedUpstream = runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      cwd,
    );
    const resolvedCounts = runGit(["rev-list", "--left-right", "--count", "@{u}...HEAD"], cwd);
    upstreamRef = resolvedUpstream;
    behindAheadRaw = resolvedCounts;
  } catch {
    // Upstream tracking branch is absent or unreadable.
  }

  return evaluateGaV3Readiness({
    branch,
    headCommit,
    upstreamRef,
    behindAheadRaw,
    statusPorcelainRaw,
    allowDirty: options.allowDirty,
    allowUnsynced: options.allowUnsynced,
    extraChecks: options.extraChecks,
  });
}

function parseCliArgs(argv) {
  const args = {
    allowDirty: false,
    allowUnsynced: false,
    outPath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--allow-dirty") {
      args.allowDirty = true;
    } else if (token === "--allow-unsynced") {
      args.allowUnsynced = true;
    } else if (token === "--out" && argv[i + 1]) {
      args.outPath = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const cli = parseCliArgs(process.argv.slice(2));
  const ledger = runGaV3ReadinessGate({
    allowDirty: cli.allowDirty,
    allowUnsynced: cli.allowUnsynced,
  });
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (cli.outPath) {
    writeFileSync(cli.outPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
  process.exit(ledger.ready ? 0 : 1);
}
