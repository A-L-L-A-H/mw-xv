'use client';

import { useState } from 'react';
import { SmartphoneIcon } from '@moonwitness/ui/icons';
import { Button } from '@moonwitness/ui/components/button';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { client } from '@/lib/client';
import { MessageComposer } from '@/components/whatsapp/message-composer';
import { PairingPanel } from '@/components/whatsapp/pairing-panel';
import { MessageActionDialogs } from '@/components/whatsapp/message-action-dialogs';
import { InboxList } from '@/components/whatsapp/inbox-list';
import { ConversationHeader } from '@/components/whatsapp/conversation-header';
import { ConversationTimeline } from '@/components/whatsapp/conversation-timeline';
import { useWhatsAppInbox } from '@/components/whatsapp/use-whatsapp-inbox';
import type { Message } from '@/components/whatsapp/types';

export function WhatsappPage() {
  const inboxPreferenceScope = `mw-whatsapp-inbox:${client.currentUser?.id ?? 'anonymous'}:${client.getCompanyId() ?? 'none'}`;
  return <WhatsappInbox key={inboxPreferenceScope} inboxPreferenceScope={inboxPreferenceScope} />;
}

function WhatsappInbox({ inboxPreferenceScope }: { inboxPreferenceScope: string }) {
  const inbox = useWhatsAppInbox(inboxPreferenceScope);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [reactingTo, setReactingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [revokingMessage, setRevokingMessage] = useState<Message | null>(null);

  const selectConversation = (conversationId: number | null) => {
    setReplyingTo(null);
    inbox.setSelected(conversationId);
  };

  const canManage = inbox.account?.permissions?.manage ?? false;
  const canCreateConversation = inbox.account?.permissions?.createConversation ?? false;
  const canManageConversations = inbox.account?.permissions?.manageConversations ?? canManage;
  const canSend = inbox.account?.permissions?.send ?? false;
  const canManageMessages = inbox.account?.permissions?.manageMessages ?? false;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-5 p-4 md:p-8">
      <Breadcrumbs items={[{ label: 'WhatsApp' }]} />
      <MessageActionDialogs
        connected={inbox.connected}
        activeConversationId={inbox.activeConversation?.id}
        forwardingMessage={forwardingMessage}
        onCloseForward={() => setForwardingMessage(null)}
        reactingTo={reactingTo}
        onCloseReact={() => setReactingTo(null)}
        editingMessage={editingMessage}
        editText={editText}
        onEditTextChange={setEditText}
        onCloseEdit={() => setEditingMessage(null)}
        revokingMessage={revokingMessage}
        onCloseRevoke={() => setRevokingMessage(null)}
      />
      {(inbox.accountQuery.isError ||
        (inbox.connected && (inbox.conversationsQuery.isError || inbox.messagesQuery.isError))) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-destructive p-3 text-sm text-destructive-foreground"
        >
          <p>
            {inbox.accountQuery.isError
              ? inbox.accountQuery.data
                ? 'Connection status could not be refreshed. Showing the last known status.'
                : 'WhatsApp connection status could not be loaded.'
              : 'WhatsApp data could not be refreshed.'}
            {inbox.accountQuery.isError
              ? ''
              : inbox.conversationsQuery.data && inbox.lastInboxSyncLabel
                ? ` Showing inbox data last updated at ${inbox.lastInboxSyncLabel}.`
                : ' No inbox data is available yet.'}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              inbox.accountQuery.isFetching ||
              inbox.conversationsQuery.isFetching ||
              inbox.messagesQuery.isFetching
            }
            onClick={inbox.retryWhatsAppData}
          >
            Retry
          </Button>
        </div>
      )}
      <PairingPanel
        account={inbox.account}
        status={inbox.status}
        connected={inbox.connected}
        canManage={canManage}
      />
      {inbox.connected && (
        <section className="grid min-h-[60vh] flex-1 overflow-hidden border-2 border-ink bg-paper shadow-[4px_4px_0_0_var(--ink)] md:grid-cols-[minmax(240px,0.38fr)_1fr]">
          <InboxList
            mobileConversationOpen={mobileConversationOpen}
            lastInboxSyncLabel={inbox.lastInboxSyncLabel}
            conversationSearch={inbox.conversationSearch}
            onConversationSearchChange={inbox.setConversationSearch}
            conversationFilter={inbox.inboxPreferences.conversationFilter}
            onConversationFilterChange={inbox.setConversationFilter}
            queueFilter={inbox.inboxPreferences.queueFilter}
            onQueueFilterChange={inbox.setQueueFilter}
            workStateFilter={inbox.inboxPreferences.workStateFilter}
            onWorkStateFilterChange={inbox.setWorkStateFilter}
            effectiveTeamId={inbox.effectiveTeamId}
            onTeamIdChange={inbox.setTeamId}
            effectiveSelectedLabelId={inbox.effectiveSelectedLabelId}
            selectedLabelId={inbox.inboxPreferences.selectedLabelId}
            onSelectedLabelIdChange={inbox.setSelectedLabelId}
            showArchived={inbox.inboxPreferences.showArchived}
            onShowArchivedChange={inbox.setShowArchived}
            agentsQuery={inbox.agentsQuery}
            labelsQuery={inbox.labelsQuery}
            conversationsQuery={inbox.conversationsQuery}
            conversationsQueryKey={inbox.conversationsQueryKey}
            filteredConversations={inbox.filteredConversations}
            activeConversationId={inbox.activeConversation?.id}
            canManageConversations={canManageConversations}
            canCreateConversation={canCreateConversation}
            loadingMoreConversations={inbox.loadingMoreConversations}
            onLoadMoreConversations={inbox.loadMoreConversations}
            onSelectConversation={(conversationId) => {
              selectConversation(conversationId);
              setMobileConversationOpen(true);
            }}
          />
          <div
            className={`${mobileConversationOpen ? 'flex' : 'hidden md:flex'} min-w-0 h-[70vh] min-h-[55vh] max-h-[calc(100dvh-8rem)] flex-col`}
          >
            <ConversationHeader
              connected={inbox.connected}
              activeConversation={inbox.activeConversation}
              conversationsQueryKey={inbox.conversationsQueryKey}
              contactProfileQuery={inbox.contactProfileQuery}
              groupProfileQuery={inbox.groupProfileQuery}
              agentsQuery={inbox.agentsQuery}
              labelsQuery={inbox.labelsQuery}
              messagesData={inbox.messagesQuery.data}
              canManageConversations={canManageConversations}
              canSend={canSend}
              onBackToList={() => setMobileConversationOpen(false)}
              onClearSelected={() => selectConversation(null)}
            />
            <ConversationTimeline
              activeConversation={inbox.activeConversation}
              messagesQuery={inbox.messagesQuery}
              messageList={inbox.messageList}
              newMessagesDividerIndex={inbox.newMessagesDividerIndex}
              hasOlderMessages={inbox.hasOlderMessages}
              loadingOlderMessages={inbox.loadingOlderMessages}
              onLoadOlderMessages={inbox.loadOlderMessages}
              onJumpToQuotedMessage={inbox.jumpToQuotedMessage}
              canSend={canSend}
              canManageMessages={canManageMessages}
              clockNow={inbox.clockNow}
              onReply={setReplyingTo}
              onReact={setReactingTo}
              onForward={setForwardingMessage}
              onEdit={(message) => {
                setEditText(message.content ?? '');
                setEditingMessage(message);
              }}
              onRevoke={setRevokingMessage}
            />
            {inbox.activeConversation && canSend ? (
              <MessageComposer
                key={inbox.activeConversation.id}
                conversationId={inbox.activeConversation.id}
                groupParticipants={
                  inbox.activeConversation.is_group && !inbox.groupProfileQuery.data?.stale
                    ? (inbox.groupProfileQuery.data?.participants ?? [])
                    : []
                }
                directUploads={inbox.account?.direct_uploads === true}
                replyTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                sendOnEnter={inbox.inboxPreferences.sendOnEnter}
                onSendOnEnterChange={inbox.setSendOnEnter}
              />
            ) : inbox.activeConversation ? (
              <p className="border-t-2 border-ink p-3 text-sm text-ink-faint">
                You have view-only access to WhatsApp messages.
              </p>
            ) : null}
          </div>
        </section>
      )}
      {!inbox.connected && inbox.status !== 'qr' && (
        <section className="border-2 border-ink bg-paper-raised p-8 text-center">
          <SmartphoneIcon className="mx-auto size-10" />
          <h2 className="mt-3 font-display text-xl uppercase">Connect a WhatsApp account</h2>
          <p className="mt-1 text-sm text-ink-faint">
            One WhatsApp account is available for this company.
          </p>
        </section>
      )}
    </main>
  );
}
