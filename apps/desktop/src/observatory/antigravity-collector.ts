import { existsSync, type Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '@moonwitness/types';
import {
  clipRedacted,
  DEFAULT_DETAIL_TAIL_BYTES,
  DEFAULT_TAIL_CHUNK_BYTES,
  deriveSessionStatus,
  readHeadAndTailLines,
  safeJsonParse,
} from './io.js';
import type {
  InternalObservatorySession,
  ObservatoryEvent,
  ObservatorySubagent,
  ObservatorySwarmSummary,
} from './types.js';

interface AntigravityConversationRecord {
  readonly id?: string;
  readonly metadata?: {
    readonly createTime?: string;
    readonly parentConversationId?: string;
    readonly rootConversationId?: string;
  };
  readonly annotations?: {
    readonly title?: string;
  };
  readonly state?: {
    readonly summary?: string;
    readonly runState?: string;
    readonly updateTime?: string;
  };
}

interface ParsedTranscriptSummary {
  readonly title: string;
  readonly model: string;
  readonly focus: string;
  readonly lastAction: string;
  readonly lastTool: string;
  readonly lastError: string;
  readonly hasRecentError: boolean;
  readonly inputTokens: number;
  readonly cacheTokens: number;
  readonly outputTokens: number;
  readonly stepCount: number;
  readonly lastTimestamp: string;
  readonly subagents: readonly ObservatorySubagent[];
  readonly events: readonly ObservatoryEvent[];
}

interface CacheEntry<T> {
  readonly mtimeMs: number;
  readonly size: number;
  readonly value: T;
}

const MAX_FULL_SCAN_BYTES = 25 * 1024 * 1024;

function unwrapArgValue(value: unknown): string {
  if (typeof value !== 'string') return value === undefined || value === null ? '' : String(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export interface AntigravityCollectorOptions {
  readonly homeDir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly enableLiveApi?: boolean;
  readonly knownSecrets?: readonly string[];
}

export interface AntigravityCollectResult {
  readonly connectedApi: boolean;
  readonly sessions: readonly InternalObservatorySession[];
  readonly swarms: readonly ObservatorySwarmSummary[];
}

export class AntigravityCollector {
  private readonly homeDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly enableLiveApi: boolean;
  private readonly knownSecrets: readonly string[];
  private readonly parseCache = new Map<string, CacheEntry<ParsedTranscriptSummary>>();
  private readonly subagentCache = new Map<string, CacheEntry<readonly ObservatorySubagent[]>>();
  private apiConnected = false;
  private liveMap = new Map<string, AntigravityConversationRecord>();
  private childrenByParent = new Map<string, readonly AntigravityConversationRecord[]>();

  constructor(options: AntigravityCollectorOptions) {
    this.homeDir = options.homeDir;
    this.env = options.env ?? process.env;
    this.enableLiveApi = options.enableLiveApi ?? true;
    const secrets = [...(options.knownSecrets ?? [])];
    if (this.env.ANTIGRAVITY_CSRF_TOKEN) secrets.push(this.env.ANTIGRAVITY_CSRF_TOKEN);
    this.knownSecrets = secrets;
  }

  private async callConversationService(
    method: string,
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<{ conversations?: AntigravityConversationRecord[] } | null> {
    if (!this.enableLiveApi) return null;
    const addr = this.env.ANTIGRAVITY_LS_ADDRESS;
    const csrf = this.env.ANTIGRAVITY_CSRF_TOKEN;
    if (!addr || !csrf) return null;

    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      const response = await fetch(`http://${addr}/product.v1.ConversationService/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-antigravity-csrf-token': csrf,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const json = (await response.json()) as unknown;
      return isRecord(json)
        ? (json as { conversations?: AntigravityConversationRecord[] })
        : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async refreshLiveApi(): Promise<boolean> {
    const data = await this.callConversationService(
      'ListConversations',
      { pageSize: 15, includeArchived: false },
      10_000
    );
    if (!data || !Array.isArray(data.conversations)) {
      this.apiConnected = false;
      return false;
    }

    const nextMap = new Map<string, AntigravityConversationRecord>();
    for (const conv of data.conversations) {
      if (conv && typeof conv.id === 'string') {
        nextMap.set(conv.id, conv);
      }
    }

    const parentIds = new Set<string>();
    for (const conv of data.conversations.slice(0, 5)) {
      if (conv.id) parentIds.add(conv.id);
    }
    if (this.env.ANTIGRAVITY_CONVERSATION_ID) {
      parentIds.add(this.env.ANTIGRAVITY_CONVERSATION_ID);
    }

    const nextChildren = new Map<string, readonly AntigravityConversationRecord[]>();
    await Promise.all(
      Array.from(parentIds).map(async (parentId) => {
        const childData = await this.callConversationService(
          'ListConversations',
          { parentConversationId: parentId, pageSize: 30, includeArchived: false },
          8_000
        );
        if (childData && Array.isArray(childData.conversations) && childData.conversations.length > 0) {
          nextChildren.set(parentId, childData.conversations);
          for (const child of childData.conversations) {
            if (child && typeof child.id === 'string') {
              nextMap.set(child.id, child);
            }
          }
        }
      })
    );

    this.liveMap = nextMap;
    this.childrenByParent = nextChildren;
    this.apiConnected = true;
    return true;
  }

  private async scanSubagents(
    transcriptPath: string,
    fileStat: Stats
  ): Promise<readonly ObservatorySubagent[]> {
    const cached = this.subagentCache.get(transcriptPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.value;
    }

    if (fileStat.size > MAX_FULL_SCAN_BYTES) {
      this.subagentCache.set(transcriptPath, {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        value: [],
      });
      return [];
    }

    const raw = await readFile(transcriptPath, 'utf8').catch(() => '');
    const found: ObservatorySubagent[] = [];
    const seen = new Set<string>();
    const fallbackIso = new Date(fileStat.mtimeMs).toISOString();

    for (const line of raw.split(/\r?\n/u)) {
      if (!line.includes('"invoke_subagent"') && !line.includes('"name":"swarm"')) continue;
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec || !Array.isArray(rec.tool_calls)) continue;
      for (const rawTc of rec.tool_calls) {
        if (!isRecord(rawTc) || typeof rawTc.name !== 'string') continue;
        const args = isRecord(rawTc.args) ? rawTc.args : {};
        const at = typeof rec.created_at === 'string' ? rec.created_at : fallbackIso;
        if (rawTc.name === 'invoke_subagent') {
          const role = clipRedacted(
            unwrapArgValue(args.Role ?? args.TypeName ?? 'subagent'),
            70,
            this.knownSecrets
          );
          const typeName = clipRedacted(
            unwrapArgValue(args.TypeName ?? 'subagent'),
            40,
            this.knownSecrets
          );
          const model = clipRedacted(
            unwrapArgValue(args.Model ?? 'inherit'),
            30,
            this.knownSecrets
          );
          const dedupeKey = `sub:${role}:${typeName}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            found.push({
              id: `sub-${typeof rec.step_index === 'number' ? rec.step_index : found.length}`,
              role,
              type: typeName,
              model,
              status: 'done',
              at,
            });
          }
        } else if (rawTc.name === 'swarm' && unwrapArgValue(args.action) === 'add') {
          const workerName = clipRedacted(
            unwrapArgValue(args.name ?? 'worker'),
            40,
            this.knownSecrets
          );
          const model = clipRedacted(
            unwrapArgValue(args.model ?? 'inherit'),
            30,
            this.knownSecrets
          );
          const dedupeKey = `swarm:${workerName}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            found.push({
              id: `swarm-${workerName}`,
              role: workerName,
              type: 'swarm-worker',
              model,
              status: 'done',
              at,
            });
          }
        }
      }
    }

    this.subagentCache.set(transcriptPath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: found,
    });
    return found;
  }

  async parseTranscript(
    convId: string,
    transcriptPath: string,
    fileStat: Stats,
    detailMode = false
  ): Promise<ParsedTranscriptSummary> {
    const cacheKey = `${transcriptPath}:${detailMode ? 'detail' : 'summary'}`;
    const cached = this.parseCache.get(cacheKey);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.value;
    }

    const { headLines, tailLines } = await readHeadAndTailLines(
      transcriptPath,
      fileStat.size,
      detailMode ? DEFAULT_DETAIL_TAIL_BYTES : DEFAULT_TAIL_CHUNK_BYTES
    );

    let title = '';
    let model = '';
    let focus = '';
    let lastAction = '';
    let lastTool = '';
    let lastError = '';
    let hasRecentError = false;
    let inputTokens = 0;
    let cacheTokens = 0;
    let outputTokens = 0;
    let stepCount = 0;
    let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
    const subagents: ObservatorySubagent[] = [];
    const events: ObservatoryEvent[] = [];

    for (const line of headLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec) continue;
      if (!title && rec.type === 'USER_INPUT' && typeof rec.content === 'string') {
        const reqMatch = rec.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/u);
        const prompt = reqMatch && reqMatch[1] ? reqMatch[1] : rec.content;
        title = clipRedacted(prompt.replace(/^#+\s*/gmu, ''), 95, this.knownSecrets);
      }
      if (!model && typeof rec.model === 'string') model = rec.model;
    }

    const seenSub = new Set<string>();
    for (const line of tailLines) {
      const rec = safeJsonParse<Record<string, unknown>>(line);
      if (!rec) continue;
      if (typeof rec.step_index === 'number') stepCount = Math.max(stepCount, rec.step_index + 1);
      if (typeof rec.created_at === 'string') lastTimestamp = rec.created_at;
      if (typeof rec.model === 'string') model = rec.model;
      if (typeof rec.input_tokens === 'number') inputTokens += rec.input_tokens;
      if (typeof rec.cache_read_tokens === 'number') cacheTokens += rec.cache_read_tokens;
      if (typeof rec.output_tokens === 'number') outputTokens += rec.output_tokens;

      const at = typeof rec.created_at === 'string' ? rec.created_at : lastTimestamp;
      if (rec.status === 'ERROR' || typeof rec.error === 'string') {
        hasRecentError = true;
        lastError = clipRedacted(rec.error ?? rec.content ?? 'Step error', 160, this.knownSecrets);
        events.push({ at, kind: 'error', tool: 'error', summary: lastError });
      }

      if (Array.isArray(rec.tool_calls)) {
        for (const rawTc of rec.tool_calls) {
          if (!isRecord(rawTc) || typeof rawTc.name !== 'string') continue;
          const args = isRecord(rawTc.args) ? rawTc.args : {};
          lastTool = rawTc.name;
          if (rawTc.name === 'update_focus' && args.focus !== undefined) {
            focus = clipRedacted(unwrapArgValue(args.focus), 120, this.knownSecrets);
            lastAction = focus;
            events.push({ at, kind: 'focus', tool: 'update_focus', summary: focus });
          } else if (rawTc.name === 'invoke_subagent') {
            const role = clipRedacted(
              unwrapArgValue(args.Role ?? args.TypeName ?? 'subagent'),
              60,
              this.knownSecrets
            );
            const typeName = clipRedacted(
              unwrapArgValue(args.TypeName ?? 'subagent'),
              40,
              this.knownSecrets
            );
            const subModel = clipRedacted(
              unwrapArgValue(args.Model ?? 'inherit'),
              30,
              this.knownSecrets
            );
            const key = `${typeName}:${role}:${String(rec.step_index ?? '')}`;
            if (!seenSub.has(key)) {
              seenSub.add(key);
              subagents.push({
                id: `${convId.slice(0, 8)}-s${String(rec.step_index ?? subagents.length)}`,
                role,
                type: typeName,
                model: subModel,
                at,
              });
            }
            lastAction = `Spawned subagent: ${role} (${typeName})`;
            events.push({ at, kind: 'subagent', tool: 'invoke_subagent', summary: lastAction });
          } else if (rawTc.name === 'swarm') {
            const action = unwrapArgValue(args.action ?? 'swarm');
            const workerName = unwrapArgValue(args.name ?? '');
            lastAction = clipRedacted(
              workerName ? `swarm ${action}: ${workerName}` : `swarm ${action}`,
              120,
              this.knownSecrets
            );
            events.push({ at, kind: 'swarm', tool: 'swarm', summary: lastAction });
          } else if (rawTc.name === 'run_command') {
            const summary = clipRedacted(
              unwrapArgValue(args.toolSummary ?? args.CommandLine ?? 'run_command'),
              120,
              this.knownSecrets
            );
            lastAction = summary;
            events.push({ at, kind: 'tool', tool: 'run_command', summary });
          } else {
            const target = unwrapArgValue(args.Path ?? args.query ?? args.focus ?? '');
            const summary = target
              ? `${rawTc.name} ${clipRedacted(target, 95, this.knownSecrets)}`
              : rawTc.name;
            lastAction = summary;
            events.push({ at, kind: 'tool', tool: rawTc.name, summary });
          }
        }
      } else if (rec.type === 'USER_INPUT' && typeof rec.content === 'string') {
        const reqMatch = rec.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/u);
        const message = clipRedacted(
          reqMatch && reqMatch[1] ? reqMatch[1] : rec.content,
          120,
          this.knownSecrets
        );
        if (message) {
          events.push({ at, kind: 'user', tool: 'user', summary: message });
        }
      }
    }

    const result: ParsedTranscriptSummary = {
      title,
      model,
      focus,
      lastAction,
      lastTool,
      lastError,
      hasRecentError,
      inputTokens,
      cacheTokens,
      outputTokens,
      stepCount,
      lastTimestamp,
      subagents,
      events: events.slice(-40),
    };

    this.parseCache.set(cacheKey, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: result,
    });
    return result;
  }

  async collect(repoRoot: string): Promise<AntigravityCollectResult> {
    const brainDir = path.join(this.homeDir, '.gemini', 'antigravity', 'brain');
    const sessions: InternalObservatorySession[] = [];
    const swarms: ObservatorySwarmSummary[] = [];
    const candidates: { convId: string; transcriptPath: string; fileStat: Stats }[] = [];

    if (existsSync(brainDir)) {
      const entries = await readdir(brainDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const transcriptPath = path.join(
          brainDir,
          entry.name,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );
        const fileStat = await stat(transcriptPath).catch(() => null);
        if (fileStat && fileStat.isFile()) {
          candidates.push({ convId: entry.name, transcriptPath, fileStat });
        }
      }
      candidates.sort((left, right) => right.fileStat.mtimeMs - left.fileStat.mtimeMs);
    }

    const currentConvId = this.env.ANTIGRAVITY_CONVERSATION_ID ?? '';

    for (const item of candidates.slice(0, 20)) {
      const [parsed, scannedSubs] = await Promise.all([
        this.parseTranscript(item.convId, item.transcriptPath, item.fileStat, false),
        this.scanSubagents(item.transcriptPath, item.fileStat),
      ]);

      const live = this.liveMap.get(item.convId);
      const liveChildren = this.childrenByParent.get(item.convId) ?? [];
      const mergedSubagents: ObservatorySubagent[] = [...scannedSubs];

      for (const sub of parsed.subagents) {
        if (!mergedSubagents.some((existing) => existing.role === sub.role && existing.type === sub.type)) {
          mergedSubagents.push(sub);
        }
      }
      for (const child of liveChildren) {
        if (!child.id || mergedSubagents.some((existing) => existing.id === child.id)) continue;
        mergedSubagents.unshift({
          id: child.id,
          role: clipRedacted(
            child.annotations?.title ?? child.state?.summary ?? child.id.slice(0, 8),
            70,
            this.knownSecrets
          ),
          type: 'live-subagent',
          model: 'antigravity',
          status: child.state?.runState === 'RUN_STATE_RUNNING' ? 'running' : 'idle',
          at: child.state?.updateTime ?? child.metadata?.createTime ?? parsed.lastTimestamp,
        });
      }

      const swarmPlanPath = path.join(brainDir, item.convId, '.system_generated', 'swarm', 'plan.json');
      let swarmWorkerCount = 0;
      if (existsSync(swarmPlanPath)) {
        const rawPlan = await readFile(swarmPlanPath, 'utf8').catch(() => '');
        const parsedPlan = safeJsonParse<Record<string, unknown>>(rawPlan.trim());
        if (parsedPlan && isRecord(parsedPlan.goal)) {
          const tasksRecord = isRecord(parsedPlan.tasks) ? parsedPlan.tasks : {};
          const workers = Object.entries(tasksRecord).map(([name, desc]) => ({
            name,
            task: clipRedacted(String(desc ?? ''), 140, this.knownSecrets),
          }));
          swarmWorkerCount = workers.length;
          const threads = Array.isArray(parsedPlan.threads)
            ? parsedPlan.threads
                .filter((itemThread): itemThread is Record<string, unknown> => isRecord(itemThread))
                .map((th) => ({
                  id: String(th.id ?? ''),
                  title: clipRedacted(String(th.title ?? th.id ?? ''), 80, this.knownSecrets),
                  tasks: Array.isArray(th.tasks) ? th.tasks.map(String) : [],
                }))
            : [];
          swarms.push({
            runtime: 'antigravity',
            conversationId: item.convId,
            title: clipRedacted(String(parsedPlan.goal.title ?? 'Swarm'), 100, this.knownSecrets),
            line: clipRedacted(String(parsedPlan.goal.line ?? ''), 180, this.knownSecrets),
            workers,
            threads,
          });
        }
      }

      const explicitRunState = live?.state?.runState ?? null;
      const status = deriveSessionStatus(item.fileStat.mtimeMs, explicitRunState, parsed.hasRecentError);
      const title = clipRedacted(
        live?.annotations?.title ??
          live?.state?.summary ??
          (parsed.title || `Conversation ${item.convId.slice(0, 8)}`),
        100,
        this.knownSecrets
      );

      sessions.push({
        id: item.convId,
        runtime: 'antigravity',
        runtimeLabel: 'Antigravity',
        title,
        status,
        runState: explicitRunState ?? (status === 'running' ? 'ACTIVE' : 'IDLE'),
        model: parsed.model || 'antigravity',
        branch: null,
        cwd: repoRoot,
        inCurrentWorkspace: true,
        isCurrentSession: item.convId === currentConvId,
        parentId: live?.metadata?.parentConversationId ?? null,
        rootId: live?.metadata?.rootConversationId ?? null,
        focus: parsed.focus || parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        steps: parsed.stepCount,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.inputTokens + parsed.outputTokens,
        },
        subagents: mergedSubagents,
        swarmWorkers: swarmWorkerCount,
        updatedAt: live?.state?.updateTime ?? parsed.lastTimestamp,
        mtimeMs: item.fileStat.mtimeMs,
        sourcePath: item.transcriptPath,
        recentEvents: parsed.events.slice(-8),
      });
    }

    return {
      connectedApi: this.apiConnected,
      sessions,
      swarms,
    };
  }
}
