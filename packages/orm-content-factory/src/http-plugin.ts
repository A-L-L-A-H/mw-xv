import type { AddonHttpPlugin } from '@moonwitness/orm';
import type { Knex } from 'knex';
import {
  isTemplateStructure,
  renderTemplate,
  validateVariables,
  canTransitionAssetStatus,
  type TemplateStructure,
} from './domain.js';

interface AuthoredContent {
  sections: Array<{ title: string; body: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseStructure(raw: unknown): TemplateStructure | null {
  if (isTemplateStructure(raw)) return raw;
  const record = asRecord(raw);
  if (!record || typeof record.sections === 'string') return null;
  return null;
}

export async function upsertDailyAnalytics(
  db: Knex,
  assetId: number,
  companyId: number,
  date: string,
  deltas: {
    views?: number;
    clicks?: number;
    shares?: number;
    conversions?: number;
    revenue_minor?: number;
  }
): Promise<void> {
  const existing = await db('content_analytics').where({ asset_id: assetId, date }).first();

  if (existing) {
    await db('content_analytics')
      .where({ id: existing.id })
      .update({
        views: existing.views + (deltas.views ?? 0),
        clicks: existing.clicks + (deltas.clicks ?? 0),
        shares: existing.shares + (deltas.shares ?? 0),
        conversions: existing.conversions + (deltas.conversions ?? 0),
        revenue_minor: existing.revenue_minor + (deltas.revenue_minor ?? 0),
        updated_at: new Date(),
      });
  } else {
    await db('content_analytics').insert({
      asset_id: assetId,
      company_id: companyId,
      date,
      views: deltas.views ?? 0,
      clicks: deltas.clicks ?? 0,
      shares: deltas.shares ?? 0,
      conversions: deltas.conversions ?? 0,
      revenue_minor: deltas.revenue_minor ?? 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

export const contentFactoryHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/content/templates/:slug/render', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    const locale = typeof body.locale === 'string' && body.locale.length > 0 ? body.locale : 'en';

    const db = app.db;
    if (!db) {
      return reply.code(500).send({ success: false, error: 'Database not available' });
    }

    const template = await db('content_templates').where({ slug }).first();
    if (!template) {
      return reply.code(404).send({ success: false, error: 'Template not found' });
    }
    if (template.status !== 'approved' && template.status !== 'review') {
      return reply.code(409).send({
        success: false,
        error: `Template is ${template.status}; only review/approved templates can render`,
      });
    }

    const supportedLocales = Array.isArray(template.supported_locales)
      ? template.supported_locales
      : [template.default_locale];
    if (!supportedLocales.includes(locale)) {
      return reply.code(400).send({
        success: false,
        error: `Locale ${locale} not supported; supported: ${supportedLocales.join(', ')}`,
      });
    }

    const structure = parseStructure(template.structure);
    if (!structure) {
      return reply.code(500).send({ success: false, error: 'Template structure is malformed' });
    }

    const variables = asRecord(body.variables) ?? {};
    const validation = validateVariables(template.variables, variables);
    if (!validation.valid) {
      return reply
        .code(400)
        .send({ success: false, error: 'Missing required variables', missing: validation.missing });
    }

    const rendered = renderTemplate(structure, variables);
    return reply.code(200).send({
      success: true,
      data: {
        template_slug: template.slug,
        locale,
        rendered: rendered.rendered,
        missing_variables: rendered.missingVariables,
      },
    });
  });

  app.post('/api/content/assets/:slug/publish', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    const targetId = Number(body.target_id);

    const db = app.db;
    if (!db) {
      return reply.code(500).send({ success: false, error: 'Database not available' });
    }

    if (!Number.isInteger(targetId) || targetId <= 0) {
      return reply.code(400).send({ success: false, error: 'target_id is required' });
    }

    const asset = await db('content_assets').where({ slug }).first();
    if (!asset) {
      return reply.code(404).send({ success: false, error: 'Asset not found' });
    }
    if (!canTransitionAssetStatus(asset.status, 'processing')) {
      return reply
        .code(409)
        .send({ success: false, error: `Asset in status ${asset.status} cannot be published` });
    }

    const target = await db('content_publish_targets')
      .where({ id: targetId, is_active: true })
      .first();
    if (!target) {
      return reply
        .code(404)
        .send({ success: false, error: 'Publish target not found or inactive' });
    }

    const content = asRecord(asset.content) as AuthoredContent | null;
    if (!content || !Array.isArray(content.sections) || content.sections.length === 0) {
      return reply
        .code(409)
        .send({ success: false, error: 'Asset content has no rendered sections' });
    }

    await db('content_assets')
      .where({ id: asset.id })
      .update({ status: 'processing', updated_at: new Date() });

    const now = new Date();
    const [publicationId] = await db('content_publications').insert({
      asset_id: asset.id,
      target_id: target.id,
      status: 'published',
      external_id: `mw-${asset.slug}-${target.platform}-${Date.now()}`,
      url: `${target.platform}://published/${asset.slug}`,
      published_at: now,
      metrics: JSON.stringify({ views: 0, clicks: 0, shares: 0 }),
      company_id: asset.company_id,
      created_at: now,
      updated_at: now,
    });

    await db('content_assets')
      .where({ id: asset.id })
      .update({ status: 'ready', updated_at: new Date() });

    return reply.code(200).send({
      success: true,
      data: {
        publication_id: publicationId,
        asset_slug: asset.slug,
        platform: target.platform,
        status: 'published',
      },
    });
  });

  app.get('/api/content/assets/:slug/analytics', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const days = Number(req.query?.days ?? 30);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const db = app.db;
    if (!db) {
      return reply.code(500).send({ success: false, error: 'Database not available' });
    }

    const asset = await db('content_assets').where({ slug }).first();
    if (!asset) {
      return reply.code(404).send({ success: false, error: 'Asset not found' });
    }

    const metrics = await db('content_analytics')
      .where({ asset_id: asset.id })
      .where('date', '>=', cutoff)
      .select('date', 'views', 'clicks', 'shares', 'conversions', 'revenue_minor')
      .orderBy('date', 'desc');

    const totals = metrics.reduce(
      (acc, row) => ({
        views: acc.views + row.views,
        clicks: acc.clicks + row.clicks,
        shares: acc.shares + row.shares,
        conversions: acc.conversions + row.conversions,
        revenue_minor: acc.revenue_minor + row.revenue_minor,
      }),
      { views: 0, clicks: 0, shares: 0, conversions: 0, revenue_minor: 0 }
    );

    return reply.code(200).send({ success: true, data: { asset: slug, daily: metrics, totals } });
  });
};
