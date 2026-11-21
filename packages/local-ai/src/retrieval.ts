import { createHash } from 'node:crypto';

export type RetrievalVisibility =
  'PUBLIC_APPROVED' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'CHILD_SENSITIVE';

export interface CanonicalPassageReference {
  readonly sourceId: string;
  readonly editionId: string;
  readonly locator: string;
  readonly sourceSha256: string;
}

export interface ResolvedCanonicalPassage {
  readonly reference: CanonicalPassageReference;
  /** Exact canonical passage text; chunk offsets are relative to these UTF-8 bytes and scalars. */
  readonly text: string;
  readonly visibility: RetrievalVisibility;
  readonly sourceManifestPath: string;
  readonly artifactBytes: Uint8Array;
  readonly sourceManifestBytes: Uint8Array;
}

export interface LocalPassageChunk {
  readonly text: string;
  readonly citation: CanonicalPassageReference & {
    readonly sourceManifestPath: string;
    readonly attribution: string;
  };
  readonly visibility: RetrievalVisibility;
  readonly sourceSpan: {
    readonly basis: 'resolved_passage_text';
    readonly byteStart: number;
    readonly byteEnd: number;
    readonly scalarStart: number;
    readonly scalarEnd: number;
  };
}

export interface LocalPassageResolver {
  resolve(reference: CanonicalPassageReference): Promise<ResolvedCanonicalPassage | null>;
  canRead(passage: ResolvedCanonicalPassage): boolean | Promise<boolean>;
}

export interface RetrieveLocalPassageRequest {
  readonly reference: CanonicalPassageReference;
  readonly byteStart?: number;
  readonly byteEnd?: number;
}

export class LocalRetrievalError extends Error {
  constructor() {
    super('Local source is unavailable for retrieval');
    this.name = 'LocalRetrievalError';
  }
}

const approvedReference: CanonicalPassageReference = Object.freeze({
  sourceId: 'mw:source:tanzil-quran-text',
  editionId: 'mw:edition:tanzil-quran-text-v1.1-uthmani-txt2',
  locator: 'Q7:46',
  sourceSha256: '6ff83b01099fb7992b5f7fa101cfab3d6556607ca6b1fe69d53cb76f97027760',
});
const approvedManifestPath = 'corpus/manifests/tanzil-quran-text-v1.1-uthmani-q7-46.json';
const approvedManifestSha256 = '1a0cdab80255d194e8a66fc7a25ab5799b539a56909c23886bf8a34cbec959c8';
const approvedAttribution =
  'Tanzil Quran Text. Copyright (C) 2007-2021 Tanzil Project. License: Creative Commons Attribution 3.0 (CC BY 3.0). Source: https://tanzil.net/ . This Q7:46 line is reproduced verbatim without modification. See https://tanzil.net/docs/Text_License and https://creativecommons.org/licenses/by/3.0/ .';
const visibilityValues = new Set<RetrievalVisibility>([
  'PUBLIC_APPROVED',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'CHILD_SENSITIVE',
]);

function validReference(reference: CanonicalPassageReference): boolean {
  return (
    typeof reference === 'object' &&
    reference !== null &&
    sameReference(reference, approvedReference)
  );
}

function sameReference(left: CanonicalPassageReference, right: CanonicalPassageReference): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.editionId === right.editionId &&
    left.locator === right.locator &&
    left.sourceSha256 === right.sourceSha256
  );
}

function scalarOffsetAtByte(text: string, byteOffset: number): number | undefined {
  const bytes = Buffer.from(text, 'utf8');
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > bytes.byteLength) {
    return undefined;
  }
  const prefix = bytes.subarray(0, byteOffset);
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(prefix);
    return Array.from(decoded).length;
  } catch {
    return undefined;
  }
}

