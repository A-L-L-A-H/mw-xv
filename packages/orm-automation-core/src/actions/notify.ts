import { isRecord } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);

/**
 * Records a notification outbox event directly through the `outbox_events`
 * table. The `notification.deliver` consumer in `@moonwitness/orm-notification`
 * picks it up; template resolution failures surface on that consumer, so the
 * action itself stays decoupled from recipient template validation.
 */
export async function run(
  ctx: AutomationActionContext,
  _config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const { payload, config } = input;

  const recipientId = config.recipientId ?? payloadRecipientId(payload);
  if (typeof recipientId !== 'number' || !Number.isSafeInteger(recipientId) || recipientId <= 0) {
    return { ok: false, error: 'notify requires a positive numeric recipientId' };
  }

  const templateCode = config.templateCode;
  if (typeof templateCode !== 'string' || templateCode.length === 0) {
    return { ok: false, error: 'notify requires a templateCode string' };
  }

  const severity = config.severity;
  if (severity !== undefined && !VALID_SEVERITIES.has(String(severity))) {
    return {
      ok: false,
      error: `notify severity must be one of ${[...VALID_SEVERITIES].join('|')}`,
    };
  }

  await ctx.db('outbox_events').insert({
    event_type: 'notification.deliver',
    aggregate_model: 'automation.run',
    aggregate_id: ctx.ruleId,
    company_id: ctx.companyId,
    payload: JSON.stringify({
      recipientId,
      templateCode,
      resource: { model: 'automation.rule', id: ctx.ruleId },
    }),
    status: 'pending',
    available_at: new Date().toISOString(),
  });

  return { ok: true, detail: { recipientId, templateCode } };
}

function payloadRecipientId(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  return payload.recipientId;
}
