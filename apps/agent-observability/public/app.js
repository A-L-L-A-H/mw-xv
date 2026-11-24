/* global document, window, fetch */

const REFRESH_MS = 3000;
const FLOW_SPAN_LIMIT = 160;
const FLOW_NODE_WIDTH = 224;
const FLOW_NODE_HEIGHT = 100;
const FLOW_COLUMN_GAP = 92;
const FLOW_ROW_GAP = 28;
const FLOW_PADDING = 42;
const numberFormatter = new Intl.NumberFormat('en-US');
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const elements = {
  traceRows: document.getElementById('traceRows'),
  logRows: document.getElementById('logRows'),
  metricCards: document.getElementById('metricCards'),
  tracesEmpty: document.getElementById('tracesEmpty'),
  logsEmpty: document.getElementById('logsEmpty'),
  metricsEmpty: document.getElementById('metricsEmpty'),
  tracesView: document.getElementById('tracesView'),
  flowView: document.getElementById('flowView'),
  logsView: document.getElementById('logsView'),
  metricsView: document.getElementById('metricsView'),
  flowTraceSelect: document.getElementById('flowTraceSelect'),
  flowViewport: document.getElementById('flowViewport'),
  flowZoomSpace: document.getElementById('flowZoomSpace'),
  flowCanvas: document.getElementById('flowCanvas'),
  flowConnections: document.getElementById('flowConnections'),
  flowNodes: document.getElementById('flowNodes'),
  flowLoading: document.getElementById('flowLoading'),
  flowEmpty: document.getElementById('flowEmpty'),
  flowInspectorTitle: document.getElementById('flowInspectorTitle'),
  flowInspectorBody: document.getElementById('flowInspectorBody'),
  flowOpenTraceButton: document.getElementById('flowOpenTraceButton'),
  flowZoomOut: document.getElementById('flowZoomOut'),
  flowZoomIn: document.getElementById('flowZoomIn'),
  flowZoomReset: document.getElementById('flowZoomReset'),
  flowZoomLabel: document.getElementById('flowZoomLabel'),
  flowStatSpans: document.getElementById('flowStatSpans'),
  flowStatTools: document.getElementById('flowStatTools'),
  flowStatDuration: document.getElementById('flowStatDuration'),
  flowResultCount: document.getElementById('flowResultCount'),
  traceDetail: document.getElementById('traceDetail'),
  detailTitle: document.getElementById('detailTitle'),
  detailTraceId: document.getElementById('detailTraceId'),
  detailStats: document.getElementById('detailStats'),
  waterfall: document.getElementById('waterfall'),
  rootAttributes: document.getElementById('rootAttributes'),
  spanEvents: document.getElementById('spanEvents'),
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  severityFilter: document.getElementById('severityFilter'),
  errorNotice: document.getElementById('errorNotice'),
  refreshButton: document.getElementById('refreshButton'),
  connectionDot: document.getElementById('connectionDot'),
  connectionLabel: document.getElementById('connectionLabel'),
  lastUpdated: document.getElementById('lastUpdated'),
  traceNavCount: document.getElementById('traceNavCount'),
  flowNavCount: document.getElementById('flowNavCount'),
  logNavCount: document.getElementById('logNavCount'),
  metricNavCount: document.getElementById('metricNavCount'),
  traceResultCount: document.getElementById('traceResultCount'),
  logResultCount: document.getElementById('logResultCount'),
  metricResultCount: document.getElementById('metricResultCount'),
  traceCount: document.getElementById('traceCount'),
  spanCount: document.getElementById('spanCount'),
  errorRate: document.getElementById('errorRate'),
  errorCount: document.getElementById('errorCount'),
  avgLatency: document.getElementById('avgLatency'),
  tokenCount: document.getElementById('tokenCount'),
  tokenBreakdown: document.getElementById('tokenBreakdown'),
  costValue: document.getElementById('costValue'),
  serviceCount: document.getElementById('serviceCount'),
  footerEndpoint: document.getElementById('footerEndpoint'),
};

