import type { DesktopCapabilityBridge } from '../types.js';

export type ObservatoryRuntime =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'qoder'
  | 'gemini-cli'
  | 'desktop-worktree'
  | 'visual-swarm';

export type ObservatorySessionStatus = 'running' | 'recent' | 'error' | 'idle';

export type ObservatoryEventKind = 'focus' | 'tool' | 'subagent' | 'swarm' | 'message' | 'user' | 'error';

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
  readonly focus: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly steps: number;
  readonly tokens: ObservatoryTokenUsage;
  readonly subagents: readonly ObservatorySubagent[];
  readonly swarmWorkers: number;
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
  readonly acceptance: string;
  readonly expected: string;
  readonly verify: string;
  readonly spec: string;
  commitSha: string | null;
  commitSubject: string | null;
}

export interface ObservatoryPlanWave {
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly percent: number;
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

export interface ObservatoryGitState {
  readonly branch: string;
  readonly head: string;
  readonly dirtyCount: number;
  readonly commits: readonly ObservatoryGitCommit[];
  readonly commitByTaskId: Readonly<Record<string, ObservatoryGitTaskCommit>>;
  readonly updatedAt: string | null;
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
  readonly cpus: number;
  readonly memUsedGb: number;
  readonly memTotalGb: number;
  readonly memPct: number;
  readonly uptimeSec: number;
}

export interface ObservatorySummaryCounts {
  readonly totalSessions: number;
  readonly runningSessions: number;
  readonly subagents: number;
  readonly swarms: number;
  readonly runtimeCounts: Readonly<Record<string, number>>;
  readonly tokens: ObservatoryTokenUsage;
}

export interface ObservatorySnapshot {
  readonly generatedAt: string;
  readonly repoRoot: string;
  readonly antigravityApiConnected: boolean;
  readonly host: ObservatoryHostTelemetry;
  readonly summary: ObservatorySummaryCounts;
  readonly plans: readonly ObservatoryPlanSummary[];
  readonly defaultPlanId: string | null;
  readonly sessions: readonly ObservatorySessionSummary[];
  readonly swarms: readonly ObservatorySwarmSummary[];
  readonly activityFeed: readonly ObservatoryActivityFeedItem[];
  readonly git: ObservatoryGitState;
  readonly probes: ObservatoryProbesState;
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
