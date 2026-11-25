/**
 * T27 — Split-Authority GitHub Issues & Delivery Adapter.
 *
 * Generalizes `docs/roadmap/ISSUE-SYNC-CONTRACT.md` into a pure, testable
 * adapter: adaptive folding (plan | wave | task), managed-block fence with
 * human-note preservation, normalized content-hash no-op detection, bounded
 * apply batch (<=5), delivery close gate, and inbound issue intake.
 */

import type { LoadedPlanBundle, PlanTaskIR, GitHubFoldMode } from "../core/types.js";
import { createHash } from "node:crypto";
import { sha256Hex } from "../core/redaction.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubTransport {
  listIssues(query: { labels?: readonly string[] }): Promise<readonly GitHubIssue[]>;
  getIssue(issueNumber: number): Promise<GithubIssueOrNull>;
  createIssue(input: { title: string; body: string; labels?: readonly string[]; milestone?: string }): Promise<GitHubIssue>;
  updateIssue(issueNumber: number, input: { title?: string; body?: string; labels?: readonly string[]; state?: "open" | "closed" }): Promise<GitHubIssue>;
  addComment(issueNumber: number, body: string): Promise<void>;
}

export interface GithubIssueOrNull {
  readonly issueNumber: number | null;
}

export interface GitHubIssue {
  readonly issueNumber: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: "open" | "closed";
}

export type GitHubOperation = "noop" | "create" | "update" | "close" | "conflict" | "needs-triage";

