import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { registerLocalModel } from './register-model.mjs';
import { loadCorpusGoldenFixtures, runLocalAiEval } from './eval.mjs';
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

  it('passes all offline golden and corpus manifest evaluation cases with zero failures', async () => {
    const fixtures = await loadCorpusGoldenFixtures();
    assert.ok(fixtures.length >= 2);
    const report = await runLocalAiEval({ model: 'qwen2.5:3b-instruct-q4_K_M' });
    assert.ok(report.totalCases >= 32 + fixtures.length * 4 + 1);
    assert.equal(report.byCategory.corpus_manifest_fidelity.total, fixtures.length * 4 + 1);
    assert.equal(report.failedCases, 0);
    assert.equal(report.passedCases, report.totalCases);
  });

  it('auto-expands corpus_manifest_fidelity fixtures when a new manifest is added', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mw-local-ai-corpus-'));
    tempDirectories.push(tempRoot);
    await cp(path.resolve('corpus'), path.join(tempRoot, 'corpus'), { recursive: true });

    const extraText = 'Al-Adl witness concordance entry';
    const extraBytes = Buffer.from(`${extraText}\n`, 'utf8');
    const extraSha = createHash('sha256').update(extraBytes).digest('hex');
    const artifactDir = path.join(tempRoot, 'corpus/reference/sha256', extraSha.slice(0, 2));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(artifactDir, extraSha), extraBytes);
    await writeFile(
      path.join(tempRoot, 'corpus/manifests/extra-concordance-witness.json'),
      JSON.stringify({
        schema_version: 1,
        source_id: 'mw:source:extra-concordance',
        edition_id: 'mw:edition:extra-concordance-v1',
        artifact: { sha256: extraSha, byte_length: extraBytes.byteLength },
        rights: { state: 'permitted', allowed_uses: ['read_analyze'] },
        attribution: { text: 'Extra Golden Corpus Fixture' },
      }),
      'utf8'
    );

    const baselineReport = await runLocalAiEval({ model: 'baseline' });
    const expandedReport = await runLocalAiEval({
      model: 'candidate-expanded',
      repositoryRoot: tempRoot,
    });
    assert.equal(expandedReport.failedCases, 0);
    assert.equal(expandedReport.totalCases, baselineReport.totalCases + 4);
    assert.equal(
      expandedReport.byCategory.corpus_manifest_fidelity.total,
      baselineReport.byCategory.corpus_manifest_fidelity.total + 4
    );
  });

  it('promotes equal-or-better reports and blocks regressions or shrunk corpus coverage in tournament comparison', async () => {
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

    const shrunkCandidate = {
      ...baseline,
      model: 'candidate-shrunk',
      totalCases: baseline.totalCases - 4,
      passedCases: baseline.passedCases - 4,
      byCategory: {
        ...baseline.byCategory,
        corpus_manifest_fidelity: {
          passed: baseline.byCategory.corpus_manifest_fidelity.passed - 4,
          total: baseline.byCategory.corpus_manifest_fidelity.total - 4,
        },
      },
    };
    const shrunkVerdict = compareEvalReports(baseline, shrunkCandidate);
    assert.equal(shrunkVerdict.promote, false);
    assert.ok(
      shrunkVerdict.regressions.some((entry) => entry.includes('corpus_manifest_fidelity'))
    );
  });
});
