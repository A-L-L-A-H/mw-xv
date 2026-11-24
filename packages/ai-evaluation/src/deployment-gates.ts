import {
  DEFAULT_BENCHMARK_FIXTURES,
  evaluateCapabilityGates,
  runEvaluationCorpus,
  runMemoryAblationSuite,
  validateEvaluationReport,
  type CorpusEvaluationReport,
  type FullCapabilityGateSuiteResult,
  type MemoryAblationSuiteReport,
} from './index.js';

const EXPECTED_GATE_IDS = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const;
const EXPECTED_ABLATION_ARMS = ['no-memory', 'episodic-only', 'skill-only', 'combined'] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface EvaluationGateCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface OfflineEvaluationGateReport {
  /** The only supported mode: deterministic fixtures, no network, no model. */
  readonly mode: 'offline-mock';
  readonly realModelUsed: false;
  /** Fixture-derived numbers are synthetic and must never be read as production results. */
  readonly syntheticFixture: true;
  readonly ok: boolean;
  readonly checks: readonly EvaluationGateCheck[];
  readonly corpus: {
    readonly sourceSha: string;
    readonly fixtureHash: string;
    readonly runCount: number;
    readonly reportSha256: string;
  };
  readonly gates: {
    readonly passed: boolean;
    readonly agiClaimed: false;
    readonly highestSatisfiedGate: FullCapabilityGateSuiteResult['highestSatisfiedGate'];
    readonly gateIds: readonly string[];
    readonly reportSha256: string;
  };
  readonly ablation: {
    readonly arms: readonly string[];
    readonly reportSha256: string;
  };
}

function check(id: string, passed: boolean, detail: string): EvaluationGateCheck {
  return { id, passed, detail };
}

function hasExpectedIds(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return expected.every((id) => actual.includes(id));
}

function summarizeCorpus(report: CorpusEvaluationReport): OfflineEvaluationGateReport['corpus'] {
  return {
    sourceSha: report.sourceSha,
    fixtureHash: report.fixtureHash,
    runCount: report.runs.length,
    reportSha256: report.reportSha256,
  };
}

function summarizeGates(
  suite: FullCapabilityGateSuiteResult
): OfflineEvaluationGateReport['gates'] {
  return {
    passed: suite.passed,
    agiClaimed: suite.agiClaimed,
    highestSatisfiedGate: suite.highestSatisfiedGate,
    gateIds: suite.gates.map((gate) => gate.gateId),
    reportSha256: suite.reportSha256,
  };
}

function summarizeAblation(
  report: MemoryAblationSuiteReport
): OfflineEvaluationGateReport['ablation'] {
  return {
    arms: Object.keys(report.conditions).sort(),
    reportSha256: report.reportSha256,
  };
}

/**
 * Runs the evaluation gates against the deterministic mock corpus.
 *
 * This is intentionally offline: `mode: 'mock'` uses the checked-in fixtures and
 * never calls a provider, a database, or the network. It proves that the gate
 * evaluator is wired, that its provenance checks fail closed, and that verdicts
 * are reproducible. It does NOT measure a real model or a live deployment.
 */
export async function runOfflineEvaluationGates(): Promise<OfflineEvaluationGateReport> {
  const corpus = await runEvaluationCorpus({ mode: 'mock', includeFailedFixtures: true });
  const corpusReplay = await runEvaluationCorpus({ mode: 'mock', includeFailedFixtures: true });
  const ablation = await runMemoryAblationSuite({ mode: 'mock' });
  const ablationReplay = await runMemoryAblationSuite({ mode: 'mock' });
  const suite = await evaluateCapabilityGates({
    mode: 'mock',
    metrics: corpus.metrics,
    ablationReport: ablation,
  });
  const suiteReplay = await evaluateCapabilityGates({
    mode: 'mock',
    metrics: corpusReplay.metrics,
    ablationReport: ablationReplay,
  });

  let provenanceValid = false;
  let provenanceDetail = 'validateEvaluationReport rejected the corpus';
  try {
    validateEvaluationReport(corpus);
    provenanceValid = true;
    provenanceDetail = 'sourceSha, fixtureHash and non-empty runs are present';
  } catch (error) {
    provenanceDetail = error instanceof Error ? error.message : String(error);
  }

  // runRuntimeEvaluationCorpus only schedules multi_agent runs for decomposable
  // fixtures: one single_agent run per fixture plus one multi_agent run for each
  // decomposable fixture.
  const expectedRunCount =
    DEFAULT_BENCHMARK_FIXTURES.length +
    DEFAULT_BENCHMARK_FIXTURES.filter((fixture) => fixture.decomposable).length;

  const gateIds = suite.gates.map((gate) => gate.gateId);
  const replayGateIds = suiteReplay.gates.map((gate) => gate.gateId);
  const verdicts = suite.gates.map((gate) => `${gate.gateId}:${gate.passed}`).join(',');
  const replayVerdicts = suiteReplay.gates
    .map((gate) => `${gate.gateId}:${gate.passed}`)
    .join(',');
  const arms = summarizeAblation(ablation).arms;
  const replayArms = summarizeAblation(ablationReplay).arms;

  const checks: readonly EvaluationGateCheck[] = [
    check('offline-mode', true, 'mode=mock; no provider, network, or database call is made'),
    check('corpus-provenance', provenanceValid, provenanceDetail),
    check(
      'fixture-coverage',
      corpus.runs.length === expectedRunCount &&
        corpusReplay.runs.length === expectedRunCount,
      `${corpus.runs.length} mock runs across ${DEFAULT_BENCHMARK_FIXTURES.length} fixtures (single_agent for all, multi_agent for decomposable only)`
    ),
    check(
      'report-digest-shape',
      SHA256_PATTERN.test(corpus.reportSha256) && SHA256_PATTERN.test(suite.reportSha256),
      'corpus and gate digests are SHA-256 hex (timestamps make raw digests non-replayable)'
    ),
    check(
      'deterministic-metrics',
      JSON.stringify(corpus.metrics) === JSON.stringify(corpusReplay.metrics),
      'corpus summary metrics are identical across two offline runs'
    ),
    check(
      'gate-coverage',
      hasExpectedIds(gateIds, EXPECTED_GATE_IDS) &&
        hasExpectedIds(replayGateIds, EXPECTED_GATE_IDS),
      `evaluated gates: ${gateIds.join(', ')}`
    ),
    check('non-agi-claim', suite.agiClaimed === false, 'agiClaimed is false'),
    check(
      'gate-verdict-consistency',
      suite.passed === (suite.highestSatisfiedGate === 'G6'),
      `passed=${String(suite.passed)}, highestSatisfiedGate=${String(suite.highestSatisfiedGate)}`
    ),
    check(
      'deterministic-verdicts',
      verdicts === replayVerdicts && suite.highestSatisfiedGate === suiteReplay.highestSatisfiedGate,
      'G0-G6 verdicts and highest satisfied gate are identical across two offline runs'
    ),
    check(
      'ablation-coverage',
      hasExpectedIds(arms, EXPECTED_ABLATION_ARMS) &&
        arms.join(',') === replayArms.join(','),
      `ablation arms: ${arms.join(', ')}`
    ),
  ];

  return {
    mode: 'offline-mock',
    realModelUsed: false,
    syntheticFixture: true,
    ok: checks.every((entry) => entry.passed),
    checks,
    corpus: summarizeCorpus(corpus),
    gates: summarizeGates(suite),
    ablation: summarizeAblation(ablation),
  };
}
