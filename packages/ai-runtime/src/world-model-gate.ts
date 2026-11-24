import { createRedactor, type RedactionContext } from './redaction.js';
import { clampBps } from './sort-utils.js';
import { sha256Hex, toCanonicalJson as canonicalJson } from './canonical-json.js';

export type WorldModelReasonCode = 'UNEXPECTED_SIDE_EFFECT' | 'PREDICTION_MISMATCH';

export type WorldModelFindingCategory =
  'changed_files' | 'http_health' | 'container_health' | 'invariant';

export interface ExpectedHttpHealthCheck {
  readonly endpoint: string;
  readonly expectedHealthy: boolean;
  readonly expectedStatusCode?: number;
}

export interface ObservedHttpHealthCheck {
  readonly endpoint: string;
  readonly healthy: boolean;
  readonly statusCode?: number;
  readonly detail?: string;
}

export interface ExpectedContainerHealthCheck {
  readonly containerName: string;
  readonly expectedHealthy: boolean;
  readonly expectedState?: string;
}

export interface ObservedContainerHealthCheck {
  readonly containerName: string;
  readonly healthy: boolean;
  readonly state?: string;
  readonly detail?: string;
}

export interface ExpectedWorldInvariant {
  readonly id: string;
  readonly description?: string;
  readonly expectedPass: boolean;
  readonly expectedValue?: string;
}

export interface ObservedWorldInvariant {
  readonly id: string;
  readonly passed: boolean;
  readonly observedValue?: string;
  readonly detail?: string;
}

export interface WorldModelPrediction {
  readonly predictionId?: string;
  readonly companyId?: number;
  readonly runId?: string;
  readonly actionSummary?: string;
  readonly expectedChangedFiles?: readonly string[];
  readonly expectedHttpHealth?: readonly ExpectedHttpHealthCheck[];
  readonly expectedContainerHealth?: readonly ExpectedContainerHealthCheck[];
  readonly expectedInvariants?: readonly ExpectedWorldInvariant[];
}

export interface WorldModelObservation {
  readonly observedAt?: string;
  readonly observedChangedFiles?: readonly string[];
  readonly observedHttpHealth?: readonly ObservedHttpHealthCheck[];
  readonly observedContainerHealth?: readonly ObservedContainerHealthCheck[];
  readonly observedInvariants?: readonly ObservedWorldInvariant[];
}

export interface WorldModelFinding {
  readonly reasonCode: WorldModelReasonCode;
  readonly category: WorldModelFindingCategory;
  readonly target: string;
  readonly expected?: string;
  readonly observed?: string;
  readonly message: string;
}

export interface WorldModelObligationProposal {
  readonly kind: 'ai.obligation';
  readonly proposalId: string;
  readonly companyId?: number;
  readonly runId?: string;
  readonly title: string;
  readonly summary: string;
  readonly surpriseScoreBps: number;
  readonly thresholdBps: number;
  readonly reasonCodes: readonly WorldModelReasonCode[];
  readonly affectedTargets: readonly string[];
  readonly advisoryOnly: true;
  readonly automatedSelfAccept: false;
}

export interface WorldModelConsistencyReport {
  readonly consistent: boolean;
  readonly surpriseScoreBps: number;
  readonly thresholdBps: number;
  readonly reasonCodes: readonly WorldModelReasonCode[];
  readonly findings: readonly WorldModelFinding[];
  readonly obligationProposal: WorldModelObligationProposal | null;
  readonly automatedSelfAccept: false;
  readonly reportSha256: string;
}

export interface EvaluateWorldModelConsistencyOptions {
  readonly thresholdBps?: number;
  readonly redactor?: RedactionContext;
}

const DEFAULT_SURPRISE_THRESHOLD_BPS = 2500;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '').trim();
}

