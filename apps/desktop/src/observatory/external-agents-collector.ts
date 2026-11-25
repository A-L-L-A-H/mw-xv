import { existsSync, type Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { isRecord } from '@moonwitness/types';
import type { DesktopCapabilityBridge } from '../types.js';
import { probeLoopbackPort } from './infra-collector.js';
import {
  bumpCounter,
  clipRedacted,
  DEFAULT_DETAIL_TAIL_BYTES,
  DEFAULT_TAIL_CHUNK_BYTES,
  deriveSessionStatus,
  matchesWorkspacePath,
  readHeadAndTailLines,
  safeJsonParse,
  walkJsonlFiles,
} from './io.js';
import type {
  InternalObservatorySession,
  ObservatoryEvent,
  ObservatoryMagpieMemoryStats,
  ObservatoryMagpieProviderStats,
  ObservatoryMagpieRouteHop,
  ObservatoryMagpieSummary,
  ObservatoryRuntime,
  ObservatorySubagent,
  ObservatorySwarmSummary,
} from './types.js';

interface CacheEntry<T> {
  readonly mtimeMs: number;
  readonly size: number;
  readonly value: T;
}

interface ParsedClaudeSummary {
  readonly title: string;
  readonly model: string;
  readonly cwd: string;
  readonly gitBranch: string;
  readonly lastAction: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly errorCount: number;
  readonly hasRecentError: boolean;
  readonly inputTokens: number;
  readonly cacheTokens: number;
  readonly outputTokens: number;
  readonly turns: number;
  readonly lastTimestamp: string;
  readonly subagents: readonly ObservatorySubagent[];
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly events: readonly ObservatoryEvent[];
}

interface ParsedCodexSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly model: string;
  readonly cwd: string;
  readonly gitBranch: string;
  readonly goalStatus: string;
  readonly lastAction: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly errorCount: number;
  readonly hasRecentError: boolean;
  readonly inputTokens: number;
  readonly cacheTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly steps: number;
  readonly lastTimestamp: string;
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly events: readonly ObservatoryEvent[];
}

interface OpenCodeSessionRow {
  readonly id: string;
  readonly parent_id: string | null;
  readonly title: string | null;
  readonly directory: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly cost: number | null;
  readonly tokens_input: number | null;
  readonly tokens_output: number | null;
  readonly tokens_cache_read: number | null;
  readonly tokens_cache_write: number | null;
  readonly time_created: number | null;
  readonly time_updated: number | null;
  readonly time_busy: number | null;
  readonly time_idle: number | null;
}

interface OpenCodePartRow {
  readonly type: string | null;
  readonly time_updated: number | null;
  readonly data: string | null;
}

export interface ParsedOpenCodeParts {
  readonly focus: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly errorCount: number;
  readonly hasRecentError: boolean;
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly events: readonly ObservatoryEvent[];
}

export interface MagpieTelemetryBundle {
  readonly sessions: readonly InternalObservatorySession[];
  readonly summary: ObservatoryMagpieSummary;
}

const MAX_FULL_SCAN_BYTES = 25 * 1024 * 1024;

export function createEmptyMagpieSummary(): ObservatoryMagpieSummary {
  return {
    connected: false,
    addr: null,
    version: null,
    totalRecentCalls: 0,
    okCalls: 0,
    rateLimit429: 0,
    errorCalls: 0,
    avgLatencyMs: 0,
    avgTtftMs: 0,
    providers: [],
    memoryStats: null,
    recentRoutes: [],
    routedRuntimes: [],
  };
}

function normalizeMagpieTargetRuntime(agentName: string): ObservatoryRuntime | null {
  const lowered = agentName.toLowerCase();
  if (lowered.includes('opencode')) return 'opencode';
  if (lowered.includes('claude')) return 'claude';
  if (lowered.includes('codex')) return 'codex';
  if (lowered.includes('antigravity') || lowered.includes('gemini')) return 'antigravity';
  if (lowered.includes('qoder')) return 'qoder';
  return null;
}

export interface ExternalAgentsCollectorOptions {
  readonly homeDir: string;
  readonly knownSecrets?: readonly string[];
  readonly enableLocalPortProbe?: boolean;
}

export class ExternalAgentsCollector {
  private readonly homeDir: string;
  private readonly knownSecrets: readonly string[];
  private readonly enableLocalPortProbe: boolean;
  private readonly claudeCache = new Map<string, CacheEntry<ParsedClaudeSummary>>();
  private readonly claudeSubCache = new Map<string, CacheEntry<readonly ObservatorySubagent[]>>();
  private readonly codexCache = new Map<string, CacheEntry<ParsedCodexSummary>>();
  private openCodeCache: { sig: string; sessions: readonly InternalObservatorySession[] } = {
    sig: '',
    sessions: [],
  };
  private magpieCache: { sig: string; bundle: MagpieTelemetryBundle } | null = null;

  constructor(options: ExternalAgentsCollectorOptions) {
    this.homeDir = options.homeDir;
    this.knownSecrets = options.knownSecrets ?? [];
    this.enableLocalPortProbe = options.enableLocalPortProbe ?? true;
  }

  private async scanClaudeSubagents(
    filePath: string,
    fileStat: Stats
  ): Promise<readonly ObservatorySubagent[]> {
    const cached = this.claudeSubCache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.value;
    }
    if (fileStat.size > MAX_FULL_SCAN_BYTES) {
      this.claudeSubCache.set(filePath, {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        value: [],
      });
      return [];
    }

    const raw = await readFile(filePath, 'utf8').catch(() => '');
    const found: ObservatorySubagent[] = [];
    const seen = new Set<string>();
    const fallbackIso = new Date(fileStat.mtimeMs).toISOString();

