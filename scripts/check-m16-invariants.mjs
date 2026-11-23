#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ADR_0011_RELATIVE_PATH = 'docs/decisions/0011-sovereign-dreaming-merkle-agi.md';

export const MERKLE_LEDGER_MODULE = 'packages/ai-runtime/src/merkle-ledger.ts';

export const M16_MODULES = [
  'packages/ai-runtime/src/sleep-dream.ts',
  'packages/ai-runtime/src/active-inference.ts',
  MERKLE_LEDGER_MODULE,
  'packages/ai-runtime/src/redteam-arena.ts',
];

const FORBIDDEN_IMPORT_PATTERNS = [
  {
    code: 'FORBIDDEN_NODE_FS_IMPORT',
    regex: /\b(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/u,
    message: 'Direct node:fs import is forbidden inside @moonwitness/ai-runtime M16 modules.',
  },
  {
    code: 'FORBIDDEN_CHILD_PROCESS_IMPORT',
    regex: /\b(?:from\s+['"](?:node:)?child_process['"]|import\s*\(\s*['"](?:node:)?child_process['"]\s*\)|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/u,
    message: 'Direct node:child_process import is forbidden inside @moonwitness/ai-runtime M16 modules.',
  },
];

const EXPLICIT_ANY_REGEX = /:\s*any\b/u;
const SELF_ACCEPT_TRUE_REGEX = /\bautomatedSelfAccept\s*:\s*true\b/u;
const SELF_PROMOTE_TRUE_REGEX = /\bautomatedPromotionAllowed\s*:\s*true\b/u;
const CREATE_REDACTOR_REGEX = /\bcreateRedactor\b/u;
const SHA256_REGEX = /createHash\s*\(\s*['"]sha256['"]\s*\)/u;
const RFC6962_LEAF_PREFIX_REGEX = /\b0x00\b/u;
const RFC6962_NODE_PREFIX_REGEX = /\b0x01\b/u;

export function checkM16ModuleSource(relativePath, source) {
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
      message: 'Explicit `: any` annotation is forbidden in M16 modules.',
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
      message: 'M16 module must use `createRedactor()` for mandatory secret redaction.',
    });
  }

  if (!SHA256_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_SHA256_DIGEST',
      message: "M16 module must compute SHA-256 digests via `createHash('sha256')`.",
    });
  }

  if (relativePath === MERKLE_LEDGER_MODULE) {
    if (!RFC6962_LEAF_PREFIX_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'MISSING_RFC6962_LEAF_DOMAIN_SEPARATION',
        message: 'RFC 6962 Merkle ledger must enforce `0x00` leaf hash domain separation.',
      });
    }
    if (!RFC6962_NODE_PREFIX_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'MISSING_RFC6962_NODE_DOMAIN_SEPARATION',
        message: 'RFC 6962 Merkle ledger must enforce `0x01` internal-node hash domain separation.',
      });
    }
  }

  return violations;
}

export function evaluateM16Invariants({ rootDir = defaultRoot, allowPartial = false } = {}) {
  const violations = [];
  const checkedModules = [];
  const skippedModules = [];

  const adrPath = join(rootDir, ADR_0011_RELATIVE_PATH);
  const adrPresent = existsSync(adrPath);
  if (!adrPresent) {
    violations.push({
      file: ADR_0011_RELATIVE_PATH,
      code: 'MISSING_ADR_0011',
      message: 'ADR 0011 (docs/decisions/0011-sovereign-dreaming-merkle-agi.md) is required.',
    });
  }

  for (const relativePath of M16_MODULES) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      if (allowPartial) {
        skippedModules.push(relativePath);
      } else {
        violations.push({
          file: relativePath,
          code: 'MISSING_M16_MODULE',
          message: `Required M16 module is missing: ${relativePath}`,
        });
      }
      continue;
    }

    const source = readFileSync(fullPath, 'utf8');
    checkedModules.push(relativePath);
    violations.push(...checkM16ModuleSource(relativePath, source));
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

  const result = evaluateM16Invariants({ rootDir: defaultRoot, allowPartial });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `M16 constitutional invariants passed (${result.checkedCount} checked, ${result.skippedCount} skipped).\n`
    );
  } else {
    process.stderr.write(
      `M16 constitutional invariants failed (${result.violations.length} violation(s)):\n`
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
