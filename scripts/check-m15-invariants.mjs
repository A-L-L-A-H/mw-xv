#!/usr/bin/env node
import {
  DEFAULT_ROOT,
  checkCommonMilestoneRules,
  createForbiddenImportPatterns,
  evaluateMilestoneInvariants,
  runMilestoneInvariantCli,
} from './lib/ai-runtime-invariants.mjs';

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

const FORBIDDEN_IMPORT_PATTERNS = createForbiddenImportPatterns('@moonwitness/ai-runtime', 'M15');

export function checkM15ModuleSource(relativePath, source) {
  return checkCommonMilestoneRules(relativePath, source, {
    milestone: 'M15',
    forbiddenPatterns: FORBIDDEN_IMPORT_PATTERNS,
    forbidSelfAccept: true,
    forbidSelfPromote: true,
    requireRedactor: true,
    requireSha256: true,
  });
}

export function evaluateM15Invariants({ rootDir = DEFAULT_ROOT, allowPartial = false } = {}) {
  return evaluateMilestoneInvariants({
    milestone: 'M15',
    adrNumber: '0010',
    adrRelativePath: ADR_0010_RELATIVE_PATH,
    modules: M15_MODULES,
    checkModuleSource: checkM15ModuleSource,
    rootDir,
    allowPartial,
  });
}

runMilestoneInvariantCli(import.meta.url, 'M15', evaluateM15Invariants);
