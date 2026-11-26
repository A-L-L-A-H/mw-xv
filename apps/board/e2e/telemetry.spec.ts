import { expect, test, type Page } from '@playwright/test';
import { E2E_SUPERADMIN_PASSWORD } from './constants.js';

async function openMissionControl(
  page: Page,
  telemetryOptions: { empty?: boolean; failLogs?: boolean; global?: boolean; metricPoints?: unknown[] } = {}
) {
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill('superadmin');
  await page.getByLabel('Password', { exact: true }).fill(E2E_SUPERADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enter the Shadow' }).click();
  await expect(page).toHaveURL(/\/board$/u);
  await page.route('**/api/ai/agents', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/ai/work-contracts', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/ai/runs', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/ai/artifacts', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/ai/interactive-sessions**', (route) => route.fulfill({ json: { success: true, data: [] } }));
  const requested = await mockTelemetry(page, telemetryOptions);
  await page.goto('/board/ai/mission-control');
  await expect(page.getByRole('region', { name: 'Durable Interactive Sessions' })).toBeVisible();
  return requested;
}

function trace(traceId: string, rootName: string) {
  return {
    traceId, rootName, startedAt: 1_700_000_000_000, durationMs: 12, spanCount: 1,
    errorCount: 0, serviceNames: ['api'], runId: `run-${traceId}`, inputTokens: 1,
    outputTokens: 2, totalTokens: 3, costUsd: 0,
  };
}

function span(traceId: string) {
  return {
    traceId, spanId: `span-${traceId}`, name: `span ${traceId}`, serviceName: 'api', kind: 'server',
    status: 'ok', startTimeMs: 1_700_000_000_000, endTimeMs: 1_700_000_000_012, durationMs: 12,
    runId: `run-${traceId}`, attributes: { raw: 'hidden-span-attribute' }, resourceAttributes: {}, events: [],
  };
}

function log(id: string, traceId?: string) {
  return {
    id, timestampMs: 1_700_000_000_000, serviceName: 'api', severity: 'INFO', body: 'hidden-log-body',
    ...(traceId ? { traceId, spanId: `span-${traceId}`, runId: `run-${traceId}` } : {}),
    attributes: { raw: 'hidden-log-attribute' }, resourceAttributes: {},
  };
}

function metric(id: string, name: string, points?: unknown[]) {
  return {
    id, name, type: 'gauge', serviceName: 'api', unit: 'ms',
    points: points ?? [{ timestampMs: 1_700_000_000_000, value: 4, attributes: { raw: 'hidden-metric-attribute' } }],
  };
}

const summary = {
  status: 'ok', revision: 2, traceCount: 2, spanCount: 2, errorCount: 0, logCount: 2,
  errorLogCount: 0, metricSeriesCount: 2, inputTokens: 2, outputTokens: 4, totalTokens: 6,
  costUsd: 0, avgLatencyMs: 12, services: ['api'], lastEventAt: '2023-11-14T22:13:20.000Z',
};

async function mockTelemetry(page: Page, options: { empty?: boolean; failLogs?: boolean; global?: boolean; metricPoints?: unknown[] } = {}) {
  const requested: Array<{ path: string; cursor: string | null; scope: string | null }> = [];
  await page.route('**/api/observability/**', async (route) => {
    const url = new URL(route.request().url());
    requested.push({ path: url.pathname, cursor: url.searchParams.get('cursor'), scope: url.searchParams.get('scope') });
    if (options.failLogs && url.pathname.endsWith('/logs')) {
      await route.fulfill({ status: 503, json: { success: false, error: 'Synthetic telemetry outage' } });
      return;
    }
    if (url.pathname.endsWith('/summary')) {
      await route.fulfill({ json: { success: true, data: summary } });
      return;
    }
    if (url.pathname.endsWith('/config')) {
      await route.fulfill({ json: { success: true, data: {
        protocol: 'OTLP/HTTP JSON', maxSpans: 1000, maxLogs: 1000, maxMetricSeries: 100,
        maxMetricPoints: 100, retentionMs: 86_400_000, pruneOnRead: true, pruneIntervalMs: 60_000,
        ready: true, scope: options.global ? { global: true } : { global: false, tenantId: 1 }, effectiveRetention: { source: 'runtime', windowMs: 86_400_000 },
        status: { storage: 'ok', correlation: 'ok', lastPrunedRecords: 7, lastPruneAt: '2026-11-01T00:00:00.000Z' },
        endpoints: { traces: '/v1/traces', metrics: '/v1/metrics', logs: '/v1/logs' },
        integrations: { qoderHooks: '/v1/qoder' },
      } } });
      return;
    }
    if (url.pathname.endsWith('/traces')) {
      const second = url.searchParams.get('cursor') === 'trace-next';
      await route.fulfill({ json: { success: true, data: { traces: options.empty ? [] : [second ? trace('trace-2', 'Second root') : trace('trace-1', 'First root')], ...(!second && !options.empty ? { nextCursor: 'trace-next' } : {}) } } });
      return;
    }
    if (/\/traces\/[^/]+$/u.test(url.pathname)) {
      const traceId = url.pathname.split('/').at(-1)!;
      const secondSpans = url.searchParams.get('spanCursor') === 'span-next';
      const secondLogs = url.searchParams.get('logCursor') === 'log-next';
      await route.fulfill({ json: { success: true, data: {
        summary: trace(traceId, `Root ${traceId}`),
        spans: [span(secondSpans ? 'span-page-2' : traceId)],
        logs: [{ ...log(secondLogs ? 'log-page-2' : 'log-page-1', traceId), serviceName: secondLogs ? 'worker' : 'api' }],
        ...(!secondSpans ? { spanNextCursor: 'span-next' } : {}),
        ...(!secondLogs ? { logNextCursor: 'log-next' } : {}),
      } } });
      return;
    }
    if (url.pathname.endsWith('/logs')) {
      const second = url.searchParams.get('cursor') === 'log-next';
      await route.fulfill({ json: { success: true, data: { logs: options.empty ? [] : [log(second ? 'log-2' : 'log-1', second ? 'trace-2' : 'trace-1')], ...(!second && !options.empty ? { nextCursor: 'log-next' } : {}) } } });
      return;
    }
    if (url.pathname.endsWith('/metrics')) {
      const second = url.searchParams.get('cursor') === 'metric-next';
      await route.fulfill({ json: { success: true, data: { metrics: options.empty ? [] : [metric(second ? 'metric-2' : 'metric-1', second ? 'Second metric' : 'First metric', options.metricPoints)], ...(!second && !options.empty ? { nextCursor: 'metric-next' } : {}) } } });
      return;
    }
    await route.fulfill({ status: 404, json: { success: false, error: 'Unmocked telemetry route' } });
  });
  return requested;
}

test('cursor pagination works for traces, logs, metrics, and independent trace-detail pages', async ({ page }) => {
  const requested = await openMissionControl(page);
  const telemetry = page.getByRole('region', { name: 'Board telemetry' });
  const traces = telemetry.getByRole('region', { name: 'Recent observed traces' });
  await expect(traces.getByText('First root')).toBeVisible();
  await traces.getByRole('button', { name: 'Next page' }).click();
  await expect(traces.getByText('Second root')).toBeVisible();
  expect(requested).toContainEqual(expect.objectContaining({ path: '/api/observability/traces', cursor: 'trace-next' }));

  const logs = telemetry.getByRole('region', { name: 'Recent log metadata' });
  await logs.getByRole('button', { name: 'Next page' }).click();
  await expect(logs.getByRole('button', { name: 'Inspect trace trace-2' })).toBeVisible();
  const metrics = telemetry.getByRole('region', { name: 'Metric time series' });
  await metrics.getByRole('button', { name: 'Next page' }).click();
  await expect(metrics.getByText('Second metric', { exact: true })).toBeVisible();

  await traces.getByRole('button', { name: 'Inspect trace trace-2' }).click();
  const detail = telemetry.getByRole('region', { name: 'Observed trace detail' });
  await expect(detail.getByText('span trace-2')).toBeVisible();
  await detail.getByRole('navigation', { name: 'Telemetry pagination' }).first().getByRole('button', { name: 'Next page' }).click();
  await expect(detail.getByText('span span-page-2')).toBeVisible();
  await detail.getByRole('navigation', { name: 'Telemetry pagination' }).last().getByRole('button', { name: 'Next page' }).click();
  await expect(detail.getByRole('table', { name: 'Logs correlated to the selected trace' }).getByText('worker')).toBeVisible();
  expect(requested).toContainEqual(expect.objectContaining({ path: '/api/observability/traces/trace-2' }));
  expect(requested.some((item) => item.path === '/api/observability/traces/trace-2' && new URLSearchParams({ spanCursor: 'span-next' }).get('spanCursor'))).toBe(true);
  await expect(telemetry.getByText('hidden-log-body')).toHaveCount(0);
  await expect(telemetry.getByText('hidden-span-attribute')).toHaveCount(0);
  await expect(telemetry.getByText('hidden-metric-attribute')).toHaveCount(0);
});

test('shows effective company scope, retention, readiness, and prune fields', async ({ page }) => {
  await openMissionControl(page);
  const telemetry = page.getByRole('region', { name: 'Board telemetry' });
  const config = telemetry.getByRole('region', { name: 'Telemetry retention and configuration' });
  await expect(config.getByText('Current company', { exact: true })).toBeVisible();
  await expect(config.getByText('1 days')).toBeVisible();
  await expect(config.getByText('runtime', { exact: true })).toBeVisible();
  await expect(config.getByText('last pruned records', { exact: true })).toBeVisible();
  await expect(config.getByText('7', { exact: true })).toBeVisible();
  await expect(telemetry.getByText('Admin read-only')).toHaveCount(0);
  await page.unroute('**/api/observability/**');
  await mockTelemetry(page, { global: true });
  await telemetry.getByRole('button', { name: 'Refresh telemetry' }).click();
  await expect(config.getByText('All tenants', { exact: true })).toBeVisible();
});

test('distinguishes successful empty pages from API errors', async ({ page }) => {
  await openMissionControl(page, { empty: true, failLogs: true });
  const telemetry = page.getByRole('region', { name: 'Board telemetry' });
  await expect(telemetry.getByText(/No retained traces match these filters/)).toBeVisible();
  await expect(telemetry.getByText(/No retained metric series match this search/)).toBeVisible();
  const logs = telemetry.getByRole('region', { name: 'Recent log metadata' });
  await expect(logs.getByRole('alert')).toContainText('Synthetic telemetry outage');
  await expect(logs.getByRole('alert')).toContainText('not an empty-data state');
  await expect(logs.getByText(/No retained log records/)).toHaveCount(0);
});

test('malformed metric readings and extreme finite values never create invalid SVG geometry', async ({ page }) => {
  test.setTimeout(60_000);
  const geometryWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Received NaN|Invalid.*(?:x|y|points)/iu.test(message.text())) {
      geometryWarnings.push(message.text());
    }
  });
  const telemetryOptions: { metricPoints?: unknown[] } = {};
  await openMissionControl(page, telemetryOptions);
  const telemetry = page.getByRole('region', { name: 'Board telemetry' });
  const metrics = telemetry.getByRole('region', { name: 'Metric time series' });

  async function expectFiniteSvgGeometry() {
    const invalid = await metrics.locator('svg').evaluateAll((svgs) =>
      svgs.flatMap((svg) => {
        const failures: string[] = [];
        for (const element of svg.querySelectorAll('*')) {
          for (const attribute of ['x', 'cx', 'x1', 'x2', 'y', 'cy', 'y1', 'y2', 'width', 'height']) {
            const value = element.getAttribute(attribute);
            if (value !== null && value !== '' && !Number.isFinite(Number(value))) {
              failures.push(`${element.tagName}.${attribute}=${value}`);
            }
          }
          const points = element.getAttribute('points');
          if (points) {
            for (const pair of points.trim().split(/\s+/u)) {
              const coordinates = pair.split(',');
              if (coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(Number(value)))) {
                failures.push(`${element.tagName}.points=${pair}`);
              }
            }
          }
        }
        return failures;
      })
    );
    expect(invalid).toEqual([]);
  }

  await expect(metrics.getByRole('img', { name: 'First metric value time series' })).toBeVisible();
  await expectFiniteSvgGeometry();

  const malformedCases: Array<{ points: unknown[]; incomplete: boolean }> = [
    { points: [{ timestampMs: 1_700_000_000_000, attributes: {} }], incomplete: true },
    { points: [{ timestampMs: 1_700_000_000_000, value: null, attributes: {} }], incomplete: true },
    { points: [{ timestampMs: 1_700_000_000_000, value: 'not-a-number', attributes: {} }], incomplete: true },
    { points: [{ timestampMs: 1_700_000_000_000, value: '4', attributes: {} }], incomplete: true },
    { points: [{ timestampMs: 'invalid', value: 4, attributes: {} }], incomplete: false },
  ];
  for (const { points, incomplete } of malformedCases) {
    telemetryOptions.metricPoints = points;
    await telemetry.getByRole('button', { name: 'Refresh telemetry' }).click();
    if (incomplete) {
      await expect(metrics.getByText(/No complete numeric value series is available to plot/)).toBeVisible();
    } else {
      await expect(metrics.getByRole('img', { name: 'First metric value time series' })).toBeVisible();
    }
    await expectFiniteSvgGeometry();
  }

  telemetryOptions.metricPoints = [
    { timestampMs: 1_700_000_000_000, value: -Number.MAX_VALUE, attributes: {} },
    { timestampMs: 1_700_000_060_000, value: Number.MAX_VALUE, attributes: {} },
  ];
  await telemetry.getByRole('button', { name: 'Refresh telemetry' }).click();
  await expect(metrics.getByRole('img', { name: 'First metric value time series' })).toBeVisible();
  await expect(metrics.locator('.mw-ui-chart-point')).toHaveCount(2);
  await expectFiniteSvgGeometry();
  expect(geometryWarnings).toEqual([]);
});
