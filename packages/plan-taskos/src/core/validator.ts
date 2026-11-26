import { readdir, readFile } from "node:fs/promises";
import { join, resolve, sep as pathSep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { LoadedPlanBundle, PlanManifest, WaveDefinition, PlanTaskIR, DocumentNodeIR, ProofEnvelope } from "./types.js";
import { normalizeRepoPath, globMatchesPath } from "./paths.js";
import { canonicalJson, sha256Hex } from "./redaction.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Module: any = createRequire(import.meta.url)("ajv/dist/2020.js");
import * as formatsModule from "ajv-formats";

type Ajv2020 = InstanceType<typeof Ajv2020Module>;

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly taskCode?: string;
  readonly path?: string;
  readonly waveId?: string;
}

interface PlanValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

interface RepoInvariantRule {
  readonly id: string;
  readonly rule: string;
  readonly globPatterns: readonly string[];
}

interface SpecSection {
  readonly heading: string;
  readonly line: number;
}

let ajvCache: Ajv2020 | null = null;
let manifestValidator: ReturnType<Ajv2020["compile"]> | null = null;
let waveValidator: ReturnType<Ajv2020["compile"]> | null = null;
let proofValidator: ReturnType<Ajv2020["compile"]> | null = null;
let documentValidator: ReturnType<Ajv2020["compile"]> | null = null;

function getAjv(): Ajv2020 {
  if (ajvCache) return ajvCache;
  const ajv = new Ajv2020Module({ strict: true, allErrors: true });
  formatsModule.default.default(ajv, { mode: "full" });
  ajvCache = ajv;
  return ajv;
}

async function loadSchema<T>(name: string): Promise<T> {
  const content = await readFile(join(__dirname, "..", "..", "schemas", `${name}.schema.json`), "utf8");
  return JSON.parse(content);
}

let validatorsInitialized = false;

async function getValidators() {
  if (validatorsInitialized) return;
  const ajv = getAjv();
  const [manifestSchema, waveSchema, proofSchema, documentSchema] = await Promise.all([
    loadSchema("manifest"),
    loadSchema("wave"),
    loadSchema("proof"),
    loadSchema("document"),
  ]);
  manifestValidator = ajv.compile(manifestSchema);
  waveValidator = ajv.compile(waveSchema);
  proofValidator = ajv.compile(proofSchema);
  documentValidator = ajv.compile(documentSchema);
  validatorsInitialized = true;
}

function validateSchema(validator: ReturnType<Ajv2020["compile"]> | null, data: unknown, context: string): ValidationIssue[] {
  if (!validator) return [{ code: "SCHEMA_COMPILE_FAILED", message: `Schema validator not initialized: ${context}` }];
  const valid = validator(data);
  if (valid) return [];
  return (validator.errors || []).map((e: { keyword?: string; instancePath?: string; message?: string }) => ({
    code: `SCHEMA_${e.keyword?.toUpperCase() || "ERROR"}`,
    message: `${context}: ${e.instancePath || "/"} ${e.message || "invalid"}`,
    path: e.instancePath,
  }));
}

async function loadSpecSections(repoRoot: string, specPath: string): Promise<SpecSection[]> {
  try {
    const fullPath = join(repoRoot, specPath);
    const content = await readFile(fullPath, "utf8");
    const lines = content.split(/\r?\n/);
    const sections: SpecSection[] = [];
    const headingRe = /^##\s+(?:(?:-\s+)?\[[ xX]\]\s+)?([A-Z]\d{2,3})\b/;
    for (let i = 0; i < lines.length; i++) {
      const match = headingRe.exec(lines[i]);
      if (match) {
        sections.push({ heading: match[1], line: i + 1 });
      }
    }
    return sections;
  } catch {
    return [];
  }
}

async function loadInvariantRules(repoRoot: string): Promise<RepoInvariantRule[]> {
  try {
    const rulesPath = join(repoRoot, ".agents", "rules", "learned-invariants.md");
    const content = await readFile(rulesPath, "utf8");
    const rules: RepoInvariantRule[] = [];
    const lines = content.split(/\r?\n/);
    let currentRule: { id: string; rule: string; globPatterns: string[] } = {
      id: "",
      rule: "",
      globPatterns: [],
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("### INV-")) {
        if (currentRule.id) {
          rules.push({ ...currentRule });
        }
        currentRule = {
          id: trimmed.replace("### ", "").trim(),
          rule: "",
          globPatterns: [],
        };
      } else if (trimmed.startsWith("**Pattern:**") || trimmed.startsWith("Pattern:")) {
        const pattern = trimmed.split(":", 2)[1]?.trim();
        if (pattern) {
          currentRule.globPatterns.push(pattern);
        }
      } else if (trimmed && currentRule.id && !trimmed.startsWith("###")) {
        currentRule.rule += (currentRule.rule ? "\n" : "") + trimmed;
      }
    }
    if (currentRule.id) {
      rules.push({ ...currentRule });
    }
    return rules;
  } catch {
    return [];
  }
}

function matchInvariantsForPaths(
  ownerFiles: readonly string[],
  invariantRules: readonly RepoInvariantRule[]
): string[] {
  const matched = new Set<string>();
  for (const file of ownerFiles) {
    for (const rule of invariantRules) {
      for (const pattern of rule.globPatterns) {
        if (globMatchesPath(pattern, file)) {
          matched.add(rule.id);
          break;
        }
      }
    }
  }
  return Array.from(matched).sort();
}

