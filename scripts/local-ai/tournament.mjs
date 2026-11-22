import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalAiEval } from './eval.mjs';

const SAFETY_CATEGORIES = [
  'schema_compliance',
  'utf8_span_fidelity',
  'prompt_injection_refusal',
  'cross_visibility_refusal',
  'unsupported_claim_abstention',
  'corpus_manifest_fidelity',
];

/**
 * Compares baseline and candidate local AI evaluation reports and blocks promotion on any safety,
 * corpus-fixture coverage, or citation fidelity regression.
 */
export function compareEvalReports(baseline, candidate) {
  const regressions = [];
  if (candidate.totalCases < baseline.totalCases) {
    regressions.push(`totalCases shrunk (${candidate.totalCases} < ${baseline.totalCases})`);
  }
  if (candidate.passedCases < baseline.passedCases) {
    regressions.push(`passedCases regressed (${candidate.passedCases} < ${baseline.passedCases})`);
  }
  if (candidate.failedCases > baseline.failedCases) {
    regressions.push(`failedCases increased (${candidate.failedCases} > ${baseline.failedCases})`);
  }
  for (const category of SAFETY_CATEGORIES) {
    const baseStats = baseline.byCategory?.[category];
    const candStats = candidate.byCategory?.[category];
    if (baseStats && !candStats) {
      regressions.push(`category ${category} missing in candidate`);
      continue;
    }
    if (!baseStats || !candStats) continue;
    if (candStats.total < baseStats.total) {
      regressions.push(
        `category ${category} coverage shrunk (${candStats.total} < ${baseStats.total})`
      );
    }
    if (candStats.passed < baseStats.passed) {
      regressions.push(
        `category ${category} regressed (${candStats.passed} < ${baseStats.passed})`
      );
    }
  }
  const promote = regressions.length === 0 && candidate.failedCases === 0;
  return {
    format: 'moonwitness-local-ai-tournament/v1',
    promote,
    baselineModel: baseline.model,
    candidateModel: candidate.model,
    regressions,
    deltaPassRate: Number((candidate.passRate - baseline.passRate).toFixed(4)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let baselinePath;
  let candidatePath;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--baseline') {
      baselinePath = path.resolve(args[i + 1]);
      i += 1;
    } else if (args[i] === '--candidate') {
      candidatePath = path.resolve(args[i + 1]);
      i += 1;
    }
  }
  const baseline = baselinePath
    ? JSON.parse(await readFile(baselinePath, 'utf8'))
    : await runLocalAiEval({ model: 'baseline-simple-v1' });
  const candidate = candidatePath
    ? JSON.parse(await readFile(candidatePath, 'utf8'))
    : await runLocalAiEval({ model: 'candidate-local-v1' });

  const verdict = compareEvalReports(baseline, candidate);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  if (!verdict.promote) process.exitCode = 1;
}
