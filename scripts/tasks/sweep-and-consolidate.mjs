import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { validateTaskRegistryData } from './validate-tasks.mjs';
import { AUDIT_TASKS } from './sources/audit-tasks.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prettierConfig = await prettier.resolveConfig(fileURLToPath(import.meta.url), {
  editorconfig: true,
});

export function mapEvolutionStatus(sourceStatus) {
  if (sourceStatus === 'completed') return 'done';
  if (sourceStatus === 'active') return 'doing';
  throw new Error(
    `Unsupported evolution backlog status "${sourceStatus}". Add an explicit mapping before importing.`
  );
}

export async function sweepAndConsolidate({
  generatedAt = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString(),
} = {}) {
  const tasks = [];
  const tasksByCode = new Map();

  function addTask(task) {
    if (!task || typeof task.code !== 'string' || !task.code.trim()) {
      throw new Error('TaskOS source produced a record without a stable task code.');
    }
    const existing = tasksByCode.get(task.code);
    if (existing) {
      throw new Error(
        `Duplicate TaskOS code "${task.code}" from "${existing.sourceRef?.file ?? 'unknown source'}" and "${task.sourceRef?.file ?? 'unknown source'}". Reconcile the source owners before generating the canonical registry.`
      );
    }
    tasksByCode.set(task.code, task);
    tasks.push(task);
    return true;
  }

  // 1. Ingest the authoritative M/K roadmap index and ROADMAP.md checklist (239 tasks).
  const roadmapTasksRaw = await fs.readFile(path.join(rootDir, 'docs/roadmap/tasks.json'), 'utf8');
  const roadmapTasks = JSON.parse(roadmapTasksRaw).tasks;
  const roadmapText = await fs.readFile(path.join(rootDir, 'ROADMAP.md'), 'utf8');

  const roadmapCheckState = new Map();
  for (const line of roadmapText.split(/\r?\n/)) {
    const match = /^\s*-\s*\[([ xX])\]\s+([A-Za-z0-9_.-]+)\b/.exec(line);
    if (match) {
      roadmapCheckState.set(match[2], match[1].toLowerCase() === 'x');
    }
  }

  for (const t of roadmapTasks) {
    const isChecked = roadmapCheckState.get(t.id) ?? false;
    let status = 'todo';
    if (isChecked) {
      status = 'done';
    } else if (t.status === 'in_progress') {
      status = 'doing';
    } else if (t.status === 'blocked') {
      status = 'blocked';
    }

    const series = t.id.startsWith('M') ? 'M' : t.id.startsWith('K') ? 'K' : 'ROADMAP';
    const horizon = isChecked
      ? 'now'
      : t.milestone?.startsWith('M1') || t.milestone?.startsWith('K1')
        ? 'now'
        : 'next';

    addTask({
      code: t.id,
      project: 'moonwitness',
      series,
      milestone: t.milestone ?? null,
      horizon,
      title: t.title,
      summary: t.title.slice(0, 140),
      problem: `Roadmap requirement defined in ${t.detailFile ?? 'ROADMAP.md'}`,
      proposedSolution:
        t.output ?? 'Implement verified deliverable according to roadmap specification.',
      category: series === 'K' ? 'research' : 'architecture',
      type: 'feature',
      priority: t.priority ?? 'p1',
      status,
      human: Boolean(t.id === 'M1.08' || t.id.startsWith('M8.03') || t.id.startsWith('M10.03')),
      owner: t.assignee ?? null,
      assignee: t.assignee ?? null,
      risk: 'medium',
      effort: 'm',
      scores: null,
      dependsOn: t.dependsOn ?? [],
      blocks: [],
      tags: [series.toLowerCase(), ...(t.labels ?? [])],
      scope: { packages: [], files: [] },
      acceptanceCriteria: [
        { id: `${t.id}-ac-1`, text: t.output ?? 'Deliverable accepted', done: isChecked },
      ],
      validation: {
        commands: ['pnpm verify'],
        expected: 'All acceptance criteria and evidence proven',
      },
      evidence: {
        paths: t.evidence ? [t.evidence] : [],
        detailFile: t.detailFile ?? null,
        commitSha: null,
      },
      references: t.detailFile ? [t.detailFile] : [],
      blockedReason: status === 'blocked' ? 'Awaiting upstream dependency or CODEOWNER gate' : null,
      sourceRef: { file: 'docs/roadmap/tasks.json', legacyId: t.id },
      url: '',
      comments: [],
    });
  }

  // 2. Ingest Audit Tasks (AUD-001..AUD-024)
  for (const aud of AUDIT_TASKS) {
    addTask(aud);
  }

  // 3. Ingest docs/tasks/sources/todo-wa.md (WhatsApp checklist)
  const todoWaPath = path.join(rootDir, 'docs/tasks/sources/todo-wa.md');
  try {
    const waText = await fs.readFile(todoWaPath, 'utf8');
    for (const line of waText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(P[0-3]-\d+)\*\*\s+(.*)$/.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        const rawCode = match[2];
        const title = match[3].trim();
        const code = `WA-${rawCode}`;
        const prio = rawCode.startsWith('P0')
          ? 'p0'
          : rawCode.startsWith('P1')
            ? 'p1'
            : rawCode.startsWith('P2')
              ? 'p2'
              : 'p3';

        addTask({
          code,
          project: 'moonwitness',
          series: 'WA',
          milestone: 'WHATSAPP',
          horizon: isDone ? 'now' : prio === 'p0' ? 'now' : 'next',
          title,
          summary: title.slice(0, 140),
          problem: `WhatsApp gateway requirement: ${title}`,
          proposedSolution:
            'Verify and integrate GoWA gateway functionality according to specification.',
          category: 'product',
          type: 'feature',
          priority: prio,
          status: isDone ? 'done' : 'todo',
          human: false,
          owner: 'wa-team',
          assignee: null,
          risk: 'medium',
          effort: 'm',
          scores: null,
          dependsOn: [],
          blocks: [],
          tags: ['whatsapp', 'gowa', prio],
          scope: { packages: ['@moonwitness/orm-whatsapp', '@moonwitness/api'], files: [] },
          acceptanceCriteria: [{ id: `${code}-ac-1`, text: title, done: isDone }],
          validation: {
            commands: ['pnpm test:whatsapp'],
            expected: 'WhatsApp gateway test suites pass',
          },
          evidence: { paths: [], detailFile: 'docs/tasks/sources/todo-wa.md', commitSha: null },
          references: ['docs/operations/whatsapp.md'],
          blockedReason: null,
          sourceRef: { file: 'docs/tasks/sources/todo-wa.md', legacyId: rawCode },
          url: '',
          comments: [],
        });
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required WhatsApp task source "${todoWaPath}": ${error.message}`,
      { cause: error }
    );
  }

  // Root docs/tasks/sources/todo.md is a navigation pointer. Verify it remains a pointer and never parse it as a backlog.
  const rootTodoPath = path.join(rootDir, 'docs/tasks/sources/todo.md');
  const rootTodoText = await fs.readFile(rootTodoPath, 'utf8');
  if (!rootTodoText.includes('docs/tasks/tasks.json')) {
    throw new Error('Root docs/tasks/sources/todo.md must remain a pointer to the canonical TaskOS registry.');
  }

  // Import only unchecked records from the archived MW checklist. They remain blocked until re-triaged.
  const legacyTodoPath = path.join(rootDir, 'docs/archive/todos/todo.md');
  try {
    const legacyTodoText = await fs.readFile(legacyTodoPath, 'utf8');
    for (const line of legacyTodoText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[ \]\s+\*\*(MW-[A-Za-z0-9_.-]+)\*\*\s+(.*)$/.exec(line);
      if (!match) continue;
      const code = match[1];
      const title = match[2].trim();
      addTask({
        code,
        project: 'moonwitness',
        series: 'MW',
        milestone: 'LEGACY-TRIAGE',
        horizon: 'later',
        title,
        summary: title.slice(0, 140),
        problem: `Unchecked item retained in archived legacy TODO: ${title}`,
        proposedSolution:
          'Revalidate against current repository state and promote to an active roadmap/card only when still required.',
        category: 'governance',
        type: 'research',
        priority: 'p1',
        status: 'blocked',
        human: true,
        owner: 'repo-owner',
        assignee: null,
        risk: 'medium',
        effort: null,
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['legacy', 'archive', 'triage-required'],
        scope: { packages: [], files: [] },
        acceptanceCriteria: [
          {
            id: `${code}-ac-1`,
            text: 'Current relevance and ownership are revalidated.',
            done: false,
          },
        ],
        validation: {
          commands: ['pnpm automation:check:roadmap'],
          expected: 'Task is mapped to an active source or explicitly retired.',
        },
        evidence: { paths: [], detailFile: 'docs/archive/todos/todo.md', commitSha: null },
        references: ['docs/archive/todos/todo.md'],
        blockedReason:
          'Archived legacy backlog item; requires owner revalidation before execution.',
        sourceRef: { file: 'docs/archive/todos/todo.md', legacyId: code },
        url: '',
        comments: [],
      });
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required archived legacy TODO source "${legacyTodoPath}": ${error.message}`,
      { cause: error }
    );
  }

  // Import the AI Corporation PR lifecycle IDs. Only PR.14 is still open and is a human approval gate.
  const aiCorporationTodoPath = path.join(
    rootDir,
    'docs/bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md'
  );
  try {
    const aiTodoText = await fs.readFile(aiCorporationTodoPath, 'utf8');
    const importedApprovalCodes = new Set();
    for (const line of aiTodoText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(PR\.\d+)\*\*\s+(.*)$/.exec(line);
      if (!match) continue;
      const isDone = match[1].toLowerCase() === 'x';
      const code = match[2];
      const title = match[3].trim();
      importedApprovalCodes.add(code);
      addTask({
        code,
        project: 'moonwitness',
        series: 'PR',
        milestone: 'PROMOTION-GOVERNANCE',
        horizon: 'now',
        title,
        summary: title.slice(0, 140),
        problem: 'Promotion governance requirement recorded in the AI Corporation checklist.',
        proposedSolution:
          'Complete the approval/evidence requirement through the protected repository workflow.',
        category: 'governance',
        type: 'documentation',
        priority: 'p0',
        status: isDone ? 'done' : 'blocked',
        human: true,
        owner: 'repo-owner',
        assignee: null,
        risk: 'high',
        effort: 'xs',
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['governance', 'promotion', 'ai-corporation'],
        scope: { packages: [], files: ['.github/workflows/promote.yml'] },
        acceptanceCriteria: [{ id: `${code}-ac-1`, text: title, done: isDone }],
        validation: {
          commands: ['pnpm promotion:approval-check'],
          expected: 'Required maintainer approval is present on the exact promotion candidate.',
        },
        evidence: {
          paths: [],
          detailFile: 'docs/bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md',
          commitSha: null,
        },
        references: ['docs/roadmap/evidence/M12.14.md'],
        blockedReason: isDone
          ? null
          : 'Maintainer approval is an explicit human gate; automation must not self-approve.',
        sourceRef: {
          file: 'docs/bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md',
          legacyId: code,
        },
        url: '',
        comments: [],
      });
    }
    if (!importedApprovalCodes.has('PR.14')) {
      throw new Error(
        'AI Corporation source is missing the expected PR.14 maintainer-approval gate.'
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required AI Corporation task source "${aiCorporationTodoPath}": ${error.message}`,
      { cause: error }
    );
  }

  // 5. Ingest docs/tasks/sources/todo-desktop.md
  try {
    const dskText = await fs.readFile(path.join(rootDir, 'docs/tasks/sources/todo-desktop.md'), 'utf8');
    for (const line of dskText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(DSK-[0-9.]+)\*\*\s+(.*)$/.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        const code = match[2];
        const title = match[3].trim();
        addTask({
          code,
          project: 'moonwitness',
          series: 'DSK',
          milestone: 'DESKTOP',
          horizon: isDone ? 'now' : 'next',
          title,
          summary: title.slice(0, 140),
          problem: title,
          proposedSolution: 'Complete desktop engineering track deliverable.',
          category: 'dx',
          type: 'feature',
          priority: 'p2',
          status: isDone ? 'done' : 'todo',
          human: false,
          owner: 'desktop-team',
          assignee: null,
          risk: 'low',
          effort: 's',
          scores: null,
          dependsOn: [],
          blocks: [],
          tags: ['desktop', 'tauri'],
          scope: { packages: ['@moonwitness/desktop'], files: [] },
          acceptanceCriteria: [{ id: `${code}-ac-1`, text: title, done: isDone }],
          validation: { commands: ['pnpm --filter @moonwitness/desktop test'], expected: 'Pass' },
          evidence: { paths: [], detailFile: 'docs/tasks/sources/todo-desktop.md', commitSha: null },
          references: [],
          blockedReason: null,
          sourceRef: { file: 'docs/tasks/sources/todo-desktop.md', legacyId: code },
          url: '',
          comments: [],
        });
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required Desktop task source docs/tasks/sources/todo-desktop.md: ${error.message}`,
      { cause: error }
    );
  }

  // 6. Ingest evolution/backlog.json
  try {
    const evoText = await fs.readFile(path.join(rootDir, 'evolution/backlog.json'), 'utf8');
    const evo = JSON.parse(evoText);
    if (!Array.isArray(evo.candidates) || evo.candidates.length !== 4) {
      throw new Error('Evolution backlog must contain exactly four reviewed candidate records.');
    }
    for (const candidate of evo.candidates) {
      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !candidate.id.trim() ||
        typeof candidate.title !== 'string' ||
        !candidate.title.trim()
      ) {
        throw new Error('Evolution backlog contains a record without a stable ID and title.');
      }
      const status = mapEvolutionStatus(candidate.status);
      const isDone = status === 'done';
      addTask({
        code: candidate.id,
        project: 'moonwitness',
        series: 'EVO',
        milestone: 'EVOLUTION',
        horizon: isDone ? 'now' : 'now',
        title: candidate.title,
        summary: candidate.title.slice(0, 140),
        problem: candidate.title,
        proposedSolution: 'Fulfill architecture evolution requirement.',
        category: 'architecture',
        type: 'refactor',
        priority:
          candidate.priority === 'high' ? 'p0' : candidate.priority === 'medium' ? 'p1' : 'p2',
        status,
        human: false,
        owner: 'core-team',
        assignee: null,
        risk: 'low',
        effort: 's',
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['evolution', candidate.category ?? 'architecture'],
        scope: { packages: [], files: candidate.targetFiles ?? [] },
        acceptanceCriteria: [{ id: `${candidate.id}-ac-1`, text: candidate.title, done: isDone }],
        validation: {
          commands: candidate.acceptanceCheck ? [candidate.acceptanceCheck] : [],
          expected: 'Pass',
        },
        evidence: { paths: [], detailFile: 'evolution/backlog.json', commitSha: null },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'evolution/backlog.json', legacyId: candidate.id },
        url: '',
        comments: [],
      });
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required evolution source evolution/backlog.json: ${error.message}`,
      { cause: error }
    );
  }

  // Import the scoped Visual Universe execution graph without losing its
  // project-specific fields. The global TaskOS record owns lifecycle state;
  // metadata is retained for the generated work-package mirror.
  const visualPackPath = path.join(
    rootDir,
    'docs/bundles/visual-universe-pack/legacy/task-source-2026-11-23.json'
  );
  try {
    const visualPack = JSON.parse(await fs.readFile(visualPackPath, 'utf8'));
    if (!Array.isArray(visualPack.tasks) || visualPack.tasks.length === 0) {
      throw new Error('Visual Universe immutable task snapshot has no task records.');
    }

    const visualCardNotesPath = path.join(
      rootDir,
      'docs/bundles/visual-universe-pack/legacy/task-cards-2026-11-23/notes-addendum.json'
    );
    const visualCardNotes = JSON.parse(await fs.readFile(visualCardNotesPath, 'utf8'));
    if (
      visualCardNotes.snapshot !== 'visual-universe-task-card-notes-addendum/2026-11-23' ||
      !Array.isArray(visualCardNotes.entries)
    ) {
      throw new Error('Visual Universe task-card notes addendum has an unsupported format.');
    }

    const visualTaskIds = new Set(visualPack.tasks.map((task) => task.id));
    const visualCardArchiveManifestPath = path.join(
      rootDir,
      'docs/bundles/visual-universe-pack/legacy/task-cards-2026-11-23/manifest.json'
    );
    const visualCardArchiveManifest = JSON.parse(
      await fs.readFile(visualCardArchiveManifestPath, 'utf8')
    );
    if (
      visualCardArchiveManifest.snapshot !== 'visual-universe-task-cards/2026-11-23' ||
      visualCardArchiveManifest.entryCount !== visualPack.tasks.length ||
      !Array.isArray(visualCardArchiveManifest.chunks)
    ) {
      throw new Error(
        'Visual Universe task-card archive manifest is missing, malformed or has the wrong record count.'
      );
    }
    if (
      visualCardNotes.sourceSnapshot !==
      'docs/bundles/visual-universe-pack/legacy/task-cards-2026-11-23/manifest.json'
    ) {
      throw new Error(
        'Visual Universe task-card notes addendum points to an unexpected archive manifest.'
      );
    }

    const archivedCardsByPath = new Map();
    for (const chunk of visualCardArchiveManifest.chunks) {
      if (
        typeof chunk.path !== 'string' ||
        path.isAbsolute(chunk.path) ||
        chunk.path.split(/[\\/]+/u).includes('..')
      ) {
        throw new Error('Visual Universe task-card archive contains an unsafe chunk path.');
      }
      const chunkPath = path.join(rootDir, chunk.path);
      const chunkData = JSON.parse(await fs.readFile(chunkPath, 'utf8'));
      if (
        chunkData.snapshot !== visualCardArchiveManifest.snapshot ||
        !Array.isArray(chunkData.entries)
      ) {
        throw new Error(
          `Visual Universe task-card archive chunk "${chunk.path}" has an invalid format.`
        );
      }
      for (const card of chunkData.entries) {
        if (
          typeof card.path !== 'string' ||
          typeof card.content !== 'string' ||
          typeof card.blobSha !== 'string'
        ) {
          throw new Error(
            `Visual Universe task-card archive chunk "${chunk.path}" has a malformed entry.`
          );
        }
        const actualBlobSha = createHash('sha1')
          .update(`blob ${Buffer.byteLength(card.content, 'utf8')}\0`)
          .update(card.content, 'utf8')
          .digest('hex');
        if (actualBlobSha !== card.blobSha) {
          throw new Error(
            `Archived task card "${card.path}" does not match its recorded Git blob SHA.`
          );
        }
        if (archivedCardsByPath.has(card.path)) {
          throw new Error(`Duplicate archived Visual Universe task-card path "${card.path}".`);
        }
        archivedCardsByPath.set(card.path, card);
      }
    }
    if (archivedCardsByPath.size !== visualCardArchiveManifest.entryCount) {
      throw new Error(
        `Visual Universe task-card archive expected ${visualCardArchiveManifest.entryCount} cards, found ${archivedCardsByPath.size}.`
      );
    }

    for (const sourceTask of visualPack.tasks) {
      const expectedCardPath = `docs/bundles/visual-universe-pack/tasks/${sourceTask.phase}/${sourceTask.id}.md`;
      if (!archivedCardsByPath.has(expectedCardPath)) {
        throw new Error(
          `Immutable Visual Universe task-card archive is missing "${expectedCardPath}".`
        );
      }
    }

    const visualCardNotesByTask = new Map();
    for (const note of visualCardNotes.entries) {
      if (!visualTaskIds.has(note.taskId)) {
        throw new Error(
          `Task-card notes addendum references unknown Visual Universe task "${note.taskId}".`
        );
      }
      if (visualCardNotesByTask.has(note.taskId)) {
        throw new Error(`Duplicate task-card notes addendum entry for "${note.taskId}".`);
      }
      if (
        typeof note.text !== 'string' ||
        !note.text.trim() ||
        typeof note.sourcePath !== 'string' ||
        typeof note.sourceBlobSha !== 'string' ||
        !/^[a-f0-9]{40}$/u.test(note.sourceBlobSha)
      ) {
        throw new Error(
          `Task-card notes addendum entry for "${note.taskId}" has invalid provenance or text.`
        );
      }
      const archivedCard = archivedCardsByPath.get(note.sourcePath);
      if (!archivedCard || archivedCard.blobSha !== note.sourceBlobSha) {
        throw new Error(
          `Task-card note provenance for "${note.taskId}" does not match the immutable card archive.`
        );
      }
      const originalNote = (
        archivedCard.content.match(/^## Notes\s*\n([\s\S]*)$/m)?.[1] ?? ''
      ).trim();
      if (originalNote !== note.text.trim()) {
        throw new Error(
          `Task-card note text for "${note.taskId}" differs from its immutable card archive.`
        );
      }
      visualCardNotesByTask.set(note.taskId, note);
    }

    for (const sourceTask of visualPack.tasks) {
      const statusMap = {
        todo: 'todo',
        in_progress: 'doing',
        blocked: 'blocked',
        done: 'done',
        skipped: 'done',
      };
      if (!statusMap[sourceTask.status]) {
        throw new Error(`Unsupported status "${sourceTask.status}" for ${sourceTask.id}.`);
      }
      const isComplete = sourceTask.status === 'done' || sourceTask.status === 'skipped';
      const tags = ['visual-universe', sourceTask.phase, sourceTask.role].filter(Boolean);
      if (sourceTask.status === 'skipped') tags.push('status:skipped');
      addTask({
        code: sourceTask.id,
        project: 'visual-universe',
        series: sourceTask.phase,
        milestone: sourceTask.phase,
        horizon: 'later',
        title: sourceTask.title,
        summary: (sourceTask.objective ?? sourceTask.title).slice(0, 140),
        problem: sourceTask.objective ?? sourceTask.title,
        proposedSolution: (sourceTask.deliverables ?? []).join('; '),
        category: 'other',
        type: 'other',
        priority: sourceTask.priority === 'P0' ? 'p0' : 'p1',
        status: statusMap[sourceTask.status],
        human: sourceTask.human_approval_required === true,
        owner: sourceTask.role ?? null,
        assignee: null,
        risk: sourceTask.risk ?? null,
        effort: null,
        scores: null,
        dependsOn: sourceTask.depends_on ?? [],
        blocks: [],
        tags,
        scope: { packages: [], files: sourceTask.scope_hints ?? [] },
        acceptanceCriteria: (sourceTask.acceptance_criteria ?? []).map((text, index) => ({
          id: `${sourceTask.id}-ac-${index + 1}`,
          text,
          done: isComplete,
        })),
        validation: {
          commands: sourceTask.verification ?? [],
          expected: 'All delegated work-package acceptance criteria are met.',
        },
        evidence: {
          paths: [
            ...new Set((sourceTask.evidence ?? []).map((entry) => entry.artifact).filter(Boolean)),
          ],
          detailFile: `docs/bundles/visual-universe-pack/tasks/${sourceTask.phase}/${sourceTask.id}.md`,
          commitSha: sourceTask.commit ?? null,
        },
        references: sourceTask.scope_hints ?? [],
        blockedReason:
          sourceTask.status === 'blocked'
            ? sourceTask.notes || 'Blocked in the delegated Visual Universe work package.'
            : null,
        sourceRef: {
          file: 'docs/bundles/visual-universe-pack/legacy/task-source-2026-11-23.json',
          legacyId: sourceTask.id,
        },
        url: '',
        comments: [],
        metadata: {
          ...sourceTask,
          legacyCardNotes: visualCardNotesByTask.has(sourceTask.id)
            ? {
                text: visualCardNotesByTask.get(sourceTask.id).text,
                sourceFile: visualCardNotesByTask.get(sourceTask.id).sourcePath,
                sourceBlobSha: visualCardNotesByTask.get(sourceTask.id).sourceBlobSha,
              }
            : null,
        },
      });
    }
  } catch (error) {
    throw new Error(
      `Failed to ingest required Visual Universe task source "${visualPackPath}": ${error.message}`,
      { cause: error }
    );
  }

  // Populate reverse blocks graph
  const codeSet = new Set(tasks.map((t) => t.code));
  const blocksMap = new Map();
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (codeSet.has(dep)) {
        if (!blocksMap.has(dep)) blocksMap.set(dep, []);
        blocksMap.get(dep).push(t.code);
      }
    }
  }
  for (const t of tasks) {
    if (blocksMap.has(t.code)) {
      const merged = new Set([...t.blocks, ...blocksMap.get(t.code)]);
      t.blocks = [...merged];
    }
  }

  return {
    schemaVersion: '2.0.0',
    format: 'moonwitness-tasks/v2',
    generatedAt,
    projects: [
      {
        slug: 'moonwitness',
        name: 'MoonWitness Enterprise Platform',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'blue',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done'],
      },
      {
        slug: 'visual-universe',
        name: 'MoonWitness Visual Universe',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'purple',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done'],
      },
    ],
    tasks,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const targetFile = path.join(rootDir, 'docs/tasks/tasks.json');
    const checkOnly = process.argv.includes('--check');
    const writeEnabled = process.argv.includes('--write');
    const candidateIndex = process.argv.indexOf('--candidate');
    const candidateArgument = candidateIndex >= 0 ? process.argv[candidateIndex + 1] : undefined;

    if (checkOnly && writeEnabled) {
      throw new Error('Choose only one mode: --check or --write.');
    }
    if (candidateIndex >= 0 && (!candidateArgument || candidateArgument.startsWith('--'))) {
      throw new Error('--candidate requires an output path outside the repository.');
    }
    if (candidateIndex >= 0 && (checkOnly || writeEnabled)) {
      throw new Error('Use --candidate, --check, or --write as separate modes.');
    }

    const candidateFile = candidateArgument ? path.resolve(candidateArgument) : undefined;
    if (candidateFile) {
      const relativeCandidate = path.relative(rootDir, candidateFile);
      if (
        candidateFile === targetFile ||
        (!relativeCandidate.startsWith('..') && !path.isAbsolute(relativeCandidate))
      ) {
        throw new Error(
          'TaskOS candidate output must be outside the repository; the canonical registry is never a CI scratch file.'
        );
      }
    }

    if (writeEnabled) {
      const existingRaw = await fs.readFile(targetFile, 'utf8');
      if (existingRaw.trim()) {
        throw new Error(
          'Refusing to overwrite an existing TaskOS registry. This importer is for the one-time recovery of an empty registry; update task lifecycle through the canonical TaskOS workflow instead.'
        );
      }
    }

    let generatedAt;
    if (checkOnly) {
      const currentRaw = await fs.readFile(targetFile, 'utf8');
      if (!currentRaw.trim()) {
        throw new Error(
          'TaskOS registry is empty; --check cannot compare against an unavailable canonical registry.'
        );
      }
      generatedAt = JSON.parse(currentRaw).generatedAt;
      if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
        throw new Error(
          'TaskOS registry has no valid generatedAt timestamp for deterministic comparison.'
        );
      }
    }

    const result = await sweepAndConsolidate(checkOnly ? { generatedAt } : {});
    const validation = await validateTaskRegistryData(result);
    if (!validation.valid) {
      throw new Error(
        [
          `Refusing TaskOS projection with ${validation.errors.length} validation error(s):`,
          ...validation.errors.map((error) => `- ${error}`),
        ].join('\n')
      );
    }
    const output = await prettier.format(`${JSON.stringify(result, null, 2)}\n`, {
      ...prettierConfig,
      parser: 'json',
    });

    if (checkOnly) {
      const currentRaw = await fs.readFile(targetFile, 'utf8');
      if (currentRaw.replace(/\r\n/g, '\n') !== output) {
        throw new Error(
          'TaskOS registry differs from deterministic source projection. Review the source inventory before writing.'
        );
      }
      console.log(`TaskOS source projection matches ${result.tasks.length} tasks.`);
      return;
    }

    if (candidateFile) {
      await fs.mkdir(path.dirname(candidateFile), { recursive: true });
      await fs.writeFile(candidateFile, output, { encoding: 'utf8', flag: 'wx' });
      console.log(
        `Wrote ${result.tasks.length} validated TaskOS records to isolated candidate ${candidateFile}; canonical registry unchanged.`
      );
      return;
    }

    if (!writeEnabled) {
      console.log(
        `Dry run: source inventory resolves to ${result.tasks.length} task records. No files changed. Use --write only after reviewing the source inventory.`
      );
      return;
    }

    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, output, 'utf8');
    console.log(`Wrote ${result.tasks.length} validated TaskOS records to ${targetFile}`);
  })().catch((error) => {
    console.error('TaskOS source projection failed:', error);
    process.exit(1);
  });
}
