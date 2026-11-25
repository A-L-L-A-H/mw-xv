import { isJobHandlerName, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * Enqueues a job through the jobs outbox (`base.job` handler registry uses
 * `enqueueJob`, which requires a registered handler in-process; the automation
 * engine instead writes an outbox row so the worker owns handler resolution).
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler;
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'enqueue_job requires a valid handler name' };
  }

  const jobPayload = config.payload ?? input.payload;
  if (!isRecord(jobPayload)) {
    return { ok: false, error: 'enqueue_job payload must be an object' };
  }

  const inserted = await ctx
    .db('jobs')
    .insert({
      handler,
      handler_version: typeof config.handlerVersion === 'number' ? config.handlerVersion : 1,
      payload: JSON.stringify(jobPayload),
      status: 'queued',
      company_id: ctx.companyId,
      idempotency_key: ctx.dedupeKey ?? `automation.rule.${ctx.ruleId}.${ctx.triggerRef}`,
      available_at: nowIso(),
    })
    .returning('id');

  const jobId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { jobId, handler } };
}
