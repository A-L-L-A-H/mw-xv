import { sha256Hex } from './canonical-json.js';
import { normalizeDataClassification } from './classification-router.js';
import type { MemoryCandidateRecord, SkillVersionRecord } from './memory-evaluator.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { Clock, DataClassification } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

const CLASSIFICATION_RANK: Readonly<Record<DataClassification, number>> = {
  cloud_eligible: 1,
  local_only: 2,
  restricted: 3,
};

const WINDOWS_DRIVE_PREFIX_REGEX = /^[A-Za-z]:(?:\/|$)/u;
const UNSAFE_DOC_SEGMENT_REGEX = /^(?:\.git$|\.env)/iu;

export type MemoryDocSkipReasonCode =
  | 'INVALID_TARGET_PATH'
  | 'CROSS_COMPANY'
  | 'REVOKED'
  | 'NOT_APPROVED'
  | 'EXPIRED'
  | 'MODIFIES_POLICY_OR_GRANTS'
  | 'CLASSIFICATION_EXCEEDED'
  | 'DUPLICATE_IN_DOC'
  | 'DUPLICATE_IN_BATCH';

export interface MemoryDocProposalInput {
  readonly companyId: number;
  readonly targetPath: string;
  readonly allowedTargetPaths?: readonly string[];
  readonly maxDataClassification: DataClassification;
  readonly existingDocs: Readonly<Record<string, string>>;
  readonly memories?: readonly MemoryCandidateRecord[];
  readonly skills?: readonly SkillVersionRecord[];
  readonly redactor?: RedactionContext;
  readonly clock?: Clock;
}

export interface MemoryDocProposalItem {
  readonly sourceId: string;
  readonly sourceType: 'memory' | 'skill';
  readonly targetPath: string;
  readonly title: string;
  readonly proposedBlock: string;
  readonly unifiedDiff: string;
  readonly blockSha256: string;
}

export interface MemoryDocSkippedItem {
  readonly sourceId: string;
  readonly sourceType: 'memory' | 'skill';
  readonly reasonCode: MemoryDocSkipReasonCode;
  readonly message: string;
}

export interface MemoryDocProposalBundle {
  readonly companyId: number;
  readonly targetPath: string;
  readonly targetPathValid: boolean;
  readonly advisoryOnly: true;
  readonly requiresHumanApproval: true;
  readonly automatedWritesAllowed: false;
  readonly proposals: readonly MemoryDocProposalItem[];
  readonly skipped: readonly MemoryDocSkippedItem[];
  readonly contentSha256: string;
}

function normalizeDocPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/gu, '/');
  let normalized = trimmed;
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function isSafeMarkdownTargetPath(
  rawPath: string,
  allowedTargetPaths?: readonly string[]
): { readonly valid: boolean; readonly normalized: string; readonly reason?: string } {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return { valid: false, normalized: '', reason: 'Target path must not be empty' };
  }
  const slashed = trimmed.replace(/\\/gu, '/');
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    slashed.startsWith('/') ||
    WINDOWS_DRIVE_PREFIX_REGEX.test(slashed)
  ) {
    return { valid: false, normalized: slashed, reason: 'Target path must be relative' };
  }

  const normalized = normalizeDocPath(trimmed);
  const segments = normalized.split('/');
  if (
    segments.some((seg) => seg === '..' || seg.length === 0 || UNSAFE_DOC_SEGMENT_REGEX.test(seg))
  ) {
    return {
      valid: false,
      normalized,
      reason: 'Target path contains forbidden traversal or sensitive segment',
    };
  }
  if (!normalized.toLowerCase().endsWith('.md')) {
    return { valid: false, normalized, reason: 'Target path must end with .md' };
  }

  if (allowedTargetPaths !== undefined) {
    const normalizedAllowed = allowedTargetPaths.map(normalizeDocPath).filter((p) => p.length > 0);
    if (!normalizedAllowed.includes(normalized)) {
      return {
        valid: false,
        normalized,
        reason: `Target path "${normalized}" is not in allowedTargetPaths`,
      };
    }
  }

  return { valid: true, normalized };
}

function normalizeForDedupe(value: string): string {
  return value.replace(/\r\n/gu, '\n').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
  if (expiresAt === undefined) return false;
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= nowMs;
}

