import { sha256Hex } from './canonical-json.js';
import { compareAscii } from './sort-utils.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { ReadOnlyRepoInspector } from './repo-inspector.js';
import type { RepoGitRevision, RepoSnapshot } from './repo-snapshot.js';

export type CapabilityOverlapStatus =
  'implemented' | 'partial' | 'missing' | 'overlapping' | 'conflicting' | 'deprecated';

export interface OverlapRequirementInput {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords?: readonly string[];
  readonly targetPaths?: readonly string[];
  readonly expectedCapabilities?: readonly string[];
}

export interface ExistingPlanTaskRef {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
  readonly scopePaths?: readonly string[];
  readonly description?: string;
  readonly sourceModel?: 'project.task' | 'ai.work_contract';
}

export interface OverlapEvidenceHit {
  readonly source: 'manifest' | 'doc' | 'entry_point' | 'script' | 'file_search' | 'existing_task';
  readonly path: string;
  readonly sha256?: string;
  readonly lineNumber?: number;
  readonly excerpt: string;
}

export interface OverlapFinding {
  readonly requirementId: string;
  readonly requirementTitle: string;
  readonly status: CapabilityOverlapStatus;
  readonly confidenceBps: number;
  readonly likelyOwners: readonly string[];
  readonly evidence: readonly OverlapEvidenceHit[];
  readonly duplicateTaskIds: readonly string[];
  readonly conflicts: readonly string[];
  readonly requiresHumanReview: boolean;
  readonly rationale: string;
  readonly advisoryOnly: true;
}

export interface OverlapDetectionInput {
  readonly companyId: number;
  readonly repoSnapshot: RepoSnapshot;
  readonly requirements: readonly OverlapRequirementInput[];
  readonly existingTasks?: readonly ExistingPlanTaskRef[];
  readonly inspector?: ReadOnlyRepoInspector;
  readonly capturedAt?: string;
  readonly redactor?: RedactionContext;
}

export interface OverlapReport {
  readonly schemaVersion: 1;
  readonly companyId: number;
  readonly capturedAt: string;
  readonly repoSnapshotSha256: string;
  readonly gitRevision: RepoGitRevision | null;
  readonly findings: readonly OverlapFinding[];
  readonly summary: Readonly<Record<CapabilityOverlapStatus, number>>;
  readonly requiresHumanReviewCount: number;
  readonly advisoryOnly: true;
  readonly automatedMutationsAllowed: false;
  readonly contentSha256: string;
  readonly reportSha256: string;
}

export interface OverlapArtifactPayload {
  readonly artifactKind: 'report';
  readonly mimeType: 'application/json';
  readonly content: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly verificationStatus: 'produced';
}

const DEPRECATION_MARKER_PATTERN =
  /\b(?:deprecated|obsolete|legacy|retired|do_not_import|superseded|replaced_by)\b/iu;
const CONFLICT_MARKER_PATTERN =
  /\b(?:conflict(?:ing)?|incompatible|duplicate_authority|contradict)\b/iu;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'only',
  'must',
  'will',
  'when',
  'each',
  'have',
  'using',
]);

function normalizePosixPath(raw: string): string {
  return raw
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '');
}

