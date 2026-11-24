import { isJobHandlerName, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * publish_content enqueues a ContentPublishJob row so the publishing worker
 * owns scheduling; direct row insert keeps the engine decoupled from the
 * publishing package (which may not be installed).
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler ?? 'content.publish';
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'publish_content handler name is invalid' };
  }

  const payload = isRecord(input.payload) ? input.payload : {};
  const contentId = config.contentId ?? payload.contentId;
  if (typeof contentId !== 'number' || !Number.isSafeInteger(contentId) || contentId <= 0) {
    return { ok: false, error: 'publish_content requires a positive numeric contentId' };
  }

  const channel = config.channel;
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return { ok: false, error: 'publish_content requires a channel string' };
  }

  const inserted = await ctx.db('content_publish_jobs')
    .insert({
      company_id: ctx.companyId,
      content_id: contentId,
      channel,
      status: 'queued',
      scheduled_at: typeof config.scheduledAt === 'string' ? config.scheduledAt : nowIso(),
      source_rule_id: ctx.ruleId,
      dedupe_key: ctx.dedupeKey,
    })
    .returning('id');

  const jobId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { publishJobId: jobId, contentId, channel } };
}
