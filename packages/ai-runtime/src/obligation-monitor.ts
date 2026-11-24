import { createRedactor, type RedactionContext } from './redaction.js';
import { sha256Hex, toCanonicalJson as canonicalJson } from './canonical-json.js';

export type ObligationStatus = 'intact' | 'drifted' | 'breached';

export type ObligationDriftReasonCode =
  | 'REPO_GIT_SHA_DRIFT'
  | 'TRACKED_FILE_SHA256_DRIFT'
  | 'TRACKED_FILE_MISSING'
  | 'DEPENDENCY_MANIFEST_DRIFT'
  | 'PAAS_NODE_MISSING'
  | 'PAAS_DOCKER_DEGRADED'
  | 'PAAS_EASYTIER_MESH_OFFLINE'
  | 'PAAS_APP_UNHEALTHY'
  | 'CROSS_COMPANY_MISMATCH';

export interface ObligationRecord {
  readonly id: string;
  readonly companyId: number;
  readonly title: string;
  readonly description?: string;
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
  readonly expectedRepoGitSha?: string;
  readonly expectedTrackedFiles?: Readonly<Record<string, string>>;
  readonly expectedDependencyManifestSha256?: Readonly<Record<string, string>>;
  readonly expectedPaasNodeIds?: readonly string[];
  readonly expectedPaasAppIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PaasAppTelemetry {
  readonly appId: string;
  readonly name?: string;
  readonly healthy: boolean;
  readonly status?: string;
  readonly detail?: string;
}

export interface PaasNodeTelemetry {
  readonly nodeId: string;
  readonly hostname?: string;
  readonly dockerStatus: string;
  readonly easyTierMeshOnline: boolean;
  readonly apps?: readonly PaasAppTelemetry[];
}

export interface WorldStateSnapshot {
  readonly companyId: number;
  readonly observedAt?: string;
  readonly repoGitSha?: string;
  readonly trackedFilesSha256?: Readonly<Record<string, string>>;
  readonly dependencyManifestsSha256?: Readonly<Record<string, string>>;
  readonly paasNodes?: readonly PaasNodeTelemetry[];
}

export interface ObligationDriftFinding {
  readonly reasonCode: ObligationDriftReasonCode;
  readonly severity: 'drift' | 'breach';
  readonly target: string;
  readonly expected?: string;
  readonly observed?: string;
  readonly message: string;
}

export interface ObligationEvaluation {
  readonly obligationId: string;
  readonly companyId: number;
  readonly title: string;
  readonly status: ObligationStatus;
  readonly reasonCodes: readonly ObligationDriftReasonCode[];
  readonly findings: readonly ObligationDriftFinding[];
}

export interface ReverificationContractProposal {
  readonly proposalId: string;
  readonly obligationId: string;
  readonly companyId: number;
  readonly status: 'drifted' | 'breached';
  readonly title: string;
  readonly summary: string;
  readonly advisoryOnly: true;
  readonly automatedSelfAccept: false;
  readonly reasonCodes: readonly ObligationDriftReasonCode[];
  readonly affectedTargets: readonly string[];
}

export interface CrossCompanySkippedObligation {
  readonly obligationId: string;
  readonly obligationCompanyId: number;
  readonly snapshotCompanyId: number;
  readonly reasonCode: 'CROSS_COMPANY_MISMATCH';
}

export interface ObligationDriftSummary {
  readonly totalEvaluated: number;
  readonly intact: number;
  readonly drifted: number;
  readonly breached: number;
  readonly skippedCrossCompany: number;
}

export interface ObligationDriftReport {
  readonly companyId: number;
  readonly evaluations: readonly ObligationEvaluation[];
  readonly proposals: readonly ReverificationContractProposal[];
  readonly skippedCrossCompany: readonly CrossCompanySkippedObligation[];
  readonly summary: ObligationDriftSummary;
  readonly reportSha256: string;
}

export interface EvaluateObligationDriftOptions {
  readonly redactor?: RedactionContext;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function evaluateSingleObligation(
  obligation: ObligationRecord,
  worldSnapshot: WorldStateSnapshot,
  redactor: RedactionContext
): ObligationEvaluation {
  const findings: ObligationDriftFinding[] = [];
  const isCritical = obligation.severity === 'critical';

  if (obligation.expectedRepoGitSha !== undefined) {
    const expectedSha = obligation.expectedRepoGitSha.trim();
    const observedSha = worldSnapshot.repoGitSha?.trim() ?? '';
    if (expectedSha !== observedSha) {
      findings.push({
        reasonCode: 'REPO_GIT_SHA_DRIFT',
        severity: isCritical ? 'breach' : 'drift',
        target: 'repo.gitSha',
        expected: redactor.redactString(expectedSha),
        observed: redactor.redactString(observedSha || '<missing>'),
        message: redactor.redactString(
          `Repository git SHA drifted from ${expectedSha} to ${observedSha || '<missing>'}.`
        ),
      });
    }
  }

  if (obligation.expectedTrackedFiles !== undefined) {
    const observedFiles = worldSnapshot.trackedFilesSha256 ?? {};
    const filePaths = Object.keys(obligation.expectedTrackedFiles).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const filePath of filePaths) {
      const expectedHash = obligation.expectedTrackedFiles[filePath] ?? '';
      const observedHash = observedFiles[filePath];
      if (observedHash === undefined) {
        findings.push({
          reasonCode: 'TRACKED_FILE_MISSING',
          severity: isCritical ? 'breach' : 'drift',
          target: redactor.redactString(filePath),
          expected: redactor.redactString(expectedHash),
          observed: '<missing>',
          message: redactor.redactString(
            `Tracked file ${filePath} is missing from world snapshot.`
          ),
        });
      } else if (observedHash !== expectedHash) {
        findings.push({
          reasonCode: 'TRACKED_FILE_SHA256_DRIFT',
          severity: isCritical ? 'breach' : 'drift',
          target: redactor.redactString(filePath),
          expected: redactor.redactString(expectedHash),
          observed: redactor.redactString(observedHash),
          message: redactor.redactString(`Tracked file ${filePath} SHA-256 drifted.`),
        });
      }
    }
  }

