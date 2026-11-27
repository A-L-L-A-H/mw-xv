'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { RefreshIcon, CheckIcon } from '@moonwitness/ui/icons';
import {
  computeCockpitStatusBadge,
  formatCockpitCurrency,
  type BusinessCockpitMetrics,
  type BusinessIncident,
} from './business-cockpit-helpers';

const INITIAL_METRICS: BusinessCockpitMetrics = {
  mrrMinor: 185000000,
  activeSubscribers: 850,
  paasTenants: 28,
  dunningOverdueCount: 14,
  paymentSuccessRatePercent: 98.7,
  coaDispatchHealthPercent: 99.4,
};

const INITIAL_INCIDENTS: readonly BusinessIncident[] = [
  {
    id: 'inc-01',
    domain: 'isp',
    severity: 'low',
    title: 'MikroTik Tower 3 CoA Latency',
    description: 'ACK latency elevated to 420ms; failover pool ready.',
    timestamp: '2026-11-27T06:30:00Z',
  },
  {
    id: 'inc-02',
    domain: 'payment',
    severity: 'low',
    title: 'Midtrans Webhook Retry Coalesced',
    description: '3 duplicate settlement events deduplicated via idempotency key.',
    timestamp: '2026-11-27T07:15:00Z',
  },
];

export function BusinessCockpitPage() {
  const [metrics, setMetrics] = useState<BusinessCockpitMetrics>(INITIAL_METRICS);
  const [incidents] = useState<readonly BusinessIncident[]>(INITIAL_INCIDENTS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const statusBadge = useMemo(() => computeCockpitStatusBadge(metrics), [metrics]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setMetrics((prev) => ({
        ...prev,
        paymentSuccessRatePercent: Math.min(100, prev.paymentSuccessRatePercent + 0.1),
      }));
      setIsRefreshing(false);
    }, 400);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <PageHeader
          title="Business Operations Cockpit"
          description="Sovereign ISP & PaaS billing, progressive dunning, revenue ledger, and fleet health telemetry."
        />
        <div className="flex items-center gap-2">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshIcon className="h-4 w-4" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="Monthly Recurring Revenue (MRR)"
          value={formatCockpitCurrency(metrics.mrrMinor)}
        />
        <MetricTile
          label="Active ISP Subscribers"
          value={metrics.activeSubscribers.toLocaleString('id-ID')}
        />
        <MetricTile
          label="Active PaaS Tenants"
          value={metrics.paasTenants.toString()}
        />
        <MetricTile
          label="Dunning Overdue Invoices"
          value={metrics.dunningOverdueCount.toString()}
        />
        <MetricTile
          label="Payment Gateway Success Rate"
          value={`${metrics.paymentSuccessRatePercent.toFixed(1)}%`}
        />
        <MetricTile
          label="CoA Realtime ACK Health"
          value={`${metrics.coaDispatchHealthPercent.toFixed(1)}%`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Active Subsystem Telemetry">
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm font-medium">ISP Progressive Dunning Engine</span>
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <CheckIcon className="h-4 w-4" />
                <span>Running (7 stages active)</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm font-medium">Payment Webhook Integrations</span>
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <CheckIcon className="h-4 w-4" />
                <span>Midtrans, Xendit, Tripay, Duitku</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm font-medium">Sharia Mizan Ledger & Zakat</span>
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <CheckIcon className="h-4 w-4" />
                <span>Balanced Double-Entry (2.5% Zakat Mal)</span>
              </div>
            </div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-sm font-medium">PaaS Multi-Tenant Quota Enforcement</span>
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <CheckIcon className="h-4 w-4" />
                <span>Dynamic Mesh Sync</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Recent Operational Events">
          <div className="space-y-3 pt-2">
            {incidents.map((inc) => (
              <div key={inc.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{inc.title}</span>
                  <Badge variant="cyan" className="text-xs uppercase">
                    {inc.domain}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{inc.description}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
