'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CompanyIcon as Building2,
  CheckIcon as CheckCircle2,
  UserIcon as UserPlus,
  UsersIcon as Users,
} from '@moonwitness/ui/icons';
import { Button } from '@moonwitness/ui/components/button';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

interface DashboardKpiGridProps {
  accessibleModels: ReadonlySet<string>;
}

export function DashboardKpiGrid({ accessibleModels }: DashboardKpiGridProps) {
  const canReadPartners = accessibleModels.has('base.partner');
  const canReadUsers = accessibleModels.has('base.user');
  const canReadCompanies = accessibleModels.has('base.company');
  const canReadActivities = accessibleModels.has('base.activity');

  const {
    data: partnerStats,
    isError: partnerError,
    isFetching: partnerFetching,
    refetch: refetchPartners,
  } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.partner']),
    queryFn: () => client.model('base.partner').searchRead({ count: true, limit: 1 }),
    enabled: canReadPartners,
  });

  const {
    data: userStats,
    isError: userError,
    isFetching: userFetching,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.user']),
    queryFn: () =>
      client.model('base.user').searchRead({
        domain: [['active', '=', true]],
        count: true,
        limit: 1,
      }),
    enabled: canReadUsers,
  });

  const {
    data: companyStats,
    isError: companyError,
    isFetching: companyFetching,
    refetch: refetchCompanies,
  } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.company']),
    queryFn: () => client.model('base.company').searchRead({ count: true, limit: 1 }),
    enabled: canReadCompanies,
  });

  const {
    data: activityStats,
    isError: activityError,
    isFetching: activityFetching,
    refetch: refetchActivities,
  } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.activity']),
    queryFn: () =>
      client.model('base.activity').searchRead({
        domain: [['state', '=', 'planned']],
        count: true,
        limit: 1,
      }),
    enabled: canReadActivities,
  });

  if (!canReadPartners && !canReadUsers && !canReadCompanies && !canReadActivities) {
    return null;
  }

  const retryFailedKpis = () => {
    if (partnerError) void refetchPartners();
    if (userError) void refetchUsers();
    if (companyError) void refetchCompanies();
    if (activityError) void refetchActivities();
  };
  const retryingKpis =
    (partnerError && partnerFetching) ||
    (userError && userFetching) ||
    (companyError && companyFetching) ||
    (activityError && activityFetching);

  return (
    <div className="space-y-3">
      {partnerError || userError || companyError || activityError ? (
        <EmptyState
          role="alert"
          title="Dashboard metrics unavailable"
          description="One or more KPI reads failed. Unavailable totals are not shown as zero."
          action={
            <Button variant="outline" disabled={retryingKpis} onClick={retryFailedKpis}>
              {retryingKpis ? 'Retrying…' : 'Retry failed metrics'}
            </Button>
          }
        />
      ) : null}
      <div className="dashboard-metrics">
        {canReadPartners && (
          <Link href="/board/m/base.partner" className="dashboard-metric-link">
            <MetricTile
              label="Partners & contacts"
              value={partnerStats && !partnerError ? partnerStats.total : '—'}
              detail={partnerError ? 'Read failed' : 'View directory'}
              icon={<Users className="size-4" />}
              accent="magenta"
              surface="paper"
              frame="torn"
              size="hero"
              interactive
              className="mw-ui-interactive-surface"
            />
          </Link>
        )}

        {canReadUsers && (
          <Link href="/board/m/base.user" className="dashboard-metric-link">
            <MetricTile
              label="Active users"
              value={userStats && !userError ? userStats.total : '—'}
              detail={userError ? 'Read failed' : 'System accounts'}
              icon={<UserPlus className="size-4" />}
              accent="cyan"
              surface="paper"
              frame="torn"
              size="hero"
              interactive
              className="mw-ui-interactive-surface"
            />
          </Link>
        )}

        {canReadCompanies && (
          <Link href="/board/m/base.company" className="dashboard-metric-link">
            <MetricTile
              label="Companies"
              value={companyStats && !companyError ? companyStats.total : '—'}
              detail={companyError ? 'Read failed' : 'Tenant scopes'}
              icon={<Building2 className="size-4" />}
              accent="yellow"
              surface="paper"
              frame="torn"
              size="hero"
              interactive
              className="mw-ui-interactive-surface"
            />
          </Link>
        )}

        {canReadActivities && (
          <Link href="/board/m/base.activity" className="dashboard-metric-link">
            <MetricTile
              label="Planned activities"
              value={activityStats && !activityError ? activityStats.total : '—'}
              detail={activityError ? 'Read failed' : 'Active reminders'}
              icon={<CheckCircle2 className="size-4" />}
              accent="violet"
              surface="paper"
              frame="torn"
              size="hero"
              interactive
              className="mw-ui-interactive-surface"
            />
          </Link>
        )}
      </div>
    </div>
  );
}
