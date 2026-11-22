import type { Transaction } from 'objection';
import { Job, OutboxEvent } from './models.js';

export async function listDeadJobs(
  options: { limit?: number; offset?: number; companyId?: number | null } = {}
): Promise<Array<InstanceType<typeof Job>>> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = Job.query()
    .where({ status: 'dead', active: true })
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset);
  if (options.companyId !== undefined && options.companyId !== null) {
    query.where({ company_id: options.companyId });
  }
  return query;
}

export async function retryDeadJob(jobId: number, transaction?: Transaction): Promise<boolean> {
  const updated = await Job.query(transaction).where({ id: jobId, status: 'dead' }).patch({
    status: 'queued',
    attempts: 0,
    cancel_requested: false,
    available_at: new Date().toISOString(),
  });
  return updated > 0;
}

export async function cancelDeadJob(jobId: number, transaction?: Transaction): Promise<boolean> {
  const updated = await Job.query(transaction).where({ id: jobId, status: 'dead' }).patch({
    status: 'cancelled',
    cancel_requested: true,
  });
  return updated > 0;
}

export async function listDeadOutboxEvents(
  options: { limit?: number; offset?: number; companyId?: number | null } = {}
): Promise<Array<InstanceType<typeof OutboxEvent>>> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = OutboxEvent.query()
    .where({ status: 'dead', active: true })
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset);
  if (options.companyId !== undefined && options.companyId !== null) {
    query.where({ company_id: options.companyId });
  }
  return query;
}

export async function retryDeadOutboxEvent(
  eventId: number,
  transaction?: Transaction
): Promise<boolean> {
  const updated = await OutboxEvent.query(transaction)
    .where({ id: eventId, status: 'dead' })
    .patch({
      status: 'pending',
      attempts: 0,
      last_error: null,
      available_at: new Date().toISOString(),
    });
  return updated > 0;
}

export async function cancelDeadOutboxEvent(
  eventId: number,
  transaction?: Transaction
): Promise<boolean> {
  const updated = await OutboxEvent.query(transaction)
    .where({ id: eventId, status: 'dead' })
    .patch({
      status: 'published',
      last_error: 'cancelled_by_admin',
    });
  return updated > 0;
}
