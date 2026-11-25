import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, InboxIcon } from '@moonwitness/ui/icons';
import { Button } from '@moonwitness/ui/components/button';
import { LoadingSpinner } from '@moonwitness/ui/components/effects';
import { InboxPopover } from '@moonwitness/ui/components/inbox-popover';
import { useAuth } from '@/hooks/use-auth-context';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

interface InboxNotification {
  id: number;
  title: string;
  body: string;
  state: 'unread' | 'read' | 'archived';
  resource_model?: string;
  resource_id?: number;
  delivered_at?: string;
}

interface InboxResponse {
  success: boolean;
  data: { notifications: InboxNotification[]; unreadCount: number };
}

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = scopedQueryKey(['notification_inbox', user?.id]);
  const inbox = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await client.request<InboxResponse>('/notifications/inbox?limit=20');
      return response.data;
    },
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (id: number) => client.request(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const unreadCount = inbox.data?.unreadCount;
  const inboxUnavailable = inbox.isError && !inbox.data;
  const notifications = inbox.data?.notifications ?? [];

  const errorMessage = inbox.isError
    ? inbox.data
      ? 'Showing the last loaded inbox; refresh is unavailable.'
      : 'Notifications could not be loaded.'
    : undefined;

  return (
    <InboxPopover
      open={open}
      onOpenChange={setOpen}
      triggerId="notification-inbox-btn"
      triggerLabel={
        inboxUnavailable
          ? 'Notifications, count unavailable'
          : `Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`
      }
      triggerTitle="Notifications"
      unreadCount={unreadCount}
      unavailable={inboxUnavailable}
      title="Notifications"
      subtitle={
        inboxUnavailable
          ? 'Inbox unavailable'
          : `${unreadCount ?? 0} unread${inbox.isError ? ' · last loaded data' : ' · in-app inbox'}`
      }
      loading={inbox.isLoading && !inbox.data}
      loadingLabel="Loading inbox…"
      error={errorMessage}
      onRetry={() => void inbox.refetch()}
      isEmpty={Boolean(inbox.data && notifications.length === 0)}
      emptyTitle="You’re all caught up"
      emptyDescription="New in-app messages will appear here."
      headerAction={
        <div className="flex items-center gap-1.5">
          {inbox.isFetching ? <LoadingSpinner className="size-3.5 text-ink-soft" /> : null}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setOpen(false);
              router.push('/board/m/notification.notification');
            }}
          >
            View all
          </Button>
        </div>
      }
      footer={
        markRead.isError ? (
          <p role="alert" className="text-xs text-destructive">
            This notification could not be marked as read. Try again.
          </p>
        ) : undefined
      }
    >
      {notifications.length > 0 ? (
        <ul className="divide-y divide-ink/20">
          {notifications.map((notification) => (
            <li key={notification.id} className="flex gap-3 p-3">
              <span className="mt-1 shrink-0 text-ink-soft">
                <InboxIcon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{notification.title}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-ink-soft">
                  {notification.body}
                </p>
                {notification.state === 'unread' && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="mt-2"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(notification.id)}
                  >
                    {markRead.isPending ? <LoadingSpinner /> : <CheckIcon className="size-3" />}{' '}
                    Mark read
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : undefined}
    </InboxPopover>
  );
}
