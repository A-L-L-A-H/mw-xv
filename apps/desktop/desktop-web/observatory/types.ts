export type ObservatoryRuntime =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'qoder'
  | 'gemini-cli'
  | 'desktop-worktree'
  | 'visual-swarm';

export type ObservatorySessionStatus = 'running' | 'recent' | 'error' | 'idle';

export interface ObservatorySubagentDto {
  readonly id: string;
  readonly role: string;
  readonly type: string;
  readonly model: string;
  readonly status?: string;
  readonly at: string;
}

export interface ObservatoryEventDto {
  readonly at: string;
  readonly kind: string;
  readonly tool: string;
  readonly summary: string;
}

export interface ObservatoryTokenUsageDto {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly total: number;
}

export interface ObservatorySessionSummaryDto {
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
  readonly tokens: ObservatoryTokenUsageDto;
  readonly subagents: readonly ObservatorySubagentDto[];
  readonly swarmWorkers: number;
  readonly updatedAt: string;
  readonly mtimeMs: number;
  readonly recentEvents: readonly ObservatoryEventDto[];
}

export interface ObservatorySessionDetailDto extends ObservatorySessionSummaryDto {
  readonly detail: {
    readonly events: readonly ObservatoryEventDto[];
    readonly subagents?: readonly ObservatorySubagentDto[];
  };
}

export interface ObservatoryPlanTaskDto {
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
  readonly commitSha: string | null;
  readonly commitSubject: string | null;
}

export interface ObservatoryPlanWaveDto {
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

export interface ObservatoryPlanSummaryDto {
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
  readonly waves: readonly ObservatoryPlanWaveDto[];
  readonly tasks: readonly ObservatoryPlanTaskDto[];
}

export interface ObservatorySwarmSummaryDto {
  readonly runtime: ObservatoryRuntime;
  readonly conversationId?: string;
  readonly title: string;
  readonly line: string;
  readonly updatedAt?: string | null;
  readonly workers: readonly {
    readonly name: string;
    readonly role?: string;
    readonly status?: string;
    readonly progress?: number;
    readonly task: string;
  }[];
  readonly threads?: readonly {
    readonly id: string;
    readonly title: string;
    readonly tasks: readonly string[];
  }[];
}

export interface ObservatoryActivityFeedItemDto extends ObservatoryEventDto {
  readonly runtime: ObservatoryRuntime;
  readonly runtimeLabel: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
}

export interface ObservatoryGitCommitDto {
  readonly sha: string;
  readonly at: string;
  readonly author: string;
  readonly subject: string;
  readonly taskId: string | null;
}

export interface ObservatoryProbeResultDto {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly status: 'up' | 'warn' | 'down' | 'pending' | 'blocked';
  readonly httpCode: number | null;
  readonly latencyMs: number | null;
  readonly detail: string;
}

export interface ObservatoryLocalPortResultDto {
  readonly port: number;
  readonly label: string;
  readonly open: boolean;
}

export interface ObservatorySnapshotDto {
  readonly generatedAt: string;
  readonly repoRoot: string;
  readonly antigravityApiConnected: boolean;
  readonly host: {
    readonly hostname: string;
    readonly platform: string;
    readonly cpus: number;
    readonly memUsedGb: number;
    readonly memTotalGb: number;
    readonly memPct: number;
    readonly uptimeSec: number;
  };
  readonly summary: {
    readonly totalSessions: number;
    readonly runningSessions: number;
    readonly subagents: number;
    readonly swarms: number;
    readonly runtimeCounts: Readonly<Record<string, number>>;
    readonly tokens: ObservatoryTokenUsageDto;
  };
  readonly plans: readonly ObservatoryPlanSummaryDto[];
  readonly defaultPlanId: string | null;
  readonly sessions: readonly ObservatorySessionSummaryDto[];
  readonly swarms: readonly ObservatorySwarmSummaryDto[];
  readonly activityFeed: readonly ObservatoryActivityFeedItemDto[];
  readonly git: {
    readonly branch: string;
    readonly head: string;
    readonly dirtyCount: number;
    readonly commits: readonly ObservatoryGitCommitDto[];
    readonly updatedAt: string | null;
  };
  readonly probes: {
    readonly vps: readonly ObservatoryProbeResultDto[];
    readonly localPorts: readonly ObservatoryLocalPortResultDto[];
    readonly updatedAt: string | null;
  };
}
