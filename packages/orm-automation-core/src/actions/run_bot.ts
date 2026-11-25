import { isPositiveId, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * run_bot enqueues a BotSession row; the bot worker claims sessions and owns
 * the live loop, keeping automation runs fast and side-effect-free.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const payload = isRecord(input.payload) ? input.payload : {};

  const botId = config.botId ?? payload.botId;
  if (!isPositiveId(botId)) {
    return { ok: false, error: 'run_bot requires a positive numeric botId' };
  }

  const sessionKind = config.sessionKind ?? 'automation';
  if (typeof sessionKind !== 'string' || sessionKind.trim().length === 0) {
    return { ok: false, error: 'run_bot requires a sessionKind string' };
  }

  const inserted = await ctx
    .db('bot_sessions')
    .insert({
      company_id: ctx.companyId,
      bot_id: botId,
      session_kind: sessionKind,
      status: 'queued',
      input: JSON.stringify(payload),
      source_rule_id: ctx.ruleId,
      dedupe_key: ctx.dedupeKey,
      requested_at: nowIso(),
    })
    .returning('id');

  const sessionId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { botSessionId: sessionId, botId } };
}
