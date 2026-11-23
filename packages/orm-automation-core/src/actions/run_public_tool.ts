import { isPositiveId, isRecord } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

/**
 * run_public_tool invokes a registered public tool through the tool registry
 * table; the tool runtime resolves implementations, so the engine never
 * imports tool code directly.
 */
export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const toolName = config.tool;
  if (typeof toolName !== 'string' || !TOOL_NAME_PATTERN.test(toolName)) {
    return { ok: false, error: 'run_public_tool requires a valid tool name' };
  }

  const toolPayload = isRecord(input.payload) ? input.payload : {};

  const inserted = await ctx.db('public_tool_invocations')
    .insert({
      company_id: ctx.companyId,
      tool_name: toolName,
      payload: JSON.stringify(toolPayload),
      status: 'queued',
      source_rule_id: ctx.ruleId,
      dedupe_key: ctx.dedupeKey,
    })
    .returning('id');

  const invocationId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { invocationId, tool: toolName } };
}

export const isPublicToolName = TOOL_NAME_PATTERN.test.bind(TOOL_NAME_PATTERN);
export const isToolPayload = isRecord;
export const isInvocationId = isPositiveId;
