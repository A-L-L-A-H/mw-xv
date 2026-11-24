import { AddonHttpPlugin } from '@moonwitness/orm';
import { IncomeStream, IncomeEntry, IncomeAllocation } from './models.js';

export const incomeHttpPlugin: AddonHttpPlugin = {
  name: 'income',
  version: '1.0.0',
  routes: [
    {
      method: 'POST',
      path: '/income/streams',
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'status', 'goalMonthlyMinor', 'currency'],
          properties: {
            kind: { type: 'string', enum: ['saas', 'marketplace', 'ads', 'affiliate', 'content_royalty', 'digital_product', 'service', 'donation', 'other'] },
            platform: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['idea', 'building', 'live', 'paused', 'dead'] },
            goalMonthlyMinor: { type: 'integer', minimum: 0 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            tags: { type: 'object' },
            companyId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
      handler: async (app, req, reply) => {
        const ctx = await app.getContext();
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const user = await ctx.getUser();
        if (!user) return reply.code(403).send({ error: 'Forbidden' });
        const body = req.body;
        const stream = await ctx.query(IncomeStream).insertAndFetch({
          ...body,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return reply.code(201).send(stream);
      },
    },
    {
      method: 'POST',
      path: '/income/entries',
      schema: {
        body: {
          type: 'object',
          required: ['streamId', 'occurredAt', 'amountMinor', 'currency', 'kind', 'sourceModel', 'sourceId', 'netMinor'],
          properties: {
            streamId: { type: 'string', format: 'uuid' },
            occurredAt: { type: 'string', format: 'date-time' },
            amountMinor: { type: 'integer' },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            kind: { type: 'string', enum: ['revenue', 'cost', 'payout', 'refund', 'fee', 'tax'] },
            sourceModel: { type: 'string' },
            sourceId: { type: 'string' },
            externalRef: { type: ['string', 'null'] },
            netMinor: { type: 'integer' },
          },
        },
      },
      handler: async (app, req, reply) => {
        const ctx = await app.getContext();
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const user = await ctx.getUser();
        if (!user) return reply.code(403).send({ error: 'Forbidden' });
        const body = req.body;
        const entry = await ctx.query(IncomeEntry).insertAndFetch({
          ...body,
          occurredAt: new Date(body.occurredAt),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return reply.code(201).send(entry);
      },
    },
    {
      method: 'POST',
      path: '/income/allocations',
      schema: {
        body: {
          type: 'object',
          required: ['streamId', 'target', 'percentage', 'isActive'],
          properties: {
            streamId: { type: 'string', format: 'uuid' },
            target: { type: 'string', enum: ['reinvest', 'savings', 'charity', 'personal', 'tax'] },
            percentage: { type: 'number', minimum: 0, maximum: 100 },
            isActive: { type: 'boolean' },
          },
        },
      },
      handler: async (app, req, reply) => {
        const ctx = await app.getContext();
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const user = await ctx.getUser();
        if (!user) return reply.code(403).send({ error: 'Forbidden' });
        const body = req.body;
        const allocation = await ctx.query(IncomeAllocation).insertAndFetch({
          ...body,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return reply.code(201).send(allocation);
      },
    },
  ],
};