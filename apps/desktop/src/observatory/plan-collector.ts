import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { clipRedacted } from './io.js';
import type {
  ObservatoryGitDirtyFile,
  ObservatoryPlanDag,
  ObservatoryPlanDagEdge,
  ObservatoryPlanDagNode,
  ObservatoryPlanDagState,
  ObservatoryPlanSummary,
  ObservatoryPlanTask,
  ObservatoryPlanWave,
  ObservatorySessionSummary,
} from './types.js';

interface TaskPlaybookDetail {
  readonly playbook: string;
  readonly ownerFiles: string;
  readonly dependsOn: string;
  readonly acceptance: string;
  readonly expected: string;
  readonly verify: string;
  readonly spec: string;
}

function parseTaskDetailBlocks(
  markdown: string,
  playbookName: string,
  targetMap: Map<string, TaskPlaybookDetail>,
  knownSecrets: readonly string[]
): void {
  const sections = markdown.split(/\r?\n(?=#{2,4}\s+(?:-\s+)?\[[ xX]\]\s+[A-Z]\d{2,3}\b)/u);
  for (const section of sections) {
    const header = section.match(/^#{2,4}\s+(?:-\s+)?\[[ xX]\]\s+([A-Z]\d{2,3})\s*[—-]\s*(.+)/u);
    if (!header || !header[1]) continue;
    const taskId = header[1].trim();
    const extractBlock = (labelPattern: string): string => {
      const regex = new RegExp(
        `^-\\s+\\*\\*${labelPattern}:\\*\\*([\\s\\S]*?)(?=\\n-\\s+\\*\\*[A-Za-z]|\\n---|$)`,
        'mu'
      );
      const match = section.match(regex);
      if (!match || !match[1]) return '';
      return match[1]
        .replace(/```[a-z]*\r?\n?/giu, ' ')
        .replace(/```/gu, ' ')
        .trim();
    };

    targetMap.set(taskId, {
      playbook: playbookName,
      ownerFiles: clipRedacted(
        extractBlock('Owner File(?:\\(s\\)|\\s*\\([^)]+\\))?'),
        260,
        knownSecrets
      ),
      dependsOn: clipRedacted(extractBlock('Depends On'), 200, knownSecrets),
      acceptance: clipRedacted(extractBlock('Acceptance Criteria'), 380, knownSecrets),
      expected: clipRedacted(extractBlock('Expected Output'), 260, knownSecrets),
      verify: clipRedacted(extractBlock('Verify'), 320, knownSecrets),
      spec: clipRedacted(extractBlock('Exact Spec'), 700, knownSecrets),
    });
  }
}

export function extractTaskDependencies(
  dependsOnText: string,
  validTaskIds: ReadonlySet<string>
): string[] {
  if (!dependsOnText || /^none$/iu.test(dependsOnText.trim())) return [];
  const discovered = new Set<string>();
  const rangePattern = /\b([A-Z])(\d{2,3})\s*[–—-]\s*\1(\d{2,3})\b/gu;
  for (const rangeMatch of dependsOnText.matchAll(rangePattern)) {
    const prefix = rangeMatch[1];
    const startRaw = rangeMatch[2];
    const endRaw = rangeMatch[3];
    if (!prefix || !startRaw || !endRaw) continue;
    const startNum = Number(startRaw);
    const endNum = Number(endRaw);
    const padLen = startRaw.length;
    if (
      Number.isInteger(startNum) &&
      Number.isInteger(endNum) &&
      endNum >= startNum &&
      endNum - startNum <= 30
    ) {
      for (let num = startNum; num <= endNum; num += 1) {
        const candidateId = `${prefix}${String(num).padStart(padLen, '0')}`;
        if (validTaskIds.has(candidateId)) discovered.add(candidateId);
      }
    }
  }
  const singlePattern = /\b([A-Z]\d{2,3})\b/gu;
  for (const singleMatch of dependsOnText.matchAll(singlePattern)) {
    const candidateId = singleMatch[1];
    if (candidateId && validTaskIds.has(candidateId)) discovered.add(candidateId);
  }
  return Array.from(discovered);
}

export function buildPlanDag(
  tasks: readonly ObservatoryPlanTask[],
  waves: readonly ObservatoryPlanWave[],
  activeSessions: readonly ObservatorySessionSummary[] = [],
  dirtyFiles: readonly ObservatoryGitDirtyFile[] = []
): ObservatoryPlanDag {
  const validTaskIds = new Set(tasks.map((taskEntry) => taskEntry.id));
  const taskById = new Map(tasks.map((taskEntry) => [taskEntry.id, taskEntry]));
  const waveIndexByTitle = new Map(waves.map((waveEntry, idx) => [waveEntry.title, idx]));

  const activeTextBlob = activeSessions
    .filter((session) => session.status === 'running')
    .map((session) => `${session.title} ${session.focus} ${session.lastTool}`.toLowerCase())
    .join(' ');
  const dirtyPathList = dirtyFiles.map((fileEntry) => fileEntry.path.toLowerCase());

  const edges: ObservatoryPlanDagEdge[] = [];
  const dependentsById = new Map<string, string[]>();
  for (const taskEntry of tasks) {
    dependentsById.set(taskEntry.id, []);
  }

  for (let idx = 0; idx < tasks.length; idx += 1) {
    const taskEntry = tasks[idx];
    if (!taskEntry) continue;
    let depIds = extractTaskDependencies(taskEntry.dependsOn, validTaskIds).filter(
      (depId) => depId !== taskEntry.id
    );
    const prevTask = idx > 0 ? tasks[idx - 1] : undefined;
    if (
      depIds.length === 0 &&
      !taskEntry.dependsOn &&
      prevTask &&
      prevTask.wave === taskEntry.wave
    ) {
      depIds = [prevTask.id];
    }
    taskEntry.depIds = depIds;
    for (const depId of depIds) {
      edges.push({
        from: depId,
        to: taskEntry.id,
        satisfied: Boolean(taskById.get(depId)?.done),
      });
      dependentsById.get(depId)?.push(taskEntry.id);
    }
  }

  // Memoized cycle-safe topological depth
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const computeDepth = (taskId: string): number => {
    const cached = depthMemo.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const taskEntry = taskById.get(taskId);
    let maxParentDepth = -1;
    for (const depId of taskEntry?.depIds ?? []) {
      maxParentDepth = Math.max(maxParentDepth, computeDepth(depId));
    }
    visiting.delete(taskId);
    const depth = maxParentDepth + 1;
    depthMemo.set(taskId, depth);
    return depth;
  };

  let doneCount = 0;
  let activeCount = 0;
  let readyCount = 0;
  let blockedCount = 0;

  const nodes: ObservatoryPlanDagNode[] = tasks.map((taskEntry, orderIndex) => {
    const depsDone = taskEntry.depIds.every((depId) => Boolean(taskById.get(depId)?.done));
    const escapedId = taskEntry.id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const mentionedInRunning = new RegExp(`\\b${escapedId}\\b`, 'iu').test(activeTextBlob);
    const ownerTokens = taskEntry.ownerFiles
      .replace(/`/gu, '')
      .split(/[,;]+/u)
      .map((token) =>
        token
          .trim()
          .replace(/\/\*+$/u, '')
          .toLowerCase()
      )
      .filter((token) => token.length >= 6);
    const ownerDirty = ownerTokens.some((ownerToken) =>
      dirtyPathList.some((dirtyPath) => dirtyPath.includes(ownerToken))
    );

    let dagState: ObservatoryPlanDagState;
    if (taskEntry.done) {
      dagState = 'done';
      doneCount += 1;
    } else if (mentionedInRunning || (depsDone && ownerDirty)) {
      dagState = 'active';
      activeCount += 1;
    } else if (depsDone) {
      dagState = 'ready';
      readyCount += 1;
    } else {
      dagState = 'blocked';
      blockedCount += 1;
    }

    taskEntry.dagState = dagState;
    const dependents = dependentsById.get(taskEntry.id) ?? [];
    taskEntry.dependents = dependents;

    return {
      id: taskEntry.id,
      title: taskEntry.title,
      wave: taskEntry.wave,
      waveIndex: waveIndexByTitle.get(taskEntry.wave) ?? 0,
      orderIndex,
      depth: computeDepth(taskEntry.id),
      state: dagState,
      done: taskEntry.done,
      depIds: taskEntry.depIds,
      dependents,
      commitSha: taskEntry.commitSha,
      ownerFiles: taskEntry.ownerFiles,
    };
  });

  // Longest remaining pending chain (Boss Critical Path), cycle-safe
  const pendingIds = new Set(nodes.filter((node) => !node.done).map((node) => node.id));
  const chainMemo = new Map<string, string[]>();
  const chainVisiting = new Set<string>();
  const longestPendingChain = (taskId: string): string[] => {
    const cached = chainMemo.get(taskId);
    if (cached) return cached;
    if (chainVisiting.has(taskId)) return [taskId];
    chainVisiting.add(taskId);
    let bestTail: string[] = [];
    for (const nextId of dependentsById.get(taskId) ?? []) {
      if (!pendingIds.has(nextId)) continue;
      const tail = longestPendingChain(nextId);
      if (tail.length > bestTail.length) bestTail = tail;
    }
    chainVisiting.delete(taskId);
    const chain = [taskId, ...bestTail];
    chainMemo.set(taskId, chain);
    return chain;
  };

  let criticalPathIds: string[] = [];
  for (const node of nodes) {
    if (node.state === 'ready' || node.state === 'active') {
      const candidate = longestPendingChain(node.id);
      if (candidate.length > criticalPathIds.length) {
        criticalPathIds = candidate;
      }
    }
  }

  return {
    nodes,
    edges,
    criticalPathIds,
    stats: {
      done: doneCount,
      active: activeCount,
      ready: readyCount,
      blocked: blockedCount,
    },
  };
}

export interface CollectedPlansBundle {
  readonly plans: readonly ObservatoryPlanSummary[];
  readonly defaultPlanId: string | null;
}

export async function collectPlans(
  repoRoot: string,
  knownSecrets: readonly string[] = []
): Promise<CollectedPlansBundle> {
  const planDir = path.join(repoRoot, '.plan');
  if (!existsSync(planDir)) {
    return { plans: [], defaultPlanId: null };
  }

  const entries = await readdir(planDir, { withFileTypes: true }).catch(() => []);
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);

  const plans: ObservatoryPlanSummary[] = [];

  for (const fileName of markdownFiles) {
    const planId = fileName.replace(/\.md$/iu, '');
    const masterPath = path.join(planDir, fileName);
    const content = await readFile(masterPath, 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/u);

    const titleLine = lines.find((line) => line.startsWith('# ')) ?? `# ${planId}`;
    const title = clipRedacted(titleLine.replace(/^#\s+/u, ''), 140, knownSecrets);

    const detailsByTask = new Map<string, TaskPlaybookDetail>();
    parseTaskDetailBlocks(content, fileName, detailsByTask, knownSecrets);

    const subDir = path.join(planDir, planId);
    const waveFiles: string[] = [];
    if (existsSync(subDir)) {
      const subEntries = await readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const subEntry of subEntries) {
        if (!subEntry.isFile() || !subEntry.name.endsWith('.md')) continue;
        waveFiles.push(subEntry.name);
        if (subEntry.name.startsWith('ADR-')) continue;
        const waveText = await readFile(path.join(subDir, subEntry.name), 'utf8').catch(() => '');
        parseTaskDetailBlocks(waveText, subEntry.name, detailsByTask, knownSecrets);
      }
    }

    const mutableWaves: { title: string; done: number; total: number }[] = [];
    let currentWave: { title: string; done: number; total: number } | null = null;
    const tasks: ObservatoryPlanTask[] = [];
    const seenTaskIds = new Set<string>();

    for (const rawLine of lines) {
      const waveMatch = rawLine.match(/^###\s+(.+)$/u);
      if (waveMatch && waveMatch[1] && !waveMatch[1].trim().startsWith('[')) {
        currentWave = { title: waveMatch[1].trim(), done: 0, total: 0 };
        mutableWaves.push(currentWave);
        continue;
      }

      const taskMatch =
        rawLine.match(/^\s*-\s+\[([ xX])\]\s+\*\*([A-Za-z0-9_-]+)\*\*\s*[—-]\s*(.+)$/u) ??
        rawLine.match(/^####\s+-\s+\[([ xX])\]\s+([A-Za-z0-9_-]+)\s*[—-]\s*(.+)$/u);
      if (!taskMatch || !taskMatch[1] || !taskMatch[2] || !taskMatch[3]) continue;

      const taskId = taskMatch[2].trim();
      if (seenTaskIds.has(taskId)) continue;
      seenTaskIds.add(taskId);

      const done = taskMatch[1].toLowerCase() === 'x';
      const detail = detailsByTask.get(taskId);
      const task: ObservatoryPlanTask = {
        id: taskId,
        title: clipRedacted(taskMatch[3], 180, knownSecrets),
        done,
        wave: currentWave ? currentWave.title : 'General',
        playbook: detail?.playbook ?? null,
        ownerFiles: detail?.ownerFiles ?? '',
        dependsOn: detail?.dependsOn ?? '',
        depIds: [],
        dependents: [],
        dagState: done ? 'done' : 'blocked',
        acceptance: detail?.acceptance ?? '',
        expected: detail?.expected ?? '',
        verify: detail?.verify ?? '',
        spec: detail?.spec ?? '',
        commitSha: null,
        commitSubject: null,
      };
      tasks.push(task);
      if (currentWave) {
        currentWave.total += 1;
        if (done) currentWave.done += 1;
      }
    }

    const doneCount = tasks.filter((task) => task.done).length;
    const nextTask = tasks.find((task) => !task.done) ?? null;
    const fileStat = await stat(masterPath).catch(() => null);
    const waves: ObservatoryPlanWave[] = mutableWaves
      .filter((wave) => wave.total > 0)
      .map((wave) => ({
        title: wave.title,
        done: wave.done,
        total: wave.total,
        percent: Math.round((wave.done / wave.total) * 100),
      }));

    plans.push({
      id: planId,
      title,
      masterFile: `.plan/${fileName}`,
      waveFiles,
      updatedAt: fileStat ? new Date(fileStat.mtimeMs).toISOString() : null,
      total: tasks.length,
      done: doneCount,
      percent: tasks.length > 0 ? Math.round((doneCount / tasks.length) * 1000) / 10 : 0,
      nextTaskId: nextTask?.id ?? null,
      nextTaskTitle: nextTask?.title ?? null,
      waves,
      tasks,
      dag: null,
    });
  }

  plans.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  const preferred =
    plans.find((plan) => plan.id === 'coolify-sovereign-paas-single-db') ?? plans[0] ?? null;

  return {
    plans,
    defaultPlanId: preferred?.id ?? null,
  };
}
