import { isJobHandlerName, isPositiveId, isRecord, nowIso } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

/**
 * run_agent enqueues an AgentRun through the jobs outbox; the AI worker owns
 * WorkContract/CapabilityGrant resolution and model invocation.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const handler = config.handler ?? 'ai.run-agent';
  if (!isJobHandlerName(handler)) {
    return { ok: false, error: 'run_agent handler name is invalid' };
  }

  const payload = isRecord(input.payload) ? input.payload : {};

  const agentId = config.agentId ?? payload.agentId;
  if (!isPositiveId(agentId)) {
    return { ok: false, error: 'run_agent requires a positive numeric agentId' };
  }

  const workContractId = config.workContractId ?? payload.workContractId;
  if (!isPositiveId(workContractId)) {
    return { ok: false, error: 'run_agent requires a positive numeric workContractId' };
  }

  const inserted = await ctx.db('jobs')
    .insert({
      handler,
      handler_version: 1,
      payload: JSON.stringify({
        agentId,
        workContractId,
        source: 'automation.rule',
        ruleId: ctx.ruleId,
        triggerRef: ctx.triggerRef,
        input: payload,
      }),
      status: 'queued',
      company_id: ctx.companyId,
      idempotency_key: ctx.dedupeKey ?? `automation.agent.${ctx.ruleId}.${ctx.triggerRef}`,
      available_at: nowIso(),
    })
    .returning('id');

  const jobId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { jobId, agentId, workContractId } };
}
