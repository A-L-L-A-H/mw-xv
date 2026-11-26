import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep as pathSep } from "node:path";
import type {
  LoadedPlanBundle,
  PlanManifest,
  WaveDefinition,
  PlanTaskIR,
  WaveFileRef,
  ManifestDocumentRef,
  DocumentNodeIR,
  TaskGovernance,
  TaskLifecycle,
  TaskGraph,
  TaskKnowledge,
  TaskVerification,
  TaskProjections,
  VerifyCommandIR,
  RepoIdentity,
} from "./types.js";
import { redactSensitiveText } from "./redaction.js";
import { normalizeRepoPath } from "./paths.js";

const TASK_HEADING_RE = /^##\s+(?:(?:-\s+)?\[[ xX]\]\s+)?([A-Z]\d{2,3})\b/;
const TASK_CHECKLIST_RE = /^[#\s]*-\s+\[[ xX]\]\s+(?:\*\*)?([A-Z]\d{2,3})(?:\*\*)?\s*—\s+(.+)$/;
const WAVE_PLAYBOOK_RE = /^wave-(\d+)-([a-z-]+)\.md$/i;
const SECTION_RE = /^##\s+(.+)$/;

interface ParsedLegacyTask {
  code: string;
  title: string;
  ownerFiles: string[];
  dependsOn: string[];
  spec: string;
  acceptanceCriteria: string[];
  verifyCommands: VerifyCommandIR[];
}

interface LegacyPlanData {
  planId: string;
  title: string;
  repo: RepoIdentity;
  tasks: Map<string, ParsedLegacyTask>;
  waveFiles: WaveFileRef[];
  documents: ManifestDocumentRef[];
}

function toPosix(path: string): string {
  return path.replaceAll(pathSep, "/");
}

function _stripPrefix(path: string, prefix: string): string {
  const posixPath = toPosix(path);
  const posixPrefix = toPosix(prefix);
  if (posixPath.startsWith(posixPrefix)) {
    return posixPath.slice(posixPrefix.length).replace(/^\/+/, "");
  }
  return posixPath;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractCodeFromHeading(line: string): string | null {
  const match = TASK_HEADING_RE.exec(line);
  return match ? match[1] : null;
}

async function parseLegacyPlan(content: string, planFilePath: string): Promise<LegacyPlanData> {
  const lines = content.split(/\r?\n/);
  const repoRoot = resolve(planFilePath, "..", "..");
  const tasks = new Map<string, ParsedLegacyTask>();
  let currentTask: ParsedLegacyTask | null = null;
  let _currentSection = "";
  let inTaskSpec = false;
  let planTitle = "";
  let planId = "";
  const repo: RepoIdentity = { org: "", name: "", target_branch: "main" };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!planTitle && /^#\s+/.test(trimmed)) {
      planTitle = trimmed.replace(/^#\s+/, "").trim();
      continue;
    }

    const planIdMatch = /^-\s+\*\*Plan ID:\*\*\s*`([^`]+)`/.exec(trimmed);
    if (planIdMatch && !planId) {
      planId = planIdMatch[1].trim();
      continue;
    }

    const sectionMatch = SECTION_RE.exec(trimmed);
    if (sectionMatch) {
      _currentSection = sectionMatch[1].trim();
      inTaskSpec = _currentSection.startsWith("- [ ]") || /^\d+\./.test(_currentSection);
      continue;
    }

    const checklistMatch = TASK_CHECKLIST_RE.exec(trimmed);
    if (checklistMatch) {
      const code = checklistMatch[1];
      const title = checklistMatch[2].trim();
      if (currentTask) {
        tasks.set(currentTask.code, currentTask);
      }
      currentTask = {
        code,
        title,
        ownerFiles: [],
        dependsOn: [],
        spec: "",
        acceptanceCriteria: [],
        verifyCommands: [],
      };
      inTaskSpec = true;
      continue;
    }

    if (currentTask && inTaskSpec) {
      if (trimmed.startsWith("**Owner File(s):**") || trimmed.startsWith("Owner File(s):")) {
        // Handle markdown bold: split by ** and take last part, then split by colon
        const afterBold = trimmed.split("**").pop() || trimmed;
        const colonIndex = afterBold.indexOf(":");
        const filesStr = colonIndex >= 0 ? afterBold.slice(colonIndex + 1).trim() : afterBold.trim();
        currentTask.ownerFiles = filesStr
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f && f !== "—" && f !== "-");
        continue;
      }
      if (trimmed.startsWith("**Depends On:**") || trimmed.startsWith("Depends On:")) {
        const depStr = trimmed.split(":", 2)[1]?.trim() || "";
        if (depStr !== "None") {
          currentTask.dependsOn = depStr
            .split(",")
            .map((d) => d.trim())
            .filter((d) => d);
        }
        continue;
      }
      if (trimmed.startsWith("**Spec:**") || trimmed.startsWith("Spec:") || trimmed.startsWith("Exact Spec:")) {
        let specContent = "";
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (/^\s*\*\*(?:DO NOT|Acceptance|Verify|Commit):/.test(nextLine.trimStart()) || /^##/.test(nextLine.trimStart())) {
            break;
          }
          specContent += nextLine + "\n";
        }
        currentTask.spec = redactSensitiveText(specContent.trim()).text;
        i += specContent.split("\n").length;
        continue;
      }
      if (trimmed.startsWith("**Acceptance Criteria:**") || trimmed.startsWith("Acceptance Criteria:")) {
        let acContent = "";
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (/^\s*\*\*(?:DO NOT|Expected|Verify|Commit):/.test(nextLine.trimStart()) || /^##/.test(nextLine.trimStart())) {
            break;
          }
          acContent += nextLine + "\n";
        }
        currentTask.acceptanceCriteria = acContent
          .split("\n")
          .map((l) => l.replace(/^[-*]\s+/, "").trim())
          .filter((l) => l);
        i += acContent.split("\n").length;
        continue;
      }
      if (trimmed.startsWith("**Verify:**") || trimmed.startsWith("Verify:") || trimmed.startsWith("**Verify Command:**")) {
        let verifyContent = "";
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (/^\s*\*\*(?:Expected|Commit):/.test(nextLine.trimStart()) || /^##/.test(nextLine.trimStart())) {
            break;
          }
          verifyContent += nextLine + "\n";
        }
        const commands = verifyContent
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("```") && !l.startsWith("```"));
        currentTask.verifyCommands = commands.map((cmd) => ({ cmd }));
        i += verifyContent.split("\n").length;
        continue;
      }
    }

    if (/^###/.test(trimmed)) {
      inTaskSpec = false;
    }
  }

  if (currentTask) {
    tasks.set(currentTask.code, currentTask);
  }

  const waveFiles: WaveFileRef[] = [];
  const waveDir = resolve(repoRoot, ".plan");
  try {
    const waveEntries = await readdir(waveDir, { withFileTypes: true });
    for (const entry of waveEntries) {
      if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("ADR-")) {
        const waveMatch = WAVE_PLAYBOOK_RE.exec(entry.name);
        if (waveMatch) {
          waveFiles.push({
            id: `W${parseInt(waveMatch[1], 10)}`,
            title: waveMatch[2].replace(/-/g, " "),
            wave_file: `.plan/${entry.name}`,
            depends_on: [],
          });
        }
      }
    }
  } catch {
    // wave dir doesn't exist
  }

  return {
    planId: planId || planTitle || "legacy-plan",
    title: planTitle,
    repo,
    tasks,
    waveFiles,
    documents: [],
  };
}

async function loadV2Bundle(repoRoot: string, planId: string): Promise<LoadedPlanBundle | null> {
  const planDir = join(repoRoot, ".plan", planId);
  const manifestPath = join(planDir, "manifest.json");
  const manifest = await readJson<PlanManifest>(manifestPath);
  if (!manifest) {
    return null;
  }

  const waves: WaveDefinition[] = [];
  const waveDir = join(planDir, "waves");
  try {
    const waveFiles = await readdir(waveDir);
    for (const waveFile of waveFiles) {
      if (waveFile.endsWith(".json")) {
        const wave = await readJson<WaveDefinition>(join(waveDir, waveFile));
        if (wave) {
          waves.push(wave);
        }
      }
    }
  } catch {
    // no waves directory
  }

  const documents: DocumentNodeIR[] = [];
  try {
    const docDir = join(planDir, "specs");
    const docFiles = await readdir(docDir);
    for (const docFile of docFiles) {
      if (docFile.endsWith(".md")) {
        await readText(join(docDir, docFile));
        documents.push({
          urn: `urn:mw:doc:${manifest.repo.org}/${manifest.repo.name}:${docFile.replace(".md", "")}`,
          slug: docFile.replace(".md", ""),
          layer: "specs",
          title: docFile.replace(".md", ""),
          path: `.plan/${planId}/specs/${docFile}`,
          status: "draft",
          linked_task_urns: [],
          tags: [],
        });
      }
    }
  } catch {
    // no specs directory
  }

  return {
    format: "plan-taskos/v1",
    manifest,
    waves,
    documents,
    source_path: `.plan/${planId}`,
  };
}

async function loadLegacyPlan(repoRoot: string, planId: string): Promise<LoadedPlanBundle | null> {
  const planFilePath = join(repoRoot, ".plan", `${planId}.md`);
  const content = await readText(planFilePath);
  if (!content) {
    return null;
  }

  const legacy = await parseLegacyPlan(content, planFilePath);

  const manifest: PlanManifest = {
    schema_version: "1.0.0",
    plan_id: legacy.planId,
    title: legacy.title,
    repo: legacy.repo,
    adr_file: "",
    execution_policy: {
      max_attempts_per_task: 3,
      default_model_tier: "flash",
      escalation_chain: ["flash", "neon", "argon", "human"],
      require_clean_scope: true,
      auto_commit: false,
    },
    projections: {
      github_fold_mode: "task",
      taskos_project: "default",
      orm_project_code: "default",
    },
    waves: legacy.waveFiles,
    documents: legacy.documents,
  };

  const waves: WaveDefinition[] = [];
  const tasksByWave = new Map<string, PlanTaskIR[]>();

  for (const [code, task] of legacy.tasks) {
    const waveId = code.charAt(0);
    const waveCode = `W${waveId}`;
    if (!tasksByWave.has(waveCode)) {
      tasksByWave.set(waveCode, []);
    }

    const governance: TaskGovernance = {
      owner_files: task.ownerFiles.map((f) => {
        try {
          return normalizeRepoPath(f);
        } catch {
          return f; // keep original for validation to catch
        }
      }),
      owner_globs: task.ownerFiles.filter((f) => f.includes("*") || f.includes("**")).map(normalizeRepoPath),
      invariants: [],
      do_not: [],
    };

    const lifecycle: TaskLifecycle = {
      status: "backlog",
      delivery_stage: "local",
      attempts: 0,
    };

    const graph: TaskGraph = {
      depends_on: task.dependsOn,
    };

    const knowledge: TaskKnowledge = {
      spec_files: [],
      adr_files: [],
      invariant_urns: [],
      doc_urns: [],
    };

    const verification: TaskVerification = {
      commands: task.verifyCommands,
      acceptance_criteria: task.acceptanceCriteria,
    };

    const projections: TaskProjections = {
      taskos_code: code,
    };

    const planTask: PlanTaskIR = {
      urn: `urn:mw:work:${legacy.repo.org}/${legacy.repo.name}:${legacy.planId}:${waveCode}/${code}`,
      code,
      kind: "task",
      title: task.title,
      lifecycle,
      governance,
      graph,
      knowledge,
      verification,
      projections,
    };

    tasksByWave.get(waveCode)!.push(planTask);
  }

  for (const [waveCode, waveTasks] of tasksByWave) {
    const waveFile = legacy.waveFiles.find((w) => w.id === waveCode) || {
      id: waveCode,
      title: waveCode,
      wave_file: `.plan/wave-${waveCode.toLowerCase()}.md`,
      depends_on: [],
    };
    waves.push({
      schema_version: "1.0.0",
      plan_id: legacy.planId,
      wave_id: waveCode,
      title: waveFile.title,
      tasks: waveTasks,
    });
  }

  return {
    format: "legacy-markdown",
    manifest,
    waves,
    documents: [],
    source_path: `.plan/${planId}.md`,
  };
}

export async function discoverPlans(repoRoot: string): Promise<readonly LoadedPlanBundle[]> {
  const planDir = join(repoRoot, ".plan");
  try {
    const entries = await readdir(planDir, { withFileTypes: true });
    const planIds = new Set<string>();

    for (const entry of entries) {
      if (entry.isDirectory()) {
        planIds.add(entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        planIds.add(entry.name.replace(".md", ""));
      }
    }

    const bundles: LoadedPlanBundle[] = [];
    for (const planId of planIds) {
      const bundle = await loadPlanBundle(repoRoot, planId);
      if (bundle) {
        bundles.push(bundle);
      }
    }
    return bundles;
  } catch {
    return [];
  }
}

export async function loadPlanBundle(
  repoRoot: string,
  planId: string
): Promise<LoadedPlanBundle | null> {
  const planDir = join(repoRoot, ".plan", planId);
  const manifestPath = join(planDir, "manifest.json");

  try {
    await stat(manifestPath);
    return await loadV2Bundle(repoRoot, planId);
  } catch {
    return await loadLegacyPlan(repoRoot, planId);
  }
}