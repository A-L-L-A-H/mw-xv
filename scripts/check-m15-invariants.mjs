#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ADR_0010_RELATIVE_PATH = 'docs/decisions/0010-constitutional-rsi-world-model.md';

export const M15_MODULES = [
  'packages/ai-runtime/src/speculative-tree.ts',
  'packages/ai-runtime/src/skill-tree.ts',
  'packages/ai-runtime/src/world-model-gate.ts',
  'packages/ai-runtime/src/invariant-synthesizer.ts',
  'packages/ai-runtime/src/semantic-bus.ts',
  'packages/ai-runtime/src/causal-replay.ts',
  'packages/ai-runtime/src/epistemic-calibration.ts',
];

const FORBIDDEN_IMPORT_PATTERNS = [
  {
    code: 'FORBIDDEN_NODE_FS_IMPORT',
    regex:
      /\b(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/u,
    message: 'Direct node:fs import is forbidden inside @moonwitness/ai-runtime M15 modules.',
  },
  {
    code: 'FORBIDDEN_CHILD_PROCESS_IMPORT',
    regex:
      /\b(?:from\s+['"](?:node:)?child_process['"]|import\s*\(\s*['"](?:node:)?child_process['"]\s*\)|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/u,
    message:
      'Direct node:child_process import is forbidden inside @moonwitness/ai-runtime M15 modules.',
  },
];

const EXPLICIT_ANY_REGEX = /:\s*any\b/u;
const SELF_ACCEPT_TRUE_REGEX = /\bautomatedSelfAccept\s*:\s*true\b/u;
const SELF_PROMOTE_TRUE_REGEX = /\bautomatedPromotionAllowed\s*:\s*true\b/u;
const CREATE_REDACTOR_REGEX = /\bcreateRedactor\b/u;
const SHA256_REGEX = /createHash\s*\(\s*['"]sha256['"]\s*\)/u;

export function checkM15ModuleSource(relativePath, source) {
  const violations = [];

  for (const rule of FORBIDDEN_IMPORT_PATTERNS) {
    if (rule.regex.test(source)) {
      violations.push({
        file: relativePath,
        code: rule.code,
        message: rule.message,
      });
    }
  }

  if (EXPLICIT_ANY_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_EXPLICIT_ANY',
      message: 'Explicit `: any` annotation is forbidden in M15 modules.',
    });
  }

  if (SELF_ACCEPT_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_ACCEPT',
      message: 'Constitutional violation: `automatedSelfAccept: true` is forbidden.',
    });
  }

  if (SELF_PROMOTE_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_PROMOTE',
      message: 'Constitutional violation: `automatedPromotionAllowed: true` is forbidden.',
    });
  }

  if (!CREATE_REDACTOR_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_REDACTOR',
      message: 'M15 module must use `createRedactor()` for mandatory secret redaction.',
    });
  }

  if (!SHA256_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_SHA256_DIGEST',
      message: "M15 module must compute SHA-256 digests via `createHash('sha256')`.",
    });
  }

  return violations;
}

export function evaluateM15Invariants({ rootDir = defaultRoot, allowPartial = false } = {}) {
  const violations = [];
  const checkedModules = [];
  const skippedModules = [];

  const adrPath = join(rootDir, ADR_0010_RELATIVE_PATH);
  const adrPresent = existsSync(adrPath);
  if (!adrPresent) {
    violations.push({
      file: ADR_0010_RELATIVE_PATH,
      code: 'MISSING_ADR_0010',
      message: 'ADR 0010 (docs/decisions/0010-constitutional-rsi-world-model.md) is required.',
    });
  }

  for (const relativePath of M15_MODULES) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      if (allowPartial) {
        skippedModules.push(relativePath);
      } else {
        violations.push({
          file: relativePath,
          code: 'MISSING_M15_MODULE',
          message: `Required M15 module is missing: ${relativePath}`,
        });
      }
      continue;
    }

    const source = readFileSync(fullPath, 'utf8');
    checkedModules.push(relativePath);
    violations.push(...checkM15ModuleSource(relativePath, source));
  }

  return {
    ok: violations.length === 0,
    adrPresent,
    allowPartial,
    checkedCount: checkedModules.length,
    skippedCount: skippedModules.length,
    checkedModules,
    skippedModules,
    violations,
  };
}

function main(argv) {
  const args = new Set(argv);
  const jsonOutput = args.has('--json');
  const allowPartial = args.has('--allow-partial');

  const result = evaluateM15Invariants({ rootDir: defaultRoot, allowPartial });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `M15 constitutional invariants passed (${result.checkedCount} checked, ${result.skippedCount} skipped).\n`
    );
  } else {
    process.stderr.write(
      `M15 constitutional invariants failed (${result.violations.length} violation(s)):\n`
    );
    for (const v of result.violations) {
      process.stderr.write(`  - [${v.code}] ${v.file}: ${v.message}\n`);
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
