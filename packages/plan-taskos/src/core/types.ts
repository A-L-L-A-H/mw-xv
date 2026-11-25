import type { ParsedWorkUrn } from "./urn.js";

export type WorkStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "blocked"
  | "done"
  | "skipped"
  | "cancelled";

export type DeliveryStage = "local" | "verified_dev" | "in_main" | "released" | "na";

export type ModelTier = "flash" | "neon" | "argon" | "human";

export type RiskTier = "R0" | "R1" | "R2" | "R3" | "R4";

export type DocLayer = "raw" | "brain" | "wiki" | "blueprints" | "specs";

export type GitHubFoldMode = "plan" | "wave" | "task";

export type AuthorityPlane =
  | "git_spec"
  | "proof_runner"
  | "ci_delivery"
  | "orm_enterprise"
  | "github_human"
  | "docs_knowledge";

export interface RepoIdentity {
  readonly org: string;
  readonly name: string;
  readonly target_branch: string;
}

export interface ExecutionPolicy {
  readonly max_attempts_per_task: number;
  readonly default_model_tier: ModelTier;
  readonly escalation_chain: readonly ModelTier[];
  readonly require_clean_scope: boolean;
  readonly auto_commit: boolean;
}

export interface ProjectionsConfig {
  readonly github_fold_mode: GitHubFoldMode;
  readonly taskos_project: string;
  readonly orm_project_code: string;
}

export interface WaveFileRef {
  readonly id: string;
  readonly title: string;
  readonly wave_file: string;
  readonly spec_file?: string;
  readonly depends_on: readonly string[];
}

export interface ManifestDocumentRef {
  readonly urn: string;
  readonly slug: string;
  readonly layer: DocLayer;
  readonly title: string;
  readonly path: string;
}

export interface PlanManifest {
  readonly schema_version: "1.0.0";
  readonly plan_id: string;
  readonly title: string;
  readonly repo: RepoIdentity;
  readonly adr_file: string;
  readonly execution_policy: ExecutionPolicy;
  readonly projections: ProjectionsConfig;
  readonly waves: readonly WaveFileRef[];
  readonly documents: readonly ManifestDocumentRef[];
}

export interface WaveDefinition {
  readonly schema_version: "1.0.0";
  readonly plan_id: string;
  readonly wave_id: string;
  readonly title: string;
  readonly tasks: readonly PlanTaskIR[];
}

export type LifecycleStatus = WorkStatus;

export interface TaskLifecycle {
  readonly status: LifecycleStatus;
  readonly delivery_stage: DeliveryStage;
  readonly model_tier?: ModelTier;
  readonly risk_tier?: RiskTier;
  readonly attempts: number;
}

export interface GovernanceInvariant {
  readonly id: string;
  readonly rule: string;
}

export interface TaskGovernance {
  readonly owner_files: readonly string[];
  readonly owner_globs?: readonly string[];
  readonly invariants?: readonly GovernanceInvariant[];
  readonly do_not?: readonly string[];
}

export interface TaskGraph {
  readonly depends_on: readonly string[];
}

export interface TaskKnowledge {
  readonly spec_files?: readonly string[];
  readonly adr_files?: readonly string[];
  readonly invariant_urns?: readonly string[];
  readonly doc_urns?: readonly string[];
}

export interface VerifyCommandIR {
  readonly cmd: string;
  readonly expected_exit_code?: number;
  readonly expected_output?: string;
}

export interface TaskVerification {
  readonly commands: readonly VerifyCommandIR[];
  readonly acceptance_criteria: readonly string[];
}

export interface TaskProjections {
  readonly taskos_code?: string;
  readonly github_issue_number?: number | null;
  readonly orm_task_code?: string;
  readonly external_ref?: string;
}

export interface PlanTaskIR {
  readonly urn: string;
  readonly code: string;
  readonly kind: "task" | "milestone" | "epic" | "subtask" | "gate";
  readonly parent_urn?: string;
  readonly title: string;
  readonly lifecycle: TaskLifecycle;
  readonly governance: TaskGovernance;
  readonly graph: TaskGraph;
  readonly knowledge: TaskKnowledge;
  readonly verification: TaskVerification;
  readonly projections: TaskProjections;
}

export interface AcceptanceCriterionIR {
  readonly criterion: string;
  readonly satisfied: boolean;
}

export interface ProofCommandRecord {
  readonly cmd: string;
  readonly exit_code: number;
  readonly duration_ms: number;
  readonly stdout_sha256: string;
  readonly stderr_sha256: string;
  readonly redacted_excerpt: string;
}

export interface ProofEnvelope {
  readonly schema_version: "1.0.0";
  readonly task_urn: string;
  readonly code: string;
  readonly parent_proof_hashes: readonly string[];
  readonly commands: readonly ProofCommandRecord[];
  readonly diff_files: readonly string[];
  readonly owner_files_verified: boolean;
  readonly acceptance_criteria_state: readonly AcceptanceCriterionIR[];
  readonly commit_sha: string | null;
  readonly model_tier: ModelTier;
  readonly agent_runtime: string;
  readonly verified_at: string;
  readonly envelope_sha256: string;
}

export interface DocumentNodeIR {
  readonly urn: string;
  readonly slug: string;
  readonly layer: DocLayer;
  readonly title: string;
  readonly path: string;
  readonly status: "draft" | "in_review" | "accepted" | "implemented" | "superseded" | "archived";
  readonly linked_task_urns: readonly string[];
  readonly tags: readonly string[];
}

export type PlanBundleFormat = "plan-taskos/v1" | "legacy-markdown";

export interface LoadedPlanBundle {
  readonly format: PlanBundleFormat;
  readonly manifest: PlanManifest;
  readonly waves: readonly WaveDefinition[];
  readonly documents: readonly DocumentNodeIR[];
  readonly source_path: string;
}

export interface ProjectionDiff {
  readonly added: readonly unknown[];
  readonly changed: readonly unknown[];
  readonly removed: readonly unknown[];
  readonly content_hash: string;
}

export interface ProjectionApplyResult {
  readonly success: boolean;
  readonly applied_changes: number;
  readonly errors?: readonly string[];
}

export interface ProjectionAdapter<TPlanOut = unknown> {
  readonly name: string;
  readonly authorityPlanes: readonly AuthorityPlane[];
  planSync(
    bundle: LoadedPlanBundle,
    options?: TPlanOut
  ): Promise<ProjectionDiff>;
  applySync(
    bundle: LoadedPlanBundle,
    diff: ProjectionDiff,
    options?: TPlanOut
  ): Promise<ProjectionApplyResult>;
}