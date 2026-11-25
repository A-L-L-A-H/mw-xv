import { randomBytes } from 'node:crypto';
import type { IngestContext, LogRecord, LogSeverity, MetricSeries, QoderStateRepository, SpanRecord, SpanStatus, TelemetryStore } from './types.js';

const QODER_EVENTS = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Notification']);
const MAX_STATE_AGE_MS = 10 * 60_000;
interface PromptState { sessionId: string; traceId: string; spanId: string; agentName: string; startTimeMs: number; promptChars: number; permissionMode?: string; synthetic?: boolean }
interface ChildState { sessionId: string; traceId: string; spanId: string; parentSpanId?: string; agentName: string; startTimeMs: number; toolName?: string }
interface SpanInput { traceId: string; spanId: string; parentSpanId?: string; name: string; runId: string; agentName: string; status: SpanStatus; statusMessage?: string; startTimeMs: number; endTimeMs: number; toolName?: string; attributes: Record<string, unknown> }
interface LogInput { timestampMs: number; severity: LogSeverity; body: string; sessionId: string; traceId?: string; spanId?: string; agentName?: string; attributes?: Record<string, unknown> }
function asRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined }
function readText(value: unknown, maximum = 256): string | undefined { if (typeof value !== 'string') return undefined; const trimmed = value.trim(); return trimmed ? trimmed.slice(0, maximum) : undefined }
function textLength(value: unknown): number { return typeof value === 'string' ? value.length : 0 }
function randomHex(bytes: number): string { return randomBytes(bytes).toString('hex') }
function createSpan(input: SpanInput): SpanRecord {
  return { traceId: input.traceId, spanId: input.spanId, ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}), name: input.name, serviceName: 'qoder', scopeName: 'qoder-hooks', kind: 'internal', status: input.status, ...(input.statusMessage ? { statusMessage: input.statusMessage } : {}), startTimeMs: input.startTimeMs, endTimeMs: input.endTimeMs, durationMs: Math.max(0, input.endTimeMs - input.startTimeMs), runId: input.runId, agentName: input.agentName, ...(input.toolName ? { toolName: input.toolName } : {}), attributes: { 'qoder.integration': 'hooks', ...input.attributes }, resourceAttributes: { 'service.name': 'qoder' }, events: [] };
}

