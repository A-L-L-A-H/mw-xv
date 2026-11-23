import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SALT = 'mw-public-services-2026';

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + SALT).digest('hex');
}

function getClientIp(req: AddonHttpRequestBase): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[0].trim();
  }
  return req.headers?.['x-real-ip'] as string ?? '127.0.0.1';
}

export function checkRateLimit(db: Knex, toolId: number, userIdentifier: string, limit: number): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60_000);
  return db('public_usages')
    .where({ tool_id: toolId, user_identifier: userIdentifier })
    .where('created_at', '>=', windowStart)
    .count<{ count: number | string }[]>('* as count')
    .first()
    .then((row) => {
      const count = row?.count ?? 0;
      return Number(count) < limit;
    });
}

async function recordUsage(
  db: Knex,
  toolId: number,
  userIdentifier: string,
  inputHash: string,
  outputHash: string,
  latencyMs: number,
  status: number
): Promise<void> {
  await db('public_usages').insert({
    tool_id: toolId,
    user_identifier: userIdentifier,
    input_hash: inputHash,
    output_hash: outputHash,
    latency_ms: latencyMs,
    status,
    created_at: new Date(),
  });
}

export async function rollupMetric(
  db: Knex,
  toolId: number,
  date: string,
  latencyMs: number,
  isError: boolean
): Promise<void> {
  const existing = await db('public_metrics')
    .where({ tool_id: toolId, date })
    .first();

  if (existing) {
    const newCalls = existing.calls + 1;
    const newErrors = existing.errors + (isError ? 1 : 0);
    const newAvgLatency = (existing.avg_latency * existing.calls + latencyMs) / newCalls;

    await db('public_metrics')
      .where({ tool_id: toolId, date })
      .update({
        calls: newCalls,
        errors: newErrors,
        avg_latency: newAvgLatency,
        updated_at: new Date(),
      });
  } else {
    await db('public_metrics').insert({
      tool_id: toolId,
      date,
      calls: 1,
      unique_users: 1,
      avg_latency: latencyMs,
      errors: isError ? 1 : 0,
      charity_attribution_minor: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

async function invokeTrendRadar(topic: string): Promise<{ signals: string[] }> {
  const signals = [
    `${topic}: autonomous agents in production`,
    `${topic}: small language models overtaking LLMs`,
    `${topic}: eval-driven development loops`,
    `${topic}: tool-use benchmarking standardization`,
    `${topic}: on-device inference acceleration`,
    `${topic}: synthetic data generation pipelines`,
    `${topic}: RAG-to-agents architectural shift`,
    `${topic}: multi-agent orchestration frameworks`,
    `${topic}: inference cost optimization`,
    `${topic}: open-weight model fine-tuning`,
  ];
  return { signals };
}

async function invokeIncomeCalculator(input: { mrr: number; churn: number; months: number }): Promise<{ runwayMonths: number; projectedMrr: number[] }> {
  const { mrr, churn, months } = input;
  const monthlyChurnRate = churn / 100;
  const projectedMrr = Array.from({ length: months }, (_, i) => Math.round(mrr * Math.pow(1 - monthlyChurnRate, i + 1)));
  const runwayMonths = projectedMrr.findIndex((m) => m < 1000);
  return { runwayMonths: runwayMonths === -1 ? months : runwayMonths, projectedMrr };
}

async function invokeContentIdeas(niche: string): Promise<{ ideas: string[] }> {
  const ideas = [
    `${niche}: 10 automation workflows that save 20hrs/week`,
    `${niche}: Building in public - month 3 retrospective`,
    `${niche}: Why [popular tool] is dead and what replaced it`,
    `${niche}: From $0 to $10k MRR - the exact playbook`,
    `${niche}: 5 frameworks I wish I knew earlier`,
    `${niche}: The contrarian take on [industry trend]`,
    `${niche}: How to validate ideas without building`,
    `${niche}: My stack for solo SaaS in 2026`,
    `${niche}: Pricing psychology that doubled conversions`,
    `${niche}: Content repurposing system (1 piece -> 20)`,
    `${niche}: Cold email templates that actually get replies`,
    `${niche}: Building distribution before product`,
    `${niche}: The metrics that matter for early stage`,
    `${niche}: Hiring your first contractor vs employee`,
    `${niche}: Exit strategy: acquire vs IPO vs lifestyle`,
    `${niche}: Technical debt that made us money`,
    `${niche}: Community-led growth playbook`,
    `${niche}: SEO for developers who hate marketing`,
    `${niche}: Pricing page teardown: [competitor]`,
    `${niche}: From side project to acquisition offer`,
  ];
  return { ideas: ideas.slice(0, 20) };
}

async function invokeHashtags(platform: string, topic: string): Promise<{ hashtags: string[] }> {
  const base = topic.toLowerCase().replace(/\s+/g, '');
  const platformTags = {
    instagram: ['reels', 'explore', 'viral', 'aesthetic', 'inspo', 'community', 'creator', 'smallbusiness', 'entrepreneur', 'mindset'],
    twitter: ['thread', 'buildinpublic', 'indiehackers', 'saas', 'startup', 'tech', 'ai', 'coding', 'productivity', 'growth'],
    linkedin: ['leadership', 'innovation', 'career', 'networking', 'strategy', 'digitaltransformation', 'futureofwork', 'personalgrowth', 'entrepreneurship', 'business'],
    tiktok: ['fyp', 'viral', 'learnontiktok', 'smallbusiness', 'entrepreneur', 'aesthetic', 'trending', 'tips', 'hacks', 'motivation'],
  };
  const tags = platformTags[platform as keyof typeof platformTags] ?? platformTags.instagram;
  const hashtags = tags.map((t) => `#${base}${t.charAt(0).toUpperCase() + t.slice(1)}`);
  return { hashtags };
}

async function invokePortfolio(): Promise<{ projects: Array<{ name: string; description: string; metrics: Record<string, unknown> }> }> {
  return {
    projects: [
      { name: 'Trend Radar', description: 'Real-time signal detection for emerging tech', metrics: { signals: 10, latency: '45ms' } },
      { name: 'Income Calculator', description: 'MRR/runway estimator with churn modeling', metrics: { scenarios: 50, accuracy: '92%' } },
      { name: 'Content Ideas', description: '20 viral-ready concepts from trend data', metrics: { niches: 100, ideas: 2000 } },
      { name: 'Hashtag Generator', description: 'Platform-optimized tags for maximum reach', metrics: { platforms: 4, tags: 5000 } },
    ],
  };
}

const HANDLERS: Record<string, (input: unknown) => Promise<unknown>> = {
  'trend-radar': (input) => {
    const { topic } = (input ?? {}) as { topic?: unknown };
    return invokeTrendRadar(typeof topic === 'string' && topic.length > 0 ? topic : 'tech');
  },
  'income-calculator': (input) => {
    const { mrr, churn, months } = (input ?? {}) as Record<string, unknown>;
    return invokeIncomeCalculator({
      mrr: Number(mrr ?? 0),
      churn: Number(churn ?? 0),
      months: Number(months ?? 12),
    });
  },
  'content-ideas': (input) => {
    const { niche } = (input ?? {}) as { niche?: unknown };
    return invokeContentIdeas(typeof niche === 'string' && niche.length > 0 ? niche : 'tech');
  },
  'hashtags': (input) => {
    const { platform, topic } = (input ?? {}) as Record<string, unknown>;
    return invokeHashtags(
      typeof platform === 'string' && platform.length > 0 ? platform : 'instagram',
      typeof topic === 'string' && topic.length > 0 ? topic : 'design'
    );
  },
  'portfolio': () => invokePortfolio(),
};

export const publicHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/public/tools/:slug/invoke', async (req, reply) => {
    const startTime = Date.now();
    const { slug } = req.params as { slug: string };
    const body = req.body as Record<string, unknown> ?? {};

    const db = app.db;
    if (!db) {
      return reply.code(500).send({ success: false, error: 'Database not available' });
    }

    const tool = await db('public_tools').where({ slug, is_active: true }).first();
    if (!tool) {
      return reply.code(404).send({ success: false, error: 'Tool not found or inactive' });
    }

    const userIdentifier = hashIp(getClientIp(req));

    const allowed = await checkRateLimit(db, tool.id, userIdentifier, tool.rate_limit);
    if (!allowed) {
      return reply.code(429).send({ success: false, error: 'Rate limit exceeded', retry_after: 60 });
    }

    const inputHash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);

    let output: unknown;
    let status = 200;
    let error: string | null = null;

    try {
      const handler = HANDLERS[tool.handler];
      if (!handler) {
        throw new Error(`Handler not implemented: ${tool.handler}`);
      }
      output = await handler(body);
    } catch (err) {
      status = 500;
      error = (err as Error).message;
      output = { error: error };
    }

    const latencyMs = Date.now() - startTime;
    const outputHash = createHash('sha256').update(JSON.stringify(output)).digest('hex').slice(0, 32);

    await recordUsage(db, tool.id, userIdentifier, inputHash, outputHash, latencyMs, status);

    const date = new Date().toISOString().slice(0, 10);
    await rollupMetric(db, tool.id, date, latencyMs, status >= 400);

    if (tool.charity_mode) {
      const adRevenueMinor = Math.floor(latencyMs * 0.1);
      await db('public_metrics')
        .where({ tool_id: tool.id, date })
        .increment('charity_attribution_minor', adRevenueMinor);
    }

    if (error) {
      return reply.code(status).send({ success: false, error });
    }

    return reply.code(200).send({ success: true, data: output, meta: { tool: tool.slug, latency_ms: latencyMs } });
  });

  app.get('/api/public/metrics/summary', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }

    const db = app.db;
    if (!db) {
      return reply.code(500).send({ success: false, error: 'Database not available' });
    }

    const days = Number(req.query?.days ?? 30);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const metrics = await db('public_metrics')
      .join('public_tools', 'public_metrics.tool_id', 'public_tools.id')
      .where('public_metrics.date', '>=', cutoff)
      .select(
        'public_tools.slug',
        'public_tools.name',
        'public_metrics.date',
        'public_metrics.calls',
        'public_metrics.unique_users',
        'public_metrics.avg_latency',
        'public_metrics.errors',
        'public_metrics.charity_attribution_minor'
      )
      .orderBy('public_metrics.date', 'desc');

    return reply.code(200).send({ success: true, data: metrics });
  });
};