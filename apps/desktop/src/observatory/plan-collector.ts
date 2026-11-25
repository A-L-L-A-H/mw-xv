import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { clipRedacted } from './io.js';
import type { ObservatoryPlanSummary, ObservatoryPlanTask, ObservatoryPlanWave } from './types.js';

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
  const sections = markdown.split(/\r?\n(?=###[#]?\s+(?:-\s+)?\[[ xX]\]\s+[A-Z]\d+)/u);
  for (const section of sections) {
    const header = section.match(/^###[#]?\s+(?:-\s+)?\[[ xX]\]\s+([A-Z]\d+)\s*[—-]\s*(.+)/u);
    if (!header || !header[1]) continue;
    const taskId = header[1].trim();
    const extractField = (labelPattern: string): string => {
      const regex = new RegExp(`^-\\s+\\*\\*${labelPattern}:\\*\\*\\s*(.+)$`, 'mu');
      const match = section.match(regex);
      return match && match[1] ? clipRedacted(match[1], 320, knownSecrets) : '';
    };
    const specMatch = section.match(
      /-\s+\*\*Exact Spec:\*\*([\s\S]*?)(?=\n-\s+\*\*(?:Acceptance Criteria|Expected Output|Verify|Commit):|$)/u
    );
    targetMap.set(taskId, {
      playbook: playbookName,
      ownerFiles: extractField('Owner File\\(s\\)'),
      dependsOn: extractField('Depends On'),
      acceptance: extractField('Acceptance Criteria'),
      expected: extractField('Expected Output'),
      verify: extractField('Verify'),
      spec: specMatch && specMatch[1] ? clipRedacted(specMatch[1], 700, knownSecrets) : '',
    });
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
