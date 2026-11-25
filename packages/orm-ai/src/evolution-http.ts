import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  evaluateObligationDrift,
  synthesizeEvolutionCandidates,
  type EvolutionSynthesisInput,
  type MonitorObligationRecord,
  type PaasAppTelemetry,
  type PaasNodeTelemetry,
  type ProofGateCheckSummary,
  type WorldStateSnapshot,
} from '@moonwitness/ai-runtime';
import {
  runCandidateAblationGate,
  type AblationCaseResult,
  type CandidateAblationGateInput,
} from '@moonwitness/ai-evaluation';

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

interface AuthenticatedCompanyContext {
  readonly userId: number;
  readonly role: string;
  readonly companyId: number;
}

function requireCompanyAuth(
  req: AddonHttpRequestBase,
  reply: AddonHttpReply
): AuthenticatedCompanyContext | null {
  if (!req.auth) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  const companyId = req.auth.companyId;
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId <= 0) {
    reply.code(403).send({ success: false, error: 'Active company is required' });
    return null;
  }
  return {
    userId: req.auth.userId,
    role: req.auth.role ?? 'user',
    companyId,
  };
}

function parseProofGateChecks(value: unknown): ProofGateCheckSummary[] | null {
  if (!Array.isArray(value)) return null;
  const checks: ProofGateCheckSummary[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (typeof entry.name !== 'string' || typeof entry.passed !== 'boolean') return null;
    if (entry.summary !== undefined && typeof entry.summary !== 'string') return null;
    checks.push({
      name: entry.name,
      passed: entry.passed,
      ...(typeof entry.summary === 'string' ? { summary: entry.summary } : {}),
    });
  }
  return checks;
}

type SynthesizeParseResult =
  | { readonly ok: true; readonly input: EvolutionSynthesisInput }
  | { readonly ok: false; readonly status: 400 | 403; readonly error: string };

function parseSynthesizeBody(body: unknown, companyId: number): SynthesizeParseResult {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: 'Invalid evolution synthesis payload' };
  }
  if (body.companyId !== undefined && body.companyId !== companyId) {
    return { ok: false, status: 403, error: 'Cross-company evolution synthesis is forbidden' };
  }
  if (
    typeof body.runId !== 'string' ||
    body.runId.trim().length === 0 ||
    typeof body.workContractId !== 'string' ||
    body.workContractId.trim().length === 0 ||
    typeof body.proofGatePassed !== 'boolean' ||
    typeof body.diffSummary !== 'string' ||
    !isStringArray(body.lessons)
  ) {
    return { ok: false, status: 400, error: 'Invalid evolution synthesis fields' };
  }
  const checks = parseProofGateChecks(body.checks);
  if (!checks) {
    return { ok: false, status: 400, error: 'Invalid proof gate checks array' };
  }
  if (body.skillSlug !== undefined && typeof body.skillSlug !== 'string') {
    return { ok: false, status: 400, error: 'Invalid skillSlug' };
  }
  if (
    body.scopeKind !== undefined &&
    body.scopeKind !== 'company' &&
    body.scopeKind !== 'project' &&
    body.scopeKind !== 'agent'
  ) {
    return { ok: false, status: 400, error: 'Invalid scopeKind' };
  }
  if (body.scopeRef !== undefined && typeof body.scopeRef !== 'string') {
    return { ok: false, status: 400, error: 'Invalid scopeRef' };
  }
  if (body.knownSecrets !== undefined && !isStringArray(body.knownSecrets)) {
    return { ok: false, status: 400, error: 'Invalid knownSecrets' };
  }

  return {
    ok: true,
    input: {
      companyId,
      runId: body.runId,
      workContractId: body.workContractId,
      proofGatePassed: body.proofGatePassed,
      checks,
      diffSummary: body.diffSummary,
      lessons: body.lessons,
      ...(typeof body.skillSlug === 'string' ? { skillSlug: body.skillSlug } : {}),
      ...(body.scopeKind !== undefined ? { scopeKind: body.scopeKind } : {}),
      ...(typeof body.scopeRef === 'string' ? { scopeRef: body.scopeRef } : {}),
      ...(Array.isArray(body.knownSecrets) ? { knownSecrets: body.knownSecrets } : {}),
    },
  };
}