    for (const line of raw.split(/\r?\n/u)) {
      if (!line.includes('"name":"Agent"') && !line.includes('"name":"Task"')) continue;
      const rec = safeJsonParse<Record<string, unknown>>(line);
      const message = rec && isRecord(rec.message) ? rec.message : null;
      const blocks = message && Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (!isRecord(block) || block.type !== 'tool_use') continue;
        if (block.name !== 'Agent' && block.name !== 'Task') continue;
        const input = isRecord(block.input) ? block.input : {};
        const role = clipRedacted(
          String(input.description ?? input.subagent_type ?? 'Claude Subagent'),
          70,
          this.knownSecrets
        );
        const typeName = clipRedacted(
          String(input.subagent_type ?? 'general-purpose'),
          40,
          this.knownSecrets
        );
        const id = typeof block.id === 'string' ? block.id : `claude-sub-${found.length}`;
        if (!seen.has(id)) {
          seen.add(id);
          found.push({
            id,
            role,
            type: typeName,
            model: clipRedacted(
              String(input.model ?? message?.model ?? 'inherit'),
              40,
              this.knownSecrets
            ),
            status: 'done',
            at: typeof rec?.timestamp === 'string' ? rec.timestamp : fallbackIso,
          });
        }
      }
    }

    this.claudeSubCache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: found,
    });
    return found;
  }

  async parseClaudeSession(
    sessionId: string,
    filePath: string,
    fileStat: Stats,
    projectDir: string,
    detailMode = false
  ): Promise<ParsedClaudeSummary> {
    const cacheKey = `${filePath}:${detailMode ? 'detail' : 'summary'}`;
    const cached = this.claudeCache.get(cacheKey);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.value;
    }

    const { headLines, tailLines } = await readHeadAndTailLines(
      filePath,
      fileStat.size,
      detailMode ? DEFAULT_DETAIL_TAIL_BYTES : DEFAULT_TAIL_CHUNK_BYTES
    );

    let title = '';
    let model = '';
    let requestedModel = '';
    let cwd = '';
    let gitBranch = '';
    let lastAction = '';
    let lastTool = '';
    let lastError = '';
    let errorCount = 0;
    let hasRecentError = false;
    let inputTokens = 0;
    let cacheTokens = 0;
    let outputTokens = 0;
    let turns = 0;
    let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
    const subagents: ObservatorySubagent[] = [];
    const events: ObservatoryEvent[] = [];
    const toolCounts: Record<string, number> = {};

    const customTitlePath = path.join(projectDir, sessionId, 'custom-title.json');
    if (existsSync(customTitlePath)) {
      const rawTitle = await readFile(customTitlePath, 'utf8').catch(() => '');
      const parsedTitle = safeJsonParse<Record<string, unknown>>(rawTitle.trim());
      if (parsedTitle && typeof parsedTitle.customTitle === 'string') {
        title = clipRedacted(parsedTitle.customTitle, 100, this.knownSecrets);
      }
    }

    for (const line of headLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec) continue;
      if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;
      if (!gitBranch && typeof rec.gitBranch === 'string') gitBranch = rec.gitBranch;
      if (!title && typeof rec.customTitle === 'string') {
        title = clipRedacted(rec.customTitle, 100, this.knownSecrets);
      }
      if (
        !title &&
        rec.type === 'user' &&
        isRecord(rec.message) &&
        typeof rec.message.content === 'string'
      ) {
        const schedMatch = rec.message.content.match(/<scheduled-task\s+name="([^"]+)"/u);
        title =
          schedMatch && schedMatch[1]
            ? `Scheduled: ${schedMatch[1]}`
            : clipRedacted(rec.message.content, 95, this.knownSecrets);
      }
    }

    for (const line of tailLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec) continue;
      if (typeof rec.timestamp === 'string') lastTimestamp = rec.timestamp;
      if (typeof rec.cwd === 'string') cwd = rec.cwd;
      if (typeof rec.gitBranch === 'string') gitBranch = rec.gitBranch;
      if (rec.type === 'custom-title' && typeof rec.customTitle === 'string') {
        title = clipRedacted(rec.customTitle, 100, this.knownSecrets);
      }
      if (rec.type === 'agent-name' && typeof rec.agentName === 'string' && !title) {
        title = clipRedacted(rec.agentName, 100, this.knownSecrets);
      }
      if (typeof rec.requestedModel === 'string') requestedModel = rec.requestedModel;

      const at = typeof rec.timestamp === 'string' ? rec.timestamp : lastTimestamp;
      if (rec.type === 'assistant' && isRecord(rec.message)) {
        turns += 1;
        if (typeof rec.message.model === 'string') model = rec.message.model;
        if (isRecord(rec.message.usage)) {
          inputTokens += Number(rec.message.usage.input_tokens ?? 0);
          cacheTokens +=
            Number(rec.message.usage.cache_read_input_tokens ?? 0) +
            Number(rec.message.usage.cache_creation_input_tokens ?? 0);
          outputTokens += Number(rec.message.usage.output_tokens ?? 0);
        }
        const blocks = Array.isArray(rec.message.content) ? rec.message.content : [];
        for (const block of blocks) {
          if (!isRecord(block)) continue;
          if (block.type === 'tool_use') {
            lastTool = typeof block.name === 'string' ? block.name : 'tool';
            bumpCounter(toolCounts, lastTool);
            const input = isRecord(block.input) ? block.input : {};
            const desc =
              input.description ??
              input.file_path ??
              input.pattern ??
              input.command ??
              input.prompt ??
              '';
            const summary = desc
              ? `${lastTool}: ${clipRedacted(String(desc), 110, this.knownSecrets)}`
              : lastTool;
            lastAction = summary;
            if (lastTool === 'Agent' || lastTool === 'Task') {
              subagents.push({
                id: typeof block.id === 'string' ? block.id : `sub-${turns}`,
                role: clipRedacted(
                  String(input.description ?? input.subagent_type ?? 'Claude Subagent'),
                  70,
                  this.knownSecrets
                ),
                type: clipRedacted(
                  String(input.subagent_type ?? 'general-purpose'),
                  40,
                  this.knownSecrets
                ),
                model: clipRedacted(
                  String(input.model ?? model ?? 'inherit'),
                  40,
                  this.knownSecrets
                ),
                at,
              });
              events.push({ at, kind: 'subagent', tool: lastTool, summary });
            } else {
              events.push({ at, kind: 'tool', tool: lastTool, summary });
            }
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            const thought = clipRedacted(block.thinking, 120, this.knownSecrets);
            if (thought) events.push({ at, kind: 'focus', tool: 'thinking', summary: thought });
          } else if (block.type === 'text' && typeof block.text === 'string') {
            const text = clipRedacted(block.text, 120, this.knownSecrets);
            if (text) {
              lastAction = text;
              events.push({ at, kind: 'message', tool: 'assistant', summary: text });
            }
          }
        }
      } else if (
        rec.type === 'user' &&
        isRecord(rec.message) &&
        Array.isArray(rec.message.content)
      ) {
        for (const block of rec.message.content) {
          if (isRecord(block) && block.type === 'tool_result' && block.is_error === true) {
            hasRecentError = true;
            errorCount += 1;
            lastError = clipRedacted(
              typeof block.content === 'string' ? block.content : 'Tool error',
              150,
              this.knownSecrets
            );
            events.push({ at, kind: 'error', tool: 'tool_result', summary: lastError });
          }
        }
      }
    }

    const subDir = path.join(projectDir, sessionId, 'subagents');
    if (existsSync(subDir)) {
      const subFiles = await readdir(subDir).catch(() => []);
      for (const fileName of subFiles.filter((f) => f.endsWith('.jsonl')).slice(0, 15)) {
        const subId = fileName.replace(/\.jsonl$/iu, '');
        const subStat = await stat(path.join(subDir, fileName)).catch(() => null);
        if (!subagents.some((sub) => sub.id === subId)) {
          subagents.push({
            id: subId,
            role: subId,
            type: 'subagent-file',
            model: model || requestedModel || 'claude',
            status: subStat ? deriveSessionStatus(subStat.mtimeMs, null, false) : 'idle',
            at: subStat ? new Date(subStat.mtimeMs).toISOString() : lastTimestamp,
          });
        }
      }
    }

    const result: ParsedClaudeSummary = {
      title: title || `Claude ${sessionId.slice(0, 8)}`,
      model: model || requestedModel || 'claude-code',
      cwd,
      gitBranch,
      lastAction,
      lastTool,
      lastError,
      errorCount,
      hasRecentError,
      inputTokens,
      cacheTokens,
      outputTokens,
      turns,
      lastTimestamp,
      subagents,
      toolCounts,
      events: events.slice(detailMode ? -80 : -40),
    };

    this.claudeCache.set(cacheKey, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: result,
    });
    return result;
  }

  async collectClaude(repoRoot: string): Promise<readonly InternalObservatorySession[]> {
    const projectsRoot = path.join(this.homeDir, '.claude', 'projects');
    if (!existsSync(projectsRoot)) return [];

    const projEntries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
    const candidates: {
      sessionId: string;
      fullPath: string;
      projPath: string;
      fileStat: Stats;
    }[] = [];

    for (const proj of projEntries) {
      if (!proj.isDirectory()) continue;
      const projPath = path.join(projectsRoot, proj.name);
      const files = await readdir(projPath, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
        const fullPath = path.join(projPath, file.name);
        const fileStat = await stat(fullPath).catch(() => null);
        if (fileStat) {
          candidates.push({
            sessionId: file.name.replace(/\.jsonl$/iu, ''),
            fullPath,
            projPath,
            fileStat,
          });
        }
      }
    }

    candidates.sort((left, right) => right.fileStat.mtimeMs - left.fileStat.mtimeMs);
    const sessions: InternalObservatorySession[] = [];

    for (const item of candidates.slice(0, 18)) {
      const [parsed, scannedSubs] = await Promise.all([
        this.parseClaudeSession(item.sessionId, item.fullPath, item.fileStat, item.projPath, false),
        this.scanClaudeSubagents(item.fullPath, item.fileStat),
      ]);
      const mergedSubs: ObservatorySubagent[] = [...parsed.subagents];
      for (const sub of scannedSubs) {
        if (!mergedSubs.some((existing) => existing.id === sub.id || existing.role === sub.role)) {
          mergedSubs.push(sub);
        }
      }
      const status = deriveSessionStatus(item.fileStat.mtimeMs, null, parsed.hasRecentError);
      sessions.push({
        id: item.sessionId,
        runtime: 'claude',
        runtimeLabel: 'Claude Code',
        title: parsed.title,
        status,
        runState: status.toUpperCase(),
        model: parsed.model,
        branch: parsed.gitBranch || null,
        cwd: parsed.cwd || null,
        inCurrentWorkspace: matchesWorkspacePath(parsed.cwd, repoRoot),
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        errorCount: parsed.errorCount,
        steps: parsed.turns,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.inputTokens + parsed.outputTokens,
        },
        subagents: mergedSubs,
        swarmWorkers: 0,
        toolCounts: parsed.toolCounts,
        updatedAt: parsed.lastTimestamp,
        mtimeMs: item.fileStat.mtimeMs,
        sourcePath: item.fullPath,
        recentEvents: parsed.events.slice(-10),
      });
    }

    return sessions;
  }

  async parseCodexRollout(
    filePath: string,
    fileStat: Stats,
    detailMode = false
  ): Promise<ParsedCodexSummary> {
    const cacheKey = `${filePath}:${detailMode ? 'detail' : 'summary'}`;
    const cached = this.codexCache.get(cacheKey);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.value;
    }

    const { headLines, tailLines } = await readHeadAndTailLines(
      filePath,
      fileStat.size,
      detailMode ? DEFAULT_DETAIL_TAIL_BYTES : DEFAULT_TAIL_CHUNK_BYTES
    );

    let sessionId = path.basename(filePath, '.jsonl');
    let title = '';
    let model = '';
    let cwd = '';
    let gitBranch = '';
    let originator = 'Codex';
    let goalStatus = '';
    let lastAction = '';
    let lastTool = '';
    let lastError = '';
    let errorCount = 0;
    let hasRecentError = false;
    let inputTokens = 0;
    let cacheTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let steps = 0;
    let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
    const events: ObservatoryEvent[] = [];
    const toolCounts: Record<string, number> = {};

    for (const line of headLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec || !isRecord(rec.payload)) continue;
      const p = rec.payload;
      if (rec.type === 'session_meta') {
        if (typeof p.session_id === 'string') sessionId = p.session_id;
        else if (typeof p.id === 'string') sessionId = p.id;
        if (typeof p.cwd === 'string') cwd = p.cwd;
        if (typeof p.originator === 'string') originator = p.originator;
        if (isRecord(p.git) && typeof p.git.branch === 'string') gitBranch = p.git.branch;
        if (isRecord(p.base_instructions) && isRecord(p.base_instructions.provenance)) {
          if (typeof p.base_instructions.provenance.model === 'string') {
            model = p.base_instructions.provenance.model;
          }
        }
      } else if (
        rec.type === 'event_msg' &&
        p.type === 'thread_settings_applied' &&
        isRecord(p.thread_settings)
      ) {
        if (typeof p.thread_settings.model === 'string') model = p.thread_settings.model;
        if (typeof p.thread_settings.cwd === 'string') cwd = p.thread_settings.cwd;
      } else if (rec.type === 'event_msg' && p.type === 'thread_goal_updated' && isRecord(p.goal)) {
        if (typeof p.goal.objective === 'string') {
          title = clipRedacted(p.goal.objective, 105, this.knownSecrets);
        }
        if (typeof p.goal.status === 'string') goalStatus = p.goal.status;
      }
    }

    for (const line of tailLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec) continue;
      if (typeof rec.timestamp === 'string') lastTimestamp = rec.timestamp;
      if (typeof rec.ordinal === 'number') steps = Math.max(steps, rec.ordinal + 1);
      const at = typeof rec.timestamp === 'string' ? rec.timestamp : lastTimestamp;

      if (!isRecord(rec.payload)) continue;
      const p = rec.payload;

      if (rec.type === 'token_usage_record' && isRecord(p.thread_token_usage)) {
        const tu = p.thread_token_usage;
        inputTokens = Number(tu.input_tokens ?? inputTokens);
        cacheTokens = Number(tu.cached_input_tokens ?? cacheTokens);
        outputTokens = Number(tu.output_tokens ?? outputTokens);
        totalTokens = Number(tu.total_tokens ?? inputTokens + outputTokens);
      } else if (rec.type === 'event_msg') {
        if (p.type === 'token_count' && isRecord(p.info) && isRecord(p.info.total_token_usage)) {
          const tu = p.info.total_token_usage;
          inputTokens = Number(tu.input_tokens ?? inputTokens);
          cacheTokens = Number(tu.cached_input_tokens ?? cacheTokens);
          outputTokens = Number(tu.output_tokens ?? outputTokens);
          totalTokens = Number(tu.total_tokens ?? inputTokens + outputTokens);
        } else if (p.type === 'thread_goal_updated' && isRecord(p.goal)) {
          if (typeof p.goal.objective === 'string') {
            title = clipRedacted(p.goal.objective, 105, this.knownSecrets);
          }
          if (typeof p.goal.status === 'string') goalStatus = p.goal.status;
        } else if (p.type === 'item_completed' && isRecord(p.item)) {
          if (p.item.type === 'AgentMessage' && Array.isArray(p.item.content)) {
            const firstText = p.item.content.find(
              (entry): entry is Record<string, unknown> =>
                isRecord(entry) && typeof entry.text === 'string'
            );
            const summary = firstText ? clipRedacted(firstText.text, 130, this.knownSecrets) : '';
            if (summary) {
              lastAction = summary;
              events.push({ at, kind: 'message', tool: 'commentary', summary });
            }
          } else if (p.item.type === 'CommandExecution') {
            const rawCmd = Array.isArray(p.item.command)
              ? String(p.item.command[p.item.command.length - 1] ?? '')
              : String(p.item.command ?? '');
            const exitCode = typeof p.item.exit_code === 'number' ? p.item.exit_code : null;
            const failed = p.item.status === 'failed' || (exitCode !== null && exitCode !== 0);
            lastTool = 'exec_command';
            bumpCounter(toolCounts, 'exec_command');
            const summary = clipRedacted(rawCmd, 115, this.knownSecrets);
            lastAction = summary;
            if (failed) {
              hasRecentError = true;
              errorCount += 1;
              lastError = `exit=${exitCode ?? 1}: ${summary}`;
              events.push({ at, kind: 'error', tool: 'exec_command', summary: lastError });
            } else {
              events.push({ at, kind: 'tool', tool: 'exec_command', summary });
            }
          }
        }
      } else if (rec.type === 'response_item' && p.type === 'custom_tool_call') {
        lastTool = typeof p.name === 'string' ? p.name : 'exec';
        bumpCounter(toolCounts, lastTool);
        const summary = `${lastTool}: ${clipRedacted(String(p.input ?? ''), 100, this.knownSecrets)}`;
        lastAction = summary;
        events.push({ at, kind: 'tool', tool: lastTool, summary });
      }
    }

    const result: ParsedCodexSummary = {
      sessionId,
      title: title || `${originator} ${sessionId.slice(0, 8)}`,
      model: model || 'codex',
      cwd,
      gitBranch,
      goalStatus,
      lastAction,
      lastTool,
      lastError,
      errorCount,
      hasRecentError,
      inputTokens,
      cacheTokens,
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
      steps,
      lastTimestamp,
      toolCounts,
      events: events.slice(detailMode ? -80 : -40),
    };

    this.codexCache.set(cacheKey, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: result,
    });
    return result;
  }

  async collectCodex(repoRoot: string): Promise<readonly InternalObservatorySession[]> {
    const codexRoot = path.join(this.homeDir, '.codex', 'sessions');
    if (!existsSync(codexRoot)) return [];
    const files = await walkJsonlFiles(codexRoot, 4);
    files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

    const sessions: InternalObservatorySession[] = [];
    for (const file of files.slice(0, 14)) {
      const parsed = await this.parseCodexRollout(file.fullPath, file.stat, false);
      const status = deriveSessionStatus(file.stat.mtimeMs, null, parsed.hasRecentError);
      sessions.push({
        id: parsed.sessionId,
        runtime: 'codex',
        runtimeLabel: 'Codex',
        title: parsed.title,
        status,
        runState: parsed.goalStatus ? parsed.goalStatus.toUpperCase() : status.toUpperCase(),
        model: parsed.model,
        branch: parsed.gitBranch || null,
        cwd: parsed.cwd || null,
        inCurrentWorkspace: matchesWorkspacePath(parsed.cwd, repoRoot),
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        errorCount: parsed.errorCount,
        steps: parsed.steps,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.totalTokens,
        },
        subagents: [],
        swarmWorkers: 0,
        toolCounts: parsed.toolCounts,
        updatedAt: parsed.lastTimestamp,
        mtimeMs: file.stat.mtimeMs,
        sourcePath: file.fullPath,
        recentEvents: parsed.events.slice(-10),
      });
    }
    return sessions;
  }

  private parseOpenCodeModelField(rawModel: string | null): string {
    if (!rawModel) return 'opencode';
    const parsed = safeJsonParse<Record<string, unknown>>(rawModel.trim());
    if (!parsed) return clipRedacted(rawModel, 48, this.knownSecrets);
    const prov = typeof parsed.providerID === 'string' && parsed.providerID ? `${parsed.providerID}/` : '';
    const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : 'opencode';
    const variant = typeof parsed.variant === 'string' && parsed.variant ? ` (${parsed.variant})` : '';
    return clipRedacted(`${prov}${id}${variant}`, 56, this.knownSecrets);
  }

  private parseOpenCodeParts(partRows: readonly OpenCodePartRow[]): ParsedOpenCodeParts {
    let focus = '';
    let lastTool = '';
    let lastError = '';
    let errorCount = 0;
    let hasRecentError = false;
    const toolCounts: Record<string, number> = {};
    const events: ObservatoryEvent[] = [];

    for (const row of [...partRows].reverse()) {
      const parsedPart = safeJsonParse<Record<string, unknown>>(row.data ?? '');
      const atIso = row.time_updated
        ? new Date(Number(row.time_updated)).toISOString()
        : new Date().toISOString();
      if (!parsedPart) continue;

      if (row.type === 'tool' || parsedPart.type === 'tool') {
        const toolName =
          (typeof parsedPart.name === 'string' && parsedPart.name) ||
          (typeof parsedPart.tool === 'string' && parsedPart.tool) ||
          'tool';
        lastTool = toolName;
        bumpCounter(toolCounts, toolName);
        const stateObj = isRecord(parsedPart.state) ? parsedPart.state : null;
        const toolInput =
          (stateObj && isRecord(stateObj.input) ? stateObj.input : null) ??
          (isRecord(parsedPart.input) ? parsedPart.input : {});
        const targetHint = clipRedacted(
          String(
            toolInput.path ??
              toolInput.filePath ??
              toolInput.command ??
              toolInput.pattern ??
              toolInput.description ??
              ''
          ),
          105,
          this.knownSecrets
        );
        const summary = targetHint ? `${toolName}: ${targetHint}` : toolName;
        focus = summary;
        const failed = stateObj?.status === 'error' || Boolean(stateObj?.error);
        if (failed) {
          hasRecentError = true;
          errorCount += 1;
          lastError = clipRedacted(
            String(stateObj?.error ?? summary),
            150,
            this.knownSecrets
          );
          events.push({ at: atIso, kind: 'error', tool: toolName, summary: lastError });
        } else {
          events.push({ at: atIso, kind: 'tool', tool: toolName, summary });
        }
      } else if (row.type === 'reasoning' || parsedPart.type === 'reasoning') {
        const thought = clipRedacted(String(parsedPart.text ?? ''), 120, this.knownSecrets);
        if (thought) {
          if (!focus) focus = thought;
          events.push({ at: atIso, kind: 'focus', tool: 'reasoning', summary: thought });
        }
      } else if (row.type === 'text' || parsedPart.type === 'text') {
        const txt = clipRedacted(String(parsedPart.text ?? ''), 120, this.knownSecrets);
        if (txt) {
          focus = txt;
          events.push({ at: atIso, kind: 'message', tool: 'opencode', summary: txt });
        }
      }
    }

    return { focus, lastTool, lastError, errorCount, hasRecentError, toolCounts, events };
  }

  async collectOpenCode(repoRoot: string): Promise<readonly InternalObservatorySession[]> {
    const dbPath = path.join(this.homeDir, '.local', 'share', 'opencode', 'opencode.db');
    if (!existsSync(dbPath)) return [];

    const dbStat = await stat(dbPath).catch(() => null);
    const walStat = await stat(`${dbPath}-wal`).catch(() => null);
    if (!dbStat) return [];

    const cacheSig = `${dbStat.mtimeMs}:${dbStat.size}:${walStat?.mtimeMs ?? 0}:${walStat?.size ?? 0}`;
    if (this.openCodeCache.sig === cacheSig) {
      return this.openCodeCache.sessions;
    }

    let sqliteDb: Database.Database | null = null;
    try {
      sqliteDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      const hasV2 = sqliteDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_v2'")
        .get();
      if (!hasV2) return [];

      const rows = sqliteDb
        .prepare(
          `SELECT id, parent_id, title, directory, agent, model, cost,
                  tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                  time_created, time_updated, time_busy, time_idle
           FROM session_v2
           WHERE time_archived IS NULL
           ORDER BY time_updated DESC
           LIMIT 16`
        )
        .all() as OpenCodeSessionRow[];

      const partStmt = sqliteDb.prepare(
        `SELECT type, time_updated, data
         FROM session_part
         WHERE session_id = ?
         ORDER BY time_updated DESC
         LIMIT 28`
      );
      const msgCountStmt = sqliteDb.prepare(
        `SELECT COUNT(*) AS cnt FROM session_message WHERE session_id = ?`
      );

      const nowMs = Date.now();
      const sessions: (InternalObservatorySession & { subagents: ObservatorySubagent[] })[] = [];

      for (const row of rows) {
        const partRows = partStmt.all(row.id) as OpenCodePartRow[];
        const parsedParts = this.parseOpenCodeParts(partRows);
        const countRow = msgCountStmt.get(row.id) as { cnt?: number } | undefined;
        const stepCount = Number(countRow?.cnt ?? partRows.length);
        const updatedMs = Number(row.time_updated ?? row.time_created ?? dbStat.mtimeMs);
        const isBusy =
          Boolean(row.time_busy) &&
          (!row.time_idle || Number(row.time_busy) > Number(row.time_idle)) &&
          nowMs - updatedMs <= 180_000;
        const status = isBusy
          ? 'running'
          : deriveSessionStatus(updatedMs, null, parsedParts.hasRecentError, nowMs);

        const inputTokens = Number(row.tokens_input ?? 0);
        const cachedTokens =
          Number(row.tokens_cache_read ?? 0) + Number(row.tokens_cache_write ?? 0);
        const outputTokens = Number(row.tokens_output ?? 0);

        sessions.push({
          id: row.id,
          runtime: 'opencode',
          runtimeLabel: 'OpenCode',
          title: clipRedacted(row.title || `OpenCode ${row.id.slice(0, 10)}`, 100, this.knownSecrets),
          status,
          runState: isBusy ? 'BUSY' : status.toUpperCase(),
          model: this.parseOpenCodeModelField(row.model),
          branch: null,
          cwd: row.directory ?? null,
          inCurrentWorkspace: matchesWorkspacePath(row.directory, repoRoot),
          isCurrentSession: false,
          parentId: row.parent_id ?? null,
          rootId: null,
          focus: parsedParts.focus || (row.agent ? `agent:${row.agent}` : 'Ready'),
          lastTool: parsedParts.lastTool,
          lastError: parsedParts.lastError,
          errorCount: parsedParts.errorCount,
          steps: stepCount,
          cost: Number(row.cost ?? 0),
          tokens: {
            input: inputTokens,
            cached: cachedTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
          subagents: [],
          swarmWorkers: 0,
          toolCounts: parsedParts.toolCounts,
          updatedAt: new Date(updatedMs).toISOString(),
          mtimeMs: updatedMs,
          sourcePath: dbPath,
          recentEvents: parsedParts.events.slice(-10),
        });
      }

      const byId = new Map(sessions.map((entry) => [entry.id, entry]));
      for (const entry of sessions) {
        if (entry.parentId && byId.has(entry.parentId)) {
          byId.get(entry.parentId)?.subagents.push({
            id: entry.id,
            role: entry.title,
            type: 'opencode-child',
            model: entry.model,
            status: entry.status,
            at: entry.updatedAt,
          });
        }
      }

      this.openCodeCache = { sig: cacheSig, sessions };
      return sessions;
    } catch {
      return this.openCodeCache.sessions;
    } finally {
      if (sqliteDb) {
        try {
          sqliteDb.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  readOpenCodeDetail(dbPath: string, sessionId: string): ParsedOpenCodeParts {
    let sqliteDb: Database.Database | null = null;
    try {
      sqliteDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      const partRows = sqliteDb
        .prepare(
          `SELECT type, time_updated, data
           FROM session_part
           WHERE session_id = ?
           ORDER BY time_updated DESC
           LIMIT 80`
        )
        .all(sessionId) as OpenCodePartRow[];
      return this.parseOpenCodeParts(partRows);
    } catch {
      return {
        focus: '',
        lastTool: '',
        lastError: '',
        errorCount: 0,
        hasRecentError: false,
        toolCounts: {},
        events: [],
      };
    } finally {
      if (sqliteDb) {
        try {
          sqliteDb.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  async collectMagpieTelemetry(repoRoot: string): Promise<MagpieTelemetryBundle> {
    const magpieDir = path.join(this.homeDir, '.config', 'magpie');
    const emptySummary = createEmptyMagpieSummary();
    if (!existsSync(magpieDir)) {
      return { sessions: [], summary: emptySummary };
    }

    const usagePath = path.join(magpieDir, 'usage.jsonl');
    const gatewayPath = path.join(magpieDir, 'gateway.json');
    const memStatsPath = path.join(magpieDir, 'memory-stats.json');

    const [usageStat, gatewayRaw, memStatsRaw] = await Promise.all([
      stat(usagePath).catch(() => null),
      readFile(gatewayPath, 'utf8').catch(() => ''),
      readFile(memStatsPath, 'utf8').catch(() => ''),
    ]);

    const gatewayInfo = safeJsonParse<Record<string, unknown>>(gatewayRaw.trim());
    const memStatsJson = safeJsonParse<Record<string, unknown>>(memStatsRaw.trim());
    let memoryStats: ObservatoryMagpieMemoryStats | null = null;
    if (memStatsJson && isRecord(memStatsJson.days)) {
      const dayKeys = Object.keys(memStatsJson.days).sort();
      const latestDay = dayKeys[dayKeys.length - 1];
      if (latestDay) {
        const dayRec = isRecord(memStatsJson.days[latestDay])
          ? (memStatsJson.days[latestDay] as Record<string, unknown>)
          : {};
        const createdObj = isRecord(dayRec.created) ? dayRec.created : {};
        memoryStats = {
          day: latestDay,
          searches: Number(dayRec.searches ?? 0),
          found: Number(dayRec.found ?? 0),
          recalled: Number(dayRec.recalled ?? 0),
          created: Object.values(createdObj).reduce<number>(
            (acc, num) => acc + Number(num ?? 0),
            0
          ),
        };
      }
    }

    let gatewayPort = 3425;
    const rawAddr = typeof gatewayInfo?.addr === 'string' ? gatewayInfo.addr : null;
    if (rawAddr) {
      const portPart = Number(rawAddr.split(':').pop());
      if (Number.isInteger(portPart) && portPart > 0 && portPart < 65536) {
        gatewayPort = portPart;
      }
    }
    const gatewayOpen =
      gatewayInfo && this.enableLocalPortProbe ? await probeLoopbackPort(gatewayPort) : false;

    const cacheSig = `${usageStat?.mtimeMs ?? 0}:${usageStat?.size ?? 0}:${String(gatewayOpen)}:${memoryStats?.searches ?? 0}`;
    if (this.magpieCache && this.magpieCache.sig === cacheSig) {
      return this.magpieCache.bundle;
    }

    const gatewayVersion = typeof gatewayInfo?.version === 'string' ? gatewayInfo.version : null;

    if (!usageStat) {
      const bundle: MagpieTelemetryBundle = {
        sessions: [],
        summary: {
          ...emptySummary,
          connected: gatewayOpen,
          addr: rawAddr,
          version: gatewayVersion,
          memoryStats,
        },
      };
      this.magpieCache = { sig: cacheSig, bundle };
      return bundle;
    }

    const { tailLines } = await readHeadAndTailLines(usagePath, usageStat.size, 256 * 1024);
    const nowMs = Date.now();
    const cutoffMs = nowMs - 2 * 60 * 60_000;

    interface MutableStream {
      readonly id: string;
      readonly agentTag: string;
      readonly providerTag: string;
      readonly servedModel: string;
      readonly routeGroup: string;
      readonly targetRuntime: ObservatoryRuntime | null;
      calls: number;
      errorCount: number;
      hasRecentError: boolean;
      lastError: string;
      inputTokens: number;
      cachedTokens: number;
      outputTokens: number;
      lastMs: number;
      lastIso: string;
      readonly subagentIds: Set<string>;
      readonly toolCounts: Record<string, number>;
      readonly events: ObservatoryEvent[];
    }

    interface MutableProv {
      readonly provider: string;
      calls: number;
      ok: number;
      rateLimits: number;
      errors: number;
      tokens: number;
      sumMs: number;
      readonly models: Set<string>;
    }

    const streamMap = new Map<string, MutableStream>();
    const providerMap = new Map<string, MutableProv>();
    const routedRuntimeSet = new Set<ObservatoryRuntime>();
    const recentRoutes: ObservatoryMagpieRouteHop[] = [];
    let okCalls = 0;
    let rateLimit429 = 0;
    let errorCalls = 0;
    let sumLatencyMs = 0;
    let sumTtftMs = 0;
    let latencyCount = 0;
    let ttftCount = 0;

    for (const line of tailLines) {
      const entry = safeJsonParse<Record<string, unknown>>(line);
      if (!entry || typeof entry.t !== 'string') continue;
      const entryMs = Date.parse(entry.t);
      if (!Number.isFinite(entryMs) || entryMs < cutoffMs) continue;

      const agentTag = clipRedacted(String(entry.agent ?? 'client'), 32, this.knownSecrets);
      const providerTag = clipRedacted(
        String(entry.provider ?? 'router').replace(/\S+@\S+/gu, 'provider'),
        36,
        this.knownSecrets
      );
      const servedModel = clipRedacted(
        String(entry.served ?? entry.model ?? 'auto'),
        48,
        this.knownSecrets
      );
      const routeGroup = clipRedacted(String(entry.req ?? ''), 40, this.knownSecrets);
      const statusCode = Number(entry.status ?? 0);
      const msVal = Number(entry.ms ?? 0);
      const ttftVal = Number(entry.ttft_ms ?? 0);
      const inTok = Number(entry.in ?? 0);
      const outTok = Number(entry.out ?? 0);
      const cacheTok = Number(entry.cache_read ?? 0) + Number(entry.cache_write ?? 0);
      const is429 = statusCode === 429;
      const isErr = statusCode >= 400;

      if (statusCode >= 200 && statusCode < 400) okCalls += 1;
      else if (is429) rateLimit429 += 1;
      else if (isErr) errorCalls += 1;

      if (msVal > 0) {
        sumLatencyMs += msVal;
        latencyCount += 1;
      }
      if (ttftVal > 0) {
        sumTtftMs += ttftVal;
        ttftCount += 1;
      }

      const mappedRt = normalizeMagpieTargetRuntime(agentTag);
      if (mappedRt) routedRuntimeSet.add(mappedRt);

      let provStats = providerMap.get(providerTag);
      if (!provStats) {
        provStats = {
          provider: providerTag,
          calls: 0,
          ok: 0,
          rateLimits: 0,
          errors: 0,
          tokens: 0,
          sumMs: 0,
          models: new Set(),
        };
        providerMap.set(providerTag, provStats);
      }
      provStats.calls += 1;
      if (!isErr) provStats.ok += 1;
      else if (is429) provStats.rateLimits += 1;
      else provStats.errors += 1;
      provStats.tokens += inTok + outTok;
      provStats.sumMs += msVal;
      provStats.models.add(servedModel);

      const streamKey = `${agentTag}::${providerTag}::${servedModel}`;
      let streamObj = streamMap.get(streamKey);
      if (!streamObj) {
        streamObj = {
          id: streamKey,
          agentTag,
          providerTag,
          servedModel,
          routeGroup,
          targetRuntime: mappedRt,
          calls: 0,
          errorCount: 0,
          hasRecentError: false,
          lastError: '',
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          lastMs: entryMs,
          lastIso: entry.t,
          subagentIds: new Set(),
          toolCounts: {},
          events: [],
        };
        streamMap.set(streamKey, streamObj);
      }

      streamObj.calls += 1;
      streamObj.inputTokens += inTok;
      streamObj.cachedTokens += cacheTok;
      streamObj.outputTokens += outTok;
      if (entryMs >= streamObj.lastMs) {
        streamObj.lastMs = entryMs;
        streamObj.lastIso = entry.t;
      }
      if (entry.subagent) streamObj.subagentIds.add(String(entry.subagent).slice(0, 14));
      const stopTag = entry.stop ? `route:${String(entry.stop)}` : 'route:complete';
      bumpCounter(streamObj.toolCounts, stopTag);

      const routeSummary = `${providerTag}/${servedModel} HTTP ${statusCode || 200} · ${msVal}ms (ttft ${ttftVal}ms)`;
      if (isErr) {
        streamObj.errorCount += 1;
        streamObj.hasRecentError = true;
        streamObj.lastError = routeSummary;
      }
      streamObj.events.push({
        at: entry.t,
        kind: isErr ? 'error' : 'tool',
        tool: is429 ? 'rate_limit_429' : 'magpie_route',
        summary: `${agentTag} → ${routeSummary}`,
      });

      recentRoutes.push({
        at: entry.t,
        agent: agentTag,
        targetRuntime: mappedRt,
        provider: providerTag,
        model: servedModel,
        status: statusCode || 200,
        ms: msVal,
        ttftMs: ttftVal,
        tokens: inTok + outTok,
        cached: cacheTok,
      });
    }

    const sessions: InternalObservatorySession[] = Array.from(streamMap.values())
      .sort((left, right) => right.lastMs - left.lastMs)
      .slice(0, 12)
      .map((streamObj) => {
        const status = deriveSessionStatus(streamObj.lastMs, null, streamObj.hasRecentError, nowMs);
        const subagents: ObservatorySubagent[] = Array.from(streamObj.subagentIds)
          .slice(0, 8)
          .map((subId) => ({
            id: subId,
            role: `${streamObj.agentTag} sub:${subId.slice(0, 8)}`,
            type: 'magpie-routed',
            model: streamObj.servedModel,
            status: status === 'running' ? 'running' : 'idle',
            at: streamObj.lastIso,
          }));
        return {
          id: streamObj.id,
          runtime: 'magpie',
          runtimeLabel: 'Magpie Router',
          title: clipRedacted(
            `Magpie → ${streamObj.agentTag} (${streamObj.providerTag})`,
            96,
            this.knownSecrets
          ),
          status,
          runState: gatewayOpen && status === 'running' ? 'ROUTING' : status.toUpperCase(),
          model: streamObj.servedModel,
          branch: streamObj.routeGroup || null,
          cwd: repoRoot,
          inCurrentWorkspace: true,
          isCurrentSession: false,
          parentId: null,
          rootId: null,
          targetRuntime: streamObj.targetRuntime,
          focus:
            streamObj.events[streamObj.events.length - 1]?.summary ??
            `${streamObj.providerTag} ready`,
          lastTool: streamObj.hasRecentError ? 'rate_limit_429' : 'magpie_route',
          lastError: streamObj.lastError,
          errorCount: streamObj.errorCount,
          steps: streamObj.calls,
          tokens: {
            input: streamObj.inputTokens,
            cached: streamObj.cachedTokens,
            output: streamObj.outputTokens,
            total: streamObj.inputTokens + streamObj.outputTokens,
          },
          subagents,
          swarmWorkers: 0,
          toolCounts: streamObj.toolCounts,
          updatedAt: streamObj.lastIso,
          mtimeMs: streamObj.lastMs,
          sourcePath: usagePath,
          recentEvents: streamObj.events.slice(-12),
        };
      });

    const providers: ObservatoryMagpieProviderStats[] = Array.from(providerMap.values())
      .map((provStats) => ({
        provider: provStats.provider,
        calls: provStats.calls,
        ok: provStats.ok,
        rateLimits: provStats.rateLimits,
        errors: provStats.errors,
        tokens: provStats.tokens,
        avgMs: provStats.calls > 0 ? Math.round(provStats.sumMs / provStats.calls) : 0,
        models: Array.from(provStats.models).slice(0, 4),
      }))
      .sort((left, right) => right.calls - left.calls)
      .slice(0, 10);

    const summary: ObservatoryMagpieSummary = {
      connected: gatewayOpen,
      addr: rawAddr ?? `127.0.0.1:${gatewayPort}`,
      version: gatewayVersion,
      totalRecentCalls: okCalls + rateLimit429 + errorCalls,
      okCalls,
      rateLimit429,
      errorCalls,
      avgLatencyMs: latencyCount > 0 ? Math.round(sumLatencyMs / latencyCount) : 0,
      avgTtftMs: ttftCount > 0 ? Math.round(sumTtftMs / ttftCount) : 0,
      providers,
      memoryStats,
      recentRoutes: recentRoutes.slice(-24).reverse(),
      routedRuntimes: Array.from(routedRuntimeSet),
    };

    const bundle: MagpieTelemetryBundle = { sessions, summary };
    this.magpieCache = { sig: cacheSig, bundle };
    return bundle;
  }

  async collectGenericJsonl(
    dirPath: string,
    runtime: ObservatoryRuntime,
    runtimeLabel: string,
    repoRoot: string
  ): Promise<readonly InternalObservatorySession[]> {
    if (!existsSync(dirPath)) return [];
    const files = await walkJsonlFiles(dirPath, 3);
    files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

    const sessions: InternalObservatorySession[] = [];
    for (const file of files.slice(0, 8)) {
      const { tailLines } = await readHeadAndTailLines(file.fullPath, file.stat.size, 32 * 1024);
      let lastAction = '';
      let model: string = runtime;
      for (const line of tailLines.slice(-15)) {
        const rec = safeJsonParse<Record<string, unknown>>(line);
        if (!rec) continue;
        if (typeof rec.model === 'string') model = rec.model;
        const candidate = rec.summary ?? rec.message ?? rec.content ?? rec.text;
        if (typeof candidate === 'string' && candidate.trim()) {
          lastAction = clipRedacted(candidate, 110, this.knownSecrets);
        }
      }
      const status = deriveSessionStatus(file.stat.mtimeMs, null, false);
      const updatedAt = new Date(file.stat.mtimeMs).toISOString();
      const baseId = path.basename(file.fullPath, '.jsonl');
      sessions.push({
        id: baseId,
        runtime,
        runtimeLabel,
        title: `${runtimeLabel} ${baseId.slice(0, 24)}`,
        status,
        runState: status.toUpperCase(),
        model,
        branch: null,
        cwd: repoRoot,
        inCurrentWorkspace: true,
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: lastAction,
        lastTool: '',
        lastError: '',
        errorCount: 0,
        steps: tailLines.length,
        tokens: { input: 0, cached: 0, output: 0, total: 0 },
        subagents: [],
        swarmWorkers: 0,
        toolCounts: {},
        updatedAt,
        mtimeMs: file.stat.mtimeMs,
        sourcePath: file.fullPath,
        recentEvents: lastAction
          ? [{ at: updatedAt, kind: 'message', tool: runtime, summary: lastAction }]
          : [],
      });
    }
    return sessions;
  }

  async collectLocalSwarmManifest(repoRoot: string): Promise<ObservatorySwarmSummary | null> {
    const manifestPath = path.join(repoRoot, '.swarm', 'swarm.json');
    if (!existsSync(manifestPath)) return null;
    const raw = await readFile(manifestPath, 'utf8').catch(() => '');
    const data = safeJsonParse<Record<string, unknown>>(raw.trim());
    if (!data || typeof data.name !== 'string') return null;

    const agents = Array.isArray(data.agents)
      ? data.agents
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((agent) => ({
            name: String(agent.name ?? agent.id ?? 'agent'),
            role: typeof agent.role === 'string' ? agent.role : '',
            status: typeof agent.status === 'string' ? agent.status : 'idle',
            progress: Number(agent.progress ?? 0),
            task: clipRedacted(
              typeof agent.message === 'string'
                ? agent.message
                : Array.isArray(agent.taskIds)
                  ? agent.taskIds.join(', ')
                  : '',
              120,
              this.knownSecrets
            ),
          }))
      : [];

    return {
      runtime: 'visual-swarm',
      title: clipRedacted(data.name, 90, this.knownSecrets),
      line: clipRedacted(typeof data.goal === 'string' ? data.goal : '', 160, this.knownSecrets),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      workers: agents,
    };
  }

  async collectDesktopWorktrees(
    bridge: DesktopCapabilityBridge | undefined,
    repoRoot: string
  ): Promise<readonly InternalObservatorySession[]> {
    if (!bridge) return [];
    const leases = await bridge.worktree.listLeases().catch(() => []);
    return leases.map((lease) => {
      const mtimeMs = Date.parse(lease.createdAt) || Date.now();
      const status = lease.status === 'active' ? 'running' : 'idle';
      return {
        id: lease.runId,
        runtime: 'desktop-worktree',
        runtimeLabel: 'Desktop Sandbox',
        title: `Worktree ${lease.branchName}`,
        status,
        runState: lease.status.toUpperCase(),
        model: 'desktop-harness',
        branch: lease.branchName,
        cwd: lease.worktreePath || repoRoot,
        inCurrentWorkspace: true,
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: `Lease ${lease.leaseId} (${lease.allowedPaths.length} allowed paths)`,
        lastTool: 'worktree',
        lastError: '',
        errorCount: 0,
        steps: lease.fencingToken,
        tokens: { input: 0, cached: 0, output: 0, total: 0 },
        subagents: [],
        swarmWorkers: 0,
        toolCounts: { 'worktree.lease': 1 },
        updatedAt: lease.createdAt,
        mtimeMs,
        recentEvents: [
          {
            at: lease.createdAt,
            kind: 'tool',
            tool: 'worktree.lease',
            summary: `${lease.branchName} (${lease.status}) at ${lease.headCommit.slice(0, 8)}`,
          },
        ],
      };
    });
  }
}
