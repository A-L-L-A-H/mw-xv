import type { PlanTaskIR, AuthorityPlane } from "./types.js";
import { canonicalJson, sha256Hex } from "./redaction.js";

export interface PlaneReconcileResult {
  readonly changed: boolean;
  readonly noop: boolean;
  readonly merged: PlanTaskIR;
  readonly planeHash: string;
  readonly rejectedFields?: readonly string[];
  readonly needsTriage?: boolean;
}

/** Canonical dotted-path field-group -> authoritative plane map (split-authority). */
export const FIELD_AUTHORITY_MAP: readonly {
  readonly dottedPaths: readonly string[];
  readonly plane: AuthorityPlane;
}[] = [
  {
    dottedPaths: [
      "governance.owner_files",
      "governance.owner_globs",
      "governance.invariants",
      "governance.do_not",
    ],
    plane: "git_spec",
  },
  {
    dottedPaths: [
      "lifecycle.status",
      "governance.owner_files",
      "verification.commands",
      "verification.acceptance_criteria",
    ],
    plane: "proof_runner",
  },
  {
    dottedPaths: ["lifecycle.delivery_stage", "lifecycle.ci_gate"],
    plane: "ci_delivery",
  },
  {
    dottedPaths: ["projections.orm_task_code", "projections.external_ref"],
    plane: "orm_enterprise",
  },
  {
    dottedPaths: [
      "projections.github_issue_number",
      "projections.github_state",
      "projections.taskos_code",
      "lifecycle.model_tier",
      "lifecycle.risk_tier",
    ],
    plane: "github_human",
  },
  {
    dottedPaths: [
      "knowledge.spec_files",
      "knowledge.adr_files",
      "knowledge.invariant_urns",
      "knowledge.doc_urns",
    ],
    plane: "docs_knowledge",
  },
];

const PLANE_INDEX: Record<string, AuthorityPlane> = {};
for (const { dottedPaths, plane } of FIELD_AUTHORITY_MAP) {
  for (const dottedPath of dottedPaths) {
    PLANE_INDEX[dottedPath] = plane;
  }
}

function dottedPathPlane(dottedPath: string): AuthorityPlane | undefined {
  return PLANE_INDEX[dottedPath];
}

const OWNED_PATHS: Record<AuthorityPlane, readonly string[]> = {
  git_spec: [
    "governance.owner_files",
    "governance.owner_globs",
    "governance.invariants",
    "governance.do_not",
  ],
  proof_runner: [
    "lifecycle.status",
    "governance.owner_files",
    "verification.commands",
    "verification.acceptance_criteria",
  ],
  ci_delivery: ["lifecycle.delivery_stage", "lifecycle.ci_gate"],
  orm_enterprise: ["projections.orm_task_code", "projections.external_ref"],
  github_human: [
    "projections.github_issue_number",
    "projections.github_state",
    "projections.taskos_code",
    "lifecycle.model_tier",
    "lifecycle.risk_tier",
  ],
  docs_knowledge: [
    "knowledge.spec_files",
    "knowledge.adr_files",
    "knowledge.invariant_urns",
    "knowledge.doc_urns",
  ],
};

/** Canonical owned-path serialization for idempotency hashing. */
function ownedPathCanonical(task: PlanTaskIR, plane: AuthorityPlane): string {
  const owned = OWNED_PATHS[plane] ?? [];
  const record: Record<string, unknown> = {};
  for (const path of owned) {
    let value: unknown = task as unknown;
    for (const segment of path.split(".")) {
      value =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)[segment]
          : undefined;
      if (value === undefined) break;
    }
    if (value !== undefined) {
      record[path] = value;
    }
  }
  return canonicalJson({ plane, owned: record });
}

function deepGet(obj: unknown, path: string): unknown {
  let value: unknown = obj;
  for (const segment of path.split(".")) {
    value = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)[segment]
      : undefined;
    if (value === undefined) return undefined;
  }
  return value;
}

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (!cursor[seg] || typeof cursor[seg] !== "object") {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Normalized lifecycle conversions between TaskOS planes. */
export function mapWorkStatusToOrm(status: string): string {
  switch (status) {
    case "backlog":
      return "backlog";
    case "todo":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "review":
      return "code_review";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

export function mapWorkStatusToTaskosV2(status: string): string {
  return status;
}

export function mapWorkStatusToWorkContract(status: string): string {
  switch (status) {
    case "backlog":
      return "draft";
    case "todo":
      return "accepted";
    case "in_progress":
      return "implemented";
    case "review":
      return "review";
    case "blocked":
      return "blocked";
    case "done":
      return "accepted";
    case "skipped":
      return "superseded";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

export function mapDeliveryToGitHubState(stage: string): string {
  switch (stage) {
    case "local":
      return "open";
    case "verified_dev":
      return "open";
    case "in_main":
      return "merged";
    case "released":
      return "merged";
    case "na":
      return "open";
    default:
      return "open";
  }
}

/**
 * Flatten a nested object into dotted paths, e.g. `{ lifecycle: { status: "done" } }`
 * -> `[["lifecycle.status", "done"]]`. Arrays and primitives are terminal values.
 */
function flattenDottedPaths(
  obj: Record<string, unknown>,
  prefix = ""
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenDottedPaths(value as Record<string, unknown>, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

/**
 * Split-Authority Field-Plane Reconciler.
 *
 * Accepts ONLY mutations to dotted paths owned by `sourcePlane`; rejects
 * unauthorized cross-plane overwrites (e.g. `github_human` setting
 * `lifecycle.status = "done"` is owned by `proof_runner` -> `{ needsTriage: true, rejectedFields }`).
 * Zero-loop idempotent: `reconcile(reconcile(x))` yields `noop: true`.
 */
export function reconcileTaskPlanes(
  current: PlanTaskIR,
  incoming: Partial<PlanTaskIR>,
  sourcePlane: AuthorityPlane
): PlaneReconcileResult {
  const ownedPaths = new Set(OWNED_PATHS[sourcePlane] ?? []);
  const rejectedFields: string[] = [];
  const merged = deepClone(current as unknown) as Record<string, unknown>;

  const flatIncoming = flattenDottedPaths(incoming as unknown as Record<string, unknown>);

  for (const [field, value] of flatIncoming) {
    const plane = dottedPathPlane(field);
    if (plane === undefined) {
      continue; // unknown field: no authority mapping
    }
    if (plane !== sourcePlane) {
      rejectedFields.push(field);
      continue; // cross-plane overwrite rejected
    }
    deepSet(merged, field, value); // owned-path mutation from the authoritative plane
  }

  let changed = false;
  let noop = true;
  for (const [field] of flatIncoming) {
    const plane = dottedPathPlane(field);
    if (plane === sourcePlane && plane !== undefined) {
      const currentValue = deepGet(current as unknown as Record<string, unknown>, field);
      const mergedValue = deepGet(merged, field);
      if (JSON.stringify(currentValue) !== JSON.stringify(mergedValue)) {
        changed = true;
        noop = false;
        break;
      }
    }
  }

  const mergedTask = Object.freeze(merged) as unknown as PlanTaskIR;
  const planeHash = sha256Hex(ownedPathCanonical(mergedTask, sourcePlane));

  const result: PlaneReconcileResult = {
    changed,
    noop: changed ? false : noop,
    merged: mergedTask,
    planeHash,
    ...(rejectedFields.length > 0
      ? { rejectedFields: Object.freeze(rejectedFields), needsTriage: true }
      : { needsTriage: false }),
  };

  return Object.freeze(result);
}