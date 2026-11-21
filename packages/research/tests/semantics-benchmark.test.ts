import { describe, expect, it } from 'vitest';
import canonicalFixtures from '../../../docs/knowledge/semantics-benchmark-fixtures.json' with { type: 'json' };
import {
  compareSemanticsBenchmarkReports,
  runSemanticsBenchmarkSuite,
  SemanticsBenchmarkValidationError,
  validateHistoricalCountReconciliation,
  validateSemanticsBenchmarkSuite,
  type SemanticsBenchmarkSuite,
} from '../src/index.js';

function cloneFixtures(): SemanticsBenchmarkSuite {
  return JSON.parse(JSON.stringify(canonicalFixtures)) as SemanticsBenchmarkSuite;
}

describe('semantics benchmark and drift ledger', () => {
  it('evaluates the versioned synthetic fixture suite deterministically with distinct non-measured slices', async () => {
    expect(validateSemanticsBenchmarkSuite(canonicalFixtures)).toEqual({ valid: true, issues: [] });

    const first = await runSemanticsBenchmarkSuite(canonicalFixtures);
    const second = await runSemanticsBenchmarkSuite(canonicalFixtures);

    expect(first.report_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.report_digest).toBe(second.report_digest);
    expect(first.verdict).toBe('incomplete');
    expect(first.metrics).toEqual({
      total_cases: 7,
      evaluated_cases: 4,
      matched_cases: 4,
      mismatched_cases: 0,
      empty_cases: 1,
      unsupported_cases: 1,
      unknown_cases: 1,
      precision: 1,
      error_rate: 0,
    });
    expect(first.historical_reconciliations).toHaveLength(1);
    expect(first.historical_reconciliations[0]).toMatchObject({
      record_id: 'mw:count-reconciliation:asma-1751-vs-1754-audit',
      reconciliation_status: 'discrepancy_recorded',
      discrepancy_delta: 3,
    });
  });

  it('produces passed verdict only when all cases are measured and matched, and zero_drift when identical', async () => {
    const suite = cloneFixtures();
    const measuredOnly: SemanticsBenchmarkSuite = {
      ...suite,
      cases: suite.cases.filter((entry) => entry.input_state === 'measured'),
    };

    const baseline = await runSemanticsBenchmarkSuite(measuredOnly);
    const candidate = await runSemanticsBenchmarkSuite(measuredOnly);

    expect(baseline.verdict).toBe('passed');
    expect(baseline.metrics.precision).toBe(1);
    expect(baseline.metrics.error_rate).toBe(0);

    const ledger = compareSemanticsBenchmarkReports(baseline, candidate);
    expect(ledger.status).toBe('zero_drift');
    expect(ledger.has_regression).toBe(false);
    expect(ledger.drifts).toEqual([]);
    expect(ledger.ledger_digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('never invents a benchmark pass for empty-only, unsupported, or unknown suites', async () => {
    const suite = cloneFixtures();
    const noMeasured: SemanticsBenchmarkSuite = {
      ...suite,
      cases: suite.cases.filter((entry) => entry.input_state !== 'measured'),
    };

    const report = await runSemanticsBenchmarkSuite(noMeasured);
    expect(report.verdict).toBe('no_measured_cases');
    expect(report.metrics).toEqual({
      total_cases: 3,
      evaluated_cases: 0,
      matched_cases: 0,
      mismatched_cases: 0,
      empty_cases: 1,
      unsupported_cases: 1,
      unknown_cases: 1,
      precision: null,
      error_rate: null,
    });
  });

  it('detects polarity, speaker, alignment, and concept regression drifts', async () => {
    const baselineSuite = cloneFixtures();
    const baselineReport = await runSemanticsBenchmarkSuite(baselineSuite);

    const driftedSuite = cloneFixtures();
    const mutableCases = driftedSuite.cases as Array<Record<string, unknown>>;

    // 1. Polarity drift: flip negative narration to unreviewed/candidate so projection drops to review_required.
    const sem01 = mutableCases.find((entry) => entry.case_id === 'SEM-01-negative-narration');
    if (!sem01) throw new Error('missing SEM-01');
    const sem01Payload = sem01.payload as { annotation: Record<string, unknown> };
    sem01Payload.annotation.review_status = 'candidate';

    // 2. Speaker drift: change speaker_id on direct quote while keeping annotation valid.
    const sem02 = mutableCases.find((entry) => entry.case_id === 'SEM-02-direct-quote-speaker');
    if (!sem02) throw new Error('missing SEM-02');
    const sem02Payload = sem02.payload as {
      annotation: { context: Record<string, unknown> };
    };
    sem02Payload.annotation.context.speaker_id = 'mw:agent:drifted-speaker-2';

    // 3. Alignment drift: swap right passage tradition to match left so alignment rejects fail-closed.
    const aln01 = mutableCases.find((entry) => entry.case_id === 'ALN-01-parallel-candidate');
    if (!aln01) throw new Error('missing ALN-01');
    const aln01Payload = aln01.payload as {
      passages: Record<string, Record<string, unknown>>;
    };
    aln01Payload.passages['mw:evidence:bench-right-1'].tradition_context_id =
      'mw:tradition:synthetic-alpha';

    // 4. Concept drift: break concept profile format so structural validation fails.
    const cpt01 = mutableCases.find((entry) => entry.case_id === 'CPT-01-scoped-profile-valid');
    if (!cpt01) throw new Error('missing CPT-01');
    const cpt01Payload = cpt01.payload as { document: Record<string, unknown> };
    cpt01Payload.document.format = 'moonwitness-concept-profiles/v99';

    const candidateReport = await runSemanticsBenchmarkSuite(driftedSuite);
    expect(candidateReport.verdict).toBe('failed');
    expect(candidateReport.metrics.matched_cases).toBe(0);
    expect(candidateReport.metrics.mismatched_cases).toBe(4);
    expect(candidateReport.metrics.precision).toBe(0);
    expect(candidateReport.metrics.error_rate).toBe(1);

    const ledger = compareSemanticsBenchmarkReports(baselineReport, candidateReport);
    expect(ledger.status).toBe('regression_detected');
    expect(ledger.has_regression).toBe(true);
    expect(ledger.drifts.some((item) => item.kind === 'polarity_drift' && item.regression)).toBe(
      true
    );
    expect(ledger.drifts.some((item) => item.kind === 'speaker_drift' && item.regression)).toBe(
      true
    );
    expect(ledger.drifts.some((item) => item.kind === 'alignment_drift' && item.regression)).toBe(
      true
    );
    expect(ledger.drifts.some((item) => item.kind === 'concept_drift' && item.regression)).toBe(
      true
    );
    expect(ledger.drifts.some((item) => item.kind === 'verdict_drift' && item.regression)).toBe(
      true
    );
  });

  it('detects coverage drift when cases are removed or moved to unsupported', async () => {
    const baselineReport = await runSemanticsBenchmarkSuite(canonicalFixtures);
    const modified = cloneFixtures();
    const cases = modified.cases.filter((entry) => entry.case_id !== 'CPT-01-scoped-profile-valid');
    const candidateReport = await runSemanticsBenchmarkSuite({ ...modified, cases });

    const ledger = compareSemanticsBenchmarkReports(baselineReport, candidateReport);
    expect(ledger.has_regression).toBe(true);
    expect(
      ledger.drifts.some(
        (item) =>
          item.case_id === 'CPT-01-scoped-profile-valid' &&
          item.kind === 'coverage_drift' &&
          item.regression
      )
    ).toBe(true);
  });

  it('enforces fail-closed validation on malformed suites, tampered digests, and unverified count reconciliations', async () => {
    const duplicateIds = cloneFixtures();
    (duplicateIds.cases as Array<Record<string, unknown>>).push({
      case_id: 'SEM-01-negative-narration',
      domain: 'polarity_speaker',
      input_state: 'empty',
    });
    expect(validateSemanticsBenchmarkSuite(duplicateIds).valid).toBe(false);
    await expect(runSemanticsBenchmarkSuite(duplicateIds)).rejects.toThrow(
      SemanticsBenchmarkValidationError
    );

    const nonMeasuredWithPayload = cloneFixtures();
    (nonMeasuredWithPayload.cases[4] as unknown as Record<string, unknown>).payload = {
      unexpected: true,
    };
    expect(validateSemanticsBenchmarkSuite(nonMeasuredWithPayload).valid).toBe(false);

    const extraFieldSuite = { ...cloneFixtures(), unauthorized_flag: true };
    expect(validateSemanticsBenchmarkSuite(extraFieldSuite).valid).toBe(false);

    const validReport = await runSemanticsBenchmarkSuite(canonicalFixtures);
    const tamperedReport = {
      ...validReport,
      metrics: { ...validReport.metrics, matched_cases: 999 },
    };
    expect(() => compareSemanticsBenchmarkReports(validReport, tamperedReport)).toThrow(
      SemanticsBenchmarkValidationError
    );

    expect(
      validateHistoricalCountReconciliation({
        record_id: 'mw:count-reconciliation:bad-claim',
        topic: 'Asma 1751 vs 1754',
        reconciliation_status: 'reconciled_with_evidence',
        observations: [
          {
            source_label: 'a',
            count: 1751,
            artifact_ref: 'ref-a',
            observation_state: 'historical_unverified',
          },
          {
            source_label: 'b',
            count: 1754,
            artifact_ref: 'ref-b',
            observation_state: 'historical_unverified',
          },
        ],
        resolution_note: 'Should fail because counts differ and remain unverified.',
      }).valid
    ).toBe(false);
  });
});
