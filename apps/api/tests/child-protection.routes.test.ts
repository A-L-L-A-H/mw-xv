import { createHash } from 'node:crypto';
import Fastify, { type FastifyPluginAsync } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { childProtectionHttpPlugin } from '@moonwitness/orm-knowledge';

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('child protection and publication risk API gate', () => {
  let db: Knex;
  let app: ReturnType<typeof Fastify>;
  let superadminId: number;
  let companyId: number;
  let otherCompanyId: number;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [baseManifest]);
    superadminId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);
    companyId = Number((await db('companies').first('id'))?.id);
    const [other] = await db('companies')
      .insert({ name: 'Other Safeguarding Tenant', active: true })
      .returning('id');
    otherCompanyId = typeof other === 'object' ? Number(other.id) : Number(other);
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
          userId: superadminId,
          role,
          companyId: request.headers['x-test-company'] === 'other' ? otherCompanyId : companyId,
          groupPermissions: [],
        };
      }
    });
    await app.register(childProtectionHttpPlugin as FastifyPluginAsync);
  });

  afterEach(async () => {
    await app.close();
    await db.destroy();
  });

  it('rejects unauthenticated, ordinary-user, and unassigned-company requests fail-closed', async () => {
    const body = {
      schema_version: 1,
      record_id: 'mw:bug-case:synth-013',
      classification: 'CHILD_SENSITIVE',
      inherited_classifications: [],
      program_slot: 13,
      minor_involved: true,
      synthetic: true,
      requested_channel: 'public_projection',
      safeguarding_process_approved: false,
      candidate_payload: { child_name: 'Sensitive Synthetic Name' },
    };

    const unauth = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      payload: body,
    });
    expect(unauth.statusCode).toBe(401);

    const ordinary = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      headers: { 'x-test-role': 'user' },
      payload: body,
    });
    expect(ordinary.statusCode).toBe(403);

    const wrongCompany = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      headers: { 'x-test-role': 'superadmin', 'x-test-company': 'other' },
      payload: body,
    });
    expect(wrongCompany.statusCode).toBe(403);
  });

  it('denies child-sensitive public disclosure and strips minor identifiers from response payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      headers: { 'x-test-role': 'superadmin' },
      payload: {
        schema_version: 1,
        record_id: 'mw:bug-case:synth-013',
        classification: 'CHILD_SENSITIVE',
        inherited_classifications: [],
        program_slot: 13,
        minor_involved: true,
        synthetic: true,
        requested_channel: 'public_url',
        safeguarding_process_approved: true,
        escalation_approval: {
          safeguarding_owner_id: 'mw:user:owner-1',
          reviewer_id: 'mw:user:reviewer-1',
          requester_id: 'mw:user:requester-1',
          escalation_reason: 'Test escalation',
          approved_at: '2026-11-21T00:00:00Z',
          decision_ref: 'synthetic:esc:api-1',
        },
        candidate_payload: {
          child_name: 'DO_NOT_LEAK_CHILD_NAME',
          raw_allegation: 'DO_NOT_LEAK_ALLEGATION',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toContain('DO_NOT_LEAK_CHILD_NAME');
    expect(response.body).not.toContain('DO_NOT_LEAK_ALLEGATION');
    const parsed = response.json();
    expect(parsed.allowed).toBe(false);
    expect(parsed.audit_summary.reasons).toContain('child_sensitive_channel_forbidden');
    expect(parsed.audit_summary.reasons).toContain('minor_identifiers_detected');
    expect(parsed.detected_minor_identifier_paths).toEqual(['/child_name', '/raw_allegation']);
  });

  it('allows minimized PUBLIC_APPROVED non-minor projections and denies malformed requests', async () => {
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      headers: { 'x-test-role': 'superadmin' },
      payload: {
        schema_version: 1,
        record_id: 'mw:bug-case:synth-001',
        classification: 'PUBLIC_APPROVED',
        inherited_classifications: [],
        program_slot: 1,
        minor_involved: false,
        synthetic: true,
        requested_channel: 'public_projection',
        safeguarding_process_approved: false,
        publication_approval: {
          reviewer_id: 'mw:user:pub-reviewer-1',
          requester_id: 'mw:user:requester-1',
          minimized: true,
          source_revision_sha256: sha('src'),
          projection_revision_sha256: sha('proj'),
          decision_ref: 'synthetic:pub:api-1',
        },
        candidate_payload: {
          sanitized_outcome: 'Synthetic sanitized summary.',
        },
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().allowed).toBe(true);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/research/child-protection/gate-check',
      headers: { 'x-test-role': 'superadmin' },
      payload: { bad: true },
    });
    expect(malformed.statusCode).toBe(400);
  });
});
