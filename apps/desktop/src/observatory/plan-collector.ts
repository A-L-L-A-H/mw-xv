import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { discoverPlans, openBrainStore, type BrainStorageDriver } from '@moonwitness/plan-taskos';
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

/** Optional read-only Brain metadata attached to observatory plans/tasks when a local Brain DB exists. */
interface BrainTaskMetadata {
  readonly proofSha256: string | null;
  readonly attempts: number;
  readonly leaseOwner: string | null;
  readonly modelTier: string | null;
}

interface BrainPlanMetadata {
  readonly formats: ReadonlyMap<string, 'plan-taskos/v1' | 'legacy-markdown'>;
  readonly merkleRoots: ReadonlyMap<string, string | null>;
  readonly tasksByCode: ReadonlyMap<string, BrainTaskMetadata>;
}

async function readBrainPlanMetadata(
  repoRoot: string,
  planIds: readonly string[]
): Promise<BrainPlanMetadata | null> {
  const dbPath = path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  if (!existsSync(dbPath)) return null;
  let store: BrainStorageDriver | null = null;
  try {
    store = await openBrainStore({ dbPath, mode: 'sqlite' });
    const formats = new Map<string, 'plan-taskos/v1' | 'legacy-markdown'>();
    const merkleRoots = new Map<string, string | null>();
    const tasksByCode = new Map<string, BrainTaskMetadata>();
    for (const planId of planIds) {
      const manifestRow = store.get(
        "SELECT value FROM brain_meta WHERE key = ?",
        `plan:${planId}:format`
      ) as { value?: string } | undefined;
      if (manifestRow?.value === 'plan-taskos/v1' || manifestRow?.value === 'legacy-markdown') {
        formats.set(planId, manifestRow.value);
      }
      const rootRow = store.get(
        "SELECT merkle_root FROM proof_ledger WHERE plan_id = ? ORDER BY recorded_at DESC LIMIT 1",
        planId
      ) as { merkle_root?: string } | undefined;
      merkleRoots.set(planId, rootRow?.merkle_root ?? null);
    }
    const nodeRows = store.all(
      "SELECT code, plan_id, attempts, metadata_json FROM nodes WHERE plan_id IN (" +
      planIds.map(() => '?').join(',') + ")",
      ...planIds
    ) as Array<{ code: string; plan_id: string; attempts: number; metadata_json: string }>;
    const proofRows = store.all(
      "SELECT task_code, plan_id, envelope_sha256 FROM proof_ledger"
    ) as Array<{ task_code: string; plan_id: string; envelope_sha256: string }>;
    const leaseRows = store.all(
      "SELECT task_urn, agent_runtime, model_tier FROM leases WHERE released = 0"
    ) as Array<{ task_urn: string; agent_runtime: string; model_tier: string }>;
    const proofByKey = new Map(proofRows.map((row) => [`${row.plan_id}:${row.task_code}`, row.envelope_sha256]));
    const leaseByUrn = new Map(leaseRows.map((row) => [row.task_urn, row]));
    for (const row of nodeRows) {
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(row.metadata_json) as Record<string, unknown>; } catch { /* ignore malformed metadata */ }
      const urn = String(metadata.urn ?? '');
      const lease = urn ? leaseByUrn.get(urn) : undefined;
      tasksByCode.set(`${row.plan_id}:${row.code}`, {
        proofSha256: proofByKey.get(`${row.plan_id}:${row.code}`) ?? null,
        attempts: Number(row.attempts ?? 0),
        leaseOwner: lease?.agent_runtime ?? null,
        modelTier: lease?.model_tier ?? null,
      });
    }
    return { formats, merkleRoots, tasksByCode };
  } catch {
    return null;
  } finally {
    store?.close();
  }
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
  const v2PlanIds = entries
    .filter((entry) => entry.isDirectory() && existsSync(path.join(planDir, entry.name, 'manifest.json')))
    .map((entry) => entry.name);

  // Delegate v2 bundle discovery to @moonwitness/plan-taskos; legacy markdown
  // plans keep the existing collector path with zero consumer-facing changes.
  const sdkBundles = v2PlanIds.length > 0 ? await discoverPlans(repoRoot) : [];
  const brain = await readBrainPlanMetadata(repoRoot, [...v2PlanIds, ...markdownFiles.map((f) => f.replace(/\.md$/iu, ''))]);

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
        ...(brain?.tasksByCode.get(`${planId}:${taskId}`) ?? {}),
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
      ...(brain?.formats.get(planId) ? { format: brain.formats.get(planId) } : {}),
      ...(brain?.merkleRoots.get(planId) ? { merkleRoot: brain.merkleRoots.get(planId) } : {}),
    });
  }

  for (const bundle of sdkBundles) {
    const planId = bundle.manifest.plan_id;
    if (plans.some((plan) => plan.id === planId)) continue;
    const tasks: ObservatoryPlanTask[] = bundle.waves.flatMap((wave) =>
      wave.tasks.map((task) => ({
        id: task.code,
        title: clipRedacted(task.title, 180, knownSecrets),
        done: task.lifecycle.status === 'done',
        wave: wave.title,
        playbook: bundle.source_path,
        ownerFiles: task.governance.owner_files.join(', '),
        dependsOn: task.graph.depends_on.join(', '),
        depIds: [...task.graph.depends_on],
        dependents: [],
        dagState: task.lifecycle.status === 'done' ? 'done' : 'blocked',
        acceptance: task.verification.acceptance_criteria.join(' | '),
        expected: '',
        verify: task.verification.commands.map((c) => c.cmd).join(' | '),
        spec: task.knowledge.spec_files?.join(', ') ?? '',
        commitSha: null,
        commitSubject: null,
        ...(brain?.tasksByCode.get(`${planId}:${task.code}`) ?? {}),
      }))
    );
    const doneCount = tasks.filter((task) => task.done).length;
    const waves: ObservatoryPlanWave[] = bundle.waves.map((wave) => {
      const total = wave.tasks.length;
      const count = wave.tasks.filter((task) => task.lifecycle.status === 'done').length;
      return { title: wave.title, done: count, total, percent: total > 0 ? Math.round((count / total) * 100) : 0 };
    });
    plans.push({
      id: planId,
      title: clipRedacted(bundle.manifest.title, 140, knownSecrets),
      masterFile: `.plan/${planId}.md`,
      waveFiles: bundle.manifest.waves.map((wave) => wave.wave_file),
      updatedAt: null,
      total: tasks.length,
      done: doneCount,
      percent: tasks.length > 0 ? Math.round((doneCount / tasks.length) * 1000) / 10 : 0,
      nextTaskId: tasks.find((task) => !task.done)?.id ?? null,
      nextTaskTitle: tasks.find((task) => !task.done)?.title ?? null,
      waves,
      tasks,
      dag: null,
      format: bundle.format,
      ...(brain?.merkleRoots.get(planId) ? { merkleRoot: brain.merkleRoots.get(planId) } : {}),
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
