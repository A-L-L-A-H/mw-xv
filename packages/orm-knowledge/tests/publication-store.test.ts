import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest, ModelAccess } from '@moonwitness/orm-base';
import {
  listApprovedPublications,
  manifest,
  PublicationSnapshot,
  PublicationStoreError,
  readApprovedPublication,
  readPublicationAuditHistory,
  recordPublicationSnapshot,
  supersedeOrTakedownPublication,
  type PublicationActorContext,
} from '../src/index.js';

const sha = (label: string) => createHash('sha256').update(label, 'utf8').digest('hex');

const validCitations = [
  {
    source_id: 'mw:source:ebible-webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: 'ae5c2799fad97b0e65334aa39be6193d487419f0d31713caaac58a47f6b4d8b1',
    rights_evidence_ref: 'docs/roadmap/evidence/K2-006.md#source-and-rights',
  },
];

describe('approved publication projection store (K8-003)', () => {
  let db: Knex;
  let companyId: number;
  let requesterUserId: number;
  let reviewerActor: PublicationActorContext;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [baseManifest, manifest]);
    companyId = Number((await db('companies').first('id'))?.id);

    const [partner] = await db('partners')
      .insert({ name: 'Publication Requester', active: true })
      .returning('id');
    const partnerId = typeof partner === 'object' ? Number(partner.id) : Number(partner);
    const [requesterRow] = await db('users')
      .insert({ login: 'pub_requester', partner_id: partnerId, role: 'user', active: true })
      .returning('id');
    requesterUserId =
      typeof requesterRow === 'object' ? Number(requesterRow.id) : Number(requesterRow);

    const superadminId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);
    reviewerActor = { userId: superadminId, companyId, role: 'superadmin' };

    await db('company_memberships')
      .insert({ user_id: superadminId, company_id: companyId, active: true, is_default: true })
      .onConflict(['user_id', 'company_id'])
      .ignore();
  });

  afterEach(async () => db.destroy());

  it('serves only PUBLIC_APPROVED, permitted-rights, independent-reviewed projections and conceals internal/draft/unknown/minor records', async () => {
    const approved = await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-approved-001',
      subjectId: 'mw:story:synth-001',
      title: 'Approved Synthetic Summary',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Synthetic approved public summary.',
        citations: validCitations,
      },
      now: new Date('2026-11-21T03:00:00.000Z'),
    });

    await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-draft-002',
      subjectId: 'mw:story:synth-002',
      title: 'Draft Only',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'draft',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Draft projection must stay hidden.',
        citations: validCitations,
      },
    });

    await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-internal-003',
      subjectId: 'mw:bug-case:synth-003',
      title: 'Internal Case',
      classification: 'INTERNAL',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'draft',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Internal record must stay hidden.',
        citations: validCitations,
      },
    });

    await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-unknown-rights-004',
      subjectId: 'mw:story:synth-004',
      title: 'Unknown Rights',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'unknown',
      minorInvolved: false,
      reviewStatus: 'draft',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Unknown rights must stay hidden.',
        citations: validCitations,
      },
    });

    const single = await readApprovedPublication(db, 'mw:publication:synth-approved-001');
    expect(single).toMatchObject({
      publication_id: 'mw:publication:synth-approved-001',
      revision: 1,
      title: 'Approved Synthetic Summary',
      projection_digest: approved.projection_digest,
    });

    expect(await readApprovedPublication(db, 'mw:publication:synth-draft-002')).toBeNull();
    expect(await readApprovedPublication(db, 'mw:publication:synth-internal-003')).toBeNull();
    expect(await readApprovedPublication(db, 'mw:publication:synth-unknown-rights-004')).toBeNull();
    expect(await readApprovedPublication(db, 'mw:publication:missing-999')).toBeNull();

    const list = await listApprovedPublications(db);
    expect(list).toHaveLength(1);
    expect(list[0].publication_id).toBe('mw:publication:synth-approved-001');
  });

  it('rejects self-approval, minor-involved approval, unknown-license approval, and minor PII on write, and blocks SQL mutation', async () => {
    await expect(
      recordPublicationSnapshot({
        db,
        actor: reviewerActor,
        publicationId: 'mw:publication:bad-self',
        subjectId: 'mw:story:bad-1',
        title: 'Self Approved',
        classification: 'PUBLIC_APPROVED',
        rightsState: 'permitted',
        minorInvolved: false,
        reviewStatus: 'approved',
        synthetic: true,
        requesterUserId: reviewerActor.userId,
        projection: { summary: 'Self approved.', citations: validCitations },
      })
    ).rejects.toThrow(PublicationStoreError);

    await expect(
      recordPublicationSnapshot({
        db,
        actor: reviewerActor,
        publicationId: 'mw:publication:bad-minor',
        subjectId: 'mw:bug-case:slot-13',
        title: 'Minor Case',
        classification: 'CHILD_SENSITIVE',
        rightsState: 'permitted',
        minorInvolved: true,
        reviewStatus: 'approved',
        synthetic: true,
        requesterUserId,
        projection: { summary: 'Minor cannot be public.', citations: validCitations },
      })
    ).rejects.toThrow(PublicationStoreError);

    await expect(
      recordPublicationSnapshot({
        db,
        actor: reviewerActor,
        publicationId: 'mw:publication:bad-rights',
        subjectId: 'mw:story:bad-rights',
        title: 'Unknown License',
        classification: 'PUBLIC_APPROVED',
        rightsState: 'unknown',
        minorInvolved: false,
        reviewStatus: 'approved',
        synthetic: true,
        requesterUserId,
        projection: { summary: 'Unknown rights.', citations: validCitations },
      })
    ).rejects.toThrow(PublicationStoreError);

    await expect(
      recordPublicationSnapshot({
        db,
        actor: reviewerActor,
        publicationId: 'mw:publication:bad-pii',
        subjectId: 'mw:story:bad-pii',
        title: 'Contains Email leak@example.invalid',
        classification: 'PUBLIC_APPROVED',
        rightsState: 'permitted',
        minorInvolved: false,
        reviewStatus: 'approved',
        synthetic: true,
        requesterUserId,
        projection: { summary: 'Email leaked.', citations: validCitations },
      })
    ).rejects.toThrow(PublicationStoreError);

    await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:immutable-test',
      subjectId: 'mw:story:imm-1',
      title: 'Immutable Snapshot',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: { summary: 'Immutable text.', citations: validCitations },
    });

    await expect(
      db('knowledge_publication_snapshots').update({ title: 'Tampered' })
    ).rejects.toThrow(/append-only/u);
    await expect(db('knowledge_publication_snapshots').delete()).rejects.toThrow(/append-only/u);

    // Tampered projection_digest row inserted directly fails closed on public read
    await db('knowledge_publication_snapshots').insert({
      company_id: companyId,
      publication_id: 'mw:publication:tampered-row',
      revision: 1,
      subject_id: 'mw:story:tampered',
      title: 'Tampered Row',
      classification: 'PUBLIC_APPROVED',
      rights_state: 'permitted',
      minor_involved: false,
      review_status: 'approved',
      synthetic: true,
      projection_json: JSON.stringify({ summary: 'Tampered', citations: validCitations }),
      projection_digest: sha('wrong-digest'),
      requester_id: requesterUserId,
      reviewer_id: reviewerActor.userId,
      recorded_at: new Date().toISOString(),
    });
    expect(await readApprovedPublication(db, 'mw:publication:tampered-row')).toBeNull();

    const userGroup = await db('access_groups').where({ code: 'user' }).first('id');
    const access = await ModelAccess.query().findOne({
      group_id: userGroup?.id,
      model_name: PublicationSnapshot.modelName,
    });
    expect(access).toMatchObject({ read: false, create: false, write: false, unlink: false });
  });

  it('supports append-only superseding, immediate takedown, idempotent replay, and immutable audit lineage (K8-006)', async () => {
    const rev1 = await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-lifecycle-001',
      subjectId: 'mw:story:lifecycle-001',
      title: 'Lifecycle Revision 1',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Revision 1 approved summary.',
        citations: validCitations,
      },
      now: new Date('2026-11-21T05:00:00.000Z'),
    });

    const rev2 = await supersedeOrTakedownPublication({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-lifecycle-001',
      expectedCurrentRevision: 1,
      action: 'supersede',
      reasonCode: 'correction_superseded',
      idempotencyKey: 'supersede-rev2-001',
      nextTitle: 'Lifecycle Revision 2',
      nextProjection: {
        summary: 'Revision 2 corrected summary.',
        citations: validCitations,
      },
      now: new Date('2026-11-21T05:05:00.000Z'),
    });

    expect(rev2.revision).toBe(2);
    expect(rev2.supersedes_digest).toBe(rev1.projection_digest);

    // Idempotent supersede replay returns rev2 without creating rev3
    const rev2Replay = await supersedeOrTakedownPublication({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-lifecycle-001',
      expectedCurrentRevision: 1,
      action: 'supersede',
      reasonCode: 'correction_superseded',
      idempotencyKey: 'supersede-rev2-001',
      nextTitle: 'Lifecycle Revision 2',
      nextProjection: {
        summary: 'Revision 2 corrected summary.',
        citations: validCitations,
      },
    });
    expect(rev2Replay.revision).toBe(2);

    // Conflicting supersede with same idempotencyKey fails closed
    await expect(
      supersedeOrTakedownPublication({
        db,
        actor: reviewerActor,
        publicationId: 'mw:publication:synth-lifecycle-001',
        expectedCurrentRevision: 2,
        action: 'supersede',
        reasonCode: 'correction_superseded',
        idempotencyKey: 'supersede-rev2-001',
        nextTitle: 'Different Title',
        nextProjection: {
          summary: 'Revision 2 corrected summary.',
          citations: validCitations,
        },
      })
    ).rejects.toThrow(PublicationStoreError);

    const publicAfterSupersede = await readApprovedPublication(
      db,
      'mw:publication:synth-lifecycle-001'
    );
    expect(publicAfterSupersede?.revision).toBe(2);
    expect(publicAfterSupersede?.summary).toBe('Revision 2 corrected summary.');

    // Takedown immediately removes from public read while preserving 3-revision audit trail
    const rev3 = await supersedeOrTakedownPublication({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-lifecycle-001',
      expectedCurrentRevision: 2,
      action: 'takedown',
      reasonCode: 'rights_complaint',
      idempotencyKey: 'takedown-rev3-001',
      now: new Date('2026-11-21T05:10:00.000Z'),
    });
    expect(rev3.revision).toBe(3);
    expect(rev3.review_status).toBe('taken_down');
    expect(rev3.rights_state).toBe('withdrawn');
    expect(rev3.supersedes_digest).toBe(rev2.projection_digest);

    expect(await readApprovedPublication(db, 'mw:publication:synth-lifecycle-001')).toBeNull();
    expect(await listApprovedPublications(db)).toEqual([]);

    const audit = await readPublicationAuditHistory(
      db,
      'mw:publication:synth-lifecycle-001',
      reviewerActor
    );
    expect(audit.map((item) => item.revision)).toEqual([1, 2, 3]);
    expect(audit[2].takedown_reason_code).toBe('rights_complaint');
  });
});
