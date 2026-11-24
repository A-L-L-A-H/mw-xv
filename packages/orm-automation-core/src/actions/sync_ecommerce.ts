import { isJobHandlerName, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * sync_ecommerce enqueues a MarketplaceSyncJob row; the e-commerce worker
 * claims and executes marketplace API synchronisation.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler ?? 'ecommerce.sync';
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'sync_ecommerce handler name is invalid' };
  }

  const payload = isRecord(input.payload) ? input.payload : {};
  const marketplace = config.marketplace;
  if (typeof marketplace !== 'string' || marketplace.trim().length === 0) {
    return { ok: false, error: 'sync_ecommerce requires a marketplace string' };
  }

  const direction = config.direction ?? 'pull';
  if (direction !== 'pull' && direction !== 'push') {
    return { ok: false, error: 'sync_ecommerce direction must be pull|push' };
  }

  const inserted = await ctx.db('marketplace_sync_jobs')
    .insert({
      company_id: ctx.companyId,
      marketplace,
      direction,
      status: 'queued',
      payload: JSON.stringify(payload),
      source_rule_id: ctx.ruleId,
      dedupe_key: ctx.dedupeKey,
      requested_at: nowIso(),
    })
    .returning('id');

  const syncJobId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { marketplaceSyncJobId: syncJobId, marketplace, direction } };
}
