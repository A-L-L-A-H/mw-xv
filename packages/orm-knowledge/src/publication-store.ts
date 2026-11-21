import { createHash } from 'node:crypto';
import { containsProhibitedMinorIdentifiers } from '@moonwitness/research';
import type { Knex } from 'knex';
import { canonicalResearchJson } from './research-release.js';

export type PublicationClassification =
  'PUBLIC_APPROVED' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'CHILD_SENSITIVE';

export type PublicationRightsState =
  'permitted' | 'internal_use' | 'metadata_only' | 'unknown' | 'restricted' | 'withdrawn';

export type PublicationReviewStatus =
  'draft' | 'approved' | 'rejected' | 'superseded' | 'taken_down';

export interface PublicationCitation {
  readonly source_id: string;
  readonly edition_id: string;
  readonly locator: string;
  readonly content_sha256: string;
  readonly rights_evidence_ref: string;
}

export interface PublicationProjectionPayload {
  readonly summary: string;
  readonly citations: readonly PublicationCitation[];
}

export interface ApprovedPublicationView {
  readonly publication_id: string;
  readonly revision: number;
  readonly subject_id: string;
  readonly title: string;
  readonly summary: string;
  readonly citations: readonly PublicationCitation[];
  readonly projection_digest: string;
  readonly recorded_at: string;
}

export interface StoredPublicationAuditRevision {
  readonly id: number;
  readonly company_id: number;
  readonly publication_id: string;
  readonly revision: number;
  readonly subject_id: string;
  readonly title: string;
  readonly classification: PublicationClassification;
  readonly rights_state: PublicationRightsState;
  readonly minor_involved: boolean;
  readonly review_status: PublicationReviewStatus;
  readonly synthetic: boolean;
  readonly projection_digest: string;
  readonly requester_id: number;
  readonly reviewer_id: number | null;
  readonly supersedes_digest: string | null;
  readonly takedown_reason_code: string | null;
  readonly recorded_at: string;
}

export interface PublicationActorContext {
  readonly userId: number;
  readonly companyId: number;
  readonly role: 'user' | 'superadmin';
}

export interface RecordPublicationSnapshotInput {
  readonly db: Knex;
  readonly actor: PublicationActorContext;
  readonly publicationId: `mw:publication:${string}`;
  readonly subjectId: string;
  readonly title: string;
  readonly classification: PublicationClassification;
  readonly rightsState: PublicationRightsState;
  readonly minorInvolved: boolean;
  readonly reviewStatus: 'draft' | 'approved' | 'rejected';
  readonly synthetic: boolean;
  readonly requesterUserId: number;
  readonly projection: PublicationProjectionPayload;
  readonly now?: Date;
}

export interface SupersedeOrTakedownInput {
  readonly db: Knex;
  readonly actor: PublicationActorContext;
  readonly publicationId: `mw:publication:${string}`;
  readonly expectedCurrentRevision: number;
  readonly action: 'supersede' | 'takedown';
  readonly reasonCode: string;
  readonly idempotencyKey?: string;
  readonly nextTitle?: string;
  readonly nextProjection?: PublicationProjectionPayload;
  readonly nextRightsState?: PublicationRightsState;
  readonly now?: Date;
}

export type PublicationStoreErrorCode =
  'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTEGRITY_ERROR';

export class PublicationStoreError extends Error {
  readonly code: PublicationStoreErrorCode;

  constructor(code: PublicationStoreErrorCode, message: string) {
    super(message);
    this.name = 'PublicationStoreError';
    this.code = code;
  }
}

const publicationIdPattern = /^mw:publication:[a-z0-9][a-z0-9._-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

function fail(code: PublicationStoreErrorCode, message: string): never {
  throw new PublicationStoreError(code, message);
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalResearchJson(value), 'utf8').digest('hex');
}

