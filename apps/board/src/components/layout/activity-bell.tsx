import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClockIcon,
  CalendarIcon,
  CheckIcon,
  CheckSquareIcon,
  ExternalLinkIcon,
  MailIcon,
  PhoneIcon,
} from '@moonwitness/ui/icons';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { useAuth } from '@/hooks/use-auth-context';
import { Button } from '@moonwitness/ui/components/button';
import { LoadingSpinner } from '@moonwitness/ui/components/effects';
import { InboxPopover } from '@moonwitness/ui/components/inbox-popover';
import { cn } from '@/lib/utils';

export interface ActivityRecord {
  id: number;
  summary: string;
  activity_type: 'todo' | 'call' | 'meeting' | 'email';
  state: 'planned' | 'done' | 'cancelled';
  deadline?: string;
  note?: string;
  assigned_to_id?: number;
  resource_model: string;
  resource_id: number;
}

export function ActivityBell() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [todayStr, setTodayStr] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const timer = window.setInterval(
      () => setTodayStr(new Date().toISOString().slice(0, 10)),
      60_000
    );
    return () => window.clearInterval(timer);
  }, []);

  const activitiesQuery = useQuery<ActivityRecord[]>({
    queryKey: scopedQueryKey(['activities_bell', user?.id]),
    queryFn: async () => {
      const res = await client.model<ActivityRecord>('base.activity').searchRead({
        domain: [['state', '=', 'planned']],
        order: 'deadline asc, id desc',
        limit: 30,
      });
      return res.records;
    },
    refetchInterval: 30000,
  });

  const markDoneMutation = useMutation({
    mutationFn: async (activityId: number) => {
      await client.model('base.activity').write(activityId, { state: 'done' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities_bell'] });
      queryClient.invalidateQueries({ queryKey: ['kpi'] });
      queryClient.invalidateQueries({ queryKey: ['records', 'base.activity'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  const activities = activitiesQuery.data ?? [];
  const overdue = activities.filter((a) => a.deadline && a.deadline < todayStr);
  const dueToday = activities.filter((a) => a.deadline === todayStr);
  const upcoming = activities.filter((a) => !a.deadline || a.deadline > todayStr);

  const displayedList =
    activeTab === 'overdue'
      ? overdue
      : activeTab === 'today'
        ? dueToday
        : activeTab === 'upcoming'
          ? upcoming
          : activities;

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call':
        return <PhoneIcon className="size-3.5 text-yellow-readable" />;
      case 'meeting':
        return <CalendarIcon className="size-3.5 text-magenta-readable" />;
      case 'email':
        return <MailIcon className="size-3.5 text-yellow-readable" />;
      default:
        return <CheckSquareIcon className="size-3.5 text-ink-faint" />;
    }
  };

  const handleOpenRecord = (resourceModel: string, resourceId: number) => {
    setOpen(false);
    router.push(`/board/m/${resourceModel}/${resourceId}`);
  };

  const bellCount = overdue.length > 0 ? overdue.length : activities.length;
  const activitiesUnavailable = activitiesQuery.isError && !activitiesQuery.data;

  return (
    <InboxPopover
      open={open}
      onOpenChange={setOpen}
      triggerId="activity-bell-btn"
      triggerLabel="Pending activities"
      triggerTitle="Pending activities"
      triggerIcon={<CalendarClockIcon className="size-4" />}
      unreadCount={bellCount > 0 ? bellCount : undefined}
      unavailable={activitiesUnavailable}
      title="Activities"
      subtitle={
        activitiesUnavailable
          ? 'Reminders unavailable'
          : `${activities.length} planned · ${todayStr}`
      }
      loading={activitiesQuery.isLoading && !activitiesQuery.data}
      loadingLabel="Loading reminders..."
      error={
        activitiesQuery.isError
          ? activitiesQuery.data
            ? 'Showing the last loaded reminders; refresh is unavailable.'
            : 'Pending activities could not be loaded.'
          : undefined
      }
      onRetry={() => void activitiesQuery.refetch()}
      isEmpty={Boolean(activitiesQuery.data && activities.length === 0)}
      emptyTitle="No pending activities"
      emptyDescription="Scheduled follow-ups and reminders will appear here."
      emptyIcon={<CalendarClockIcon className="size-6" />}
      headerAction={
        activitiesQuery.isFetching ? <LoadingSpinner className="size-3.5 text-ink-soft" /> : null
      }
      footer={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setOpen(false);
            router.push('/board/m/base.activity');
          }}
          className="w-full font-mono text-xs text-ink-soft hover:bg-primary hover:text-primary-foreground"
        >
          View All Activities Table →
        </Button>
      }
    >
      {activitiesQuery.data && activities.length > 0 ? (
        <>
          <div className="flex border-b-2 border-ink bg-paper text-[11px] font-mono">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setActiveTab('all')}
              className={cn(
                'flex-1 rounded-none border-0 py-1.5 text-center font-bold shadow-none',
                activeTab === 'all' ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              All ({activities.length})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setActiveTab('overdue')}
              className={cn(
                'flex-1 rounded-none border-0 py-1.5 text-center font-bold shadow-none',
                activeTab === 'overdue'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              Overdue ({overdue.length})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setActiveTab('today')}
              className={cn(
                'flex-1 rounded-none border-0 py-1.5 text-center font-bold shadow-none',
                activeTab === 'today'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              Today ({dueToday.length})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setActiveTab('upcoming')}
              className={cn(
                'flex-1 rounded-none border-0 py-1.5 text-center font-bold shadow-none',
                activeTab === 'upcoming'
                  ? 'border-b-2 border-primary font-black text-ink bg-paper-raised'
                  : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              Later ({upcoming.length})
            </Button>
          </div>
          <div className="divide-y divide-ink/15 bg-paper-raised">
            {displayedList.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-ink-faint">
                No pending activities in this view.
              </div>
            ) : (
              displayedList.map((act) => {
                const isOverdue = act.deadline && act.deadline < todayStr;
                const isToday = act.deadline === todayStr;

                return (
                  <div
                    key={act.id}
                    className="group flex items-start justify-between gap-3 p-3 transition-colors hover:bg-paper"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-0 flex-1 flex-col items-start justify-start gap-0 p-0 text-left font-normal normal-case hover:bg-transparent"
                      onClick={() => handleOpenRecord(act.resource_model, act.resource_id)}
                    >
                      <span className="mb-1 flex w-full items-center gap-1.5">
                        {getActivityIcon(act.activity_type)}
                        <span className="line-clamp-1 font-display text-xs uppercase tracking-wide text-ink transition-colors group-hover:text-yellow-readable">
                          {act.summary}
                        </span>
                      </span>

                      <span className="flex items-center gap-2 font-mono text-[10px]">
                        <span className="text-ink-faint">
                          {act.resource_model} #{act.resource_id}
                        </span>
                        {act.deadline && (
                          <span
                            className={cn(
                              'border px-1 py-0.2 font-bold uppercase',
                              isOverdue
                                ? 'border-destructive bg-destructive/15 text-destructive'
                                : isToday
                                  ? 'border-primary bg-primary/20 text-yellow-readable'
                                  : 'border-ink/20 text-ink-faint'
                            )}
                          >
                            {act.deadline}
                          </span>
                        )}
                      </span>
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-xs"
                        title="Mark as Done"
                        disabled={markDoneMutation.isPending}
                        onClick={() => markDoneMutation.mutate(act.id)}
                        className="size-6 hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      >
                        {markDoneMutation.isPending ? (
                          <LoadingSpinner className="size-3" />
                        ) : (
                          <CheckIcon className="size-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Open Record"
                        onClick={() => handleOpenRecord(act.resource_model, act.resource_id)}
                        className="size-6 text-ink-faint hover:text-ink"
                      >
                        <ExternalLinkIcon className="size-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : undefined}
    </InboxPopover>
  );
}
