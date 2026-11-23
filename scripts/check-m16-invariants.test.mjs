import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ADR_0011_RELATIVE_PATH,
  M16_MODULES,
  MERKLE_LEDGER_MODULE,
  checkM16ModuleSource,
  evaluateM16Invariants,
} from './check-m16-invariants.mjs';

const VALID_MODULE_SOURCE = `
import { createHash } from 'node:crypto';
import { createRedactor } from './redaction.js';

export function buildReport(input: string): { digest: string; automatedSelfAccept: false; automatedPromotionAllowed: false } {
  const redact = createRedactor();
  const safe = redact(input);
  const digest = createHash('sha256').update(safe).digest('hex');
  return { digest, automatedSelfAccept: false, automatedPromotionAllowed: false };
}
`;

const VALID_MERKLE_SOURCE = `
import { createHash } from 'node:crypto';
import { createRedactor } from './redaction.js';

export function hashMerkleLeaf(payload: string): string {
  const redact = createRedactor();
  const safe = redact(payload);
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(safe)])).digest('hex');
}

export function hashMerkleNode(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x01]), Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')]))
    .digest('hex');
}
`;

function createTempRepo() {
  return mkdtempSync(join(tmpdir(), 'mw-m16-invariants-'));
}

function writeRelative(rootDir, relativePath, content) {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

test('passes when ADR 0011 and all 4 compliant M16 modules exist', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0011_RELATIVE_PATH, '# ADR 0011\n');
    for (const mod of M16_MODULES) {
      writeRelative(rootDir, mod, mod === MERKLE_LEDGER_MODULE ? VALID_MERKLE_SOURCE : VALID_MODULE_SOURCE);
    }

    const result = evaluateM16Invariants({ rootDir });
    assert.equal(result.ok, true);
    assert.equal(result.adrPresent, true);
    assert.equal(result.checkedCount, M16_MODULES.length);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('strict mode fails on missing modules; --allow-partial skips absent modules cleanly', () => {
  const rootDir = createTempRepo();
  try {
    writeRelative(rootDir, ADR_0011_RELATIVE_PATH, '# ADR 0011\n');
    writeRelative(rootDir, M16_MODULES[0], VALID_MODULE_SOURCE);

    const strictResult = evaluateM16Invariants({ rootDir, allowPartial: false });
    assert.equal(strictResult.ok, false);
    assert.equal(strictResult.violations.length, M16_MODULES.length - 1);
    assert.ok(strictResult.violations.every((v) => v.code === 'MISSING_M16_MODULE'));

    const partialResult = evaluateM16Invariants({ rootDir, allowPartial: true });
    assert.equal(partialResult.ok, true);
    assert.equal(partialResult.checkedCount, 1);
    assert.equal(partialResult.skippedCount, M16_MODULES.length - 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('fails when ADR 0011 is missing even with --allow-partial', () => {
  const rootDir = createTempRepo();
  try {
    const result = evaluateM16Invariants({ rootDir, allowPartial: true });
    assert.equal(result.ok, false);
    assert.equal(result.adrPresent, false);
    assert.ok(result.violations.some((v) => v.code === 'MISSING_ADR_0011'));
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
  const violations = checkM16ModuleSource('packages/ai-runtime/src/sleep-dream.ts', badSource);
  const codes = new Set(violations.map((v) => v.code));

  assert.ok(codes.has('FORBIDDEN_NODE_FS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_CHILD_PROCESS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_EXPLICIT_ANY'));
  assert.ok(codes.has('FORBIDDEN_SELF_ACCEPT'));
  assert.ok(codes.has('FORBIDDEN_SELF_PROMOTE'));
  assert.ok(codes.has('MISSING_REDACTOR'));
  assert.ok(codes.has('MISSING_SHA256_DIGEST'));
});

test('detects missing RFC 6962 0x00 and 0x01 domain separation in merkle-ledger.ts', () => {
  const violations = checkM16ModuleSource(MERKLE_LEDGER_MODULE, VALID_MODULE_SOURCE);
  const codes = new Set(violations.map((v) => v.code));

  assert.ok(codes.has('MISSING_RFC6962_LEAF_DOMAIN_SEPARATION'));
  assert.ok(codes.has('MISSING_RFC6962_NODE_DOMAIN_SEPARATION'));
});
