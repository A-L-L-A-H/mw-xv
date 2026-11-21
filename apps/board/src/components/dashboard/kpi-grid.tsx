'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CompanyIcon as Building2,
  CheckIcon as CheckCircle2,
  UserIcon as UserPlus,
  UsersIcon as Users,
} from '@moonwitness/ui/icons';
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

  const { data: partnerStats, isLoading: partnerLoading } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.partner']),
    queryFn: () => client.model('base.partner').searchRead({ count: true, limit: 1 }),
    enabled: canReadPartners,
  });

  const { data: userStats, isLoading: userLoading } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.user']),
    queryFn: () =>
      client.model('base.user').searchRead({
        domain: [['active', '=', true]],
        count: true,
        limit: 1,
      }),
    enabled: canReadUsers,
  });

  const { data: companyStats, isLoading: companyLoading } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'base.company']),
    queryFn: () => client.model('base.company').searchRead({ count: true, limit: 1 }),
    enabled: canReadCompanies,
  });

  const { data: activityStats, isLoading: activityLoading } = useQuery({
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

  return (
    <div className="dashboard-metrics">
      {canReadPartners && (
        <Link href="/board/m/base.partner" className="dashboard-metric-link">
          <MetricTile
            label="Partners & contacts"
            value={partnerLoading ? '—' : (partnerStats?.total ?? 0)}
            detail="View directory"
            icon={<Users className="size-4" />}
            accent="magenta"
            surface="paper"
            frame="torn"
            className="mw-ui-interactive-surface"
          />
        </Link>
      )}

      {canReadUsers && (
        <Link href="/board/m/base.user" className="dashboard-metric-link">
          <MetricTile
            label="Active users"
            value={userLoading ? '—' : (userStats?.total ?? 0)}
            detail="System accounts"
            icon={<UserPlus className="size-4" />}
            accent="cyan"
            surface="paper"
            frame="torn"
            className="mw-ui-interactive-surface"
          />
        </Link>
      )}

      {canReadCompanies && (
        <Link href="/board/m/base.company" className="dashboard-metric-link">
          <MetricTile
            label="Companies"
            value={companyLoading ? '—' : (companyStats?.total ?? 0)}
            detail="Tenant scopes"
            icon={<Building2 className="size-4" />}
            accent="yellow"
            surface="paper"
            frame="torn"
            className="mw-ui-interactive-surface"
          />
        </Link>
      )}

      {canReadActivities && (
        <Link href="/board/m/base.activity" className="dashboard-metric-link">
          <MetricTile
            label="Planned activities"
            value={activityLoading ? '—' : (activityStats?.total ?? 0)}
            detail="Active reminders"
            icon={<CheckCircle2 className="size-4" />}
            accent="violet"
            surface="paper"
            frame="torn"
            className="mw-ui-interactive-surface"
          />
        </Link>
      )}
    </div>
  );
}
