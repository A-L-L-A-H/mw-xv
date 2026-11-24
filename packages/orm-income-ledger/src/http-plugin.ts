import type { AddonHttpApp, AddonHttpPlugin } from '@moonwitness/orm';
import {
  IncomeStream,
  IncomeEntry,
  IncomeAllocation,
  type IncomeStreamKind,
  type IncomeStreamStatus,
  type IncomeEntryKind,
  type IncomeAllocationTarget,
} from './models.js';
import { createIncomeLedgerContext, type Context } from './context.js';

function contextFor(app: AddonHttpApp): Context | null {
  return app.db ? createIncomeLedgerContext(app.db) : null;
}

export const incomeHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post(
    '/income/streams',
    {
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'status', 'goal_monthly_minor', 'currency'],
          properties: {
            kind: { type: 'string', enum: ['saas', 'marketplace', 'ads', 'affiliate', 'content_royalty', 'digital_product', 'service', 'donation', 'other'] },
            platform: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['idea', 'building', 'live', 'paused', 'dead'] },
            goal_monthly_minor: { type: 'integer', minimum: 0 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            tags: { type: 'object' },
            companyId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'Unauthorized' });
      if (!req.auth.companyId) return reply.code(403).send({ error: 'Forbidden' });
      const ctx = contextFor(app);
      if (!ctx) return reply.code(500).send({ error: 'Database unavailable' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const stream = await ctx.query(IncomeStream).insertAndFetch({
        kind: body.kind as IncomeStreamKind,
        platform: (body.platform as string | null) ?? null,
        status: (body.status as IncomeStreamStatus) ?? 'idea',
        goal_monthly_minor: Number(body.goalMonthlyMinor ?? 0),
        currency: String(body.currency ?? 'USD'),
        tags: (body.tags as Record<string, unknown>) ?? {},
        company_id: req.auth.companyId,
      });
      return reply.code(201).send(stream);
    }
  );

  app.post(
    '/income/entries',
    {
      schema: {
        body: {
          type: 'object',
          required: ['streamId', 'occurred_at', 'amount_minor', 'currency', 'kind', 'source_model', 'source_id', 'net_minor'],
          properties: {
            streamId: { type: 'string', format: 'uuid' },
            occurred_at: { type: 'string', format: 'date-time' },
            amount_minor: { type: 'integer' },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            kind: { type: 'string', enum: ['revenue', 'cost', 'payout', 'refund', 'fee', 'tax'] },
            source_model: { type: 'string' },
            source_id: { type: 'string' },
            external_ref: { type: ['string', 'null'] },
            net_minor: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'Unauthorized' });
      const ctx = contextFor(app);
      if (!ctx) return reply.code(500).send({ error: 'Database unavailable' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entry = await ctx.query(IncomeEntry).insertAndFetch({
        stream_id: Number(body.streamId),
        occurred_at: new Date(String(body.occurredAt)).toISOString(),
        amount_minor: Number(body.amountMinor),
        currency: String(body.currency),
        kind: body.kind as IncomeEntryKind,
        source_model: String(body.sourceModel),
        source_id: String(body.sourceId),
        external_ref: (body.externalRef as string | null) ?? null,
        net_minor: Number(body.netMinor),
      });
      return reply.code(201).send(entry);
    }
  );

  app.post(
    '/income/allocations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['streamId', 'target', 'percentage', 'is_active'],
          properties: {
            streamId: { type: 'string', format: 'uuid' },
            target: { type: 'string', enum: ['reinvest', 'savings', 'charity', 'personal', 'tax'] },
            percentage: { type: 'number', minimum: 0, maximum: 100 },
            is_active: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'Unauthorized' });
      const ctx = contextFor(app);
      if (!ctx) return reply.code(500).send({ error: 'Database unavailable' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allocation = await ctx.query(IncomeAllocation).insertAndFetch({
        stream_id: Number(body.streamId),
        target: body.target as IncomeAllocationTarget,
        percentage: Number(body.percentage),
        is_active: Boolean(body.isActive),
      });
      return reply.code(201).send(allocation);
    }
  );
};
