import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { registerLocalModel } from './register-model.mjs';
import { runLocalAiEval } from './eval.mjs';
import { compareEvalReports } from './tournament.mjs';

const tempDirectories = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe('Wave 3 Local AI CLI & evaluation harness', () => {
  it('registers a model stored outside the Git worktree into a validated registry in dry-run', async () => {
    const externalDir = await mkdtemp(path.join(os.tmpdir(), 'mw-local-ai-model-'));
    tempDirectories.push(externalDir);
    const modelDir = path.join(externalDir, 'qwen');
    await mkdir(modelDir, { recursive: true });
    const modelFile = path.join(modelDir, 'qwen2.5-3b-q4.gguf');
    await writeFile(modelFile, Buffer.from('synthetic-gguf-weights-header'));

    const outcome = await registerLocalModel({
      file: modelFile,
      storageRoot: externalDir,
      id: 'qwen2.5-3b-instruct-q4',
      version: '1.0.0',
      sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF',
      license: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      reviewRef: 'local-test',
      minRam: 8,
      minVram: null,
      registry: path.resolve('packages/local-ai/model-registry.json'),
      activate: true,
      dryRun: true,
    });

    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.verification.valid, true);
    assert.equal(outcome.registry.activeArtifactId, 'qwen2.5-3b-instruct-q4');
  });

  it('passes all 32 offline golden evaluation cases with zero failures', async () => {
    const report = await runLocalAiEval({ model: 'qwen2.5:3b-instruct-q4_K_M' });
    assert.ok(report.totalCases >= 30);
    assert.equal(report.failedCases, 0);
    assert.equal(report.passedCases, report.totalCases);
  });

  it('promotes equal-or-better reports and blocks regressions in tournament comparison', async () => {
    const baseline = await runLocalAiEval({ model: 'baseline' });
    const equalCandidate = { ...baseline, model: 'candidate-equal' };
    const equalVerdict = compareEvalReports(baseline, equalCandidate);
    assert.equal(equalVerdict.promote, true);

    const regressedCandidate = {
      ...baseline,
      model: 'candidate-regressed',
      passedCases: baseline.passedCases - 1,
      failedCases: 1,
      byCategory: {
        ...baseline.byCategory,
        prompt_injection_refusal: {
          ...baseline.byCategory.prompt_injection_refusal,
          passed: baseline.byCategory.prompt_injection_refusal.passed - 1,
        },
      },
    };
    const regressedVerdict = compareEvalReports(baseline, regressedCandidate);
    assert.equal(regressedVerdict.promote, false);
    assert.ok(regressedVerdict.regressions.length >= 2);
  });
});
