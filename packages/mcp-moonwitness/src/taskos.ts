/**
 * Summarize `docs/tasks/tasks.json` (format `moonwitness-tasks/v2`).
 * Read-only file parsing — no database access, no mutation.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TaskosSummary {
  readonly format: string;
  readonly schemaVersion: string;
  readonly totalTasks: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byProject: Readonly<Record<string, number>>;
  readonly byPriority: Readonly<Record<string, number>>;
}

const REPO_ROOT = findRepoRoot(path.resolve(path.dirname(fileURLToPath(import.meta.url))));

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir, '../../../..');
}

interface RawTask {
  readonly status?: unknown;
  readonly project?: unknown;
  readonly priority?: unknown;
}

interface RawTasksFile {
  readonly format?: unknown;
  readonly schemaVersion?: unknown;
  readonly tasks?: unknown;
}

function tally(tasks: readonly RawTask[], key: 'status' | 'project' | 'priority'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    const value = task[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

export async function summarizeTaskos(filePath?: string): Promise<TaskosSummary> {
  const resolved = filePath ?? path.join(REPO_ROOT, 'docs', 'tasks', 'tasks.json');
  const raw = JSON.parse(await readFile(resolved, 'utf8')) as RawTasksFile;
  const tasks = Array.isArray(raw.tasks) ? (raw.tasks as RawTask[]) : [];

  return {
    format: typeof raw.format === 'string' ? raw.format : 'unknown',
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : 'unknown',
    totalTasks: tasks.length,
    byStatus: sortedRecord(tally(tasks, 'status')),
    byProject: sortedRecord(tally(tasks, 'project')),
    byPriority: sortedRecord(tally(tasks, 'priority')),
  };
}
