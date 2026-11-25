export const NOW_MS = 1_700_000_000_000;
export const TRACE_ID = '11111111111111111111111111111111';
export const ROOT_SPAN_ID = '1111111111111111';
export const CHILD_SPAN_ID = '2222222222222222';

export function nanos(milliseconds: number): string {
  return (BigInt(milliseconds) * 1_000_000n).toString();
}

export function tracePayload(nowMs = NOW_MS) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'test-agent' } },
            { key: 'deployment.environment', value: { stringValue: 'test' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'test-scope', version: '1.0.0' },
            spans: [
              {
                traceId: TRACE_ID,
                spanId: ROOT_SPAN_ID,
                name: 'agent.run',
                kind: 1,
                startTimeUnixNano: nanos(nowMs),
                endTimeUnixNano: nanos(nowMs + 250),
                attributes: [
                  { key: 'moonwitness.run_id', value: { stringValue: 'run-123' } },
                  { key: 'moonwitness.agent.name', value: { stringValue: 'researcher' } },
                  {
                    key: 'custom.labels',
                    value: {
                      arrayValue: {
                        values: [{ stringValue: 'alpha' }, { intValue: '2' }],
                      },
                    },
                  },
                ],
                events: [
                  {
                    timeUnixNano: nanos(nowMs + 10),
                    name: 'agent.started',
                    attributes: [{ key: 'attempt', value: { intValue: '1' } }],
                  },
                ],
                status: { code: 1 },
              },
              {
                traceId: TRACE_ID,
                spanId: CHILD_SPAN_ID,
                parentSpanId: ROOT_SPAN_ID,
                name: 'tool.search',
                kind: 3,
                startTimeUnixNano: nanos(nowMs + 50),
                endTimeUnixNano: nanos(nowMs + 120),
                attributes: [
                  { key: 'moonwitness.tool.name', value: { stringValue: 'workspace.search' } },
                  { key: 'gen_ai.usage.input_tokens', value: { intValue: '840' } },
                  { key: 'gen_ai.usage.output_tokens', value: { intValue: '320' } },
                  { key: 'moonwitness.cost_usd', value: { doubleValue: 0.0042 } },
                  { key: 'password', value: { stringValue: 'super-secret-value' } },
                ],
                status: { code: 2, message: 'tool failed' },
              },
              {
                traceId: TRACE_ID,
                spanId: '3333333333333333',
                name: 'invalid',
                startTimeUnixNano: 'not-a-number',
              },
            ],
          },
        ],
      },
    ],
  };
}

export function logPayload() {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'test-agent' } }],
        },
        scopeLogs: [
          {
            scope: { name: 'test-scope' },
            logRecords: [
              {
                timeUnixNano: nanos(NOW_MS + 200),
                observedTimeUnixNano: nanos(NOW_MS + 201),
                severityNumber: 17,
                severityText: 'ERROR',
                body: { stringValue: 'Provider failed with Bearer abcdef123456' },
                traceId: TRACE_ID,
                spanId: CHILD_SPAN_ID,
                attributes: [
                  { key: 'moonwitness.run_id', value: { stringValue: 'run-123' } },
                  { key: 'api_key', value: { stringValue: 'sk-test-12345678901234567890' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function metricPayload() {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'test-agent' } }],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'agent.tool.calls',
                description: 'Tool calls',
                unit: '1',
                sum: {
                  dataPoints: [
                    {
                      startTimeUnixNano: nanos(NOW_MS),
                      endTimeUnixNano: nanos(NOW_MS + 100),
                      asInt: '3',
                      attributes: [
                        { key: 'tool.name', value: { stringValue: 'workspace.search' } },
                      ],
                    },
                  ],
                },
              },
              {
                name: 'agent.run.duration',
                description: 'Run duration',
                unit: 'ms',
                histogram: {
                  dataPoints: [
                    {
                      startTimeUnixNano: nanos(NOW_MS),
                      endTimeUnixNano: nanos(NOW_MS + 200),
                      count: '2',
                      sum: 540,
                      min: 120,
                      max: 420,
                      attributes: [],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