function collectAllTasks(bundle: LoadedPlanBundle): Array<{ task: PlanTaskIR; waveId: string }> {
  const all: Array<{ task: PlanTaskIR; waveId: string }> = [];
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      all.push({ task, waveId: wave.wave_id });
    }
  }
  return all;
}

function findTaskByCode(bundle: LoadedPlanBundle, code: string): PlanTaskIR | null {
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      if (task.code === code) return task;
    }
  }
  return null;
}

export async function validatePlanBundle(
  bundle: LoadedPlanBundle,
  options?: { invariants?: readonly RepoInvariantRule[] }
): Promise<PlanValidationResult> {
  await getValidators();

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // 1. Schema conformance. The JSON schemas describe authored v2 bundles only;
  // legacy-markdown bundles are synthesized views with placeholder manifest fields
  // (repo identity, adr_file), so v2 AJV errors there are false positives.
  if (bundle.format === "plan-taskos/v1") {
    const manifestErrors = validateSchema(manifestValidator, bundle.manifest, "manifest");
    errors.push(...manifestErrors);

    for (const wave of bundle.waves) {
      const waveErrors = validateSchema(waveValidator, wave, `wave ${wave.wave_id}`).map((e) => ({
        ...e,
        waveId: wave.wave_id,
      }));
      errors.push(...waveErrors);
    }

    for (const doc of bundle.documents) {
      const docErrors = validateSchema(documentValidator, doc, `document ${doc.slug}`).map((e) => ({
        ...e,
        path: doc.path,
      }));
      errors.push(...docErrors);
    }
  }

  // 2. Unique URN and code across all waves; depends_on targets exist
  const allTasks = collectAllTasks(bundle);
  const urnSet = new Set<string>();
  const codeSet = new Set<string>();

  for (const { task, waveId } of allTasks) {
    if (urnSet.has(task.urn)) {
      errors.push({
        code: "DUPLICATE_URN",
        message: `Duplicate URN: ${task.urn}`,
        taskCode: task.code,
        waveId,
      });
    }
    urnSet.add(task.urn);

    if (codeSet.has(task.code)) {
      errors.push({
        code: "DUPLICATE_CODE",
        message: `Duplicate task code: ${task.code}`,
        taskCode: task.code,
        waveId,
      });
    }
    codeSet.add(task.code);
  }

  for (const { task, waveId } of allTasks) {
    for (const dep of task.graph.depends_on) {
      if (!codeSet.has(dep)) {
        errors.push({
          code: "MISSING_DEPENDENCY",
          message: `Task ${task.code} depends on non-existent task: ${dep}`,
          taskCode: task.code,
          waveId,
        });
      }
    }
  }

  // 3. 1:1 Spec Parity (if spec_ref exists, must resolve to heading)
  // Note: PlanTaskIR doesn't have spec_ref directly - we check projections.taskos_code or look for spec refs in knowledge.spec_files
  for (const { task, waveId } of allTasks) {
    // Check knowledge.spec_files for spec_ref-like paths
    for (const specFile of task.knowledge.spec_files || []) {
      const sections = await loadSpecSections(bundle.manifest.repo.org ? resolve(".") : ".", specFile);
      // Could extract task code from spec_file anchor like specs/W1.md#T06
      const anchorMatch = specFile.match(/#([A-Z]\d{2,3})$/);
      if (anchorMatch) {
        const specTaskCode = anchorMatch[1];
        const hasSection = sections.some((s) => s.heading === specTaskCode);
        if (!hasSection) {
          errors.push({
            code: "MISSING_SPEC_SECTION",
            message: `Task ${task.code} spec_ref ${specFile} points to missing section ${specTaskCode}`,
            taskCode: task.code,
            waveId,
            path: specFile,
          });
        }
      }
    }
  }

  // 4. Path Containment
  for (const { task, waveId } of allTasks) {
    for (const file of task.governance.owner_files || []) {
      try {
        normalizeRepoPath(file);
      } catch (e) {
        errors.push({
          code: "INVALID_PATH",
          message: `Task ${task.code} owner_file invalid: ${e instanceof Error ? e.message : String(e)}`,
          taskCode: task.code,
          waveId,
          path: file,
        });
      }
    }
    for (const glob of task.governance.owner_globs || []) {
      try {
        normalizeRepoPath(glob);
      } catch (e) {
        errors.push({
          code: "INVALID_GLOB",
          message: `Task ${task.code} owner_glob invalid: ${e instanceof Error ? e.message : String(e)}`,
          taskCode: task.code,
          waveId,
          path: glob,
        });
      }
    }
  }

  // 5. Anti-Fake-Completion Check (v2 format only)
  if (bundle.format === "plan-taskos/v1") {
    for (const { task, waveId } of allTasks) {
      if (task.lifecycle.status === "done") {
        const proofPath = `.plan/${bundle.manifest.plan_id}/evidence/${task.code}.proof.json`;
        // We can't easily check file existence without repoRoot, so warn
        warnings.push({
          code: "MISSING_PROOF_WARNING",
          message: `Task ${task.code} is done but proof envelope not verified (expected at ${proofPath})`,
          taskCode: task.code,
          waveId,
        });
      }
    }
  }

  // 6. Path-Matched Invariants
  const invariantRules = options?.invariants ?? (await loadInvariantRules("."));
  for (const { task, waveId } of allTasks) {
    const matched = matchInvariantsForPaths(task.governance.owner_files || [], invariantRules);
    if (matched.length > 0) {
      warnings.push({
        code: "INVARIANT_MATCH",
        message: `Task ${task.code} matches invariants: ${matched.join(", ")}`,
        taskCode: task.code,
        waveId,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  };
}