function pathsOverlap(a: string, b: string): boolean {
  const normA = normalizePosixPath(a);
  const normB = normalizePosixPath(b);
  if (!normA || !normB) return false;
  if (normA === '.' || normB === '.') return true;
  return normA === normB || normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`);
}

function extractTokens(req: OverlapRequirementInput): readonly string[] {
  const tokenSet = new Set<string>();
  const addFromText = (text: string): void => {
    const parts = text
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && !STOP_WORDS.has(part));
    for (const part of parts) tokenSet.add(part);
  };

  addFromText(req.title);
  addFromText(req.description);
  for (const kw of req.keywords ?? []) addFromText(kw);
  for (const cap of req.expectedCapabilities ?? []) addFromText(cap);

  return [...tokenSet].sort(compareAscii);
}

function textMatchesTokens(text: string, tokens: readonly string[]): readonly string[] {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token));
}

function ownerFromPath(relPath: string): string {
  const parts = normalizePosixPath(relPath).split('/');
  if (parts.length >= 2 && (parts[0] === 'packages' || parts[0] === 'apps')) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || 'repo';
}

export async function detectCapabilityOverlap(
  input: OverlapDetectionInput
): Promise<OverlapReport> {
  if (!Number.isSafeInteger(input.companyId) || input.companyId < 1) {
    throw new Error('detectCapabilityOverlap requires a valid positive companyId');
  }
  const redactor = input.redactor ?? createRedactor();
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const findings: OverlapFinding[] = [];
  const summary: Record<CapabilityOverlapStatus, number> = {
    implemented: 0,
    partial: 0,
    missing: 0,
    overlapping: 0,
    conflicting: 0,
    deprecated: 0,
  };

  for (const req of input.requirements) {
    const tokens = extractTokens(req);
    const targetPaths = (req.targetPaths ?? []).map(normalizePosixPath).filter(Boolean);
    const evidence: OverlapEvidenceHit[] = [];
    const ownerSet = new Set<string>();
    const duplicateTaskIds: string[] = [];
    const conflicts: string[] = [];
    let hasDeprecationSignal = false;
    let hasManifestMatch = false;
    let hasEntryOrSearchMatch = false;
    let hasDocOrScriptMatch = false;

    const addEvidence = (hit: OverlapEvidenceHit): void => {
      const redactedExcerpt = redactor.redactString(hit.excerpt);
      if (
        !evidence.some(
          (e) =>
            e.source === hit.source &&
            e.path === hit.path &&
            e.lineNumber === hit.lineNumber &&
            e.excerpt === redactedExcerpt
        )
      ) {
        evidence.push({ ...hit, excerpt: redactedExcerpt });
      }
      if (hit.source !== 'existing_task') {
        ownerSet.add(ownerFromPath(hit.path));
      }
    };

    for (const manifest of input.repoSnapshot.manifests) {
      const pathMatch = targetPaths.some((target) => pathsOverlap(manifest.path, target));
      const matchedTokens = textMatchesTokens(`${manifest.path} ${manifest.name ?? ''}`, tokens);
      if (
        pathMatch ||
        matchedTokens.length >= 2 ||
        (tokens.length === 1 && matchedTokens.length === 1)
      ) {
        hasManifestMatch = true;
        addEvidence({
          source: 'manifest',
          path: manifest.path,
          sha256: manifest.sha256,
          excerpt: `manifest ${manifest.name ?? manifest.kind}`,
        });
      }
    }

    for (const entry of input.repoSnapshot.entryPoints) {
      const pathMatch = targetPaths.some((target) => pathsOverlap(entry.path, target));
      const matchedTokens = textMatchesTokens(entry.path, tokens);
      const minTokenHits = targetPaths.length > 0 && !pathMatch ? Math.min(2, tokens.length) : 1;
      if (pathMatch || matchedTokens.length >= minTokenHits) {
        hasEntryOrSearchMatch = true;
        addEvidence({
          source: 'entry_point',
          path: entry.path,
          sha256: entry.sha256,
          excerpt: `entry point ${entry.path}`,
        });
      }
    }

    for (const script of input.repoSnapshot.scripts) {
      const pathMatch = targetPaths.some((target) => pathsOverlap(script.manifestPath, target));
      const matchedTokens = textMatchesTokens(`${script.name} ${script.command}`, tokens);
      const minTokenHits = targetPaths.length > 0 && !pathMatch ? Math.min(2, tokens.length) : 1;
      if (pathMatch || matchedTokens.length >= minTokenHits) {
        hasDocOrScriptMatch = true;
        addEvidence({
          source: 'script',
          path: script.manifestPath,
          sha256: script.manifestSha256,
          excerpt: `script "${script.name}": ${script.command}`,
        });
      }
    }

    for (const doc of input.repoSnapshot.docs) {
      const combined = `${doc.path} ${doc.title ?? ''} ${doc.headings.join(' ')}`;
      const pathMatch = targetPaths.some((target) => pathsOverlap(doc.path, target));
      const matchedTokens = textMatchesTokens(combined, tokens);
      const minTokenHits = targetPaths.length > 0 && !pathMatch ? Math.min(2, tokens.length) : 1;
      if (pathMatch || matchedTokens.length >= minTokenHits) {
        hasDocOrScriptMatch = true;
        if (DEPRECATION_MARKER_PATTERN.test(combined) && (targetPaths.length === 0 || pathMatch)) {
          hasDeprecationSignal = true;
        }
        addEvidence({
          source: 'doc',
          path: doc.path,
          sha256: doc.sha256,
          excerpt: `doc "${doc.title ?? doc.path}"`,
        });
      }
    }

    if (input.inspector) {
      const searchQueries = (
        req.keywords && req.keywords.length > 0 ? req.keywords : tokens.slice(0, 3)
      ).slice(0, 3);
      for (const query of searchQueries) {
        if (!query.trim()) continue;
        const matches = await input.inspector.searchFiles(query, { maxMatches: 8 });
        for (const match of matches) {
          const inScope =
            targetPaths.length === 0 ||
            targetPaths.some((target) => pathsOverlap(match.path, target));
          if (!inScope && tokens.length > 1) {
            const extraHits = textMatchesTokens(`${match.path} ${match.preview}`, tokens);
            if (extraHits.length === 0) continue;
          }
          hasEntryOrSearchMatch = true;
          const strictFileScopeMatch =
            targetPaths.length === 0 ||
            targetPaths.some((target) => pathsOverlap(match.path, target));
          if (DEPRECATION_MARKER_PATTERN.test(match.preview) && strictFileScopeMatch) {
            hasDeprecationSignal = true;
          }
          if (CONFLICT_MARKER_PATTERN.test(match.preview)) {
            conflicts.push(`Conflict marker at ${match.path}:${match.lineNumber}`);
          }
          addEvidence({
            source: 'file_search',
            path: match.path,
            sha256: match.sha256,
            lineNumber: match.lineNumber,
            excerpt: match.preview,
          });
        }
      }
    }

    for (const task of input.existingTasks ?? []) {
      const isActive = task.status !== 'done' && task.status !== 'cancelled';
      const taskText = `${task.code} ${task.title} ${task.description ?? ''}`;
      const matchedTokens = textMatchesTokens(taskText, tokens);
      const taskScopeOverlap = (task.scopePaths ?? []).some((sp) =>
        targetPaths.some((tp) => pathsOverlap(sp, tp))
      );

      if (matchedTokens.length > 0 || taskScopeOverlap) {
        if (
          DEPRECATION_MARKER_PATTERN.test(taskText) &&
          (targetPaths.length === 0 || taskScopeOverlap)
        ) {
          hasDeprecationSignal = true;
        }
        if (isActive && taskScopeOverlap && CONFLICT_MARKER_PATTERN.test(taskText)) {
          conflicts.push(
            `Conflicting active task ${task.code} (${task.id}) owns overlapping scope`
          );
        } else if (isActive && (taskScopeOverlap || matchedTokens.length >= 2)) {
          duplicateTaskIds.push(task.id);
        }
        addEvidence({
          source: 'existing_task',
          path: task.scopePaths?.[0] ?? `${task.sourceModel ?? 'project.task'}:${task.code}`,
          excerpt: `${task.code} [${task.status}]: ${task.title}`,
        });
      }
    }

    let status: CapabilityOverlapStatus;
    let confidenceBps: number;
    let rationale: string;

    if (hasDeprecationSignal) {
      status = 'deprecated';
      confidenceBps = 8200;
      rationale = `Matched deprecation markers across ${evidence.length} evidence item(s).`;
    } else if (conflicts.length > 0) {
      status = 'conflicting';
      confidenceBps = 8500;
      rationale = `Detected ${conflicts.length} conflict signal(s) requiring maintainer adjudication.`;
    } else if (duplicateTaskIds.length > 0) {
      status = 'overlapping';
      confidenceBps = 8400;
      rationale = `Requirement overlaps with active task(s): ${duplicateTaskIds.join(', ')}.`;
    } else if (
      hasManifestMatch &&
      hasEntryOrSearchMatch &&
      (hasDocOrScriptMatch || evidence.length >= 3)
    ) {
      status = 'implemented';
      confidenceBps = Math.min(9500, 8200 + evidence.length * 250);
      rationale = `Matched manifest, code entry/search evidence, and docs/scripts (${evidence.length} hits).`;
    } else if (evidence.length > 0) {
      status = 'partial';
      confidenceBps = Math.min(7800, 5000 + evidence.length * 600);
      rationale = `Found ${evidence.length} partial evidence hit(s); incomplete structural coverage.`;
    } else {
      status = 'missing';
      confidenceBps = 9000;
      rationale =
        'No matching manifests, entry points, docs, scripts, source hits, or active tasks found.';
    }

    summary[status] += 1;
    const requiresHumanReview =
      confidenceBps < 8000 ||
      status === 'partial' ||
      status === 'overlapping' ||
      status === 'conflicting' ||
      status === 'deprecated';

    evidence.sort(
      (a, b) =>
        compareAscii(a.source, b.source) ||
        compareAscii(a.path, b.path) ||
        (a.lineNumber ?? 0) - (b.lineNumber ?? 0) ||
        compareAscii(a.excerpt, b.excerpt)
    );

    findings.push({
      requirementId: req.id,
      requirementTitle: redactor.redactString(req.title),
      status,
      confidenceBps,
      likelyOwners: [...ownerSet].sort(compareAscii),
      evidence,
      duplicateTaskIds: [...new Set(duplicateTaskIds)].sort(compareAscii),
      conflicts: [...new Set(conflicts)].sort(compareAscii),
      requiresHumanReview,
      rationale: redactor.redactString(rationale),
      advisoryOnly: true,
    });
  }

  findings.sort((a, b) => compareAscii(a.requirementId, b.requirementId));
  const requiresHumanReviewCount = findings.filter((f) => f.requiresHumanReview).length;

  const contentPayload = {
    schemaVersion: 1 as const,
    companyId: input.companyId,
    repoSnapshotSha256: input.repoSnapshot.contentSha256,
    gitRevision: input.repoSnapshot.gitRevision,
    findings,
    summary,
    requiresHumanReviewCount,
    advisoryOnly: true as const,
    automatedMutationsAllowed: false as const,
  };
  const contentSha256 = sha256Hex(JSON.stringify(contentPayload));
  const reportBase = {
    ...contentPayload,
    capturedAt,
    contentSha256,
  };
  const reportSha256 = sha256Hex(JSON.stringify(reportBase));

  return {
    ...reportBase,
    reportSha256,
  };
}

export function toOverlapArtifactPayload(report: OverlapReport): OverlapArtifactPayload {
  const content = JSON.stringify(report, null, 2);
  return {
    artifactKind: 'report',
    mimeType: 'application/json',
    content,
    sha256: sha256Hex(content),
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    verificationStatus: 'produced',
  };
}
