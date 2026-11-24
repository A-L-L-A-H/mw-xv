import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import {
  extractTemplateVariables,
  isTemplateStructure,
  renderTemplate,
  validateVariables,
  canTransitionTemplateStatus,
  canTransitionAssetStatus,
  canTransitionCampaignStatus,
} from '../src/domain.js';
import { contentFactorySeedManifest } from '../src/seed-manifest.js';
import { seedContentFactoryTables } from './helpers/seed-tables.js';

type SqliteKnex = Knex & { destroy(): Promise<void> };

async function createDb(): Promise<SqliteKnex> {
  const knexFactory = (await import('knex')).default;
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as SqliteKnex;
  await seedContentFactoryTables(knex);
  return knex;
}

describe('domain: extractTemplateVariables', () => {
  it('extracts unique variable names from sections', () => {
    const structure = {
      sections: [
        { title: '{{title}}', body: '{{intro}} and {{title}} again' },
        { title: 'Static', body: '{{conclusion}}' },
      ],
    };
    expect(extractTemplateVariables(structure)).toEqual(['title', 'intro', 'conclusion']);
  });

  it('returns empty for non-structure input', () => {
    expect(extractTemplateVariables(null)).toEqual([]);
    expect(extractTemplateVariables('nope')).toEqual([]);
    expect(extractTemplateVariables({ sections: 'nope' })).toEqual([]);
  });
});

describe('domain: isTemplateStructure', () => {
  it('accepts valid structures and rejects malformed ones', () => {
    expect(isTemplateStructure({ sections: [{ title: 'a', body: 'b' }] })).toBe(true);
    expect(isTemplateStructure({ sections: [{ title: 1, body: 'b' }] })).toBe(false);
    expect(isTemplateStructure({})).toBe(false);
    expect(isTemplateStructure(undefined)).toBe(false);
  });
});

describe('domain: renderTemplate', () => {
  it('substitutes variables and reports missing ones', () => {
    const structure = {
      sections: [
        { title: '{{title}}', body: 'Hello {{name}}' },
        { title: 'CTA', body: 'Visit {{landing_url}} today' },
      ],
    };
    const result = renderTemplate(structure, { title: 'Launch', name: 'Ada' });
    expect(result.rendered).toContain('# Launch');
    expect(result.rendered).toContain('Hello Ada');
    expect(result.missingVariables).toEqual(['landing_url']);
  });

  it('renders empty string for missing variables but keeps section shape', () => {
    const result = renderTemplate({ sections: [{ title: 'T', body: '{{missing}}' }] }, {});
    expect(result.rendered).toContain('# T');
    expect(result.missingVariables).toEqual(['missing']);
  });
});

describe('domain: validateVariables', () => {
  it('flags missing required variables', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] };
    expect(validateVariables(schema, { a: 'x' })).toEqual({ valid: false, missing: ['b'] });
    expect(validateVariables(schema, { a: 'x', b: 'y' })).toEqual({ valid: true, missing: [] });
  });

  it('passes when schema is absent or malformed', () => {
    expect(validateVariables(null, {})).toEqual({ valid: true, missing: [] });
    expect(validateVariables('nope', {})).toEqual({ valid: true, missing: [] });
    expect(validateVariables({ type: 'object' }, {})).toEqual({ valid: true, missing: [] });
  });
});

describe('domain: status transition guards', () => {
  it('template transitions follow the workflow', () => {
    expect(canTransitionTemplateStatus('draft', 'review')).toBe(true);
    expect(canTransitionTemplateStatus('review', 'approved')).toBe(true);
    expect(canTransitionTemplateStatus('approved', 'archived')).toBe(true);
    expect(canTransitionTemplateStatus('draft', 'approved')).toBe(false);
    expect(canTransitionTemplateStatus('archived', 'draft')).toBe(false);
  });

  it('asset transitions follow the pipeline', () => {
    expect(canTransitionAssetStatus('pending', 'processing')).toBe(true);
    expect(canTransitionAssetStatus('processing', 'ready')).toBe(true);
    expect(canTransitionAssetStatus('processing', 'failed')).toBe(true);
    expect(canTransitionAssetStatus('failed', 'pending')).toBe(true);
    expect(canTransitionAssetStatus('ready', 'processing')).toBe(false);
  });

  it('campaign transitions follow the lifecycle', () => {
    expect(canTransitionCampaignStatus('planned', 'active')).toBe(true);
    expect(canTransitionCampaignStatus('active', 'paused')).toBe(true);
    expect(canTransitionCampaignStatus('paused', 'active')).toBe(true);
    expect(canTransitionCampaignStatus('active', 'completed')).toBe(true);
    expect(canTransitionCampaignStatus('completed', 'active')).toBe(false);
    expect(canTransitionCampaignStatus('cancelled', 'active')).toBe(false);
  });
});

describe('seed-manifest: contentFactorySeedManifest', () => {
  it('declares version and base dependency', () => {
    expect(contentFactorySeedManifest.seedVersion).toBe('1.0.0');
    expect(contentFactorySeedManifest.dependencies).toEqual(['base']);
    expect(typeof contentFactorySeedManifest.seed).toBe('function');
  });

  it('upserts default templates by slug (insert then update)', async () => {
    const db = await createDb();
    try {
      const ctx = { db, companyId: 7 } as unknown as Parameters<
        typeof contentFactorySeedManifest.seed
      >[0];

      const first = await contentFactorySeedManifest.seed(ctx);
      expect(first.inserted).toBe(4);
      expect(first.updated).toBe(0);

      const rows = await db('content_templates').orderBy('slug');
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.slug)).toEqual([
        'article-default',
        'newsletter-default',
        'social-post-default',
        'video-script-default',
      ]);
      expect(rows.every((r) => r.company_id === 7)).toBe(true);

      await db('content_templates')
        .where({ slug: 'article-default' })
        .update({ name: 'Stale Name' });
      const second = await contentFactorySeedManifest.seed(ctx);
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(4);

      const article = await db('content_templates').where({ slug: 'article-default' }).first();
      expect(article.name).toBe('Default Article');
    } finally {
      await db.destroy();
    }
  });
});

describe('seed-manifest: idempotent re-run preserves count', () => {
  let db: SqliteKnex;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('never duplicates rows across runs', async () => {
    const ctx = { db, companyId: 1 } as unknown as Parameters<
      typeof contentFactorySeedManifest.seed
    >[0];
    await contentFactorySeedManifest.seed(ctx);
    await contentFactorySeedManifest.seed(ctx);
    await contentFactorySeedManifest.seed(ctx);
    const count = await db('content_templates')
      .count<{ count: number | string }[]>('* as count')
      .first();
    expect(Number(count?.count ?? 0)).toBe(4);
  });
});
