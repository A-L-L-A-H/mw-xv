import { existsSync, type Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '@moonwitness/types';
import type { DesktopCapabilityBridge } from '../types.js';
import {
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
  readonly hasRecentError: boolean;
  readonly inputTokens: number;
  readonly cacheTokens: number;
  readonly outputTokens: number;
  readonly turns: number;
  readonly lastTimestamp: string;
  readonly subagents: readonly ObservatorySubagent[];
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
  readonly hasRecentError: boolean;
  readonly inputTokens: number;
  readonly cacheTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly steps: number;
  readonly lastTimestamp: string;
  readonly events: readonly ObservatoryEvent[];
}

const MAX_FULL_SCAN_BYTES = 25 * 1024 * 1024;

export interface ExternalAgentsCollectorOptions {
  readonly homeDir: string;
  readonly knownSecrets?: readonly string[];
}

export class ExternalAgentsCollector {
  private readonly homeDir: string;
  private readonly knownSecrets: readonly string[];
  private readonly claudeCache = new Map<string, CacheEntry<ParsedClaudeSummary>>();
  private readonly claudeSubCache = new Map<string, CacheEntry<readonly ObservatorySubagent[]>>();
  private readonly codexCache = new Map<string, CacheEntry<ParsedCodexSummary>>();

  constructor(options: ExternalAgentsCollectorOptions) {
    this.homeDir = options.homeDir;
    this.knownSecrets = options.knownSecrets ?? [];
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
      this.claudeSubCache.set(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: [] });
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
    let hasRecentError = false;
    let inputTokens = 0;
    let cacheTokens = 0;
    let outputTokens = 0;
    let turns = 0;
    let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
    const subagents: ObservatorySubagent[] = [];
    const events: ObservatoryEvent[] = [];

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
      if (!title && rec.type === 'user' && isRecord(rec.message) && typeof rec.message.content === 'string') {
        const schedMatch = rec.message.content.match(/<scheduled-task\s+name="([^"]+)"/u);
        title = schedMatch && schedMatch[1]
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
            const input = isRecord(block.input) ? block.input : {};
            const desc =
              input.description ?? input.file_path ?? input.pattern ?? input.command ?? input.prompt ?? '';
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
                type: clipRedacted(String(input.subagent_type ?? 'general-purpose'), 40, this.knownSecrets),
                model: clipRedacted(String(input.model ?? model ?? 'inherit'), 40, this.knownSecrets),
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
      } else if (rec.type === 'user' && isRecord(rec.message) && Array.isArray(rec.message.content)) {
        for (const block of rec.message.content) {
          if (isRecord(block) && block.type === 'tool_result' && block.is_error === true) {
            hasRecentError = true;
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
      hasRecentError,
      inputTokens,
      cacheTokens,
      outputTokens,
      turns,
      lastTimestamp,
      subagents,
      events: events.slice(-40),
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
    const candidates: { sessionId: string; fullPath: string; projPath: string; fileStat: Stats }[] = [];

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
        steps: parsed.turns,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.inputTokens + parsed.outputTokens,
        },
        subagents: mergedSubs,
        swarmWorkers: 0,
        updatedAt: parsed.lastTimestamp,
        mtimeMs: item.fileStat.mtimeMs,
        sourcePath: item.fullPath,
        recentEvents: parsed.events.slice(-8),
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
    let hasRecentError = false;
    let inputTokens = 0;
    let cacheTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let steps = 0;
    let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
    const events: ObservatoryEvent[] = [];

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
      } else if (rec.type === 'event_msg' && p.type === 'thread_settings_applied' && isRecord(p.thread_settings)) {
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
              (entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.text === 'string'
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
            const summary = clipRedacted(rawCmd, 115, this.knownSecrets);
            lastAction = summary;
            if (failed) {
              hasRecentError = true;
              lastError = `exit=${exitCode ?? 1}: ${summary}`;
              events.push({ at, kind: 'error', tool: 'exec_command', summary: lastError });
            } else {
              events.push({ at, kind: 'tool', tool: 'exec_command', summary });
            }
          }
        }
      } else if (rec.type === 'response_item' && p.type === 'custom_tool_call') {
        lastTool = typeof p.name === 'string' ? p.name : 'exec';
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
      hasRecentError,
      inputTokens,
      cacheTokens,
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
      steps,
      lastTimestamp,
      events: events.slice(-40),
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
        steps: parsed.steps,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.totalTokens,
        },
        subagents: [],
        swarmWorkers: 0,
        updatedAt: parsed.lastTimestamp,
        mtimeMs: file.stat.mtimeMs,
        sourcePath: file.fullPath,
        recentEvents: parsed.events.slice(-8),
      });
    }
    return sessions;
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
        steps: tailLines.length,
        tokens: { input: 0, cached: 0, output: 0, total: 0 },
        subagents: [],
        swarmWorkers: 0,
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
        steps: lease.fencingToken,
        tokens: { input: 0, cached: 0, output: 0, total: 0 },
        subagents: [],
        swarmWorkers: 0,
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
