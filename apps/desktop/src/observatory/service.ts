import { existsSync, watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesktopCapabilityBridge } from '../types.js';
import {
  buildFlowGraph,
  computeAnalytics,
  computeBattleTelemetry,
  formatSnapshotMarkdown,
} from './analytics.js';
import { AntigravityCollector } from './antigravity-collector.js';
import { ExternalAgentsCollector } from './external-agents-collector.js';
import {
  collectGitState,
  createCpuSampler,
  DEFAULT_LOCAL_PORTS,
  DEFAULT_VPS_PROBE_TARGETS,
  isBlockedProbeUrl,
  probeHttpTarget,
  probeLocalPorts,
  probeVpsTargets,
  readGitCommitDetail,
} from './infra-collector.js';
import { clipRedacted, normalizePathSlashes } from './io.js';
import { buildPlanDag, collectPlans } from './plan-collector.js';
import type {
  InternalObservatorySession,
  ObservatoryActivityFeedItem,
  ObservatoryGitCommitDetail,
  ObservatoryGitState,
  ObservatoryLocalPortTarget,
  ObservatoryProbeResult,
  ObservatoryProbesState,
  ObservatoryProbeTarget,
  ObservatoryRuntime,
  ObservatoryServiceOptions,
  ObservatorySessionDetail,
  ObservatorySessionSummary,
  ObservatorySnapshot,
  ObservatorySwarmSummary,
  ObservatoryTelemetryHistoryPoint,
} from './types.js';

export type ObservatorySnapshotListener = (snapshot: ObservatorySnapshot, json: string) => void;

const TELEMETRY_HISTORY_LIMIT = 120;

export class DesktopObservatoryService {
  private readonly repoRoot: string;
  private readonly homeDir: string;
  private readonly bridge: DesktopCapabilityBridge | undefined;
  private readonly knownSecrets: readonly string[];
  private readonly probeTargets: readonly ObservatoryProbeTarget[];
  private readonly localPorts: readonly ObservatoryLocalPortTarget[];
  private readonly enableNetworkProbes: boolean;
  private readonly sseTickMs: number;
  private readonly antigravityCollector: AntigravityCollector;
  private readonly externalCollector: ExternalAgentsCollector;
  private readonly sampleCpuPct: () => number;

  private readonly subscribers = new Set<ObservatorySnapshotListener>();
  private readonly telemetryHistory: ObservatoryTelemetryHistoryPoint[] = [];
  private previousTokensTotal: number | null = null;
  private lastSnapshot: ObservatorySnapshot | null = null;
  private lastSnapshotJson = '';
  private lastRawSessions: readonly InternalObservatorySession[] = [];
  private gitState: ObservatoryGitState = {
    branch: 'unknown',
    head: '',
    ahead: 0,
    behind: 0,
    stashCount: 0,
    dirtyCount: 0,
    dirtyFiles: [],
    dirtyByArea: {},
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    commits: [],
    commitByTaskId: {},
    updatedAt: null,
  };
  private probesState: ObservatoryProbesState;
  private refreshPromise: Promise<ObservatorySnapshot> | null = null;
  private sseTimer: ReturnType<typeof setInterval> | null = null;
  private gitTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private planWatcher: FSWatcher | null = null;
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: ObservatoryServiceOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.homeDir = options.homeDir ?? os.homedir();
    this.bridge = options.bridge;
    this.knownSecrets = options.knownSecrets ?? [];
    this.probeTargets = options.probeTargets ?? DEFAULT_VPS_PROBE_TARGETS;
    this.localPorts = options.localPorts ?? DEFAULT_LOCAL_PORTS;
    this.enableNetworkProbes = options.enableNetworkProbes ?? true;
    this.sseTickMs = options.sseTickMs ?? 2_000;
    this.sampleCpuPct = createCpuSampler();

    this.antigravityCollector = new AntigravityCollector({
      homeDir: this.homeDir,
      ...(options.env ? { env: options.env } : {}),
      enableLiveApi: options.enableAntigravityApi ?? true,
      knownSecrets: this.knownSecrets,
    });
    this.externalCollector = new ExternalAgentsCollector({
      homeDir: this.homeDir,
      knownSecrets: this.knownSecrets,
      enableLocalPortProbe: this.enableNetworkProbes,
    });
    this.probesState = {
      vps: this.probeTargets.map((target) => ({
        ...target,
        status: 'pending',
        httpCode: null,
        latencyMs: null,
        detail: '',
      })),
      localPorts: this.localPorts.map((item) => ({ ...item, open: false })),
      updatedAt: null,
    };
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  isPollingActive(): boolean {
    return this.sseTimer !== null;
  }

  private async refreshGitAndApi(): Promise<void> {
    const [nextGit] = await Promise.all([
      collectGitState(this.repoRoot, this.knownSecrets),
      this.antigravityCollector.refreshLiveApi().catch(() => false),
    ]);
    this.gitState = nextGit;
  }

