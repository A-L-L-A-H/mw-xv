'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import { Input } from '@moonwitness/ui/components/input';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { useModalFocus } from '@moonwitness/ui/lib/use-modal-focus';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import {
  reactionEmojis,
  type Conversation,
  type ConversationPage,
  type Message,
} from '@/components/whatsapp/types';

interface MessageActionDialogsProps {
  connected: boolean;
  activeConversationId: number | undefined;
  forwardingMessage: Message | null;
  onCloseForward: () => void;
  reactingTo: Message | null;
  onCloseReact: () => void;
  editingMessage: Message | null;
  editText: string;
  onEditTextChange: (value: string) => void;
  onCloseEdit: () => void;
  revokingMessage: Message | null;
  onCloseRevoke: () => void;
}

export function MessageActionDialogs({
  connected,
  activeConversationId,
  forwardingMessage,
  onCloseForward,
  reactingTo,
  onCloseReact,
  editingMessage,
  editText,
  onEditTextChange,
  onCloseEdit,
  revokingMessage,
  onCloseRevoke,
}: MessageActionDialogsProps) {
  const queryClient = useQueryClient();
  const forwardDialogRef = useModalFocus<HTMLElement>(onCloseForward);
  const reactionDialogRef = useModalFocus<HTMLElement>(onCloseReact);
  const editDialogRef = useModalFocus<HTMLElement>(onCloseEdit);
  const revokeDialogRef = useModalFocus<HTMLElement>(onCloseRevoke);
  const [forwardConversationSearch, setForwardConversationSearch] = useState('');
  const [debouncedForwardConversationSearch, setDebouncedForwardConversationSearch] = useState('');
  const [forwardShowArchived, setForwardShowArchived] = useState(false);
  const [loadingMoreForwardDestinations, setLoadingMoreForwardDestinations] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [updatingMessage, setUpdatingMessage] = useState(false);
  const forwardIdempotencyKey = useRef<{
    sourceId: number;
    destinationId: number;
    key: string;
  } | null>(null);

  useEffect(() => {
    if (!forwardingMessage) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setForwardConversationSearch('');
      setDebouncedForwardConversationSearch('');
      setForwardShowArchived(false);
    });
    return () => {
      cancelled = true;
    };
  }, [forwardingMessage]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedForwardConversationSearch(forwardConversationSearch.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [forwardConversationSearch]);

  const forwardDestinationsQueryKey = scopedQueryKey([
    'whatsapp',
    'forward-destinations',
    debouncedForwardConversationSearch,
    forwardShowArchived,
  ]);
  const forwardDestinationsQuery = useQuery({
    queryKey: forwardDestinationsQueryKey,
    queryFn: async () => {
      const page = (
        await client.request<{ data: Conversation[] }>(
          `/whatsapp/conversations?limit=50&offset=0&archived=${forwardShowArchived}&unread=false${debouncedForwardConversationSearch ? `&search=${encodeURIComponent(debouncedForwardConversationSearch)}` : ''}`
        )
      ).data;
      return {
        items: page,
        nextOffset: page.length,
        hasMore: page.length === 50,
      } satisfies ConversationPage;
    },
    enabled: Boolean(forwardingMessage) && connected,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });

  const loadMoreForwardDestinations = async () => {
    const current = queryClient.getQueryData<ConversationPage>(forwardDestinationsQueryKey);
    if (!current?.hasMore || loadingMoreForwardDestinations) return;
    setLoadingMoreForwardDestinations(true);
    try {
      const page = (
        await client.request<{ data: Conversation[] }>(
          `/whatsapp/conversations?limit=50&offset=${current.nextOffset}&archived=${forwardShowArchived}&unread=false${debouncedForwardConversationSearch ? `&search=${encodeURIComponent(debouncedForwardConversationSearch)}` : ''}`
        )
      ).data;
      queryClient.setQueryData<ConversationPage>(forwardDestinationsQueryKey, (latest) => {
        const latestPage = latest ?? current;
        const ids = new Set(latestPage.items.map((conversation) => conversation.id));
        const uniquePage = page.filter((conversation) => !ids.has(conversation.id));
        return {
          items: [...latestPage.items, ...uniquePage],
          nextOffset: current.nextOffset + page.length,
          hasMore: page.length === 50,
        };
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load more destinations');
    } finally {
      setLoadingMoreForwardDestinations(false);
    }
  };

  const forwardTo = async (destination: Conversation) => {
    if (!forwardingMessage || forwarding) return;
    if (
      forwardIdempotencyKey.current?.sourceId !== forwardingMessage.id ||
      forwardIdempotencyKey.current?.destinationId !== destination.id
    ) {
      forwardIdempotencyKey.current = {
        sourceId: forwardingMessage.id,
        destinationId: destination.id,
        key: crypto.randomUUID(),
      };
    }
    setForwarding(true);
    try {
      await client.request(`/whatsapp/messages/${forwardingMessage.id}/forward`, {
        method: 'POST',
        headers: { 'Idempotency-Key': forwardIdempotencyKey.current.key },
        body: { conversation_id: destination.id },
      });
      forwardIdempotencyKey.current = null;
      onCloseForward();
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success('Forward queued');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Message could not be forwarded');
    } finally {
      setForwarding(false);
    }
  };

  const reactToMessage = async (message: Message, emoji: string) => {
    if (reacting) return;
    setReacting(true);
    try {
      await client.request(`/whatsapp/messages/${message.id}/reaction`, {
        method: 'POST',
        body: { emoji },
      });
      onCloseReact();
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'messages', activeConversationId]),
      });
      toast.success('Reaction sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send reaction');
    } finally {
      setReacting(false);
    }
  };

  const editMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingMessage || updatingMessage) return;
    setUpdatingMessage(true);
    try {
      await client.request(`/whatsapp/messages/${editingMessage.id}/edit`, {
        method: 'POST',
        body: { content: editText },
      });
      onCloseEdit();
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success('Message edited');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not edit message');
    } finally {
      setUpdatingMessage(false);
    }
  };

  const revokeMessage = async () => {
    if (!revokingMessage || updatingMessage) return;
    setUpdatingMessage(true);
    try {
      await client.request(`/whatsapp/messages/${revokingMessage.id}/revoke`, { method: 'POST' });
      onCloseRevoke();
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
      toast.success('Message deleted for everyone');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete message');
    } finally {
      setUpdatingMessage(false);
    }
  };

  return (
    <>
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <section
            ref={forwardDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsapp-forward-title"
            tabIndex={-1}
            className="w-full max-w-md border-2 border-ink bg-cream p-5 shadow-[6px_6px_0_var(--mw-ink-black)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="whatsapp-forward-title" className="font-display text-xl uppercase">
                  Forward message
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-faint">
                  {forwardingMessage.content || `[${forwardingMessage.message_type}]`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={forwarding}
                onClick={onCloseForward}
              >
                Cancel
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              <Input
                aria-label="Search forward destinations"
                placeholder="Search chats and groups"
                value={forwardConversationSearch}
                onChange={(event) => setForwardConversationSearch(event.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={forwardShowArchived}
                  onChange={(event) => setForwardShowArchived(event.target.checked)}
                  aria-label="Include archived conversations"
                />
                Include archived conversations
              </label>
              {forwardDestinationsQuery.isError && (
                <div role="alert" className="flex items-center justify-between gap-3 text-sm">
                  <span>Destinations could not be loaded.</span>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => void forwardDestinationsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <div className="max-h-72 space-y-2 overflow-y-auto" aria-label="Forward destinations">
                {(forwardDestinationsQuery.data?.items ?? []).map((conversation) => (
                  <Button
                    key={conversation.id}
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left"
                    disabled={forwarding}
                    aria-label={`Forward to ${conversation.name}`}
                    onClick={() => void forwardTo(conversation)}
                  >
                    {conversation.name}
                    {conversation.is_group ? ' · Group' : ''}
                  </Button>
                ))}
                {forwardDestinationsQuery.isLoading && <Skeleton className="h-10 w-full" />}
                {!forwardDestinationsQuery.isLoading &&
                  !forwardDestinationsQuery.data?.items.length && (
                    <p className="p-3 text-sm text-ink-faint">No matching conversations.</p>
                  )}
                {forwardDestinationsQuery.data?.hasMore && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={loadingMoreForwardDestinations}
                    onClick={() => void loadMoreForwardDestinations()}
                  >
                    {loadingMoreForwardDestinations ? 'Loading…' : 'Load more destinations'}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      {reactingTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <section
            ref={reactionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsapp-reaction-title"
            tabIndex={-1}
            className="w-full max-w-sm border-2 border-ink bg-cream p-5 shadow-[6px_6px_0_var(--mw-ink-black)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="whatsapp-reaction-title" className="font-display text-xl uppercase">
                  React to message
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-faint">
                  {reactingTo.content || `[${reactingTo.message_type}]`}
                </p>
              </div>
              <Button type="button" variant="outline" disabled={reacting} onClick={onCloseReact}>
                Cancel
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Choose a reaction">
              {reactionEmojis.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  variant="outline"
                  className="min-w-11 text-xl"
                  aria-label={`React with ${emoji}`}
                  disabled={reacting}
                  onClick={() => void reactToMessage(reactingTo, emoji)}
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </section>
        </div>
      )}
      {editingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <form
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsapp-edit-title"
            tabIndex={-1}
            onSubmit={(event) => void editMessage(event)}
            className="w-full max-w-lg border-2 border-ink bg-cream p-5 shadow-[6px_6px_0_var(--mw-ink-black)]"
          >
            <h2 id="whatsapp-edit-title" className="font-display text-xl uppercase">
              Edit message
            </h2>
            <Textarea
              aria-label="Edited message text"
              value={editText}
              onChange={(event) => onEditTextChange(event.target.value)}
              maxLength={8000}
              required
              autoFocus
            />
            <p className="mt-2 text-xs text-ink-faint">
              WhatsApp only allows editing recent text messages, usually within 15 minutes.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={updatingMessage}
                onClick={onCloseEdit}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updatingMessage || !editText.trim()}>
                {updatingMessage ? 'Saving…' : 'Save edit'}
              </Button>
            </div>
          </form>
        </div>
      )}
      {revokingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <section
            ref={revokeDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="whatsapp-revoke-title"
            tabIndex={-1}
            className="w-full max-w-md border-2 border-ink bg-cream p-5 shadow-[6px_6px_0_var(--mw-ink-black)]"
          >
            <h2 id="whatsapp-revoke-title" className="font-display text-xl uppercase">
              Delete for everyone?
            </h2>
            <p className="mt-2 text-sm">
              WhatsApp will try to remove this message for everyone in the conversation.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={updatingMessage}
                onClick={onCloseRevoke}
              >
                Cancel
              </Button>
              <Button type="button" disabled={updatingMessage} onClick={() => void revokeMessage()}>
                {updatingMessage ? 'Deleting…' : 'Delete message'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
