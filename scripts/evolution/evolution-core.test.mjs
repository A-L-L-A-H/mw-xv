import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { checkConstitution } from './check-constitution.mjs';
import { compareFitnessRatchet } from './check-ratchet.mjs';
import { computeRepositoryFitness } from './fitness-score.mjs';
import { recordPostmortem } from './record-postmortem.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Wave 4 Autonomous Self-Evolving Core', () => {
  it('passes constitutional checks on the live repository cleanly', async () => {
    const verdict = await checkConstitution();
    assert.equal(verdict.passed, true);
    assert.deepEqual(verdict.violations, []);
  });

  it('blocks evolution/PAUSE kill-switch when --enforce-pause is enabled and blocks constitutional file edits', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-evo-const-'));
    tempDirs.push(dir);

    await mkdir(path.join(dir, 'evolution'), { recursive: true });
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await mkdir(path.join(dir, 'packages/local-ai/tests'), { recursive: true });

    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '24.x' } }));
    await writeFile(
      path.join(dir, 'scripts/check-api-addon-boundary.mjs'),
      'const LEGACY_MODEL_ALLOWLIST = new Set();\nconst LEGACY_ADDON_ALLOWLIST = new Set();\n'
    );
    await writeFile(path.join(dir, 'evolution/PAUSE'), '');
    await writeFile(path.join(dir, 'packages/local-ai/tests/prompt-injection.test.ts'), 'test\n');

    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    await writeFile(
      path.join(dir, 'packages/local-ai/tests/prompt-injection.test.ts'),
      'tampered\n'
    );

    const verdict = await checkConstitution({ repositoryRoot: dir, enforcePause: true });
    assert.equal(verdict.passed, false);
    assert.equal(verdict.violations.length, 2);
  });

  it('computes repository fitness and preserves upper-bound ratchet gates while allowing lower fitness', async () => {
    const metrics = await computeRepositoryFitness();
    assert.ok(metrics.addonPackageCount >= 8);
    assert.equal(metrics.legacyAllowlistCount, 0);
    assert.ok(metrics.testFileCount >= 10);

    const passVerdict = compareFitnessRatchet(metrics, metrics);
    assert.equal(passVerdict.passed, true);

    const downwardVerdict = compareFitnessRatchet(metrics, {
      ...metrics,
      compositeScore: metrics.compositeScore - 1,
    });
    assert.equal(downwardVerdict.passed, true);
    assert.deepEqual(downwardVerdict.regressions, []);
    assert.equal(downwardVerdict.currentComposite, metrics.compositeScore - 1);

    const regressedVerdict = compareFitnessRatchet(metrics, {
      ...metrics,
      apiRouteMaxLoc: metrics.apiRouteMaxLoc + 10,
      compositeScore: metrics.compositeScore - 1,
    });
    assert.equal(regressedVerdict.passed, false);
    assert.equal(regressedVerdict.regressions.length, 1);
    assert.match(regressedVerdict.regressions[0], /^apiRouteMaxLoc regressed/);
  });

  it('appends deduplicated post-mortem invariants to markdown', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-evo-pm-'));
    tempDirs.push(dir);
    const mdPath = path.join(dir, 'learned-invariants.md');

    const first = await recordPostmortem({
      id: 'INV-900',
      title: 'Deterministic JSONL ordering',
      symptom: 'Metrics order fluctuated',
      rootCause: 'Unsorted glob read',
      invariant: 'Sort file paths lexicographically before hashing',
      file: mdPath,
    });
    const second = await recordPostmortem({
      id: 'INV-900',
      title: 'Duplicate ignored',
      symptom: 'x',
      rootCause: 'y',
      invariant: 'z',
      file: mdPath,
    });

    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    assert.equal(second.reason, 'duplicate_id');
    const contents = await readFile(mdPath, 'utf8');
    assert.ok(contents.includes('## INV-900: Deterministic JSONL ordering'));
  });
});