  if (obligation.expectedDependencyManifestSha256 !== undefined) {
    const observedManifests = worldSnapshot.dependencyManifestsSha256 ?? {};
    const manifestPaths = Object.keys(obligation.expectedDependencyManifestSha256).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const manifestPath of manifestPaths) {
      const expectedHash = obligation.expectedDependencyManifestSha256[manifestPath] ?? '';
      const observedHash = observedManifests[manifestPath];
      if (observedHash !== expectedHash) {
        findings.push({
          reasonCode: 'DEPENDENCY_MANIFEST_DRIFT',
          severity: isCritical ? 'breach' : 'drift',
          target: redactor.redactString(manifestPath),
          expected: redactor.redactString(expectedHash),
          observed: redactor.redactString(observedHash ?? '<missing>'),
          message: redactor.redactString(
            `Dependency manifest ${manifestPath} SHA-256 drifted from expected baseline.`
          ),
        });
      }
    }
  }

  const nodeMap = new Map<string, PaasNodeTelemetry>();
  const appMap = new Map<string, { readonly nodeId: string; readonly app: PaasAppTelemetry }>();
  for (const node of worldSnapshot.paasNodes ?? []) {
    nodeMap.set(node.nodeId, node);
    for (const app of node.apps ?? []) {
      appMap.set(app.appId, { nodeId: node.nodeId, app });
    }
  }

  const reportedUnhealthyApps = new Set<string>();

  if (obligation.expectedPaasNodeIds !== undefined) {
    const sortedNodeIds = uniqueSorted(obligation.expectedPaasNodeIds);
    for (const nodeId of sortedNodeIds) {
      const node = nodeMap.get(nodeId);
      if (node === undefined) {
        findings.push({
          reasonCode: 'PAAS_NODE_MISSING',
          severity: 'breach',
          target: redactor.redactString(`paas.node:${nodeId}`),
          expected: 'online',
          observed: 'missing',
          message: redactor.redactString(`PaaS VPS node ${nodeId} is missing from telemetry.`),
        });
        continue;
      }

      if (node.dockerStatus !== 'ok') {
        findings.push({
          reasonCode: 'PAAS_DOCKER_DEGRADED',
          severity: 'breach',
          target: redactor.redactString(`paas.node:${nodeId}`),
          expected: 'ok',
          observed: redactor.redactString(node.dockerStatus),
          message: redactor.redactString(
            `PaaS VPS node ${nodeId} docker status is ${node.dockerStatus}.`
          ),
        });
      }

      if (!node.easyTierMeshOnline) {
        findings.push({
          reasonCode: 'PAAS_EASYTIER_MESH_OFFLINE',
          severity: 'breach',
          target: redactor.redactString(`paas.node:${nodeId}`),
          expected: 'online',
          observed: 'offline',
          message: redactor.redactString(`PaaS VPS node ${nodeId} EasyTier mesh is offline.`),
        });
      }

      const sortedApps = [...(node.apps ?? [])].sort((a, b) => a.appId.localeCompare(b.appId));
      for (const app of sortedApps) {
        if (!app.healthy) {
          reportedUnhealthyApps.add(app.appId);
          findings.push({
            reasonCode: 'PAAS_APP_UNHEALTHY',
            severity: 'breach',
            target: redactor.redactString(`paas.app:${app.appId}`),
            expected: 'healthy',
            observed: redactor.redactString(app.status ?? 'unhealthy'),
            message: redactor.redactString(
              `PaaS app ${app.appId} on node ${nodeId} is unhealthy${app.detail ? `: ${app.detail}` : ''}.`
            ),
          });
        }
      }
    }
  }

