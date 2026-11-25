import { sha256Hex } from './canonical-json.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export const PLAN_MARKDOWN_SCHEMA_VERSION = 'mw-plan/v1' as const;

export type PlanTaskStatus =
  'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';

export interface PlanMilestoneProjection {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly order?: number;
  readonly status?: string;
}

export interface PlanTaskProjection {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: PlanTaskStatus | (string & {});
  readonly priority?: string;
  readonly milestoneId?: string;
  readonly workContractStatus?: string;
  readonly order?: number;
}

export interface PlanMarkdownInput {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectTitle?: string;
  readonly sourceSha: string;
  readonly milestones: readonly PlanMilestoneProjection[];
  readonly tasks: readonly PlanTaskProjection[];
  readonly generatedAt?: string;
  readonly redactor?: RedactionContext;
}

export interface RenderedPlanMarkdown {
  readonly schemaVersion: typeof PLAN_MARKDOWN_SCHEMA_VERSION;
  readonly projectId: string;
  readonly projectCode: string;
  readonly sourceSha: string;
  readonly markdown: string;
  readonly taskCount: number;
  readonly milestoneCount: number;
  readonly contentSha256: string;
  readonly generatedAt?: string;
}

export interface PlanReconcileChange {
  readonly kind: 'add' | 'update';
  readonly taskCode: string;
  readonly title: string;
  readonly checked: boolean;
  readonly status?: string;
  readonly priority?: string;
  readonly previousTitle?: string;
  readonly previousStatus?: string;
}

export type PlanReconcileViolationCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'DUPLICATE_TASK_CODE'
  | 'COMPLETED_TASK_DELETE_FORBIDDEN'
  | 'COMPLETED_TASK_REOPEN_FORBIDDEN';

export interface PlanReconcileViolation {
  readonly code: PlanReconcileViolationCode;
  readonly taskCode?: string;
  readonly message: string;
}

export interface PlanReconcileResult {
  readonly valid: boolean;
  readonly schemaVersion?: string;
  readonly advisoryOnly: true;
  readonly automatedMutationsAllowed: false;
  readonly additions: readonly PlanReconcileChange[];
  readonly updates: readonly PlanReconcileChange[];
  readonly unchangedTaskCodes: readonly string[];
  readonly protectedCompletedCodes: readonly string[];
  readonly violations: readonly PlanReconcileViolation[];
  readonly patchSha256: string;
}

function sanitizeInlineText(value: string, redactor: RedactionContext): string {
  return redactor
    .redactString(value)
    .replace(/[\r\n]+/gu, ' ')
    .trim();
}

function isCompletedTask(task: Pick<PlanTaskProjection, 'status' | 'workContractStatus'>): boolean {
  return (
    task.status === 'done' || task.status === 'cancelled' || task.workContractStatus === 'accepted'
  );
}

function compareMilestones(a: PlanMilestoneProjection, b: PlanMilestoneProjection): number {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const codeDiff = a.code.localeCompare(b.code);
  if (codeDiff !== 0) return codeDiff;
  return a.id.localeCompare(b.id);
}

function compareTasks(a: PlanTaskProjection, b: PlanTaskProjection): number {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const codeDiff = a.code.localeCompare(b.code);
  if (codeDiff !== 0) return codeDiff;
  return a.id.localeCompare(b.id);
}

function formatTaskLine(task: PlanTaskProjection, redactor: RedactionContext): string {
  const checkbox = task.status === 'done' || task.status === 'cancelled' ? 'x' : ' ';
  const code = sanitizeInlineText(task.code, redactor);
  const title = sanitizeInlineText(task.title, redactor);
  const status = sanitizeInlineText(task.status, redactor);
  const priority = sanitizeInlineText(task.priority ?? 'normal', redactor);
  return `- [${checkbox}] [${code}] ${title} (status: ${status}, priority: ${priority})`;
}

