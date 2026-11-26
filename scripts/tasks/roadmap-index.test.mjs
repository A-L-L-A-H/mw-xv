import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_TASKS_RELATIVE_PATH,
  loadCanonicalRoadmapIndex,
  loadRoadmapIndexFromRevision,
  projectRoadmapIndexFromTaskos,
} from './roadmap-index.mjs';
import { findDuplicateTaskJsonFiles } from './validate-tasks.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('projectRoadmapIndexFromTaskos projects only M/K roadmap tasks with lossless fields', () => {
  const projected = projectRoadmapIndexFromTaskos({
    tasks: [
      {
        code: 'M13.01',
        series: 'M',
        milestone: 'M13',
        title: 'Desktop capability audit',
        proposedSolution: 'docs/roadmap/evidence/M13.01.md',
        priority: 'p1',
        status: 'done',
        dependsOn: ['M12.05'],
        tags: ['m', 'desktop'],
        evidence: {
          detailFile: 'docs/roadmap/14-desktop-engineering.md',
          paths: ['docs/roadmap/evidence/M13.01.md'],
        },
      },
      {
        code: 'W1-001',
        series: 'W1',
        milestone: 'W1',
        title: 'Non-roadmap visual task',
        status: 'todo',
        dependsOn: [],
        tags: ['w1'],
        evidence: { detailFile: null, paths: [] },
      },
    ],
  });

  assert.equal(projected.schemaVersion, 1);
  assert.equal(projected.tasks.length, 1);
  assert.deepEqual(projected.tasks[0], {
    id: 'M13.01',
    title: 'Desktop capability audit',
    milestone: 'M13',
    dependsOn: ['M12.05'],
    output: 'docs/roadmap/evidence/M13.01.md',
    detailFile: 'docs/roadmap/14-desktop-engineering.md',
    labels: ['desktop'],
    priority: 'p1',
    status: 'complete',
    evidence: 'docs/roadmap/evidence/M13.01.md',
  });
});

test('loadRoadmapIndexFromRevision prefers canonical TaskOS and falls back to historical roadmap index', () => {
  const fromCanonical = loadRoadmapIndexFromRevision((file) => {
    if (file === CANONICAL_TASKS_RELATIVE_PATH) {
      return JSON.stringify({
        tasks: [
          {
            code: 'M0.01',
            series: 'M',
            milestone: 'M0',
            title: 'Canonical record',
            proposedSolution: 'out.md',
            status: 'done',
            dependsOn: [],
            evidence: {
              detailFile: 'docs/roadmap/01-x.md',
              paths: ['docs/roadmap/evidence/M0.01.md'],
            },
          },
        ],
      });
    }
    throw new Error('unexpected legacy read');
  });
  assert.equal(fromCanonical.tasks[0]?.title, 'Canonical record');

  const fromLegacy = loadRoadmapIndexFromRevision((file) => {
    if (file === CANONICAL_TASKS_RELATIVE_PATH) throw new Error('not on old commit');
    return JSON.stringify({ tasks: [{ id: 'M0.01', title: 'Legacy commit record' }] });
  });
  assert.equal(fromLegacy.tasks[0]?.title, 'Legacy commit record');
});

test('live canonical docs/tasks/tasks.json projects roadmap tasks cleanly and has zero duplicate task JSONs', async () => {
  const { index } = await loadCanonicalRoadmapIndex(repositoryRoot);
  assert.ok(index.tasks.length >= 200);
  const duplicates = await findDuplicateTaskJsonFiles(repositoryRoot);
  assert.deepEqual(duplicates, []);
});

test('findDuplicateTaskJsonFiles flags duplicate task.json or tasks.json outside canonical path', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mw-taskos-single-'));
  try {
    await mkdir(path.join(tempRoot, 'docs/tasks'), { recursive: true });
    await mkdir(path.join(tempRoot, 'docs/roadmap'), { recursive: true });
    await mkdir(path.join(tempRoot, 'docs/bundles/pack'), { recursive: true });
    await writeFile(path.join(tempRoot, 'docs/tasks/tasks.json'), '{"tasks":[]}');
    await writeFile(path.join(tempRoot, 'docs/roadmap/tasks.json'), '{"tasks":[]}');
    await writeFile(path.join(tempRoot, 'docs/bundles/pack/task.json'), '{"tasks":[]}');
    await writeFile(path.join(tempRoot, 'task.json'), '{"tasks":[]}');

    const duplicates = await findDuplicateTaskJsonFiles(tempRoot);
    assert.deepEqual(duplicates, [
      'docs/bundles/pack/task.json',
      'docs/roadmap/tasks.json',
      'task.json',
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