export function evaluateWorldModelConsistency(
  prediction: WorldModelPrediction,
  observation: WorldModelObservation,
  options: EvaluateWorldModelConsistencyOptions = {}
): WorldModelConsistencyReport {
  const redactor = options.redactor ?? createRedactor();
  const thresholdBps = clampBps(options.thresholdBps ?? DEFAULT_SURPRISE_THRESHOLD_BPS);

  const findings: WorldModelFinding[] = [];
  let totalChecks = 0;
  let mismatchedChecks = 0;

  // 1. File changes comparison (Forward-Inverse delta)
  const expectedFiles = new Set(
    (prediction.expectedChangedFiles ?? []).map(normalizePath).filter((p) => p.length > 0)
  );
  const observedFiles = new Set(
    (observation.observedChangedFiles ?? []).map(normalizePath).filter((p) => p.length > 0)
  );

  const allFiles = [...new Set([...expectedFiles, ...observedFiles])].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const filePath of allFiles) {
    totalChecks += 1;
    const isExpected = expectedFiles.has(filePath);
    const isObserved = observedFiles.has(filePath);
    const safePath = redactor.redactString(filePath);

    if (!isExpected && isObserved) {
      mismatchedChecks += 1;
      findings.push({
        reasonCode: 'UNEXPECTED_SIDE_EFFECT',
        category: 'changed_files',
        target: safePath,
        expected: 'unchanged',
        observed: 'modified',
        message: `Unexpected file modification detected outside predicted post-state: ${safePath}`,
      });
    } else if (isExpected && !isObserved) {
      mismatchedChecks += 1;
      findings.push({
        reasonCode: 'PREDICTION_MISMATCH',
        category: 'changed_files',
        target: safePath,
        expected: 'modified',
        observed: 'unchanged',
        message: `Expected file modification did not occur: ${safePath}`,
      });
    }
  }

  // 2. HTTP health checks
  const expectedHttpMap = new Map<string, ExpectedHttpHealthCheck>();
  for (const check of prediction.expectedHttpHealth ?? []) {
    expectedHttpMap.set(check.endpoint.trim(), check);
  }
  const observedHttpMap = new Map<string, ObservedHttpHealthCheck>();
  for (const check of observation.observedHttpHealth ?? []) {
    observedHttpMap.set(check.endpoint.trim(), check);
  }

  const allEndpoints = [...new Set([...expectedHttpMap.keys(), ...observedHttpMap.keys()])].sort(
    (a, b) => a.localeCompare(b)
  );

  for (const endpoint of allEndpoints) {
    const expected = expectedHttpMap.get(endpoint);
    const observed = observedHttpMap.get(endpoint);
    const safeEndpoint = redactor.redactString(endpoint);

    if (expected) {
      totalChecks += 1;
      if (!observed) {
        mismatchedChecks += 1;
        findings.push({
          reasonCode: 'PREDICTION_MISMATCH',
          category: 'http_health',
          target: safeEndpoint,
          expected: `healthy=${String(expected.expectedHealthy)}`,
          observed: 'missing',
          message: `Predicted HTTP health check missing from observation: ${safeEndpoint}`,
        });
      } else {
        const healthMatches = observed.healthy === expected.expectedHealthy;
        const statusMatches =
          expected.expectedStatusCode === undefined ||
          observed.statusCode === expected.expectedStatusCode;
        if (!healthMatches || !statusMatches) {
          mismatchedChecks += 1;
          const expectedSummary =
            expected.expectedStatusCode !== undefined
              ? `healthy=${String(expected.expectedHealthy)},status=${String(expected.expectedStatusCode)}`
              : `healthy=${String(expected.expectedHealthy)}`;
          const observedSummary =
            observed.statusCode !== undefined
              ? `healthy=${String(observed.healthy)},status=${String(observed.statusCode)}`
              : `healthy=${String(observed.healthy)}`;
          const detailSuffix = observed.detail
            ? ` (${redactor.redactString(observed.detail)})`
            : '';
          findings.push({
            reasonCode: 'PREDICTION_MISMATCH',
            category: 'http_health',
            target: safeEndpoint,
            expected: expectedSummary,
            observed: observedSummary,
            message: `HTTP health mismatch for ${safeEndpoint}: expected ${expectedSummary}, observed ${observedSummary}${detailSuffix}`,
          });
        }
      }
    } else if (observed && !observed.healthy) {
      totalChecks += 1;
      mismatchedChecks += 1;
      const detailSuffix = observed.detail ? ` (${redactor.redactString(observed.detail)})` : '';
      findings.push({
        reasonCode: 'UNEXPECTED_SIDE_EFFECT',
        category: 'http_health',
        target: safeEndpoint,
        expected: 'unpredicted_healthy_or_absent',
        observed: `healthy=false`,
        message: `Unpredicted unhealthy HTTP endpoint observed: ${safeEndpoint}${detailSuffix}`,
      });
    }
  }

  // 3. Container health checks
  const expectedContainerMap = new Map<string, ExpectedContainerHealthCheck>();
  for (const check of prediction.expectedContainerHealth ?? []) {
    expectedContainerMap.set(check.containerName.trim(), check);
  }
  const observedContainerMap = new Map<string, ObservedContainerHealthCheck>();
  for (const check of observation.observedContainerHealth ?? []) {
    observedContainerMap.set(check.containerName.trim(), check);
  }

  const allContainers = [
    ...new Set([...expectedContainerMap.keys(), ...observedContainerMap.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  for (const containerName of allContainers) {
    const expected = expectedContainerMap.get(containerName);
    const observed = observedContainerMap.get(containerName);
    const safeContainer = redactor.redactString(containerName);

    if (expected) {
      totalChecks += 1;
      if (!observed) {
        mismatchedChecks += 1;
        findings.push({
          reasonCode: 'PREDICTION_MISMATCH',
          category: 'container_health',
          target: safeContainer,
          expected: `healthy=${String(expected.expectedHealthy)}`,
          observed: 'missing',
          message: `Predicted container health missing from observation: ${safeContainer}`,
        });
      } else {
        const healthMatches = observed.healthy === expected.expectedHealthy;
        const stateMatches =
          expected.expectedState === undefined || observed.state === expected.expectedState;
        if (!healthMatches || !stateMatches) {
          mismatchedChecks += 1;
          const expectedSummary =
            expected.expectedState !== undefined
              ? `healthy=${String(expected.expectedHealthy)},state=${redactor.redactString(expected.expectedState)}`
              : `healthy=${String(expected.expectedHealthy)}`;
          const observedSummary =
            observed.state !== undefined
              ? `healthy=${String(observed.healthy)},state=${redactor.redactString(observed.state)}`
              : `healthy=${String(observed.healthy)}`;
          findings.push({
            reasonCode: 'PREDICTION_MISMATCH',
            category: 'container_health',
            target: safeContainer,
            expected: expectedSummary,
            observed: observedSummary,
            message: `Container health mismatch for ${safeContainer}: expected ${expectedSummary}, observed ${observedSummary}`,
          });
        }
      }
    } else if (observed && !observed.healthy) {
      totalChecks += 1;
      mismatchedChecks += 1;
      findings.push({
        reasonCode: 'UNEXPECTED_SIDE_EFFECT',
        category: 'container_health',
        target: safeContainer,
        expected: 'unpredicted_healthy_or_absent',
        observed: `healthy=false`,
        message: `Unpredicted unhealthy container observed: ${safeContainer}`,
      });
    }
  }

  // 4. Invariant checks
  const expectedInvariantMap = new Map<string, ExpectedWorldInvariant>();
  for (const inv of prediction.expectedInvariants ?? []) {
    expectedInvariantMap.set(inv.id.trim(), inv);
  }
  const observedInvariantMap = new Map<string, ObservedWorldInvariant>();
  for (const inv of observation.observedInvariants ?? []) {
    observedInvariantMap.set(inv.id.trim(), inv);
  }

  const allInvariants = [
    ...new Set([...expectedInvariantMap.keys(), ...observedInvariantMap.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  for (const invariantId of allInvariants) {
    const expected = expectedInvariantMap.get(invariantId);
    const observed = observedInvariantMap.get(invariantId);
    const safeInvariantId = redactor.redactString(invariantId);

    if (expected) {
      totalChecks += 1;
      if (!observed) {
        mismatchedChecks += 1;
        findings.push({
          reasonCode: 'PREDICTION_MISMATCH',
          category: 'invariant',
          target: safeInvariantId,
          expected: `pass=${String(expected.expectedPass)}`,
          observed: 'missing',
          message: `Predicted invariant not observed: ${safeInvariantId}`,
        });
      } else {
        const passMatches = observed.passed === expected.expectedPass;
        const valueMatches =
          expected.expectedValue === undefined || observed.observedValue === expected.expectedValue;
        if (!passMatches || !valueMatches) {
          mismatchedChecks += 1;
          const expectedVal =
            expected.expectedValue !== undefined
              ? `pass=${String(expected.expectedPass)},value=${redactor.redactString(expected.expectedValue)}`
              : `pass=${String(expected.expectedPass)}`;
          const observedVal =
            observed.observedValue !== undefined
              ? `pass=${String(observed.passed)},value=${redactor.redactString(observed.observedValue)}`
              : `pass=${String(observed.passed)}`;
          findings.push({
            reasonCode: 'PREDICTION_MISMATCH',
            category: 'invariant',
            target: safeInvariantId,
            expected: expectedVal,
            observed: observedVal,
            message: `Invariant mismatch for ${safeInvariantId}: expected ${expectedVal}, observed ${observedVal}`,
          });
        }
      }
    } else if (observed && !observed.passed) {
      totalChecks += 1;
      mismatchedChecks += 1;
      findings.push({
        reasonCode: 'UNEXPECTED_SIDE_EFFECT',
        category: 'invariant',
        target: safeInvariantId,
        expected: 'unpredicted_pass_or_absent',
        observed: 'pass=false',
        message: `Unpredicted invariant failure observed: ${safeInvariantId}`,
      });
    }
  }

  const surpriseScoreBps =
    totalChecks === 0 ? 0 : clampBps((mismatchedChecks / totalChecks) * 10_000);

  const reasonCodes = [...new Set(findings.map((finding) => finding.reasonCode))].sort((a, b) =>
    a.localeCompare(b)
  );

  const affectedTargets = [...new Set(findings.map((finding) => finding.target))].sort((a, b) =>
    a.localeCompare(b)
  );

  let obligationProposal: WorldModelObligationProposal | null = null;
  if (surpriseScoreBps >= thresholdBps && findings.length > 0) {
    const safeActionSummary = prediction.actionSummary
      ? redactor.redactString(prediction.actionSummary)
      : 'world-model post-state verification';
    const proposalSeed = canonicalJson({
      companyId: prediction.companyId,
      runId: prediction.runId,
      predictionId: prediction.predictionId,
      surpriseScoreBps,
      thresholdBps,
      reasonCodes,
      affectedTargets,
    });
    const proposalId = `wm-obl-${sha256Hex(proposalSeed).slice(0, 16)}`;

    obligationProposal = {
      kind: 'ai.obligation',
      proposalId,
      ...(prediction.companyId !== undefined ? { companyId: prediction.companyId } : {}),
      ...(prediction.runId !== undefined ? { runId: redactor.redactString(prediction.runId) } : {}),
      title: `World-Model Surprise Gate (${String(surpriseScoreBps)} bps): ${safeActionSummary}`,
      summary: `Observed post-state diverged from predicted post-state with surprise ${String(surpriseScoreBps)} bps (threshold ${String(thresholdBps)} bps) across ${String(findings.length)} finding(s).`,
      surpriseScoreBps,
      thresholdBps,
      reasonCodes,
      affectedTargets,
      advisoryOnly: true,
      automatedSelfAccept: false,
    };
  }

  const consistent = findings.length === 0 && surpriseScoreBps < thresholdBps;

  const unsignedReport = {
    consistent,
    surpriseScoreBps,
    thresholdBps,
    reasonCodes,
    findings,
    obligationProposal,
    automatedSelfAccept: false as const,
  };

  const reportSha256 = sha256Hex(canonicalJson(unsignedReport));

  return {
    ...unsignedReport,
    reportSha256,
  };
}