export function renderPlanMarkdown(input: PlanMarkdownInput): RenderedPlanMarkdown {
  const redactor = input.redactor ?? createRedactor();
  const projectId = sanitizeInlineText(input.projectId, redactor);
  const projectCode = sanitizeInlineText(input.projectCode, redactor);
  const sourceSha = sanitizeInlineText(input.sourceSha, redactor);

  const sortedMilestones = [...input.milestones].sort(compareMilestones);
  const sortedTasks = [...input.tasks].sort(compareTasks);

  const lines: string[] = [
    '---',
    `schemaVersion: '${PLAN_MARKDOWN_SCHEMA_VERSION}'`,
    `projectId: '${projectId}'`,
    `projectCode: '${projectCode}'`,
    `sourceSha: '${sourceSha}'`,
    '---',
    '',
    `# ${projectCode}${input.projectTitle ? `: ${sanitizeInlineText(input.projectTitle, redactor)}` : ''}`,
    '',
  ];

  const milestoneIds = new Set(sortedMilestones.map((milestone) => milestone.id));

  for (const milestone of sortedMilestones) {
    const milestoneCode = sanitizeInlineText(milestone.code, redactor);
    const milestoneTitle = sanitizeInlineText(milestone.title, redactor);
    lines.push(`## [${milestoneCode}] ${milestoneTitle}`);
    const milestoneTasks = sortedTasks.filter((task) => task.milestoneId === milestone.id);
    if (milestoneTasks.length === 0) {
      lines.push('_No tasks_');
    } else {
      for (const task of milestoneTasks) {
        lines.push(formatTaskLine(task, redactor));
      }
    }
    lines.push('');
  }

  const unassignedTasks = sortedTasks.filter(
    (task) => !task.milestoneId || !milestoneIds.has(task.milestoneId)
  );
  if (unassignedTasks.length > 0) {
    lines.push('## Unassigned');
    for (const task of unassignedTasks) {
      lines.push(formatTaskLine(task, redactor));
    }
    lines.push('');
  }

  const markdown = lines.join('\n');
  const contentSha256 = sha256Hex(markdown);

  return {
    schemaVersion: PLAN_MARKDOWN_SCHEMA_VERSION,
    projectId,
    projectCode,
    sourceSha,
    markdown,
    taskCount: sortedTasks.length,
    milestoneCount: sortedMilestones.length,
    contentSha256,
    ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
  };
}

interface ParsedTaskLine {
  readonly code: string;
  readonly checked: boolean;
  readonly title: string;
  readonly status?: string;
  readonly priority?: string;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) {
    return {};
  }
  const closingIndex = normalized.indexOf('\n---', 4);
  if (closingIndex === -1) {
    return {};
  }
  const block = normalized.slice(4, closingIndex);
  const result: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/u.exec(rawLine);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const TASK_LINE_REGEX =
  /^\s*-\s+\[([ xX])\]\s+\[([^\]]+)\]\s+(.+?)(?:\s+\(status:\s*([^,)]+?)(?:,\s*priority:\s*([^)]+?))?\))?\s*$/u;

function parseTaskLines(markdown: string): readonly ParsedTaskLine[] {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  const parsed: ParsedTaskLine[] = [];
  for (const line of normalized.split('\n')) {
    const match = TASK_LINE_REGEX.exec(line);
    if (!match) continue;
    parsed.push({
      checked: match[1].toLowerCase() === 'x',
      code: match[2].trim(),
      title: match[3].trim(),
      status: match[4]?.trim(),
      priority: match[5]?.trim(),
    });
  }
  return parsed;
}

