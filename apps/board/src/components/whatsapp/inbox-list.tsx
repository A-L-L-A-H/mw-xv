'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { UsersIcon } from '@moonwitness/ui/icons';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { GroupActionsPanel } from '@/components/whatsapp/group-actions-panel';
import type {
  Conversation,
  ConversationAgent,
  ConversationFilter,
  ConversationLabel,
  ConversationPage,
  ConversationTeam,
  QueueFilter,
  WorkStateFilter,
} from '@/components/whatsapp/types';

interface InboxListProps {
  mobileConversationOpen: boolean;
  lastInboxSyncLabel: string | null;
  conversationSearch: string;
  onConversationSearchChange: (value: string) => void;
  conversationFilter: ConversationFilter;
  onConversationFilterChange: (filter: ConversationFilter) => void;
  queueFilter: QueueFilter;
  onQueueFilterChange: (filter: QueueFilter) => void;
  workStateFilter: WorkStateFilter;
  onWorkStateFilterChange: (filter: WorkStateFilter) => void;
  effectiveTeamId: number | null;
  onTeamIdChange: (teamId: number | null) => void;
  effectiveSelectedLabelId: number | null;
  selectedLabelId: number | null;
  onSelectedLabelIdChange: (labelId: number | null) => void;
  showArchived: boolean;
  onShowArchivedChange: (showArchived: boolean) => void;
  agentsQuery: UseQueryResult<{ members: ConversationAgent[]; teams: ConversationTeam[] }>;
  labelsQuery: UseQueryResult<ConversationLabel[]>;
  conversationsQuery: UseQueryResult<ConversationPage>;
  conversationsQueryKey: QueryKey;
  filteredConversations: Conversation[];
  activeConversationId: number | undefined;
  canManageConversations: boolean;
  canCreateConversation: boolean;
  loadingMoreConversations: boolean;
  onLoadMoreConversations: () => Promise<void>;
  onSelectConversation: (conversationId: number) => void;
}

