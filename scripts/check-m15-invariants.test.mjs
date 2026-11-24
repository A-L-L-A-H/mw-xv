import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ADR_0010_RELATIVE_PATH,
  M15_MODULES,
  checkM15ModuleSource,
  evaluateM15Invariants,
} from './check-m15-invariants.mjs';

const VALID_MODULE_SOURCE = `
import { createHash } from 'node:crypto';
import { createRedactor } from './redaction.js';

export function buildReport(input: string): { digest: string; automatedSelfAccept: false } {
  const redact = createRedactor();
  const safe = redact(input);
  const digest = createHash('sha256').update(safe).digest('hex');
  return { digest, automatedSelfAccept: false };
}
`;

function createTempRepo() {
  return mkdtempSync(join(tmpdir(), 'mw-m15-invariants-'));
}

function writeRelative(rootDir, relativePath, content) {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

test('passes when ADR 0010 and all 7 compliant M15 modules exist', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0010_RELATIVE_PATH, '# ADR 0010\n');
    for (const mod of M15_MODULES) {
      writeRelative(rootDir, mod, VALID_MODULE_SOURCE);
    }

    const result = evaluateM15Invariants({ rootDir });
    assert.equal(result.ok, true);
    assert.equal(result.adrPresent, true);
    assert.equal(result.checkedCount, M15_MODULES.length);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('strict mode fails on missing modules; --allow-partial skips absent modules cleanly', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0010_RELATIVE_PATH, '# ADR 0010\n');
    writeRelative(rootDir, M15_MODULES[0], VALID_MODULE_SOURCE);

    const strictResult = evaluateM15Invariants({ rootDir, allowPartial: false });
    assert.equal(strictResult.ok, false);
    assert.equal(strictResult.violations.length, M15_MODULES.length - 1);
    assert.ok(strictResult.violations.every((v) => v.code === 'MISSING_M15_MODULE'));

    const partialResult = evaluateM15Invariants({ rootDir, allowPartial: true });
    assert.equal(partialResult.ok, true);
    assert.equal(partialResult.checkedCount, 1);
    assert.equal(partialResult.skippedCount, M15_MODULES.length - 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('fails when ADR 0010 is missing even with --allow-partial', () => {
  const rootDir = createTempRepo();
  try {
    const result = evaluateM15Invariants({ rootDir, allowPartial: true });
    assert.equal(result.ok, false);
    assert.equal(result.adrPresent, false);
    assert.ok(result.violations.some((v) => v.code === 'MISSING_ADR_0010'));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('detects forbidden node:fs, node:child_process, explicit any, self-accept, self-promote, missing redactor, and missing sha256', () => {
  const badSource = `
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function bad(x: any) {
  return {
    automatedSelfAccept: true,
    automatedPromotionAllowed: true,
    x,
    readFileSync,
    execSync,
  };
}
`;
  const violations = checkM15ModuleSource('packages/ai-runtime/src/speculative-tree.ts', badSource);
  const codes = new Set(violations.map((v) => v.code));

  assert.ok(codes.has('FORBIDDEN_NODE_FS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_CHILD_PROCESS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_EXPLICIT_ANY'));
  assert.ok(codes.has('FORBIDDEN_SELF_ACCEPT'));
  assert.ok(codes.has('FORBIDDEN_SELF_PROMOTE'));
  assert.ok(codes.has('MISSING_REDACTOR'));
  assert.ok(codes.has('MISSING_SHA256_DIGEST'));
});

test('accepts sha256 via centralized canonical-json import instead of inline createHash', () => {
  const goodSource = `
import { sha256Canonical, sha256Hex } from './canonical-json.js';
import { createRedactor } from './redaction.js';

export function digest(value: unknown): string {
  const { redact } = createRedactor({} as never);
  return sha256Canonical(redact(value as Record<string, unknown>));
}
`;
  const violations = checkM15ModuleSource('packages/ai-runtime/src/speculative-tree.ts', goodSource);
  const shaViolations = violations.filter((v) => v.code === 'MISSING_SHA256_DIGEST');

  assert.equal(shaViolations.length, 0);
});
