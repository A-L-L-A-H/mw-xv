import path from 'node:path';
import { createSqliteTelemetryStore, type TelemetryStore } from '@moonwitness/orm-observability';
import { buildApp } from './app.js';

export interface ObservabilityConfig {
  host: string;
  port: number;
  databasePath: string;
  retentionMs: number;
  maxSpans: number;
  maxLogs: number;
  maxMetricSeries: number;
  maxMetricPoints: number;
}

function readPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ObservabilityConfig {
  return {
    host: env.AGENT_OBSERVABILITY_HOST?.trim() || '127.0.0.1',
    port: readPositiveInteger(env.AGENT_OBSERVABILITY_PORT, 4_318, 65_535),
    databasePath:
      env.AGENT_OBSERVABILITY_DB_PATH?.trim() ||
      path.resolve(process.cwd(), '.qoder-tmp/agent-observability.sqlite'),
    retentionMs: readPositiveInteger(env.AGENT_OBSERVABILITY_RETENTION_MS, 3_600_000, 86_400_000),
    maxSpans: readPositiveInteger(env.AGENT_OBSERVABILITY_MAX_SPANS, 5_000, 100_000),
    maxLogs: readPositiveInteger(env.AGENT_OBSERVABILITY_MAX_LOGS, 5_000, 100_000),
    maxMetricSeries: readPositiveInteger(env.AGENT_OBSERVABILITY_MAX_METRICS, 1_000, 20_000),
    maxMetricPoints: readPositiveInteger(env.AGENT_OBSERVABILITY_MAX_METRIC_POINTS, 120, 10_000),
  };
}

export async function startObservabilityServer(
  options: Partial<ObservabilityConfig> = {}
): Promise<{ app: ReturnType<typeof buildApp>['app']; store: TelemetryStore; address: string }> {
  const config = { ...loadConfig(), ...options };
  const store = await createSqliteTelemetryStore({
    filename: config.databasePath,
    maxSpans: config.maxSpans,
    maxLogs: config.maxLogs,
    maxMetricSeries: config.maxMetricSeries,
    maxMetricPoints: config.maxMetricPoints,
    retentionMs: config.retentionMs,
  });

  try {
    const { app } = buildApp({ store });
    const address = await app.listen({ host: config.host, port: config.port });
    return { app, store, address };
  } catch (error) {
    await store.close();
    throw error;
  }
}
