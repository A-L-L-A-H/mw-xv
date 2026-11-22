import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTaskRegistryData } from './validate-tasks.mjs';
import { AUDIT_TASKS } from './sources/audit-tasks.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');



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
    const horizon = isChecked ? 'now' : t.milestone?.startsWith('M1') || t.milestone?.startsWith('K1') ? 'now' : 'next';

    addTask({
      code: t.id,
      project: 'moonwitness',
      series,
      milestone: t.milestone ?? null,
      horizon,
      title: t.title,
      summary: t.title.slice(0, 140),
      problem: `Roadmap requirement defined in ${t.detailFile ?? 'ROADMAP.md'}`,
      proposedSolution: t.output ?? 'Implement verified deliverable according to roadmap specification.',
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
        { id: `${t.id}-ac-1`, text: t.output ?? 'Deliverable accepted', done: isChecked }
      ],
      validation: {
        commands: ['pnpm verify'],
        expected: 'All acceptance criteria and evidence proven'
      },
      evidence: {
        paths: t.evidence ? [t.evidence] : [],
        detailFile: t.detailFile ?? null,
        commitSha: null
      },
      references: t.detailFile ? [t.detailFile] : [],
      blockedReason: status === 'blocked' ? 'Awaiting upstream dependency or CODEOWNER gate' : null,
      sourceRef: { file: 'docs/roadmap/tasks.json', legacyId: t.id },
      url: '',
      comments: []
    });
  }

  // 2. Ingest Audit Tasks (AUD-001..AUD-014)
  for (const aud of AUDIT_TASKS) {
    addTask(aud);
  }

  // 3. Ingest todo-wa.md (WhatsApp checklist)
  const todoWaPath = path.join(rootDir, 'todo-wa.md');
  try {
    const waText = await fs.readFile(todoWaPath, 'utf8');
    for (const line of waText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(P[0-3]-\d+)\*\*\s+(.*)$/.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        const rawCode = match[2];
        const title = match[3].trim();
        const code = `WA-${rawCode}`;
        const prio = rawCode.startsWith('P0') ? 'p0' : rawCode.startsWith('P1') ? 'p1' : rawCode.startsWith('P2') ? 'p2' : 'p3';

        addTask({
          code,
          project: 'moonwitness',
          series: 'WA',
          milestone: 'WHATSAPP',
          horizon: isDone ? 'now' : prio === 'p0' ? 'now' : 'next',
          title,
          summary: title.slice(0, 140),
          problem: `WhatsApp gateway requirement: ${title}`,
          proposedSolution: 'Verify and integrate GoWA gateway functionality according to specification.',
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
          acceptanceCriteria: [
            { id: `${code}-ac-1`, text: title, done: isDone }
          ],
          validation: {
            commands: ['pnpm test:whatsapp'],
            expected: 'WhatsApp gateway test suites pass'
          },
          evidence: { paths: [], detailFile: 'todo-wa.md', commitSha: null },
          references: ['docs/operations/whatsapp.md'],
          blockedReason: null,
          sourceRef: { file: 'todo-wa.md', legacyId: rawCode },
          url: '',
          comments: []
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to ingest required WhatsApp task source "${todoWaPath}": ${error.message}`, { cause: error });
  }

  // Root todo.md is a navigation pointer. Verify it remains a pointer and never parse it as a backlog.
  const rootTodoPath = path.join(rootDir, 'todo.md');
  const rootTodoText = await fs.readFile(rootTodoPath, 'utf8');
  if (!rootTodoText.includes('docs/tasks/tasks.json')) {
    throw new Error('Root todo.md must remain a pointer to the canonical TaskOS registry.');
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
        proposedSolution: 'Revalidate against current repository state and promote to an active roadmap/card only when still required.',
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
          { id: `${code}-ac-1`, text: 'Current relevance and ownership are revalidated.', done: false }
        ],
        validation: { commands: ['pnpm automation:check:roadmap'], expected: 'Task is mapped to an active source or explicitly retired.' },
        evidence: { paths: [], detailFile: 'docs/archive/todos/todo.md', commitSha: null },
        references: ['docs/archive/todos/todo.md'],
        blockedReason: 'Archived legacy backlog item; requires owner revalidation before execution.',
        sourceRef: { file: 'docs/archive/todos/todo.md', legacyId: code },
        url: '',
        comments: []
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required archived legacy TODO source "${legacyTodoPath}": ${error.message}`, { cause: error });
  }

  // Import the AI Corporation PR lifecycle IDs. Only PR.14 is still open and is a human approval gate.
  const aiCorporationTodoPath = path.join(
    rootDir,
    'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md'
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
        proposedSolution: 'Complete the approval/evidence requirement through the protected repository workflow.',
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
        acceptanceCriteria: [
          { id: `${code}-ac-1`, text: title, done: isDone }
        ],
        validation: { commands: ['pnpm promotion:approval-check'], expected: 'Required maintainer approval is present on the exact promotion candidate.' },
        evidence: { paths: [], detailFile: 'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md', commitSha: null },
        references: ['docs/roadmap/evidence/M12.14.md'],
        blockedReason: isDone ? null : 'Maintainer approval is an explicit human gate; automation must not self-approve.',
        sourceRef: { file: 'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md', legacyId: code },
        url: '',
        comments: []
      });
    }
    if (!importedApprovalCodes.has('PR.14')) {
      throw new Error('AI Corporation source is missing the expected PR.14 maintainer-approval gate.');
    }
  } catch (error) {
    throw new Error(`Failed to ingest required AI Corporation task source "${aiCorporationTodoPath}": ${error.message}`, { cause: error });
  }

  // 5. Ingest todo-desktop.md
  try {
    const dskText = await fs.readFile(path.join(rootDir, 'todo-desktop.md'), 'utf8');
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
          evidence: { paths: [], detailFile: 'todo-desktop.md', commitSha: null },
          references: [],
          blockedReason: null,
          sourceRef: { file: 'todo-desktop.md', legacyId: code },
          url: '',
          comments: []
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to ingest required Desktop task source todo-desktop.md: ${error.message}`, { cause: error });
  }

  // 6. Ingest evolution/backlog.json
  try {
    const evoText = await fs.readFile(path.join(rootDir, 'evolution/backlog.json'), 'utf8');
    const evo = JSON.parse(evoText);
    for (const candidate of evo.candidates ?? []) {
      const isDone = candidate.status === 'completed';
      const status = isDone ? 'done' : candidate.status === 'active' ? 'doing' : 'todo';
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
        priority: candidate.priority === 'high' ? 'p0' : candidate.priority === 'medium' ? 'p1' : 'p2',
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
        validation: { commands: candidate.acceptanceCheck ? [candidate.acceptanceCheck] : [], expected: 'Pass' },
        evidence: { paths: [], detailFile: 'evolution/backlog.json', commitSha: null },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'evolution/backlog.json', legacyId: candidate.id },
        url: '',
        comments: []
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required evolution source evolution/backlog.json: ${error.message}`, { cause: error });
  }

  // Import the scoped Visual Universe execution graph without losing its
  // project-specific fields. The global TaskOS record owns lifecycle state;
  // metadata is retained for the generated work-package mirror.
  const visualPackPath = path.join(
    rootDir,
    'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/legacy/task-source-2026-11-23.json'
  );
  try {
    const visualPack = JSON.parse(await fs.readFile(visualPackPath, 'utf8'));
    if (!Array.isArray(visualPack.tasks) || visualPack.tasks.length === 0) {
      throw new Error('Visual Universe task.json has no task records.');
    }
    for (const sourceTask of visualPack.tasks) {
      const statusMap = {
        todo: 'todo',
        in_progress: 'doing',
        blocked: 'blocked',
        done: 'done',
        skipped: 'done'
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
          done: isComplete
        })),
        validation: {
          commands: sourceTask.verification ?? [],
          expected: 'All delegated work-package acceptance criteria are met.'
        },
        evidence: {
          paths: [...new Set((sourceTask.evidence ?? []).map((entry) => entry.artifact).filter(Boolean))],
          detailFile: `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tasks/${sourceTask.phase}/${sourceTask.id}.md`,
          commitSha: sourceTask.commit ?? null
        },
        references: sourceTask.scope_hints ?? [],
        blockedReason: sourceTask.status === 'blocked'
          ? sourceTask.notes || 'Blocked in the delegated Visual Universe work package.'
          : null,
        sourceRef: {
          file: 'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/legacy/task-source-2026-11-23.json',
          legacyId: sourceTask.id
        },
        url: '',
        comments: [],
        metadata: sourceTask
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required Visual Universe task source "${visualPackPath}": ${error.message}`, { cause: error });
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
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      },
      {
        slug: 'visual-universe',
        name: 'MoonWitness Visual Universe',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'purple',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      }
    ],
    tasks
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const targetFile = path.join(rootDir, 'docs/tasks/tasks.json');
    const checkOnly = process.argv.includes('--check');
    const writeEnabled = process.argv.includes('--write');
    if (checkOnly && writeEnabled) {
      throw new Error('Choose only one mode: --check or --write.');
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
        throw new Error('TaskOS registry is empty; --check cannot compare against an unavailable canonical registry.');
      }
      generatedAt = JSON.parse(currentRaw).generatedAt;
      if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
        throw new Error('TaskOS registry has no valid generatedAt timestamp for deterministic comparison.');
      }
    }

    const result = await sweepAndConsolidate(
      checkOnly ? { generatedAt } : {}
    );
    const validation = await validateTaskRegistryData(result);
    if (!validation.valid) {
      throw new Error(
        [
          `Refusing TaskOS projection with ${validation.errors.length} validation error(s):`,
          ...validation.errors.map((error) => `- ${error}`),
        ].join('\n')
      );
    }
    const output = `${JSON.stringify(result, null, 2)}\n`;

    if (checkOnly) {
      const currentRaw = await fs.readFile(targetFile, 'utf8');
      if (currentRaw !== output) {
        throw new Error('TaskOS registry differs from deterministic source projection. Review the source inventory before writing.');
      }
      console.log(`TaskOS source projection matches ${result.tasks.length} tasks.`);
      return;
    }

    if (!writeEnabled) {
      console.log(`Dry run: source inventory resolves to ${result.tasks.length} task records. No files changed. Use --write only after reviewing the source inventory.`);
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