function validateCitations(citations: unknown): citations is readonly PublicationCitation[] {
  if (!Array.isArray(citations) || citations.length === 0) return false;
  return citations.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as PublicationCitation).source_id === 'string' &&
      (item as PublicationCitation).source_id.trim().length > 0 &&
      typeof (item as PublicationCitation).edition_id === 'string' &&
      (item as PublicationCitation).edition_id.trim().length > 0 &&
      typeof (item as PublicationCitation).locator === 'string' &&
      (item as PublicationCitation).locator.trim().length > 0 &&
      typeof (item as PublicationCitation).content_sha256 === 'string' &&
      sha256Pattern.test((item as PublicationCitation).content_sha256) &&
      typeof (item as PublicationCitation).rights_evidence_ref === 'string' &&
      (item as PublicationCitation).rights_evidence_ref.trim().length > 0
  );
}

async function assertActiveSuperadminMembership(
  trx: Knex.Transaction,
  actor: PublicationActorContext
): Promise<void> {
  if (
    !Number.isSafeInteger(actor.userId) ||
    actor.userId <= 0 ||
    !Number.isSafeInteger(actor.companyId) ||
    actor.companyId <= 0 ||
    actor.role !== 'superadmin'
  ) {
    fail('FORBIDDEN', 'Publication governance requires an active superadmin in the company');
  }
  const user = await trx('users')
    .where({ id: actor.userId, role: 'superadmin', active: true })
    .forUpdate()
    .first('id');
  const company = await trx('companies')
    .where({ id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  const membership = await trx('company_memberships')
    .where({ user_id: actor.userId, company_id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  if (!user || !company || !membership) {
    fail('FORBIDDEN', 'Actor lacks active company membership for publication management');
  }
}

function mapAuditRow(row: Record<string, unknown>): StoredPublicationAuditRevision {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    publication_id: String(row.publication_id),
    revision: Number(row.revision),
    subject_id: String(row.subject_id),
    title: String(row.title),
    classification: row.classification as PublicationClassification,
    rights_state: row.rights_state as PublicationRightsState,
    minor_involved: Boolean(row.minor_involved),
    review_status: row.review_status as PublicationReviewStatus,
    synthetic: Boolean(row.synthetic),
    projection_digest: String(row.projection_digest),
    requester_id: Number(row.requester_id),
    reviewer_id: row.reviewer_id == null ? null : Number(row.reviewer_id),
    supersedes_digest: row.supersedes_digest == null ? null : String(row.supersedes_digest),
    takedown_reason_code:
      row.takedown_reason_code == null ? null : String(row.takedown_reason_code),
    recorded_at: String(row.recorded_at),
  };
}

function projectIfApprovedPublic(row: Record<string, unknown>): ApprovedPublicationView | null {
  if (
    row.review_status !== 'approved' ||
    row.classification !== 'PUBLIC_APPROVED' ||
    row.rights_state !== 'permitted' ||
    Boolean(row.minor_involved) ||
    row.reviewer_id == null ||
    Number(row.reviewer_id) === Number(row.requester_id)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.projection_json));
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as PublicationProjectionPayload).summary !== 'string' ||
    (parsed as PublicationProjectionPayload).summary.trim().length === 0 ||
    !validateCitations((parsed as PublicationProjectionPayload).citations)
  ) {
    return null;
  }

  const canonical = canonicalResearchJson(parsed);
  if (canonical !== String(row.projection_json)) return null;

  const expectedDigest = sha256Hex({
    publication_id: String(row.publication_id),
    revision: Number(row.revision),
    subject_id: String(row.subject_id),
    title: String(row.title),
    classification: String(row.classification),
    rights_state: String(row.rights_state),
    minor_involved: Boolean(row.minor_involved),
    review_status: String(row.review_status),
    projection: parsed,
  });
  if (expectedDigest !== String(row.projection_digest)) return null;

  if (
    containsProhibitedMinorIdentifiers({
      title: row.title,
      ...(parsed as Record<string, unknown>),
    }).length > 0
  ) {
    return null;
  }

  const payload = parsed as PublicationProjectionPayload;
  return {
    publication_id: String(row.publication_id),
    revision: Number(row.revision),
    subject_id: String(row.subject_id),
    title: String(row.title),
    summary: payload.summary,
    citations: payload.citations,
    projection_digest: String(row.projection_digest),
    recorded_at: String(row.recorded_at),
  };
}