function parseApprovedManifest(bytes: Uint8Array): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const manifest = value as Record<string, unknown>;
  const artifact = manifest.artifact;
  const rights = manifest.rights;
  const attribution = manifest.attribution;
  const publication = manifest.publication;
  if (
    manifest.schema_version !== 1 ||
    manifest.source_id !== approvedReference.sourceId ||
    manifest.edition_id !== approvedReference.editionId ||
    manifest.locale !== 'ar' ||
    typeof artifact !== 'object' ||
    artifact === null ||
    Array.isArray(artifact) ||
    typeof rights !== 'object' ||
    rights === null ||
    Array.isArray(rights) ||
    typeof attribution !== 'object' ||
    attribution === null ||
    Array.isArray(attribution) ||
    typeof publication !== 'object' ||
    publication === null ||
    Array.isArray(publication)
  ) {
    return undefined;
  }
  const artifactRecord = artifact as Record<string, unknown>;
  const rightsRecord = rights as Record<string, unknown>;
  const attributionRecord = attribution as Record<string, unknown>;
  const publicationRecord = publication as Record<string, unknown>;
  if (
    artifactRecord.representation !== 'source_bytes' ||
    artifactRecord.media_type !== 'text/plain; charset=utf-8' ||
    artifactRecord.sha256 !== approvedReference.sourceSha256 ||
    artifactRecord.byte_length !== 360 ||
    rightsRecord.state !== 'permitted' ||
    !Array.isArray(rightsRecord.allowed_uses) ||
    !rightsRecord.allowed_uses.includes('read_analyze') ||
    rightsRecord.reviewer !== 'bjo163' ||
    rightsRecord.decision_date !== '2026-10-16' ||
    typeof rightsRecord.evidence_ref !== 'string' ||
    attributionRecord.text !== approvedAttribution ||
    publicationRecord.mode !== 'source_bytes' ||
    publicationRecord.release_ref !== 'K2-005 source-specific owner approval 2026-10-16'
  ) {
    return undefined;
  }
  return approvedAttribution;
}

function parseApprovedPassage(bytes: Uint8Array): string | undefined {
  let line: string;
  try {
    line = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  if (!line.endsWith('\n') || line.includes('\r') || line.slice(0, -1).includes('\n')) {
    return undefined;
  }
  const sourceLine = line.slice(0, -1);
  const fields = sourceLine.split('|');
  if (fields.length !== 3 || fields[0] !== '7' || fields[1] !== '46' || !fields[2]) {
    return undefined;
  }
  return fields[2];
}

/** Resolve one explicit canonical passage into a citation-bound, permission-checked chunk. */
export async function retrieveLocalPassageChunk(
  request: RetrieveLocalPassageRequest,
  resolver: LocalPassageResolver
): Promise<LocalPassageChunk> {
  const fail = (): never => {
    throw new LocalRetrievalError();
  };
  if (
    !request ||
    !validReference(request.reference) ||
    !resolver ||
    typeof resolver.resolve !== 'function' ||
    typeof resolver.canRead !== 'function'
  ) {
    fail();
  }
  const requestedReference = Object.freeze({ ...request.reference });
  const requestedByteStart = request.byteStart;
  const requestedByteEnd = request.byteEnd;

  let passage: ResolvedCanonicalPassage | null;
  try {
    passage = await resolver.resolve(requestedReference);
  } catch {
    return fail();
  }

  let resolvedReference: CanonicalPassageReference;
  let passageText: string;
  let passageVisibility: RetrievalVisibility;
  let sourceManifestPath: string;
  let artifactBytes: Uint8Array;
  let sourceManifestBytes: Uint8Array;
  try {
    if (!passage || typeof passage !== 'object') return fail();
    const candidateReference = passage.reference;
    if (!validReference(candidateReference)) return fail();
    resolvedReference = Object.freeze({ ...candidateReference });
    passageText = passage.text;
    passageVisibility = passage.visibility;
    sourceManifestPath = passage.sourceManifestPath;
    if (!(passage.artifactBytes instanceof Uint8Array)) return fail();
    if (!(passage.sourceManifestBytes instanceof Uint8Array)) return fail();
    artifactBytes = Uint8Array.from(passage.artifactBytes);
    sourceManifestBytes = Uint8Array.from(passage.sourceManifestBytes);
  } catch {
    return fail();
  }

  if (
    !sameReference(resolvedReference, requestedReference) ||
    typeof passageText !== 'string' ||
    passageText.length === 0 ||
    !visibilityValues.has(passageVisibility) ||
    passageVisibility !== 'PUBLIC_APPROVED' ||
    sourceManifestPath !== approvedManifestPath
  ) {
    return fail();
  }
  const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
  const manifestSha256 = createHash('sha256').update(sourceManifestBytes).digest('hex');
  const textFromArtifact = parseApprovedPassage(artifactBytes);
  const attribution = parseApprovedManifest(sourceManifestBytes);
  if (
    artifactSha256 !== approvedReference.sourceSha256 ||
    manifestSha256 !== approvedManifestSha256 ||
    textFromArtifact === undefined ||
    textFromArtifact !== passageText ||
    attribution === undefined
  )
    return fail();

  // Authorization receives an independent copy. No data read after the await can change
  // the verified output, even if an adapter mutates its input while checking access.
  const authorizationPassage: ResolvedCanonicalPassage = {
    reference: { ...resolvedReference },
    text: passageText,
    visibility: passageVisibility,
    sourceManifestPath,
    artifactBytes: Uint8Array.from(artifactBytes),
    sourceManifestBytes: Uint8Array.from(sourceManifestBytes),
  };
  try {
    if (!(await resolver.canRead(authorizationPassage))) return fail();
  } catch {
    return fail();
  }

  const bytes = Buffer.from(passageText, 'utf8');
  try {
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== passageText) return fail();
  } catch {
    return fail();
  }
  const byteStart = requestedByteStart ?? 0;
  const byteEnd = requestedByteEnd ?? bytes.byteLength;
  const scalarStart = scalarOffsetAtByte(passageText, byteStart);
  const scalarEnd = scalarOffsetAtByte(passageText, byteEnd);
  if (scalarStart === undefined || scalarEnd === undefined || byteEnd <= byteStart) return fail();

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(byteStart, byteEnd));
  } catch {
    return fail();
  }
  if (text.length === 0) return fail();

  return {
    text,
    citation: {
      ...resolvedReference,
      sourceManifestPath,
      attribution,
    },
    visibility: passageVisibility,
    sourceSpan: {
      basis: 'resolved_passage_text',
      byteStart,
      byteEnd,
      scalarStart,
      scalarEnd,
    },
  };
}