export class QoderTelemetryBridge {
  private readonly store: TelemetryStore;
  private readonly now: () => number;
  constructor(options: { store: TelemetryStore; now?: () => number }) { this.store = options.store; this.now = options.now ?? Date.now }
  async handle(input: unknown, context: IngestContext = {}): Promise<boolean> {
    const event = asRecord(input); const eventName = readText(event?.hook_event_name, 128); const sessionId = readText(event?.session_id, 256);
    if (!event || !eventName || !sessionId || !QODER_EVENTS.has(eventName)) return false;
    if (!this.store.withQoderState) throw new Error('Durable Qoder correlation requires a SQL telemetry store');
    const now = this.now();
    await this.store.withQoderState(context, async (state) => this.process(event, eventName, sessionId, now, state, context));
    return true;
  }
  private async process(event: Record<string, unknown>, eventName: string, sessionId: string, now: number, state: QoderStateRepository, context: IngestContext): Promise<void> {
    switch (eventName) {
      case 'SessionStart': await this.writeLog({ timestampMs: now, severity: 'INFO', body: `Qoder session started (${readText(event.source, 64) ?? 'unknown'})`, sessionId, attributes: { 'qoder.event': eventName, 'qoder.source': readText(event.source, 64) } }, state); return;
      case 'SessionEnd': await this.finishPrompt((await state.get<PromptState>('prompt', sessionId))?.value, now, 'ok', state, context); await this.writeLog({ timestampMs: now, severity: 'INFO', body: `Qoder session ended (${readText(event.reason, 64) ?? 'unknown'})`, sessionId, attributes: { 'qoder.event': eventName, 'qoder.reason': readText(event.reason, 64) } }, state); return;
      case 'UserPromptSubmit': await this.startPrompt(event, sessionId, now, state, context); return;
      case 'PreToolUse': await this.startTool(event, sessionId, now, state, context, 'tool'); return;
      case 'PostToolUse': await this.finishTool(event, sessionId, now, false, state, context); return;
      case 'PostToolUseFailure': await this.finishTool(event, sessionId, now, true, state, context); return;
      case 'PermissionRequest': await this.writePermissionLog(event, sessionId, now, 'requested', state); return;
      case 'PermissionDenied': await this.writePermissionLog(event, sessionId, now, 'denied', state); return;
      case 'Stop': { const prompt = (await state.get<PromptState>('prompt', sessionId))?.value; if (!prompt) return; await this.finishPrompt(prompt, now, 'ok', state, context, textLength(event.last_assistant_message)); await this.writeLog({ timestampMs: now, severity: 'INFO', body: 'Qoder turn completed', sessionId, traceId: prompt.traceId, spanId: prompt.spanId, agentName: prompt.agentName, attributes: { 'qoder.event': eventName } }, state); return }
      case 'StopFailure': { const prompt = (await state.get<PromptState>('prompt', sessionId))?.value; const errorType = readText(event.error_type, 128) ?? 'unknown'; await this.finishPrompt(prompt, now, 'error', state, context, textLength(event.last_assistant_message), errorType); await this.incrementCounter('qoder.error.count', now, state, context); await this.writeLog({ timestampMs: now, severity: 'ERROR', body: `Qoder turn failed (${errorType})`, sessionId, ...(prompt ? { traceId: prompt.traceId, spanId: prompt.spanId, agentName: prompt.agentName } : {}), attributes: { 'qoder.event': eventName, 'qoder.error_type': errorType } }, state); return }
      case 'SubagentStart': await this.startTool(event, sessionId, now, state, context, 'subagent'); return;
      case 'SubagentStop': await this.finishSubagent(event, sessionId, now, state, context); return;
      case 'PreCompact': case 'PostCompact': await this.writeLog({ timestampMs: now, severity: 'INFO', body: `Qoder context compaction (${readText(event.trigger, 64) ?? 'unknown'})`, sessionId, attributes: { 'qoder.event': eventName, 'qoder.trigger': readText(event.trigger, 64) } }, state); return;
      case 'Notification': await this.writeLog({ timestampMs: now, severity: readText(event.notification_type, 64) === 'permission_prompt' ? 'WARN' : 'INFO', body: `Qoder notification (${readText(event.notification_type, 64) ?? 'unknown'})`, sessionId, attributes: { 'qoder.event': eventName, 'qoder.notification_type': readText(event.notification_type, 64) } }, state); return;
    }
  }
  private async startPrompt(event: Record<string, unknown>, sessionId: string, now: number, state: QoderStateRepository, context: IngestContext): Promise<void> {
    await this.finishPrompt((await state.get<PromptState>('prompt', sessionId))?.value, now, 'ok', state, context);
    const permissionMode = readText(event.permission_mode, 64);
    const prompt: PromptState = { sessionId, traceId: randomHex(16), spanId: randomHex(8), agentName: readText(event.agent_type, 128) ?? 'qoder', startTimeMs: now, promptChars: textLength(event.prompt), ...(permissionMode ? { permissionMode } : {}) };
    await state.set('prompt', sessionId, prompt, now + MAX_STATE_AGE_MS);
  }
  private promptSpan(prompt: PromptState, endTimeMs: number, status: SpanStatus, responseChars = 0, errorType?: string): SpanRecord {
    return createSpan({ traceId: prompt.traceId, spanId: prompt.spanId, name: prompt.synthetic ? 'qoder.session' : 'qoder.prompt', runId: prompt.sessionId, agentName: prompt.agentName, status, ...(status === 'error' && errorType ? { statusMessage: `Qoder turn failed (${errorType})` } : {}), startTimeMs: prompt.startTimeMs, endTimeMs, attributes: { 'qoder.event': prompt.synthetic ? 'PreToolUse' : 'UserPromptSubmit', 'qoder.session_id': prompt.sessionId, 'qoder.prompt_chars': prompt.promptChars, 'qoder.response_chars': responseChars, ...(prompt.permissionMode ? { 'qoder.permission_mode': prompt.permissionMode } : {}) } });
  }
  private async finishPrompt(prompt: PromptState | undefined, now: number, status: SpanStatus, state: QoderStateRepository, context: IngestContext, responseChars = 0, errorType?: string): Promise<void> {
    if (!prompt) return;
    const endTimeMs = Math.max(now, prompt.startTimeMs);
    // Delete is the completion claim. A duplicate hook cannot emit another completion.
    await state.delete('prompt', prompt.sessionId);
    await state.ingestSpans([this.promptSpan(prompt, endTimeMs, status, responseChars, errorType)]);
    if (!prompt.synthetic) await this.incrementCounter('qoder.prompt.count', endTimeMs, state, context);
  }
  private async ensureSyntheticPrompt(event: Record<string, unknown>, sessionId: string, now: number, state: QoderStateRepository, context: IngestContext): Promise<PromptState> {
    const existing = (await state.get<PromptState>('prompt', sessionId))?.value; if (existing) return existing;
    const prompt: PromptState = { sessionId, traceId: randomHex(16), spanId: randomHex(8), agentName: readText(event.agent_type, 128) ?? 'qoder', startTimeMs: now, promptChars: 0, synthetic: true };
    await state.set('prompt', sessionId, prompt, now + MAX_STATE_AGE_MS);
    await state.ingestSpans([this.promptSpan(prompt, now, 'ok')]); return prompt;
  }
  private async startTool(event: Record<string, unknown>, sessionId: string, now: number, state: QoderStateRepository, context: IngestContext, kind: 'tool' | 'subagent'): Promise<void> {
    const id = readText(kind === 'tool' ? event.tool_use_id : event.agent_id, 256); const name = kind === 'tool' ? readText(event.tool_name, 256) : readText(event.agent_type, 128) ?? 'subagent'; if (!id || !name) throw new Error('Invalid Qoder child hook');
    const prompt = await this.ensureSyntheticPrompt(event, sessionId, now, state, context);
    const child: ChildState = { sessionId, traceId: prompt.traceId, spanId: randomHex(8), parentSpanId: prompt.spanId, agentName: readText(event.agent_type, 128) ?? prompt.agentName, startTimeMs: now, ...(kind === 'tool' ? { toolName: name } : {}) };
    await state.set(kind, `${sessionId}\u0000${id}`, child, now + MAX_STATE_AGE_MS);
  }
  private async finishTool(event: Record<string, unknown>, sessionId: string, now: number, failed: boolean, state: QoderStateRepository, context: IngestContext): Promise<void> {
    const toolName = readText(event.tool_name, 256); const toolUseId = readText(event.tool_use_id, 256); if (!toolName || !toolUseId) throw new Error('Invalid Qoder tool completion');
    const key = `${sessionId}\u0000${toolUseId}`; const pending = (await state.get<ChildState>('tool', key))?.value;
    const prompt = pending ? undefined : await this.ensureSyntheticPrompt(event, sessionId, now, state, context);
    const child: ChildState = pending ?? { sessionId, traceId: prompt?.traceId ?? randomHex(16), spanId: randomHex(8), ...(prompt ? { parentSpanId: prompt.spanId } : {}), agentName: readText(event.agent_type, 128) ?? prompt?.agentName ?? 'qoder', toolName, startTimeMs: now };
    await state.delete('tool', key); const endTimeMs = Math.max(now, child.startTimeMs); const errorType = readText(event.error_type, 128);
    await state.ingestSpans([createSpan({ traceId: child.traceId, spanId: child.spanId, ...(child.parentSpanId ? { parentSpanId: child.parentSpanId } : {}), name: `qoder.tool.${child.toolName}`, runId: sessionId, agentName: child.agentName, status: failed ? 'error' : 'ok', ...(failed ? { statusMessage: `Qoder tool failed${errorType ? ` (${errorType})` : ''}` } : {}), startTimeMs: child.startTimeMs, endTimeMs, toolName: child.toolName, attributes: { 'qoder.event': failed ? 'PostToolUseFailure' : 'PostToolUse', 'qoder.session_id': sessionId, 'qoder.tool_use_id': toolUseId, ...(errorType ? { 'qoder.error_type': errorType } : {}) } })]);
    await this.incrementCounter('qoder.tool.count', endTimeMs, state, context); if (failed) await this.incrementCounter('qoder.error.count', endTimeMs, state, context);
    if (failed) await this.writeLog({ timestampMs: endTimeMs, severity: 'ERROR', body: `Qoder tool ${child.toolName} failed${errorType ? ` (${errorType})` : ''}`, sessionId, traceId: child.traceId, spanId: child.spanId, agentName: child.agentName, attributes: { 'qoder.event': 'PostToolUseFailure', 'qoder.tool_use_id': toolUseId, ...(errorType ? { 'qoder.error_type': errorType } : {}) } }, state);
  }
  private async finishSubagent(event: Record<string, unknown>, sessionId: string, now: number, state: QoderStateRepository, context: IngestContext): Promise<void> {
    const agentId = readText(event.agent_id, 256); if (!agentId) throw new Error('Invalid Qoder subagent completion'); const key = `${sessionId}\u0000${agentId}`;
    const pending = (await state.get<ChildState>('subagent', key))?.value; const prompt = pending ? undefined : await this.ensureSyntheticPrompt(event, sessionId, now, state, context);
    const child: ChildState = pending ?? { sessionId, traceId: prompt?.traceId ?? randomHex(16), spanId: randomHex(8), ...(prompt ? { parentSpanId: prompt.spanId } : {}), agentName: readText(event.agent_type, 128) ?? 'subagent', startTimeMs: now };
    await state.delete('subagent', key); const endTimeMs = Math.max(now, child.startTimeMs);
    await state.ingestSpans([createSpan({ traceId: child.traceId, spanId: child.spanId, ...(child.parentSpanId ? { parentSpanId: child.parentSpanId } : {}), name: `qoder.subagent.${child.agentName}`, runId: sessionId, agentName: child.agentName, status: 'ok', startTimeMs: child.startTimeMs, endTimeMs, attributes: { 'qoder.event': 'SubagentStop', 'qoder.session_id': sessionId, 'qoder.agent_id': agentId } })]);
    await this.incrementCounter('qoder.subagent.count', endTimeMs, state, context);
  }
  private async writePermissionLog(event: Record<string, unknown>, sessionId: string, now: number, action: 'requested' | 'denied', state: QoderStateRepository): Promise<void> { const toolName = readText(event.tool_name, 256) ?? 'unknown'; await this.writeLog({ timestampMs: now, severity: 'WARN', body: `Qoder permission ${action} for ${toolName}`, sessionId, attributes: { 'qoder.event': action === 'denied' ? 'PermissionDenied' : 'PermissionRequest', 'qoder.tool_name': toolName } }, state) }
  private async writeLog(input: LogInput, state: QoderStateRepository): Promise<void> {
    const log: LogRecord = { id: randomHex(10), timestampMs: input.timestampMs, serviceName: 'qoder', scopeName: 'qoder-hooks', severity: input.severity, severityText: input.severity, body: input.body.slice(0, 512), runId: input.sessionId, ...(input.traceId ? { traceId: input.traceId } : {}), ...(input.spanId ? { spanId: input.spanId } : {}), ...(input.agentName ? { agentName: input.agentName } : {}), attributes: { 'qoder.integration': 'hooks', ...input.attributes }, resourceAttributes: { 'service.name': 'qoder' } };
    await state.ingestLogs([log]);
  }
  private async incrementCounter(name: string, timestampMs: number, state: QoderStateRepository, context: IngestContext): Promise<void> {
    const prior = (await state.get<{ value: number }>('counter', name))?.value.value ?? 0; await state.set('counter', name, { value: prior + 1 }, timestampMs + MAX_STATE_AGE_MS);
    const series: MetricSeries = { id: `qoder:${name}`, name, type: 'sum', serviceName: 'qoder', scopeName: 'qoder-hooks', points: [{ timestampMs, value: prior + 1, attributes: {} }] };
    await state.ingestMetrics([series]);
  }
}