function parseAblationCaseResults(value: unknown): AblationCaseResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: AblationCaseResult[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.caseId !== 'string' ||
      entry.caseId.trim().length === 0 ||
      typeof entry.passed !== 'boolean'
    ) {
      return null;
    }
    if (entry.harmed !== undefined && typeof entry.harmed !== 'boolean') return null;
    if (entry.score !== undefined && typeof entry.score !== 'number') return null;
    if (entry.notes !== undefined && typeof entry.notes !== 'string') return null;
    results.push({
      caseId: entry.caseId,
      passed: entry.passed,
      ...(typeof entry.harmed === 'boolean' ? { harmed: entry.harmed } : {}),
      ...(typeof entry.score === 'number' ? { score: entry.score } : {}),
      ...(typeof entry.notes === 'string' ? { notes: entry.notes } : {}),
    });
  }
  return results;
}

function parseAblationBody(body: unknown): CandidateAblationGateInput | null {
  if (!isRecord(body)) return null;
  if (typeof body.candidateId !== 'string' || body.candidateId.trim().length === 0) return null;
  const baselineResults = parseAblationCaseResults(body.baselineResults);
  const candidateResults = parseAblationCaseResults(body.candidateResults);
  if (!baselineResults || !candidateResults) return null;
  return {
    candidateId: body.candidateId,
    baselineResults,
    candidateResults,
  };
}

function parsePaasApps(value: unknown): PaasAppTelemetry[] | null {
  if (!Array.isArray(value)) return null;
  const apps: PaasAppTelemetry[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (typeof entry.appId !== 'string' || typeof entry.healthy !== 'boolean') return null;
    if (entry.name !== undefined && typeof entry.name !== 'string') return null;
    if (entry.status !== undefined && typeof entry.status !== 'string') return null;
    if (entry.detail !== undefined && typeof entry.detail !== 'string') return null;
    apps.push({
      appId: entry.appId,
      healthy: entry.healthy,
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(typeof entry.status === 'string' ? { status: entry.status } : {}),
      ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}),
    });
  }
  return apps;
}

function parsePaasNodes(value: unknown): PaasNodeTelemetry[] | null {
  if (!Array.isArray(value)) return null;
  const nodes: PaasNodeTelemetry[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.nodeId !== 'string' ||
      typeof entry.dockerStatus !== 'string' ||
      typeof entry.easyTierMeshOnline !== 'boolean'
    ) {
      return null;
    }
    if (entry.hostname !== undefined && typeof entry.hostname !== 'string') return null;
    const apps = entry.apps === undefined ? undefined : parsePaasApps(entry.apps);
    if (entry.apps !== undefined && !apps) return null;
    nodes.push({
      nodeId: entry.nodeId,
      dockerStatus: entry.dockerStatus,
      easyTierMeshOnline: entry.easyTierMeshOnline,
      ...(typeof entry.hostname === 'string' ? { hostname: entry.hostname } : {}),
      ...(apps ? { apps } : {}),
    });
  }
  return nodes;
}

function parseObligations(value: unknown): MonitorObligationRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: MonitorObligationRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.id !== 'string' ||
      typeof entry.companyId !== 'number' ||
      !Number.isInteger(entry.companyId) ||
      typeof entry.title !== 'string'
    ) {
      return null;
    }
    if (entry.description !== undefined && typeof entry.description !== 'string') return null;
    if (
      entry.severity !== undefined &&
      entry.severity !== 'low' &&
      entry.severity !== 'medium' &&
      entry.severity !== 'high' &&
      entry.severity !== 'critical'
    ) {
      return null;
    }
    if (entry.expectedRepoGitSha !== undefined && typeof entry.expectedRepoGitSha !== 'string') {
      return null;
    }
    if (entry.expectedTrackedFiles !== undefined && !isStringRecord(entry.expectedTrackedFiles)) {
      return null;
    }
    if (
      entry.expectedDependencyManifestSha256 !== undefined &&
      !isStringRecord(entry.expectedDependencyManifestSha256)
    ) {
      return null;
    }
    if (entry.expectedPaasNodeIds !== undefined && !isStringArray(entry.expectedPaasNodeIds)) {
      return null;
    }
    if (entry.expectedPaasAppIds !== undefined && !isStringArray(entry.expectedPaasAppIds)) {
      return null;
    }
    records.push({
      id: entry.id,
      companyId: entry.companyId,
      title: entry.title,
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      ...(entry.severity !== undefined ? { severity: entry.severity } : {}),
      ...(typeof entry.expectedRepoGitSha === 'string'
        ? { expectedRepoGitSha: entry.expectedRepoGitSha }
        : {}),
      ...(entry.expectedTrackedFiles ? { expectedTrackedFiles: entry.expectedTrackedFiles } : {}),
      ...(entry.expectedDependencyManifestSha256
        ? { expectedDependencyManifestSha256: entry.expectedDependencyManifestSha256 }
        : {}),
      ...(entry.expectedPaasNodeIds ? { expectedPaasNodeIds: entry.expectedPaasNodeIds } : {}),
      ...(entry.expectedPaasAppIds ? { expectedPaasAppIds: entry.expectedPaasAppIds } : {}),
    });
  }
  return records;
}