  if (obligation.expectedPaasAppIds !== undefined) {
    const sortedAppIds = uniqueSorted(obligation.expectedPaasAppIds);
    for (const appId of sortedAppIds) {
      if (reportedUnhealthyApps.has(appId)) {
        continue;
      }
      const entry = appMap.get(appId);
      if (entry === undefined) {
        findings.push({
          reasonCode: 'PAAS_APP_UNHEALTHY',
          severity: 'breach',
          target: redactor.redactString(`paas.app:${appId}`),
          expected: 'healthy',
          observed: 'missing',
          message: redactor.redactString(`Expected PaaS app ${appId} is missing from telemetry.`),
        });
      } else if (!entry.app.healthy) {
        findings.push({
          reasonCode: 'PAAS_APP_UNHEALTHY',
          severity: 'breach',
          target: redactor.redactString(`paas.app:${appId}`),
          expected: 'healthy',
          observed: redactor.redactString(entry.app.status ?? 'unhealthy'),
          message: redactor.redactString(
            `PaaS app ${appId} on node ${entry.nodeId} is unhealthy${entry.app.detail ? `: ${entry.app.detail}` : ''}.`
          ),
        });
      }
    }
  }

  const hasBreach = findings.some((finding) => finding.severity === 'breach');
  const status: ObligationStatus = hasBreach
    ? 'breached'
    : findings.length > 0
      ? 'drifted'
      : 'intact';
  const reasonCodes = uniqueSorted(findings.map((finding) => finding.reasonCode));

  return {
    obligationId: redactor.redactString(obligation.id),
    companyId: obligation.companyId,
    title: redactor.redactString(obligation.title),
    status,
    reasonCodes,
    findings,
  };
}

export function evaluateObligationDrift(
  obligations: readonly ObligationRecord[],
  worldSnapshot: WorldStateSnapshot,
  options?: EvaluateObligationDriftOptions
): ObligationDriftReport {
  const redactor = options?.redactor ?? createRedactor();
  const sortedObligations = [...obligations].sort((a, b) => a.id.localeCompare(b.id));

  const evaluations: ObligationEvaluation[] = [];
  const proposals: ReverificationContractProposal[] = [];
  const skippedCrossCompany: CrossCompanySkippedObligation[] = [];

  for (const obligation of sortedObligations) {
    if (obligation.companyId !== worldSnapshot.companyId) {
      skippedCrossCompany.push({
        obligationId: redactor.redactString(obligation.id),
        obligationCompanyId: obligation.companyId,
        snapshotCompanyId: worldSnapshot.companyId,
        reasonCode: 'CROSS_COMPANY_MISMATCH',
      });
      continue;
    }

    const evaluation = evaluateSingleObligation(obligation, worldSnapshot, redactor);
    evaluations.push(evaluation);

    if (evaluation.status !== 'intact') {
      const affectedTargets = uniqueSorted(evaluation.findings.map((finding) => finding.target));
      const proposalSeed = canonicalJson({
        companyId: worldSnapshot.companyId,
        obligationId: evaluation.obligationId,
        status: evaluation.status,
        reasonCodes: evaluation.reasonCodes,
        affectedTargets,
      });
      const proposalId = `reverify-${sha256Hex(proposalSeed).slice(0, 16)}`;

      proposals.push({
        proposalId,
        obligationId: evaluation.obligationId,
        companyId: worldSnapshot.companyId,
        status: evaluation.status,
        title: redactor.redactString(`Reverify obligation: ${evaluation.title}`),
        summary: redactor.redactString(
          `Obligation ${evaluation.obligationId} is ${evaluation.status} (${evaluation.reasonCodes.join(', ')}).`
        ),
        advisoryOnly: true,
        automatedSelfAccept: false,
        reasonCodes: [...evaluation.reasonCodes],
        affectedTargets,
      });
    }
  }

  const summary: ObligationDriftSummary = {
    totalEvaluated: evaluations.length,
    intact: evaluations.filter((item) => item.status === 'intact').length,
    drifted: evaluations.filter((item) => item.status === 'drifted').length,
    breached: evaluations.filter((item) => item.status === 'breached').length,
    skippedCrossCompany: skippedCrossCompany.length,
  };

  const scrubbedPayload = redactor.redactObject({
    companyId: worldSnapshot.companyId,
    evaluations,
    proposals,
    skippedCrossCompany,
    summary,
  });

  const reportSha256 = sha256Hex(canonicalJson(scrubbedPayload));

  return {
    ...scrubbedPayload,
    reportSha256,
  };
}
