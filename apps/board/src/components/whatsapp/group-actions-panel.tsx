'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '@moonwitness/client';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import type { Conversation, ConversationPage } from '@/components/whatsapp/types';

interface GroupActionsPanelProps {
  conversationsQueryKey: QueryKey;
  onSelectConversation: (conversationId: number) => void;
}

export function GroupActionsPanel({
  conversationsQueryKey,
  onSelectConversation,
}: GroupActionsPanelProps) {
  const queryClient = useQueryClient();
  const [newPhone, setNewPhone] = useState('');
  const [phoneCheck, setPhoneCheck] = useState<{
    phone: string;
    is_on_whatsapp: boolean;
  } | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupParticipantDraft, setGroupParticipantDraft] = useState('');
  const [groupParticipants, setGroupParticipants] = useState<string[]>([]);
  const [groupPendingRequest, setGroupPendingRequest] = useState<{
    key: string;
    title: string;
    participants: string[];
  } | null>(null);
  const [groupCreationError, setGroupCreationError] = useState<string | null>(null);
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupRetrying, setGroupRetrying] = useState(false);

  const [groupJoinOpen, setGroupJoinOpen] = useState(false);
  const [groupInviteDraft, setGroupInviteDraft] = useState('');
  const [groupInvitePreview, setGroupInvitePreview] = useState<{
    name: string;
    topic: string | null;
    participant_count: number | null;
  } | null>(null);
  const [groupJoinError, setGroupJoinError] = useState<string | null>(null);
  const [groupJoinPending, setGroupJoinPending] = useState<{ key: string; link: string } | null>(
    null
  );
  const [groupJoining, setGroupJoining] = useState(false);
  const [confirmGroupJoin, setConfirmGroupJoin] = useState(false);

  const checkPhone = async () => {
    if (checkingPhone) return;
    setCheckingPhone(true);
    setPhoneCheck(null);
    try {
      const response = await client.request<{
        data: { phone: string; is_on_whatsapp: boolean };
      }>('/whatsapp/contacts/check', { method: 'POST', body: { phone: newPhone } });
      setPhoneCheck(response.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not check this number');
    } finally {
      setCheckingPhone(false);
    }
  };

  const startChat = async (event: FormEvent) => {
    event.preventDefault();
    if (startingChat) return;
    const phone = newPhone.replace(/[\s().-]/gu, '').replace(/^\+/u, '');
    if (phoneCheck?.phone !== `+${phone}` || !phoneCheck.is_on_whatsapp) {
      toast.error('Check that this number is on WhatsApp before starting a chat');
      return;
    }
    setStartingChat(true);
    try {
      const response = await client.request<{ data: Conversation }>('/whatsapp/conversations', {
        method: 'POST',
        body: { phone: `+${phone}` },
      });
      setNewPhone('');
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (current) => ({
        items: [
          response.data,
          ...(current?.items ?? []).filter((conversation) => conversation.id !== response.data.id),
        ],
        nextOffset: current?.nextOffset ?? 0,
        hasMore: current?.hasMore ?? false,
      }));
      onSelectConversation(response.data.id);
      void queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start conversation');
    } finally {
      setStartingChat(false);
    }
  };

  const addGroupParticipant = () => {
    const compact = groupParticipantDraft.trim().replace(/[\s().-]/gu, '');
    const digits = compact.startsWith('+') ? compact.slice(1) : compact;
    if (!/^[1-9]\d{7,14}$/u.test(digits)) {
      setGroupCreationError('Enter a valid international number with 8–15 digits.');
      return;
    }
    if (groupParticipants.includes(digits)) {
      setGroupCreationError('That participant is already in the list.');
      return;
    }
    if (groupParticipants.length >= 100) {
      setGroupCreationError('A group can include up to 100 participants here.');
      return;
    }
    setGroupParticipants((current) => [...current, digits]);
    setGroupParticipantDraft('');
    setGroupCreationError(null);
  };

  const createWhatsappGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (groupCreating) return;
    const request =
      groupPendingRequest ??
      (groupTitle.trim() && groupParticipants.length
        ? {
            key: crypto.randomUUID(),
            title: groupTitle.trim(),
            participants: groupParticipants,
          }
        : null);
    if (!request) {
      setGroupCreationError('Add a group name and at least one participant.');
      return;
    }
    setGroupRetrying(Boolean(groupPendingRequest));
    setGroupPendingRequest(request);
    setGroupCreating(true);
    setGroupCreationError(null);
    try {
      const response = await client.request<{ data: Conversation }>('/whatsapp/groups', {
        method: 'POST',
        headers: { 'Idempotency-Key': request.key },
        body: {
          title: request.title,
          participants: request.participants.map((phone) => `+${phone}`),
        },
      });
      setGroupPendingRequest(null);
      setGroupTitle('');
      setGroupParticipants([]);
      setGroupParticipantDraft('');
      setGroupCreationError(null);
      setGroupRetrying(false);
      setGroupCreatorOpen(false);
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (current) => ({
        items: [
          response.data,
          ...(current?.items ?? []).filter((conversation) => conversation.id !== response.data.id),
        ],
        nextOffset: current?.nextOffset ?? 0,
        hasMore: current?.hasMore ?? false,
      }));
      onSelectConversation(response.data.id);
      void queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
      toast.success('WhatsApp group created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the group';
      const unresolved =
        !(error instanceof ApiError) ||
        (error.status === 409 && /unresolved|could not be confirmed/iu.test(message)) ||
        (error.status >= 500 && !/rejected the group creation request/iu.test(message));
      if (unresolved) {
        setGroupPendingRequest(request);
        setGroupCreationError(
          'WhatsApp may have created this group, but the result is not confirmed. Check the inbox, then use Check group result to safely reuse the same request key.'
        );
      } else {
        setGroupPendingRequest(null);
        setGroupCreationError(message);
      }
      setGroupRetrying(false);
    } finally {
      setGroupCreating(false);
    }
  };

  const previewGroupInvite = async () => {
    if (!groupInviteDraft.trim() || groupJoining) return;
    setGroupJoinError(null);
    setGroupInvitePreview(null);
    setGroupJoinPending(null);
    try {
      const response = await client.request<{
        data: { name: string; topic: string | null; participant_count: number | null };
      }>('/whatsapp/groups/invite-preview', {
        method: 'POST',
        body: { link: groupInviteDraft.trim() },
      });
      setGroupInvitePreview(response.data);
    } catch (error) {
      setGroupJoinError(
        error instanceof Error ? error.message : 'Group details could not be loaded'
      );
    }
  };

  const joinGroupFromInvite = async () => {
    if (!groupInvitePreview || groupJoining) return;
    const request = groupJoinPending ?? {
      key: crypto.randomUUID(),
      link: groupInviteDraft.trim(),
    };
    setGroupJoinPending(request);
    setGroupJoining(true);
    setGroupJoinError(null);
    try {
      const response = await client.request<{ data: Conversation }>('/whatsapp/groups/join', {
        method: 'POST',
        headers: { 'Idempotency-Key': request.key },
        body: { link: request.link },
      });
      setGroupJoinPending(null);
      setGroupInviteDraft('');
      setGroupInvitePreview(null);
      setConfirmGroupJoin(false);
      setGroupJoinOpen(false);
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (current) => ({
        items: [
          response.data,
          ...(current?.items ?? []).filter((conversation) => conversation.id !== response.data.id),
        ],
        nextOffset: current?.nextOffset ?? 0,
        hasMore: current?.hasMore ?? false,
      }));
      onSelectConversation(response.data.id);
      void queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
      toast.success('Joined WhatsApp group');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not join the group';
      if (error instanceof ApiError && /rejected the group join/iu.test(message)) {
        setGroupJoinPending(null);
        setGroupInvitePreview(null);
      }
      setGroupJoinError(message);
      setConfirmGroupJoin(false);
    } finally {
      setGroupJoining(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <form onSubmit={startChat} className="space-y-2">
        <div className="flex gap-2">
          <Input
            aria-label="Phone number with country code"
            placeholder="+6281234567890"
            value={newPhone}
            onChange={(event) => {
              setNewPhone(event.target.value);
              setPhoneCheck(null);
            }}
            disabled={startingChat || checkingPhone}
            inputMode="tel"
          />
          <Button
            type="button"
            variant="outline"
            disabled={startingChat || checkingPhone || !newPhone.trim()}
            onClick={() => void checkPhone()}
          >
            {checkingPhone ? 'Checking…' : 'Check number'}
          </Button>
        </div>
        {phoneCheck && (
          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${phoneCheck.is_on_whatsapp ? 'text-green-800' : 'text-ink-faint'}`}
          >
            {phoneCheck.is_on_whatsapp
              ? `${phoneCheck.phone} is on WhatsApp`
              : `${phoneCheck.phone} is not registered, or GoWA could not verify it`}
          </p>
        )}
        <Button
          type="submit"
          disabled={
            startingChat || checkingPhone || !newPhone.trim() || phoneCheck?.is_on_whatsapp !== true
          }
        >
          New chat
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={groupCreatorOpen}
        aria-controls="whatsapp-group-creator"
        onClick={() => setGroupCreatorOpen((open) => !open)}
      >
        {groupCreatorOpen ? 'Close group creator' : 'Create group'}
      </Button>
      {groupCreatorOpen && (
        <form
          id="whatsapp-group-creator"
          onSubmit={createWhatsappGroup}
          className="space-y-3 border-2 border-ink bg-paper p-3"
        >
          <h2 className="font-display text-base uppercase">Create a group</h2>
          <label className="block space-y-1 text-sm font-semibold">
            <span>Group name</span>
            <Input
              aria-label="Group name"
              maxLength={25}
              value={groupTitle}
              onChange={(event) => setGroupTitle(event.target.value)}
              disabled={groupCreating || Boolean(groupPendingRequest)}
              required
            />
          </label>
          <div className="space-y-1">
            <label className="block text-sm font-semibold" htmlFor="whatsapp-group-participant">
              Participant phone number
            </label>
            <div className="flex gap-2">
              <Input
                id="whatsapp-group-participant"
                aria-label="Participant phone number"
                placeholder="+6281234567890"
                inputMode="tel"
                value={groupParticipantDraft}
                onChange={(event) => {
                  setGroupParticipantDraft(event.target.value);
                  setGroupCreationError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addGroupParticipant();
                  }
                }}
                disabled={groupCreating || Boolean(groupPendingRequest)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={
                  groupCreating || Boolean(groupPendingRequest) || !groupParticipantDraft.trim()
                }
                onClick={addGroupParticipant}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-ink-faint">
              Use an international number, with country code.
            </p>
          </div>
          {groupParticipants.length > 0 && (
            <ul aria-label="Group participants" className="space-y-1">
              {groupParticipants.map((phone) => (
                <li key={phone} className="flex items-center justify-between gap-2 text-sm">
                  <span>+{phone}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove participant +${phone}`}
                    disabled={groupCreating || Boolean(groupPendingRequest)}
                    onClick={() =>
                      setGroupParticipants((current) => current.filter((item) => item !== phone))
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-faint">{groupParticipants.length} of 100 participants</p>
          {groupCreationError && (
            <p role="alert" className="text-sm text-red-800">
              {groupCreationError}
            </p>
          )}
          {groupPendingRequest && !groupCreationError && (
            <p role="status" className="text-sm">
              Group creation is still being checked. This request key will be reused.
            </p>
          )}
          <Button
            type="submit"
            disabled={
              groupCreating ||
              !groupTitle.trim() ||
              groupTitle.trim().length > 25 ||
              groupParticipants.length < 1 ||
              groupParticipants.length > 100
            }
          >
            {groupCreating
              ? groupRetrying
                ? 'Checking group result…'
                : 'Creating group…'
              : groupPendingRequest
                ? 'Check group result'
                : 'Create group'}
          </Button>
        </form>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={groupJoinOpen}
        aria-controls="whatsapp-group-join"
        onClick={() => setGroupJoinOpen((open) => !open)}
      >
        {groupJoinOpen ? 'Close join form' : 'Join group from invite link'}
      </Button>
      {groupJoinOpen && (
        <section
          id="whatsapp-group-join"
          className="space-y-3 border-2 border-ink bg-paper p-3"
          aria-label="Join a WhatsApp group"
        >
          <h2 className="font-display text-base uppercase">Join a group</h2>
          <label className="block space-y-1 text-sm font-semibold">
            <span>Group invitation link</span>
            <Input
              aria-label="Group invitation link"
              type="url"
              placeholder="https://chat.whatsapp.com/…"
              value={groupInviteDraft}
              disabled={groupJoining || Boolean(groupJoinPending)}
              onChange={(event) => {
                setGroupInviteDraft(event.target.value);
                setGroupInvitePreview(null);
                setGroupJoinPending(null);
                setGroupJoinError(null);
              }}
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!groupInviteDraft.trim() || groupJoining || Boolean(groupJoinPending)}
            onClick={() => void previewGroupInvite()}
          >
            {groupInvitePreview ? 'Refresh preview' : 'Preview group'}
          </Button>
          {groupInvitePreview && (
            <div className="space-y-1 text-sm" role="status">
              <p className="font-semibold">{groupInvitePreview.name}</p>
              {groupInvitePreview.topic && <p>{groupInvitePreview.topic}</p>}
              {groupInvitePreview.participant_count !== null && (
                <p className="text-xs text-ink-faint">
                  {groupInvitePreview.participant_count} participants
                </p>
              )}
              <Button
                type="button"
                size="sm"
                disabled={groupJoining}
                onClick={() => setConfirmGroupJoin(true)}
              >
                {groupJoinPending ? 'Check join result' : 'Join this group'}
              </Button>
            </div>
          )}
          {groupJoinError && <p role="alert">{groupJoinError}</p>}
          {groupJoinPending && groupJoinError && (
            <p role="status">Retry keeps the same request key and will check membership safely.</p>
          )}
        </section>
      )}
      {confirmGroupJoin && groupInvitePreview && (
        <div
          className="border-2 border-ink bg-magenta/20 p-3"
          role="alertdialog"
          aria-label="Confirm joining WhatsApp group"
        >
          <p>Join “{groupInvitePreview.name}”?</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={groupJoining}
              onClick={() => void joinGroupFromInvite()}
            >
              {groupJoining ? 'Joining…' : 'Confirm join'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={groupJoining}
              onClick={() => setConfirmGroupJoin(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
