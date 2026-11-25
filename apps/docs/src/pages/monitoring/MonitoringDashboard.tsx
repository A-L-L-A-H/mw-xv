import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { LineChart } from '@moonwitness/ui/components/line-chart';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { StatusBar } from '@moonwitness/ui/components/status-bar';
import { Table } from '@moonwitness/ui/components/table';
import { Tabs, TabList, Tab, TabPanel } from '@moonwitness/ui/components/tabs';

type FleetMember = {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  cpu: number;
  memory: number;
  uptime: string;
  lastHeartbeat: string;
  region: string;
  version: string;
};

type Routine = {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  schedule: string;
  lastRun: string;
  nextRun: string;
  duration: string;
};

type Pipeline = {
  id: string;
  name: string;
  status: 'success' | 'running' | 'failed' | 'queued';
  branch: string;
  commit: string;
  startedAt: string;
  duration: string;
  stages: { name: string; status: string; duration: string }[];
};

type Issue = {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  assignee: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

type Release = {
  id: string;
  version: string;
  channel: 'stable' | 'preview' | 'next';
  status: 'deployed' | 'rolling' | 'paused' | 'failed';
  deployedAt: string;
  commit: string;
  health: 'healthy' | 'degraded' | 'unhealthy';
};

type SystemMetric = {
  timestamp: string;
  cpu: number;
  memory: number;
  networkIn: number;
  networkOut: number;
  diskUsage: number;
  requestRate: number;
  errorRate: number;
  latencyP99: number;
};

const SEVERITY_COLORS: Record<Issue['severity'], 'magenta' | 'red' | 'yellow' | 'blue'> = {
  critical: 'magenta',
  high: 'red',
  medium: 'yellow',
  low: 'blue',
};

const STATUS_BADGE: Record<string, 'default' | 'primary' | 'magenta' | 'cyan' | 'destructive' | 'success'> = {
  healthy: 'success',
  degraded: 'magenta',
  offline: 'destructive',
  running: 'primary',
  completed: 'success',
  failed: 'destructive',
  pending: 'default',
  success: 'success',
  queued: 'default',
  open: 'destructive',
  investigating: 'magenta',
  resolved: 'success',
  closed: 'default',
  deployed: 'success',
  rolling: 'primary',
  paused: 'magenta',
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function MockDataProvider() {
  const [fleet, setFleet] = useState<FleetMember[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    const generateMockData = () => {
      const now = Date.now();
      const regions = ['sgp1', 'sin1', 'hkg1', 'tyo1', 'syd1'];

      const newFleet: FleetMember[] = Array.from({ length: 12 }, (_, i) => {
        const statusRoll = Math.random();
        const status = statusRoll > 0.9 ? 'offline' : statusRoll > 0.75 ? 'degraded' : 'healthy';
        return {
          id: `mw-${String(i + 1).padStart(3, '0')}`,
          name: `moonwitness-${regions[i % regions.length]}-${String(i + 1).padStart(2, '0')}`,
          status,
          cpu: status === 'healthy' ? Math.floor(Math.random() * 40) + 10 : Math.floor(Math.random() * 30) + 60,
          memory: status === 'healthy' ? Math.floor(Math.random() * 35) + 20 : Math.floor(Math.random() * 25) + 70,
          uptime: formatUptime(Math.floor(Math.random() * 2592000) + 86400),
          lastHeartbeat: new Date(now - Math.random() * 300000).toISOString(),
          region: regions[i % regions.length],
          version: `v2.${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 10)}`,
        };
      });

      const newRoutines: Routine[] = [
        { id: 'rt-001', name: 'Database Backup', status: 'completed', schedule: '0 2 * * *', lastRun: '2026-11-25 02:00:00', nextRun: '2026-11-26 02:00:00', duration: '12m 34s' },
        { id: 'rt-002', name: 'Log Rotation', status: 'completed', schedule: '0 3 * * *', lastRun: '2026-11-25 03:00:00', nextRun: '2026-11-26 03:00:00', duration: '3m 12s' },
        { id: 'rt-003', name: 'Metrics Aggregation', status: 'running', schedule: '*/5 * * * *', lastRun: '2026-11-25 09:55:00', nextRun: '2026-11-25 10:00:00', duration: '45s' },
        { id: 'rt-004', name: 'Certificate Renewal Check', status: 'pending', schedule: '0 6 * * 1', lastRun: '2026-11-18 06:00:00', nextRun: '2026-11-25 06:00:00', duration: '2m 01s' },
        { id: 'rt-005', name: 'Dependency Audit', status: 'completed', schedule: '0 0 * * 0', lastRun: '2026-11-23 00:00:00', nextRun: '2026-11-30 00:00:00', duration: '8m 42s' },
        { id: 'rt-006', name: 'Cache Warmup', status: 'failed', schedule: '0 */6 * * *', lastRun: '2026-11-25 06:00:00', nextRun: '2026-11-25 12:00:00', duration: '1m 23s' },
        { id: 'rt-007', name: 'Health Check Probe', status: 'running', schedule: '*/2 * * * *', lastRun: '2026-11-25 09:58:00', nextRun: '2026-11-25 10:00:00', duration: '8s' },
        { id: 'rt-008', name: 'Dead Letter Queue Processor', status: 'completed', schedule: '*/10 * * * *', lastRun: '2026-11-25 09:50:00', nextRun: '2026-11-25 10:00:00', duration: '12s' },
      ];

      const newPipelines: Pipeline[] = [
        {
          id: 'pl-001', name: 'moonwitness-api', status: 'success', branch: 'main', commit: 'a1b2c3d',
          startedAt: '2026-11-25 08:15:00', duration: '6m 42s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '45s' },
            { name: 'Unit Tests', status: 'success', duration: '2m 10s' },
            { name: 'Integration Tests', status: 'success', duration: '1m 55s' },
            { name: 'Build Image', status: 'success', duration: '1m 22s' },
            { name: 'Deploy Staging', status: 'success', duration: '50s' },
          ],
        },
        {
          id: 'pl-002', name: 'moonwitness-board', status: 'running', branch: 'dev', commit: 'f4e5d6c',
          startedAt: '2026-11-25 09:30:00', duration: '3m 12s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '38s' },
            { name: 'Unit Tests', status: 'success', duration: '1m 45s' },
            { name: 'Build Image', status: 'running', duration: '49s' },
            { name: 'Deploy Staging', status: 'queued', duration: '--' },
          ],
        },
        {
          id: 'pl-003', name: 'moonwitness-whatsapp', status: 'failed', branch: 'feature/webhook-retry', commit: '7b8c9d0',
          startedAt: '2026-11-25 07:45:00', duration: '4m 20s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '42s' },
            { name: 'Unit Tests', status: 'failed', duration: '1m 15s' },
            { name: 'Integration Tests', status: 'queued', duration: '--' },
          ],
        },
        {
          id: 'pl-004', name: 'moonwitness-docs', status: 'success', branch: 'dev', commit: '33ad023',
          startedAt: '2026-11-25 09:10:00', duration: '2m 05s',
          stages: [
            { name: 'Build', status: 'success', duration: '1m 12s' },
            { name: 'Deploy Preview', status: 'success', duration: '53s' },
          ],
        },
      ];

      const newIssues: Issue[] = [
        { id: 'ISS-254', title: 'UI Catalog budget exceeded on components/page', severity: 'high', status: 'investigating', assignee: '@bjo163', createdAt: '2026-11-24 14:22:00', updatedAt: '2026-11-25 09:15:00', tags: ['ui', 'budget', 'components'] },
        { id: 'ISS-256', title: 'WhatsApp webhook deduplication race condition', severity: 'critical', status: 'open', assignee: '@bjo163', createdAt: '2026-11-25 08:01:00', updatedAt: '2026-11-25 08:01:00', tags: ['whatsapp', 'webhook', 'race-condition'] },
        { id: 'ISS-241', title: 'Agent sandbox timeout on long-running tasks', severity: 'medium', status: 'resolved', assignee: '@bjo163', createdAt: '2026-11-22 11:30:00', updatedAt: '2026-11-24 16:45:00', tags: ['agent-sandbox', 'timeout'] },
        { id: 'ISS-238', title: 'FreeLLMAPI model fallback not working', severity: 'high', status: 'investigating', assignee: '@bjo163', createdAt: '2026-11-21 09:15:00', updatedAt: '2026-11-23 14:22:00', tags: ['freellmapi', 'fallback'] },
        { id: 'ISS-229', title: 'Documentation search index stale after deploy', severity: 'low', status: 'closed', assignee: '@bjo163', createdAt: '2026-11-19 16:40:00', updatedAt: '2026-11-20 10:00:00', tags: ['docs', 'search'] },
        { id: 'ISS-215', title: 'Board WebSocket reconnection storm', severity: 'medium', status: 'resolved', assignee: '@bjo163', createdAt: '2026-11-17 22:10:00', updatedAt: '2026-11-18 08:30:00', tags: ['board', 'websocket', 'reconnection'] },
      ];

      const newReleases: Release[] = [
        { id: 'rel-001', version: 'v2.4.0', channel: 'stable', status: 'deployed', deployedAt: '2026-11-20 14:30:00', commit: '5267fcf', health: 'healthy' },
        { id: 'rel-002', version: 'v2.5.0-rc.1', channel: 'preview', status: 'rolling', deployedAt: '2026-11-25 09:00:00', commit: '8678144', health: 'healthy' },
        { id: 'rel-003', version: 'v2.5.0-dev', channel: 'next', status: 'paused', deployedAt: '2026-11-25 09:30:00', commit: 'd04b357', health: 'degraded' },
        { id: 'rel-004', version: 'v2.3.2', channel: 'stable', status: 'deployed', deployedAt: '2026-11-10 11:00:00', commit: 'be90138', health: 'healthy' },
      ];

      const newMetrics: SystemMetric[] = Array.from({ length: 60 }, (_, i) => {
        const t = new Date(now - (59 - i) * 60000);
        return {
          timestamp: t.toISOString(),
          cpu: 25 + Math.sin(i * 0.3) * 15 + Math.random() * 10,
          memory: 45 + Math.sin(i * 0.2) * 10 + Math.random() * 8,
          networkIn: 120 + Math.sin(i * 0.4) * 80 + Math.random() * 50,
          networkOut: 95 + Math.sin(i * 0.35) * 60 + Math.random() * 40,
          diskUsage: 38 + (i / 60) * 5,
          requestRate: 1250 + Math.sin(i * 0.25) * 400 + Math.random() * 200,
          errorRate: Math.max(0, 0.15 + Math.sin(i * 0.5) * 0.12 + Math.random() * 0.1),
          latencyP99: 85 + Math.sin(i * 0.3) * 25 + Math.random() * 20,
        };
      });

      setFleet(newFleet);
      setRoutines(newRoutines);
      setPipelines(newPipelines);
      setIssues(newIssues);
      setReleases(newReleases);
      setMetrics(newMetrics);
      setLoading(false);
      setLastUpdated(new Date());
    };

    generateMockData();
    const interval = setInterval(generateMockData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fleetHealthy = fleet.filter(f => f.status === 'healthy').length;
  const fleetDegraded = fleet.filter(f => f.status === 'degraded').length;
  const fleetOffline = fleet.filter(f => f.status === 'offline').length;
  const totalFleet = fleet.length;

  const routinesRunning = routines.filter(r => r.status === 'running').length;
  const routinesFailed = routines.filter(r => r.status === 'failed').length;
  const routinesCompleted = routines.filter(r => r.status === 'completed').length;

  const pipelinesRunning = pipelines.filter(p => p.status === 'running').length;
  const pipelinesFailed = pipelines.filter(p => p.status === 'failed').length;
  const pipelinesSuccess = pipelines.filter(p => p.status === 'success').length;

  const issuesCritical = issues.filter(i => i.severity === 'critical' && i.status !== 'closed').length;
  const issuesOpen = issues.filter(i => i.status === 'open').length;
  const issuesInvestigating = issues.filter(i => i.status === 'investigating').length;

  const releasesRolling = releases.filter(r => r.status === 'rolling').length;
  const releasesPaused = releases.filter(r => r.status === 'paused').length;

  const latestMetrics = metrics[metrics.length - 1];
  const avgCpu = metrics.reduce((sum, m) => sum + m.cpu, 0) / metrics.length;
  const avgMemory = metrics.reduce((sum, m) => sum + m.memory, 0) / metrics.length;
  const avgLatency = metrics.reduce((sum, m) => sum + m.latencyP99, 0) / metrics.length;
  const avgErrorRate = metrics.reduce((sum, m) => sum + m.errorRate, 0) / metrics.length;

  const cpuChartData = metrics.map(m => ({ time: m.timestamp.slice(11, 16), value: Math.round(m.cpu * 10) / 10 }));
  const memoryChartData = metrics.map(m => ({ time: m.timestamp.slice(11, 16), value: Math.round(m.memory * 10) / 10 }));
  const latencyChartData = metrics.map(m => ({ time: m.timestamp.slice(11, 16), value: Math.round(m.latencyP99) }));
  const errorRateChartData = metrics.map(m => ({ time: m.timestamp.slice(11, 16), value: Math.round(m.errorRate * 1000) / 1000 }));
  const requestRateChartData = metrics.map(m => ({ time: m.timestamp.slice(11, 16), value: Math.round(m.requestRate) }));
  const networkChartData = metrics.map(m => ({
    time: m.timestamp.slice(11, 16),
    in: Math.round(m.networkIn),
    out: Math.round(m.networkOut),
  }));

  return {
    fleet,
    routines,
    pipelines,
    issues,
    releases,
    metrics,
    loading,
    lastUpdated,
    summary: {
      fleet: { healthy: fleetHealthy, degraded: fleetDegraded, offline: fleetOffline, total: totalFleet },
      routines: { running: routinesRunning, failed: routinesFailed, completed: routinesCompleted },
      pipelines: { running: pipelinesRunning, failed: pipelinesFailed, success: pipelinesSuccess },
      issues: { critical: issuesCritical, open: issuesOpen, investigating: issuesInvestigating },
      releases: { rolling: releasesRolling, paused: releasesPaused },
      system: { cpu: avgCpu, memory: avgMemory, latency: avgLatency, errorRate: avgErrorRate, current: latestMetrics },
    },
    charts: {
      cpu: cpuChartData,
      memory: memoryChartData,
      latency: latencyChartData,
      errorRate: errorRateChartData,
      requestRate: requestRateChartData,
      network: networkChartData,
    },
  };
}

export function MonitoringDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const data = MockDataProvider();

  if (data.loading) {
    return (
      <div className="monitoring-dashboard">
        <div className="dashboard-loading" role="status" aria-label="Memuat dashboard monitoring">
          <div className="loading-spinner" />
          <p>Memuat data monitoring...</p>
        </div>
      </div>
    );
  }

  const { summary, charts, fleet, routines, pipelines, issues, releases, lastUpdated } = data;

  return (
    <div className="monitoring-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>Monitoring Dashboard</h1>
          <p className="dashboard-subtitle">Real-time fleet, pipeline, dan system health overview</p>
        </div>
        <div className="header-right">
          <StatusBar
            status={summary.fleet.offline > 0 ? 'degraded' : summary.fleet.degraded > 0 ? 'warning' : 'healthy'}
            label={summary.fleet.offline > 0 ? 'DEGRADED' : summary.fleet.degraded > 0 ? 'WARNING' : 'HEALTHY'}
            timestamp={lastUpdated.toLocaleString('id-ID', { hour12: false })}
            showPulse={summary.fleet.healthy === summary.fleet.total}
          />
          <span className="last-updated">Updated: {lastUpdated.toLocaleTimeString('id-ID', { hour12: false })}</span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="metric-row" aria-label="Key metrics overview">
          <MetricTile
            title="Fleet Health"
            value={`${summary.fleet.healthy}/${summary.fleet.total}`}
            subtitle={`${summary.fleet.degraded} degraded, ${summary.fleet.offline} offline`}
            trend={summary.fleet.healthy === summary.fleet.total ? 'up' : summary.fleet.offline > 0 ? 'down' : 'neutral'}
            trendLabel={summary.fleet.healthy === summary.fleet.total ? 'All healthy' : 'Needs attention'}
            accent={summary.fleet.offline > 0 ? 'magenta' : summary.fleet.degraded > 0 ? 'yellow' : 'green'}
            icon="🖥️"
          />
          <MetricTile
            title="Active Routines"
            value={`${summary.routines.running} running`}
            subtitle={`${summary.routines.completed} completed, ${summary.routines.failed} failed today`}
            trend={summary.routines.failed > 0 ? 'down' : 'up'}
            trendLabel={summary.routines.failed > 0 ? 'Some failures' : 'All running'}
            accent={summary.routines.failed > 0 ? 'magenta' : 'cyan'}
            icon="⏰"
          />
          <MetricTile
            title="Pipelines (24h)"
            value={`${summary.pipelines.success} passed`}
            subtitle={`${summary.pipelines.running} running, ${summary.pipelines.failed} failed`}
            trend={summary.pipelines.failed > 0 ? 'down' : 'up'}
            trendLabel={summary.pipelines.failed > 0 ? 'Failures detected' : 'All green'}
            accent={summary.pipelines.failed > 0 ? 'magenta' : 'green'}
            icon="🔄"
          />
          <MetricTile
            title="Open Issues"
            value={summary.issues.critical > 0 ? `${summary.issues.critical} critical` : `${summary.issues.open + summary.issues.investigating} active`}
            subtitle={`${summary.issues.investigating} investigating, ${summary.issues.open} open`}
            trend={summary.issues.critical > 0 ? 'down' : summary.issues.open > 3 ? 'down' : 'neutral'}
            trendLabel={summary.issues.critical > 0 ? 'Critical alert' : 'Under control'}
            accent={summary.issues.critical > 0 ? 'magenta' : summary.issues.open > 3 ? 'yellow' : 'green'}
            icon="🐛"
          />
          <MetricTile
            title="System CPU (avg 1h)"
            value={`${Math.round(summary.system.cpu)}%`}
            subtitle={`Current: ${summary.system.current?.cpu.toFixed(1) ?? '—'}%`}
            trend={summary.system.cpu > 70 ? 'down' : summary.system.cpu > 50 ? 'neutral' : 'up'}
            trendLabel={summary.system.cpu > 70 ? 'High load' : 'Normal'}
            accent={summary.system.cpu > 70 ? 'magenta' : summary.system.cpu > 50 ? 'yellow' : 'green'}
            icon="📊"
          />
          <MetricTile
            title="P99 Latency (avg 1h)"
            value={`${Math.round(summary.system.latency)}ms`}
            subtitle={`Error rate: ${(summary.system.errorRate * 100).toFixed(2)}%`}
            trend={summary.system.latency > 150 || summary.system.errorRate > 0.5 ? 'down' : 'up'}
            trendLabel={summary.system.latency > 150 ? 'Elevated' : 'Healthy'}
            accent={summary.system.latency > 150 || summary.system.errorRate > 0.5 ? 'magenta' : 'green'}
            icon="⚡"
          />
        </section>

        <Tabs defaultTab="fleet" className="dashboard-tabs">
          <TabList aria-label="Dashboard sections">
            <Tab id="fleet">Fleet</Tab>
            <Tab id="routines">Routines</Tab>
            <Tab id="pipelines">Pipelines</Tab>
            <Tab id="issues">Issues</Tab>
            <Tab id="releases">Releases</Tab>
            <Tab id="metrics">System Metrics</Tab>
          </TabList>

          <TabPanel id="fleet">
            <Panel title="Fleet Members" subtitle={`${summary.fleet.total} nodes across ${new Set(fleet.map(f => f.region)).size} regions`}>
              <Table<FleetMember>
                columns={[
                  { key: 'name', header: 'Name', render: (row) => <strong>{row.name}</strong> },
                  { key: 'id', header: 'ID' },
                  { key: 'region', header: 'Region' },
                  { key: 'status', header: 'Status', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.status] as any}>{row.status.toUpperCase()}</Badge>
                  )},
                  { key: 'cpu', header: 'CPU %', render: (row) => `${row.cpu}%` },
                  { key: 'memory', header: 'Memory %', render: (row) => `${row.memory}%` },
                  { key: 'uptime', header: 'Uptime' },
                  { key: 'version', header: 'Version' },
                  { key: 'lastHeartbeat', header: 'Last Heartbeat', render: (row) => new Date(row.lastHeartbeat).toLocaleTimeString('id-ID') },
                ]}
                rows={fleet}
                rowKey="id"
                striped
                hoverable
                density="compact"
              />
            </Panel>
          </TabPanel>

          <TabPanel id="routines">
            <Panel title="Scheduled Routines" subtitle={`${routines.length} routines configured`}>
              <Table<Routine>
                columns={[
                  { key: 'name', header: 'Routine', render: (row) => <strong>{row.name}</strong> },
                  { key: 'schedule', header: 'Schedule (cron)' },
                  { key: 'status', header: 'Status', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.status] as any}>{row.status.toUpperCase()}</Badge>
                  )},
                  { key: 'lastRun', header: 'Last Run' },
                  { key: 'nextRun', header: 'Next Run' },
                  { key: 'duration', header: 'Duration' },
                ]}
                rows={routines}
                rowKey="id"
                striped
                hoverable
                density="compact"
              />
            </Panel>
          </TabPanel>

          <TabPanel id="pipelines">
            <Panel title="Recent Pipeline Runs" subtitle={`${pipelines.length} runs in last 24h`}>
              <Table<Pipeline>
                columns={[
                  { key: 'name', header: 'Pipeline', render: (row) => <strong>{row.name}</strong> },
                  { key: 'branch', header: 'Branch' },
                  { key: 'commit', header: 'Commit', render: (row) => <code>{row.commit}</code> },
                  { key: 'status', header: 'Status', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.status] as any}>{row.status.toUpperCase()}</Badge>
                  )},
                  { key: 'startedAt', header: 'Started' },
                  { key: 'duration', header: 'Duration' },
                  { key: 'stages', header: 'Stages', render: (row) => (
                    <div className="stage-badges">
                      {row.stages.map((s, i) => (
                        <Badge key={i} variant={STATUS_BADGE[s.status] as any} className="stage-badge">
                          {s.name}: {s.status}
                        </Badge>
                      ))}
                    </div>
                  )},
                ]}
                rows={pipelines}
                rowKey="id"
                striped
                hoverable
                density="compact"
              />
            </Panel>
          </TabPanel>

          <TabPanel id="issues">
            <Panel title="Active Issues" subtitle={`${summary.issues.critical} critical, ${summary.issues.open + summary.issues.investigating} total active`}>
              <Table<Issue>
                columns={[
                  { key: 'id', header: 'ID', render: (row) => <code>{row.id}</code> },
                  { key: 'title', header: 'Title', render: (row) => <strong>{row.title}</strong> },
                  { key: 'severity', header: 'Severity', render: (row) => (
                    <Badge variant={SEVERITY_COLORS[row.severity] as any}>{row.severity.toUpperCase()}</Badge>
                  )},
                  { key: 'status', header: 'Status', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.status] as any}>{row.status.toUpperCase()}</Badge>
                  )},
                  { key: 'assignee', header: 'Assignee' },
                  { key: 'createdAt', header: 'Created' },
                  { key: 'tags', header: 'Tags', render: (row) => (
                    <div className="tag-list">
                      {row.tags.map(t => <span key={t} className="tag">{t}</span>)}
                    </div>
                  )},
                ]}
                rows={issues}
                rowKey="id"
                striped
                hoverable
                density="compact"
              />
            </Panel>
          </TabPanel>

          <TabPanel id="releases">
            <Panel title="Release Tracking" subtitle={`${releases.length} recent releases`}>
              <Table<Release>
                columns={[
                  { key: 'version', header: 'Version', render: (row) => <strong>{row.version}</strong> },
                  { key: 'channel', header: 'Channel', render: (row) => (
                    <Badge variant={row.channel === 'stable' ? 'success' : row.channel === 'preview' ? 'primary' : 'cyan'}>{row.channel.toUpperCase()}</Badge>
                  )},
                  { key: 'status', header: 'Status', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.status] as any}>{row.status.toUpperCase()}</Badge>
                  )},
                  { key: 'health', header: 'Health', render: (row) => (
                    <Badge variant={STATUS_BADGE[row.health] as any}>{row.health.toUpperCase()}</Badge>
                  )},
                  { key: 'deployedAt', header: 'Deployed' },
                  { key: 'commit', header: 'Commit', render: (row) => <code>{row.commit}</code> },
                ]}
                rows={releases}
                rowKey="id"
                striped
                hoverable
                density="compact"
              />
            </Panel>
          </TabPanel>

          <TabPanel id="metrics">
            <div className="metrics-charts">
              <Panel title="CPU & Memory Utilization (1h)" subtitle="Average across fleet" className="chart-panel">
                <div className="chart-grid">
                  <LineChart
                    data={charts.cpu}
                    xKey="time"
                    yKey="value"
                    color="#00d4aa"
                    height={200}
                    showArea
                    areaOpacity={0.15}
                    yLabel="CPU %"
                    yDomain={[0, 100]}
                  />
                  <LineChart
                    data={charts.memory}
                    xKey="time"
                    yKey="value"
                    color="#6366f1"
                    height={200}
                    showArea
                    areaOpacity={0.15}
                    yLabel="Memory %"
                    yDomain={[0, 100]}
                  />
                </div>
              </Panel>

              <Panel title="Request Rate & Latency (1h)" subtitle="API performance metrics" className="chart-panel">
                <div className="chart-grid">
                  <LineChart
                    data={charts.requestRate}
                    xKey="time"
                    yKey="value"
                    color="#f59e0b"
                    height={200}
                    showArea
                    areaOpacity={0.15}
                    yLabel="Req/s"
                  />
                  <LineChart
                    data={charts.latency}
                    xKey="time"
                    yKey="value"
                    color="#ef4444"
                    height={200}
                    showArea
                    areaOpacity={0.15}
                    yLabel="P99 Latency (ms)"
                  />
                </div>
              </Panel>

              <Panel title="Error Rate & Network (1h)" subtitle="Error rate (left axis) and network throughput (right axis)" className="chart-panel">
                <div className="chart-grid">
                  <LineChart
                    data={charts.errorRate}
                    xKey="time"
                    yKey="value"
                    color="#ef4444"
                    height={200}
                    yLabel="Error Rate %"
                    yDomain={[0, 2]}
                  />
                  <LineChart
                    data={charts.network}
                    xKey="time"
                    yKey="in"
                    color="#06b6d4"
                    height={200}
                    yLabel="Network In (Mbps)"
                  />
                </div>
              </Panel>

              <div className="metric-cards">
                <MetricTile
                  title="Avg CPU (1h)"
                  value={`${Math.round(summary.system.cpu)}%`}
                  subtitle="Fleet-wide average"
                  accent="cyan"
                  icon="📈"
                />
                <MetricTile
                  title="Avg Memory (1h)"
                  value={`${Math.round(summary.system.memory)}%`}
                  subtitle="Fleet-wide average"
                  accent="violet"
                  icon="🧠"
                />
                <MetricTile
                  title="P99 Latency (1h)"
                  value={`${Math.round(summary.system.latency)}ms`}
                  subtitle="Fleet-wide average"
                  accent="yellow"
                  icon="⚡"
                />
                <MetricTile
                  title="Error Rate (1h)"
                  value={`${(summary.system.errorRate * 100).toFixed(2)}%`}
                  subtitle="Fleet-wide average"
                  accent={summary.system.errorRate > 0.5 ? 'magenta' : 'green'}
                  icon="🚨"
                />
              </div>
            </div>
          </TabPanel>
        </Tabs>
      </div>

      <footer className="dashboard-footer">
        <p>MoonWitness Monitoring Dashboard • Data refreshes every 30s • <Link to="/guide/operations/monitoring">Documentation</Link></p>
      </footer>
    </div>
  );
}

export default MonitoringDashboard;