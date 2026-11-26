export const SOVEREIGN_INFRA_DOMAINS = [
  'health',
  'metrics',
  'structured_logging',
  'tracing',
  'sovereign_dns',
  'mesh_vpn',
  'secrets_vault',
  'backup_dr',
  'policy_engine',
  'event_bus',
] as const;

export type SovereignInfraDomain = (typeof SOVEREIGN_INFRA_DOMAINS)[number];

export type ReadinessTier = 'critical' | 'standard' | 'advisory';

export type ControlStatus = 'pass' | 'degraded' | 'fail' | 'missing';

export type OverallReadinessStatus = 'sovereign_ready' | 'degraded' | 'blocked';

export interface SovereignInfraControl {
  readonly controlId: string;
  readonly domain: SovereignInfraDomain;
  readonly title: string;
  readonly tier: ReadinessTier;
  readonly required: boolean;
  readonly verificationContract: string;
  readonly remediationHint: string;
}

export interface SovereignInfraProbeResult {
  readonly controlId: string;
  readonly status: Exclude<ControlStatus, 'missing'>;
  readonly observedAtMs: number;
  readonly latencyMs?: number;
  readonly evidence?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ControlEvaluationFinding {
  readonly controlId: string;
  readonly domain: SovereignInfraDomain;
  readonly title: string;
  readonly tier: ReadinessTier;
  readonly required: boolean;
  readonly status: ControlStatus;
  readonly blocking: boolean;
  readonly observedAtMs: number | null;
  readonly latencyMs: number | null;
  readonly evidence: string | null;
  readonly remediationHint: string | null;
}

export interface DomainReadinessSummary {
  readonly domain: SovereignInfraDomain;
  readonly totalControls: number;
  readonly passedControls: number;
  readonly degradedControls: number;
  readonly failedControls: number;
  readonly missingControls: number;
  readonly readinessScore: number;
  readonly status: OverallReadinessStatus;
}

export interface SovereignInfraMatrixReport {
  readonly environment: string;
  readonly evaluatedAtMs: number;
  readonly overallStatus: OverallReadinessStatus;
  readonly readinessScore: number;
  readonly totalControls: number;
  readonly passedControls: number;
  readonly degradedControls: number;
  readonly failedControls: number;
  readonly missingControls: number;
  readonly blockingControlIds: readonly string[];
  readonly unknownProbeIds: readonly string[];
  readonly domains: readonly DomainReadinessSummary[];
  readonly findings: readonly ControlEvaluationFinding[];
}

export interface EvaluateSovereignInfraOptions {
  readonly environment: string;
  readonly evaluatedAtMs: number;
  readonly controls?: readonly SovereignInfraControl[];
}

export const DEFAULT_SOVEREIGN_INFRA_CONTROLS: readonly SovereignInfraControl[] = [
  {
    controlId: 'health.liveness-readiness',
    domain: 'health',
    title: 'Liveness & readiness endpoints with dependency probes',
    tier: 'critical',
    required: true,
    verificationContract: 'GET /healthz and /readyz return 200 within 250ms with dependency status map',
    remediationHint: 'Expose deterministic /healthz and /readyz probes checking DB and event bus connectivity',
  },
  {
    controlId: 'metrics.prometheus-otlp',
    domain: 'metrics',
    title: 'Bounded-cardinality Prometheus/OTLP metrics pipeline',
    tier: 'standard',
    required: true,
    verificationContract: 'Metrics exporter emits RED/USE counters and histograms with bounded label sets',
    remediationHint: 'Configure OTLP/Prometheus metrics sink with label cardinality caps',
  },
  {
    controlId: 'logging.structured-redacted',
    domain: 'structured_logging',
    title: 'Structured JSON logging with correlation IDs and PII redaction',
    tier: 'standard',
    required: true,
    verificationContract: 'Logs emit JSON with traceId, spanId, service, level, and redacted secrets/PII',
    remediationHint: 'Route application logs through redactTelemetry with mandatory correlation fields',
  },
  {
    controlId: 'tracing.w3c-distributed',
    domain: 'tracing',
    title: 'W3C distributed trace propagation and span export',
    tier: 'standard',
    required: true,
    verificationContract: 'Inbound/outbound requests propagate traceparent and persist spans to telemetry store',
    remediationHint: 'Enable W3C traceparent middleware and OTLP span exporter',
  },
  {
    controlId: 'dns.sovereign-split-horizon',
    domain: 'sovereign_dns',
    title: 'Sovereign split-horizon DNS with DNSSEC validation',
    tier: 'critical',
    required: true,
    verificationContract: 'Internal zones resolve via sovereign resolver with DNSSEC enabled and zero public leakage',
    remediationHint: 'Point cluster resolvers to sovereign CoreDNS/Unbound with DNSSEC validation',
  },
  {
    controlId: 'vpn.mesh-mtls',
    domain: 'mesh_vpn',
    title: 'Encrypted WireGuard/mTLS mesh VPN with automated key rotation',
    tier: 'critical',
    required: true,
    verificationContract: 'East-west traffic traverses encrypted mesh peers with valid rotating keys',
    remediationHint: 'Enroll nodes into sovereign WireGuard/mTLS mesh and enforce key rotation policy',
  },
  {
    controlId: 'secrets.vault-dynamic-leases',
    domain: 'secrets_vault',
    title: 'Sovereign secrets vault with dynamic leases and audit log',
    tier: 'critical',
    required: true,
    verificationContract: 'Secrets are fetched from encrypted vault with short TTL leases and zero plaintext env files',
    remediationHint: 'Migrate static credentials to sovereign secrets vault with audited dynamic leases',
  },
  {
    controlId: 'backup.dr-verified-restore',
    domain: 'backup_dr',
    title: 'Encrypted point-in-time backups with verified DR restore drills',
    tier: 'critical',
    required: true,
    verificationContract: 'Encrypted backups satisfy RPO/RTO targets and latest restore drill passed verification',
    remediationHint: 'Schedule automated encrypted snapshots and periodic restore verification drills',
  },
  {
    controlId: 'policy.fail-closed-engine',
    domain: 'policy_engine',
    title: 'Deterministic fail-closed policy-as-code engine',
    tier: 'critical',
    required: true,
    verificationContract: 'Policy engine evaluates signed bundles deterministically and fails closed on error',
    remediationHint: 'Deploy signed policy bundle with fail-closed admission and runtime evaluation',
  },
  {
    controlId: 'event_bus.durable-dlq',
    domain: 'event_bus',
    title: 'Durable event bus with schema validation and dead-letter queues',
    tier: 'critical',
    required: true,
    verificationContract: 'Event bus persists messages durably, validates schemas, and routes poison messages to DLQ',
    remediationHint: 'Enable durable streams, schema registry checks, and dead-letter queue consumers',
  },
];

function scoreStatus(status: ControlStatus): number {
  switch (status) {
    case 'pass':
      return 1;
    case 'degraded':
      return 0.5;
    case 'fail':
    case 'missing':
      return 0;
  }
}

function roundScore(ratio: number): number {
  return Math.round(ratio * 10_000) / 100;
}

function resolveStatusFromFindings(findings: readonly ControlEvaluationFinding[]): OverallReadinessStatus {
  if (findings.some((finding) => finding.blocking)) {
    return 'blocked';
  }
  if (
    findings.some(
      (finding) =>
        finding.status === 'degraded' ||
        finding.status === 'fail' ||
        finding.status === 'missing'
    )
  ) {
    return 'degraded';
  }
  return 'sovereign_ready';
}

/**
 * Deterministic evaluator for the Sovereign Infra & Observability Readiness Matrix.
 */
export class SovereignInfraMatrixEvaluator {
  private readonly controls: readonly SovereignInfraControl[];

