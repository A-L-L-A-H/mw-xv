import type { DesktopCapabilityBridge } from '../types.js';

export type ObservatoryRuntime =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'magpie'
  | 'qoder'
  | 'gemini-cli'
  | 'desktop-worktree'
  | 'visual-swarm';

export type ObservatorySessionStatus = 'running' | 'recent' | 'error' | 'idle';

export type ObservatoryEventKind =
  | 'focus'
  | 'tool'
  | 'subagent'
  | 'swarm'
  | 'message'
  | 'user'
  | 'error';

export type ObservatoryPlanDagState = 'done' | 'active' | 'ready' | 'blocked';

export interface ObservatorySubagent {
  readonly id: string;
  readonly role: string;
  readonly type: string;
  readonly model: string;
  readonly status?: string;
  readonly at: string;
}

export interface ObservatoryEvent {
  readonly at: string;
  readonly kind: ObservatoryEventKind;
  readonly tool: string;
  readonly summary: string;
}

export interface ObservatoryTokenUsage {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly total: number;
  readonly delta?: number;
  readonly cacheHitPct?: number;
}

export interface ObservatorySessionSummary {
  readonly id: string;
  readonly runtime: ObservatoryRuntime;
  readonly runtimeLabel: string;
  readonly title: string;
  readonly status: ObservatorySessionStatus;
  readonly runState: string;
  readonly model: string;
  readonly branch: string | null;
  readonly cwd: string | null;
  readonly inCurrentWorkspace: boolean;
  readonly isCurrentSession: boolean;
  readonly parentId: string | null;
  readonly rootId: string | null;
  readonly targetRuntime?: ObservatoryRuntime | null;
  readonly focus: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly errorCount: number;
  readonly steps: number;
  readonly cost?: number;
  readonly tokens: ObservatoryTokenUsage;
  readonly subagents: readonly ObservatorySubagent[];
  readonly swarmWorkers: number;
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly updatedAt: string;
  readonly mtimeMs: number;
  readonly recentEvents: readonly ObservatoryEvent[];
}

export interface InternalObservatorySession extends ObservatorySessionSummary {
  readonly sourcePath?: string;
}

export interface ObservatorySessionDetail extends ObservatorySessionSummary {
  readonly detail: {
    readonly events: readonly ObservatoryEvent[];
    readonly subagents?: readonly ObservatorySubagent[];
    readonly toolCounts?: Readonly<Record<string, number>>;
  };
}

export interface ObservatoryPlanTask {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly wave: string;
  readonly playbook: string | null;
  readonly ownerFiles: string;
  readonly dependsOn: string;
  depIds: readonly string[];
  dependents: readonly string[];
  dagState: ObservatoryPlanDagState;
  readonly acceptance: string;
  readonly expected: string;
  readonly verify: string;
  readonly spec: string;
  commitSha: string | null;
  commitSubject: string | null;
  readonly proofSha256?: string | null;
  readonly attempts?: number;
  readonly leaseOwner?: string | null;
  readonly modelTier?: string | null;
}

