#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runComplianceAudit } from './verify-compliance-scan.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const knowledgeEntry = new URL('../../packages/knowledge/dist/src/index.js', import.meta.url);
const researchEntry = new URL('../../packages/research/dist/index.js', import.meta.url);
const benchmarkFixturesPath = path.join(
  repositoryRoot,
  'docs/knowledge/semantics-benchmark-fixtures.json'
);

export function computeLatencyStats(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length === 0) {
    throw new Error('samplesMs must be a non-empty array');
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const percentile = (fraction) => {
    const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
    return Number(sorted[index].toFixed(3));
  };
  const totalMs = sorted.reduce((acc, value) => acc + value, 0);
  return {
    iterations: sorted.length,
    totalMs: Number(totalMs.toFixed(3)),
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
    opsPerSec: totalMs > 0 ? Number(((sorted.length * 1000) / totalMs).toFixed(2)) : 0,
  };
}

async function measureSync(iterations, fn) {
  const beforeMem = process.memoryUsage();
  const samplesMs = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn(i);
    samplesMs.push(performance.now() - start);
  }
  const afterMem = process.memoryUsage();
  return {
    ...computeLatencyStats(samplesMs),
    rssMiB: Number((afterMem.rss / (1024 * 1024)).toFixed(2)),
    heapDeltaMiB: Number(((afterMem.heapUsed - beforeMem.heapUsed) / (1024 * 1024)).toFixed(2)),
  };
}

async function measureAsync(iterations, fn) {
  const beforeMem = process.memoryUsage();
  const samplesMs = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn(i);
    samplesMs.push(performance.now() - start);
  }
  const afterMem = process.memoryUsage();
  return {
    ...computeLatencyStats(samplesMs),
    rssMiB: Number((afterMem.rss / (1024 * 1024)).toFixed(2)),
    heapDeltaMiB: Number(((afterMem.heapUsed - beforeMem.heapUsed) / (1024 * 1024)).toFixed(2)),
  };
}

function buildSyntheticAssertions(count) {
  const assertions = [];
  const evidence = [];
  for (let i = 0; i < count; i += 1) {
    const id = `mw:assertion:cap-${String(i).padStart(4, '0')}`;
    const group = i % 10;
    assertions.push({
      id,
      kind: 'Assertion',
      schema_version: 1,
      lifecycle: 'candidate',
      created_at: '2026-10-16T00:00:00Z',
      updated_at: '2026-10-16T00:00:00Z',
      origin_ref: 'mw:source:synthetic-capacity',
      visibility: 'PUBLIC_APPROVED',
      content_revision: 1,
      claim: `Synthetic capacity benchmark claim group ${group} variant ${i % 3}`,
      polarity: 'positive',
      scope: { kind: 'work', reference_id: `mw:work:group-${group}` },
      context: { mode: 'analysis', reference_id: `mw:work:group-${group}` },
      epistemic_status: 'hypothesized',
      review_status: 'unreviewed',
    });
    evidence.push({
      id: `mw:evidence:cap-${String(i).padStart(4, '0')}`,
      assertion_id: id,
      direction: 'supporting',
      visibility: 'PUBLIC_APPROVED',
      selector: {
        source_id: 'mw:source:tanzil-quran-text',
        edition_id: 'mw:edition:tanzil-quran-text-v1.1-uthmani-txt2',
        locator: 'Q7:46',
        content_sha256: 'a'.repeat(64),
      },
    });
  }
  return { assertions, evidence };
}

export async function runCapacityBenchmark() {
  const { hashCanonicalJson } = await import(knowledgeEntry.href);
  const {
    evaluateChildProtectionAndPublicationGate,
    findDuplicateCandidates,
    runSemanticsBenchmarkSuite,
  } = await import(researchEntry.href);

  const canonicalFixtures = JSON.parse(await readFile(benchmarkFixturesPath, 'utf8'));
  const duplicateDataset = buildSyntheticAssertions(100);
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });

  const hashPayload = {
    schema_version: 1,
    kind: 'SyntheticCapacityRecord',
    tags: Array.from({ length: 16 }, (_, idx) => `tag-${idx}`),
    body: 'Synthetic deterministic payload without user PII. '.repeat(12),
  };

  const canonicalHashMetrics = await measureSync(1000, (index) => {
    hashCanonicalJson({ ...hashPayload, sequence: index });
  });

  const semanticsSuiteMetrics = await measureAsync(25, async () => {
    const report = await runSemanticsBenchmarkSuite(canonicalFixtures);
    if (!report.report_digest) {
      throw new Error('Missing report digest');
    }
  });

  const duplicateCandidateMetrics = await measureSync(10, () => {
    findDuplicateCandidates({
      assertions: duplicateDataset.assertions,
      evidence: duplicateDataset.evidence,
      maxPairs: 500,
    });
  });

  const childProtectionMetrics = await measureSync(500, (index) => {
    evaluateChildProtectionAndPublicationGate({
      schema_version: 1,
      record_id: `mw:bug-case:cap-${index}`,
      classification: index % 2 === 0 ? 'INTERNAL' : 'CHILD_SENSITIVE',
      inherited_classifications: [],
      program_slot: index % 2 === 0 ? 1 : 13,
      minor_involved: index % 2 !== 0,
      synthetic: true,
      requested_channel: 'public_projection',
      safeguarding_process_approved: false,
      candidate_payload: {
        summary: 'Synthetic capacity evaluation payload.',
      },
    });
  });

  const complianceScanMetrics = await measureAsync(3, async () => {
    const audit = await runComplianceAudit();
    if (!audit.passed) {
      throw new Error('Compliance audit failed during capacity run');
    }
  });

  const cpus = os.cpus();
  return {
    contract: 'mw:k9-005:capacity-benchmark:v1',
    measuredAt: new Date().toISOString(),
    sourceSha: gitHead.status === 0 ? gitHead.stdout.trim() : 'unknown',
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuModel: cpus[0]?.model ?? 'unknown',
      cpuCores: cpus.length,
      totalMemoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
    },
    boundaries: {
      datasetScope: 'synthetic-fixtures-and-pinned-sample-corpus-only',
      aiMode: 'disabled',
      localModelConfigured: false,
      postgresConnected: false,
      fullScaleProductionMeasured: false,
    },
    workloads: {
      canonicalHash1k: canonicalHashMetrics,
      semanticsSuite25x7Cases: semanticsSuiteMetrics,
      duplicateCandidates10x100Assertions: duplicateCandidateMetrics,
      childProtectionGate500: childProtectionMetrics,
      complianceAudit3x: complianceScanMetrics,
    },
  };
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const report = await runCapacityBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
