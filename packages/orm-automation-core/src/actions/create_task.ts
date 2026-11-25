import { isPositiveId, isRecord } from './internal.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';

const TASK_CODE_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{1,63}$';

export async function run(
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
): Promise<ActionResult> {
  const projectId = config.projectId;
  const stageId = config.stageId;
  if (!isPositiveId(projectId)) {
    return { ok: false, error: 'create_task requires a positive numeric projectId' };
  }
  if (!isPositiveId(stageId)) {
    return { ok: false, error: 'create_task requires a positive numeric stageId' };
  }

  const payload = isRecord(input.payload) ? input.payload : {};
  const title = config.title ?? payload.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    return { ok: false, error: 'create_task requires a non-empty title' };
  }

  const code = config.code ?? payload.code;
  if (typeof code !== 'string' || !new RegExp(TASK_CODE_PATTERN).test(code)) {
    return { ok: false, error: 'create_task requires a code matching [A-Za-z][A-Za-z0-9_-]{1,63}' };
  }

  const priority = config.priority ?? 'normal';
  if (priority !== 'low' && priority !== 'normal' && priority !== 'high' && priority !== 'urgent') {
    return { ok: false, error: 'create_task priority must be low|normal|high|urgent' };
  }

  const inserted = await ctx
    .db('project_tasks')
    .insert({
      company_id: ctx.companyId,
      project_id: projectId,
      stage_id: stageId,
      code,
      title,
      description: typeof config.description === 'string' ? config.description : null,
      priority,
    })
    .returning('id');

  const taskId = Array.isArray(inserted)
    ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
    : Number(inserted);

  return { ok: true, detail: { taskId, code, title } };
}