/**
 * Append an immutable publication snapshot revision. Approving `PUBLIC_APPROVED` fails closed
 * on missing citations, unpermitted rights, minor involvement, minor PII, or self-approval.
 */
export async function recordPublicationSnapshot(
  input: RecordPublicationSnapshotInput
): Promise<StoredPublicationAuditRevision> {
  if (
    !publicationIdPattern.test(input.publicationId) ||
    input.subjectId.trim().length === 0 ||
    input.title.trim().length === 0 ||
    typeof input.projection?.summary !== 'string' ||
    input.projection.summary.trim().length === 0 ||
    !validateCitations(input.projection?.citations)
  ) {
    fail('INVALID_INPUT', 'Publication snapshot requires valid ID, title, summary, and citations');
  }

  if (input.reviewStatus === 'approved') {
    if (input.classification !== 'PUBLIC_APPROVED') {
      fail('FORBIDDEN', 'Only PUBLIC_APPROVED classification may be approved for public read');
    }
    if (input.rightsState !== 'permitted') {
      fail('FORBIDDEN', 'Public approval requires rightsState "permitted"');
    }
    if (input.minorInvolved) {
      fail('FORBIDDEN', 'Minor-involved records cannot be approved for public projection');
    }
    if (input.requesterUserId === input.actor.userId) {
      fail('FORBIDDEN', 'Requester cannot self-approve publication');
    }
    if (
      containsProhibitedMinorIdentifiers({
        title: input.title,
        ...input.projection,
      }).length > 0
    ) {
      fail('FORBIDDEN', 'Public projection contains prohibited minor or PII identifiers');
    }
  }

  const canonicalProjection = canonicalResearchJson(input.projection);
  const parsedProjection = JSON.parse(canonicalProjection) as PublicationProjectionPayload;
  const nowIso = (input.now ?? new Date()).toISOString();

  return input.db.transaction(async (trx) => {
    await assertActiveSuperadminMembership(trx, input.actor);

    const latest = await trx('knowledge_publication_snapshots')
      .where({ publication_id: input.publicationId })
      .orderBy('revision', 'desc')
      .forUpdate()
      .first();

    if (latest && Number(latest.company_id) !== input.actor.companyId) {
      fail('FORBIDDEN', 'Publication ID belongs to another tenant');
    }

    const nextRevision = latest ? Number(latest.revision) + 1 : 1;
    const supersedesDigest = latest ? String(latest.projection_digest) : null;
    const reviewerId = input.reviewStatus === 'draft' ? null : input.actor.userId;

    const digest = sha256Hex({
      publication_id: input.publicationId,
      revision: nextRevision,
      subject_id: input.subjectId,
      title: input.title,
      classification: input.classification,
      rights_state: input.rightsState,
      minor_involved: input.minorInvolved,
      review_status: input.reviewStatus,
      projection: parsedProjection,
    });

    await trx('knowledge_publication_snapshots').insert({
      company_id: input.actor.companyId,
      publication_id: input.publicationId,
      revision: nextRevision,
      subject_id: input.subjectId,
      title: input.title,
      classification: input.classification,
      rights_state: input.rightsState,
      minor_involved: input.minorInvolved,
      review_status: input.reviewStatus,
      synthetic: input.synthetic,
      projection_json: canonicalProjection,
      projection_digest: digest,
      requester_id: input.requesterUserId,
      reviewer_id: reviewerId,
      supersedes_digest: supersedesDigest,
      takedown_reason_code: null,
      recorded_at: nowIso,
    });

    const inserted = await trx('knowledge_publication_snapshots')
      .where({ publication_id: input.publicationId, revision: nextRevision })
      .first();
    return mapAuditRow(inserted);
  });
}

/**
 * Supersede or immediately take down a publication by appending an immutable new revision.
 * Retains full prior revision history while immediately stopping public reads.
 */
