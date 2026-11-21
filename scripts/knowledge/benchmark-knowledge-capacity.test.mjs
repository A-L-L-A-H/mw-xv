import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLatencyStats, runCapacityBenchmark } from './benchmark-knowledge-capacity.mjs';

test('computeLatencyStats orders percentiles deterministically and rejects empty samples', () => {
  const stats = computeLatencyStats([10, 2, 5, 1, 8, 3, 7, 4, 6, 9]);
  assert.equal(stats.iterations, 10);
  assert.equal(stats.minMs, 1);
  assert.equal(stats.maxMs, 10);
  assert.ok(stats.p50Ms <= stats.p95Ms);
  assert.throws(() => computeLatencyStats([]), /non-empty array/u);
});

test('runCapacityBenchmark emits honest synthetic-only boundaries and measured workload metrics', async () => {
  const report = await runCapacityBenchmark();
  assert.equal(report.contract, 'mw:k9-005:capacity-benchmark:v1');
  assert.equal(report.boundaries.aiMode, 'disabled');
  assert.equal(report.boundaries.localModelConfigured, false);
  assert.equal(report.boundaries.postgresConnected, false);
  assert.equal(report.boundaries.fullScaleProductionMeasured, false);
  assert.equal(report.workloads.canonicalHash1k.iterations, 1000);
  assert.ok(report.workloads.canonicalHash1k.opsPerSec > 0);
  assert.equal(report.workloads.childProtectionGate500.iterations, 500);
});
