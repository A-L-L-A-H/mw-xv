import { context, metrics, SpanStatusCode } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import {
  agentSpanAttributes,
  createAgentTracer,
  emitAgentLog,
  recordAgentEvent,
  recordAgentUsage,
  startAgentTelemetry,
  stopAgentTelemetry,
  withAgentSpan,
} from '../src/instrumentation.js';

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  startAgentTelemetry({
    serviceName: 'moonwitness-demo-agent',
    serviceVersion: '1.0.0',
    metricIntervalMs: 500,
  });

  const runId = `demo-${Date.now()}`;
  const tracer = createAgentTracer('demo-agent');
  const toolCalls = metrics.getMeter('demo-agent').createCounter('agent.tool.calls', {
    description: 'Number of tool calls made by the demo agent',
    unit: '1',
  });
  const runDuration = metrics.getMeter('demo-agent').createHistogram('agent.run.duration', {
    description: 'Demo agent run duration',
    unit: 'ms',
  });

  await withAgentSpan(
    tracer,
    'agent.run',
    { attributes: agentSpanAttributes({ runId, agentName: 'research-agent' }) },
    async (runSpan) => {
      const startedAt = Date.now();
      recordAgentEvent(runSpan, 'agent.started', { 'moonwitness.mode': 'demo' });
      emitAgentLog(
        'Research agent started',
        agentSpanAttributes({ runId, agentName: 'research-agent' }),
        context.active(),
        SeverityNumber.INFO
      );

      await withAgentSpan(
        tracer,
        'gen_ai.invoke_provider',
        {
          attributes: {
            ...agentSpanAttributes({ runId, agentName: 'research-agent' }),
            'gen_ai.operation.name': 'chat',
            'gen_ai.system': 'demo-provider',
            'gen_ai.request.model': 'demo-model',
          },
        },
        async (providerSpan) => {
          await delay(120);
          recordAgentUsage(providerSpan, {
            inputTokens: 840,
            outputTokens: 320,
            totalTokens: 1160,
            costUsd: 0.0042,
          });
          providerSpan.setStatus({ code: SpanStatusCode.OK });
        }
      );

      await withAgentSpan(
        tracer,
        'tool.search',
        {
          attributes: agentSpanAttributes({
            runId,
            agentName: 'research-agent',
            toolName: 'workspace.search',
          }),
        },
        async (toolSpan) => {
          await delay(65);
          toolSpan.setAttribute('tool.result.count', 3);
          toolCalls.add(1, agentSpanAttributes({ runId, toolName: 'workspace.search' }));
          toolSpan.setStatus({ code: SpanStatusCode.OK });
        }
      );

      runDuration.record(Date.now() - startedAt, agentSpanAttributes({ runId }));
      runSpan.setAttribute('moonwitness.result', 'completed');
      runSpan.setStatus({ code: SpanStatusCode.OK });
      emitAgentLog(
        'Research agent completed',
        agentSpanAttributes({ runId, agentName: 'research-agent' }),
        context.active(),
        SeverityNumber.INFO
      );
    }
  );

  await delay(650);
  await stopAgentTelemetry();
  console.log(`Demo telemetry exported for ${runId}`);
}

void main().catch(async (error: unknown) => {
  console.error(error);
  await stopAgentTelemetry();
  process.exitCode = 1;
});
