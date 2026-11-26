#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, '..');

export const SYNC_START_MARKER = '<!-- mw-roadmap-sync:start -->';
export const SYNC_END_MARKER = '<!-- mw-roadmap-sync:end -->';

/**
 * Extract stable roadmap key from title (e.g. "[M13.09] ..." -> "M13.09" or "M13.09")
 * Supports [M13.09], [K9.001], [M11-01], or bare M13.09 at the start.
 * @param {string} title
 * @returns {string|null}
 */
export function extractRoadmapId(title) {
  if (typeof title !== 'string') return null;
  const match =
    title.match(/\[([A-Z]\d+(?:\.[A-Za-z0-9_-]+)?)\]/u) ||
    title.match(/^([A-Z]\d+(?:\.[A-Za-z0-9_-]+)?)\b/u);
  return match ? match[1] : null;
}

/**
 * Format standard title with stable key prefix: [ID] Title
 * @param {string} id
 * @param {string} title
 * @returns {string}
 */
export function formatIssueTitle(id, title) {
  const cleanTitle = title.replace(/^\[[A-Za-z0-9_.-]+\]\s*/u, '').trim();
  return `[${id}] ${cleanTitle}`;
}

/**
 * Render standard managed body section between sync markers
 * @param {object} task
 * @param {string} status
 * @param {object} evidenceData
 * @returns {string}
 */
