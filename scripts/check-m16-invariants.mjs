#!/usr/bin/env node
import {
  DEFAULT_ROOT,
  checkCommonMilestoneRules,
  createForbiddenImportPatterns,
  evaluateMilestoneInvariants,
  runMilestoneInvariantCli,
} from './lib/ai-runtime-invariants.mjs';

export const ADR_0011_RELATIVE_PATH = 'docs/decisions/0011-sovereign-dreaming-merkle-agi.md';

export const MERKLE_LEDGER_MODULE = 'packages/ai-runtime/src/merkle-ledger.ts';

export const M16_MODULES = [
  'packages/ai-runtime/src/sleep-dream.ts',
  'packages/ai-runtime/src/active-inference.ts',
  MERKLE_LEDGER_MODULE,
  'packages/ai-runtime/src/redteam-arena.ts',
];

const FORBIDDEN_IMPORT_PATTERNS = createForbiddenImportPatterns('@moonwitness/ai-runtime', 'M16');
const RFC6962_LEAF_PREFIX_REGEX = /\b0x00\b/u;
const RFC6962_NODE_PREFIX_REGEX = /\b0x01\b/u;

export function checkM16ModuleSource(relativePath, source) {
  const violations = checkCommonMilestoneRules(relativePath, source, {
    milestone: 'M16',
    forbiddenPatterns: FORBIDDEN_IMPORT_PATTERNS,
    forbidSelfAccept: true,
    forbidSelfPromote: true,
    requireRedactor: true,
    requireSha256: true,
  });

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

export function evaluateM16Invariants({ rootDir = DEFAULT_ROOT, allowPartial = false } = {}) {
  return evaluateMilestoneInvariants({
    milestone: 'M16',
    adrNumber: '0011',
    adrRelativePath: ADR_0011_RELATIVE_PATH,
    modules: M16_MODULES,
    checkModuleSource: checkM16ModuleSource,
    rootDir,
    allowPartial,
  });
}

runMilestoneInvariantCli(import.meta.url, 'M16', evaluateM16Invariants);
