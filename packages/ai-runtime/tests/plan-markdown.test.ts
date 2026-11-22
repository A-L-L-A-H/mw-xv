import { describe, expect, it } from 'vitest';
import {
  PLAN_MARKDOWN_SCHEMA_VERSION,
  reconcilePlanMarkdown,
  renderPlanMarkdown,
  type PlanMarkdownInput,
  type PlanTaskProjection,
} from '../src/plan-markdown.js';

function makeInput(overrides: Partial<PlanMarkdownInput> = {}): PlanMarkdownInput {
  return {
    projectId: 'proj-1',
    projectCode: 'MW-13',
    projectTitle: 'Proof Gate & Plan Sync',
    sourceSha: 'deadbeef1234',
    milestones: [
      { id: 'm-2', code: 'M2', title: 'Second Milestone', order: 2 },
      { id: 'm-1', code: 'M1', title: 'First Milestone', order: 1 },
    ],
    tasks: [
      {
        id: 't-2',
        code: 'TASK-0002',
        title: 'Implement diff scope with token=supersecret123',
        status: 'done',
        priority: 'high',
        milestoneId: 'm-1',
        order: 2,
      },
      {
        id: 't-1',
        code: 'TASK-0001',
        title: 'Build check matrix',
        status: 'in_progress',
        priority: 'critical',
        milestoneId: 'm-1',
        order: 1,
      },
      {
        id: 't-3',
        code: 'TASK-0003',
        title: 'Unassigned backlog item',
        status: 'todo',
        priority: 'low',
      },
    ],
    ...overrides,
  };
}

describe('renderPlanMarkdown', () => {
  it('renders deterministic sorted markdown with YAML frontmatter and redaction', () => {
    const first = renderPlanMarkdown(makeInput({ generatedAt: '2026-11-22T01:00:00.000Z' }));
    const second = renderPlanMarkdown(makeInput({ generatedAt: '2026-11-22T23:59:59.000Z' }));

    expect(first.schemaVersion).toBe(PLAN_MARKDOWN_SCHEMA_VERSION);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.markdown).toBe(second.markdown);
    expect(first.markdown).toContain("schemaVersion: 'mw-plan/v1'");
    expect(first.markdown).toContain(
      '- [ ] [TASK-0001] Build check matrix (status: in_progress, priority: critical)'
    );
    expect(first.markdown).toContain(
      '- [x] [TASK-0002] Implement diff scope with token=[REDACTED] (status: done, priority: high)'
    );
    expect(first.markdown).not.toContain('supersecret123');
    expect(first.markdown.indexOf('## [M1]')).toBeLessThan(first.markdown.indexOf('## [M2]'));
  });
});

describe('reconcilePlanMarkdown', () => {
  const currentTasks: PlanTaskProjection[] = [
    {
      id: 't-1',
      code: 'TASK-0001',
      title: 'Build check matrix',
      status: 'in_progress',
      priority: 'critical',
    },
    {
      id: 't-2',
      code: 'TASK-0002',
      title: 'Implement diff scope',
      status: 'done',
      priority: 'high',
    },
    {
      id: 't-3',
      code: 'TASK-0003',
      title: 'Accepted contract task',
      status: 'in_review',
      priority: 'normal',
      workContractStatus: 'accepted',
    },
  ];

  it('computes advisory additions, updates, and unchanged codes deterministically', () => {
    const md = [
      '---',
      "schemaVersion: 'mw-plan/v1'",
      "projectId: 'proj-1'",
      "projectCode: 'MW-13'",
      "sourceSha: 'deadbeef1234'",
      '---',
      '',
      '- [ ] [TASK-0001] Build check matrix v2 (status: in_review, priority: critical)',
      '- [x] [TASK-0002] Implement diff scope (status: done, priority: high)',
      '- [x] [TASK-0003] Accepted contract task (status: done, priority: normal)',
      '- [ ] [TASK-0004] Add docs (status: todo, priority: low)',
    ].join('\n');

    const result = reconcilePlanMarkdown(md, currentTasks);
    expect(result.valid).toBe(true);
    expect(result.advisoryOnly).toBe(true);
    expect(result.automatedMutationsAllowed).toBe(false);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0]?.taskCode).toBe('TASK-0004');
    expect(result.updates.map((u) => u.taskCode)).toEqual(['TASK-0001', 'TASK-0003']);
    expect(result.unchangedTaskCodes).toEqual(['TASK-0002']);
    expect(result.violations).toEqual([]);
    expect(result.patchSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects invalid schemaVersion and duplicate task codes', () => {
    const md = [
      '---',
      "schemaVersion: 'mw-plan/v2'",
      '---',
      '- [ ] [TASK-0001] First (status: todo, priority: normal)',
      '- [ ] [TASK-0001] Duplicate (status: todo, priority: normal)',
      '- [x] [TASK-0002] Implement diff scope (status: done, priority: high)',
      '- [x] [TASK-0003] Accepted contract task (status: done, priority: normal)',
    ].join('\n');

    const result = reconcilePlanMarkdown(md, currentTasks);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('INVALID_SCHEMA_VERSION');
    expect(result.violations.map((v) => v.code)).toContain('DUPLICATE_TASK_CODE');
  });

  it('forbids deleting or reopening completed or accepted tasks', () => {
    const md = [
      '---',
      "schemaVersion: 'mw-plan/v1'",
      '---',
      '- [ ] [TASK-0001] Build check matrix (status: in_progress, priority: critical)',
      '- [ ] [TASK-0002] Implement diff scope (status: in_progress, priority: high)',
    ].join('\n');

    const result = reconcilePlanMarkdown(md, currentTasks);
    expect(result.valid).toBe(false);
    expect(result.protectedCompletedCodes).toEqual(['TASK-0002', 'TASK-0003']);
    expect(result.violations.map((v) => v.code)).toContain('COMPLETED_TASK_REOPEN_FORBIDDEN');
    expect(result.violations.map((v) => v.code)).toContain('COMPLETED_TASK_DELETE_FORBIDDEN');
  });
});