const state = {
  view: 'flow',
  traces: [],
  logs: [],
  metrics: [],
  summary: null,
  selectedTraceId: null,
  traceDetail: null,
  flowTraceId: null,
  flowDetail: null,
  flowSelectedSpanId: null,
  flowLoadingTraceId: null,
  flowLayout: null,
  flowZoom: 1,
  query: '',
  status: 'all',
  severity: 'all',
  loading: false,
  initialized: false,
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function formatCompact(value) {
  return compactFormatter.format(value ?? 0);
}

function formatDuration(value) {
  const duration = Math.max(0, value ?? 0);
  if (duration < 1) return `${duration.toFixed(2)} ms`;
  if (duration < 1000) return `${Math.round(duration)} ms`;
  if (duration < 60_000) return `${(duration / 1000).toFixed(2)} s`;
  return `${(duration / 60_000).toFixed(1)} min`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

function formatCost(value) {
  const cost = value ?? 0;
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function safeJson(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function setConnection(status) {
  elements.connectionDot.className = `status-dot ${status}`;
  elements.connectionLabel.textContent =
    status === 'online'
      ? 'Receiver online'
      : status === 'offline'
        ? 'Receiver offline'
        : 'Connecting';
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (typeof payload.error === 'string') message = payload.error;
    } catch {
      // Keep the HTTP status when the error body is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

async function loadData() {
  if (state.loading) return;
  state.loading = true;
  elements.refreshButton.classList.add('loading');
  try {
    const [summary, traces, logs, metrics] = await Promise.all([
      fetchJson('/api/summary'),
      fetchJson('/api/traces?limit=200'),
      fetchJson('/api/logs?limit=300'),
      fetchJson('/api/metrics?limit=200'),
    ]);
    state.summary = summary;
    state.traces = traces.traces;
    state.logs = logs.logs;
    state.metrics = metrics.metrics;
    elements.errorNotice.hidden = true;
    setConnection('online');
    elements.lastUpdated.textContent = `Updated ${formatTime(Date.now())}`;

    if (
      state.selectedTraceId &&
      !state.traces.some((trace) => trace.traceId === state.selectedTraceId)
    ) {
      state.selectedTraceId = null;
      state.traceDetail = null;
      elements.traceDetail.hidden = true;
    }
    if (!state.initialized && state.view === 'traces' && state.traces.length > 0) {
      state.initialized = true;
      await selectTrace(state.traces[0].traceId, false);
    } else {
      state.initialized = true;
      render();
    }
  } catch (error) {
    setConnection('offline');
    elements.errorNotice.textContent =
      error instanceof Error ? error.message : 'Unable to load telemetry';
    elements.errorNotice.hidden = false;
  } finally {
    state.loading = false;
    elements.refreshButton.classList.remove('loading');
  }
}

function filteredTraces() {
  const query = state.query.trim().toLowerCase();
  return state.traces.filter((trace) => {
    if (state.status === 'error' && trace.errorCount === 0) return false;
    if (state.status === 'ok' && trace.errorCount > 0) return false;
    if (!query) return true;
    return `${trace.rootName} ${trace.traceId} ${trace.runId} ${trace.agentName ?? ''} ${trace.serviceNames.join(' ')}`
      .toLowerCase()
      .includes(query);
  });
}

function filteredLogs() {
  const query = state.query.trim().toLowerCase();
  return state.logs.filter((log) => {
    if (state.severity !== 'all' && log.severity !== state.severity) return false;
    if (!query) return true;
    return `${log.body} ${log.serviceName} ${log.agentName ?? ''} ${log.traceId ?? ''}`
      .toLowerCase()
      .includes(query);
  });
}

function filteredMetrics() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.metrics;
  return state.metrics.filter((metric) =>
    `${metric.name} ${metric.serviceName} ${metric.description ?? ''} ${metric.unit ?? ''}`
      .toLowerCase()
      .includes(query)
  );
}

function renderSummary() {
  const summary = state.summary;
  if (!summary) return;
  const errorRate = summary.spanCount > 0 ? (summary.errorCount / summary.spanCount) * 100 : 0;
  elements.traceCount.textContent = formatCompact(summary.traceCount);
  elements.spanCount.textContent = `${formatNumber(summary.spanCount)} spans captured`;
  elements.errorRate.textContent = `${errorRate.toFixed(1)}%`;
  elements.errorCount.textContent = `${formatNumber(summary.errorCount)} failed spans`;
  elements.avgLatency.textContent = formatDuration(summary.avgLatencyMs);
  elements.tokenCount.textContent = formatCompact(summary.totalTokens);
  elements.tokenBreakdown.textContent = `${formatCompact(summary.inputTokens)} in / ${formatCompact(summary.outputTokens)} out`;
  elements.costValue.textContent = formatCost(summary.costUsd);
  elements.serviceCount.textContent = `${formatNumber(summary.services.length)} services`;
  elements.traceNavCount.textContent = formatCompact(summary.traceCount);
  elements.flowNavCount.textContent = formatCompact(summary.traceCount);
  elements.logNavCount.textContent = formatCompact(summary.logCount);
  elements.metricNavCount.textContent = formatCompact(summary.metricSeriesCount);
}

function statusBadge(status) {
  return createElement(
    'span',
    `status-badge status-${status}`,
    status === 'unset' ? 'UNSET' : status.toUpperCase()
  );
}

function renderTraces() {
  const traces = filteredTraces();
  const fragment = document.createDocumentFragment();
  for (const trace of traces) {
    const row = document.createElement('tr');
    if (trace.traceId === state.selectedTraceId) row.className = 'selected';

    const runCell = document.createElement('td');
    const traceButton = createElement('button', 'trace-link', trace.rootName);
    traceButton.type = 'button';
    traceButton.addEventListener('click', () => void selectTrace(trace.traceId));
    runCell.append(traceButton, createElement('span', 'run-id', trace.runId));

    const statusCell = document.createElement('td');
    statusCell.append(statusBadge(trace.errorCount > 0 ? 'error' : 'ok'));

    row.append(
      runCell,
      createElement('td', '', trace.serviceNames.join(', ')),
      createElement('td', '', trace.agentName ?? '—'),
      createElement('td', '', formatDuration(trace.durationMs)),
      createElement('td', '', formatNumber(trace.spanCount)),
      createElement('td', '', formatCompact(trace.totalTokens)),
      statusCell,
      createElement('td', '', formatTime(trace.startedAt))
    );
    fragment.append(row);
  }
  elements.traceRows.replaceChildren(fragment);
  elements.traceResultCount.textContent = `${traces.length} trace${traces.length === 1 ? '' : 's'}`;
  elements.tracesEmpty.hidden = traces.length > 0;
  document.querySelector('.trace-table').hidden = traces.length === 0;
}

function renderTraceDetail() {
  const detail = state.traceDetail;
  if (!detail) {
    elements.traceDetail.hidden = true;
    return;
  }
  const { summary, spans, logs } = detail;
  elements.traceDetail.hidden = false;
  elements.detailTitle.textContent = summary.rootName;
  elements.detailTraceId.textContent = summary.traceId;
  elements.detailStats.replaceChildren(
    detailStat('Duration', formatDuration(summary.durationMs)),
    detailStat('Spans', formatNumber(summary.spanCount)),
    detailStat('Tokens', formatCompact(summary.totalTokens)),
    detailStat('Cost', formatCost(summary.costUsd))
  );

  const spanMap = new Map(spans.map((span) => [span.spanId, span]));
  const waterfallHeader = createElement('div', 'waterfall-header');
  waterfallHeader.append(createElement('span', '', 'Span'), createElement('span', '', 'Timeline'));
  const waterfallRows = [waterfallHeader];
  const duration = Math.max(1, summary.durationMs);

  for (const span of spans) {
    let depth = 0;
    let parentId = span.parentSpanId;
    const visited = new Set();
    while (parentId && depth < 12 && !visited.has(parentId)) {
      visited.add(parentId);
      depth += 1;
      parentId = spanMap.get(parentId)?.parentSpanId;
    }

    const row = createElement('div', 'waterfall-row');
    const name = createElement('div', 'span-name');
    name.style.paddingLeft = `${Math.min(depth, 8) * 12}px`;
    name.append(
      createElement('strong', '', span.name),
      createElement('small', '', `${span.serviceName} · ${formatDuration(span.durationMs)}`)
    );

    const timeline = createElement('div', 'timeline');
    const bar = createElement('div', `timeline-bar${span.status === 'error' ? ' error' : ''}`);
    const left = Math.max(
      0,
      Math.min(99.5, ((span.startTimeMs - summary.startedAt) / duration) * 100)
    );
    const width = Math.max(0.6, Math.min(100 - left, (span.durationMs / duration) * 100));
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
    bar.title = `${span.name}: ${formatDuration(span.durationMs)}`;
    timeline.append(bar);
    row.append(name, timeline);
    waterfallRows.push(row);
  }
  elements.waterfall.replaceChildren(...waterfallRows);

  const root = spans.find((span) => !span.parentSpanId) ?? spans[0];
  renderAttributes(elements.rootAttributes, { ...root.resourceAttributes, ...root.attributes });
  const events = spans
    .flatMap((span) => span.events.map((event) => ({ ...event, spanName: span.name })))
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .slice(-50);
  renderEvents(elements.spanEvents, events);

  if (logs.length > 0) {
    const correlated = createElement(
      'p',
      'muted-copy',
      `${logs.length} correlated log record${logs.length === 1 ? '' : 's'} available in the Logs view.`
    );
    elements.spanEvents.append(correlated);
  }
}

function detailStat(label, value) {
  const stat = createElement('div', 'detail-stat');
  stat.append(createElement('span', '', label), createElement('strong', '', value));
  return stat;
}

function renderAttributes(container, attributes) {
  const entries = Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    container.replaceChildren(createElement('p', 'muted-copy', 'No attributes captured.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const [key, value] of entries.slice(0, 60)) {
    const row = createElement('div', 'attribute-row');
    row.append(
      createElement('span', 'attribute-key', key),
      createElement('span', 'attribute-value', safeJson(value))
    );
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}

function renderEvents(container, events) {
  if (events.length === 0) {
    container.replaceChildren(createElement('p', 'muted-copy', 'No span events captured.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const event of events) {
    const item = createElement('div', 'event-item');
    item.append(
      createElement('strong', '', event.name),
      createElement('small', '', `${formatTime(event.timestampMs)} · ${event.spanName}`)
    );
    const attributes = Object.entries(event.attributes);
    if (attributes.length > 0) {
      item.append(
        createElement(
          'small',
          '',
          attributes.map(([key, value]) => `${key}=${safeJson(value)}`).join(' · ')
        )
      );
    }
    fragment.append(item);
  }
  container.replaceChildren(fragment);
}

function renderLogs() {
  const logs = filteredLogs();
  const fragment = document.createDocumentFragment();
  for (const log of logs) {
    const row = createElement('div', 'log-row');
    row.append(
      createElement('span', 'log-time', formatTime(log.timestampMs)),
      createElement('span', `severity-badge severity-${log.severity}`, log.severity),
      createElement('div', 'log-body', log.body || '(empty body)'),
      createElement(
        'span',
        'log-service',
        `${log.serviceName}${log.agentName ? ` · ${log.agentName}` : ''}`
      )
    );
    if (log.traceId) {
      const jump = createElement('button', 'trace-jump', log.traceId.slice(0, 12));
      jump.type = 'button';
      jump.title = `Open trace ${log.traceId}`;
      jump.addEventListener('click', () => void selectTrace(log.traceId));
      row.append(jump);
    }
    fragment.append(row);
  }
  elements.logRows.replaceChildren(fragment);
  elements.logResultCount.textContent = `${logs.length} log${logs.length === 1 ? '' : 's'}`;
  elements.logsEmpty.hidden = logs.length > 0;
}

function metricValue(metric) {
  const point = metric.points.at(-1);
  if (!point) return { value: 0, label: 'No data' };
  if (metric.type === 'gauge' || metric.type === 'sum') {
    return {
      value: point.value ?? 0,
      label: metric.type === 'sum' ? 'Latest sum' : 'Latest value',
    };
  }
  return {
    value: point.sum ?? point.count ?? 0,
    label: point.sum !== undefined ? 'Latest sum' : 'Latest count',
  };
}

function renderSparkline(metric) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 112 42');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('aria-hidden', 'true');
  const values = metric.points.map((point) => point.value ?? point.sum ?? point.count ?? 0);
  if (values.length === 0) return svg;
  const displayValues = values.length === 1 ? [values[0], values[0]] : values.slice(-24);
  const minimum = Math.min(...displayValues);
  const maximum = Math.max(...displayValues);
  const range = maximum - minimum || 1;
  const points = displayValues.map((value, index) => {
    const x = (index / Math.max(1, displayValues.length - 1)) * 108 + 2;
    const y = 36 - ((value - minimum) / range) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', `M 2 38 L ${points.join(' L ')} L 110 38 Z`);
  area.setAttribute('fill', 'rgba(77, 228, 210, 0.08)');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#4de4d2');
  line.setAttribute('stroke-width', '1.8');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(area, line);
  return svg;
}

function renderMetrics() {
  const metrics = filteredMetrics();
  const fragment = document.createDocumentFragment();
  for (const metric of metrics) {
    const card = createElement('article', 'metric-card');
    const header = createElement('div', 'metric-card-header');
    const identity = createElement('div');
    identity.append(
      createElement('h3', '', metric.name),
      createElement('span', 'metric-service', metric.serviceName)
    );
    header.append(identity, createElement('span', 'metric-type', metric.type.replace('_', ' ')));

    const latest = metricValue(metric);
    const valueRow = createElement('div', 'metric-value-row');
    const value = createElement('div');
    const valueNumber = createElement('span', 'metric-value', formatCompact(latest.value));
    if (metric.unit) valueNumber.append(createElement('span', 'metric-unit', metric.unit));
    value.append(
      valueNumber,
      createElement('div', 'metric-meta', `${latest.label} · ${metric.points.length} points`)
    );
    valueRow.append(value, renderSparkline(metric));
    card.append(header, valueRow);
    fragment.append(card);
  }
  elements.metricCards.replaceChildren(fragment);
  elements.metricResultCount.textContent = `${metrics.length} series`;
  elements.metricsEmpty.hidden = metrics.length > 0;
}

function flowKind(span) {
  const name = span.name.toLowerCase();
  const toolName = typeof span.toolName === 'string' ? span.toolName.trim() : '';
  if (name.startsWith('qoder.prompt') || name.startsWith('qoder.session')) return 'prompt';
  if (name.startsWith('qoder.tool') || (toolName && toolName !== 'undefined')) return 'tool';
  if (name.startsWith('qoder.subagent')) return 'subagent';
  return span.parentSpanId ? 'span' : 'prompt';
}

function flowKindLabel(kind) {
  if (kind === 'prompt') return 'Prompt';
  if (kind === 'tool') return 'Tool';
  if (kind === 'subagent') return 'Subagent';
  return 'Span';
}

function flowDisplayName(span) {
  if (span.name === 'qoder.prompt') return 'Prompt';
  if (span.name === 'qoder.session') return 'Qoder session';
  if (span.name.startsWith('qoder.tool.')) return span.name.slice('qoder.tool.'.length);
  if (span.name.startsWith('qoder.subagent.')) {
    return `Subagent · ${span.name.slice('qoder.subagent.'.length)}`;
  }
  return span.name;
}

function flowIcon(kind) {
  if (kind === 'prompt') return '✦';
  if (kind === 'tool') return '↳';
  if (kind === 'subagent') return '⌘';
  return '◆';
}

function buildFlowLayout(spans) {
  const spanMap = new Map(spans.map((span) => [span.spanId, span]));
  const children = new Map();
  const roots = [];
  const ordered = [...spans].sort((left, right) => left.startTimeMs - right.startTimeMs);

  for (const span of ordered) {
    const parent = span.parentSpanId ? spanMap.get(span.parentSpanId) : undefined;
    if (parent && parent.spanId !== span.spanId) {
      const siblings = children.get(parent.spanId) ?? [];
      siblings.push(span);
      children.set(parent.spanId, siblings);
    } else {
      roots.push(span);
    }
  }

  const positions = new Map();
  const visited = new Set();
  const visiting = new Set();
  let leafIndex = 0;

  const place = (span, depth) => {
    if (visited.has(span.spanId) || visiting.has(span.spanId)) return;
    visiting.add(span.spanId);
    const childSpans = (children.get(span.spanId) ?? []).filter(
      (child) => !visiting.has(child.spanId)
    );
    let y;
    if (childSpans.length === 0) {
      y = FLOW_PADDING + leafIndex * (FLOW_NODE_HEIGHT + FLOW_ROW_GAP);
      leafIndex += 1;
    } else {
      childSpans.forEach((child) => place(child, depth + 1));
      const placedChildren = childSpans.map((child) => positions.get(child.spanId)).filter(Boolean);
      y =
        placedChildren.length > 0
          ? placedChildren.reduce((total, child) => total + child.y, 0) / placedChildren.length
          : FLOW_PADDING + leafIndex * (FLOW_NODE_HEIGHT + FLOW_ROW_GAP);
      if (placedChildren.length === 0) leafIndex += 1;
    }
    positions.set(span.spanId, {
      span,
      depth,
      x: FLOW_PADDING + depth * (FLOW_NODE_WIDTH + FLOW_COLUMN_GAP),
      y,
    });
    visiting.delete(span.spanId);
    visited.add(span.spanId);
  };

  roots.forEach((root) => place(root, 0));
  for (const span of ordered) {
    if (visited.has(span.spanId)) continue;
    place(span, 0);
    if (!visited.has(span.spanId)) {
      positions.set(span.spanId, {
        span,
        depth: 0,
        x: FLOW_PADDING,
        y: FLOW_PADDING + leafIndex * (FLOW_NODE_HEIGHT + FLOW_ROW_GAP),
      });
      leafIndex += 1;
      visited.add(span.spanId);
    }
  }

  const items = [...positions.values()];
  const width = Math.max(760, ...items.map((item) => item.x + FLOW_NODE_WIDTH + FLOW_PADDING));
  const height = Math.max(420, ...items.map((item) => item.y + FLOW_NODE_HEIGHT + FLOW_PADDING));
  return { items, width, height };
}

function createSvgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function flowConnectorPath(parent, child) {
  const startX = parent.x + FLOW_NODE_WIDTH;
  const startY = parent.y + FLOW_NODE_HEIGHT / 2;
  const endX = child.x;
  const endY = child.y + FLOW_NODE_HEIGHT / 2;
  const bend = Math.max(36, (endX - startX) * 0.48);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function renderFlowConnections(layout) {
  const positions = new Map(layout.items.map((item) => [item.span.spanId, item]));
  elements.flowConnections.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  elements.flowConnections.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const item of layout.items) {
    if (!item.span.parentSpanId) continue;
    const parent = positions.get(item.span.parentSpanId);
    if (!parent) continue;
    const path = flowConnectorPath(parent, item);
    const failed = item.span.status === 'error';
    const recent = Date.now() - item.span.endTimeMs < 15_000;
    fragment.append(
      createSvgElement('path', {
        d: path,
        class: `flow-connection-glow${failed ? ' is-error' : ''}`,
      }),
      createSvgElement('path', {
        d: path,
        class: `flow-connection${failed ? ' is-error' : ''}${recent ? ' is-live' : ''}`,
      })
    );
  }
  elements.flowConnections.append(fragment);
}

function renderFlowNodes(layout) {
  const fragment = document.createDocumentFragment();
  for (const item of layout.items) {
    const span = item.span;
    const kind = flowKind(span);
    const selected = span.spanId === state.flowSelectedSpanId;
    const recent = Date.now() - span.endTimeMs < 15_000;
    const node = createElement(
      'button',
      `flow-node flow-node-${kind}${selected ? ' selected' : ''}${recent ? ' is-recent' : ''}${span.status === 'error' ? ' has-error' : ''}`
    );
    node.type = 'button';
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    node.dataset.spanId = span.spanId;
    node.setAttribute(
      'aria-label',
      `${flowDisplayName(span)}, ${flowKindLabel(kind)}, ${formatDuration(span.durationMs)}, ${span.status}`
    );

    const top = createElement('div', 'flow-node-top');
    top.append(
      createElement('span', `flow-node-icon ${kind}`, flowIcon(kind)),
      createElement('span', 'flow-node-kind', flowKindLabel(kind))
    );
    const footer = createElement('div', 'flow-node-foot');
    footer.append(
      statusBadge(span.status),
      createElement('span', 'flow-node-time', formatTime(span.startTimeMs))
    );
    node.append(
      top,
      createElement('strong', 'flow-node-title', flowDisplayName(span)),
      createElement(
        'span',
        'flow-node-sub',
        `${span.agentName ?? span.serviceName} · ${formatDuration(span.durationMs)}`
      ),
      footer
    );
    node.addEventListener('click', () => selectFlowNode(span.spanId));
    node.addEventListener('dblclick', () => void selectTrace(state.flowTraceId));
    fragment.append(node);
  }
  elements.flowNodes.replaceChildren(fragment);
}

function flowInspectorRow(label, value) {
  const row = createElement('div', 'flow-inspector-row');
  row.append(createElement('span', '', label), createElement('strong', '', value));
  return row;
}

function renderFlowInspector() {
  const span = state.flowDetail?.spans.find((item) => item.spanId === state.flowSelectedSpanId);
  if (!span) {
    elements.flowInspectorTitle.textContent = 'Select a node';
    elements.flowInspectorBody.replaceChildren(
      createElement(
        'p',
        'muted-copy',
        'Click any node to inspect its status, timing, and metadata.'
      )
    );
    elements.flowOpenTraceButton.hidden = true;
    return;
  }

  elements.flowInspectorTitle.textContent = flowDisplayName(span);
  const body = document.createDocumentFragment();
  body.append(
    flowInspectorRow('Status', span.status.toUpperCase()),
    flowInspectorRow('Duration', formatDuration(span.durationMs)),
    flowInspectorRow('Started', formatTime(span.startTimeMs)),
    flowInspectorRow('Service', span.serviceName),
    flowInspectorRow('Agent', span.agentName ?? '—'),
    flowInspectorRow('Span ID', span.spanId)
  );
  const attributeTitle = createElement('h4', 'flow-inspector-subheading', 'Attributes');
  const attributes = createElement('div', 'flow-inspector-attributes');
  renderAttributes(attributes, span.attributes);
  body.append(attributeTitle, attributes);
  elements.flowInspectorBody.replaceChildren(body);
  elements.flowOpenTraceButton.hidden = false;
}

function applyFlowZoom() {
  const layout = state.flowLayout;
  if (!layout) return;
  const zoom = state.flowZoom;
  elements.flowZoomSpace.style.width = `${Math.max(elements.flowViewport.clientWidth, layout.width * zoom)}px`;
  elements.flowZoomSpace.style.height = `${Math.max(elements.flowViewport.clientHeight, layout.height * zoom)}px`;
  elements.flowCanvas.style.width = `${layout.width}px`;
  elements.flowCanvas.style.height = `${layout.height}px`;
  elements.flowCanvas.style.transform = `scale(${zoom})`;
  elements.flowZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function setFlowZoom(value) {
  state.flowZoom = Math.round(Math.max(0.55, Math.min(1.6, value)) * 10) / 10;
  applyFlowZoom();
}

function renderFlowOptions(traces) {
  const fragment = document.createDocumentFragment();
  if (traces.length === 0) {
    const option = createElement('option', '', 'No traces available');
    option.value = '';
    fragment.append(option);
  }
  for (const trace of traces) {
    const option = createElement('option', '', `${trace.rootName} · ${trace.runId.slice(0, 12)}`);
    option.value = trace.traceId;
    fragment.append(option);
  }
  elements.flowTraceSelect.replaceChildren(fragment);
  elements.flowTraceSelect.value = state.flowTraceId ?? '';
  elements.flowTraceSelect.disabled = traces.length === 0;
}

function renderFlow() {
  const traces = filteredTraces();
  renderFlowOptions(traces);
  if (!traces.some((trace) => trace.traceId === state.flowTraceId)) {
    const preferred =
      traces.find((trace) => trace.rootName === 'qoder.prompt') ??
      traces.find((trace) => trace.spanCount > 1) ??
      traces[0];
    state.flowTraceId = preferred?.traceId ?? null;
    state.flowDetail = null;
    state.flowLayout = null;
    state.flowSelectedSpanId = null;
  }

  const summary = traces.find((trace) => trace.traceId === state.flowTraceId);
  if (!summary) {
    elements.flowZoomSpace.hidden = true;
    elements.flowLoading.hidden = true;
    elements.flowEmpty.hidden = false;
    elements.flowStatSpans.textContent = '0';
    elements.flowStatTools.textContent = '0';
    elements.flowStatDuration.textContent = '—';
    elements.flowResultCount.textContent = '0 traces';
    renderFlowInspector();
    return;
  }

  const detail = state.flowDetail;
  const matches = detail?.summary.traceId === summary.traceId;
  const stale =
    matches &&
    (detail.summary.spanCount !== summary.spanCount ||
      detail.summary.errorCount !== summary.errorCount ||
      detail.summary.durationMs !== summary.durationMs);
  if (!matches || stale) {
    state.flowDetail = null;
    state.flowLayout = null;
    state.flowSelectedSpanId = null;
    elements.flowZoomSpace.hidden = true;
    elements.flowLoading.hidden = false;
    elements.flowEmpty.hidden = true;
    elements.flowStatSpans.textContent = formatCompact(summary.spanCount);
    elements.flowStatTools.textContent = '—';
    elements.flowStatDuration.textContent = formatDuration(summary.durationMs);
    elements.flowResultCount.textContent = `${traces.length} trace${traces.length === 1 ? '' : 's'}`;
    renderFlowInspector();
    void ensureFlowDetail(summary.traceId);
    return;
  }

  const allSpans = [...detail.spans].sort((left, right) => left.startTimeMs - right.startTimeMs);
  const spans = allSpans.slice(0, FLOW_SPAN_LIMIT);
  const layout = buildFlowLayout(spans);
  state.flowLayout = layout;
  if (!spans.some((span) => span.spanId === state.flowSelectedSpanId)) {
    state.flowSelectedSpanId =
      spans.find((span) => !span.parentSpanId)?.spanId ?? spans[0]?.spanId ?? null;
  }

  elements.flowLoading.hidden = true;
  elements.flowEmpty.hidden = true;
  elements.flowZoomSpace.hidden = false;
  elements.flowStatSpans.textContent = formatCompact(allSpans.length);
  elements.flowStatTools.textContent = formatCompact(
    spans.filter((span) => flowKind(span) === 'tool').length
  );
  elements.flowStatDuration.textContent = formatDuration(summary.durationMs);
  elements.flowResultCount.textContent = `${traces.length} trace${traces.length === 1 ? '' : 's'} · ${spans.length}/${allSpans.length} spans`;
  renderFlowConnections(layout);
  renderFlowNodes(layout);
  renderFlowInspector();
  applyFlowZoom();
}

async function ensureFlowDetail(traceId) {
  if (!traceId || state.flowLoadingTraceId === traceId) return;
  state.flowLoadingTraceId = traceId;
  try {
    const detail = await fetchJson(`/api/traces/${encodeURIComponent(traceId)}`);
    if (state.flowTraceId !== traceId) return;
    state.flowDetail = detail;
    state.flowSelectedSpanId =
      detail.spans.find((span) => !span.parentSpanId)?.spanId ?? detail.spans[0]?.spanId ?? null;
    renderFlow();
  } catch (error) {
    if (state.flowTraceId !== traceId) return;
    elements.flowLoading.hidden = true;
    elements.flowEmpty.hidden = false;
    elements.errorNotice.textContent =
      error instanceof Error ? error.message : 'Unable to load agent flow';
    elements.errorNotice.hidden = false;
  } finally {
    if (state.flowLoadingTraceId === traceId) state.flowLoadingTraceId = null;
  }
}

function selectFlowNode(spanId) {
  state.flowSelectedSpanId = spanId;
  elements.flowNodes.querySelectorAll('.flow-node').forEach((node) => {
    node.classList.toggle('selected', node.dataset.spanId === spanId);
  });
  renderFlowInspector();
}

function render() {
  renderSummary();
  if (state.view === 'flow') {
    renderFlow();
  } else if (state.view === 'traces') {
    renderTraces();
    renderTraceDetail();
  } else if (state.view === 'logs') {
    renderLogs();
  } else {
    renderMetrics();
  }
}

function switchView(view) {
  state.view = view;
  elements.tracesView.hidden = view !== 'traces';
  elements.flowView.hidden = view !== 'flow';
  elements.logsView.hidden = view !== 'logs';
  elements.metricsView.hidden = view !== 'metrics';
  elements.traceDetail.hidden = view !== 'traces' || !state.traceDetail;
  elements.statusFilter.hidden = view === 'logs' || view === 'metrics';
  elements.severityFilter.hidden = view !== 'logs';
  elements.searchInput.placeholder =
    view === 'flow'
      ? 'Search flows, agents, services…'
      : view === 'traces'
        ? 'Search runs, agents, services…'
        : view === 'logs'
          ? 'Search log messages, services…'
          : 'Search metric names, services…';
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  render();
}

async function selectTrace(traceId, scroll = true) {
  if (!traceId) return;
  switchView('traces');
  state.selectedTraceId = traceId;
  renderTraces();
  try {
    const detail = await fetchJson(`/api/traces/${encodeURIComponent(traceId)}`);
    if (state.selectedTraceId !== traceId) return;
    state.traceDetail = detail;
    renderTraceDetail();
    if (scroll && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.traceDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    if (state.selectedTraceId !== traceId) return;
    state.traceDetail = null;
    elements.traceDetail.hidden = true;
    elements.errorNotice.textContent =
      error instanceof Error ? error.message : 'Unable to load trace detail';
    elements.errorNotice.hidden = false;
  }
}

let searchTimer;
elements.searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = elements.searchInput.value;
    render();
  }, 160);
});

elements.statusFilter.addEventListener('change', () => {
  state.status = elements.statusFilter.value;
  render();
});

elements.severityFilter.addEventListener('change', () => {
  state.severity = elements.severityFilter.value;
  render();
});

elements.flowTraceSelect.addEventListener('change', () => {
  state.flowTraceId = elements.flowTraceSelect.value || null;
  state.flowDetail = null;
  state.flowLayout = null;
  state.flowSelectedSpanId = null;
  renderFlow();
});

elements.flowZoomOut.addEventListener('click', () => setFlowZoom(state.flowZoom - 0.1));
elements.flowZoomIn.addEventListener('click', () => setFlowZoom(state.flowZoom + 0.1));
elements.flowZoomReset.addEventListener('click', () => setFlowZoom(1));
elements.flowOpenTraceButton.addEventListener('click', () => void selectTrace(state.flowTraceId));

elements.refreshButton.addEventListener('click', () => void loadData());
document.getElementById('closeDetailButton').addEventListener('click', () => {
  state.selectedTraceId = null;
  state.traceDetail = null;
  elements.traceDetail.hidden = true;
  renderTraces();
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

elements.footerEndpoint.textContent = `OTLP endpoint: ${window.location.origin}`;
setConnection('connecting');
render();

const refreshTimer = window.setInterval(() => {
  if (!document.hidden) void loadData();
}, REFRESH_MS);

window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer));
void loadData();