type ObligationScanParseResult =
  | {
      readonly ok: true;
      readonly obligations: readonly MonitorObligationRecord[];
      readonly worldSnapshot: WorldStateSnapshot;
    }
  | { readonly ok: false; readonly status: 400 | 403; readonly error: string };

function parseObligationScanBody(body: unknown, companyId: number): ObligationScanParseResult {
  if (!isRecord(body) || !isRecord(body.worldSnapshot)) {
    return { ok: false, status: 400, error: 'Invalid obligation scan payload' };
  }
  const snapshot = body.worldSnapshot;
  if (snapshot.companyId !== undefined && snapshot.companyId !== companyId) {
    return { ok: false, status: 403, error: 'Cross-company obligation scan is forbidden' };
  }
  const obligations = parseObligations(body.obligations);
  if (!obligations) {
    return { ok: false, status: 400, error: 'Invalid obligations array' };
  }
  if (snapshot.observedAt !== undefined && typeof snapshot.observedAt !== 'string') {
    return { ok: false, status: 400, error: 'Invalid worldSnapshot.observedAt' };
  }
  if (snapshot.repoGitSha !== undefined && typeof snapshot.repoGitSha !== 'string') {
    return { ok: false, status: 400, error: 'Invalid worldSnapshot.repoGitSha' };
  }
  if (snapshot.trackedFilesSha256 !== undefined && !isStringRecord(snapshot.trackedFilesSha256)) {
    return { ok: false, status: 400, error: 'Invalid worldSnapshot.trackedFilesSha256' };
  }
  if (
    snapshot.dependencyManifestsSha256 !== undefined &&
    !isStringRecord(snapshot.dependencyManifestsSha256)
  ) {
    return { ok: false, status: 400, error: 'Invalid worldSnapshot.dependencyManifestsSha256' };
  }
  const paasNodes =
    snapshot.paasNodes === undefined ? undefined : parsePaasNodes(snapshot.paasNodes);
  if (snapshot.paasNodes !== undefined && !paasNodes) {
    return { ok: false, status: 400, error: 'Invalid worldSnapshot.paasNodes' };
  }

  return {
    ok: true,
    obligations,
    worldSnapshot: {
      companyId,
      ...(typeof snapshot.observedAt === 'string' ? { observedAt: snapshot.observedAt } : {}),
      ...(typeof snapshot.repoGitSha === 'string' ? { repoGitSha: snapshot.repoGitSha } : {}),
      ...(snapshot.trackedFilesSha256 ? { trackedFilesSha256: snapshot.trackedFilesSha256 } : {}),
      ...(snapshot.dependencyManifestsSha256
        ? { dependencyManifestsSha256: snapshot.dependencyManifestsSha256 }
        : {}),
      ...(paasNodes ? { paasNodes } : {}),
    },
  };
}

export const evolutionHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post<{ Body: unknown }>('/ai/evolution/synthesize', async (req, reply) => {
    const auth = requireCompanyAuth(req, reply);
    if (!auth) return;

    const parsed = parseSynthesizeBody(req.body, auth.companyId);
    if (!parsed.ok) {
      return reply.code(parsed.status).send({ success: false, error: parsed.error });
    }

    const result = synthesizeEvolutionCandidates(parsed.input);
    return reply.code(200).send({ success: true, data: result });
  });

  app.post<{ Body: unknown }>('/ai/evolution/evaluate-ablation', async (req, reply) => {
    const auth = requireCompanyAuth(req, reply);
    if (!auth) return;

    const parsed = parseAblationBody(req.body);
    if (!parsed) {
      return reply.code(400).send({ success: false, error: 'Invalid ablation evaluation payload' });
    }

    const report = runCandidateAblationGate(parsed);
    return reply.code(200).send({
      success: true,
      data: {
        ...report,
        requiresHumanWorkflowApproval: true as const,
        automatedPromotionAllowed: false as const,
      },
    });
  });

  app.post<{ Body: unknown }>('/ai/obligations/scan', async (req, reply) => {
    const auth = requireCompanyAuth(req, reply);
    if (!auth) return;

    const parsed = parseObligationScanBody(req.body, auth.companyId);
    if (!parsed.ok) {
      return reply.code(parsed.status).send({ success: false, error: parsed.error });
    }

    const report = evaluateObligationDrift(parsed.obligations, parsed.worldSnapshot);
    return reply.code(200).send({ success: true, data: report });
  });
};