export interface ApprovedManifestCatalogEntry {
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly reference: CanonicalPassageReference;
}

function parseDynamicPermittedManifest(
  bytes: Uint8Array,
  expectedReference: CanonicalPassageReference,
  actualArtifactBytes: Uint8Array
): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const manifest = value as Record<string, unknown>;
  const artifact = manifest.artifact;
  const rights = manifest.rights;
  const attribution = manifest.attribution;
  if (
    manifest.schema_version !== 1 ||
    manifest.source_id !== expectedReference.sourceId ||
    manifest.edition_id !== expectedReference.editionId ||
    typeof artifact !== 'object' ||
    artifact === null ||
    Array.isArray(artifact) ||
    typeof rights !== 'object' ||
    rights === null ||
    Array.isArray(rights) ||
    typeof attribution !== 'object' ||
    attribution === null ||
    Array.isArray(attribution)
  ) {
    return undefined;
  }
  const artifactRecord = artifact as Record<string, unknown>;
  const rightsRecord = rights as Record<string, unknown>;
  const attributionRecord = attribution as Record<string, unknown>;
  if (
    artifactRecord.sha256 !== expectedReference.sourceSha256 ||
    artifactRecord.byte_length !== actualArtifactBytes.byteLength ||
    rightsRecord.state !== 'permitted' ||
    !Array.isArray(rightsRecord.allowed_uses) ||
    !rightsRecord.allowed_uses.includes('read_analyze') ||
    typeof attributionRecord.text !== 'string' ||
    attributionRecord.text.trim().length === 0
  ) {
    return undefined;
  }
  return attributionRecord.text;
}

/**
 * Resolve any rights-verified manifest entry into a citation-bound, permission-checked chunk.
 */