export function reconcilePlanMarkdown(
  markdown: string,
  currentTasks: readonly PlanTaskProjection[]
): PlanReconcileResult {
  const frontmatter = parseFrontmatter(markdown);
  const schemaVersion = frontmatter.schemaVersion;
  const violations: PlanReconcileViolation[] = [];

  if (schemaVersion !== PLAN_MARKDOWN_SCHEMA_VERSION) {
    violations.push({
      code: 'INVALID_SCHEMA_VERSION',
      message: `Expected schemaVersion "${PLAN_MARKDOWN_SCHEMA_VERSION}", got "${schemaVersion ?? 'missing'}"`,
    });
  }

  const parsedLines = parseTaskLines(markdown);
  const seenCodes = new Set<string>();
  const parsedByCode = new Map<string, ParsedTaskLine>();

  for (const item of parsedLines) {
    if (seenCodes.has(item.code)) {
      violations.push({
        code: 'DUPLICATE_TASK_CODE',
        taskCode: item.code,
        message: `Duplicate task code "${item.code}" in plan markdown`,
      });
      continue;
    }
    seenCodes.add(item.code);
    parsedByCode.set(item.code, item);
  }

  const currentByCode = new Map<string, PlanTaskProjection>();
  for (const task of currentTasks) {
    currentByCode.set(task.code, task);
  }

  const additions: PlanReconcileChange[] = [];
  const updates: PlanReconcileChange[] = [];
  const unchangedTaskCodes: string[] = [];
  const protectedCompletedSet = new Set<string>();

  const sortedParsedCodes = [...parsedByCode.keys()].sort();
  for (const code of sortedParsedCodes) {
    const parsed = parsedByCode.get(code)!;
    const existing = currentByCode.get(code);
    if (!existing) {
      additions.push({
        kind: 'add',
        taskCode: parsed.code,
        title: parsed.title,
        checked: parsed.checked,
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      });
      continue;
    }

    const existingCompleted = isCompletedTask(existing);
    if (existingCompleted) {
      const reopenedStatus =
        parsed.status !== undefined && parsed.status !== 'done' && parsed.status !== 'cancelled';
      if (!parsed.checked || reopenedStatus) {
        protectedCompletedSet.add(code);
        violations.push({
          code: 'COMPLETED_TASK_REOPEN_FORBIDDEN',
          taskCode: code,
          message: `Completed task "${code}" cannot be unchecked or reopened via markdown reconciliation`,
        });
        continue;
      }
    }

    const existingChecked = existing.status === 'done' || existing.status === 'cancelled';
    const statusChanged = parsed.status !== undefined && parsed.status !== existing.status;
    const priorityChanged =
      parsed.priority !== undefined && parsed.priority !== (existing.priority ?? 'normal');
    const titleChanged = parsed.title !== existing.title;
    const checkboxChanged = parsed.checked !== existingChecked;

    if (titleChanged || statusChanged || priorityChanged || checkboxChanged) {
      updates.push({
        kind: 'update',
        taskCode: parsed.code,
        title: parsed.title,
        checked: parsed.checked,
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        previousTitle: existing.title,
        previousStatus: existing.status,
      });
    } else {
      unchangedTaskCodes.push(code);
    }
  }

  const sortedCurrentTasks = [...currentTasks].sort((a, b) => a.code.localeCompare(b.code));
  for (const existing of sortedCurrentTasks) {
    if (!parsedByCode.has(existing.code) && isCompletedTask(existing)) {
      protectedCompletedSet.add(existing.code);
      violations.push({
        code: 'COMPLETED_TASK_DELETE_FORBIDDEN',
        taskCode: existing.code,
        message: `Completed task "${existing.code}" cannot be deleted via markdown reconciliation`,
      });
    }
  }

  const protectedCompletedCodes = [...protectedCompletedSet].sort();
  const patchPayload = {
    schemaVersion,
    additions,
    updates,
    unchangedTaskCodes,
    protectedCompletedCodes,
    violations,
  };

  return {
    valid: violations.length === 0,
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    advisoryOnly: true,
    automatedMutationsAllowed: false,
    additions,
    updates,
    unchangedTaskCodes,
    protectedCompletedCodes,
    violations,
    patchSha256: sha256Hex(JSON.stringify(patchPayload)),
  };
}
