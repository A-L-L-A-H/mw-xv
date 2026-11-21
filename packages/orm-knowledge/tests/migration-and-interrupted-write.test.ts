import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest, ModelAccess } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  activateResearchGraphRelease,
  createResearchGraphRelease,
  ensureBugCaseWorkflowDefinition,
  intakeBugCase,
  manifest,
  readActiveResearchGraphRelease,
  readApprovedPublication,
  readResearchGraphRelease,
  recordPublicationSnapshot,
} from '../src/index.js';

const TEMP_DIRS: string[] = [];
const OPEN_DBS: Knex[] = [];

const VALID_CITATIONS = [
  {
    source_id: 'mw:source:ebible-webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: 'ae5c2799fad97b0e65334aa39be6193d487419f0d31713caaac58a47f6b4d8b1',
    rights_evidence_ref: 'docs/roadmap/evidence/K2-006.md#source-and-rights',
  },
];

function createSqliteDb(filename: string): Knex {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate(
        connection: { pragma(sql: string): unknown },
        done: (error: Error | null, connection: unknown) => void
      ) {
        connection.pragma('foreign_keys = ON');
        done(null, connection);
      },
    },
  });
  OPEN_DBS.push(db);
  return db;
}

function makeReleaseInput(revision: number) {
  return {
    corpusKey: 'synthetic-recovery-drill',
    schemaVersion: 'research-graph/v1',
    records: [
      {
        key: 'mw:concept:synthetic-drill-scope',
        kind: 'node' as const,
        visibility: 'INTERNAL' as const,
        content: {
          id: 'mw:concept:synthetic-drill-scope',
          kind: 'Concept',
          identity_class: 'ConceptIdentity',
          visibility: 'INTERNAL',
        },
      },
      {
        key: 'mw:assertion:synthetic-drill-1',
        kind: 'assertion' as const,
        visibility: 'PUBLIC' as const,
        content: {
          id: 'mw:assertion:synthetic-drill-1',
          kind: 'Assertion',
          schema_version: 1,
          lifecycle: 'candidate',
          created_at: '2026-10-16T00:00:00Z',
          updated_at: '2026-10-16T00:00:00Z',
          origin_ref: 'fixture://research/recovery-drill',
          visibility: 'PUBLIC_APPROVED',
          content_revision: revision,
          claim: `Synthetic assertion revision ${revision}.`,
          polarity: 'positive',
          scope: { kind: 'research_context', reference_id: 'mw:concept:synthetic-drill-scope' },
          context: { mode: 'analysis', reference_id: 'mw:concept:synthetic-drill-scope' },
          epistemic_status: 'hypothesized',
          review_status: 'pending',
        },
      },
    ],
  };
}

async function seedActors(db: Knex) {
  const companyId = Number((await db('companies').first('id'))?.id);
  const [partner] = await db('partners')
    .insert({ name: 'Drill Requester', active: true })
    .returning('id');
  const partnerId = typeof partner === 'object' ? Number(partner.id) : Number(partner);
  const [requesterRow] = await db('users')
    .insert({ login: 'drill_requester', partner_id: partnerId, role: 'user', active: true })
    .returning('id');
  const requesterUserId =
    typeof requesterRow === 'object' ? Number(requesterRow.id) : Number(requesterRow);
  const superadminId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);
  await db('company_memberships')
    .insert([
      { user_id: requesterUserId, company_id: companyId, active: true, is_default: true },
      { user_id: superadminId, company_id: companyId, active: true, is_default: true },
    ])
    .onConflict(['user_id', 'company_id'])
    .ignore();
  return {
    companyId,
    requesterUserId,
    starterActor: { userId: requesterUserId, companyId, role: 'user' as const },
    reviewerActor: { userId: superadminId, companyId, role: 'superadmin' as const },
  };
}