export async function supersedeOrTakedownPublication(
  input: SupersedeOrTakedownInput
): Promise<StoredPublicationAuditRevision> {
  if (!publicationIdPattern.test(input.publicationId) || input.reasonCode.trim().length === 0) {
    fail('INVALID_INPUT', 'Publication ID and non-empty reasonCode are required');
  }

  const idempotencyKey = input.idempotencyKey?.trim();
  if (input.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length < 4)) {
    fail('INVALID_INPUT', 'idempotencyKey must be at least 4 non-whitespace characters');
  }

  const nowIso = (input.now ?? new Date()).toISOString();

  return input.db.transaction(async (trx) => {
    await assertActiveSuperadminMembership(trx, input.actor);

    if (idempotencyKey) {
      const prior = await trx('knowledge_publication_snapshots')
        .where({
          company_id: input.actor.companyId,
          publication_id: input.publicationId,
          idempotency_key: idempotencyKey,
        })
        .first();
      if (prior) {
        const expectedStatus = input.action === 'takedown' ? 'taken_down' : 'approved';
        const expectedTitle =
          input.action === 'supersede' && input.nextTitle?.trim()
            ? input.nextTitle
            : String(prior.title);
        const projectionMatches =
          input.action === 'takedown' ||
          (input.nextProjection !== undefined &&
            canonicalResearchJson(input.nextProjection) === String(prior.projection_json));
        if (
          prior.review_status !== expectedStatus ||
          String(prior.takedown_reason_code ?? '') !== input.reasonCode ||
          String(prior.title) !== expectedTitle ||
          !projectionMatches
        ) {
          fail('CONFLICT', 'Idempotency key conflicts with prior publication revision');
        }
        return mapAuditRow(prior);
      }
    }

    const latest = await trx('knowledge_publication_snapshots')
      .where({ publication_id: input.publicationId, company_id: input.actor.companyId })
      .orderBy('revision', 'desc')
      .forUpdate()
      .first();

    if (!latest) {
      fail('NOT_FOUND', `Publication "${input.publicationId}" was not found`);
    }
    if (Number(latest.revision) !== input.expectedCurrentRevision) {
      fail('CONFLICT', 'Stale publication revision');
    }

    const nextRevision = Number(latest.revision) + 1;

    if (input.action === 'takedown') {
      const nextRights = input.nextRightsState ?? 'withdrawn';
      const sanitizedTombstone = {
        summary: 'Publication withdrawn.',
        citations: JSON.parse(String(latest.projection_json)).citations as PublicationCitation[],
      };
      const canonicalTombstone = canonicalResearchJson(sanitizedTombstone);
      const digest = sha256Hex({
        publication_id: input.publicationId,
        revision: nextRevision,
        subject_id: String(latest.subject_id),
        title: String(latest.title),
        classification: String(latest.classification),
        rights_state: nextRights,
        minor_involved: Boolean(latest.minor_involved),
        review_status: 'taken_down',
        projection: sanitizedTombstone,
      });

      await trx('knowledge_publication_snapshots').insert({
        company_id: input.actor.companyId,
        publication_id: input.publicationId,
        revision: nextRevision,
        subject_id: latest.subject_id,
        title: latest.title,
        classification: latest.classification,
        rights_state: nextRights,
        minor_involved: Boolean(latest.minor_involved),
        review_status: 'taken_down',
        synthetic: Boolean(latest.synthetic),
        projection_json: canonicalTombstone,
        projection_digest: digest,
        requester_id: latest.requester_id,
        reviewer_id: input.actor.userId,
        supersedes_digest: latest.projection_digest,
        takedown_reason_code: input.reasonCode,
        idempotency_key: idempotencyKey ?? null,
        recorded_at: nowIso,
      });
    } else {
      if (
        !input.nextProjection ||
        typeof input.nextProjection.summary !== 'string' ||
        input.nextProjection.summary.trim().length === 0 ||
        !validateCitations(input.nextProjection.citations)
      ) {
        fail('INVALID_INPUT', 'Supersede requires valid nextProjection summary and citations');
      }
      if (Number(latest.requester_id) === input.actor.userId) {
        fail('FORBIDDEN', 'Requester cannot self-approve superseded publication');
      }
      const nextTitle = input.nextTitle?.trim() ? input.nextTitle : String(latest.title);
      const nextRights = input.nextRightsState ?? (latest.rights_state as PublicationRightsState);
      if (
        latest.classification !== 'PUBLIC_APPROVED' ||
        nextRights !== 'permitted' ||
        Boolean(latest.minor_involved) ||
        containsProhibitedMinorIdentifiers({ title: nextTitle, ...input.nextProjection }).length > 0
      ) {
        fail(
          'FORBIDDEN',
          'Superseded public revision must satisfy PUBLIC_APPROVED and rights gates'
        );
      }

      const canonicalNext = canonicalResearchJson(input.nextProjection);
      const parsedNext = JSON.parse(canonicalNext) as PublicationProjectionPayload;
      const digest = sha256Hex({
        publication_id: input.publicationId,
        revision: nextRevision,
        subject_id: String(latest.subject_id),
        title: nextTitle,
        classification: 'PUBLIC_APPROVED',
        rights_state: nextRights,
        minor_involved: false,
        review_status: 'approved',
        projection: parsedNext,
      });

      await trx('knowledge_publication_snapshots').insert({
        company_id: input.actor.companyId,
        publication_id: input.publicationId,
        revision: nextRevision,
        subject_id: latest.subject_id,
        title: nextTitle,
        classification: 'PUBLIC_APPROVED',
        rights_state: nextRights,
        minor_involved: false,
        review_status: 'approved',
        synthetic: Boolean(latest.synthetic),
        projection_json: canonicalNext,
        projection_digest: digest,
        requester_id: latest.requester_id,
        reviewer_id: input.actor.userId,
        supersedes_digest: latest.projection_digest,
        takedown_reason_code: input.reasonCode,
        idempotency_key: idempotencyKey ?? null,
        recorded_at: nowIso,
      });
    }

    const inserted = await trx('knowledge_publication_snapshots')
      .where({ publication_id: input.publicationId, revision: nextRevision })
      .first();
    return mapAuditRow(inserted);
  });
}

