#!/usr/bin/env node
import process from 'node:process';
import { runAgiBenchmark } from '../packages/ai-evaluation/dist/index.js';

function parseArgs(argv) {
  let seed = 42;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--seed' && argv[i + 1] !== undefined) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed)) {
        seed = parsed >>> 0;
      }
      i += 1;
    } else if (arg.startsWith('--seed=')) {
      const parsed = Number.parseInt(arg.slice('--seed='.length), 10);
      if (Number.isFinite(parsed)) {
        seed = parsed >>> 0;
      }
    }
  }
  return { seed, json };
}

function main() {
  const { seed, json } = parseArgs(process.argv.slice(2));
  const scorecard = runAgiBenchmark({ seed });

  if (json) {
    process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  } else {
    process.stdout.write(
      `AGI-OS 8-Axis Benchmark (seed=${scorecard.seed}): composite=${scorecard.compositeScore}/100 constitutionalPass=${scorecard.constitutionalPass} passed=${scorecard.passed}\n`
    );
    for (const axis of scorecard.axes) {
      process.stdout.write(
        `  - [${axis.milestone}] ${axis.axisId}: ${axis.score}/100 (${axis.passed ? 'PASS' : 'FAIL'}) — ${axis.detail}\n`
      );
    }
    process.stdout.write(`  Merkle Root: ${scorecard.merkleRootHash}\n`);
  }

  process.exitCode = scorecard.passed && scorecard.constitutionalPass ? 0 : 1;
}

main();
