#!/usr/bin/env node
// Deterministic, offline evaluation gate for CI and operator use.
// Prerequisite: `pnpm --filter @moonwitness/ai-evaluation build` (or the
// package's `check:gates` script, which builds first).
import { runOfflineEvaluationGates } from '../dist/index.js';

const report = await runOfflineEvaluationGates();

console.log(
  JSON.stringify(
    {
      ...report,
      summary: {
        checksPassed: report.checks.filter((entry) => entry.passed).length,
        checksTotal: report.checks.length,
        highestSatisfiedGate: report.gates.highestSatisfiedGate,
        syntheticFixture: report.syntheticFixture,
        realModelUsed: report.realModelUsed,
      },
    },
    null,
    2
  )
);

if (!report.ok) {
  process.exitCode = 1;
}
