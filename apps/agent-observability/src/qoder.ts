import { randomBytes } from 'node:crypto';
import type { TelemetryStore } from './store.js';
import type { LogRecord, LogSeverity, MetricSeries, SpanRecord, SpanStatus } from './types.js';

const QODER_EVENTS = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'Notification',
]);
const MAX_STATE_AGE_MS = 10 * 60 * 1_000;
const MAX_PROMPTS = 500;
const MAX_PENDING = 2_000;

interface PromptState {
  sessionId: string;
  traceId: string;
  spanId: string;
  agentName: string;
  startTimeMs: number;
  promptChars: number;
  permissionMode?: string;
  synthetic?: boolean;
}

interface ToolState {
  sessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  agentName: string;
  toolName: string;
  startTimeMs: number;
}

interface SubagentState {
  sessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  agentName: string;
  startTimeMs: number;
}

interface SpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  runId: string;
  agentName: string;
  status: SpanStatus;
  statusMessage?: string;
  startTimeMs: number;
  endTimeMs: number;
  toolName?: string;
  attributes: Record<string, unknown>;
}

interface LogInput {
  timestampMs: number;
  severity: LogSeverity;
  body: string;
  sessionId: string;
  traceId?: string;
  spanId?: string;
  agentName?: string;
  attributes?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readText(value: unknown, maximum = 256): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : undefined;
}

function textLength(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function createSpan(input: SpanInput): SpanRecord {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    name: input.name,
    serviceName: 'qoder',
    scopeName: 'qoder-hooks',
    kind: 'internal',
    status: input.status,
    ...(input.statusMessage ? { statusMessage: input.statusMessage } : {}),
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
    durationMs: Math.max(0, input.endTimeMs - input.startTimeMs),
    runId: input.runId,
    agentName: input.agentName,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    attributes: { 'qoder.integration': 'hooks', ...input.attributes },
    resourceAttributes: { 'service.name': 'qoder' },
    events: [],
  };
}