export async function retrieveDynamicLocalPassageChunk(
  request: RetrieveLocalPassageRequest,
  resolver: LocalPassageResolver,
  catalog?: readonly ApprovedManifestCatalogEntry[]
): Promise<LocalPassageChunk> {
  const fail = (): never => {
    throw new LocalRetrievalError();
  };
  const ref = request?.reference;
  if (
    !ref ||
    typeof ref.sourceId !== 'string' ||
    ref.sourceId.length === 0 ||
    typeof ref.editionId !== 'string' ||
    ref.editionId.length === 0 ||
    typeof ref.locator !== 'string' ||
    ref.locator.length === 0 ||
    typeof ref.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(ref.sourceSha256) ||
    !resolver ||
    typeof resolver.resolve !== 'function' ||
    typeof resolver.canRead !== 'function'
  ) {
    fail();
  }
  const requestedReference = Object.freeze({ ...ref });
  let passage: ResolvedCanonicalPassage | null;
  try {
    passage = await resolver.resolve(requestedReference);
  } catch {
    return fail();
  }
  if (!passage || typeof passage !== 'object') return fail();
  if (!(passage.artifactBytes instanceof Uint8Array)) return fail();
  if (!(passage.sourceManifestBytes instanceof Uint8Array)) return fail();

  const resolvedReference = Object.freeze({ ...passage.reference });
  const artifactBytes = Uint8Array.from(passage.artifactBytes);
  const sourceManifestBytes = Uint8Array.from(passage.sourceManifestBytes);
  const passageText = passage.text;
  const passageVisibility = passage.visibility;
  const sourceManifestPath = passage.sourceManifestPath;

  if (
    !sameReference(resolvedReference, requestedReference) ||
    typeof passageText !== 'string' ||
    passageText.length === 0 ||
    !visibilityValues.has(passageVisibility) ||
    typeof sourceManifestPath !== 'string' ||
    sourceManifestPath.length === 0 ||
    sourceManifestPath.includes('..')
  ) {
    return fail();
  }

  const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
  const manifestSha256 = createHash('sha256').update(sourceManifestBytes).digest('hex');
  if (artifactSha256 !== requestedReference.sourceSha256) return fail();

  if (catalog !== undefined) {
    const matched = catalog.find(
      (entry) =>
        sameReference(entry.reference, requestedReference) &&
        entry.manifestPath === sourceManifestPath &&
        entry.manifestSha256 === manifestSha256
    );
    if (!matched) return fail();
  }

  const attribution = parseDynamicPermittedManifest(
    sourceManifestBytes,
    requestedReference,
    artifactBytes
  );
  if (attribution === undefined) return fail();

  const authorizationPassage: ResolvedCanonicalPassage = {
    reference: { ...resolvedReference },
    text: passageText,
    visibility: passageVisibility,
    sourceManifestPath,
    artifactBytes: Uint8Array.from(artifactBytes),
    sourceManifestBytes: Uint8Array.from(sourceManifestBytes),
  };
  try {
    if (!(await resolver.canRead(authorizationPassage))) return fail();
  } catch {
    return fail();
  }

  const bytes = Buffer.from(passageText, 'utf8');
  try {
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== passageText) return fail();
  } catch {
    return fail();
  }
  const byteStart = request.byteStart ?? 0;
  const byteEnd = request.byteEnd ?? bytes.byteLength;
  const scalarStart = scalarOffsetAtByte(passageText, byteStart);
  const scalarEnd = scalarOffsetAtByte(passageText, byteEnd);
  if (scalarStart === undefined || scalarEnd === undefined || byteEnd <= byteStart) return fail();

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(byteStart, byteEnd));
  } catch {
    return fail();
  }
  if (text.length === 0) return fail();

  return {
    text,
    citation: {
      ...resolvedReference,
      sourceManifestPath,
      attribution,
    },
    visibility: passageVisibility,
    sourceSpan: {
      basis: 'resolved_passage_text',
      byteStart,
      byteEnd,
      scalarStart,
      scalarEnd,
    },
  };
}

export interface HybridPassageCandidate {
  readonly reference: CanonicalPassageReference;
  readonly text: string;
  readonly visibility: RetrievalVisibility;
  readonly sourceManifestPath: string;
  readonly embedding?: readonly number[];
}

