import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

interface SeedTemplate {
  slug: string;
  name: string;
  description: string;
  kind: string;
  structure: Record<string, unknown>;
  variables: Record<string, unknown>;
  default_locale: string;
  supported_locales: string[];
  status: string;
  version: string;
}

type TemplateRow = Record<string, string | number | boolean | null>;

/** SQLite and JSON columns require primitives; serialize structured values to JSON strings. */
function toRow(template: SeedTemplate, companyId: number): TemplateRow {
  return {
    slug: template.slug,
    name: template.name,
    description: template.description,
    kind: template.kind,
    structure: JSON.stringify(template.structure),
    variables: JSON.stringify(template.variables),
    default_locale: template.default_locale,
    supported_locales: JSON.stringify(template.supported_locales),
    status: template.status,
    version: template.version,
    company_id: companyId,
  };
}

const TEMPLATES: SeedTemplate[] = [
  {
    slug: 'article-default',
    name: 'Default Article',
    description: 'Standard long-form article template with intro, body sections, and conclusion.',
    kind: 'article',
    structure: {
      sections: [
        { title: '{{title}}', body: '{{intro}}' },
        { title: 'Analysis', body: '{{body}}' },
        { title: 'Conclusion', body: '{{conclusion}}' },
      ],
    },
    variables: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        intro: { type: 'string' },
        body: { type: 'string' },
        conclusion: { type: 'string' },
      },
      required: ['title', 'intro', 'body', 'conclusion'],
    },
    default_locale: 'en',
    supported_locales: ['en'],
    status: 'draft',
    version: '1.0.0',
  },
  {
    slug: 'social-post-default',
    name: 'Default Social Post',
    description: 'Short-form social media post with hook, value body, and call to action.',
    kind: 'social_post',
    structure: {
      sections: [
        { title: 'Hook', body: '{{hook}}' },
        { title: 'Value', body: '{{value}}' },
        { title: 'CTA', body: '{{call_to_action}}' },
      ],
    },
    variables: {
      type: 'object',
      properties: {
        hook: { type: 'string' },
        value: { type: 'string' },
        call_to_action: { type: 'string' },
      },
      required: ['hook', 'value'],
    },
    default_locale: 'en',
    supported_locales: ['en'],
    status: 'draft',
    version: '1.0.0',
  },
  {
    slug: 'newsletter-default',
    name: 'Default Newsletter',
    description: 'Weekly newsletter template with headline, highlights list, and closing note.',
    kind: 'newsletter',
    structure: {
      sections: [
        { title: '{{headline}}', body: '{{opening_note}}' },
        { title: 'Highlights', body: '{{highlights}}' },
        { title: 'Closing', body: '{{closing_note}}' },
      ],
    },
    variables: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        opening_note: { type: 'string' },
        highlights: { type: 'string' },
        closing_note: { type: 'string' },
      },
      required: ['headline', 'highlights'],
    },
    default_locale: 'en',
    supported_locales: ['en'],
    status: 'draft',
    version: '1.0.0',
  },
  {
    slug: 'video-script-default',
    name: 'Default Video Script',
    description: 'Video script template with cold open, main content beats, and outro.',
    kind: 'video_script',
    structure: {
      sections: [
        { title: 'Cold Open', body: '{{cold_open}}' },
        { title: 'Main Content', body: '{{main_beats}}' },
        { title: 'Outro', body: '{{outro}}' },
      ],
    },
    variables: {
      type: 'object',
      properties: {
        cold_open: { type: 'string' },
        main_beats: { type: 'string' },
        outro: { type: 'string' },
      },
      required: ['main_beats'],
    },
    default_locale: 'en',
    supported_locales: ['en'],
    status: 'draft',
    version: '1.0.0',
  },
];

async function seedContentFactory(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;

  for (const template of TEMPLATES) {
    const existing = await db('content_templates').where({ slug: template.slug }).first();

    if (existing) {
      await db('content_templates')
        .where({ id: existing.id })
        .update({
          ...toRow(template, companyId),
          updated_at: new Date(),
        });
      updated++;
    } else {
      await db('content_templates').insert({
        ...toRow(template, companyId),
        created_at: new Date(),
        updated_at: new Date(),
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const contentFactorySeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['base'],
  seed: seedContentFactory,
};