  private async refreshProbes(): Promise<void> {
    if (!this.enableNetworkProbes) {
      this.probesState = {
        vps: this.probeTargets.map((target) => ({
          ...target,
          status: 'pending',
          httpCode: null,
          latencyMs: null,
          detail: 'probes disabled',
        })),
        localPorts: this.localPorts.map((item) => ({ ...item, open: false })),
        updatedAt: new Date().toISOString(),
      };
      return;
    }

    const [vps, localPorts] = await Promise.all([
      probeVpsTargets(this.probeTargets),
      probeLocalPorts(this.localPorts),
    ]);
    this.probesState = {
      vps,
      localPorts,
      updatedAt: new Date().toISOString(),
    };
  }

  private async collectSnapshotInternal(): Promise<ObservatorySnapshot> {
    const [
      planBundle,
      agBundle,
      claudeSessions,
      codexSessions,
      openCodeSessions,
      magpieBundle,
      qoderSessions,
      geminiSessions,
      desktopWorktrees,
      localSwarm,
    ] = await Promise.all([
      collectPlans(this.repoRoot, this.knownSecrets),
      this.antigravityCollector.collect(this.repoRoot),
      this.externalCollector.collectClaude(this.repoRoot),
      this.externalCollector.collectCodex(this.repoRoot),
      this.externalCollector.collectOpenCode(this.repoRoot),
      this.externalCollector.collectMagpieTelemetry(this.repoRoot),
      this.externalCollector.collectGenericJsonl(
        path.join(this.homeDir, '.qoder', 'projects'),
        'qoder',
        'Qoder',
        this.repoRoot
      ),
      this.externalCollector.collectGenericJsonl(
        path.join(this.homeDir, '.gemini', 'tmp'),
        'gemini-cli',
        'Gemini CLI',
        this.repoRoot
      ),
      this.externalCollector.collectDesktopWorktrees(this.bridge, this.repoRoot),
      this.externalCollector.collectLocalSwarmManifest(this.repoRoot),
    ]);

    const allSessions: InternalObservatorySession[] = [
      ...desktopWorktrees,
      ...agBundle.sessions,
      ...claudeSessions,
      ...codexSessions,
      ...openCodeSessions,
      ...magpieBundle.sessions,
      ...qoderSessions,
      ...geminiSessions,
    ].sort((left, right) => right.mtimeMs - left.mtimeMs);

    this.lastRawSessions = allSessions;

    const publicSessions: ObservatorySessionSummary[] = allSessions.map((session) => {
      const { sourcePath: _ignored, ...rest } = session;
      return rest;
    });

    for (const plan of planBundle.plans) {
      for (const task of plan.tasks) {
        const hit = this.gitState.commitByTaskId[task.id];
        if (hit) {
          task.commitSha = hit.sha;
          task.commitSubject = hit.subject;
        }
      }
      plan.dag = buildPlanDag(plan.tasks, plan.waves, publicSessions, this.gitState.dirtyFiles);
    }

    const activityFeed: ObservatoryActivityFeedItem[] = [];
    for (const session of publicSessions.slice(0, 30)) {
      for (const event of session.recentEvents) {
        activityFeed.push({
          ...event,
          at: event.at || session.updatedAt,
          runtime: session.runtime,
          runtimeLabel: session.runtimeLabel,
          sessionId: session.id,
          sessionTitle: clipRedacted(session.title, 48, this.knownSecrets),
        });
      }
    }
    activityFeed.sort((left, right) => right.at.localeCompare(left.at));

    const runtimeCounts: Record<string, number> = {};
    let runningSessions = 0;
    let errorSessions = 0;
    let subagents = 0;
    let totalInput = 0;
    let totalCached = 0;
    let totalOutput = 0;

    for (const session of publicSessions) {
      runtimeCounts[session.runtime] = (runtimeCounts[session.runtime] ?? 0) + 1;
      if (session.status === 'running') runningSessions += 1;
      if (session.status === 'error' || session.lastError) errorSessions += 1;
      subagents += session.subagents.length;
      totalInput += session.tokens.input;
      totalCached += session.tokens.cached;
      totalOutput += session.tokens.output;
    }

    const swarms: ObservatorySwarmSummary[] = [...agBundle.swarms];
    if (localSwarm) swarms.push(localSwarm);

    const memTotalGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
    const memUsedGb = Math.round(((os.totalmem() - os.freemem()) / 1024 ** 3) * 10) / 10;
    const memPct = memTotalGb > 0 ? Math.round((memUsedGb / memTotalGb) * 100) : 0;
    const cpuPct = this.sampleCpuPct();
    const tokensTotal = totalInput + totalOutput;
    const tokenDelta =
      this.previousTokensTotal === null ? 0 : Math.max(0, tokensTotal - this.previousTokensTotal);
    this.previousTokensTotal = tokensTotal;
    const cacheDenom = totalInput + totalCached;
    const cacheHitPct = cacheDenom > 0 ? Math.round((totalCached / cacheDenom) * 1000) / 10 : 0;

    const vpsProbes = this.probesState.vps;
    const upProbes = vpsProbes.filter((probe) => probe.status === 'up');
    const measuredLatencies = vpsProbes
      .map((probe) => probe.latencyMs)
      .filter((ms): ms is number => typeof ms === 'number' && ms >= 0);
    const vpsAvgLatencyMs =
      measuredLatencies.length > 0
        ? Math.round(measuredLatencies.reduce((acc, ms) => acc + ms, 0) / measuredLatencies.length)
        : 0;

    const nowIso = new Date().toISOString();
    const recentWindowCutoffMs = Date.now() - 120_000;
    const recentEventsInWindow = activityFeed.filter(
      (entry) => Date.parse(entry.at || '') >= recentWindowCutoffMs
    );

    this.telemetryHistory.push({
      at: nowIso,
      cpuPct,
      memPct,
      runningSessions,
      totalSessions: publicSessions.length,
      subagents,
      tokensTotal,
      tokenDelta,
      recentEvents: recentEventsInWindow.length,
      errors: errorSessions,
      vpsUp: upProbes.length,
      vpsAvgLatencyMs,
    });
    if (this.telemetryHistory.length > TELEMETRY_HISTORY_LIMIT) {
      this.telemetryHistory.shift();
    }

    const activePlan =
      planBundle.plans.find((plan) => plan.id === planBundle.defaultPlanId) ??
      planBundle.plans[0] ??
      null;
    const flowGraph = buildFlowGraph(
      publicSessions,
      swarms,
      activePlan,
      this.gitState,
      this.probesState,
      activityFeed,
      this.repoRoot,
      this.knownSecrets
    );
    const analytics = computeAnalytics(publicSessions, activityFeed, Date.now(), this.knownSecrets);
    const battle = computeBattleTelemetry(
      activePlan,
      runningSessions,
      subagents,
      errorSessions,
      vpsProbes,
      magpieBundle.summary,
      this.knownSecrets
    );

    return {
      version: 3,
      generatedAt: nowIso,
      repoRoot: normalizePathSlashes(this.repoRoot),
      antigravityApiConnected: agBundle.connectedApi,
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpuModel: clipRedacted(os.cpus()[0]?.model ?? 'CPU', 48, this.knownSecrets),
        cpuPct,
        memUsedGb,
        memTotalGb,
        memPct,
        uptimeSec: Math.round(process.uptime()),
      },
      summary: {
        totalSessions: publicSessions.length,
        runningSessions,
        errorSessions,
        subagents,
        swarms: swarms.length,
        runtimeCounts,
        tokens: {
          input: totalInput,
          cached: totalCached,
          output: totalOutput,
          total: tokensTotal,
          delta: tokenDelta,
          cacheHitPct,
        },
      },
      plans: planBundle.plans,
      defaultPlanId: planBundle.defaultPlanId,
      sessions: publicSessions,
      swarms,
      magpie: magpieBundle.summary,
      battle,
      activityFeed: activityFeed.slice(0, 90),
      git: this.gitState,
      probes: this.probesState,
      flowGraph,
      analytics,
      telemetryHistory: this.telemetryHistory.slice(),
    };
  }

  async getSnapshot(options: { readonly fresh?: boolean } = {}): Promise<ObservatorySnapshot> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const run = async (): Promise<ObservatorySnapshot> => {
      if (options.fresh || !this.lastSnapshot) {
        await Promise.all([this.refreshGitAndApi(), this.refreshProbes()]);
      }
      const snapshot = await this.collectSnapshotInternal();
      this.lastSnapshot = snapshot;
      this.lastSnapshotJson = JSON.stringify(snapshot);
      return snapshot;
    };

    this.refreshPromise = run().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async getSessionDetail(
    runtime: ObservatoryRuntime,
    id: string
  ): Promise<ObservatorySessionDetail | null> {
    if (this.lastRawSessions.length === 0) {
      await this.getSnapshot();
    }
    const target = this.lastRawSessions.find(
      (session) => session.runtime === runtime && session.id === id
    );
    if (!target) return null;

    const { sourcePath, ...publicSession } = target;
    if (!sourcePath) {
      return {
        ...publicSession,
        detail: {
          events: target.recentEvents,
          subagents: target.subagents,
          toolCounts: target.toolCounts,
        },
      };
    }

    const fileStat = await stat(sourcePath).catch(() => null);
    if (!fileStat) {
      return {
        ...publicSession,
        detail: {
          events: target.recentEvents,
          subagents: target.subagents,
          toolCounts: target.toolCounts,
        },
      };
    }

    if (runtime === 'antigravity') {
      const parsed = await this.antigravityCollector.parseTranscript(id, sourcePath, fileStat, true);
      return {
        ...publicSession,
        detail: {
          events: parsed.events,
          subagents: target.subagents,
          toolCounts: parsed.toolCounts,
        },
      };
    }
    if (runtime === 'claude') {
      const parsed = await this.externalCollector.parseClaudeSession(
        id,
        sourcePath,
        fileStat,
        path.dirname(sourcePath),
        true
      );
      return {
        ...publicSession,
        detail: {
          events: parsed.events,
          subagents: target.subagents,
          toolCounts: parsed.toolCounts,
        },
      };
    }
    if (runtime === 'codex') {
      const parsed = await this.externalCollector.parseCodexRollout(sourcePath, fileStat, true);
      return {
        ...publicSession,
        detail: {
          events: parsed.events,
          toolCounts: parsed.toolCounts,
        },
      };
    }
    if (runtime === 'opencode') {
      const parsed = this.externalCollector.readOpenCodeDetail(sourcePath, id);
      return {
        ...publicSession,
        detail: {
          events: parsed.events,
          subagents: target.subagents,
          toolCounts: parsed.toolCounts,
        },
      };
    }

    return {
      ...publicSession,
      detail: {
        events: target.recentEvents,
        subagents: target.subagents,
        toolCounts: target.toolCounts,
      },
    };
  }

  async getCommitDetail(rawSha: string): Promise<ObservatoryGitCommitDetail | null> {
    return readGitCommitDetail(this.repoRoot, rawSha, this.knownSecrets);
  }

  async probeCustomUrl(rawUrl: string): Promise<ObservatoryProbeResult> {
    const trimmed = rawUrl.trim();
    if (!trimmed || isBlockedProbeUrl(trimmed)) {
      return {
        id: 'custom-probe',
        label: trimmed || 'Invalid URL',
        url: trimmed,
        status: 'blocked',
        httpCode: null,
        latencyMs: 0,
        detail: 'Blocked by SSRF or invalid URL guard',
      };
    }
    return probeHttpTarget({
      id: `custom-${Date.now()}`,
      label: trimmed,
      url: trimmed,
    });
  }

  async exportReportMarkdown(): Promise<string> {
    const snap = this.lastSnapshot ?? (await this.getSnapshot());
    return formatSnapshotMarkdown(snap);
  }

  private async broadcast(force = false): Promise<void> {
    if (this.stopped || this.subscribers.size === 0) return;
    const snapshot = await this.collectSnapshotInternal();
    const nextJson = JSON.stringify(snapshot);
    this.lastSnapshot = snapshot;
    if (force || nextJson !== this.lastSnapshotJson) {
      this.lastSnapshotJson = nextJson;
      for (const listener of this.subscribers) {
        try {
          listener(snapshot, nextJson);
        } catch {
          this.subscribers.delete(listener);
        }
      }
      if (this.subscribers.size === 0) {
        this.stopPolling();
      }
    }
  }

  private startPolling(): void {
    if (this.stopped || this.sseTimer !== null) return;

    this.sseTimer = setInterval(() => {
      void this.broadcast(false);
    }, this.sseTickMs);
    this.sseTimer.unref();

    this.gitTimer = setInterval(() => {
      void this.refreshGitAndApi();
    }, 4_000);
    this.gitTimer.unref();

    this.probeTimer = setInterval(() => {
      void this.refreshProbes();
    }, 10_000);
    this.probeTimer.unref();

    const planDir = path.join(this.repoRoot, '.plan');
    if (existsSync(planDir)) {
      try {
        this.planWatcher = watch(planDir, { recursive: true }, () => {
          if (this.watchDebounce) clearTimeout(this.watchDebounce);
          this.watchDebounce = setTimeout(() => {
            void this.refreshGitAndApi().then(() => this.broadcast(true));
          }, 200);
          this.watchDebounce.unref();
        });
      } catch {
        this.planWatcher = null;
      }
    }
  }

  private stopPolling(): void {
    if (this.sseTimer) {
      clearInterval(this.sseTimer);
      this.sseTimer = null;
    }
    if (this.gitTimer) {
      clearInterval(this.gitTimer);
      this.gitTimer = null;
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    if (this.planWatcher) {
      this.planWatcher.close();
      this.planWatcher = null;
    }
  }

  subscribe(listener: ObservatorySnapshotListener): () => void {
    if (this.stopped) return () => {};
    const wasEmpty = this.subscribers.size === 0;
    this.subscribers.add(listener);
    if (wasEmpty) {
      this.startPolling();
    }
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0) {
        this.stopPolling();
      }
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.subscribers.clear();
    this.stopPolling();
  }
}
