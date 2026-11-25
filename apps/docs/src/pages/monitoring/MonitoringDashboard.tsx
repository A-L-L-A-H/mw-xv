import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, type BadgeProps } from '@moonwitness/ui/components/badge';
import { LineChart } from '@moonwitness/ui/components/chart';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { StatusBar } from '@moonwitness/ui/components/status-bar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';

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

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const SEVERITY_COLORS: Record<Issue['severity'], BadgeVariant> = {
  critical: 'magenta',
  high: 'destructive',
  medium: 'primary',
  low: 'cyan',
};

const STATUS_BADGE: Record<string, BadgeVariant> = {
  healthy: 'cyan',
  degraded: 'magenta',
  offline: 'destructive',
  unhealthy: 'destructive',
  running: 'primary',
  completed: 'cyan',
  failed: 'destructive',
  pending: 'default',
  success: 'cyan',
  queued: 'default',
  open: 'destructive',
  investigating: 'magenta',
  resolved: 'cyan',
  closed: 'default',
  deployed: 'cyan',
  rolling: 'primary',
  paused: 'magenta',
};

function statusVariant(status: string): BadgeVariant {
  return STATUS_BADGE[status] ?? 'default';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function useMonitoringSnapshot() {
  const [fleet, setFleet] = useState<FleetMember[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    const generateSnapshot = () => {
      const now = Date.now();
      const regions = ['sgp1', 'sin1', 'hkg1', 'tyo1', 'syd1'];

      const newFleet: FleetMember[] = Array.from({ length: 12 }, (_, i) => {
        const statusRoll = Math.random();
        const status = statusRoll > 0.9 ? 'offline' : statusRoll > 0.75 ? 'degraded' : 'healthy';
        return {
          id: `mw-${String(i + 1).padStart(3, '0')}`,
          name: `moonwitness-${regions[i % regions.length]}-${String(i + 1).padStart(2, '0')}`,
          status,
          cpu:
            status === 'healthy'
              ? Math.floor(Math.random() * 40) + 10
              : Math.floor(Math.random() * 30) + 60,
          memory:
            status === 'healthy'
              ? Math.floor(Math.random() * 35) + 20
              : Math.floor(Math.random() * 25) + 70,
          uptime: formatUptime(Math.floor(Math.random() * 2592000) + 86400),
          lastHeartbeat: new Date(now - Math.random() * 300000).toISOString(),
          region: regions[i % regions.length],
          version: `v2.${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 10)}`,
        };
      });

      const newRoutines: Routine[] = [
        {
          id: 'rt-001',
          name: 'Database Backup',
          status: 'completed',
          schedule: '0 2 * * *',
          lastRun: '2026-11-25 02:00:00',
          nextRun: '2026-11-26 02:00:00',
          duration: '12m 34s',
        },
        {
          id: 'rt-002',
          name: 'Log Rotation',
          status: 'completed',
          schedule: '0 3 * * *',
          lastRun: '2026-11-25 03:00:00',
          nextRun: '2026-11-26 03:00:00',
          duration: '3m 12s',
        },
        {
          id: 'rt-003',
          name: 'Metrics Aggregation',
          status: 'running',
          schedule: '*/5 * * * *',
          lastRun: '2026-11-25 09:55:00',
          nextRun: '2026-11-25 10:00:00',
          duration: '45s',
        },
        {
          id: 'rt-004',
          name: 'Certificate Renewal Check',
          status: 'pending',
          schedule: '0 6 * * 1',
          lastRun: '2026-11-18 06:00:00',
          nextRun: '2026-11-25 06:00:00',
          duration: '2m 01s',
        },
        {
          id: 'rt-005',
          name: 'Dependency Audit',
          status: 'completed',
          schedule: '0 0 * * 0',
          lastRun: '2026-11-23 00:00:00',
          nextRun: '2026-11-30 00:00:00',
          duration: '8m 42s',
        },
        {
          id: 'rt-006',
          name: 'Cache Warmup',
          status: 'failed',
          schedule: '0 */6 * * *',
          lastRun: '2026-11-25 06:00:00',
          nextRun: '2026-11-25 12:00:00',
          duration: '1m 23s',
        },
        {
          id: 'rt-007',
          name: 'Health Check Probe',
          status: 'running',
          schedule: '*/2 * * * *',
          lastRun: '2026-11-25 09:58:00',
          nextRun: '2026-11-25 10:00:00',
          duration: '8s',
        },
        {
          id: 'rt-008',
          name: 'Dead Letter Queue Processor',
          status: 'completed',
          schedule: '*/10 * * * *',
          lastRun: '2026-11-25 09:50:00',
          nextRun: '2026-11-25 10:00:00',
          duration: '12s',
        },
      ];

      const newPipelines: Pipeline[] = [
        {
          id: 'pl-001',
          name: 'moonwitness-api',
          status: 'success',
          branch: 'main',
          commit: 'a1b2c3d',
          startedAt: '2026-11-25 08:15:00',
          duration: '6m 42s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '45s' },
            { name: 'Unit Tests', status: 'success', duration: '2m 10s' },
            { name: 'Integration Tests', status: 'success', duration: '1m 55s' },
            { name: 'Build Image', status: 'success', duration: '1m 22s' },
            { name: 'Deploy Staging', status: 'success', duration: '50s' },
          ],
        },
        {
          id: 'pl-002',
          name: 'moonwitness-board',
          status: 'running',
          branch: 'dev',
          commit: 'f4e5d6c',
          startedAt: '2026-11-25 09:30:00',
          duration: '3m 12s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '38s' },
            { name: 'Unit Tests', status: 'success', duration: '1m 45s' },
            { name: 'Build Image', status: 'running', duration: '49s' },
            { name: 'Deploy Staging', status: 'queued', duration: '--' },
          ],
        },
        {
          id: 'pl-003',
          name: 'moonwitness-whatsapp',
          status: 'failed',
          branch: 'feature/webhook-retry',
          commit: '7b8c9d0',
          startedAt: '2026-11-25 07:45:00',
          duration: '4m 20s',
          stages: [
            { name: 'Lint & Typecheck', status: 'success', duration: '42s' },
            { name: 'Unit Tests', status: 'failed', duration: '1m 15s' },
            { name: 'Integration Tests', status: 'queued', duration: '--' },
          ],
        },
        {
          id: 'pl-004',
          name: 'moonwitness-docs',
          status: 'success',
          branch: 'dev',
          commit: '33ad023',
          startedAt: '2026-11-25 09:10:00',
          duration: '2m 05s',
          stages: [
            { name: 'Build', status: 'success', duration: '1m 12s' },
            { name: 'Deploy Preview', status: 'success', duration: '53s' },
          ],
        },
      ];

      const newIssues: Issue[] = [
        {
          id: 'ISS-254',
          title: 'UI Catalog budget exceeded on components/page',
          severity: 'high',
          status: 'investigating',
          assignee: '@bjo163',
          createdAt: '2026-11-24 14:22:00',
          updatedAt: '2026-11-25 09:15:00',
          tags: ['ui', 'budget', 'components'],
        },
        {
          id: 'ISS-256',
          title: 'WhatsApp webhook deduplication race condition',
          severity: 'critical',
          status: 'open',
          assignee: '@bjo163',
          createdAt: '2026-11-25 08:01:00',
          updatedAt: '2026-11-25 08:01:00',
          tags: ['whatsapp', 'webhook', 'race-condition'],
        },
        {
          id: 'ISS-241',
          title: 'Agent sandbox timeout on long-running tasks',
          severity: 'medium',
          status: 'resolved',
          assignee: '@bjo163',
          createdAt: '2026-11-22 11:30:00',
          updatedAt: '2026-11-24 16:45:00',
          tags: ['agent-sandbox', 'timeout'],
        },
        {
          id: 'ISS-238',
          title: 'FreeLLMAPI model fallback not working',
          severity: 'high',
          status: 'investigating',
          assignee: '@bjo163',
          createdAt: '2026-11-21 09:15:00',
          updatedAt: '2026-11-23 14:22:00',
          tags: ['freellmapi', 'fallback'],
        },
        {
          id: 'ISS-229',
          title: 'Documentation search index stale after deploy',
          severity: 'low',
          status: 'closed',
          assignee: '@bjo163',
          createdAt: '2026-11-19 16:40:00',
          updatedAt: '2026-11-20 10:00:00',
          tags: ['docs', 'search'],
        },
        {
          id: 'ISS-215',
          title: 'Board WebSocket reconnection storm',
          severity: 'medium',
          status: 'resolved',
          assignee: '@bjo163',
          createdAt: '2026-11-17 22:10:00',
          updatedAt: '2026-11-18 08:30:00',
          tags: ['board', 'websocket', 'reconnection'],
        },
      ];

      const newReleases: Release[] = [
        {
          id: 'rel-001',
          version: 'v2.4.0',
          channel: 'stable',
          status: 'deployed',
          deployedAt: '2026-11-20 14:30:00',
          commit: '5267fcf',
          health: 'healthy',
        },
        {
          id: 'rel-002',
          version: 'v2.5.0-rc.1',
          channel: 'preview',
          status: 'rolling',
          deployedAt: '2026-11-25 09:00:00',
          commit: '8678144',
          health: 'healthy',
        },
        {
          id: 'rel-003',
          version: 'v2.5.0-dev',
          channel: 'next',
          status: 'paused',
          deployedAt: '2026-11-25 09:30:00',
          commit: 'd04b357',
          health: 'degraded',
        },
        {
          id: 'rel-004',
          version: 'v2.3.2',
          channel: 'stable',
          status: 'deployed',
          deployedAt: '2026-11-10 11:00:00',
          commit: 'be90138',
          health: 'healthy',
        },
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

    generateSnapshot();
    const interval = setInterval(generateSnapshot, 30000);
    return () => clearInterval(interval);
  }, []);

  const fleetHealthy = fleet.filter((f) => f.status === 'healthy').length;
  const fleetDegraded = fleet.filter((f) => f.status === 'degraded').length;
  const fleetOffline = fleet.filter((f) => f.status === 'offline').length;
  const totalFleet = fleet.length;

  const routinesRunning = routines.filter((r) => r.status === 'running').length;
  const routinesFailed = routines.filter((r) => r.status === 'failed').length;
  const routinesCompleted = routines.filter((r) => r.status === 'completed').length;

  const pipelinesRunning = pipelines.filter((p) => p.status === 'running').length;
  const pipelinesFailed = pipelines.filter((p) => p.status === 'failed').length;
  const pipelinesSuccess = pipelines.filter((p) => p.status === 'success').length;

  const issuesCritical = issues.filter(
    (i) => i.severity === 'critical' && i.status !== 'closed'
  ).length;
  const issuesOpen = issues.filter((i) => i.status === 'open').length;
  const issuesInvestigating = issues.filter((i) => i.status === 'investigating').length;

  const releasesRolling = releases.filter((r) => r.status === 'rolling').length;
  const releasesPaused = releases.filter((r) => r.status === 'paused').length;

  const latestMetrics = metrics[metrics.length - 1];
  const metricCount = metrics.length || 1;
  const avgCpu = metrics.reduce((sum, m) => sum + m.cpu, 0) / metricCount;
  const avgMemory = metrics.reduce((sum, m) => sum + m.memory, 0) / metricCount;
  const avgLatency = metrics.reduce((sum, m) => sum + m.latencyP99, 0) / metricCount;
  const avgErrorRate = metrics.reduce((sum, m) => sum + m.errorRate, 0) / metricCount;

  const sampledMetrics = metrics.filter(
    (_, index) => index % 10 === 0 || index === metrics.length - 1
  );
  const chartLabels = sampledMetrics.map((m) => m.timestamp.slice(11, 16));

  return {
    fleet,
    routines,
    pipelines,
    issues,
    releases,
    loading,
    lastUpdated,
    summary: {
      fleet: {
        healthy: fleetHealthy,
        degraded: fleetDegraded,
        offline: fleetOffline,
        total: totalFleet,
      },
      routines: { running: routinesRunning, failed: routinesFailed, completed: routinesCompleted },
      pipelines: { running: pipelinesRunning, failed: pipelinesFailed, success: pipelinesSuccess },
      issues: { critical: issuesCritical, open: issuesOpen, investigating: issuesInvestigating },
      releases: { rolling: releasesRolling, paused: releasesPaused },
      system: {
        cpu: avgCpu,
        memory: avgMemory,
        latency: avgLatency,
        errorRate: avgErrorRate,
        current: latestMetrics,
      },
    },
    charts: {
      labels: chartLabels,
      cpu: sampledMetrics.map((m) => Math.round(m.cpu * 10) / 10),
      memory: sampledMetrics.map((m) => Math.round(m.memory * 10) / 10),
      latency: sampledMetrics.map((m) => Math.round(m.latencyP99)),
      errorRate: sampledMetrics.map((m) => Math.round(m.errorRate * 1000) / 1000),
      requestRate: sampledMetrics.map((m) => Math.round(m.requestRate)),
      networkIn: sampledMetrics.map((m) => Math.round(m.networkIn)),
      networkOut: sampledMetrics.map((m) => Math.round(m.networkOut)),
    },
  };
}

