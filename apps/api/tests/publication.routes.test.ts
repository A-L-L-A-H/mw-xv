import Fastify, { type FastifyPluginAsync } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import {
  manifest as knowledgeManifest,
  publicationHttpPlugin,
  recordPublicationSnapshot,
} from '@moonwitness/orm-knowledge';

const validCitations = [
  {
    source_id: 'mw:source:ebible-webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: 'ae5c2799fad97b0e65334aa39be6193d487419f0d31713caaac58a47f6b4d8b1',
    rights_evidence_ref: 'docs/roadmap/evidence/K2-006.md#source-and-rights',
  },
];

describe('approved publication read API & revision/takedown (K8-003, K8-006)', () => {
  let db: Knex;
  let app: ReturnType<typeof Fastify>;
  let companyId: number;
  let otherCompanyId: number;
  let superadminId: number;
  let requesterUserId: number;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [baseManifest, knowledgeManifest]);
    companyId = Number((await db('companies').first('id'))?.id);
    const [other] = await db('companies')
      .insert({ name: 'Other Pub Company', active: true })
      .returning('id');
    otherCompanyId = typeof other === 'object' ? Number(other.id) : Number(other);
    superadminId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);

    const [partner] = await db('partners')
      .insert({ name: 'API Pub Requester', active: true })
      .returning('id');
    const partnerId = typeof partner === 'object' ? Number(partner.id) : Number(partner);
    const [requester] = await db('users')
      .insert({ login: 'api_pub_req', partner_id: partnerId, role: 'user', active: true })
      .returning('id');
    requesterUserId = typeof requester === 'object' ? Number(requester.id) : Number(requester);

    await db('company_memberships')
      .insert({ user_id: superadminId, company_id: companyId, active: true, is_default: true })
      .onConflict(['user_id', 'company_id'])
      .ignore();

    app = Fastify();
    app.decorateRequest('auth', null);
    app.decorate('db', db);
    app.addHook('onRequest', async (request) => {
      const role = request.headers['x-test-role'];
      if (role === 'superadmin' || role === 'user') {
        request.auth = {
          userId: role === 'user' ? requesterUserId : superadminId,
          role,
          companyId: request.headers['x-test-company'] === 'other' ? otherCompanyId : companyId,
          groupPermissions: [],
        };
      }
    });
    await app.register(publicationHttpPlugin as FastifyPluginAsync);
  });

  afterEach(async () => {
    await app.close();
    await db.destroy();
  });

  it('serves only PUBLIC_APPROVED cleared snapshots with ETag and Cache-Control and returns identical 404 for guessed private/draft/unknown-rights IDs', async () => {
    const approved = await recordPublicationSnapshot({
      db,
      actor: { userId: superadminId, companyId, role: 'superadmin' },
      publicationId: 'mw:publication:api-public-001',
      subjectId: 'mw:story:api-001',
      title: 'Public API Synthetic Entry',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Publicly cleared synthetic summary.',
        citations: validCitations,
      },
      now: new Date('2026-11-21T04:00:00.000Z'),
    });

    await recordPublicationSnapshot({
      db,
      actor: { userId: superadminId, companyId, role: 'superadmin' },
      publicationId: 'mw:publication:api-restricted-002',
      subjectId: 'mw:witness:secret-002',
      title: 'RESTRICTED WITNESS DO NOT LEAK',
      classification: 'RESTRICTED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'draft',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'CANARY_RESTRICTED_PLAINTEXT',
        citations: validCitations,
      },
    });

    const listRes = await app.inject({ method: 'GET', url: '/api/public/publications' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.headers['cache-control']).toBe('no-store, must-revalidate');
    expect(listRes.body).not.toContain('CANARY_RESTRICTED_PLAINTEXT');
    expect(listRes.json().data).toHaveLength(1);
    expect(listRes.json().data[0].publication_id).toBe('mw:publication:api-public-001');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:api-public-001',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['etag']).toBe(`"${approved.projection_digest}"`);
    expect(getRes.headers['cache-control']).toBe('no-store, must-revalidate');

    const notModified = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:api-public-001',
      headers: { 'if-none-match': `"${approved.projection_digest}"` },
    });
    expect(notModified.statusCode).toBe(304);

    const guessedPrivate = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:api-restricted-002',
    });
    const missingId = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:nonexistent-999',
    });
    expect(guessedPrivate.statusCode).toBe(404);
    expect(missingId.statusCode).toBe(404);
    expect(guessedPrivate.json()).toEqual(missingId.json());
  });

  it('supersedes and takes down publications immediately, invalidates cached ETags, enforces permissions, and preserves internal audit lineage (K8-006)', async () => {
    const rev1 = await recordPublicationSnapshot({
      db,
      actor: { userId: superadminId, companyId, role: 'superadmin' },
      publicationId: 'mw:publication:api-lifecycle-003',
      subjectId: 'mw:story:api-003',
      title: 'Initial Public Title',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Initial public text.',
        citations: validCitations,
      },
    });

    // Unauthenticated, ordinary-user, and foreign-company supersede attempts fail closed
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/takedown',
      payload: { expected_current_revision: 1, reason_code: 'rights_complaint' },
    });
    expect(unauth.statusCode).toBe(401);

    const ordinary = await app.inject({
      method: 'POST',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/takedown',
      headers: { 'x-test-role': 'user' },
      payload: { expected_current_revision: 1, reason_code: 'rights_complaint' },
    });
    expect(ordinary.statusCode).toBe(403);

    const wrongCompany = await app.inject({
      method: 'GET',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/audit',
      headers: { 'x-test-role': 'superadmin', 'x-test-company': 'other' },
    });
    expect(wrongCompany.statusCode).toBe(403);

    // Supersede revision 1 -> revision 2
    const supersedeRes = await app.inject({
      method: 'POST',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/supersede',
      headers: { 'x-test-role': 'superadmin' },
      payload: {
        expected_current_revision: 1,
        reason_code: 'editorial_correction',
        idempotency_key: 'api-supersede-003',
        next_title: 'Updated Public Title',
        next_projection: {
          summary: 'Updated corrected summary.',
          citations: validCitations,
        },
      },
    });
    expect(supersedeRes.statusCode).toBe(200);
    const rev2 = supersedeRes.json().data;
    expect(rev2.revision).toBe(2);
    expect(rev2.supersedes_digest).toBe(rev1.projection_digest);

    // Stale ETag from rev1 does NOT return 304; serves updated rev2 with new ETag
    const publicRev2 = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:api-lifecycle-003',
      headers: { 'if-none-match': `"${rev1.projection_digest}"` },
    });
    expect(publicRev2.statusCode).toBe(200);
    expect(publicRev2.json().data.revision).toBe(2);
    expect(publicRev2.headers['etag']).toBe(`"${rev2.projection_digest}"`);

    // Immediate takedown
    const takedownRes = await app.inject({
      method: 'POST',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/takedown',
      headers: { 'x-test-role': 'superadmin' },
      payload: {
        expected_current_revision: 2,
        reason_code: 'privacy_withdrawal',
        idempotency_key: 'api-takedown-003',
      },
    });
    expect(takedownRes.statusCode).toBe(200);
    expect(takedownRes.json().data.review_status).toBe('taken_down');

    // Public read returns 404 immediately even with rev2 ETag, and list excludes it
    const afterTakedownGet = await app.inject({
      method: 'GET',
      url: '/api/public/publications/mw:publication:api-lifecycle-003',
      headers: { 'if-none-match': `"${rev2.projection_digest}"` },
    });
    expect(afterTakedownGet.statusCode).toBe(404);
    const afterTakedownList = await app.inject({ method: 'GET', url: '/api/public/publications' });
    expect(afterTakedownList.json().data).toEqual([]);

    // Internal audit history retains all 3 immutable revisions
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/research/publications/mw:publication:api-lifecycle-003/audit',
      headers: { 'x-test-role': 'superadmin' },
    });
    expect(auditRes.statusCode).toBe(200);
    const auditItems = auditRes.json().data;
    expect(auditItems).toHaveLength(3);
    expect(auditItems[2].review_status).toBe('taken_down');
    expect(auditItems[2].takedown_reason_code).toBe('privacy_withdrawal');
  });
});
