import { isJobHandlerName, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * post_social enqueues a PostQueue row; the social worker drains the queue
 * and owns platform credentials and rate limits.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler ?? 'social.post';
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'post_social handler name is invalid' };
  }

  const payload = isRecord(input.payload) ? input.payload : {};
  const accountId = config.accountId ?? payload.accountId;
  if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId <= 0) {
    return { ok: false, error: 'post_social requires a positive numeric accountId' };
  }

  const body = config.body ?? payload.body;
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { ok: false, error: 'post_social requires a non-empty body' };
  }

  const inserted = await ctx.db('post_queue')
    .insert({
      company_id: ctx.companyId,
      account_id: accountId,
      body,
      status: 'queued',
      scheduled_at: typeof config.scheduledAt === 'string' ? config.scheduledAt : nowIso(),
      source_rule_id: ctx.ruleId,
      dedupe_key: ctx.dedupeKey,
    })
    .returning('id');

  const queueId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { postQueueId: queueId, accountId } };
}
