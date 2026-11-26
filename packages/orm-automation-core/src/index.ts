export {
  AUTOMATION_DSL_OPS,
  isDslGroup,
  resolvePath,
  evaluateDsl,
  type AutomationDslOp,
  type AutomationDslComparison,
  type AutomationDslGroup,
  type AutomationDslNode,
  type AutomationEvaluationResult,
} from './evaluator.js';

export {
  fireTrigger,
  renderDedupeKey,
  AUTOMATION_RULE_CODE_PATTERN,
  type FireTriggerOptions,
  type FireTriggerOutcome,
  type FireTriggerReport,
} from './listener.js';

export {
  TRIGGER_KINDS,
  AUTOMATION_ACTION_KINDS,
  AUTOMATION_RUN_STATUSES,
  AutomationTrigger,
  AutomationRule,
  AutomationRun,
  type AutomationTriggerKind,
  type AutomationActionKind,
  type AutomationRunStatus,
} from './models.js';

export { AUTOMATION_ACTIONS, resolveAction, type AutomationAction } from './actions/index.js';
export type {
  ActionResult,
  AutomationActionContext,
  AutomationActionInput,
} from './actions/types.js';

export { automationCoreSeedManifest } from './seed-manifest.js';
