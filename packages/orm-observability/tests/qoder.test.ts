import { describe, expect, it } from 'vitest';
import { QoderTelemetryBridge } from '../src/qoder.js';
import { MemoryTelemetryStore } from '../src/memory-store.js';
import { NOW_MS } from './fixtures.js';

describe('QoderTelemetryBridge', () => {
  it('correlates a prompt, tool call, and turn completion into one trace', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    expect(
      await bridge.handle({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-1',
        prompt: 'hello',
        agent_type: 'researcher',
      })
    ).toBe(true);
    now += 20;
    await bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      tool_name: 'Read',
      tool_use_id: 'tool-1',
      tool_input: { file_path: 'README.md' },
    });
    now += 80;
    await bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-1',
      tool_name: 'Read',
      tool_use_id: 'tool-1',
      tool_response: 'file contents',
    });
    now += 30;
    await bridge.handle({
      hook_event_name: 'Stop',
      session_id: 'session-1',
      last_assistant_message: 'done',
    });

    const summary = (await store.listTraces())[0];
    expect(summary).toMatchObject({
      rootName: 'qoder.prompt',
      durationMs: 130,
      spanCount: 2,
      errorCount: 0,
      runId: 'session-1',
      agentName: 'researcher',
    });
    const detail = await store.getTrace(summary!.traceId);
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

  it('serializes concurrent hook delivery to preserve correlation', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const bridge = new QoderTelemetryBridge({ store, now: () => NOW_MS });

    const results = await Promise.all([
      bridge.handle({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-concurrent',
        prompt: 'hello',
      }),
      bridge.handle({
        hook_event_name: 'PreToolUse',
        session_id: 'session-concurrent',
        tool_name: 'Read',
        tool_use_id: 'tool-concurrent',
      }),
      bridge.handle({
        hook_event_name: 'PostToolUse',
        session_id: 'session-concurrent',
        tool_name: 'Read',
        tool_use_id: 'tool-concurrent',
      }),
      bridge.handle({ hook_event_name: 'Stop', session_id: 'session-concurrent' }),
    ]);

    expect(results).toEqual([true, true, true, true]);
    const trace = await store.getTrace((await store.listTraces())[0]!.traceId);
    expect(trace?.spans).toHaveLength(2);
    expect(trace?.spans.find((span) => span.name === 'qoder.tool.Read')?.parentSpanId).toBe(
      trace?.spans.find((span) => span.name === 'qoder.prompt')?.spanId
    );
  });

  it('does not retain prompts, tool payloads, responses, or assistant messages', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });
    const secrets = {
      prompt: 'prompt-private-content',
      tool: 'tool-private-content',
      response: 'response-private-content',
      assistant: 'assistant-private-content',
    };

    await bridge.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-private',
      prompt: secrets.prompt,
    });
    now += 10;
    await bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-private',
      tool_name: 'Bash',
      tool_use_id: 'tool-private',
      tool_input: { command: secrets.tool },
    });
    now += 20;
    await bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-private',
      tool_name: 'Bash',
      tool_use_id: 'tool-private',
      tool_response: { output: secrets.response },
    });
    now += 30;
    await bridge.handle({
      hook_event_name: 'Stop',
      session_id: 'session-private',
      last_assistant_message: secrets.assistant,
    });

    const stored = JSON.stringify({
      summary: await store.summary(),
      traces: await store.listTraces(),
      logs: await store.listLogs(),
      metrics: await store.listMetrics(),
    });
    for (const secret of Object.values(secrets)) expect(stored).not.toContain(secret);
  });

  it('records tool and turn failures without raw error content', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    await bridge.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-error',
      prompt: 'private prompt',
    });
    now += 10;
    await bridge.handle({
      hook_event_name: 'PreToolUse',
      session_id: 'session-error',
      tool_name: 'Bash',
      tool_use_id: 'tool-error',
    });
    now += 10;
    await bridge.handle({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'session-error',
      tool_name: 'Bash',
      tool_use_id: 'tool-error',
      error: 'raw tool error with private details',
      error_type: 'execution_error',
    });
    now += 10;
    await bridge.handle({
      hook_event_name: 'StopFailure',
      session_id: 'session-error',
      error: 'raw turn error with private details',
      error_type: 'api_error',
    });

    expect(await store.summary()).toMatchObject({ errorCount: 2, errorLogCount: 2 });
    const detail = await store.getTrace((await store.listTraces())[0]!.traceId);
    expect(detail?.spans.every((span) => span.status === 'error')).toBe(true);
    expect(await store.listLogs({ severity: 'ERROR' })).toHaveLength(2);
    const stored = JSON.stringify({ traces: detail, logs: await store.listLogs() });
    expect(stored).not.toContain('raw tool error');
    expect(stored).not.toContain('raw turn error');
  });

  it('correlates subagent activity under the active prompt', async () => {
    let now = NOW_MS;
    const store = new MemoryTelemetryStore({ now: () => now });
    const bridge = new QoderTelemetryBridge({ store, now: () => now });

    await bridge.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'session-agent' });
    now += 10;
    await bridge.handle({
      hook_event_name: 'SubagentStart',
      session_id: 'session-agent',
      agent_id: 'agent-1',
      agent_type: 'reviewer',
    });
    now += 40;
    await bridge.handle({
      hook_event_name: 'SubagentStop',
      session_id: 'session-agent',
      agent_id: 'agent-1',
      agent_type: 'reviewer',
      last_assistant_message: 'private subagent response',
    });
    now += 10;
    await bridge.handle({ hook_event_name: 'Stop', session_id: 'session-agent' });

    const trace = await store.getTrace((await store.listTraces())[0]!.traceId);
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

  it('groups tool-only sessions under a safe synthetic root', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const bridge = new QoderTelemetryBridge({ store, now: () => NOW_MS });

    expect(
      await bridge.handle({
        hook_event_name: 'PostToolUse',
        session_id: 'session-fallback',
        tool_name: 'Glob',
        tool_use_id: 'tool-fallback',
        tool_response: 'private response',
      })
    ).toBe(true);
    await bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-fallback',
      tool_name: 'Read',
      tool_use_id: 'tool-fallback-2',
      tool_response: 'another private response',
    });

    const trace = await store.getTrace((await store.listTraces())[0]!.traceId);
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

  it('emits cumulative Qoder counters', async () => {
    const store = new MemoryTelemetryStore({ now: () => NOW_MS });
    const bridge = new QoderTelemetryBridge({ store, now: () => NOW_MS });

    await bridge.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'session-metrics' });
    await bridge.handle({ hook_event_name: 'Stop', session_id: 'session-metrics' });
    await bridge.handle({
      hook_event_name: 'PostToolUse',
      session_id: 'session-metrics',
      tool_name: 'Read',
      tool_use_id: 'tool-metrics',
    });
    await bridge.handle({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'session-metrics',
      tool_name: 'Bash',
      tool_use_id: 'tool-failure-metrics',
      error_type: 'execution_error',
    });

    const metrics = await store.listMetrics();
    expect(metrics.find((series) => series.name === 'qoder.prompt.count')?.points[0]?.value).toBe(
      1
    );
    expect(metrics.find((series) => series.name === 'qoder.tool.count')?.points[0]?.value).toBe(2);
    expect(metrics.find((series) => series.name === 'qoder.error.count')?.points[0]?.value).toBe(1);
  });
});