  public constructor(controls: readonly SovereignInfraControl[] = DEFAULT_SOVEREIGN_INFRA_CONTROLS) {
    this.controls = [...controls];
  }

  public getControls(): readonly SovereignInfraControl[] {
    return [...this.controls];
  }

  public evaluate(
    probes: readonly SovereignInfraProbeResult[],
    options: Omit<EvaluateSovereignInfraOptions, 'controls'>
  ): SovereignInfraMatrixReport {
    const controlIds = new Set(this.controls.map((control) => control.controlId));
    const latestProbeByControlId = new Map<string, SovereignInfraProbeResult>();
    const unknownProbeIdSet = new Set<string>();

    for (const probe of probes) {
      if (!controlIds.has(probe.controlId)) {
        unknownProbeIdSet.add(probe.controlId);
        continue;
      }
      const existing = latestProbeByControlId.get(probe.controlId);
      if (!existing || probe.observedAtMs >= existing.observedAtMs) {
        latestProbeByControlId.set(probe.controlId, probe);
      }
    }

    const domainOrder = new Map<SovereignInfraDomain, number>(
      SOVEREIGN_INFRA_DOMAINS.map((domain, index) => [domain, index])
    );

    const orderedControls = [...this.controls].sort((left, right) => {
      const domainDelta = (domainOrder.get(left.domain) ?? 0) - (domainOrder.get(right.domain) ?? 0);
      if (domainDelta !== 0) {
        return domainDelta;
      }
      return left.controlId.localeCompare(right.controlId);
    });

    const findings: ControlEvaluationFinding[] = orderedControls.map((control) => {
      const probe = latestProbeByControlId.get(control.controlId);
      const status: ControlStatus = probe ? probe.status : 'missing';
      const blocking = control.required && (status === 'fail' || status === 'missing');

      return {
        controlId: control.controlId,
        domain: control.domain,
        title: control.title,
        tier: control.tier,
        required: control.required,
        status,
        blocking,
        observedAtMs: probe ? probe.observedAtMs : null,
        latencyMs: probe?.latencyMs ?? null,
        evidence: probe?.evidence ?? null,
        remediationHint: status === 'pass' ? null : control.remediationHint,
      };
    });

    const domains: DomainReadinessSummary[] = SOVEREIGN_INFRA_DOMAINS.map((domain) => {
      const domainFindings = findings.filter((finding) => finding.domain === domain);
      const totalControls = domainFindings.length;
      const passedControls = domainFindings.filter((finding) => finding.status === 'pass').length;
      const degradedControls = domainFindings.filter((finding) => finding.status === 'degraded').length;
      const failedControls = domainFindings.filter((finding) => finding.status === 'fail').length;
      const missingControls = domainFindings.filter((finding) => finding.status === 'missing').length;
      const scoreSum = domainFindings.reduce((acc, finding) => acc + scoreStatus(finding.status), 0);
      const readinessScore = totalControls > 0 ? roundScore(scoreSum / totalControls) : 100;

      return {
        domain,
        totalControls,
        passedControls,
        degradedControls,
        failedControls,
        missingControls,
        readinessScore,
        status: resolveStatusFromFindings(domainFindings),
      };
    });

    const totalControls = findings.length;
    const passedControls = findings.filter((finding) => finding.status === 'pass').length;
    const degradedControls = findings.filter((finding) => finding.status === 'degraded').length;
    const failedControls = findings.filter((finding) => finding.status === 'fail').length;
    const missingControls = findings.filter((finding) => finding.status === 'missing').length;
    const totalScoreSum = findings.reduce((acc, finding) => acc + scoreStatus(finding.status), 0);
    const readinessScore = totalControls > 0 ? roundScore(totalScoreSum / totalControls) : 100;
    const blockingControlIds = findings
      .filter((finding) => finding.blocking)
      .map((finding) => finding.controlId);
    const unknownProbeIds = [...unknownProbeIdSet].sort((left, right) => left.localeCompare(right));

    return {
      environment: options.environment,
      evaluatedAtMs: options.evaluatedAtMs,
      overallStatus: resolveStatusFromFindings(findings),
      readinessScore,
      totalControls,
      passedControls,
      degradedControls,
      failedControls,
      missingControls,
      blockingControlIds,
      unknownProbeIds,
      domains,
      findings,
    };
  }
}

export function evaluateSovereignInfraMatrix(
  probes: readonly SovereignInfraProbeResult[],
  options: EvaluateSovereignInfraOptions
): SovereignInfraMatrixReport {
  const evaluator = new SovereignInfraMatrixEvaluator(options.controls);
  return evaluator.evaluate(probes, {
    environment: options.environment,
    evaluatedAtMs: options.evaluatedAtMs,
  });
}
