import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRoadmapId,
  formatIssueTitle,
  renderManagedBlock,
  preserveHumanNotes,
  evaluateLifecycleTransition,
  planRoadmapIssues,
  SYNC_START_MARKER,
  SYNC_END_MARKER,
} from './roadmap-issue-planner.mjs';

test('extractRoadmapId parses bracketed and prefix roadmap keys', () => {
  assert.equal(extractRoadmapId('[M13.09] Implement FLOW Cockpit'), 'M13.09');
  assert.equal(extractRoadmapId('[K9.001] Knowledge gate'), 'K9.001');
  assert.equal(extractRoadmapId('M11.02 Implement issue planner'), 'M11.02');
  assert.equal(extractRoadmapId('Regular unmanaged issue'), null);
  assert.equal(extractRoadmapId(''), null);
  assert.equal(extractRoadmapId(null), null);
});

test('formatIssueTitle formats standard issue title with stable key', () => {
  assert.equal(formatIssueTitle('M13.09', 'Implement FLOW Cockpit'), '[M13.09] Implement FLOW Cockpit');
  assert.equal(formatIssueTitle('M13.09', '[M13.09] Implement FLOW Cockpit'), '[M13.09] Implement FLOW Cockpit');
});

test('preserveHumanNotes preserves notes before and after managed markers', () => {
  const currentBody = `## Maintainer Note\nDo not forget postgres indexes!\n\n${SYNC_START_MARKER}\nold managed content\n${SYNC_END_MARKER}\n\n### QA Checklist\n- [ ] Checked by QA`;
  const newManagedBlock = `${SYNC_START_MARKER}\nnew managed content\n${SYNC_END_MARKER}`;

  const result = preserveHumanNotes(currentBody, newManagedBlock);
  assert.ok(result.startsWith('## Maintainer Note\nDo not forget postgres indexes!\n\n'));
  assert.ok(result.includes('new managed content'));
  assert.ok(!result.includes('old managed content'));
  assert.ok(result.endsWith('\n\n### QA Checklist\n- [ ] Checked by QA'));
});

test('preserveHumanNotes prepends managed block when no markers exist', () => {
  const humanBody = 'Initial manual description written by team.';
  const newManagedBlock = `${SYNC_START_MARKER}\nmanaged block\n${SYNC_END_MARKER}`;

  const result = preserveHumanNotes(humanBody, newManagedBlock);
  assert.equal(result, `${newManagedBlock}\n\n${humanBody}`);
});

test('evaluateLifecycleTransition requires commitSha + ciGreen + evidence artifact', () => {
  const task = { id: 'M13.09' };

  // Incomplete evidence -> open
  assert.equal(evaluateLifecycleTransition(task, {}), 'open');
  assert.equal(evaluateLifecycleTransition(task, { commitSha: 'abc1234' }), 'open');
  assert.equal(evaluateLifecycleTransition(task, { commitSha: 'abc1234', ciGreen: true }), 'open');

  // Complete evidence -> ready-to-close
  assert.equal(
    evaluateLifecycleTransition(task, {
      commitSha: 'abc1234',
      ciGreen: true,
      evidenceArtifact: 'docs/roadmap/evidence/M13.09.md',
    }),
    'ready-to-close'
  );
});

test('planRoadmapIssues creates issues for unmanaged tasks and deduplicates tasks', () => {
  const tasks = [
    { id: 'M13.09', title: 'Task One', milestone: 'M13' },
    { id: 'M13.09', title: 'Task One Duplicate', milestone: 'M13' }, // Duplicate ID
    { id: 'M13.10', title: 'Task Two', milestone: 'M13' },
  ];

  const plan = planRoadmapIssues({
    roadmapTasks: tasks,
    existingIssues: [],
    apply: false,
  });

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.counts.totalTasks, 2);
  assert.equal(plan.counts.creates, 2);
  assert.equal(plan.creates[0].taskId, 'M13.09');
  assert.equal(plan.creates[1].taskId, 'M13.10');
});

test('planRoadmapIssues detects no-op and updates for existing issues with rate-limit batches', () => {
  const tasks = [
    { id: 'M13.09', title: 'Task One', milestone: 'M13' },
    { id: 'M13.10', title: 'Task Two', milestone: 'M13' },
  ];

  const managed1 = renderManagedBlock(tasks[0], 'open');
  const existingIssues = [
    {
      number: 101,
      title: '[M13.09] Task One',
      body: managed1,
      state: 'open',
    },
    {
      number: 102,
      title: '[M13.10] Old Title',
      body: 'Old body without markers',
      state: 'open',
    },
  ];

  const evidenceMap = {
    'M13.10': {
      commitSha: 'deadbeef123',
      ciGreen: true,
      evidenceArtifact: 'docs/roadmap/evidence/M13.10.md',
    },
  };

  const plan = planRoadmapIssues({
    roadmapTasks: tasks,
    existingIssues,
    evidenceMap,
    apply: true,
    rateLimitBatchSize: 1,
  });

  assert.equal(plan.mode, 'apply');
  assert.equal(plan.counts.noops, 1);
  assert.equal(plan.counts.updates, 1);
  assert.equal(plan.noops[0].taskId, 'M13.09');
  assert.equal(plan.updates[0].taskId, 'M13.10');
  assert.equal(plan.updates[0].recommendedClose, true);
  assert.equal(plan.updates[0].state, 'closed');
  assert.equal(plan.batches.length, 1); // 1 mutation (the update), batch size 1
  assert.equal(plan.batches[0].backoffDelayMs, 0);
});

test('planRoadmapIssues flags conflict on multiple remote issues with same key', () => {
  const tasks = [{ id: 'M13.09', title: 'Task One' }];
  const existingIssues = [
    { number: 101, title: '[M13.09] Duplicate 1', body: '', state: 'open' },
    { number: 102, title: '[M13.09] Duplicate 2', body: '', state: 'open' },
  ];

  const plan = planRoadmapIssues({
    roadmapTasks: tasks,
    existingIssues,
  });

  assert.equal(plan.counts.conflicts, 1);
  assert.equal(plan.conflicts[0].type, 'DUPLICATE_REMOTE_ISSUE');
  assert.deepEqual(plan.conflicts[0].issueNumbers, [101, 102]);
});