export interface ObservatoryPlanWave {
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

export interface ObservatoryPlanDagNode {
  readonly id: string;
  readonly title: string;
  readonly wave: string;
  readonly waveIndex: number;
  readonly orderIndex: number;
  readonly depth: number;
  readonly state: ObservatoryPlanDagState;
  readonly done: boolean;
  readonly depIds: readonly string[];
  readonly dependents: readonly string[];
  readonly commitSha: string | null;
  readonly ownerFiles: string;
}

export interface ObservatoryPlanDagEdge {
  readonly from: string;
  readonly to: string;
  readonly satisfied: boolean;
}

export interface ObservatoryPlanDagStats {
  readonly done: number;
  readonly active: number;
  readonly ready: number;
  readonly blocked: number;
}

export interface ObservatoryPlanDag {
  readonly nodes: readonly ObservatoryPlanDagNode[];
  readonly edges: readonly ObservatoryPlanDagEdge[];
  readonly criticalPathIds: readonly string[];
  readonly stats: ObservatoryPlanDagStats;
}

export interface ObservatoryPlanSummary {
  readonly id: string;
  readonly title: string;
  readonly masterFile: string;
  readonly waveFiles: readonly string[];
  readonly updatedAt: string | null;
  readonly total: number;
  readonly done: number;
  readonly percent: number;
  readonly nextTaskId: string | null;
  readonly nextTaskTitle: string | null;
  readonly waves: readonly ObservatoryPlanWave[];
  readonly tasks: readonly ObservatoryPlanTask[];
  dag: ObservatoryPlanDag | null;
  readonly format?: 'plan-taskos/v1' | 'legacy-markdown';
  readonly merkleRoot?: string | null;
}

export interface ObservatorySwarmWorker {
  readonly name: string;
  readonly role?: string;
  readonly status?: string;
  readonly progress?: number;
  readonly task: string;
}

export interface ObservatorySwarmThread {
  readonly id: string;
  readonly title: string;
  readonly tasks: readonly string[];
}

export interface ObservatorySwarmSummary {
  readonly runtime: ObservatoryRuntime;
  readonly conversationId?: string;
  readonly title: string;
  readonly line: string;
  readonly updatedAt?: string | null;
  readonly workers: readonly ObservatorySwarmWorker[];
  readonly threads?: readonly ObservatorySwarmThread[];
}

export interface ObservatoryActivityFeedItem extends ObservatoryEvent {
  readonly runtime: ObservatoryRuntime;
  readonly runtimeLabel: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
}

export interface ObservatoryGitCommit {
  readonly sha: string;
  readonly at: string;
  readonly author: string;
  readonly subject: string;
  readonly taskId: string | null;
}

export interface ObservatoryGitTaskCommit {
  readonly sha: string;
  readonly subject: string;
  readonly at: string;
}

export interface ObservatoryGitDirtyFile {
  readonly code: string;
  readonly status: 'untracked' | 'deleted' | 'added' | 'renamed' | 'modified';
  readonly path: string;
  readonly area: string;
}

export interface ObservatoryGitDiffStat {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface ObservatoryGitState {
  readonly branch: string;
  readonly head: string;
  readonly ahead: number;
  readonly behind: number;
  readonly stashCount: number;
  readonly dirtyCount: number;
  readonly dirtyFiles: readonly ObservatoryGitDirtyFile[];
  readonly dirtyByArea: Readonly<Record<string, number>>;
  readonly diffStat: ObservatoryGitDiffStat;
  readonly commits: readonly ObservatoryGitCommit[];
  readonly commitByTaskId: Readonly<Record<string, ObservatoryGitTaskCommit>>;
  readonly updatedAt: string | null;
}

export interface ObservatoryGitCommitDetail {
  readonly sha: string;
  readonly header: string;
  readonly changedFiles: readonly {
    readonly added: number;
    readonly removed: number;
    readonly path: string;
  }[];
}

export interface ObservatoryProbeTarget {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export interface ObservatoryProbeResult extends ObservatoryProbeTarget {
  readonly status: 'up' | 'warn' | 'down' | 'pending' | 'blocked';
  readonly httpCode: number | null;
  readonly latencyMs: number | null;
  readonly detail: string;
}

export interface ObservatoryLocalPortTarget {
  readonly port: number;
  readonly label: string;
}

export interface ObservatoryLocalPortResult extends ObservatoryLocalPortTarget {
  readonly open: boolean;
}

export interface ObservatoryProbesState {
  readonly vps: readonly ObservatoryProbeResult[];
  readonly localPorts: readonly ObservatoryLocalPortResult[];
  readonly updatedAt: string | null;
}

export interface ObservatoryHostTelemetry {
  readonly hostname: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpus: number;
  readonly cpuModel: string;
  readonly cpuPct: number;
  readonly memUsedGb: number;
  readonly memTotalGb: number;
  readonly memPct: number;
  readonly uptimeSec: number;
}

export interface ObservatorySummaryCounts {
  readonly totalSessions: number;
  readonly runningSessions: number;
  readonly errorSessions: number;
  readonly subagents: number;
  readonly swarms: number;
  readonly runtimeCounts: Readonly<Record<string, number>>;
  readonly tokens: ObservatoryTokenUsage;
}

export interface ObservatoryMagpieProviderStats {
  readonly provider: string;
  readonly calls: number;
  readonly ok: number;
  readonly rateLimits: number;
  readonly errors: number;
  readonly tokens: number;
  readonly avgMs: number;
  readonly models: readonly string[];
}

export interface ObservatoryMagpieMemoryStats {
  readonly day: string;
  readonly searches: number;
  readonly found: number;
  readonly recalled: number;
  readonly created: number;
}

export interface ObservatoryMagpieRouteHop {
  readonly at: string;
  readonly agent: string;
  readonly targetRuntime: ObservatoryRuntime | null;
  readonly provider: string;
  readonly model: string;
  readonly status: number;
  readonly ms: number;
  readonly ttftMs: number;
  readonly tokens: number;
  readonly cached: number;
}

export interface ObservatoryMagpieSummary {
  readonly connected: boolean;
  readonly addr: string | null;
  readonly version: string | null;
  readonly totalRecentCalls: number;
  readonly okCalls: number;
  readonly rateLimit429: number;
  readonly errorCalls: number;
  readonly avgLatencyMs: number;
  readonly avgTtftMs: number;
  readonly providers: readonly ObservatoryMagpieProviderStats[];
  readonly memoryStats: ObservatoryMagpieMemoryStats | null;
  readonly recentRoutes: readonly ObservatoryMagpieRouteHop[];
  readonly routedRuntimes: readonly ObservatoryRuntime[];
}

export interface ObservatoryBattleTelemetry {
  readonly bossName: string;
  readonly bossHpPct: number;
  readonly bossShieldCount: number;
  readonly readyStrikeCount: number;
  readonly activeWarriors: number;
  readonly sidekickSwarmCount: number;
  readonly glitchCount: number;
  readonly magpieBoostCalls: number;
}

export type ObservatoryFlowNodeKind =
  | 'hub'
  | 'runtime'
  | 'agent'
  | 'subagent'
  | 'swarm'
  | 'plan-wave'
  | 'workspace-area'
  | 'infra';

export interface ObservatoryFlowNode {
  readonly id: string;
  readonly tier: number;
  readonly kind: ObservatoryFlowNodeKind;
  readonly runtime: string;
  readonly label: string;
  readonly sublabel: string;
  readonly status: ObservatorySessionStatus;
  readonly sessionId?: string;
  readonly parentSessionId?: string;
  readonly targetRuntime?: ObservatoryRuntime | null;
  readonly isCurrentSession?: boolean;
  readonly focus?: string;
  readonly model?: string;
  readonly lastError?: string;
  readonly planId?: string;
  readonly waveTitle?: string;
  readonly metrics: Readonly<Record<string, number | string | null>>;
}

export interface ObservatoryFlowEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind:
    | 'runtime-link'
    | 'session-link'
    | 'subagent-link'
    | 'swarm-link'
    | 'plan-link'
    | 'workspace-link'
    | 'infra-link'
    | 'router-link';
  readonly runtime: string;
  readonly weight: number;
  readonly active: boolean;
  readonly label?: string;
}

export interface ObservatoryFlowPulse {
  readonly id: string;
  readonly at: string;
  readonly runtime: ObservatoryRuntime;
  readonly kind: ObservatoryEventKind;
  readonly tool: string;
  readonly summary: string;
  readonly fromNode: string;
  readonly toNode: string;
}

export interface ObservatoryFlowGraph {
  readonly nodes: readonly ObservatoryFlowNode[];
  readonly edges: readonly ObservatoryFlowEdge[];
  readonly pulses: readonly ObservatoryFlowPulse[];
}

export interface ObservatoryToolFrequencyEntry {
  readonly name: string;
  readonly calls: number;
  readonly errors: number;
  readonly runtimes: readonly string[];
}

export interface ObservatoryRuntimeBreakdownEntry {
  readonly runtime: ObservatoryRuntime;
  readonly label: string;
  readonly sessions: number;
  readonly running: number;
  readonly subagents: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly errors: number;
  readonly cacheHitPct: number;
}

export interface ObservatoryModelBreakdownEntry {
  readonly model: string;
  readonly runtime: ObservatoryRuntime;
  readonly sessions: number;
  readonly tokens: number;
  readonly steps: number;
}

export interface ObservatoryActivityBucket {
  readonly index: number;
  readonly label: string;
  readonly total: number;
  readonly tools: number;
  readonly subagents: number;
  readonly errors: number;
}

export interface ObservatoryErrorLedgerEntry {
  readonly at: string;
  readonly runtime: ObservatoryRuntime;
  readonly runtimeLabel: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly tool: string;
  readonly message: string;
}

export interface ObservatoryAnalytics {
  readonly toolFrequency: readonly ObservatoryToolFrequencyEntry[];
  readonly runtimeBreakdown: readonly ObservatoryRuntimeBreakdownEntry[];
  readonly modelBreakdown: readonly ObservatoryModelBreakdownEntry[];
  readonly activityBuckets: readonly ObservatoryActivityBucket[];
  readonly errorLedger: readonly ObservatoryErrorLedgerEntry[];
}

export interface ObservatoryTelemetryHistoryPoint {
  readonly at: string;
  readonly cpuPct: number;
  readonly memPct: number;
  readonly runningSessions: number;
  readonly totalSessions: number;
  readonly subagents: number;
  readonly tokensTotal: number;
  readonly tokenDelta: number;
  readonly recentEvents: number;
  readonly errors: number;
  readonly vpsUp: number;
  readonly vpsAvgLatencyMs: number;
}

export interface ObservatorySnapshot {
  readonly version: 3;
  readonly generatedAt: string;
  readonly repoRoot: string;
  readonly antigravityApiConnected: boolean;
  readonly host: ObservatoryHostTelemetry;
  readonly summary: ObservatorySummaryCounts;
  readonly plans: readonly ObservatoryPlanSummary[];
  readonly defaultPlanId: string | null;
  readonly sessions: readonly ObservatorySessionSummary[];
  readonly swarms: readonly ObservatorySwarmSummary[];
  readonly magpie: ObservatoryMagpieSummary;
  readonly battle: ObservatoryBattleTelemetry;
  readonly activityFeed: readonly ObservatoryActivityFeedItem[];
  readonly git: ObservatoryGitState;
  readonly probes: ObservatoryProbesState;
  readonly flowGraph: ObservatoryFlowGraph;
  readonly analytics: ObservatoryAnalytics;
  readonly telemetryHistory: readonly ObservatoryTelemetryHistoryPoint[];
}

export interface ObservatoryServiceOptions {
  readonly repoRoot: string;
  readonly homeDir?: string;
  readonly bridge?: DesktopCapabilityBridge;
  readonly env?: NodeJS.ProcessEnv;
  readonly knownSecrets?: readonly string[];
  readonly probeTargets?: readonly ObservatoryProbeTarget[];
  readonly localPorts?: readonly ObservatoryLocalPortTarget[];
  readonly enableNetworkProbes?: boolean;
  readonly enableAntigravityApi?: boolean;
  readonly sseTickMs?: number;
}
