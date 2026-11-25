import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import type { Knex } from 'knex';
import { isRecord } from '@moonwitness/types';
import { MarketplaceConnection, MarketplaceSyncJob, SyncMetric } from './models/index.js';

let db: Knex;

export function bindEcommerceSyncDb(instance: Knex): void {
  db = instance;
}

export const ecommerceSyncHttpPlugin: AddonHttpPlugin = async (app) => {
  app.get('/api/ecommerce/sync/jobs', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const {
      status,
      marketplace,
      direction,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string>;

    let query = db(MarketplaceSyncJob.tableName)
      .where({ company_id: auth.companyId })
      .orderBy('requested_at', 'desc')
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    if (status) query = query.where({ status });
    if (marketplace) query = query.where({ marketplace });
    if (direction) query = query.where({ direction });

    const jobs = await query.select('*');
    const total = await db(MarketplaceSyncJob.tableName)
      .where({ company_id: auth.companyId })
      .modify((qb) => {
        if (status) qb.where({ status });
        if (marketplace) qb.where({ marketplace });
        if (direction) qb.where({ direction });
      })
      .count({ count: '*' })
      .first();

    return reply.code(200).send({
      success: true,
      data: jobs,
      pagination: {
        total: Number(total?.count ?? 0),
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  });

  app.post('/api/ecommerce/sync/jobs', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { marketplace, direction = 'pull', payload = {}, source_rule_id, dedupe_key } = req.body;

    if (typeof marketplace !== 'string' || marketplace.trim() === '') {
      return reply.code(400).send({ success: false, error: 'marketplace string is required' });
    }
    if (direction !== 'pull' && direction !== 'push') {
      return reply.code(400).send({ success: false, error: 'direction must be pull|push' });
    }

    const inserted = await db(MarketplaceSyncJob.tableName)
      .insert({
        company_id: auth.companyId,
        marketplace: marketplace.trim(),
        direction,
        status: 'queued',
        payload: JSON.stringify(payload),
        source_rule_id: source_rule_id ?? null,
        dedupe_key: dedupe_key ?? null,
        requested_at: new Date().toISOString(),
      })
      .returning('id');

    const jobId = Array.isArray(inserted)
      ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
      : Number(inserted);

    return reply.code(201).send({
      success: true,
      data: { id: jobId, marketplace, direction, status: 'queued' },
    });
  });

  app.get('/api/ecommerce/sync/jobs/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const job = await db(MarketplaceSyncJob.tableName)
      .where({ id: parseInt(id, 10), company_id: auth.companyId })
      .first();

    if (!job) {
      return reply.code(404).send({ success: false, error: 'Sync job not found' });
    }

    return reply.code(200).send({ success: true, data: job });
  });

  app.get('/api/ecommerce/connections', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const { marketplace, status } = req.query as Record<string, string>;

    let query = db(MarketplaceConnection.tableName).where({ company_id: auth.companyId });

    if (marketplace) query = query.where({ marketplace });
    if (status) query = query.where({ status });

    const connections = await query.select('*').orderBy('id', 'asc');

    return reply.code(200).send({ success: true, data: connections });
  });

  app.post('/api/ecommerce/connections', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { marketplace, name, config, credentials } = req.body;

    if (typeof marketplace !== 'string' || marketplace.trim() === '') {
      return reply.code(400).send({ success: false, error: 'marketplace string is required' });
    }
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.code(400).send({ success: false, error: 'name string is required' });
    }
    if (!isRecord(config)) {
      return reply.code(400).send({ success: false, error: 'config object is required' });
    }

    const inserted = await db(MarketplaceConnection.tableName)
      .insert({
        company_id: auth.companyId,
        marketplace: marketplace.trim(),
        name: name.trim(),
        status: 'pending',
        config,
        credentials: credentials ?? null,
      })
      .returning('id');

    const connectionId = Array.isArray(inserted)
      ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
      : Number(inserted);

    return reply.code(201).send({
      success: true,
      data: { id: connectionId, marketplace, name, status: 'pending' },
    });
  });

  app.patch('/api/ecommerce/connections/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const connectionId = parseInt(id, 10);

    const existing = await db(MarketplaceConnection.tableName)
      .where({ id: connectionId, company_id: auth.companyId })
      .first();

    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Connection not found' });
    }

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { name, status, config, credentials } = req.body;
    const updates: Record<string, unknown> = {};

    if (typeof name === 'string' && name.trim() !== '') updates.name = name.trim();
    if (typeof status === 'string' && ['active', 'inactive', 'error', 'pending'].includes(status))
      updates.status = status;
    if (isRecord(config)) updates.config = config;
    if (credentials !== undefined) updates.credentials = credentials;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ success: false, error: 'No valid fields to update' });
    }

    updates.updated_at = new Date();

    await db(MarketplaceConnection.tableName).where({ id: connectionId }).update(updates);

    const updated = await db(MarketplaceConnection.tableName).where({ id: connectionId }).first();

    return reply.code(200).send({ success: true, data: updated });
  });

  app.get('/api/ecommerce/metrics', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const {
      marketplace,
      direction,
      date_from,
      date_to,
      limit = '100',
      offset = '0',
    } = req.query as Record<string, string>;

    let query = db(SyncMetric.tableName)
      .where({ company_id: auth.companyId })
      .orderBy('date', 'desc')
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    if (marketplace) query = query.where({ marketplace });
    if (direction) query = query.where({ direction });
    if (date_from) query = query.where('date', '>=', date_from);
    if (date_to) query = query.where('date', '<=', date_to);

    const metrics = await query.select('*');
    const total = await db(SyncMetric.tableName)
      .where({ company_id: auth.companyId })
      .modify((qb) => {
        if (marketplace) qb.where({ marketplace });
        if (direction) qb.where({ direction });
        if (date_from) qb.where('date', '>=', date_from);
        if (date_to) qb.where('date', '<=', date_to);
      })
      .count({ count: '*' })
      .first();

    return reply.code(200).send({
      success: true,
      data: metrics,
      pagination: {
        total: Number(total?.count ?? 0),
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  });
};
