import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, InboxIcon, NotificationIcon } from '@moonwitness/ui/icons';
import { Button } from '@moonwitness/ui/components/button';
import { useAuth } from '@/hooks/use-auth-context';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { Popover, PopoverContent, PopoverTrigger } from '@moonwitness/ui/components/popover';

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="notification-inbox-btn"
          variant="outline"
          size="icon"
          className="relative"
          aria-label={
            inboxUnavailable
              ? 'Notifications, count unavailable'
              : `Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`
          }
          title="Notifications"
        >
          <NotificationIcon className="size-4" />
          {unreadCount !== undefined && unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center border-2 border-ink bg-magenta font-mono text-[9px] font-bold text-on-magenta"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b-2 border-ink p-3">
          <div>
            <h2 className="font-display text-sm uppercase tracking-wide">Notifications</h2>
            <p className="font-mono text-[10px] text-ink-soft">
              {inboxUnavailable
                ? 'Inbox unavailable'
                : `${unreadCount ?? 0} unread${inbox.isError ? ' · last loaded data' : ' · in-app inbox'}`}
            </p>
          </div>
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
        <div className="max-h-[min(65vh,28rem)] overflow-y-auto">
          {inbox.isLoading && !inbox.data ? (
            <p className="p-5 text-center text-xs text-ink-soft">Loading inbox…</p>
          ) : inbox.isError && !inbox.data ? (
            <div role="alert" className="space-y-2 p-5 text-center text-xs text-destructive">
              <p>Notifications could not be loaded.</p>
              <Button size="xs" variant="outline" onClick={() => void inbox.refetch()}>
                Retry
              </Button>
            </div>
          ) : inbox.data?.notifications.length ? (
            <>
              {inbox.isError && (
                <p role="status" className="border-b border-ink/20 p-3 text-xs text-ink-soft">
                  Showing the last loaded inbox; refresh is unavailable.
                </p>
              )}
              <ul className="divide-y divide-ink/20">
                {inbox.data.notifications.map((notification) => (
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
                          <CheckIcon className="size-3" /> Mark read
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : inbox.data ? (
            <div className="p-7 text-center">
              <InboxIcon className="mx-auto size-6 text-ink-faint" aria-hidden="true" />
              <p className="mt-2 font-display text-sm uppercase">You’re all caught up</p>
              <p className="mt-1 text-xs text-ink-soft">New in-app messages will appear here.</p>
            </div>
          ) : null}
        </div>
        {markRead.isError && (
          <p role="alert" className="border-t border-ink/20 p-3 text-xs text-destructive">
            This notification could not be marked as read. Try again.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
