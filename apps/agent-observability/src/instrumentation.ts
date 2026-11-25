import {
  context,
  logs,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export type OtlpHttpProtocol = 'http/json';

export interface AgentTelemetryOptions {
  serviceName?: string;
  serviceVersion?: string;
  endpoint?: string;
  protocol?: OtlpHttpProtocol;
  headers?: Record<string, string>;
  metricIntervalMs?: number;
}

export interface AgentSpanAttributes {
  runId?: string;
  agentName?: string;
  provider?: string;
  model?: string;
  toolName?: string;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

let activeSdk: NodeSDK | undefined;

function resolveProtocol(value: string | undefined): OtlpHttpProtocol {
  if (value === undefined || value === '' || value === 'http/json') return 'http/json';
  throw new Error('The MoonWitness API observability addon accepts OTLP over http/json');
}

function endpointFor(signal: 'traces' | 'metrics' | 'logs', baseEndpoint: string): string {
  const specific = process.env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`];
  if (specific) return specific;
  return `${baseEndpoint.replace(/\/+$/u, '')}/v1/${signal}`;
}

export function startAgentTelemetry(options: AgentTelemetryOptions = {}): NodeSDK {
  if (activeSdk) return activeSdk;
  const endpoint =
    options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:3000';
  resolveProtocol(options.protocol ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL);
  const serviceName = options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'moonwitness-agent';
  const serviceVersion = options.serviceVersion ?? process.env.OTEL_SERVICE_VERSION;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
    'moonwitness.telemetry': 'agent',
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: endpointFor('traces', endpoint),
      ...(options.headers ? { headers: options.headers } : {}),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: endpointFor('metrics', endpoint),
          ...(options.headers ? { headers: options.headers } : {}),
        }),
        exportIntervalMillis: options.metricIntervalMs ?? 15_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: endpointFor('logs', endpoint),
          ...(options.headers ? { headers: options.headers } : {}),
        }),
      }),
    ],
  });
  sdk.start();
  activeSdk = sdk;
  return sdk;
}

export async function stopAgentTelemetry(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = undefined;
  if (sdk) await sdk.shutdown();
}

export function getAgentTelemetrySdk(): NodeSDK | undefined {
  return activeSdk;
}

export function createAgentTracer(name = 'moonwitness-agent'): Tracer {
  return trace.getTracer(name);
}

export function agentSpanAttributes(input: AgentSpanAttributes = {}): Attributes {
  return {
    ...(input.runId ? { 'moonwitness.run_id': input.runId } : {}),
    ...(input.agentName ? { 'moonwitness.agent.name': input.agentName } : {}),
    ...(input.provider ? { 'moonwitness.provider': input.provider } : {}),
    ...(input.model ? { 'moonwitness.model': input.model } : {}),
    ...(input.toolName ? { 'moonwitness.tool.name': input.toolName } : {}),
  };
}

export function recordAgentUsage(span: Span, usage: AgentUsage): void {
  const totalTokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  span.setAttributes({
    ...(usage.inputTokens !== undefined ? { 'gen_ai.usage.input_tokens': usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined
      ? { 'gen_ai.usage.output_tokens': usage.outputTokens }
      : {}),
    ...(usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined
      ? { 'gen_ai.usage.total_tokens': totalTokens }
      : {}),
    ...(usage.costUsd !== undefined ? { 'moonwitness.cost_usd': usage.costUsd } : {}),
  });
}

export function recordAgentEvent(span: Span, name: string, attributes: Attributes = {}): void {
  span.addEvent(name, attributes);
}

export function emitAgentLog(
  body: string,
  attributes: Attributes = {},
  activeContext: Context = context.active(),
  severityNumber: SeverityNumber = SeverityNumber.INFO
): void {
  logs.getLogger('moonwitness-agent').emit({
    body,
    attributes,
    context: activeContext,
    severityNumber,
    severityText: SeverityNumber[severityNumber],
  });
}

export async function withAgentSpan<T>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  operation: (span: Span) => T | Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, options, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      span.recordException(normalized);
      span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { metrics, trace };