export interface GitHubIssueOp {
  readonly operation: GitHubOperation;
  readonly key: string;
  readonly marker: string;
  readonly issueNumber?: number;
  readonly title?: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Managed block fence
// ---------------------------------------------------------------------------

export const MANAGED_BEGIN = "<!-- BEGIN MOONWITNESS MANAGED -->";
export const MANAGED_END = "<!-- END MOONWITNESS MANAGED -->";

export function taskMarker(repoId: string, key: string): string {
  return `<!-- moonwitness-task: ${repoId}:${key} -->`;
}

/**
 * Split an issue body into (managedBlock, humanText) preserving human text
 * verbatim. Non-managed content outside the fence is returned untouched.
 */
export function splitManagedBlock(body: string): { managed: string | null; human: string } {
  const begin = body.indexOf(MANAGED_BEGIN);
  const end = body.indexOf(MANAGED_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { managed: null, human: body };
  }
  const managed = body.slice(begin, end + MANAGED_END.length);
  const human = (body.slice(0, begin) + body.slice(end + MANAGED_END.length)).trim();
  return { managed, human };
}

// ---------------------------------------------------------------------------
// Content hash (zero-loop no-op detection)
// ---------------------------------------------------------------------------

export interface ManagedState {
  readonly body: string;
  readonly labels: readonly string[];
  readonly milestone?: string;
}

/**
 * Normalized SHA-256 over managed body + managed labels + milestone.
 * Identical remote state => identical hash => `noop`.
 */
export function computeManagedContentHash(state: ManagedState): string {
  const normalized = [
    state.body.trim().replace(/\r\n/g, "\n"),
    [...state.labels].map((l) => l.trim()).sort().join(","),
    state.milestone?.trim() ?? "",
  ].join("\u0000");
  return sha256Hex(normalized);
}

function extractManagedHash(managedBlock: string | null): string | null {
  if (!managedBlock) return null;
  const match = managedBlock.match(/<!-- moonwitness-hash: ([0-9a-f]{64}) -->/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Rendering (fold modes)
// ---------------------------------------------------------------------------

export interface RenderContext {
  readonly repoId: string;
  readonly foldMode: GitHubFoldMode;
  readonly sourceBaseUrl?: string;
}

function renderTaskChecklist(tasks: readonly PlanTaskIR[], sourceBaseUrl?: string): string {
  const lines: string[] = [];
  for (const task of tasks) {
    const status = task.lifecycle.status === "done" || task.lifecycle.status === "skipped" ? "[x]" : "[ ]";
    const commitSha = (task.projections as Record<string, unknown>).commit_sha as string | undefined;
    const evidenceRef = (task.projections as Record<string, unknown>).evidence_ref as string | undefined;
    const sha = commitSha ? ` (\`${commitSha.slice(0, 7)}\`` : "";
    const proof = evidenceRef ? ` · proof \`${evidenceRef}\`` : "";
    const close = commitSha ? ")" : "";
    lines.push(`- ${status} **${task.code}** — ${task.title}${sha}${proof}${close}`);
  }
  return lines.join("\n");
}

function renderManagedBody(header: string, checklist: string, hash: string): string {
  return [
    taskMarker("", ""), // replaced by caller; placeholder for type clarity
    MANAGED_BEGIN,
    "",
    header,
    "",
    checklist,
    "",
    `<!-- moonwitness-hash: ${hash} -->`,
    MANAGED_END,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plan operations
// ---------------------------------------------------------------------------

export interface PlanGitHubOpsInput {
  readonly bundle: LoadedPlanBundle;
  readonly context: RenderContext;
  readonly remoteIssues?: readonly GitHubIssue[];
}

/**
 * Compute the deterministic list of GitHub operations for a plan bundle.
 * Pure: no network calls. Re-running against identical remote state yields
 * 100% `noop` operations.
 */
export function planGitHubOperations(input: PlanGitHubOpsInput): GitHubIssueOp[] {
  const { bundle, context } = input;
  const remote = input.remoteIssues ?? [];
  const ops: GitHubIssueOp[] = [];

  const findByMarker = (marker: string): GitHubIssue | undefined =>
    remote.find((i) => i.body.includes(marker));

  if (context.foldMode === "plan") {
    const key = bundle.manifest.plan_id;
    const marker = `<!-- moonwitness-task: ${context.repoId}:${key} -->`;
    const existing = findByMarker(marker);
    const body = renderPlanTrackingBody(bundle, context);
    ops.push(buildOp(key, marker, existing, body, bundle.manifest.title, ["plan-taskos", "roadmap"], remote));
    return ops;
  }

  if (context.foldMode === "wave") {
    for (const wave of bundle.waves) {
      const key = `${bundle.manifest.plan_id}:${wave.wave_id}`;
      const marker = `<!-- moonwitness-task: ${context.repoId}:${key} -->`;
      const existing = findByMarker(marker);
      const checklist = renderTaskChecklist(wave.tasks, context.sourceBaseUrl);
      const doneCount = wave.tasks.filter(
        (t) => t.lifecycle.status === "done" || t.lifecycle.status === "skipped"
      ).length;
      const header = `Task: ${wave.title}\nPlan: ${bundle.manifest.plan_id}\nWave: ${wave.wave_id}\nProgress: ${doneCount}/${wave.tasks.length}`;
      const hash = computeManagedContentHash({ body: `${header}\n\n${checklist}`, labels: ["plan-taskos", "roadmap", `wave:${wave.wave_id}`] });
      const body = `${marker}\n${MANAGED_BEGIN}\n\n${header}\n\n${checklist}\n\n<!-- moonwitness-hash: ${hash} -->\n${MANAGED_END}`;
      ops.push(buildOp(key, marker, existing, body, `${wave.wave_id}: ${wave.title}`, ["plan-taskos", "roadmap", `wave:${wave.wave_id}`], remote));
    }
    return ops;
  }

  // foldMode === 'task': 1:1 issue per task
  for (const wave of bundle.waves) {
    for (const task of wave.tasks) {
      const key = task.projections.taskos_code ?? task.code;
      const marker = `<!-- moonwitness-task: ${context.repoId}:${key} -->`;
      const existing = findByMarker(marker);
      const header = `Task: ${task.code}\nTitle: ${task.title}\nPlan: ${bundle.manifest.plan_id}\nWave: ${wave.wave_id}\nDepends: ${task.graph.depends_on.join(", ") || "none"}\nOwner files: ${task.governance.owner_files.join(", ")}`;
      const acceptance = task.verification.acceptance_criteria.map((c) => `- ${c}`).join("\n");
      const verify = task.verification.commands.map((c) => `- \`${c.cmd}\``).join("\n");
      const body = `${marker}\n${MANAGED_BEGIN}\n\n${header}\n\n## Acceptance\n\n${acceptance}\n\n## Verify\n\n${verify}\n\n<!-- moonwitness-hash: ${hashOf(header + acceptance + verify)} -->\n${MANAGED_END}`;
      ops.push(buildOp(key, marker, existing, body, `${task.code}: ${task.title}`, ["plan-taskos", "roadmap", `wave:${wave.wave_id}`], remote));
    }
  }

  return ops;
}

function hashOf(input: string): string {
  return createHash("sha256").update(input.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

function renderPlanTrackingBody(bundle: LoadedPlanBundle, context: RenderContext): string {
  const marker = `<!-- moonwitness-task: ${context.repoId}:${bundle.manifest.plan_id} -->`;
  const lines: string[] = [marker, MANAGED_BEGIN, "", `Plan: ${bundle.manifest.plan_id}`, `Title: ${bundle.manifest.title}`, ""];
  for (const wave of bundle.waves) {
    lines.push(`## ${wave.wave_id} — ${wave.title}`);
    lines.push("");
    lines.push(renderTaskChecklist(wave.tasks, context.sourceBaseUrl));
    lines.push("");
  }
  const hash = computeManagedContentHash({ body: lines.join("\n"), labels: ["plan-taskos", "roadmap"] });
  lines.push(`<!-- moonwitness-hash: ${hash} -->`, MANAGED_END);
  return lines.join("\n");
}

function buildOp(
  key: string,
  marker: string,
  existing: GitHubIssue | undefined,
  body: string,
  title: string,
  labels: readonly string[],
  allRemote: readonly GitHubIssue[] = []
): GitHubIssueOp {
  if (!existing) {
    return { operation: "create", key, marker, title, body, labels };
  }

  // Duplicate markers across remote issues -> ambiguous ownership, needs
  // human triage before any write.
  const duplicates = allRemote.filter((i) => i.body.includes(marker));
  if (duplicates.length > 1) {
    return {
      operation: "conflict",
      key,
      marker,
      issueNumber: existing.issueNumber,
      reason: `duplicate managed marker on issues ${duplicates.map((d) => `#${d.issueNumber}`).join(", ")}`,
    };
  }

  const { managed, human } = splitManagedBlock(existing.body);
  const remoteHash = extractManagedHash(managed);
  const localManagedHash = extractManagedHash(body) ?? "";

  if (remoteHash === localManagedHash) {
    return { operation: "noop", key, marker, issueNumber: existing.issueNumber };
  }

  // A manually closed issue whose managed block drifted must not be silently
  // reopened or rewritten: flag for human triage.
  if (existing.state === "closed") {
    return {
      operation: "needs-triage",
      key,
      marker,
      issueNumber: existing.issueNumber,
      reason: "issue was closed manually while managed content drifted",
    };
  }

  return {
    operation: "update",
    key,
    marker,
    issueNumber: existing.issueNumber,
    title,
    body: `${marker}\n${body.slice(marker.length + 1)}\n\n${human ? `## Catatan maintainer\n\n${human}` : "## Catatan maintainer"}`,
    labels,
  };
}

// ---------------------------------------------------------------------------
// Bounded apply
// ---------------------------------------------------------------------------

export const MAX_APPLY_BATCH = 5;

export interface ApplyReport {
  readonly applied: number;
  readonly skipped: number;
  readonly conflicts: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Apply operations via the injected transport with a hard batch cap of 5.
 */
export async function applyGitHubOperations(
  ops: readonly GitHubIssueOp[],
  transport: GitHubTransport
): Promise<ApplyReport> {
  const conflicts: string[] = [];
  const errors: string[] = [];
  let applied = 0;

  const batch = ops.slice(0, MAX_APPLY_BATCH);
  const skipped = ops.length - batch.length;

  for (const op of batch) {
    try {
      if (op.operation === "noop") {
        continue;
      }
      if (op.operation === "create") {
        await transport.createIssue({ title: op.title ?? op.key, body: op.body ?? "", labels: op.labels });
        applied++;
      } else if (op.operation === "update" && op.issueNumber !== undefined) {
        await transport.updateIssue(op.issueNumber, { title: op.title, body: op.body, labels: op.labels });
        applied++;
      }
    } catch (e) {
      errors.push(`${op.key}: ${(e as Error).message}`);
    }
  }

  return { applied, skipped, conflicts, errors };
}

// ---------------------------------------------------------------------------
// Delivery close gate
// ---------------------------------------------------------------------------

export interface DeliveryClosePolicy {
  readonly requiredDeliveryStage: readonly string[];
}

export const DEFAULT_DELIVERY_CLOSE_POLICY: DeliveryClosePolicy = {
  requiredDeliveryStage: ["in_main", "released", "na"],
};

/**
 * Determine whether a completed task may have its issue closed.
 * BOTH work proof (done) AND delivery stage must satisfy the policy.
 */
export function canCloseIssue(
  task: PlanTaskIR,
  policy: DeliveryClosePolicy = DEFAULT_DELIVERY_CLOSE_POLICY
): { closeable: boolean; reason: string } {
  const workDone = task.lifecycle.status === "done";
  const deliveryStage = task.lifecycle.delivery_stage;
  if (!workDone) {
    return { closeable: false, reason: "work_status is not done" };
  }
  if (!policy.requiredDeliveryStage.includes(deliveryStage)) {
    return { closeable: false, reason: `delivery_stage '${deliveryStage}' does not satisfy close policy` };
  }
  return { closeable: true, reason: "work done and delivery verified" };
}

// ---------------------------------------------------------------------------
// Inbound intake
// ---------------------------------------------------------------------------

export interface IntakeDraft {
  readonly code: string;
  readonly urn: string;
  readonly title: string;
  readonly status: "backlog";
  readonly githubIssueNumber: number;
  readonly body: string;
}

/**
 * Convert a human GitHub Issue into a clean backlog PlanTaskIR seed with
 * `projections.github.issue_number` linkage.
 */
export function parseGitHubIssueToIntakeDraft(
  issue: GitHubIssue,
  planId: string,
  repoIdentity: { org: string; name: string }
): IntakeDraft {
  const { managed, human } = splitManagedBlock(issue.body);
  const markerMatch = managed?.match(/<!-- moonwitness-task: [^:]+:([^ ]+) -->/);
  const code = markerMatch?.[1] ?? `GH-${issue.issueNumber}`;
  const titleFromManaged = managed?.match(/^Task: (.+)$/m)?.[1];

  return {
    code,
    urn: `urn:mw:work:${repoIdentity.org}/${repoIdentity.name}:${planId}:intake/${code}`,
    title: titleFromManaged ?? issue.title,
    status: "backlog",
    githubIssueNumber: issue.issueNumber,
    body: human,
  };
}
