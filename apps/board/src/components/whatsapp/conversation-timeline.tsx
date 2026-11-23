'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { MenuIcon } from '@moonwitness/ui/icons';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@moonwitness/ui/components/dropdown-menu';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { formatDateTime } from '@/lib/date-format';
import { MediaPreview } from '@/components/whatsapp/media-preview';
import {
  messageFallbackLabel,
  messageStatusLabel,
  safeMediaDownloadName,
  summarizeReactions,
  type Conversation,
  type Message,
} from '@/components/whatsapp/types';

interface ConversationTimelineProps {
  activeConversation: Conversation | undefined;
  messagesQuery: UseQueryResult<Message[]>;
  messageList: Message[];
  newMessagesDividerIndex: number;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => Promise<void>;
  onJumpToQuotedMessage: (message: Message) => Promise<void>;
  canSend: boolean;
  canManageMessages: boolean;
  clockNow: number;
  onReply: (message: Message) => void;
  onReact: (message: Message) => void;
  onForward: (message: Message) => void;
  onEdit: (message: Message) => void;
  onRevoke: (message: Message) => void;
}

export function ConversationTimeline({
  activeConversation,
  messagesQuery,
  messageList,
  newMessagesDividerIndex,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  onJumpToQuotedMessage,
  canSend,
  canManageMessages,
  clockNow,
  onReply,
  onReact,
  onForward,
  onEdit,
  onRevoke,
}: ConversationTimelineProps) {
  const queryClient = useQueryClient();
  const activeConversationIdRef = useRef<number | undefined>(undefined);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const latestMessageRef = useRef<{
    conversationId: number | undefined;
    messageId: number | undefined;
  }>({
    conversationId: undefined,
    messageId: undefined,
  });
  const isNearLatestRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id;
  }, [activeConversation?.id]);

  const latestMessageId = messagesQuery.data?.[0]?.id;
  useEffect(() => {
    const conversationId = activeConversation?.id;
    const previous = latestMessageRef.current;
    if (previous.conversationId !== conversationId) {
      latestMessageRef.current = { conversationId, messageId: latestMessageId };
      isNearLatestRef.current = true;
      setHasNewMessages(false);
      if (conversationId !== undefined) {
        window.requestAnimationFrame(() => {
          if (activeConversationIdRef.current === conversationId && messageContainerRef.current) {
            messageContainerRef.current.scrollTop = 0;
          }
        });
      }
      return;
    }
    if (latestMessageId === undefined || latestMessageId === previous.messageId) return;
    latestMessageRef.current.messageId = latestMessageId;
    if (isNearLatestRef.current) {
      messageContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setHasNewMessages(true);
    }
  }, [activeConversation?.id, latestMessageId]);

  return (
    <>
      {hasOlderMessages && (
        <Button
          type="button"
          variant="link"
          className="mx-auto"
          disabled={loadingOlderMessages}
          onClick={() => void onLoadOlderMessages()}
        >
          {loadingOlderMessages ? 'Loading older messages…' : 'Load older messages'}
        </Button>
      )}
      {hasNewMessages && (
        <Button
          type="button"
          size="sm"
          className="mx-auto"
          onClick={() => {
            isNearLatestRef.current = true;
            setHasNewMessages(false);
            messageContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          New messages · Jump to latest
        </Button>
      )}
      <div
        ref={messageContainerRef}
        className="min-h-0 flex flex-1 flex-col-reverse gap-3 overflow-y-auto p-4"
        onScroll={(event) => {
          const nearLatest = event.currentTarget.scrollTop >= -48;
          isNearLatestRef.current = nearLatest;
          if (nearLatest) {
            if (hasNewMessages) setHasNewMessages(false);
          } else {
            void onLoadOlderMessages();
          }
        }}
      >
        {!activeConversation && (
          <p role="status" className="m-auto max-w-sm text-center text-sm text-ink-faint">
            Select a conversation to view its messages.
          </p>
        )}
        {activeConversation && messagesQuery.isLoading && !messagesQuery.data && (
          <div aria-label="Loading messages" className="mt-auto space-y-3">
            <Skeleton className="h-14 w-3/4" />
            <Skeleton className="ml-auto h-14 w-2/3" />
            <Skeleton className="h-14 w-1/2" />
          </div>
        )}
        {messagesQuery.isError && !messagesQuery.data && (
          <div
            className="space-y-3 border-2 border-ink bg-destructive p-3 text-destructive-foreground"
            role="alert"
          >
            <p className="text-sm">Messages could not be loaded.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={messagesQuery.isFetching}
              onClick={() => void messagesQuery.refetch()}
            >
              Retry messages
            </Button>
          </div>
        )}
        {activeConversation &&
          !messagesQuery.isLoading &&
          !messagesQuery.isError &&
          messageList.length === 0 && (
            <p role="status" className="m-auto max-w-sm text-center text-sm text-ink-faint">
              No messages in this conversation yet. Send a message to start the conversation.
            </p>
          )}
        {messagesQuery.isError && messagesQuery.data && (
          <p role="status" className="border border-ink/40 p-2 text-xs text-ink-faint">
            Showing cached messages. Refresh failed; retrying automatically.
          </p>
        )}
        {messageList.map((message, index) => {
          const canCopy = Boolean(message.content && !message.is_deleted && !message.provider_type);
          const canReply = Boolean(
            canSend &&
            !message.is_deleted &&
            !message.provider_type &&
            !['queued', 'sending', 'unknown'].includes(message.status)
          );
          const canReact = Boolean(
            canSend &&
            !message.is_deleted &&
            !message.provider_type &&
            ['received', 'sent', 'delivered', 'read'].includes(message.status)
          );
          const canForward = Boolean(
            canSend &&
            !message.is_deleted &&
            !message.provider_type &&
            ['received', 'sent', 'delivered', 'read'].includes(message.status)
          );
          const canEdit = Boolean(
            canManageMessages &&
            message.direction === 'outbound' &&
            !message.is_deleted &&
            !message.provider_type &&
            ['sent', 'delivered', 'read'].includes(message.status) &&
            message.message_type === 'text' &&
            clockNow > 0 &&
            clockNow - Date.parse(message.create_date) >= 0 &&
            clockNow - Date.parse(message.create_date) <= 15 * 60_000
          );
          const canDelete = Boolean(
            canManageMessages &&
            message.direction === 'outbound' &&
            !message.is_deleted &&
            !message.provider_type &&
            ['sent', 'delivered', 'read'].includes(message.status)
          );
          const hasActions = canCopy || canReply || canReact || canForward || canEdit || canDelete;

          return (
            <div key={message.id} className="contents">
              {(activeConversation?.unread_count ?? 0) > 0 && index === newMessagesDividerIndex && (
                <div
                  role="separator"
                  aria-label="New messages"
                  className="w-full border-y border-ink/40 py-1 text-center text-xs font-semibold text-ink-faint"
                >
                  New messages
                </div>
              )}
              <article
                id={`whatsapp-message-${message.id}`}
                tabIndex={-1}
                className={`group relative max-w-[85%] border-2 border-ink p-3 ${hasActions ? 'pr-11' : ''} ${message.direction === 'outbound' ? 'ml-auto bg-magenta/30' : 'mr-auto bg-paper-raised'}`}
              >
                {activeConversation?.is_group &&
                  !message.provider_type?.startsWith('group_event_') && (
                    <p
                      className={`mb-1 font-mono text-[10px] ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'}`}
                    >
                      {message.direction === 'outbound'
                        ? 'You'
                        : message.sender_display_name?.trim() ||
                          message.sender_jid?.split('@')[0]?.split(':')[0] ||
                          'Group participant'}
                    </p>
                  )}
                <p
                  className={`whitespace-pre-wrap break-words text-sm ${message.is_deleted || message.provider_type ? `italic ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'}` : ''}`}
                >
                  {message.is_deleted
                    ? 'This message was deleted'
                    : message.provider_type?.startsWith('group_event_')
                      ? message.content || messageFallbackLabel(message.provider_type)
                      : message.provider_type
                        ? messageFallbackLabel(message.provider_type)
                        : message.content}
                </p>
                {message.is_edited && !message.is_deleted && (
                  <span
                    className={`ml-2 text-[10px] italic ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'}`}
                  >
                    Edited
                  </span>
                )}
                {message.is_forwarded && (
                  <p
                    className={`mb-1 font-mono text-[10px] italic ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'}`}
                  >
                    Forwarded
                  </p>
                )}
                {message.reply_to && (
                  <Button
                    type="button"
                    variant="link"
                    className={`mb-2 block h-auto w-full border-l-2 border-magenta pl-2 text-left text-xs ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'} hover:text-ink`}
                    onClick={() => void onJumpToQuotedMessage(message)}
                    aria-label="Jump to quoted message"
                  >
                    {message.reply_to.unavailable
                      ? 'Quoted message unavailable'
                      : message.reply_to.content ||
                        messageFallbackLabel(message.reply_to.provider_type) ||
                        `[${message.reply_to.message_type || 'media'}]`}
                  </Button>
                )}
                {!message.is_deleted &&
                !message.provider_type &&
                message.media_scan_status === 'infected' ? (
                  <p role="status" className="mt-2 text-xs text-warning">
                    Attachment blocked by malware scan. It was removed and cannot be downloaded.
                  </p>
                ) : (
                  !message.is_deleted &&
                  !message.provider_type &&
                  message.message_type !== 'text' && <MediaPreview message={message} />
                )}
                {!message.provider_type &&
                  message.media_scan_status !== 'infected' &&
                  message.media_file_name && (
                    <p className="mt-1 text-xs">
                      {safeMediaDownloadName(message.media_file_name).name}
                    </p>
                  )}
                {summarizeReactions(message.reactions).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1" aria-label="Message reactions">
                    {summarizeReactions(message.reactions).map((reaction) => (
                      <span
                        key={reaction.emoji}
                        role="img"
                        aria-label={`${reaction.emoji} reaction, ${reaction.count}${reaction.includesMe ? ', includes yours' : ''}`}
                        className={`border border-ink/50 px-2 py-0.5 text-xs ${reaction.includesMe ? 'bg-magenta/40' : 'bg-paper'}`}
                      >
                        {reaction.emoji} {reaction.count}
                      </span>
                    ))}
                  </div>
                )}
                {hasActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Message actions"
                        className="absolute right-1.5 top-1.5 z-10"
                      >
                        <MenuIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canCopy && (
                        <DropdownMenuItem
                          onSelect={async () => {
                            try {
                              await navigator.clipboard.writeText(message.content ?? '');
                              toast.success('Message copied');
                            } catch {
                              toast.error('Could not copy message text');
                            }
                          }}
                        >
                          Copy message
                        </DropdownMenuItem>
                      )}
                      {canReply && (
                        <DropdownMenuItem onSelect={() => onReply(message)}>
                          Reply to message
                        </DropdownMenuItem>
                      )}
                      {canReact && (
                        <DropdownMenuItem onSelect={() => onReact(message)}>
                          React to message
                        </DropdownMenuItem>
                      )}
                      {canForward && (
                        <DropdownMenuItem onSelect={() => onForward(message)}>
                          Forward message
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem onSelect={() => onEdit(message)}>
                          Edit message
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <DropdownMenuItem variant="destructive" onSelect={() => onRevoke(message)}>
                          Delete message for everyone
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <p
                  className={`mt-2 flex flex-wrap justify-end gap-x-2 text-right font-mono text-[10px] ${message.direction === 'outbound' ? 'text-ink' : 'text-ink-faint'}`}
                >
                  <time
                    dateTime={message.create_date}
                    aria-label={`Message time: ${formatDateTime(message.create_date, 'dateTime')}`}
                  >
                    {formatDateTime(message.create_date, 'dateTime')}
                  </time>
                  <span>{messageStatusLabel[message.status] ?? 'Status unavailable'}</span>
                </p>
                {message.last_error && (
                  <p role="status" className="mt-1 text-xs text-[color:var(--mw-error)] ">
                    {message.last_error}
                  </p>
                )}
                {message.status === 'failed' && message.retryable && (
                  <Button
                    type="button"
                    variant="link"
                    className="mt-1 h-auto p-0 text-xs underline"
                    onClick={async () => {
                      try {
                        await client.request(`/whatsapp/messages/${message.id}/retry`, {
                          method: 'POST',
                        });
                        await queryClient.invalidateQueries({
                          queryKey: scopedQueryKey(['whatsapp']),
                        });
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : 'Retry could not be queued'
                        );
                      }
                    }}
                  >
                    Retry send
                  </Button>
                )}
              </article>
            </div>
          );
        })}
        {(activeConversation?.unread_count ?? 0) > 0 &&
          newMessagesDividerIndex === messageList.length && (
            <div
              role="separator"
              aria-label="New messages"
              className="w-full border-y border-ink/40 py-1 text-center text-xs font-semibold text-ink-faint"
            >
              New messages
            </div>
          )}
      </div>
    </>
  );
}
