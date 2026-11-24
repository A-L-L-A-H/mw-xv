import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

async function seedPublicServices(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;

  const tools = [
    {
      slug: 'trend-radar',
      name: 'Trend Radar',
      description:
        'Real-time signal detection for emerging technology trends. Query with ?topic=ai to get top 10 signals.',
      kind: 'api' as const,
      handler: 'trend-radar',
      rate_limit: 60,
      is_active: false,
      charity_mode: false,
      attribution_text: 'Powered by MoonWitness signal engine',
    },
    {
      slug: 'income-calculator',
      name: 'Income Calculator',
      description: 'MRR/runway estimator with churn modeling. Input: {mrr, churn, months}.',
      kind: 'api' as const,
      handler: 'income-calculator',
      rate_limit: 30,
      is_active: false,
      charity_mode: true,
      attribution_text: 'Revenue share supports open-source education',
    },
    {
      slug: 'content-ideas',
      name: 'Content Ideas Generator',
      description:
        'Generates 20 viral-ready content concepts from trend data. Query with ?niche=tech.',
      kind: 'api' as const,
      handler: 'content-ideas',
      rate_limit: 20,
      is_active: false,
      charity_mode: false,
      attribution_text: 'Ideas sourced from public trend signals',
    },
    {
      slug: 'hashtags',
      name: 'Hashtag Generator',
      description:
        'Platform-optimized hashtags for maximum reach. Query with ?platform=instagram&topic=design.',
      kind: 'api' as const,
      handler: 'hashtags',
      rate_limit: 50,
      is_active: false,
      charity_mode: false,
      attribution_text: 'Tags optimized per platform best practices',
    },
    {
      slug: 'portfolio',
      name: 'Portfolio Showcase',
      description:
        'Auto-generated portfolio from factory content assets and income stream highlights.',
      kind: 'page' as const,
      handler: 'portfolio',
      rate_limit: 100,
      is_active: false,
      charity_mode: false,
      attribution_text: 'Showcasing MoonWitness ecosystem projects',
    },
  ];

  for (const tool of tools) {
    const existing = await db('public_tools').where({ slug: tool.slug }).first();

    if (existing) {
      await db('public_tools')
        .where({ id: existing.id })
        .update({
          ...tool,
          company_id: companyId,
          updated_at: new Date(),
        });
      updated++;
    } else {
      await db('public_tools').insert({
        ...tool,
        company_id: companyId,
        created_at: new Date(),
        updated_at: new Date(),
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const publicSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['base'],
  seed: seedPublicServices,
};
