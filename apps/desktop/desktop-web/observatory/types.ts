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

export type ObservatoryPlanDagState = 'done' | 'active' | 'ready' | 'blocked';

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
  readonly delta?: number;
  readonly cacheHitPct?: number;
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
  readonly targetRuntime?: ObservatoryRuntime | null;
  readonly focus: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly errorCount?: number;
  readonly steps: number;
  readonly cost?: number;
  readonly tokens: ObservatoryTokenUsageDto;
  readonly subagents: readonly ObservatorySubagentDto[];
  readonly swarmWorkers: number;
  readonly toolCounts?: Readonly<Record<string, number>>;
  readonly updatedAt: string;
  readonly mtimeMs: number;
  readonly recentEvents: readonly ObservatoryEventDto[];
}

export interface ObservatorySessionDetailDto extends ObservatorySessionSummaryDto {
  readonly detail: {
    readonly events: readonly ObservatoryEventDto[];
    readonly subagents?: readonly ObservatorySubagentDto[];
    readonly toolCounts?: Readonly<Record<string, number>>;
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
  readonly depIds?: readonly string[];
  readonly dependents?: readonly string[];
  readonly dagState?: ObservatoryPlanDagState;
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

export interface ObservatoryPlanDagNodeDto {
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

export interface ObservatoryPlanDagEdgeDto {
  readonly from: string;
  readonly to: string;
  readonly satisfied: boolean;
}

export interface ObservatoryPlanDagDto {
  readonly nodes: readonly ObservatoryPlanDagNodeDto[];
  readonly edges: readonly ObservatoryPlanDagEdgeDto[];
  readonly criticalPathIds: readonly string[];
  readonly stats: {
    readonly done: number;
    readonly active: number;
    readonly ready: number;
    readonly blocked: number;
  };
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
  readonly dag?: ObservatoryPlanDagDto | null;
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

export interface ObservatoryGitDirtyFileDto {
  readonly code: string;
  readonly status: 'untracked' | 'deleted' | 'added' | 'renamed' | 'modified';
  readonly path: string;
  readonly area: string;
}

export interface ObservatoryGitCommitDetailDto {
  readonly sha: string;
  readonly header: string;
  readonly changedFiles: readonly {
    readonly added: number;
    readonly removed: number;
    readonly path: string;
  }[];
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

export interface ObservatoryMagpieSummaryDto {
  readonly connected: boolean;
  readonly addr: string | null;
  readonly version: string | null;
  readonly totalRecentCalls: number;
  readonly okCalls: number;
  readonly rateLimit429: number;
  readonly errorCalls: number;
  readonly avgLatencyMs: number;
  readonly avgTtftMs: number;
  readonly providers: readonly {
    readonly provider: string;
    readonly calls: number;
    readonly ok: number;
    readonly rateLimits: number;
    readonly errors: number;
    readonly tokens: number;
    readonly avgMs: number;
    readonly models: readonly string[];
  }[];
  readonly memoryStats: {
    readonly day: string;
    readonly searches: number;
    readonly found: number;
    readonly recalled: number;
    readonly created: number;
  } | null;
  readonly recentRoutes: readonly {
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
  }[];
  readonly routedRuntimes: readonly ObservatoryRuntime[];
}

export interface ObservatoryBattleTelemetryDto {
  readonly bossName: string;
  readonly bossHpPct: number;
  readonly bossShieldCount: number;
  readonly readyStrikeCount: number;
  readonly activeWarriors: number;
  readonly sidekickSwarmCount: number;
  readonly glitchCount: number;
  readonly magpieBoostCalls: number;
}

export interface ObservatoryFlowNodeDto {
  readonly id: string;
  readonly tier: number;
  readonly kind:
    | 'hub'
    | 'runtime'
    | 'agent'
    | 'subagent'
    | 'swarm'
    | 'plan-wave'
    | 'workspace-area'
    | 'infra';
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

export interface ObservatoryFlowEdgeDto {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly runtime: string;
  readonly weight: number;
  readonly active: boolean;
  readonly label?: string;
}

export interface ObservatoryFlowPulseDto {
  readonly id: string;
  readonly at: string;
  readonly runtime: ObservatoryRuntime;
  readonly kind: string;
  readonly tool: string;
  readonly summary: string;
  readonly fromNode: string;
  readonly toNode: string;
}

export interface ObservatoryFlowGraphDto {
  readonly nodes: readonly ObservatoryFlowNodeDto[];
  readonly edges: readonly ObservatoryFlowEdgeDto[];
  readonly pulses: readonly ObservatoryFlowPulseDto[];
}

export interface ObservatoryAnalyticsDto {
  readonly toolFrequency: readonly {
    readonly name: string;
    readonly calls: number;
    readonly errors: number;
    readonly runtimes: readonly string[];
  }[];
  readonly runtimeBreakdown: readonly {
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
  }[];
  readonly modelBreakdown: readonly {
    readonly model: string;
    readonly runtime: ObservatoryRuntime;
    readonly sessions: number;
    readonly tokens: number;
    readonly steps: number;
  }[];
  readonly activityBuckets: readonly {
    readonly index: number;
    readonly label: string;
    readonly total: number;
    readonly tools: number;
    readonly subagents: number;
    readonly errors: number;
  }[];
  readonly errorLedger: readonly {
    readonly at: string;
    readonly runtime: ObservatoryRuntime;
    readonly runtimeLabel: string;
    readonly sessionId: string;
    readonly sessionTitle: string;
    readonly tool: string;
    readonly message: string;
  }[];
}

export interface ObservatoryTelemetryHistoryPointDto {
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

export interface ObservatorySnapshotDto {
  readonly version?: number;
  readonly generatedAt: string;
  readonly repoRoot: string;
  readonly antigravityApiConnected: boolean;
  readonly host: {
    readonly hostname: string;
    readonly platform: string;
    readonly arch?: string;
    readonly cpus: number;
    readonly cpuModel?: string;
    readonly cpuPct?: number;
    readonly memUsedGb: number;
    readonly memTotalGb: number;
    readonly memPct: number;
    readonly uptimeSec: number;
  };
  readonly summary: {
    readonly totalSessions: number;
    readonly runningSessions: number;
    readonly errorSessions?: number;
    readonly subagents: number;
    readonly swarms: number;
    readonly runtimeCounts: Readonly<Record<string, number>>;
    readonly tokens: ObservatoryTokenUsageDto;
  };
  readonly plans: readonly ObservatoryPlanSummaryDto[];
  readonly defaultPlanId: string | null;
  readonly sessions: readonly ObservatorySessionSummaryDto[];
  readonly swarms: readonly ObservatorySwarmSummaryDto[];
  readonly magpie?: ObservatoryMagpieSummaryDto;
  readonly battle?: ObservatoryBattleTelemetryDto;
  readonly activityFeed: readonly ObservatoryActivityFeedItemDto[];
  readonly git: {
    readonly branch: string;
    readonly head: string;
    readonly ahead?: number;
    readonly behind?: number;
    readonly stashCount?: number;
    readonly dirtyCount: number;
    readonly dirtyFiles?: readonly ObservatoryGitDirtyFileDto[];
    readonly dirtyByArea?: Readonly<Record<string, number>>;
    readonly diffStat?: {
      readonly filesChanged: number;
      readonly insertions: number;
      readonly deletions: number;
    };
    readonly commits: readonly ObservatoryGitCommitDto[];
    readonly updatedAt: string | null;
  };
  readonly probes: {
    readonly vps: readonly ObservatoryProbeResultDto[];
    readonly localPorts: readonly ObservatoryLocalPortResultDto[];
    readonly updatedAt: string | null;
  };
  readonly flowGraph?: ObservatoryFlowGraphDto;
  readonly analytics?: ObservatoryAnalyticsDto;
  readonly telemetryHistory?: readonly ObservatoryTelemetryHistoryPointDto[];
}
