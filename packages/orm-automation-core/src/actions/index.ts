import type { AutomationActionKind } from '../models.js';
import type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';
import { run as notify } from './notify.js';
import { run as enqueueJob } from './enqueue_job.js';
import { run as createTask } from './create_task.js';
import { run as recordIncome } from './record_income.js';
import { run as publishContent } from './publish_content.js';
import { run as postSocial } from './post_social.js';
import { run as runBot } from './run_bot.js';
import { run as syncEcommerce } from './sync_ecommerce.js';
import { run as runPublicTool } from './run_public_tool.js';
import { run as runAgent } from './run_agent.js';

export type AutomationAction = (
  ctx: AutomationActionContext,
  config: Record<string, unknown>,
  input: AutomationActionInput
) => Promise<ActionResult>;

export const AUTOMATION_ACTIONS: Readonly<Record<AutomationActionKind, AutomationAction>> = {
  notify,
  enqueue_job: enqueueJob,
  create_task: createTask,
  record_income: recordIncome,
  publish_content: publishContent,
  post_social: postSocial,
  run_bot: runBot,
  sync_ecommerce: syncEcommerce,
  run_public_tool: runPublicTool,
  run_agent: runAgent,
};

export function resolveAction(kind: string): AutomationAction | null {
  return (AUTOMATION_ACTIONS as Record<string, AutomationAction | undefined>)[kind] ?? null;
}

export type { ActionResult, AutomationActionContext, AutomationActionInput } from './types.js';