/**
 * Read one approved public publication by ID. Fails closed (`null`) unless the latest
 * revision is `PUBLIC_APPROVED`, `approved`, `rights_state === 'permitted'`, non-minor,
 * independent-reviewed, and passes digest and PII re-verification.
 */
export async function readApprovedPublication(
  db: Knex,
  publicationId: string
): Promise<ApprovedPublicationView | null> {
  if (!publicationIdPattern.test(publicationId)) return null;
  const latest = await db('knowledge_publication_snapshots')
    .where({ publication_id: publicationId })
    .orderBy('revision', 'desc')
    .first();
  if (!latest) return null;
  return projectIfApprovedPublic(latest);
}

/** List only latest revisions that pass every PUBLIC_APPROVED, rights, review, and non-minor gate. */
export async function listApprovedPublications(
  db: Knex,
  limit = 50
): Promise<ApprovedPublicationView[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await db('knowledge_publication_snapshots').orderBy([
    { column: 'publication_id', order: 'asc' },
    { column: 'revision', order: 'desc' },
  ]);

  const seenIds = new Set<string>();
  const approved: ApprovedPublicationView[] = [];
  for (const row of rows) {
    const pubId = String(row.publication_id);
    if (seenIds.has(pubId)) continue;
    seenIds.add(pubId);
    const view = projectIfApprovedPublic(row);
    if (view) {
      approved.push(view);
      if (approved.length >= boundedLimit) break;
    }
  }
  return approved;
}

/** Read full immutable revision/takedown audit history for authorized company superadmins only. */
export async function readPublicationAuditHistory(
  db: Knex,
  publicationId: string,
  actor: PublicationActorContext
): Promise<StoredPublicationAuditRevision[]> {
  if (!publicationIdPattern.test(publicationId)) {
    fail('INVALID_INPUT', 'Invalid publication ID');
  }
  return db.transaction(async (trx) => {
    await assertActiveSuperadminMembership(trx, actor);
    const rows = await trx('knowledge_publication_snapshots')
      .where({ company_id: actor.companyId, publication_id: publicationId })
      .orderBy('revision', 'asc');
    if (rows.length === 0) {
      fail('NOT_FOUND', `Publication "${publicationId}" was not found`);
    }
    return rows.map((row) => mapAuditRow(row));
  });
}