export function MonitoringDashboard() {
  const snapshot = useMonitoringSnapshot();

  if (snapshot.loading) {
    return (
      <div className="monitoring-dashboard">
        <div className="dashboard-loading" role="status" aria-label="Memuat dashboard monitoring">
          <div className="loading-spinner" />
          <p>Memuat data monitoring...</p>
        </div>
      </div>
    );
  }

  const { summary, charts, fleet, routines, pipelines, issues, releases, lastUpdated } = snapshot;

  return (
    <div className="monitoring-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>Monitoring Dashboard</h1>
          <p className="dashboard-subtitle">
            Real-time fleet, pipeline, dan system health overview
          </p>
        </div>
        <div className="header-right">
          <StatusBar
            steps={[
              {
                id: 'healthy',
                label: 'Healthy',
                state: summary.fleet.healthy === summary.fleet.total ? 'done' : 'active',
                count: summary.fleet.healthy,
              },
              {
                id: 'degraded',
                label: 'Degraded',
                state: summary.fleet.degraded > 0 ? 'active' : 'disabled',
                count: summary.fleet.degraded,
              },
              {
                id: 'offline',
                label: 'Offline',
                state: summary.fleet.offline > 0 ? 'active' : 'disabled',
                count: summary.fleet.offline,
              },
            ]}
          />
          <span className="last-updated">
            Updated: {lastUpdated.toLocaleTimeString('id-ID', { hour12: false })}
          </span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="metric-row" aria-label="Key metrics overview">
          <MetricTile
            label="Fleet Health"
            value={`${summary.fleet.healthy}/${summary.fleet.total}`}
            detail={`${summary.fleet.degraded} degraded, ${summary.fleet.offline} offline`}
            accent={
              summary.fleet.offline > 0
                ? 'magenta'
                : summary.fleet.degraded > 0
                  ? 'yellow'
                  : 'green'
            }
            icon="🖥️"
          />
          <MetricTile
            label="Active Routines"
            value={`${summary.routines.running} running`}
            detail={`${summary.routines.completed} completed, ${summary.routines.failed} failed today`}
            accent={summary.routines.failed > 0 ? 'magenta' : 'cyan'}
            icon="⏰"
          />
          <MetricTile
            label="Pipelines (24h)"
            value={`${summary.pipelines.success} passed`}
            detail={`${summary.pipelines.running} running, ${summary.pipelines.failed} failed`}
            accent={summary.pipelines.failed > 0 ? 'magenta' : 'green'}
            icon="🔄"
          />
          <MetricTile
            label="Open Issues"
            value={
              summary.issues.critical > 0
                ? `${summary.issues.critical} critical`
                : `${summary.issues.open + summary.issues.investigating} active`
            }
            detail={`${summary.issues.investigating} investigating, ${summary.issues.open} open`}
            accent={
              summary.issues.critical > 0 ? 'magenta' : summary.issues.open > 3 ? 'yellow' : 'green'
            }
            icon="🐛"
          />
          <MetricTile
            label="System CPU (avg 1h)"
            value={`${Math.round(summary.system.cpu)}%`}
            detail={`Current: ${summary.system.current?.cpu.toFixed(1) ?? '—'}%`}
            accent={
              summary.system.cpu > 70 ? 'magenta' : summary.system.cpu > 50 ? 'yellow' : 'green'
            }
            icon="📊"
          />
          <MetricTile
            label="P99 Latency (avg 1h)"
            value={`${Math.round(summary.system.latency)}ms`}
            detail={`Error rate: ${(summary.system.errorRate * 100).toFixed(2)}%`}
            accent={
              summary.system.latency > 150 || summary.system.errorRate > 0.5 ? 'magenta' : 'green'
            }
            icon="⚡"
          />
        </section>

        <Tabs defaultValue="fleet" className="dashboard-tabs">
          <TabsList aria-label="Dashboard sections">
            <TabsTrigger value="fleet">Fleet</TabsTrigger>
            <TabsTrigger value="routines">Routines</TabsTrigger>
            <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="releases">Releases</TabsTrigger>
            <TabsTrigger value="metrics">System Metrics</TabsTrigger>
          </TabsList>

          <TabsContent value="fleet">
            <Panel
              title="Fleet Members"
              description={`${summary.fleet.total} nodes across ${new Set(fleet.map((f) => f.region)).size} regions`}
            >
              <Table density="compact" scrollLabel="Fleet members">
                <TableHead>
                  <TableRow>
                    <TableHeader>Name</TableHeader>
                    <TableHeader>ID</TableHeader>
                    <TableHeader>Region</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>CPU %</TableHeader>
                    <TableHeader>Memory %</TableHeader>
                    <TableHeader>Uptime</TableHeader>
                    <TableHeader>Version</TableHeader>
                    <TableHeader>Last Heartbeat</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fleet.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <strong>{row.name}</strong>
                      </TableCell>
                      <TableCell>{row.id}</TableCell>
                      <TableCell>{row.region}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.cpu}%</TableCell>
                      <TableCell>{row.memory}%</TableCell>
                      <TableCell>{row.uptime}</TableCell>
                      <TableCell>{row.version}</TableCell>
                      <TableCell>
                        {new Date(row.lastHeartbeat).toLocaleTimeString('id-ID')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="routines">
            <Panel
              title="Scheduled Routines"
              description={`${routines.length} routines configured`}
            >
              <Table density="compact" scrollLabel="Scheduled routines">
                <TableHead>
                  <TableRow>
                    <TableHeader>Routine</TableHeader>
                    <TableHeader>Schedule (cron)</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Last Run</TableHeader>
                    <TableHeader>Next Run</TableHeader>
                    <TableHeader>Duration</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {routines.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <strong>{row.name}</strong>
                      </TableCell>
                      <TableCell>{row.schedule}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.lastRun}</TableCell>
                      <TableCell>{row.nextRun}</TableCell>
                      <TableCell>{row.duration}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="pipelines">
            <Panel
              title="Recent Pipeline Runs"
              description={`${pipelines.length} runs in last 24h`}
            >
              <Table density="compact" scrollLabel="Recent pipeline runs">
                <TableHead>
                  <TableRow>
                    <TableHeader>Pipeline</TableHeader>
                    <TableHeader>Branch</TableHeader>
                    <TableHeader>Commit</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Started</TableHeader>
                    <TableHeader>Duration</TableHeader>
                    <TableHeader>Stages</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pipelines.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <strong>{row.name}</strong>
                      </TableCell>
                      <TableCell>{row.branch}</TableCell>
                      <TableCell>
                        <code>{row.commit}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.startedAt}</TableCell>
                      <TableCell>{row.duration}</TableCell>
                      <TableCell>
                        <div className="stage-badges">
                          {row.stages.map((s) => (
                            <Badge
                              key={s.name}
                              variant={statusVariant(s.status)}
                              className="stage-badge"
                            >
                              {s.name}: {s.status}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="issues">
            <Panel
              title="Active Issues"
              description={`${summary.issues.critical} critical, ${summary.issues.open + summary.issues.investigating} total active`}
            >
              <Table density="compact" scrollLabel="Active issues">
                <TableHead>
                  <TableRow>
                    <TableHeader>ID</TableHeader>
                    <TableHeader>Title</TableHeader>
                    <TableHeader>Severity</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Assignee</TableHeader>
                    <TableHeader>Created</TableHeader>
                    <TableHeader>Tags</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {issues.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <code>{row.id}</code>
                      </TableCell>
                      <TableCell>
                        <strong>{row.title}</strong>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SEVERITY_COLORS[row.severity]}>
                          {row.severity.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.assignee}</TableCell>
                      <TableCell>{row.createdAt}</TableCell>
                      <TableCell>
                        <div className="tag-list">
                          {row.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="releases">
            <Panel title="Release Tracking" description={`${releases.length} recent releases`}>
              <Table density="compact" scrollLabel="Release tracking">
                <TableHead>
                  <TableRow>
                    <TableHeader>Version</TableHeader>
                    <TableHeader>Channel</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Health</TableHeader>
                    <TableHeader>Deployed</TableHeader>
                    <TableHeader>Commit</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {releases.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <strong>{row.version}</strong>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.channel === 'stable'
                              ? 'cyan'
                              : row.channel === 'preview'
                                ? 'primary'
                                : 'default'
                          }
                        >
                          {row.channel.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.health)}>
                          {row.health.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.deployedAt}</TableCell>
                      <TableCell>
                        <code>{row.commit}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="metrics">
            <div className="metrics-charts">
              <Panel
                title="CPU & Memory Utilization (1h)"
                description="Average across fleet"
                className="chart-panel"
              >
                <div className="chart-grid">
                  <LineChart
                    title="CPU Utilization (%)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'CPU %',
                        color: 'var(--mw-chart-1)',
                        values: charts.cpu,
                      },
                    ]}
                    valueLabel="CPU %"
                  />
                  <LineChart
                    title="Memory Utilization (%)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'Memory %',
                        color: 'var(--mw-chart-5)',
                        values: charts.memory,
                      },
                    ]}
                    valueLabel="Memory %"
                  />
                </div>
              </Panel>

              <Panel
                title="Request Rate & Latency (1h)"
                description="API performance metrics"
                className="chart-panel"
              >
                <div className="chart-grid">
                  <LineChart
                    title="Request Rate (Req/s)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'Req/s',
                        color: 'var(--mw-chart-4)',
                        values: charts.requestRate,
                      },
                    ]}
                    valueLabel="Req/s"
                  />
                  <LineChart
                    title="P99 Latency (ms)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'P99 Latency (ms)',
                        color: 'var(--mw-chart-2)',
                        values: charts.latency,
                      },
                    ]}
                    valueLabel="Latency (ms)"
                  />
                </div>
              </Panel>

              <Panel
                title="Error Rate & Network (1h)"
                description="Error rate and network throughput"
                className="chart-panel"
              >
                <div className="chart-grid">
                  <LineChart
                    title="Error Rate (%)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'Error Rate %',
                        color: 'var(--mw-chart-2)',
                        values: charts.errorRate,
                      },
                    ]}
                    valueLabel="Error %"
                  />
                  <LineChart
                    title="Network Throughput (Mbps)"
                    labels={charts.labels}
                    series={[
                      {
                        label: 'Network In (Mbps)',
                        color: 'var(--mw-chart-3)',
                        values: charts.networkIn,
                      },
                      {
                        label: 'Network Out (Mbps)',
                        color: 'var(--mw-chart-1)',
                        values: charts.networkOut,
                      },
                    ]}
                    valueLabel="Mbps"
                  />
                </div>
              </Panel>

              <div className="metric-cards">
                <MetricTile
                  label="Avg CPU (1h)"
                  value={`${Math.round(summary.system.cpu)}%`}
                  detail="Fleet-wide average"
                  accent="cyan"
                  icon="📈"
                />
                <MetricTile
                  label="Avg Memory (1h)"
                  value={`${Math.round(summary.system.memory)}%`}
                  detail="Fleet-wide average"
                  accent="violet"
                  icon="🧠"
                />
                <MetricTile
                  label="P99 Latency (1h)"
                  value={`${Math.round(summary.system.latency)}ms`}
                  detail="Fleet-wide average"
                  accent="yellow"
                  icon="⚡"
                />
                <MetricTile
                  label="Error Rate (1h)"
                  value={`${(summary.system.errorRate * 100).toFixed(2)}%`}
                  detail="Fleet-wide average"
                  accent={summary.system.errorRate > 0.5 ? 'magenta' : 'green'}
                  icon="🚨"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <footer className="dashboard-footer">
        <p>
          MoonWitness Monitoring Dashboard • Data refreshes every 30s •{' '}
          <Link to="/guide/operations/monitoring">Documentation</Link>
        </p>
      </footer>
    </div>
  );
}

export default MonitoringDashboard;
