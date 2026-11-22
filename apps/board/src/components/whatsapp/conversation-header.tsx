'use client';

import { useState, type FormEvent } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { formatDateTime } from '@/lib/date-format';
import { ContactProfileSummary, GroupProfileSummary } from '@/components/whatsapp/profile-drawers';
import {
  formatConversationAddress,
  type ContactProfile,
  type Conversation,
  type ConversationAgent,
  type ConversationLabel,
  type ConversationPage,
  type ConversationTeam,
  type GroupProfile,
  type InternalNote,
  type Message,
} from '@/components/whatsapp/types';

interface ConversationHeaderProps {
  connected: boolean;
  activeConversation: Conversation | undefined;
  conversationsQueryKey: QueryKey;
  contactProfileQuery: UseQueryResult<ContactProfile>;
  groupProfileQuery: UseQueryResult<GroupProfile>;
  agentsQuery: UseQueryResult<{ members: ConversationAgent[]; teams: ConversationTeam[] }>;
  labelsQuery: UseQueryResult<ConversationLabel[]>;
  messagesData: Message[] | undefined;
  canManageConversations: boolean;
  canSend: boolean;
  onBackToList: () => void;
  onClearSelected: () => void;
}

export function ConversationHeader({
  connected,
  activeConversation,
  conversationsQueryKey,
  contactProfileQuery,
  groupProfileQuery,
  agentsQuery,
  labelsQuery,
  messagesData,
  canManageConversations,
  canSend,
  onBackToList,
  onClearSelected,
}: ConversationHeaderProps) {
  const queryClient = useQueryClient();
  const [assignmentPanelOpen, setAssignmentPanelOpen] = useState(false);
  const [updatingConversation, setUpdatingConversation] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);

  const notesQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'notes', activeConversation?.id]),
    queryFn: async () =>
      (
        await client.request<{ data: InternalNote[] }>(
          `/whatsapp/conversations/${activeConversation!.id}/notes?limit=50&offset=0`
        )
      ).data,
    enabled: notesOpen && connected && Boolean(activeConversation),
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });

  const markConversationRead = async () => {
    if (!activeConversation || markingRead) return;
    setMarkingRead(true);
    try {
      await client.request(`/whatsapp/conversations/${activeConversation.id}/read`, {
        method: 'POST',
      });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success('Latest message marked as read');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark conversation as read');
    } finally {
      setMarkingRead(false);
    }
  };

  const addInternalNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeConversation || creatingNote || !noteDraft.trim()) return;
    setCreatingNote(true);
    try {
      await client.request(`/whatsapp/conversations/${activeConversation.id}/notes`, {
        method: 'POST',
        body: { content: noteDraft.trim() },
      });
      setNoteDraft('');
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'notes', activeConversation.id]),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Internal note could not be saved');
    } finally {
      setCreatingNote(false);
    }
  };

  const updateConversationArchive = async () => {
    if (!activeConversation || updatingConversation) return;
    setUpdatingConversation(true);
    try {
      const archived = !activeConversation.is_archived;
      await client.request(`/whatsapp/conversations/${activeConversation.id}/archive`, {
        method: 'POST',
        body: { archived },
      });
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== activeConversation.id),
            }
          : current
      );
      onClearSelected();
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success(
        activeConversation.is_archived ? 'Conversation unarchived' : 'Conversation archived'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update archive state');
    } finally {
      setUpdatingConversation(false);
    }
  };

  const updateConversationPin = async () => {
    if (!activeConversation || updatingConversation) return;
    setUpdatingConversation(true);
    try {
      const pinned = !activeConversation.is_pinned;
      await client.request(`/whatsapp/conversations/${activeConversation.id}/pin`, {
        method: 'POST',
        body: { pinned },
      });
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === activeConversation.id ? { ...item, is_pinned: pinned } : item
              ),
            }
          : current
      );
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success(activeConversation.is_pinned ? 'Conversation unpinned' : 'Conversation pinned');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update pin state');
    } finally {
      setUpdatingConversation(false);
    }
  };

  const toggleConversationLabel = async (labelId: number) => {
    if (!activeConversation || updatingConversation) return;
    const current = activeConversation.labels ?? [];
    const labelIds = current.some((label) => label.id === labelId)
      ? current.filter((label) => label.id !== labelId).map((label) => label.id)
      : [...current.map((label) => label.id), labelId];
    setUpdatingConversation(true);
    try {
      await client.request(`/whatsapp/conversations/${activeConversation.id}/labels`, {
        method: 'PUT',
        body: { label_ids: labelIds },
      });
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update conversation labels');
    } finally {
      setUpdatingConversation(false);
    }
  };

  const updateConversationAssignment = async (
    assignedUserId: number | null,
    assignedTeamId: number | null
  ) => {
    if (!activeConversation || updatingConversation) return;
    setUpdatingConversation(true);
    try {
      await client.request(`/whatsapp/conversations/${activeConversation.id}/assignment`, {
        method: 'PUT',
        body: { assigned_user_id: assignedUserId, assigned_team_id: assignedTeamId },
      });
      setAssignmentPanelOpen(false);
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update assignment');
    } finally {
      setUpdatingConversation(false);
    }
  };

  const updateConversationWorkState = async () => {
    if (!activeConversation || updatingConversation) return;
    const workState = activeConversation.work_state === 'closed' ? 'open' : 'closed';
    setUpdatingConversation(true);
    try {
      await client.request(`/whatsapp/conversations/${activeConversation.id}/state`, {
        method: 'PUT',
        body: { work_state: workState },
      });
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update conversation state');
    } finally {
      setUpdatingConversation(false);
    }
  };

  return (
    <>
      <div className="border-b-2 border-ink p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex w-full min-w-0 flex-col items-start gap-2 md:w-auto md:flex-row md:items-center">
            {activeConversation && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 md:hidden"
                onClick={onBackToList}
              >
                Back to conversations
              </Button>
            )}
            <div className="w-full min-w-0 md:w-auto">
              <h2 className="font-display text-lg uppercase">
                {activeConversation?.name ?? 'Select a conversation'}
              </h2>
              {activeConversation && (
                <p className="break-all text-xs text-ink-faint">
                  {formatConversationAddress(activeConversation)}
                </p>
              )}
              {activeConversation && !activeConversation.is_group && (
                <ContactProfileSummary
                  conversationId={activeConversation.id}
                  profile={contactProfileQuery.data}
                  loading={contactProfileQuery.isLoading}
                  failed={contactProfileQuery.isError}
                  refreshing={contactProfileQuery.isFetching}
                  onRefresh={() => void contactProfileQuery.refetch()}
                />
              )}
              {activeConversation?.is_group && (
                <GroupProfileSummary
                  conversationId={activeConversation.id}
                  profile={groupProfileQuery.data}
                  loading={groupProfileQuery.isLoading}
                  failed={groupProfileQuery.isError}
                  refreshing={groupProfileQuery.isFetching}
                  canManage={canManageConversations}
                  onLeft={() => {
                    onClearSelected();
                    onBackToList();
                  }}
                  onRefresh={async () => {
                    const refreshed = await groupProfileQuery.refetch();
                    if (refreshed.isSuccess && refreshed.data?.left) return 'left';
                    return refreshed.isSuccess &&
                      refreshed.data?.stale === false &&
                      refreshed.data.pending_operation !== true
                      ? 'fresh'
                      : false;
                  }}
                />
              )}
            </div>
          </div>
          {activeConversation && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={notesOpen ? 'default' : 'outline'}
                aria-expanded={notesOpen}
                aria-controls="whatsapp-internal-notes"
                onClick={() => setNotesOpen((open) => !open)}
              >
                Internal notes ({notesQuery.data?.length ?? 0})
              </Button>
              {canManageConversations && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={assignmentPanelOpen ? 'default' : 'outline'}
                    aria-expanded={assignmentPanelOpen}
                    aria-controls="whatsapp-assignment-panel"
                    onClick={() => setAssignmentPanelOpen((open) => !open)}
                  >
                    Assign chat
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updatingConversation}
                    onClick={() => void updateConversationWorkState()}
                  >
                    {activeConversation.work_state === 'closed' ? 'Reopen chat' : 'Close chat'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updatingConversation}
                    onClick={() => void updateConversationPin()}
                  >
                    {activeConversation.is_pinned ? 'Unpin chat' : 'Pin chat'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updatingConversation}
                    onClick={() => void updateConversationArchive()}
                  >
                    {activeConversation.is_archived ? 'Unarchive chat' : 'Archive chat'}
                  </Button>
                </>
              )}
            </div>
          )}
          {activeConversation && assignmentPanelOpen && canManageConversations && (
            <section
              id="whatsapp-assignment-panel"
              className="w-full border border-ink/30 p-3"
              aria-label="Assign conversation"
            >
              <p className="mb-2 text-xs text-ink-faint">
                {activeConversation.assigned_user_name
                  ? `Assigned to ${activeConversation.assigned_user_name}`
                  : activeConversation.assigned_team_name
                    ? `Queued for ${activeConversation.assigned_team_name}`
                    : 'No agent or team assigned'}
              </p>
              {agentsQuery.isLoading ? (
                <p role="status" className="text-sm">
                  Loading agents…
                </p>
              ) : agentsQuery.isError ? (
                <div role="alert" className="flex items-center gap-2 text-sm">
                  <span>Agents could not be loaded.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={agentsQuery.isFetching}
                    onClick={() => void agentsQuery.refetch()}
                  >
                    Retry agents
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2" aria-label="Assign to agent">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updatingConversation}
                      onClick={() => void updateConversationAssignment(null, null)}
                    >
                      Unassign
                    </Button>
                    {(agentsQuery.data?.members ?? []).map((agent) => {
                      const teamIdForAgent =
                        activeConversation.assigned_team_id &&
                        agent.team_id === activeConversation.assigned_team_id
                          ? activeConversation.assigned_team_id
                          : null;
                      return (
                        <Button
                          key={agent.id}
                          type="button"
                          size="sm"
                          variant={
                            activeConversation.assigned_user_id === agent.id ? 'default' : 'outline'
                          }
                          aria-pressed={activeConversation.assigned_user_id === agent.id}
                          disabled={updatingConversation}
                          onClick={() =>
                            void updateConversationAssignment(agent.id, teamIdForAgent)
                          }
                        >
                          Assign to {agent.id === client.currentUser?.id ? 'you' : agent.login}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2" aria-label="Assign to team">
                    {(agentsQuery.data?.teams ?? []).map((team) => {
                      const assignedAgent = agentsQuery.data?.members.find(
                        (agent) => agent.id === activeConversation.assigned_user_id
                      );
                      const userIdForTeam =
                        assignedAgent?.team_id === team.id ? assignedAgent.id : null;
                      return (
                        <Button
                          key={team.id}
                          type="button"
                          size="sm"
                          variant={
                            activeConversation.assigned_team_id === team.id ? 'default' : 'outline'
                          }
                          aria-pressed={activeConversation.assigned_team_id === team.id}
                          disabled={updatingConversation}
                          onClick={() => void updateConversationAssignment(userIdForTeam, team.id)}
                        >
                          Assign to team {team.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
          {activeConversation && canManageConversations && (labelsQuery.data ?? []).length > 0 && (
            <div
              className="flex w-full flex-wrap items-center gap-2"
              aria-label="Conversation labels"
            >
              <span className="text-xs text-ink-faint">Labels</span>
              {labelsQuery.data!.map((label) => {
                const assigned =
                  activeConversation.labels?.some((item) => item.id === label.id) ?? false;
                return (
                  <Button
                    key={label.id}
                    type="button"
                    size="sm"
                    variant={assigned ? 'default' : 'outline'}
                    aria-pressed={assigned}
                    disabled={
                      updatingConversation ||
                      (!assigned && (activeConversation.labels?.length ?? 0) >= 20)
                    }
                    style={{ borderColor: label.color }}
                    onClick={() => void toggleConversationLabel(label.id)}
                  >
                    {assigned ? `Remove ${label.name}` : `Add ${label.name}`}
                  </Button>
                );
              })}
            </div>
          )}
          {activeConversation &&
            canSend &&
            messagesData?.some((message) => message.direction === 'inbound') && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={markingRead}
                onClick={() => void markConversationRead()}
              >
                {markingRead ? 'Marking read…' : 'Mark latest as read'}
              </Button>
            )}
        </div>
        {activeConversation?.is_group && (
          <span className="text-xs text-ink-faint">Group conversation</span>
        )}
      </div>
      {notesOpen && activeConversation && (
        <section
          id="whatsapp-internal-notes"
          aria-label="Internal notes"
          className="border-b-2 border-l-4 border-ink bg-paper p-3"
          style={{ borderLeftColor: 'var(--mw-yellow)' }}
        >
          <h3 className="font-display text-sm uppercase">Internal notes · team only</h3>
          {notesQuery.isLoading ? (
            <div className="mt-2 space-y-2" aria-label="Loading internal notes">
              <Skeleton className="h-12" />
            </div>
          ) : notesQuery.isError ? (
            <div className="mt-2 flex items-center gap-3" role="alert">
              <p className="text-sm">Internal notes could not be loaded.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={notesQuery.isFetching}
                onClick={() => void notesQuery.refetch()}
              >
                Retry notes
              </Button>
            </div>
          ) : notesQuery.data?.length ? (
            <ol className="mt-2 max-h-40 space-y-2 overflow-y-auto" aria-live="polite">
              {notesQuery.data.map((note) => (
                <li key={note.id} className="border border-ink/40 bg-paper p-2 text-sm">
                  <p className="whitespace-pre-wrap break-words">{note.body}</p>
                  <p className="mt-1 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-ink-faint">
                    <span>{note.author_name || `User ${note.user_id}`}</span>
                    <time dateTime={note.create_date}>
                      {formatDateTime(note.create_date, 'dateTime')}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-ink-faint">No internal notes yet.</p>
          )}
          {canManageConversations ? (
            <form onSubmit={addInternalNote} className="mt-2 flex flex-col gap-2">
              <Textarea
                aria-label="Internal note"
                placeholder="Write a note for your team…"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                maxLength={4000}
                rows={2}
                disabled={creatingNote}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-ink-faint">
                  {noteDraft.length}/4000
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creatingNote || !noteDraft.trim() || noteDraft.length > 4000}
                >
                  {creatingNote ? 'Saving note…' : 'Add internal note'}
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">You can view notes but cannot add one.</p>
          )}
        </section>
      )}
    </>
  );
}