function buildUnifiedDiff(targetPath: string, existingDoc: string, proposedBlock: string): string {
  const existingLines =
    existingDoc.length > 0 ? existingDoc.replace(/\r\n/gu, '\n').split('\n') : [];
  const addedLines = proposedBlock.replace(/\r\n/gu, '\n').split('\n');
  const startLine = existingLines.length + 1;
  const diffLines: string[] = [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    `@@ -${existingLines.length},0 +${startLine},${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
  ];
  return diffLines.join('\n');
}

export function generateMemoryDocProposals(input: MemoryDocProposalInput): MemoryDocProposalBundle {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const nowMs = clock.now();
  const redactor = input.redactor ?? createRedactor();
  const maxCls = normalizeDataClassification(input.maxDataClassification);
  const pathCheck = isSafeMarkdownTargetPath(input.targetPath, input.allowedTargetPaths);

  const proposals: MemoryDocProposalItem[] = [];
  const skipped: MemoryDocSkippedItem[] = [];

  const sortedMemories = [...(input.memories ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const sortedSkills = [...(input.skills ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  if (!pathCheck.valid) {
    for (const memory of sortedMemories) {
      skipped.push({
        sourceId: memory.id,
        sourceType: 'memory',
        reasonCode: 'INVALID_TARGET_PATH',
        message: pathCheck.reason ?? 'Invalid target path',
      });
    }
    for (const skill of sortedSkills) {
      skipped.push({
        sourceId: skill.id,
        sourceType: 'skill',
        reasonCode: 'INVALID_TARGET_PATH',
        message: pathCheck.reason ?? 'Invalid target path',
      });
    }
    const payload = {
      companyId: input.companyId,
      targetPath: pathCheck.normalized,
      targetPathValid: false,
      proposals,
      skipped,
    };
    return {
      companyId: input.companyId,
      targetPath: pathCheck.normalized,
      targetPathValid: false,
      advisoryOnly: true,
      requiresHumanApproval: true,
      automatedWritesAllowed: false,
      proposals,
      skipped,
      contentSha256: sha256Hex(JSON.stringify(payload)),
    };
  }

  const targetPath = pathCheck.normalized;
  const existingDoc = input.existingDocs[targetPath] ?? input.existingDocs[input.targetPath] ?? '';
  const normalizedExistingDoc = normalizeForDedupe(existingDoc);
  const seenBatchHashes = new Set<string>();

  const processCandidate = (params: {
    readonly sourceId: string;
    readonly sourceType: 'memory' | 'skill';
    readonly companyId: number;
    readonly status: string;
    readonly revokedAt?: string;
    readonly expiresAt?: string;
    readonly modifiesLivePolicyOrGrants?: boolean;
    readonly dataClassification: DataClassification;
    readonly title: string;
    readonly body: string;
    readonly provenance: string;
  }): void => {
    if (params.companyId !== input.companyId) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'CROSS_COMPANY',
        message: `Candidate "${params.sourceId}" belongs to company ${params.companyId}, expected ${input.companyId}`,
      });
      return;
    }
    if (params.status === 'revoked' || params.revokedAt !== undefined) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'REVOKED',
        message: `Candidate "${params.sourceId}" is revoked`,
      });
      return;
    }
    if (params.status !== 'approved') {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'NOT_APPROVED',
        message: `Candidate "${params.sourceId}" has status "${params.status}", expected "approved"`,
      });
      return;
    }
    if (isExpired(params.expiresAt, nowMs)) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'EXPIRED',
        message: `Candidate "${params.sourceId}" expired at ${params.expiresAt ?? 'unknown'}`,
      });
      return;
    }
    if (params.modifiesLivePolicyOrGrants === true) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'MODIFIES_POLICY_OR_GRANTS',
        message: `Candidate "${params.sourceId}" attempts live policy or grant modification`,
      });
      return;
    }
    if (CLASSIFICATION_RANK[params.dataClassification] > CLASSIFICATION_RANK[maxCls]) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'CLASSIFICATION_EXCEEDED',
        message: `Candidate "${params.sourceId}" classification "${params.dataClassification}" exceeds "${maxCls}"`,
      });
      return;
    }

    const redactedTitle = redactor
      .redactString(params.title)
      .replace(/[\r\n]+/gu, ' ')
      .trim();
    const redactedBody = redactor.redactString(params.body).replace(/\r\n/gu, '\n').trim();
    const normalizedBody = normalizeForDedupe(redactedBody);

    if (normalizedBody.length > 0 && normalizedExistingDoc.includes(normalizedBody)) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'DUPLICATE_IN_DOC',
        message: `Candidate "${params.sourceId}" content already exists in "${targetPath}"`,
      });
      return;
    }

    const dedupeKey = sha256Hex(`${redactedTitle.toLowerCase()}\n${normalizedBody}`);
    if (seenBatchHashes.has(dedupeKey)) {
      skipped.push({
        sourceId: params.sourceId,
        sourceType: params.sourceType,
        reasonCode: 'DUPLICATE_IN_BATCH',
        message: `Candidate "${params.sourceId}" duplicates an earlier proposal in this batch`,
      });
      return;
    }
    seenBatchHashes.add(dedupeKey);

    const proposedBlock = [
      `### ${redactedTitle}`,
      `<!-- source: ${params.provenance} -->`,
      redactedBody,
    ].join('\n');

    proposals.push({
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      targetPath,
      title: redactedTitle,
      proposedBlock,
      unifiedDiff: buildUnifiedDiff(targetPath, existingDoc, proposedBlock),
      blockSha256: sha256Hex(proposedBlock),
    });
  };

  for (const memory of sortedMemories) {
    processCandidate({
      sourceId: memory.id,
      sourceType: 'memory',
      companyId: memory.companyId,
      status: memory.status,
      revokedAt: memory.revokedAt,
      expiresAt: memory.expiresAt,
      modifiesLivePolicyOrGrants: memory.modifiesLivePolicyOrGrants,
      dataClassification: memory.dataClassification,
      title: memory.title,
      body: memory.content,
      provenance: `memory:${memory.id}`,
    });
  }

  for (const skill of sortedSkills) {
    processCandidate({
      sourceId: skill.id,
      sourceType: 'skill',
      companyId: skill.companyId,
      status: skill.status,
      revokedAt: skill.revokedAt,
      expiresAt: skill.expiresAt,
      modifiesLivePolicyOrGrants: skill.modifiesLivePolicyOrGrants,
      dataClassification: skill.dataClassification,
      title: skill.title,
      body: skill.sopBody,
      provenance: `skill:${skill.code}@v${skill.version}`,
    });
  }

  const payload = {
    companyId: input.companyId,
    targetPath,
    targetPathValid: true,
    proposals,
    skipped,
  };

  return {
    companyId: input.companyId,
    targetPath,
    targetPathValid: true,
    advisoryOnly: true,
    requiresHumanApproval: true,
    automatedWritesAllowed: false,
    proposals,
    skipped,
    contentSha256: sha256Hex(JSON.stringify(payload)),
  };
}