export function renderManagedBlock(task, status = 'open', evidenceData = {}) {
  const lines = [
    SYNC_START_MARKER,
    `### Roadmap Identity: [${task.id || task.code}]`,
    `- **Status:** \`${status}\``,
    `- **Milestone:** ${task.milestone || 'None'}`,
    task.summary ? `- **Summary:** ${task.summary}` : null,
    evidenceData.commitSha ? `- **Linked Commit:** \`${evidenceData.commitSha}\`` : null,
    evidenceData.ciGreen ? `- **CI Status:** \`GREEN\`` : null,
    evidenceData.evidenceArtifact
      ? `- **Evidence Artifact:** \`${evidenceData.evidenceArtifact}\``
      : null,
    SYNC_END_MARKER,
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Update issue body while preserving human-authored notes outside markers.
 * If markers are not present, human notes are preserved by prepending the managed block.
 * @param {string} currentBody
 * @param {string} newManagedBlock
 * @returns {string}
 */
export function preserveHumanNotes(currentBody = '', newManagedBlock) {
  if (!currentBody || typeof currentBody !== 'string') {
    return newManagedBlock;
  }

  const startIndex = currentBody.indexOf(SYNC_START_MARKER);
  const endIndex = currentBody.indexOf(SYNC_END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const before = currentBody.slice(0, startIndex);
    const after = currentBody.slice(endIndex + SYNC_END_MARKER.length);
    return `${before}${newManagedBlock}${after}`;
  }

  // Markers not found, prepend managed block and keep entire human body below
  const trimmed = currentBody.trim();
  return trimmed ? `${newManagedBlock}\n\n${trimmed}` : newManagedBlock;
}

/**
 * Compute evidence-based lifecycle transition.
 * Transitions to 'ready-to-close' only if linked commit + ciGreen + evidence artifact exist.
 * @param {object} task
 * @param {object} evidence
 * @returns {'open'|'ready-to-close'}
 */
export function evaluateLifecycleTransition(task, evidence = {}) {
  const hasCommit = Boolean(evidence.commitSha || task.evidence?.commitSha);
  const isCiGreen = Boolean(evidence.ciGreen);
  const hasArtifact = Boolean(
    evidence.evidenceArtifact ||
    (task.evidence?.paths && task.evidence.paths.length > 0) ||
    task.evidence
  );

  if (hasCommit && isCiGreen && hasArtifact) {
    return 'ready-to-close';
  }
  return 'open';
}

/**
 * Pure, idempotent issue planner
 * @param {object} options
 * @param {Array<object>} options.roadmapTasks
 * @param {Array<object>} options.existingIssues
 * @param {Record<string, object>} [options.evidenceMap]
 * @param {boolean} [options.apply]
 * @param {number} [options.rateLimitBatchSize] Default 5
 * @returns {object} Plan result
 */
export function planRoadmapIssues({
  roadmapTasks = [],
  existingIssues = [],
  evidenceMap = {},
  apply = false,
  rateLimitBatchSize = 5,
} = {}) {
  // Index existing issues by stable roadmap key [ID]
  const existingByKey = new Map();
  const duplicateKeys = new Set();

  for (const issue of existingIssues) {
    const key = extractRoadmapId(issue.title);
    if (!key) continue;

    if (existingByKey.has(key)) {
      duplicateKeys.add(key);
      const list = existingByKey.get(key);
      list.push(issue);
    } else {
      existingByKey.set(key, [issue]);
    }
  }

  const creates = [];
  const updates = [];
  const noops = [];
  const conflicts = [];

  // Deduplicate roadmap tasks by stable ID
  const seenTaskIds = new Set();
  const uniqueTasks = [];
  for (const task of roadmapTasks) {
    const taskId = task.id || task.code;
    if (!taskId) continue;
    if (seenTaskIds.has(taskId)) continue;
    seenTaskIds.add(taskId);
    uniqueTasks.push(task);
  }

  for (const task of uniqueTasks) {
    const taskId = task.id || task.code;
    const taskTitle = task.title || '';
    const targetTitle = formatIssueTitle(taskId, taskTitle);
    const evidence = evidenceMap[taskId] || {};
    const lifecycleStatus = evaluateLifecycleTransition(task, evidence);
    const managedBlock = renderManagedBlock(task, lifecycleStatus, evidence);

    const matchingIssues = existingByKey.get(taskId);

    if (matchingIssues && matchingIssues.length > 1) {
      conflicts.push({
        taskId,
        type: 'DUPLICATE_REMOTE_ISSUE',
        message: `Multiple issues exist for key [${taskId}]: ${matchingIssues.map((i) => i.number).join(', ')}`,
        issueNumbers: matchingIssues.map((i) => i.number),
      });
      continue;
    }

    if (!matchingIssues || matchingIssues.length === 0) {
      // Need create
      creates.push({
        taskId,
        action: 'create',
        title: targetTitle,
        body: managedBlock,
        status: lifecycleStatus,
        labels: ['roadmap', task.milestone || 'task'].filter(Boolean),
      });
    } else {
      // Existing issue
      const issue = matchingIssues[0];
      const newBody = preserveHumanNotes(issue.body, managedBlock);
      const titleChanged = issue.title.trim() !== targetTitle.trim();
      const bodyChanged = (issue.body || '').trim() !== newBody.trim();
      const stateShouldClose = lifecycleStatus === 'ready-to-close' && issue.state === 'open';

      if (!titleChanged && !bodyChanged && !stateShouldClose) {
        noops.push({
          taskId,
          action: 'noop',
          issueNumber: issue.number,
        });
      } else {
        updates.push({
          taskId,
          action: 'update',
          issueNumber: issue.number,
          title: targetTitle,
          body: newBody,
          state: stateShouldClose ? 'closed' : issue.state,
          recommendedClose: stateShouldClose,
          changes: {
            title: titleChanged,
            body: bodyChanged,
            close: stateShouldClose,
          },
        });
      }
    }
  }

  // Partition actions into batches with rate-limit backoff metadata
  const allMutations = [...creates, ...updates];
  const batches = [];
  for (let i = 0; i < allMutations.length; i += rateLimitBatchSize) {
    const batchItems = allMutations.slice(i, i + rateLimitBatchSize);
    batches.push({
      batchIndex: Math.floor(i / rateLimitBatchSize),
      items: batchItems,
      backoffDelayMs: Math.floor(i / rateLimitBatchSize) * 1000,
    });
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    counts: {
      totalTasks: uniqueTasks.length,
      creates: creates.length,
      updates: updates.length,
      noops: noops.length,
      conflicts: conflicts.length,
      batches: batches.length,
    },
    creates,
    updates,
    noops,
    conflicts,
    batches,
  };
}

/**
 * CLI execution entrypoint
 */
export async function runCli(args = process.argv.slice(2)) {
  const isApply = args.includes('--apply');
  const dryRun = !isApply || args.includes('--dry-run');

  let tasks = [];
  const tasksPath = resolve(repositoryRoot, 'docs/tasks/tasks.json');

  if (existsSync(tasksPath)) {
    const data = JSON.parse(readFileSync(tasksPath, 'utf8'));
    tasks = data.tasks || data;
  }

  const plan = planRoadmapIssues({
    roadmapTasks: tasks,
    existingIssues: [],
    apply: !dryRun,
  });

  const output = JSON.stringify(plan, null, 2);
  const outIndex = args.indexOf('--output');
  if (outIndex !== -1 && args[outIndex + 1]) {
    writeFileSync(resolve(process.cwd(), args[outIndex + 1]), output, 'utf8');
  } else {
    process.stdout.write(output + '\n');
  }

  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