afterEach(async () => {
  while (OPEN_DBS.length > 0) {
    const db = OPEN_DBS.pop();
    if (db) {
      await db.destroy();
    }
  }
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('K9-003 migration, interrupted-write, and snapshot recovery drill', () => {
  it('re-installs addons idempotently over live data while preserving canonical digests and role policies', async () => {
    const db = createSqliteDb(':memory:');
    const manifests = [
      baseManifest,
      jobsManifest,
      notificationManifest,
      workflowManifest,
      manifest,
    ];
    await installAddons(db, manifests);
    await ensureBugCaseWorkflowDefinition(db);
    const { companyId, requesterUserId, starterActor, reviewerActor } = await seedActors(db);

    const release = await db.transaction((trx) =>
      createResearchGraphRelease(trx, makeReleaseInput(1))
    );
    await db.transaction((trx) =>
      activateResearchGraphRelease(trx, {
        corpusKey: 'synthetic-recovery-drill',
        releaseDigest: release.releaseDigest,
        expectedCurrentReleaseDigest: null,
        activatedAt: '2026-11-21T04:00:00.000Z',
      })
    );

    const pub = await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-drill-001',
      subjectId: 'mw:story:synth-drill-001',
      title: 'Recovery Drill Publication',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Recovery drill approved public summary.',
        citations: VALID_CITATIONS,
      },
      now: new Date('2026-11-21T04:05:00.000Z'),
    });

    const bugCase = await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-01',
      caseId: 'mw:bug-case:synth-drill-001',
      title: 'Drill Case 001',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Drill intake description.',
      idempotencyKey: 'drill-intake-001',
      now: new Date('2026-11-21T04:06:00.000Z'),
    });

    await installAddons(db, manifests);

    const activeAfter = await db.transaction((trx) =>
      readActiveResearchGraphRelease(trx, 'synthetic-recovery-drill')
    );
    expect(activeAfter?.releaseDigest).toBe(release.releaseDigest);

    const storedRelease = await db.transaction((trx) =>
      readResearchGraphRelease(trx, release.releaseDigest)
    );
    expect(storedRelease?.manifestSha256).toBe(release.manifestSha256);

    const pubAfter = await readApprovedPublication(db, {
      companyId,
      publicationId: 'mw:publication:synth-drill-001',
    });
    expect(pubAfter?.projectionDigest).toBe(pub.projectionDigest);

    const caseAfter = await db('knowledge_bug_cases')
      .where({ company_id: companyId, case_id: bugCase.bugCase.case_id })
      .first();
    expect(caseAfter?.case_state).toBe('intake');

    for (const restrictedModel of [
      'knowledge.research_graph_release',
      'knowledge.research_active_release',
      'knowledge.witness_testimony',
      'knowledge.bug_case',
      'knowledge.publication_snapshot',
    ]) {
      const acl = await ModelAccess.query().findOne({
        model_name: restrictedModel,
        read: false,
        write: false,
      });
      expect(acl, `default read/write must stay denied for ${restrictedModel}`).toBeDefined();
    }
  });

  it('rolls back interrupted multi-write transactions and preserves prior active release, publications, and append-only triggers', async () => {
    const db = createSqliteDb(':memory:');
    await installAddons(db, [baseManifest, manifest]);
    const { companyId, requesterUserId, reviewerActor } = await seedActors(db);

    const release1 = await db.transaction((trx) =>
      createResearchGraphRelease(trx, makeReleaseInput(1))
    );
    await db.transaction((trx) =>
      activateResearchGraphRelease(trx, {
        corpusKey: 'synthetic-recovery-drill',
        releaseDigest: release1.releaseDigest,
        expectedCurrentReleaseDigest: null,
        activatedAt: '2026-11-21T04:10:00.000Z',
      })
    );

    const pub1 = await recordPublicationSnapshot({
      db,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-drill-keep',
      subjectId: 'mw:story:synth-drill-keep',
      title: 'Stable Approved Publication',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Must remain intact after mid-flight write interruption.',
        citations: VALID_CITATIONS,
      },
      now: new Date('2026-11-21T04:11:00.000Z'),
    });

    let abortedDigest: string | null = null;
    await expect(
      db.transaction(async (trx) => {
        const release2 = await createResearchGraphRelease(trx, {
          ...makeReleaseInput(2),
          previousReleaseDigest: release1.releaseDigest,
        });
        abortedDigest = release2.releaseDigest;
        await activateResearchGraphRelease(trx, {
          corpusKey: 'synthetic-recovery-drill',
          releaseDigest: release2.releaseDigest,
          expectedCurrentReleaseDigest: release1.releaseDigest,
          activatedAt: '2026-11-21T04:12:00.000Z',
        });
        throw new Error('simulated_interrupted_write');
      })
    ).rejects.toThrow('simulated_interrupted_write');

    const activeAfterAbort = await db.transaction((trx) =>
      readActiveResearchGraphRelease(trx, 'synthetic-recovery-drill')
    );
    expect(activeAfterAbort?.releaseDigest).toBe(release1.releaseDigest);
    expect(abortedDigest).not.toBeNull();
    const uncommittedRelease = await db.transaction((trx) =>
      readResearchGraphRelease(trx, abortedDigest as string)
    );
    expect(uncommittedRelease).toBeNull();

    const stablePub = await readApprovedPublication(db, {
      companyId,
      publicationId: 'mw:publication:synth-drill-keep',
    });
    expect(stablePub?.projectionDigest).toBe(pub1.projectionDigest);

    await expect(
      db('knowledge_publication_snapshots').update({ title: 'Mutated' })
    ).rejects.toThrow();
    await expect(db('knowledge_research_graph_releases').delete()).rejects.toThrow();
  });

  it('recovers exact canonical release digests and publication projections from a file snapshot backup after corruption', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mw-k9-003-restore-'));
    TEMP_DIRS.push(tempDir);
    const livePath = path.join(tempDir, 'live.sqlite');
    const backupPath = path.join(tempDir, 'backup.sqlite');

    const liveDb = createSqliteDb(livePath);
    await installAddons(liveDb, [baseManifest, manifest]);
    const { companyId, requesterUserId, reviewerActor } = await seedActors(liveDb);

    const release = await liveDb.transaction((trx) =>
      createResearchGraphRelease(trx, makeReleaseInput(1))
    );
    await liveDb.transaction((trx) =>
      activateResearchGraphRelease(trx, {
        corpusKey: 'synthetic-recovery-drill',
        releaseDigest: release.releaseDigest,
        expectedCurrentReleaseDigest: null,
        activatedAt: '2026-11-21T04:20:00.000Z',
      })
    );
    const pub = await recordPublicationSnapshot({
      db: liveDb,
      actor: reviewerActor,
      publicationId: 'mw:publication:synth-drill-backup',
      subjectId: 'mw:story:synth-drill-backup',
      title: 'Backup Drill Publication',
      classification: 'PUBLIC_APPROVED',
      rightsState: 'permitted',
      minorInvolved: false,
      reviewStatus: 'approved',
      synthetic: true,
      requesterUserId,
      projection: {
        summary: 'Restored cleanly from point-in-time snapshot.',
        citations: VALID_CITATIONS,
      },
      now: new Date('2026-11-21T04:21:00.000Z'),
    });

    await liveDb.raw('PRAGMA wal_checkpoint(TRUNCATE)');
    await liveDb.destroy();
    await copyFile(livePath, backupPath);

    const damagedDb = createSqliteDb(livePath);
    await damagedDb('knowledge_research_active_releases').delete();
    await damagedDb.raw('DROP TABLE knowledge_publication_snapshots');
    await damagedDb.destroy();

    await copyFile(backupPath, livePath);
    const restoredDb = createSqliteDb(livePath);

    const restoredActive = await restoredDb.transaction((trx) =>
      readActiveResearchGraphRelease(trx, 'synthetic-recovery-drill')
    );
    expect(restoredActive?.releaseDigest).toBe(release.releaseDigest);

    const restoredPub = await readApprovedPublication(restoredDb, {
      companyId,
      publicationId: 'mw:publication:synth-drill-backup',
    });
    expect(restoredPub?.projectionDigest).toBe(pub.projectionDigest);
  });
});