export function InboxList({
  mobileConversationOpen,
  lastInboxSyncLabel,
  conversationSearch,
  onConversationSearchChange,
  conversationFilter,
  onConversationFilterChange,
  queueFilter,
  onQueueFilterChange,
  workStateFilter,
  onWorkStateFilterChange,
  effectiveTeamId,
  onTeamIdChange,
  effectiveSelectedLabelId,
  selectedLabelId,
  onSelectedLabelIdChange,
  showArchived,
  onShowArchivedChange,
  agentsQuery,
  labelsQuery,
  conversationsQuery,
  conversationsQueryKey,
  filteredConversations,
  activeConversationId,
  canManageConversations,
  canCreateConversation,
  loadingMoreConversations,
  onLoadMoreConversations,
  onSelectConversation,
}: InboxListProps) {
  const queryClient = useQueryClient();
  const conversationSearchRef = useRef<HTMLInputElement>(null);
  const [newLabelName, setNewLabelName] = useState('');
  const [pendingLabelDeleteId, setPendingLabelDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const focusConversationSearch = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
      ) {
        return;
      }
      const searchInput = conversationSearchRef.current;
      if (!searchInput) return;
      event.preventDefault();
      searchInput.focus();
    };
    window.addEventListener('keydown', focusConversationSearch);
    return () => window.removeEventListener('keydown', focusConversationSearch);
  }, []);

  const createLabel = async (event: FormEvent) => {
    event.preventDefault();
    const name = newLabelName.trim();
    if (!name) return;
    try {
      await client.request('/whatsapp/labels', {
        method: 'POST',
        body: { name, color: '#f1d340' },
      });
      setNewLabelName('');
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp', 'labels']) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create label');
    }
  };

  const deleteLabel = async (label: ConversationLabel) => {
    try {
      await client.request(`/whatsapp/labels/${label.id}`, { method: 'DELETE' });
      setPendingLabelDeleteId(null);
      if (selectedLabelId === label.id) onSelectedLabelIdChange(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp', 'labels']) }),
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp', 'conversations']) }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete label');
    }
  };

  return (
    <aside
      aria-label="Conversation inbox"
      className={`${mobileConversationOpen ? 'hidden' : 'block'} border-b-2 border-ink md:block md:border-b-0 md:border-r-2`}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const current = target.closest<HTMLButtonElement>('[data-wa-conversation]');
        if (!current) return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-wa-conversation]')
        );
        const currentIndex = buttons.indexOf(current);
        if (currentIndex < 0 || buttons.length < 2) return;
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                buttons.length;
        event.preventDefault();
        buttons[nextIndex]?.focus();
      }}
    >
      <div className="border-b-2 border-ink p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg uppercase">Conversations</h2>
          {lastInboxSyncLabel && (
            <p role="status" className="font-mono text-[10px] text-ink-faint">
              Last synced {lastInboxSyncLabel}
            </p>
          )}
        </div>
        <Input
          ref={conversationSearchRef}
          aria-label="Search conversations by name, number, or message"
          aria-describedby="whatsapp-search-shortcut-help"
          aria-keyshortcuts="/"
          className="mt-3"
          placeholder="Search name, number, or message"
          value={conversationSearch}
          onChange={(event) => onConversationSearchChange(event.target.value)}
        />
        <p id="whatsapp-search-shortcut-help" className="mt-1 text-xs text-ink-faint">
          Press / to focus search. In the conversation list, use ↑/↓ to move and Home/End to jump.
        </p>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Conversation filters">
          {(['all', 'unread', 'private', 'groups'] as const).map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={conversationFilter === filter ? 'default' : 'outline'}
              aria-pressed={conversationFilter === filter}
              onClick={() => onConversationFilterChange(filter)}
            >
              {filter === 'all'
                ? 'All'
                : filter === 'unread'
                  ? 'Unread'
                  : filter === 'private'
                    ? 'Private'
                    : 'Groups'}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Agent queue filter">
          {(['all', 'mine', 'unassigned'] as const).map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={queueFilter === filter ? 'default' : 'outline'}
              aria-pressed={queueFilter === filter}
              onClick={() => onQueueFilterChange(filter)}
            >
              {filter === 'all' ? 'Queue: All' : filter === 'mine' ? 'Mine' : 'Unassigned'}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Conversation work state filter">
          {(['open', 'closed', 'all'] as const).map((state) => (
            <Button
              key={state}
              type="button"
              size="sm"
              variant={workStateFilter === state ? 'default' : 'outline'}
              aria-pressed={workStateFilter === state}
              onClick={() => onWorkStateFilterChange(state)}
            >
              {state === 'all' ? 'All states' : state === 'open' ? 'Open' : 'Closed'}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Team queue filter">
          <Button
            type="button"
            size="sm"
            variant={effectiveTeamId === null ? 'default' : 'outline'}
            aria-pressed={effectiveTeamId === null}
            onClick={() => onTeamIdChange(null)}
          >
            All teams
          </Button>
          {(agentsQuery.data?.teams ?? []).map((team) => (
            <Button
              key={team.id}
              type="button"
              size="sm"
              variant={effectiveTeamId === team.id ? 'default' : 'outline'}
              aria-pressed={effectiveTeamId === team.id}
              onClick={() => onTeamIdChange(team.id)}
            >
              {team.name}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Filter by conversation label">
          <Button
            type="button"
            size="sm"
            variant={effectiveSelectedLabelId === null ? 'default' : 'outline'}
            aria-pressed={effectiveSelectedLabelId === null}
            onClick={() => onSelectedLabelIdChange(null)}
          >
            All labels
          </Button>
          {(labelsQuery.data ?? []).map((label) => (
            <div key={label.id} className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={effectiveSelectedLabelId === label.id ? 'default' : 'outline'}
                aria-pressed={effectiveSelectedLabelId === label.id}
                onClick={() => onSelectedLabelIdChange(label.id)}
                style={{ borderColor: label.color }}
              >
                {label.name}
              </Button>
              {canManageConversations &&
                (pendingLabelDeleteId === label.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    <span>Delete?</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Confirm delete label ${label.name}`}
                      onClick={() => void deleteLabel(label)}
                    >
                      Yes
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Cancel label deletion"
                      onClick={() => setPendingLabelDeleteId(null)}
                    >
                      No
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete label ${label.name}`}
                    onClick={() => setPendingLabelDeleteId(label.id)}
                  >
                    ×
                  </Button>
                ))}
            </div>
          ))}
        </div>
        {labelsQuery.isError && (
          <div className="mt-2 flex items-center gap-2 text-xs" role="alert">
            <span>Conversation labels could not be loaded.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={labelsQuery.isFetching}
              onClick={() => void labelsQuery.refetch()}
            >
              Retry labels
            </Button>
          </div>
        )}
        {canManageConversations && (
          <form onSubmit={createLabel} className="mt-2 flex gap-2">
            <Input
              aria-label="New conversation label"
              placeholder="New label"
              maxLength={40}
              value={newLabelName}
              onChange={(event) => setNewLabelName(event.target.value)}
            />
            <Button type="submit" disabled={!newLabelName.trim()}>
              Add label
            </Button>
          </form>
        )}
        <div className="mt-2 flex gap-2" aria-label="Archive filter">
          <Button
            type="button"
            size="sm"
            variant={!showArchived ? 'default' : 'outline'}
            aria-pressed={!showArchived}
            onClick={() => onShowArchivedChange(false)}
          >
            Active
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showArchived ? 'default' : 'outline'}
            aria-pressed={showArchived}
            onClick={() => onShowArchivedChange(true)}
          >
            Archived
          </Button>
        </div>
        {canCreateConversation && (
          <GroupActionsPanel
            conversationsQueryKey={conversationsQueryKey}
            onSelectConversation={onSelectConversation}
          />
        )}
      </div>
      {conversationsQuery.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : conversationsQuery.isError && !conversationsQuery.data ? (
        <div className="space-y-3 p-4" role="alert">
          <p className="text-sm">Conversations could not be loaded.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={conversationsQuery.isFetching}
            onClick={() => void conversationsQuery.refetch()}
          >
            Retry inbox
          </Button>
        </div>
      ) : filteredConversations.length ? (
        filteredConversations.map((conversation) => (
          <Button
            key={conversation.id}
            type="button"
            data-wa-conversation
            onClick={() => onSelectConversation(conversation.id)}
            variant="ghost"
            className={`h-auto w-full justify-start border-b border-ink/20 p-4 text-left hover:bg-magenta/20 ${activeConversationId === conversation.id ? 'bg-magenta/30' : ''}`}
          >
            <span className="flex items-center gap-2 font-semibold">
              {conversation.is_group && <UsersIcon className="size-4" />}
              {conversation.name}
              {conversation.is_pinned && <span className="text-xs">Pinned</span>}
              {conversation.unread_count > 0 && (
                <span className="ml-auto rounded-full bg-magenta px-2 text-xs text-on-magenta">
                  {conversation.unread_count}
                </span>
              )}
            </span>
            <span
              className={`truncate text-sm ${activeConversationId === conversation.id ? 'text-ink' : 'text-ink-faint'}`}
            >
              {conversation.last_message}
            </span>
            {conversation.labels?.length ? (
              <span className="flex flex-wrap gap-1" aria-label="Conversation labels">
                {conversation.labels.map((label) => (
                  <span
                    key={label.id}
                    className="rounded border px-1.5 py-0.5 text-[10px]"
                    style={{ borderColor: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </span>
            ) : null}
            {(conversation.assigned_user_name ||
              conversation.assigned_team_name ||
              conversation.work_state === 'closed') && (
              <span className="flex flex-wrap gap-2 text-[10px] text-ink">
                {conversation.assigned_user_name && (
                  <span>Assigned to {conversation.assigned_user_name}</span>
                )}
                {conversation.assigned_team_name && (
                  <span>Team {conversation.assigned_team_name}</span>
                )}
                {conversation.work_state === 'closed' && <span>Closed</span>}
              </span>
            )}
          </Button>
        ))
      ) : (
        <p className="p-4 text-sm text-ink-faint">
          {conversationsQuery.data?.items.length
            ? 'No conversations match this search or filter.'
            : 'No conversations yet. Start a chat using the phone number above, or wait for an incoming message.'}
        </p>
      )}
      {conversationsQuery.data?.hasMore && (
        <Button
          type="button"
          variant="link"
          className="mx-auto my-2"
          disabled={loadingMoreConversations}
          onClick={() => void onLoadMoreConversations()}
        >
          {loadingMoreConversations ? 'Loading conversations…' : 'Load more conversations'}
        </Button>
      )}
    </aside>
  );
}
