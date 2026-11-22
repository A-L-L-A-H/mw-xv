import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTasksRegistry, validateTasks } from './validate-tasks.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function assertTaskRegistryValid(validation) {
  if (!validation || validation.valid !== true) {
    const details = Array.isArray(validation?.errors) ? validation.errors : [];
    throw new Error(
      [
        'Refusing TaskOS sync: canonical registry has not passed validation.',
        ...details.map((detail) => `- ${detail}`),
      ].join('\\n')
    );
  }
  if (!Number.isSafeInteger(validation.taskCount) || validation.taskCount < 1) {
    throw new Error('Refusing TaskOS sync: canonical registry contains no task records.');
  }
}

export async function syncRoadmap() {
  const tasksFilePath = path.join(rootDir, 'docs/tasks/tasks.json');
  const roadmapTasksPath = path.join(rootDir, 'docs/roadmap/tasks.json');
  const roadmapMdPath = path.join(rootDir, 'ROADMAP.md');

  const validation = await validateTasks();
  assertTaskRegistryValid(validation);

  const tasksRaw = await fs.readFile(tasksFilePath, 'utf8');
  const canonicalData = parseTasksRegistry(tasksRaw);
  if (!Array.isArray(canonicalData.tasks) || canonicalData.tasks.length === 0) {
    throw new Error('Refusing TaskOS sync: canonical registry contains no task records.');
  }
  const canonicalTasks = canonicalData.tasks;
  const canonicalMap = new Map(canonicalTasks.map((t) => [t.code, t]));

  const roadmapTasksRaw = await fs.readFile(roadmapTasksPath, 'utf8');
  const roadmapData = JSON.parse(roadmapTasksRaw);

  let updatedRoadmapTasks = 0;
  for (const rt of roadmapData.tasks) {
    const ct = canonicalMap.get(rt.id);
    if (!ct) continue;
    const ctStatus = ct.status === 'done' ? 'complete' : ct.status === 'doing' ? 'in_progress' : ct.status === 'blocked' ? 'blocked' : 'todo';
    if (rt.status !== ctStatus) {
      rt.status = ctStatus;
      updatedRoadmapTasks += 1;
    }
  }

  if (updatedRoadmapTasks > 0) {
    await fs.writeFile(roadmapTasksPath, JSON.stringify(roadmapData, null, 2) + '\n', 'utf8');
    console.log(`Updated ${updatedRoadmapTasks} task statuses in ${roadmapTasksPath}`);
  }

  // Update ROADMAP.md checkboxes if needed
  const roadmapLines = (await fs.readFile(roadmapMdPath, 'utf8')).split(/\r?\n/);
  let updatedLines = 0;
  const newLines = roadmapLines.map((line) => {
    const match = /^(\s*-\s*\[)([ xX])(\]\s+)([A-Za-z0-9_.-]+)(\b.*)$/.exec(line);
    if (!match) return line;
    const [, prefix, currentBox, mid, code, suffix] = match;
    const ct = canonicalMap.get(code);
    if (!ct) return line;
    const shouldBeDone = ct.status === 'done';
    const isCurrentlyDone = currentBox.toLowerCase() === 'x';
    if (shouldBeDone !== isCurrentlyDone) {
      updatedLines += 1;
      return `${prefix}${shouldBeDone ? 'x' : ' '}${mid}${code}${suffix}`;
    }
    return line;
  });

  if (updatedLines > 0) {
    await fs.writeFile(roadmapMdPath, newLines.join('\n'), 'utf8');
    console.log(`Updated ${updatedLines} checkboxes in ${roadmapMdPath}`);
  }

  return { updatedRoadmapTasks, updatedLines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  syncRoadmap().then((res) => {
    console.log(`Roadmap Sync completed: ${res.updatedRoadmapTasks} task(s) and ${res.updatedLines} markdown line(s) updated.`);
  }).catch((err) => {
    console.error('Roadmap sync failed:', err);
    process.exit(1);
  });
}