export class QoderTelemetryBridge {
  private readonly prompts = new Map<string, PromptState>();
  private readonly tools = new Map<string, ToolState>();
  private readonly subagents = new Map<string, SubagentState>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly options: { store: TelemetryStore; now?: () => number }) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  private readonly store: TelemetryStore;
  private readonly now: () => number;

  handle(input: unknown): boolean {
    const event = asRecord(input);
    const eventName = readText(event?.hook_event_name, 128);
    const sessionId = readText(event?.session_id, 256);
    if (!event || !eventName || !sessionId || !QODER_EVENTS.has(eventName)) return false;

    const now = this.now();
    this.pruneState(now);

    switch (eventName) {
      case 'SessionStart':
        this.writeLog({
          timestampMs: now,
          severity: 'INFO',
          body: `Qoder session started (${readText(event.source, 64) ?? 'unknown'})`,
          sessionId,
          attributes: { 'qoder.event': eventName, 'qoder.source': readText(event.source, 64) },
        });
        return true;
      case 'SessionEnd':
        this.finishPrompt(this.prompts.get(sessionId), now, 'ok');
        this.writeLog({
          timestampMs: now,
          severity: 'INFO',
          body: `Qoder session ended (${readText(event.reason, 64) ?? 'unknown'})`,
          sessionId,
          attributes: { 'qoder.event': eventName, 'qoder.reason': readText(event.reason, 64) },
        });
        return true;
      case 'UserPromptSubmit':
        this.startPrompt(event, sessionId, now);
        return true;
      case 'PreToolUse':
        return this.startTool(event, sessionId, now);
      case 'PostToolUse':
        return this.finishTool(event, sessionId, now, false);
      case 'PostToolUseFailure':
        return this.finishTool(event, sessionId, now, true);
      case 'PermissionRequest':
        this.writePermissionLog(event, sessionId, now, 'requested');
        return true;
      case 'PermissionDenied':
        this.writePermissionLog(event, sessionId, now, 'denied');
        return true;
      case 'Stop': {
        const prompt = this.prompts.get(sessionId);
        if (!prompt) return true;
        this.finishPrompt(prompt, now, 'ok', textLength(event.last_assistant_message));
        this.writeLog({
          timestampMs: now,
          severity: 'INFO',
          body: 'Qoder turn completed',
          sessionId,
          traceId: prompt.traceId,
          spanId: prompt.spanId,
          agentName: prompt.agentName,
          attributes: { 'qoder.event': eventName },
        });
        return true;
      }
      case 'StopFailure': {
        const prompt = this.prompts.get(sessionId);
        const errorType = readText(event.error_type, 128) ?? 'unknown';
        this.finishPrompt(
          prompt,
          now,
          'error',
          textLength(event.last_assistant_message),
          errorType
        );
        this.incrementCounter('qoder.error.count', now);
        this.writeLog({
          timestampMs: now,
          severity: 'ERROR',
          body: `Qoder turn failed (${errorType})`,
          sessionId,
          ...(prompt ? { traceId: prompt.traceId, spanId: prompt.spanId } : {}),
          ...(prompt ? { agentName: prompt.agentName } : {}),
          attributes: { 'qoder.event': eventName, 'qoder.error_type': errorType },
        });
        return true;
      }
      case 'SubagentStart':
        return this.startSubagent(event, sessionId, now);
      case 'SubagentStop':
        return this.finishSubagent(event, sessionId, now);
      case 'PreCompact':
      case 'PostCompact':
        this.writeLog({
          timestampMs: now,
          severity: 'INFO',
          body: `Qoder context compaction (${readText(event.trigger, 64) ?? 'unknown'})`,
          sessionId,
          attributes: {
            'qoder.event': eventName,
            'qoder.trigger': readText(event.trigger, 64),
          },
        });
        return true;
      case 'Notification':
        this.writeLog({
          timestampMs: now,
          severity: readText(event.notification_type, 64) === 'permission_prompt' ? 'WARN' : 'INFO',
          body: `Qoder notification (${readText(event.notification_type, 64) ?? 'unknown'})`,
          sessionId,
          attributes: {
            'qoder.event': eventName,
            'qoder.notification_type': readText(event.notification_type, 64),
          },
        });
        return true;
      default:
        return true;
    }
  }

  private startPrompt(event: Record<string, unknown>, sessionId: string, now: number): void {
    this.finishPrompt(this.prompts.get(sessionId), now, 'ok');
    const prompt: PromptState = {
      sessionId,
      traceId: randomHex(16),
      spanId: randomHex(8),
      agentName: readText(event.agent_type, 128) ?? 'qoder',
      startTimeMs: now,
      promptChars: textLength(event.prompt),
      ...(readText(event.permission_mode, 64)
        ? { permissionMode: readText(event.permission_mode, 64) }
        : {}),
    };
    this.prompts.set(sessionId, prompt);
  }

  private promptSpan(
    prompt: PromptState,
    endTimeMs: number,
    status: SpanStatus,
    responseChars = 0,
    errorType?: string
  ): SpanRecord {
    return createSpan({
      traceId: prompt.traceId,
      spanId: prompt.spanId,
      name: prompt.synthetic ? 'qoder.session' : 'qoder.prompt',
      runId: prompt.sessionId,
      agentName: prompt.agentName,
      status,
      ...(status === 'error' && errorType
        ? { statusMessage: `Qoder turn failed (${errorType})` }
        : {}),
      startTimeMs: prompt.startTimeMs,
      endTimeMs,
      attributes: {
        'qoder.event': prompt.synthetic ? 'PreToolUse' : 'UserPromptSubmit',
        'qoder.session_id': prompt.sessionId,
        'qoder.prompt_chars': prompt.promptChars,
        'qoder.response_chars': responseChars,
        ...(prompt.permissionMode ? { 'qoder.permission_mode': prompt.permissionMode } : {}),
      },
    });
  }

  private finishPrompt(
    prompt: PromptState | undefined,
    now: number,
    status: SpanStatus,
    responseChars = 0,
    errorType?: string
  ): void {
    if (!prompt) return;
    if (this.prompts.get(prompt.sessionId) === prompt) this.prompts.delete(prompt.sessionId);
    const endTimeMs = Math.max(now, prompt.startTimeMs);
    this.store.ingestSpans([this.promptSpan(prompt, endTimeMs, status, responseChars, errorType)]);
    if (!prompt.synthetic) this.incrementCounter('qoder.prompt.count', endTimeMs);
  }

  private ensureSyntheticPrompt(
    event: Record<string, unknown>,
    sessionId: string,
    now: number
  ): PromptState {
    const existing = this.prompts.get(sessionId);
    if (existing) return existing;
    const prompt: PromptState = {
      sessionId,
      traceId: randomHex(16),
      spanId: randomHex(8),
      agentName: readText(event.agent_type, 128) ?? 'qoder',
      startTimeMs: now,
      promptChars: 0,
      synthetic: true,
    };
    this.prompts.set(sessionId, prompt);
    this.store.ingestSpans([this.promptSpan(prompt, now, 'ok')]);
    return prompt;
  }

  private startTool(event: Record<string, unknown>, sessionId: string, now: number): boolean {
    const toolName = readText(event.tool_name, 256);
    const toolUseId = readText(event.tool_use_id, 256);
    if (!toolName || !toolUseId) return false;
    const prompt = this.ensureSyntheticPrompt(event, sessionId, now);
    this.tools.set(`${sessionId}\u0000${toolUseId}`, {
      sessionId,
      traceId: prompt?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      ...(prompt ? { parentSpanId: prompt.spanId } : {}),
      agentName: readText(event.agent_type, 128) ?? prompt?.agentName ?? 'qoder',
      toolName,
      startTimeMs: now,
    });
    return true;
  }

  private finishTool(
    event: Record<string, unknown>,
    sessionId: string,
    now: number,
    failed: boolean
  ): boolean {
    const toolName = readText(event.tool_name, 256);
    const toolUseId = readText(event.tool_use_id, 256);
    if (!toolName || !toolUseId) return false;
    const key = `${sessionId}\u0000${toolUseId}`;
    const pending = this.tools.get(key);
    this.tools.delete(key);
    const prompt =
      this.prompts.get(sessionId) ??
      (pending ? undefined : this.ensureSyntheticPrompt(event, sessionId, now));
    const state: ToolState = pending ?? {
      sessionId,
      traceId: prompt?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      ...(prompt ? { parentSpanId: prompt.spanId } : {}),
      agentName: readText(event.agent_type, 128) ?? prompt?.agentName ?? 'qoder',
      toolName,
      startTimeMs: now,
    };
    const endTimeMs = Math.max(now, state.startTimeMs);
    const errorType = readText(event.error_type, 128);
    this.store.ingestSpans([
      createSpan({
        traceId: state.traceId,
        spanId: state.spanId,
        ...(state.parentSpanId ? { parentSpanId: state.parentSpanId } : {}),
        name: `qoder.tool.${state.toolName}`,
        runId: sessionId,
        agentName: state.agentName,
        status: failed ? 'error' : 'ok',
        ...(failed
          ? { statusMessage: `Qoder tool failed${errorType ? ` (${errorType})` : ''}` }
          : {}),
        startTimeMs: state.startTimeMs,
        endTimeMs,
        toolName: state.toolName,
        attributes: {
          'qoder.event': failed ? 'PostToolUseFailure' : 'PostToolUse',
          'qoder.session_id': sessionId,
          'qoder.tool_use_id': toolUseId,
          ...(readText(event.agent_id, 256)
            ? { 'qoder.agent_id': readText(event.agent_id, 256) }
            : {}),
          ...(readText(event.agent_type, 128)
            ? { 'qoder.agent_type': readText(event.agent_type, 128) }
            : {}),
          ...(errorType ? { 'qoder.error_type': errorType } : {}),
        },
      }),
    ]);
    this.incrementCounter('qoder.tool.count', endTimeMs);
    if (failed) {
      this.incrementCounter('qoder.error.count', endTimeMs);
      this.writeLog({
        timestampMs: endTimeMs,
        severity: 'ERROR',
        body: `Qoder tool ${state.toolName} failed${errorType ? ` (${errorType})` : ''}`,
        sessionId,
        traceId: state.traceId,
        spanId: state.spanId,
        agentName: state.agentName,
        attributes: {
          'qoder.event': 'PostToolUseFailure',
          'qoder.tool_use_id': toolUseId,
          ...(errorType ? { 'qoder.error_type': errorType } : {}),
        },
      });
    }
    return true;
  }

  private startSubagent(event: Record<string, unknown>, sessionId: string, now: number): boolean {
    const agentId = readText(event.agent_id, 256);
    if (!agentId) return false;
    const prompt = this.ensureSyntheticPrompt(event, sessionId, now);
    this.subagents.set(`${sessionId}\u0000${agentId}`, {
      sessionId,
      traceId: prompt?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      ...(prompt ? { parentSpanId: prompt.spanId } : {}),
      agentName: readText(event.agent_type, 128) ?? 'subagent',
      startTimeMs: now,
    });
    return true;
  }

  private finishSubagent(event: Record<string, unknown>, sessionId: string, now: number): boolean {
    const agentId = readText(event.agent_id, 256);
    if (!agentId) return false;
    const key = `${sessionId}\u0000${agentId}`;
    const pending = this.subagents.get(key);
    this.subagents.delete(key);
    const prompt =
      this.prompts.get(sessionId) ??
      (pending ? undefined : this.ensureSyntheticPrompt(event, sessionId, now));
    const state: SubagentState = pending ?? {
      sessionId,
      traceId: prompt?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      ...(prompt ? { parentSpanId: prompt.spanId } : {}),
      agentName: readText(event.agent_type, 128) ?? 'subagent',
      startTimeMs: now,
    };
    const endTimeMs = Math.max(now, state.startTimeMs);
    this.store.ingestSpans([
      createSpan({
        traceId: state.traceId,
        spanId: state.spanId,
        ...(state.parentSpanId ? { parentSpanId: state.parentSpanId } : {}),
        name: `qoder.subagent.${state.agentName}`,
        runId: sessionId,
        agentName: state.agentName,
        status: 'ok',
        startTimeMs: state.startTimeMs,
        endTimeMs,
        attributes: {
          'qoder.event': 'SubagentStop',
          'qoder.session_id': sessionId,
          'qoder.agent_id': agentId,
          ...(readText(event.agent_type, 128)
            ? { 'qoder.agent_type': readText(event.agent_type, 128) }
            : {}),
        },
      }),
    ]);
    this.incrementCounter('qoder.subagent.count', endTimeMs);
    return true;
  }

  private writePermissionLog(
    event: Record<string, unknown>,
    sessionId: string,
    now: number,
    action: 'requested' | 'denied'
  ): void {
    const toolName = readText(event.tool_name, 256) ?? 'unknown';
    this.writeLog({
      timestampMs: now,
      severity: 'WARN',
      body: `Qoder permission ${action} for ${toolName}`,
      sessionId,
      attributes: {
        'qoder.event': action === 'denied' ? 'PermissionDenied' : 'PermissionRequest',
        'qoder.tool_name': toolName,
      },
    });
  }

  private writeLog(input: LogInput): void {
    const log: LogRecord = {
      id: randomHex(10),
      timestampMs: input.timestampMs,
      serviceName: 'qoder',
      scopeName: 'qoder-hooks',
      severity: input.severity,
      severityText: input.severity,
      body: input.body.slice(0, 512),
      runId: input.sessionId,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.spanId ? { spanId: input.spanId } : {}),
      ...(input.agentName ? { agentName: input.agentName } : {}),
      attributes: { 'qoder.integration': 'hooks', ...input.attributes },
      resourceAttributes: { 'service.name': 'qoder' },
    };
    this.store.ingestLogs([log]);
  }

  private incrementCounter(name: string, timestampMs: number): void {
    const value = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, value);
    const series: MetricSeries = {
      id: `qoder:${name}`,
      name,
      type: 'sum',
      serviceName: 'qoder',
      scopeName: 'qoder-hooks',
      points: [{ timestampMs, value, attributes: {} }],
    };
    this.store.ingestMetrics([series]);
  }

  private pruneState(now: number): void {
    const cutoff = now - MAX_STATE_AGE_MS;
    for (const [key, value] of this.prompts) {
      if (value.startTimeMs < cutoff) this.prompts.delete(key);
    }
    for (const [key, value] of this.tools) {
      if (value.startTimeMs < cutoff) this.tools.delete(key);
    }
    for (const [key, value] of this.subagents) {
      if (value.startTimeMs < cutoff) this.subagents.delete(key);
    }
    this.trimState(this.prompts, MAX_PROMPTS);
    this.trimState(this.tools, MAX_PENDING);
    this.trimState(this.subagents, MAX_PENDING);
  }

  private trimState<T extends { startTimeMs: number }>(
    state: Map<string, T>,
    maximum: number
  ): void {
    if (state.size <= maximum) return;
    const oldest = [...state.entries()].sort(
      (left, right) => left[1].startTimeMs - right[1].startTimeMs
    );
    for (const [key] of oldest.slice(0, state.size - maximum)) state.delete(key);
  }
}
