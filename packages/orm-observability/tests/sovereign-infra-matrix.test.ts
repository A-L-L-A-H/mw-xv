import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOVEREIGN_INFRA_CONTROLS,
  SOVEREIGN_INFRA_DOMAINS,
  SovereignInfraMatrixEvaluator,
  evaluateSovereignInfraMatrix,
  type SovereignInfraControl,
  type SovereignInfraProbeResult,
} from '../src/sovereign-infra-matrix.js';

function buildPassingProbes(observedAtMs = 1_700_000_000_000): SovereignInfraProbeResult[] {
  return DEFAULT_SOVEREIGN_INFRA_CONTROLS.map((control) => ({
    controlId: control.controlId,
    status: 'pass',
    observedAtMs,
    latencyMs: 12,
    evidence: `${control.domain}:verified`,
  }));
}

describe('SovereignInfraMatrixEvaluator', () => {
  it('covers all 10 sovereign infra and observability domains and reports sovereign_ready when all pass', () => {
    const evaluator = new SovereignInfraMatrixEvaluator();
    const report = evaluator.evaluate(buildPassingProbes(), {
      environment: 'prod-sovereign-id-1',
      evaluatedAtMs: 1_700_000_005_000,
    });

    expect(SOVEREIGN_INFRA_DOMAINS).toHaveLength(10);
    expect(report.overallStatus).toBe('sovereign_ready');
    expect(report.readinessScore).toBe(100);
    expect(report.totalControls).toBe(10);
    expect(report.passedControls).toBe(10);
    expect(report.blockingControlIds).toEqual([]);
    expect(report.unknownProbeIds).toEqual([]);
    expect(report.domains.map((domain) => domain.domain)).toEqual([...SOVEREIGN_INFRA_DOMAINS]);
    expect(report.findings.every((finding) => finding.remediationHint === null)).toBe(true);
  });

  it('blocks readiness when required controls fail or are missing', () => {
    const probes = buildPassingProbes().filter(
      (probe) => probe.controlId !== 'secrets.vault-dynamic-leases'
    );
    const updated = probes.map((probe) =>
      probe.controlId === 'dns.sovereign-split-horizon'
        ? { ...probe, status: 'fail' as const, evidence: 'dnssec:disabled' }
        : probe
    );

    const report = evaluateSovereignInfraMatrix(updated, {
      environment: 'staging-sovereign',
      evaluatedAtMs: 1_700_000_010_000,
    });

    expect(report.overallStatus).toBe('blocked');
    expect(report.failedControls).toBe(1);
    expect(report.missingControls).toBe(1);
    expect(report.readinessScore).toBe(80);
    expect(report.blockingControlIds).toEqual([
      'dns.sovereign-split-horizon',
      'secrets.vault-dynamic-leases',
    ]);

    const dnsDomain = report.domains.find((domain) => domain.domain === 'sovereign_dns');
    expect(dnsDomain?.status).toBe('blocked');
    expect(dnsDomain?.readinessScore).toBe(0);
  });

  it('marks overall status degraded when controls are degraded or optional controls fail', () => {
    const customControls: readonly SovereignInfraControl[] = [
      ...DEFAULT_SOVEREIGN_INFRA_CONTROLS,
      {
        controlId: 'tracing.tail-sampling-advisory',
        domain: 'tracing',
        title: 'Tail-based sampling advisory check',
        tier: 'advisory',
        required: false,
        verificationContract: 'Tail sampling collector active',
        remediationHint: 'Enable tail sampling in collector config',
      },
    ];

    const probes: SovereignInfraProbeResult[] = [
      ...buildPassingProbes().map((probe) =>
        probe.controlId === 'metrics.prometheus-otlp'
          ? { ...probe, status: 'degraded' as const, evidence: 'cardinality:near-cap' }
          : probe
      ),
      {
        controlId: 'tracing.tail-sampling-advisory',
        status: 'fail',
        observedAtMs: 1_700_000_000_000,
      },
    ];

    const report = evaluateSovereignInfraMatrix(probes, {
      environment: 'prod-sovereign-id-1',
      evaluatedAtMs: 1_700_000_020_000,
      controls: customControls,
    });

    expect(report.overallStatus).toBe('degraded');
    expect(report.blockingControlIds).toEqual([]);
    expect(report.degradedControls).toBe(1);
    expect(report.failedControls).toBe(1);
  });

  it('resolves duplicate probes deterministically by latest observedAtMs and tracks unknown probes', () => {
    const baseProbes = buildPassingProbes(1_700_000_000_000);
    const probes: SovereignInfraProbeResult[] = [
      ...baseProbes,
      {
        controlId: 'policy.fail-closed-engine',
        status: 'fail',
        observedAtMs: 1_699_999_999_000,
        evidence: 'stale-failure',
      },
      {
        controlId: 'unknown.probe.b',
        status: 'pass',
        observedAtMs: 1_700_000_000_000,
      },
      {
        controlId: 'unknown.probe.a',
        status: 'pass',
        observedAtMs: 1_700_000_000_000,
      },
    ];

    const report = evaluateSovereignInfraMatrix(probes, {
      environment: 'prod-sovereign-id-1',
      evaluatedAtMs: 1_700_000_030_000,
    });

    expect(report.overallStatus).toBe('sovereign_ready');
    expect(report.unknownProbeIds).toEqual(['unknown.probe.a', 'unknown.probe.b']);
    const policyFinding = report.findings.find(
      (finding) => finding.controlId === 'policy.fail-closed-engine'
    );
    expect(policyFinding?.status).toBe('pass');
    expect(policyFinding?.evidence).toBe('policy_engine:verified');
  });
});
