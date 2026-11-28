import { describe, expect, it } from "bun:test";
import {
  GA_V3_RELEASE_ID,
  GA_V3_SCHEMA_VERSION,
  computeLedgerSignature,
  evaluateGaV3Readiness,
  parseBehindAhead,
  parseWorkspaceStatus,
  runGaV3ReadinessGate,
  verifyLedgerSignature,
} from "../../../scripts/ga-v3-readiness-gate.mjs";

describe("V72 GA v3.0 Readiness Gate", () => {
  it("parses behind/ahead counts accurately", () => {
    expect(parseBehindAhead("0\t0")).toEqual({
      behind: 0,
      ahead: 0,
      synced: true,
      valid: true,
    });
    expect(parseBehindAhead("2 1\n")).toEqual({
      behind: 2,
      ahead: 1,
      synced: false,
      valid: true,
    });
    expect(parseBehindAhead("invalid")).toEqual({
      behind: -1,
      ahead: -1,
      synced: false,
      valid: false,
    });
  });

  it("parses porcelain workspace status accurately", () => {
    expect(parseWorkspaceStatus("")).toEqual({
      clean: true,
      dirtyCount: 0,
      entries: [],
    });
    expect(parseWorkspaceStatus(" M scripts/ui-governance-policy.json\n?? tmp.txt\n")).toEqual({
      clean: false,
      dirtyCount: 2,
      entries: [" M scripts/ui-governance-policy.json", "?? tmp.txt"],
    });
  });

  it("emits a deterministic SHA-256 signed proof ledger when synced and clean", () => {
    const input = {
      branch: "repo-hygiene-ci-2026-11-27",
      headCommit: "10ef42cd00000000000000000000000000000000",
      upstreamRef: "origin/repo-hygiene-ci-2026-11-27",
      behindAheadRaw: "0\t0",
      statusPorcelainRaw: "",
    };

    const ledgerA = evaluateGaV3Readiness(input);
    const ledgerB = evaluateGaV3Readiness(input);

    expect(ledgerA.schemaVersion).toBe(GA_V3_SCHEMA_VERSION);
    expect(ledgerA.release).toBe(GA_V3_RELEASE_ID);
    expect(ledgerA.ready).toBe(true);
    expect(ledgerA.summary.failedChecks).toEqual([]);
    expect(ledgerA.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(ledgerA.signature).toBe(ledgerB.signature);
    expect(verifyLedgerSignature(ledgerA)).toBe(true);
  });

  it("detects signature tampering in proof ledger", () => {
    const ledger = evaluateGaV3Readiness({
      branch: "main",
      headCommit: "abcdef1234567890",
      upstreamRef: "origin/main",
      behindAheadRaw: "0\t0",
      statusPorcelainRaw: "",
    });

    const tampered = { ...ledger, ready: false };
    expect(verifyLedgerSignature(tampered)).toBe(false);
    expect(computeLedgerSignature({ b: 2, a: 1 })).toBe(computeLedgerSignature({ a: 1, b: 2 }));
  });

  it("blocks GA readiness when workspace is dirty or repo is unsynced", () => {
    const ledger = evaluateGaV3Readiness({
      branch: "main",
      headCommit: "abcdef1234567890",
      upstreamRef: "origin/main",
      behindAheadRaw: "0\t3",
      statusPorcelainRaw: " M README.md\n",
    });

    expect(ledger.ready).toBe(false);
    expect(ledger.summary.failedChecks).toEqual([
      "repo-upstream-sync",
      "workspace-cleanliness",
    ]);
    expect(verifyLedgerSignature(ledger)).toBe(true);
  });

  it("collects git state via runGaV3ReadinessGate and handles missing upstream", () => {
    const ledger = runGaV3ReadinessGate({
      cwd: "z:\\repo\\mw-xv",
      runGit: (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
          return "repo-hygiene-ci-2026-11-27";
        }
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return "deadbeef";
        }
        if (args[0] === "status") {
          return "";
        }
        throw new Error("no upstream");
      },
    });

    expect(ledger.ready).toBe(false);
    expect(ledger.repository.upstreamRef).toBeNull();
    expect(ledger.summary.failedChecks).toEqual(["repo-upstream-sync"]);
    expect(verifyLedgerSignature(ledger)).toBe(true);
  });
});
