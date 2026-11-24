import { isJobHandlerName, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * record_income enqueues the income-sync job so ledger writes stay on the
 * worker path; the job handler owns transactional entry creation.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler ?? 'income.sync-entry';
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'record_income handler name is invalid' };
  }

  const amountMinor = config.amountMinor;
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: 'record_income requires a positive integer amountMinor' };
  }

  const currency = config.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: 'record_income requires an ISO-4217 currency code' };
  }

  const entryPayload = isRecord(input.payload) ? input.payload : {};
  const jobId = await ctx.db('jobs')
    .insert({
      handler,
      handler_version: 1,
      payload: JSON.stringify({
        amountMinor,
        currency,
        source: 'automation.rule',
        ruleId: ctx.ruleId,
        dedupeKey: ctx.dedupeKey,
        memo: typeof config.memo === 'string' ? config.memo : null,
        ...entryPayload,
      }),
      status: 'queued',
      company_id: ctx.companyId,
      idempotency_key: ctx.dedupeKey ?? `automation.income.${ctx.ruleId}.${ctx.triggerRef}`,
      available_at: nowIso(),
    })
    .returning('id');

  const jobRowId = Array.isArray(jobId)
    ? Number((jobId[0] as { id?: number } | undefined)?.id ?? jobId[0])
    : Number(jobId);

  return { ok: true, detail: { jobId: jobRowId, handler, amountMinor, currency } };
}
