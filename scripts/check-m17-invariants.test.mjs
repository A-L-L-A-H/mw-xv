import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  A2A_CONSENSUS_MODULE,
  ADR_0012_RELATIVE_PATH,
  INCIDENT_HEALER_MODULE,
  M17_MODULES,
  POLICY_FUZZER_MODULE,
  SANDBOX_RUNNER_MODULE,
  checkM17ModuleSource,
  evaluateM17Invariants,
} from './check-m17-invariants.mjs';

const VALID_CONSENSUS_SOURCE = `
import { verifyMerkleInclusionProof as verifyInclusionProof } from './merkle-ledger.js';

export function evaluateConsensus(calibrationBrier: number) {
  const proofOk = Boolean(verifyInclusionProof);
  const quorumReached = proofOk && calibrationBrier < 0.25;
  return { quorumReached, automatedPromotionAllowed: false as const, automatedSelfMerge: false as const };
}
`;

const VALID_FUZZER_SOURCE = `
export function fuzzPolicy() {
  return { passed: true, automatedPromotionAllowed: false as const, automatedSelfMerge: false as const };
}
`;

const VALID_SANDBOX_SOURCE = `
export function buildSandboxManifest() {
  return {
    networkDisabled: true as const,
    secretsInjected: false as const,
    automatedPromotionAllowed: false as const,
    automatedSelfMerge: false as const,
  };
}
`;

const VALID_HEALER_SOURCE = `
import { createRedactor } from './redaction.js';

export function healIncident(log: string) {
  const redactor = createRedactor();
  return {
    summary: redactor.redactString(log),
    automatedSelfMerge: false as const,
    automatedPromotionAllowed: false as const,
  };
}
`;

function createTempRepo() {
  return mkdtempSync(join(tmpdir(), 'mw-m17-invariants-'));
}

function writeRelative(rootDir, relativePath, content) {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

test('passes when ADR 0012 and all 4 compliant M17 modules exist', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0012_RELATIVE_PATH, '# ADR 0012\n');
    writeRelative(rootDir, A2A_CONSENSUS_MODULE, VALID_CONSENSUS_SOURCE);
    writeRelative(rootDir, POLICY_FUZZER_MODULE, VALID_FUZZER_SOURCE);
    writeRelative(rootDir, SANDBOX_RUNNER_MODULE, VALID_SANDBOX_SOURCE);
    writeRelative(rootDir, INCIDENT_HEALER_MODULE, VALID_HEALER_SOURCE);

    const result = evaluateM17Invariants({ rootDir });
    assert.equal(result.ok, true);
    assert.equal(result.adrPresent, true);
    assert.equal(result.checkedCount, M17_MODULES.length);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('strict mode fails on missing modules; --allow-partial skips absent modules cleanly', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0012_RELATIVE_PATH, '# ADR 0012\n');
    writeRelative(rootDir, POLICY_FUZZER_MODULE, VALID_FUZZER_SOURCE);

    const strictResult = evaluateM17Invariants({ rootDir, allowPartial: false });
    assert.equal(strictResult.ok, false);
    assert.equal(strictResult.violations.length, M17_MODULES.length - 1);
    assert.ok(strictResult.violations.every((v) => v.code === 'MISSING_M17_MODULE'));

    const partialResult = evaluateM17Invariants({ rootDir, allowPartial: true });
    assert.equal(partialResult.ok, true);
    assert.equal(partialResult.checkedCount, 1);
    assert.equal(partialResult.skippedCount, M17_MODULES.length - 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('detects forbidden node:fs, node:child_process, eval, new Function, explicit any, self-merge, and self-promote', () => {
  const badSource = `
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function bad(x: any) {
  const a = eval('1 + 1');
  const fn = new Function('return 2');
  return {
    automatedSelfMerge: true,
    automatedPromotionAllowed: true,
    a,
    fn,
    x,
    readFileSync,
    execSync,
  };
}
`;
  const violations = checkM17ModuleSource(POLICY_FUZZER_MODULE, badSource);
  const codes = new Set(violations.map((v) => v.code));

  assert.ok(codes.has('FORBIDDEN_NODE_FS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_CHILD_PROCESS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_EVAL_CALL'));
  assert.ok(codes.has('FORBIDDEN_NEW_FUNCTION'));
  assert.ok(codes.has('FORBIDDEN_EXPLICIT_ANY'));
  assert.ok(codes.has('FORBIDDEN_SELF_MERGE'));
  assert.ok(codes.has('FORBIDDEN_SELF_PROMOTE'));
  assert.ok(codes.has('MISSING_CONSTITUTIONAL_LOCK'));
});

test('enforces module-specific invariants for incident-healer, sandbox-runner, and a2a-consensus', () => {
  const healerViolations = checkM17ModuleSource(INCIDENT_HEALER_MODULE, VALID_FUZZER_SOURCE);
  assert.ok(healerViolations.some((v) => v.code === 'MISSING_REDACTOR'));

  const sandboxViolations = checkM17ModuleSource(
    SANDBOX_RUNNER_MODULE,
    `export const bad = { networkDisabled: false, secretsInjected: true, automatedSelfMerge: false };`
  );
  const sandboxCodes = new Set(sandboxViolations.map((v) => v.code));
  assert.ok(sandboxCodes.has('INVALID_SANDBOX_NETWORK_LOCK'));
  assert.ok(sandboxCodes.has('INVALID_SANDBOX_SECRETS_LOCK'));

  const consensusViolations = checkM17ModuleSource(A2A_CONSENSUS_MODULE, VALID_FUZZER_SOURCE);
  const consensusCodes = new Set(consensusViolations.map((v) => v.code));
  assert.ok(consensusCodes.has('MISSING_MERKLE_PROOF_VERIFICATION'));
  assert.ok(consensusCodes.has('MISSING_CALIBRATION_WEIGHTED_QUORUM'));
});
