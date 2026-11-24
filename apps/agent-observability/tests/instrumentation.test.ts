import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

const environmentKeys = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
] as const;

const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]] as const));

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('agent telemetry exporter configuration', () => {
  it('lets exporters merge and decode generic and signal-specific headers', async () => {
    let logHeaders: Record<string, string | string[] | undefined> | undefined;
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        if (request.url === '/v1/logs') logHeaders = request.headers;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');

    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'shared=generic,encoded=hello%20world';
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'shared=logs,logs-only=yes';
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;

    const { emitAgentLog, startAgentTelemetry, stopAgentTelemetry } =
      await import('../src/instrumentation.js');
    try {
      startAgentTelemetry({ metricIntervalMs: 60_000 });
      emitAgentLog('header precedence check');
      await stopAgentTelemetry();

      expect(logHeaders).toMatchObject({
        shared: 'logs',
        encoded: 'hello world',
        'logs-only': 'yes',
      });
    } finally {
      await stopAgentTelemetry();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