export interface HybridPassageQuery {
  readonly text: string;
  readonly allowedVisibilities: ReadonlySet<RetrievalVisibility>;
  readonly queryEmbedding?: readonly number[];
  readonly limit?: number;
}

export interface HybridPassageSearchResult {
  readonly candidate: HybridPassageCandidate;
  readonly score: number;
  readonly lexicalScore: number;
  readonly semanticScore: number;
}

function tokenizeSearchText(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const matches = normalized.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches : [];
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  if (normLeft <= 0 || normRight <= 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

/**
 * Deterministic hybrid retrieval (BM25 + optional vector cosine combined via RRF) with strict
 * pre-ranking visibility filtering so unauthorized documents cannot alter IDF or rankings.
 */
export function searchLocalPassagesHybrid(
  query: HybridPassageQuery,
  candidates: readonly HybridPassageCandidate[]
): HybridPassageSearchResult[] {
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 10)));
  // Security boundary: visibility filter runs BEFORE tokenization or IDF counting.
  const permitted = candidates.filter((candidate) =>
    query.allowedVisibilities.has(candidate.visibility)
  );
  if (permitted.length === 0) return [];

  const queryTerms = Array.from(new Set(tokenizeSearchText(query.text)));
  const docTokensList = permitted.map((candidate) => tokenizeSearchText(candidate.text));
  const avgDocLength =
    docTokensList.reduce((sum, tokens) => sum + tokens.length, 0) /
    Math.max(1, docTokensList.length);
  const k1 = 1.5;
  const b = 0.75;

  const docFrequency = new Map<string, number>();
  for (const tokens of docTokensList) {
    const unique = new Set(tokens);
    for (const term of queryTerms) {
      if (unique.has(term)) {
        docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  const totalDocs = permitted.length;
  const lexicalScores = docTokensList.map((tokens) => {
    if (queryTerms.length === 0 || tokens.length === 0) return 0;
    const termCounts = new Map<string, number>();
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
    }
    let bm25 = 0;
    for (const term of queryTerms) {
      const tf = termCounts.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const denom = tf + k1 * (1 - b + b * (tokens.length / Math.max(1, avgDocLength)));
      bm25 += idf * ((tf * (k1 + 1)) / denom);
    }
    return bm25;
  });

  const semanticScores = permitted.map((candidate) =>
    query.queryEmbedding && candidate.embedding
      ? Math.max(0, cosineSimilarity(query.queryEmbedding, candidate.embedding))
      : 0
  );

  const lexicalOrder = permitted
    .map((_, idx) => idx)
    .filter((idx) => (lexicalScores[idx] ?? 0) > 0)
    .sort((a, bIdx) => (lexicalScores[bIdx] ?? 0) - (lexicalScores[a] ?? 0));
  const semanticOrder = permitted
    .map((_, idx) => idx)
    .filter((idx) => (semanticScores[idx] ?? 0) > 0)
    .sort((a, bIdx) => (semanticScores[bIdx] ?? 0) - (semanticScores[a] ?? 0));

  const rrfK = 60;
  const rrfScores = new Array<number>(permitted.length).fill(0);
  lexicalOrder.forEach((docIdx, rank) => {
    rrfScores[docIdx] = (rrfScores[docIdx] ?? 0) + 1 / (rrfK + rank + 1);
  });
  semanticOrder.forEach((docIdx, rank) => {
    rrfScores[docIdx] = (rrfScores[docIdx] ?? 0) + 1 / (rrfK + rank + 1);
  });

  return permitted
    .map((candidate, idx) => ({
      candidate,
      score: rrfScores[idx] ?? 0,
      lexicalScore: lexicalScores[idx] ?? 0,
      semanticScore: semanticScores[idx] ?? 0,
    }))
    .filter((entry) => entry.score > 0 || (queryTerms.length === 0 && !query.queryEmbedding))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const sourceCmp = left.candidate.reference.sourceId.localeCompare(
        right.candidate.reference.sourceId
      );
      if (sourceCmp !== 0) return sourceCmp;
      return left.candidate.reference.locator.localeCompare(right.candidate.reference.locator);
    })
    .slice(0, limit);
}
