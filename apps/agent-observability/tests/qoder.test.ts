import { describe, expect, it } from 'vitest';
import { QoderTelemetryBridge } from '../src/qoder.js';
import { TelemetryStore } from '../src/store.js';
import { NOW_MS } from './fixtures.js';

describe('QoderTelemetryBridge', () => {
  it('correlates a prompt, tool call, and turn completion into one trace', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    expect(
      bridge.handle({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-1',
        prompt: 'hello',
        agent_type: 'researcher',
      })
    ).toBe(true);
    now += 20;
    bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      tool_name: 'Read',
      tool_use_id: 'tool-1',
      tool_input: { file_path: 'README.md' },
    });
    now += 80;
    bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-1',
      tool_name: 'Read',
      tool_use_id: 'tool-1',
      tool_response: 'file contents',
    });
    now += 30;
    bridge.handle({
      hook_event_name: 'Stop',
      session_id: 'session-1',
      last_assistant_message: 'done',
    });

    const summary = store.listTraces()[0];
    expect(summary).toMatchObject({
      rootName: 'qoder.prompt',
      durationMs: 130,
      spanCount: 2,
      errorCount: 0,
      runId: 'session-1',
      agentName: 'researcher',
    });
    const detail = store.getTrace(summary!.traceId);
    expect(detail?.spans[0]).toMatchObject({
      name: 'qoder.prompt',
      status: 'ok',
      durationMs: 130,
      attributes: { 'qoder.prompt_chars': 5, 'qoder.response_chars': 4 },
    });
    expect(detail?.spans[1]).toMatchObject({
      name: 'qoder.tool.Read',
      parentSpanId: detail?.spans[0]?.spanId,
      toolName: 'Read',
      status: 'ok',
      durationMs: 80,
    });
  });

  it('does not retain prompts, tool payloads, responses, or assistant messages', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });
    const secrets = {
      prompt: 'prompt-private-content',
      tool: 'tool-private-content',
      response: 'response-private-content',
      assistant: 'assistant-private-content',
    };

    bridge.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-private',
      prompt: secrets.prompt,
    });
    now += 10;
    bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-private',
      tool_name: 'Bash',
      tool_use_id: 'tool-private',
      tool_input: { command: secrets.tool },
    });
    now += 20;
    bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-private',
      tool_name: 'Bash',
      tool_use_id: 'tool-private',
      tool_response: { output: secrets.response },
    });
    now += 30;
    bridge.handle({
      hook_event_name: 'Stop',
      session_id: 'session-private',
      last_assistant_message: secrets.assistant,
    });

    const stored = JSON.stringify({
      summary: store.summary(),
      traces: store.listTraces(),
      logs: store.listLogs(),
      metrics: store.listMetrics(),
    });
    for (const secret of Object.values(secrets)) expect(stored).not.toContain(secret);
  });

  it('records tool and turn failures without raw error content', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    bridge.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-error',
      prompt: 'private prompt',
    });
    now += 10;
    bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-error',
      tool_name: 'Bash',
      tool_use_id: 'tool-error',
    });
    now += 10;
    bridge.handle({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'session-error',
      tool_name: 'Bash',
      tool_use_id: 'tool-error',
      error: 'raw tool error with private details',
      error_type: 'execution_error',
    });
    now += 10;
    bridge.handle({
      hook_event_name: 'StopFailure',
      session_id: 'session-error',
      error: 'raw turn error with private details',
      error_type: 'api_error',
    });

    expect(store.summary()).toMatchObject({ errorCount: 2, errorLogCount: 2 });
    const detail = store.getTrace(store.listTraces()[0]!.traceId);
    expect(detail?.spans.every((span) => span.status === 'error')).toBe(true);
    expect(store.listLogs({ severity: 'ERROR' })).toHaveLength(2);
    const stored = JSON.stringify({ traces: detail, logs: store.listLogs() });
    expect(stored).not.toContain('raw tool error');
    expect(stored).not.toContain('raw turn error');
  });

  it('correlates subagent activity under the active prompt', () => {
    let now = NOW_MS;
    const store = new TelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    bridge.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'session-agent' });
    now += 10;
    bridge.handle({
      hook_event_name: 'SubagentStart',
      session_id: 'session-agent',
      agent_id: 'agent-1',
      agent_type: 'reviewer',
    });
    now += 40;
    bridge.handle({
      hook_event_name: 'SubagentStop',
      session_id: 'session-agent',
      agent_id: 'agent-1',
      agent_type: 'reviewer',
      last_assistant_message: 'private subagent response',
    });
    now += 10;
    bridge.handle({ hook_event_name: 'Stop', session_id: 'session-agent' });

    const trace = store.getTrace(store.listTraces()[0]!.traceId);
    expect(trace?.spans).toHaveLength(2);
    expect(trace?.spans[1]).toMatchObject({
      name: 'qoder.subagent.reviewer',
      parentSpanId: trace?.spans[0]?.spanId,
      agentName: 'reviewer',
      durationMs: 40,
      attributes: { 'qoder.agent_id': 'agent-1' },
    });
    expect(JSON.stringify(trace)).not.toContain('private subagent response');
  });

  it('groups tool-only sessions under a safe synthetic root', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    const bridge = new QoderTelemetryBridge({ store, now: () => NOW_MS });

    expect(
      bridge.handle({
        hook_event_name: 'PostToolUse',
        session_id: 'session-fallback',
        tool_name: 'Glob',
        tool_use_id: 'tool-fallback',
        tool_response: 'private response',
      })
    ).toBe(true);
    bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-fallback',
      tool_name: 'Read',
      tool_use_id: 'tool-fallback-2',
      tool_response: 'another private response',
    });

    const trace = store.getTrace(store.listTraces()[0]!.traceId);
    const root = trace?.spans.find((span) => span.name === 'qoder.session');
    const glob = trace?.spans.find((span) => span.name === 'qoder.tool.Glob');
    const read = trace?.spans.find((span) => span.name === 'qoder.tool.Read');
    expect(trace?.spans).toHaveLength(3);
    expect(root).toMatchObject({ status: 'ok' });
    expect(glob).toMatchObject({
      parentSpanId: root?.spanId,
      status: 'ok',
      durationMs: 0,
    });
    expect(read).toMatchObject({ parentSpanId: root?.spanId });
    expect(JSON.stringify(trace)).not.toContain('private response');
  });

  it('emits cumulative Qoder counters', () => {
    const store = new TelemetryStore({ now: () => NOW_MS });
    const bridge = new QoderTelemetryBridge({ store, now: () => NOW_MS });

    bridge.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'session-metrics' });
    bridge.handle({ hook_event_name: 'Stop', session_id: 'session-metrics' });
    bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-metrics',
      tool_name: 'Read',
      tool_use_id: 'tool-metrics',
    });
    bridge.handle({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'session-metrics',
      tool_name: 'Bash',
      tool_use_id: 'tool-failure-metrics',
      error_type: 'execution_error',
    });

    const metrics = store.listMetrics();
    expect(metrics.find((series) => series.name === 'qoder.prompt.count')?.points[0]?.value).toBe(
      1
    );
    expect(metrics.find((series) => series.name === 'qoder.tool.count')?.points[0]?.value).toBe(2);
    expect(metrics.find((series) => series.name === 'qoder.error.count')?.points[0]?.value).toBe(1);
  });
});
