/**
 * T28a — Pure HTTP ORM Project/WorkContract Adapter.
 *
 * Builds pure HTTP payloads for `POST /api/projects/:id/plan-sync` and
 * `POST /api/projects/tasks/:id/work-contract`, with an optional injectable
 * fetch client. Zero ORM imports (INV-004 compliant).
 */

import type { LoadedPlanBundle, PlanTaskIR } from "../core/types.js";

export interface OrmPlanSyncPayload {
  readonly project: {
    readonly code: string;
    readonly name: string;
    readonly external_ref: string;
  };
  readonly milestones: readonly {
    readonly code: string;
    readonly name: string;
    readonly external_ref: string;
  }[];
  readonly tasks: readonly {
    readonly code: string;
    readonly title: string;
    readonly parent_code: string | null;
    readonly milestone_code: string | null;
    readonly external_ref: string;
    readonly status: string;
    readonly scope_json: {
      readonly owner_files: readonly string[];
      readonly verify_commands: readonly string[];
      readonly spec_ref: string | null;
    };
    readonly acceptance_criteria: readonly { readonly text: string; readonly done: boolean }[];
    readonly depends_on: readonly string[];
  }[];
}

/**
 * Normalize a task code into ORM-safe dotted notation.
 */
export function normalizeOrmCode(planId: string, taskCode: string): string {
  const normalizedTask = taskCode.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${planId}.${normalizedTask}`.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Build the `plan-sync` HTTP payload from a LoadedPlanBundle.
 */
export function buildPlanSyncPayload(bundle: LoadedPlanBundle): OrmPlanSyncPayload {
  const manifest = bundle.manifest;
  const planUrn = `urn:mw:work:${manifest.repo.org}/${manifest.repo.name}:${manifest.plan_id}`;

  const milestones = manifest.waves.map((w) => ({
    code: `${manifest.plan_id}:${w.id}`,
    name: w.title,
    external_ref: `${planUrn}:${w.id}`,
  }));

  const tasks = bundle.waves.flatMap((wave) =>
    wave.tasks.map((task: PlanTaskIR) => ({
      code: normalizeOrmCode(manifest.plan_id, task.code),
      title: task.title,
      parent_code: null,
      milestone_code: `${manifest.plan_id}:${wave.wave_id}`,
      external_ref: task.urn,
      status: task.lifecycle.status,
      scope_json: {
        owner_files: [...task.governance.owner_files, ...(task.governance.owner_globs ?? [])],
        verify_commands: task.verification.commands.map((c) => c.cmd),
        spec_ref: task.knowledge.spec_files?.[0] ?? null,
      },
      acceptance_criteria: task.verification.acceptance_criteria.map((c) => ({
        text: c,
        done: task.lifecycle.status === "done" || task.lifecycle.status === "skipped",
      })),
      depends_on: task.graph.depends_on.map((d) => normalizeOrmCode(manifest.plan_id, d)),
    }))
  );

  return {
    project: {
      code: manifest.plan_id,
      name: manifest.title,
      external_ref: planUrn,
    },
    milestones,
    tasks,
  };
}

export interface WorkContractPayload {
  readonly task_urn: string;
  readonly status: string;
  readonly model_tier: string;
  readonly attempts: number;
}

/**
 * Build a `work-contract` payload for a single task.
 */
export function buildWorkContractPayload(task: PlanTaskIR, modelTier: string): WorkContractPayload {
  return {
    task_urn: task.urn,
    status: task.lifecycle.status,
    model_tier: modelTier,
    attempts: task.lifecycle.attempts,
  };
}

export interface OrmHttpClientOptions {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Optional thin HTTP client speaking to the ORM plan-sync endpoints.
 * Injectable `fetchFn` keeps this pure and testable.
 */
export async function postPlanSync(
  payload: OrmPlanSyncPayload,
  options: OrmHttpClientOptions
): Promise<{ ok: boolean; status: number; body: string }> {
  const doFetch = options.fetchFn ?? fetch;
  const projectId = payload.project.code;
  const response = await doFetch(`${options.baseUrl}/projects/${encodeURIComponent(projectId)}/plan-sync`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

/**
 * Post a work-contract update for a single task to
 * `POST /projects/tasks/:id/work-contract`.
 */
export async function postWorkContract(
  taskCode: string,
  payload: WorkContractPayload,
  options: OrmHttpClientOptions
): Promise<{ ok: boolean; status: number; body: string }> {
  const doFetch = options.fetchFn ?? fetch;
  const response = await doFetch(`${options.baseUrl}/projects/tasks/${encodeURIComponent(taskCode)}/work-contract`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}
