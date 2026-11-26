import path from 'node:path';
import { clipRedacted, normalizePathSlashes } from './io.js';
import type {
  ObservatoryActivityBucket,
  ObservatoryActivityFeedItem,
  ObservatoryAnalytics,
  ObservatoryBattleTelemetry,
  ObservatoryErrorLedgerEntry,
  ObservatoryFlowEdge,
  ObservatoryFlowGraph,
  ObservatoryFlowNode,
  ObservatoryFlowPulse,
  ObservatoryGitState,
  ObservatoryMagpieSummary,
  ObservatoryModelBreakdownEntry,
  ObservatoryPlanSummary,
  ObservatoryProbeResult,
  ObservatoryProbesState,
  ObservatoryRuntime,
  ObservatoryRuntimeBreakdownEntry,
  ObservatorySessionSummary,
  ObservatorySnapshot,
  ObservatorySwarmSummary,
  ObservatoryToolFrequencyEntry,
} from './types.js';

export const RUNTIME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  antigravity: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  magpie: 'Magpie Router',
  qoder: 'Qoder',
  'gemini-cli': 'Gemini CLI',
  'desktop-worktree': 'Desktop Sandbox',
  'visual-swarm': 'Visual Swarm',
});

export function buildFlowGraph(
  sessions: readonly ObservatorySessionSummary[],
  swarms: readonly ObservatorySwarmSummary[],
  activePlan: ObservatoryPlanSummary | null,
  gitState: ObservatoryGitState,
  probes: ObservatoryProbesState,
  activityFeed: readonly ObservatoryActivityFeedItem[],
  repoRoot: string,
  knownSecrets: readonly string[] = []
): ObservatoryFlowGraph {
  const nodes: ObservatoryFlowNode[] = [];
  const edges: ObservatoryFlowEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (nodeDef: ObservatoryFlowNode): void => {
    if (nodeIds.has(nodeDef.id)) return;
    nodeIds.add(nodeDef.id);
    nodes.push(nodeDef);
  };

  const repoName = path.basename(normalizePathSlashes(repoRoot)) || 'workspace';
  addNode({
    id: 'hub:workspace',
    tier: 0,
    kind: 'hub',
    label: repoName,
    sublabel: `${gitState.branch}@${gitState.head || 'HEAD'}`,
    status: gitState.dirtyCount > 0 ? 'running' : 'idle',
    runtime: 'hub',
    metrics: {
      dirtyCount: gitState.dirtyCount,
      commits: gitState.commits.length,
    },
  });

  const runtimeGroups = new Map<ObservatoryRuntime, ObservatorySessionSummary[]>();
  for (const session of sessions) {
    const existing = runtimeGroups.get(session.runtime);
    if (existing) existing.push(session);
    else runtimeGroups.set(session.runtime, [session]);
  }

  for (const [runtime, rtSessions] of runtimeGroups.entries()) {
    const runningCount = rtSessions.filter((entry) => entry.status === 'running').length;
    const errorCount = rtSessions.filter(
      (entry) => entry.status === 'error' || entry.errorCount > 0
    ).length;
    const totalTokens = rtSessions.reduce((acc, entry) => acc + entry.tokens.total, 0);
    const runtimeNodeId = `rt:${runtime}`;
    addNode({
      id: runtimeNodeId,
      tier: 1,
      kind: 'runtime',
      runtime,
      label: RUNTIME_LABELS[runtime] ?? runtime,
      sublabel: `${runningCount} active · ${rtSessions.length} total`,
      status: runningCount > 0 ? 'running' : errorCount > 0 ? 'error' : 'recent',
      metrics: {
        sessions: rtSessions.length,
        running: runningCount,
        tokens: totalTokens,
        errors: errorCount,
      },
    });
    edges.push({
      id: `edge:hub-${runtime}`,
      from: 'hub:workspace',
      to: runtimeNodeId,
      kind: 'runtime-link',
      runtime,
      weight: Math.max(1, runningCount * 3 + Math.min(rtSessions.length, 6)),
      active: runningCount > 0,
    });
  }

  const statusRank: Readonly<Record<string, number>> = {
    running: 4,
    error: 3,
    recent: 2,
    idle: 1,
  };
  const sortedCandidates = [...sessions].sort((left, right) => {
    const rankDiff = (statusRank[right.status] ?? 0) - (statusRank[left.status] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    const subDiff = right.subagents.length - left.subagents.length;
    if (subDiff !== 0 && right.status !== 'idle') return subDiff;
    return right.mtimeMs - left.mtimeMs;
  });

  const rankedSessions: ObservatorySessionSummary[] = [];
  const perRuntimePicked: Record<string, number> = {};
  for (const candidate of sortedCandidates) {
    if (rankedSessions.length >= 20) break;
    const rtCap = candidate.runtime === 'magpie' ? 3 : 6;
    const rtCount = perRuntimePicked[candidate.runtime] ?? 0;
    if (rtCount >= rtCap) continue;
    perRuntimePicked[candidate.runtime] = rtCount + 1;
    rankedSessions.push(candidate);
  }

  const sessionNodeById = new Map<string, string>();
  let subagentNodesAdded = 0;

  for (const session of rankedSessions) {
    const agentNodeId = `agent:${session.runtime}:${session.id}`;
    sessionNodeById.set(session.id, agentNodeId);
    addNode({
      id: agentNodeId,
      tier: 2,
      kind: 'agent',
      runtime: session.runtime,
      targetRuntime: session.targetRuntime ?? null,
      sessionId: session.id,
      label: clipRedacted(session.title, 34, knownSecrets),
      sublabel: clipRedacted(session.lastTool || session.model || session.status, 30, knownSecrets),
      status: session.status,
      isCurrentSession: session.isCurrentSession,
      focus: session.focus,
      model: session.model,
      lastError: session.lastError,
      metrics: {
        tokens: session.tokens.total,
        steps: session.steps,
        subagents: session.subagents.length,
        errors: session.errorCount,
      },
    });
    edges.push({
      id: `edge:rt-${agentNodeId}`,
      from: `rt:${session.runtime}`,
      to: agentNodeId,
      kind: 'session-link',
      runtime: session.runtime,
      weight: Math.max(1, Math.min(6, Math.ceil((session.steps || 1) / 25))),
      active: session.status === 'running',
    });

    const subLimit = session.status === 'running' ? 6 : 3;
    for (const subEntry of session.subagents.slice(0, subLimit)) {
      if (subagentNodesAdded >= 28) break;
      const subNodeId = `sub:${session.id.slice(0, 8)}:${subagentNodesAdded}`;
      subagentNodesAdded += 1;
      addNode({
        id: subNodeId,
        tier: 3,
        kind: 'subagent',
        runtime: session.runtime,
        parentSessionId: session.id,
        label: clipRedacted(subEntry.role || subEntry.id, 26, knownSecrets),
        sublabel: clipRedacted(subEntry.type || subEntry.model || 'subagent', 24, knownSecrets),
        status:
          subEntry.status === 'running'
            ? 'running'
            : session.status === 'running'
              ? 'recent'
              : 'idle',
        metrics: {
          model: subEntry.model || 'inherit',
        },
      });
      edges.push({
        id: `edge:sub-${subNodeId}`,
        from: agentNodeId,
        to: subNodeId,
        kind: 'subagent-link',
        runtime: session.runtime,
        weight: 2,
        active: subEntry.status === 'running' || session.status === 'running',
      });
    }
  }

  for (let swarmIdx = 0; swarmIdx < swarms.length; swarmIdx += 1) {
    const swarmEntry = swarms[swarmIdx];
    if (!swarmEntry) continue;
    const swarmNodeId = `swarm:${swarmIdx}`;
    addNode({
      id: swarmNodeId,
      tier: 3,
      kind: 'swarm',
      runtime: swarmEntry.runtime || 'visual-swarm',
      label: clipRedacted(swarmEntry.title || 'Swarm', 28, knownSecrets),
      sublabel: `${swarmEntry.workers.length} workers`,
      status: 'running',
      metrics: { workers: swarmEntry.workers.length },
    });
    const parentAgentNode = swarmEntry.conversationId
      ? sessionNodeById.get(swarmEntry.conversationId)
      : undefined;
    edges.push({
      id: `edge:swarm-${swarmIdx}`,
      from: parentAgentNode ?? 'hub:workspace',
      to: swarmNodeId,
      kind: 'swarm-link',
      runtime: 'visual-swarm',
      weight: 3,
      active: true,
    });
  }

  if (activePlan && activePlan.waves.length > 0) {
    const topWaves = activePlan.waves.slice(0, 5);
    for (let waveIdx = 0; waveIdx < topWaves.length; waveIdx += 1) {
      const waveEntry = topWaves[waveIdx];
      if (!waveEntry) continue;
      const waveNodeId = `wave:${activePlan.id}:${waveIdx}`;
      const waveComplete = waveEntry.total > 0 && waveEntry.done === waveEntry.total;
      const waveInProgress = waveEntry.done > 0 && waveEntry.done < waveEntry.total;
      addNode({
        id: waveNodeId,
        tier: 4,
        kind: 'plan-wave',
        runtime: 'plan',
        planId: activePlan.id,
        waveTitle: waveEntry.title,
        label: clipRedacted(waveEntry.title.replace(/^Wave\s+/iu, 'W'), 28, knownSecrets),
        sublabel: `${waveEntry.done}/${waveEntry.total} (${waveEntry.percent}%)`,
        status: waveComplete ? 'running' : waveInProgress ? 'recent' : 'idle',
        metrics: { done: waveEntry.done, total: waveEntry.total, percent: waveEntry.percent },
      });
    }

    for (const session of rankedSessions) {
      const agentNodeId = sessionNodeById.get(session.id);
      if (!agentNodeId) continue;
      const haystack = `${session.title} ${session.focus}`.toUpperCase();
      const matchedTask = activePlan.tasks.find((taskEntry) =>
        new RegExp(`\\b${taskEntry.id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'iu').test(
          haystack
        )
      );
      if (matchedTask) {
        const waveIdx = activePlan.waves.findIndex(
          (waveEntry) => waveEntry.title === matchedTask.wave
        );
        if (waveIdx >= 0 && waveIdx < 5) {
          edges.push({
            id: `edge:task-${session.id.slice(0, 8)}-${waveIdx}`,
            from: agentNodeId,
            to: `wave:${activePlan.id}:${waveIdx}`,
            kind: 'plan-link',
            runtime: session.runtime,
            weight: 3,
            active: session.status === 'running',
            label: matchedTask.id,
          });
        }
      }
    }
  }

  const topDirtyAreas = Object.entries(gitState.dirtyByArea)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);
  for (const [areaName, fileCount] of topDirtyAreas) {
    const areaNodeId = `area:${areaName}`;
    addNode({
      id: areaNodeId,
      tier: 4,
      kind: 'workspace-area',
      runtime: 'git',
      label: areaName,
      sublabel: `${fileCount} dirty file${fileCount === 1 ? '' : 's'}`,
      status: 'recent',
      metrics: { dirtyFiles: fileCount },
    });
    const runningWorkspaceAgents = rankedSessions.filter(
      (session) => session.status === 'running' && session.inCurrentWorkspace
    );
    for (const activeAgent of runningWorkspaceAgents.slice(0, 3)) {
      edges.push({
        id: `edge:area-${activeAgent.id.slice(0, 8)}-${areaName}`,
        from: `agent:${activeAgent.runtime}:${activeAgent.id}`,
        to: areaNodeId,
        kind: 'workspace-link',
        runtime: activeAgent.runtime,
        weight: 2,
        active: true,
      });
    }
  }

  for (const probe of probes.vps.slice(0, 4)) {
    const vpsNodeId = `vps:${probe.id}`;
    addNode({
      id: vpsNodeId,
      tier: 4,
      kind: 'infra',
      runtime: 'infra',
      label: clipRedacted(probe.label, 28, knownSecrets),
      sublabel: probe.httpCode
        ? `HTTP ${probe.httpCode} · ${probe.latencyMs ?? 0}ms`
        : probe.status.toUpperCase(),
      status: probe.status === 'up' ? 'running' : probe.status === 'warn' ? 'recent' : 'error',
      metrics: { latencyMs: probe.latencyMs ?? 0, httpCode: probe.httpCode },
    });
    edges.push({
      id: `edge:vps-${probe.id}`,
      from: 'hub:workspace',
      to: vpsNodeId,
      kind: 'infra-link',
      runtime: 'infra',
      weight: 1.5,
      active: probe.status === 'up',
    });
  }

  if (nodeIds.has('rt:magpie')) {
    const magpieLinkedTargets = new Set<ObservatoryRuntime>();
    for (const session of sessions) {
      if (session.runtime === 'magpie' && session.targetRuntime) {
        magpieLinkedTargets.add(session.targetRuntime);
      }
    }
    for (const targetRt of magpieLinkedTargets) {
      const targetRtNodeId = `rt:${targetRt}`;
      if (nodeIds.has(targetRtNodeId)) {
        edges.push({
          id: `edge:magpie-boost-${targetRt}`,
          from: 'rt:magpie',
          to: targetRtNodeId,
          kind: 'router-link',
          runtime: 'magpie',
          weight: 3.5,
          active: true,
          label: 'ROUTE',
        });
      }
    }
  }

  const balancedFeed: ObservatoryActivityFeedItem[] = [];
  let magpiePulsesCount = 0;
  for (const eventEntry of activityFeed) {
    if (balancedFeed.length >= 30) break;
    if (eventEntry.runtime === 'magpie') {
      if (magpiePulsesCount >= 5) continue;
      magpiePulsesCount += 1;
    }
    balancedFeed.push(eventEntry);
  }

  const pulses: ObservatoryFlowPulse[] = balancedFeed.map((eventEntry, idx) => {
    const agentNodeId = sessionNodeById.get(eventEntry.sessionId) ?? `rt:${eventEntry.runtime}`;
    return {
      id: `${eventEntry.at || String(idx)}-${eventEntry.sessionId}-${idx}`,
      at: eventEntry.at,
      runtime: eventEntry.runtime,
      kind: eventEntry.kind,
      tool: eventEntry.tool,
      summary: eventEntry.summary,
      fromNode: `rt:${eventEntry.runtime}`,
      toNode: agentNodeId,
    };
  });

  return { nodes, edges, pulses };
}

export function computeAnalytics(
  sessions: readonly ObservatorySessionSummary[],
  activityFeed: readonly ObservatoryActivityFeedItem[],
  nowMs = Date.now(),
  knownSecrets: readonly string[] = []
): ObservatoryAnalytics {
  const toolStats = new Map<
    string,
    { name: string; calls: number; errors: number; runtimes: Set<string> }
  >();
  const runtimeStats = new Map<
    ObservatoryRuntime,
    {
      runtime: ObservatoryRuntime;
      label: string;
      sessions: number;
      running: number;
      subagents: number;
      inputTokens: number;
      cachedTokens: number;
      outputTokens: number;
      totalTokens: number;
      errors: number;
    }
  >();
  const modelStats = new Map<
    string,
    { model: string; runtime: ObservatoryRuntime; sessions: number; tokens: number; steps: number }
  >();
  const errorLedger: ObservatoryErrorLedgerEntry[] = [];

  for (const session of sessions) {
    let rtEntry = runtimeStats.get(session.runtime);
    if (!rtEntry) {
      rtEntry = {
        runtime: session.runtime,
        label: session.runtimeLabel || RUNTIME_LABELS[session.runtime] || session.runtime,
        sessions: 0,
        running: 0,
        subagents: 0,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        errors: 0,
      };
      runtimeStats.set(session.runtime, rtEntry);
    }
    rtEntry.sessions += 1;
    if (session.status === 'running') rtEntry.running += 1;
    rtEntry.subagents += session.subagents.length;
    rtEntry.inputTokens += session.tokens.input;
    rtEntry.cachedTokens += session.tokens.cached;
    rtEntry.outputTokens += session.tokens.output;
    rtEntry.totalTokens += session.tokens.total;
    rtEntry.errors += session.errorCount || (session.lastError ? 1 : 0);

    const modelName = session.model || session.runtime;
    let modelEntry = modelStats.get(modelName);
    if (!modelEntry) {
      modelEntry = { model: modelName, runtime: session.runtime, sessions: 0, tokens: 0, steps: 0 };
      modelStats.set(modelName, modelEntry);
    }
    modelEntry.sessions += 1;
    modelEntry.tokens += session.tokens.total;
    modelEntry.steps += session.steps;

    for (const [toolName, callCount] of Object.entries(session.toolCounts)) {
      let toolEntry = toolStats.get(toolName);
      if (!toolEntry) {
        toolEntry = { name: toolName, calls: 0, errors: 0, runtimes: new Set<string>() };
        toolStats.set(toolName, toolEntry);
      }
      toolEntry.calls += Number(callCount || 0);
      toolEntry.runtimes.add(session.runtime);
    }

    if (session.lastError) {
      errorLedger.push({
        at: session.updatedAt,
        runtime: session.runtime,
        runtimeLabel: session.runtimeLabel,
        sessionId: session.id,
        sessionTitle: clipRedacted(session.title, 60, knownSecrets),
        tool: session.lastTool || 'error',
        message: session.lastError,
      });
    }
  }

  for (const feedEvent of activityFeed) {
    if (feedEvent.kind === 'error') {
      const toolEntry = toolStats.get(feedEvent.tool || 'error');
      if (toolEntry) toolEntry.errors += 1;
    }
  }

  const runtimeBreakdown: ObservatoryRuntimeBreakdownEntry[] = Array.from(runtimeStats.values())
    .map((rtEntry) => {
      const denom = rtEntry.inputTokens + rtEntry.cachedTokens;
      return {
        ...rtEntry,
        cacheHitPct: denom > 0 ? Math.round((rtEntry.cachedTokens / denom) * 1000) / 10 : 0,
      };
    })
    .sort((left, right) => right.running - left.running || right.totalTokens - left.totalTokens);

  const toolFrequency: ObservatoryToolFrequencyEntry[] = Array.from(toolStats.values())
    .map((toolEntry) => ({
      name: toolEntry.name,
      calls: toolEntry.calls,
      errors: toolEntry.errors,
      runtimes: Array.from(toolEntry.runtimes),
    }))
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 18);

  const modelBreakdown: ObservatoryModelBreakdownEntry[] = Array.from(modelStats.values())
    .sort((left, right) => right.tokens - left.tokens || right.sessions - left.sessions)
    .slice(0, 12);

  const bucketCount = 24;
  const windowMs = 60 * 60_000;
  const bucketSpanMs = windowMs / bucketCount;
  const mutableBuckets = Array.from({ length: bucketCount }, (_, idx) => ({
    index: idx,
    label: `-${Math.round(((bucketCount - idx) * bucketSpanMs) / 60_000)}m`,
    total: 0,
    tools: 0,
    subagents: 0,
    errors: 0,
  }));

  for (const feedEvent of activityFeed) {
    const eventMs = Date.parse(feedEvent.at || '');
    if (!Number.isFinite(eventMs)) continue;
    const ageMs = nowMs - eventMs;
    if (ageMs < 0 || ageMs > windowMs) continue;
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((windowMs - ageMs) / bucketSpanMs))
    );
    const bucket = mutableBuckets[bucketIdx];
    if (!bucket) continue;
    bucket.total += 1;
    if (feedEvent.kind === 'error') bucket.errors += 1;
    else if (feedEvent.kind === 'subagent' || feedEvent.kind === 'swarm') bucket.subagents += 1;
    else bucket.tools += 1;
  }

  const activityBuckets: ObservatoryActivityBucket[] = mutableBuckets;
  errorLedger.sort((left, right) => right.at.localeCompare(left.at));

  return {
    toolFrequency,
    runtimeBreakdown,
    modelBreakdown,
    activityBuckets,
    errorLedger: errorLedger.slice(0, 25),
  };
}

export function computeBattleTelemetry(
  activePlan: ObservatoryPlanSummary | null,
  runningSessions: number,
  subagentTotal: number,
  errorSessionCount: number,
  vpsProbes: readonly ObservatoryProbeResult[],
  magpieSummary: ObservatoryMagpieSummary,
  knownSecrets: readonly string[] = []
): ObservatoryBattleTelemetry {
  return {
    bossName: activePlan
      ? clipRedacted(activePlan.title, 54, knownSecrets)
      : 'REPO CHAOS BOSS',
    bossHpPct: activePlan ? Math.max(0, Math.round((100 - activePlan.percent) * 10) / 10) : 100,
    bossShieldCount: activePlan?.dag?.stats.blocked ?? 0,
    readyStrikeCount: activePlan?.dag?.stats.ready ?? 0,
    activeWarriors: runningSessions,
    sidekickSwarmCount: subagentTotal,
    glitchCount: errorSessionCount + vpsProbes.filter((probe) => probe.status === 'down').length,
    magpieBoostCalls: magpieSummary.totalRecentCalls,
  };
}

export function formatSnapshotMarkdown(snapshot: ObservatorySnapshot): string {
  const lines: string[] = [
    '# MoonWitness Desktop Agent Observatory Report',
    '',
    `- **Generated:** ${snapshot.generatedAt}`,
    `- **Repository:** \`${snapshot.repoRoot}\``,
    `- **Git:** \`${snapshot.git.branch}@${snapshot.git.head || 'HEAD'}\` (${snapshot.git.dirtyCount} dirty files, +${snapshot.git.diffStat.insertions}/-${snapshot.git.diffStat.deletions})`,
    `- **Host:** ${snapshot.host.hostname} (${snapshot.host.platform}/${snapshot.host.arch}) · CPU ${snapshot.host.cpuPct}% · RAM ${snapshot.host.memUsedGb}/${snapshot.host.memTotalGb} GB (${snapshot.host.memPct}%)`,
    `- **Agents:** ${snapshot.summary.runningSessions} running / ${snapshot.summary.totalSessions} tracked · ${snapshot.summary.subagents} subagents · ${snapshot.summary.swarms} swarm(s)`,
    `- **Tokens Observed:** ${snapshot.summary.tokens.total.toLocaleString()} (in ${snapshot.summary.tokens.input.toLocaleString()}, cache ${snapshot.summary.tokens.cached.toLocaleString()} [${snapshot.summary.tokens.cacheHitPct ?? 0}%], out ${snapshot.summary.tokens.output.toLocaleString()})`,
    '',
    '## Plans Progress',
  ];

  for (const planEntry of snapshot.plans) {
    const dagStats = planEntry.dag?.stats;
    lines.push(
      `- **${planEntry.id}**: ${planEntry.done}/${planEntry.total} (${planEntry.percent}%)` +
        (dagStats
          ? ` — ready: ${dagStats.ready}, active: ${dagStats.active}, blocked: ${dagStats.blocked}`
          : '') +
        (planEntry.nextTaskId
          ? ` — next: \`${planEntry.nextTaskId}\` ${planEntry.nextTaskTitle ?? ''}`
          : ' — COMPLETE')
    );
  }

  lines.push('', '## Active & Recent Agents');
  for (const session of snapshot.sessions.slice(0, 15)) {
    lines.push(
      `- [${session.status.toUpperCase()}] **${session.runtimeLabel}** \`${session.id.slice(0, 8)}\` (${session.model}) — ${session.title} — _${session.focus || session.lastTool || 'Idle'}_`
    );
  }

  if (snapshot.analytics.errorLedger.length > 0) {
    lines.push('', '## Recent Errors');
    for (const errEntry of snapshot.analytics.errorLedger.slice(0, 10)) {
      lines.push(`- [${errEntry.runtimeLabel}] **${errEntry.sessionTitle}**: \`${errEntry.message}\``);
    }
  }

  if (snapshot.magpie.connected || snapshot.magpie.totalRecentCalls > 0) {
    lines.push(
      '',
      '## Magpie Router',
      `- **Gateway:** ${snapshot.magpie.addr ?? 'local'} (${snapshot.magpie.connected ? 'ONLINE' : 'STANDBY'}) · ${snapshot.magpie.totalRecentCalls} recent calls (${snapshot.magpie.okCalls} ok, ${snapshot.magpie.rateLimit429}×429, avg ${snapshot.magpie.avgLatencyMs}ms)`
    );
  }

  lines.push('', '## VPS Health Probes');
  for (const probe of snapshot.probes.vps) {
    lines.push(
      `- [${probe.status.toUpperCase()}] **${probe.label}** — HTTP ${probe.httpCode ?? 'ERR'} (${probe.latencyMs ?? '—'}ms) ${probe.detail}`
    );
  }

  return `${lines.join('\n')}\n`;
}
