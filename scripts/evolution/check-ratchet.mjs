import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRepositoryFitness } from './fitness-score.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Compares current repository metrics against the persisted ratchet baseline and fails
 * on any architectural or test regression.
 */
export function compareFitnessRatchet(baseline, current) {
  const regressions = [];
  if (current.legacyAllowlistCount > baseline.legacyAllowlistCount) {
    regressions.push(
      `legacyAllowlistCount regressed (${current.legacyAllowlistCount} > ${baseline.legacyAllowlistCount})`
    );
  }
  if (current.apiRouteMaxLoc > baseline.apiRouteMaxLoc) {
    regressions.push(
      `apiRouteMaxLoc regressed (${current.apiRouteMaxLoc} > ${baseline.apiRouteMaxLoc})`
    );
  }
  if (current.compositeScore < baseline.compositeScore) {
    regressions.push(
      `compositeScore regressed (${current.compositeScore} < ${baseline.compositeScore})`
    );
  }

  return {
    format: 'moonwitness-ratchet-check/v1',
    passed: regressions.length === 0,
    regressions,
    baselineComposite: baseline.compositeScore,
    currentComposite: current.compositeScore,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const snapshotPath = path.join(defaultRoot, 'evolution/fitness-snapshot.json');
  const baseline = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const current = await computeRepositoryFitness({ repositoryRoot: defaultRoot });
  const verdict = compareFitnessRatchet(baseline, current);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  if (!verdict.passed) process.exitCode = 1;
}
