import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import {
  manifest as knowledgeManifest,
  recordPublicationSnapshot,
} from '@moonwitness/orm-knowledge';
import { publicationRoutes } from '../src/routes/publication.routes.js';

const validCitations = [
  {
    source_id: 'mw:source:ebible-webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: 'ae5c2799fad97b0e65334aa39be6193d487419f0d31713caaac58a47f6b4d8b1',
    rights_evidence_ref: 'docs/roadmap/evidence/K2-006.md#source-and-rights',
  },
];

describe('approved publication read API (K8-003)', () => {
  let db: Knex;
  let app: ReturnType<typeof Fastify>;
  let companyId: number;
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
    app.decorate('db', db);
    await app.register(publicationRoutes);
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
});
