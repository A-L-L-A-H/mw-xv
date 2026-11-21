'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moonwitness/client';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import type { ContactProfile, GroupProfile } from './types';

export function GroupProfileSummary({
  conversationId,
  profile,
  loading,
  failed,
  refreshing,
  canManage,
  onLeft,
  onRefresh,
}: {
  conversationId: number;
  profile?: GroupProfile;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  canManage: boolean;
  onLeft: () => void;
  onRefresh: () => Promise<'fresh' | 'left' | false>;
}) {
  const queryClient = useQueryClient();
  const [avatar, setAvatar] = useState<{ conversationId: number; url: string } | null>(null);
  const [participantDraft, setParticipantDraft] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    action: 'add' | 'remove' | 'promote' | 'demote';
    phone: string;
    name: string;
  } | null>(null);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshingAfterUnknown, setRefreshingAfterUnknown] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [confirmInviteReset, setConfirmInviteReset] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmSetting, setConfirmSetting] = useState<'locked' | 'announce' | null>(null);

  useEffect(() => {
    if (!profile?.avatar_available) return;
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void client
      .requestBlobWithDownloadProgress(`/whatsapp/conversations/${conversationId}/group/avatar`, {
        signal: controller.signal,
        onDownloadProgress: () => undefined,
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatar({ conversationId, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, profile?.avatar_available, profile?.synced_at]);

  const loadInviteLink = async (reset = false) => {
    setInviteLoading(true);
    setActionError(null);
    try {
      const response = await client.request<{ data: { invite_link: string } }>(
        `/whatsapp/conversations/${conversationId}/group/invite-link${reset ? '/reset' : ''}`,
        reset ? { method: 'POST' } : undefined
      );
      setInviteLink(response.data.invite_link);
      setConfirmInviteReset(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Invite link could not be loaded');
    } finally {
      setInviteLoading(false);
    }
  };

  const leaveGroup = async () => {
    if (!confirmLeave || inviteLoading || mutating || profile?.pending_operation) return;
    setInviteLoading(true);
    setActionError(null);
    try {
      await client.request(`/whatsapp/conversations/${conversationId}/group/leave`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      onLeft();
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      const uncertain =
        !(error instanceof ApiError) ||
        error.status >= 500 ||
        (error.status === 409 && /unresolved|unknown/iu.test(error.message));
      if (uncertain) setRefreshRequired(true);
      setActionError(
        error instanceof Error ? error.message : 'Leave result could not be confirmed'
      );
    } finally {
      setInviteLoading(false);
      setConfirmLeave(false);
    }
  };

  const manageParticipant = async () => {
    if (!confirmAction || mutating || refreshRequired || profile?.pending_operation) return;
    setMutating(true);
    setActionError(null);
    try {
      await client.request(
        `/whatsapp/conversations/${conversationId}/group/participants/${confirmAction.action}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { participants: [confirmAction.phone] },
        }
      );
      setConfirmAction(null);
      setParticipantDraft('');
      const refreshed = await onRefresh();
      if (!refreshed) setActionError('Action completed. Group details could not be refreshed yet.');
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['whatsapp', 'conversations']),
      });
    } catch (error) {
      const uncertain =
        !(error instanceof ApiError) ||
        error.status >= 500 ||
        (error.status === 409 && /unresolved|unknown/iu.test(error.message));
      if (uncertain) {
        setRefreshRequired(true);
        setConfirmAction(null);
      }
      setActionError(
        error instanceof Error ? error.message : 'Group action could not be confirmed'
      );
    } finally {
      setMutating(false);
    }
  };

  const updateGroupSetting = async () => {
    if (!confirmSetting || !profile || mutating || refreshRequired || profile.pending_operation)
      return;
    const setting = confirmSetting;
    const current = setting === 'locked' ? profile.is_locked : profile.is_announce;
    if (current === null) return;
    setMutating(true);
    setActionError(null);
    try {
      await client.request(`/whatsapp/conversations/${conversationId}/group/settings`, {
        method: 'POST',
        body: { setting, enabled: !current },
      });
      setConfirmSetting(null);
      const refreshed = await onRefresh();
      if (!refreshed) setActionError('Setting updated. Group details could not be refreshed yet.');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Group setting could not be confirmed'
      );
    } finally {
      setMutating(false);
    }
  };

  const refreshAfterUnknown = async () => {
    setRefreshingAfterUnknown(true);
    setActionError(null);
    const refreshed = await onRefresh();
    if (refreshed === 'left') {
      setRefreshRequired(false);
      onLeft();
    } else if (refreshed === 'fresh') setRefreshRequired(false);
    else setActionError('Group details are still unavailable. Do not repeat this action yet.');
    setRefreshingAfterUnknown(false);
  };

  if (loading) return <p className="mt-1 text-xs text-ink-faint">Loading group details…</p>;
  if (failed)
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
        <span>Group details could not be loaded.</span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={() => void onRefresh()}
        >
          Retry
        </Button>
      </div>
    );
  if (!profile) return null;
  return (
    <div className="mt-2 max-w-xl text-xs text-ink-faint">
      <div className="mb-2 flex items-center gap-2">
        {avatar?.conversationId === conversationId ? (
          <img
            src={avatar.url}
            alt={`${profile.name} WhatsApp group photo`}
            className="size-9 shrink-0 rounded-full border border-ink/30 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink/30 bg-paper font-semibold text-ink"
          >
            {profile.name.slice(0, 1).toLocaleUpperCase() || '?'}
          </span>
        )}
        <span className="truncate text-ink">{profile.name}</span>
      </div>
      <p>
        {profile.participant_count === null
          ? 'Group participants'
          : `${profile.participant_count} participants`}
        {profile.stale ? ' · saved details' : ''}
      </p>
      {profile.is_ephemeral !== null && (
        <p className="mt-1">
          {profile.is_ephemeral ? 'Disappearing messages are on' : 'Disappearing messages are off'}
        </p>
      )}
      {profile.topic && <p className="mt-1 whitespace-pre-wrap break-words">{profile.topic}</p>}
      {canManage && (profile.is_locked !== null || profile.is_announce !== null) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {profile.is_locked !== null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutating || refreshRequired || profile.stale || profile.pending_operation}
              onClick={() => setConfirmSetting('locked')}
            >
              {profile.is_locked ? 'Allow members to edit group info' : 'Restrict group info edits'}
            </Button>
          )}
          {profile.is_announce !== null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutating || refreshRequired || profile.stale || profile.pending_operation}
              onClick={() => setConfirmSetting('announce')}
            >
              {profile.is_announce
                ? 'Allow members to send messages'
                : 'Admins only can send messages'}
            </Button>
          )}
        </div>
      )}
      {confirmSetting && profile && (
        <div
          className="mt-2 border-2 border-ink bg-magenta/20 p-2"
          role="alertdialog"
          aria-modal="true"
        >
          <p>
            {confirmSetting === 'announce'
              ? profile.is_announce
                ? 'Allow all group members to send messages?'
                : 'Restrict group messages to admins?'
              : profile.is_locked
                ? 'Allow all group members to edit group information?'
                : 'Restrict group information changes to admins?'}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={mutating}
              onClick={() => void updateGroupSetting()}
            >
              {mutating ? 'Updating…' : 'Confirm'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutating}
              onClick={() => setConfirmSetting(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {profile.participants.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer">Show participants</summary>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto pl-4">
            {profile.participants.map((participant) => (
              <li key={participant.jid} className="break-all">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {participant.display_name || participant.phone_number || participant.jid}
                    {participant.is_super_admin
                      ? ' · owner'
                      : participant.is_admin
                        ? ' · admin'
                        : ''}
                  </span>
                  {canManage && !participant.is_super_admin && participant.phone_number && (
                    <span className="flex gap-1">
                      {participant.is_admin ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={mutating || refreshRequired}
                          onClick={() =>
                            setConfirmAction({
                              action: 'demote',
                              phone: participant.phone_number!.split('@')[0]!,
                              name: participant.display_name || participant.phone_number!,
                            })
                          }
                        >
                          Demote
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={mutating || refreshRequired}
                          onClick={() =>
                            setConfirmAction({
                              action: 'promote',
                              phone: participant.phone_number!.split('@')[0]!,
                              name: participant.display_name || participant.phone_number!,
                            })
                          }
                        >
                          Make admin
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={mutating || refreshRequired}
                        onClick={() =>
                          setConfirmAction({
                            action: 'remove',
                            phone: participant.phone_number!.split('@')[0]!,
                            name: participant.display_name || participant.phone_number!,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canManage && (
        <div className="mt-2 space-y-2 border-t border-ink/20 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={inviteLoading || refreshRequired || profile.pending_operation}
              onClick={() => void loadInviteLink()}
            >
              {inviteLoading ? 'Loading invite link…' : 'Get invite link'}
            </Button>
            {inviteLink && (
              <a className="break-all underline" href={inviteLink} target="_blank" rel="noreferrer">
                Open group invite link
              </a>
            )}
            {inviteLink && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={inviteLoading || refreshRequired || profile.pending_operation}
                onClick={() => setConfirmInviteReset(true)}
              >
                Reset invite link
              </Button>
            )}
          </div>
          {confirmInviteReset && (
            <div
              className="border-2 border-ink bg-magenta/20 p-2"
              role="alertdialog"
              aria-label="Confirm invite link reset"
            >
              <p>Resetting this link will invalidate the current group invite.</p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={inviteLoading}
                  onClick={() => void loadInviteLink(true)}
                >
                  {inviteLoading ? 'Resetting…' : 'Confirm reset'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={inviteLoading}
                  onClick={() => setConfirmInviteReset(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {profile.pending_operation && (
            <div className="space-y-1" role="status">
              <p>
                A previous group action is still being checked. Refresh group details before
                continuing.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={refreshing}
                onClick={() => void refreshAfterUnknown()}
              >
                {refreshing ? 'Refreshing…' : 'Refresh group details'}
              </Button>
            </div>
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const compact = participantDraft
                .trim()
                .replace(/[\s().-]/gu, '')
                .replace(/^\+/u, '');
              if (!/^[1-9]\d{7,14}$/u.test(compact)) {
                setActionError('Enter a valid international phone number.');
                return;
              }
              if (
                profile.participants.some(
                  (participant) => participant.phone_number?.split('@')[0] === compact
                )
              ) {
                setActionError('That number is already in this group.');
                return;
              }
              setActionError(null);
              setConfirmAction({ action: 'add', phone: compact, name: `+${compact}` });
            }}
          >
            <Input
              aria-label="Add group participant phone number"
              inputMode="tel"
              placeholder="+6281234567890"
              value={participantDraft}
              disabled={mutating || refreshRequired || profile.pending_operation}
              onChange={(event) => setParticipantDraft(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={
                mutating || refreshRequired || profile.pending_operation || !participantDraft.trim()
              }
            >
              Add participant
            </Button>
          </form>
          {refreshRequired && (
            <div className="space-y-1" role="status">
              <p>The previous result is unknown. Refresh group details before another action.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={refreshingAfterUnknown || refreshing}
                onClick={() => void refreshAfterUnknown()}
              >
                {refreshingAfterUnknown ? 'Refreshing…' : 'Refresh group details'}
              </Button>
            </div>
          )}
          {actionError && (
            <p role="alert" className="text-red-800">
              {actionError}
            </p>
          )}
          <div className="border-t border-ink/20 pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={inviteLoading || mutating || refreshRequired || profile.pending_operation}
              onClick={() => setConfirmLeave(true)}
            >
              Leave group
            </Button>
          </div>
        </div>
      )}
      {confirmLeave && (
        <div
          className="mt-2 border-2 border-ink bg-magenta/20 p-2"
          role="alertdialog"
          aria-label="Confirm leaving group"
        >
          <p>Leave this WhatsApp group? Its conversation will be archived in Board.</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={inviteLoading}
              onClick={() => void leaveGroup()}
            >
              {inviteLoading ? 'Leaving…' : 'Confirm leave'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={inviteLoading}
              onClick={() => setConfirmLeave(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {confirmAction && (
        <div
          className="mt-2 border-2 border-ink bg-magenta/20 p-2"
          role="alertdialog"
          aria-label="Confirm group participant action"
        >
          <p>
            Confirm {confirmAction.action} for {confirmAction.name}?
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={mutating}
              onClick={() => void manageParticipant()}
            >
              {mutating ? 'Applying…' : `Confirm ${confirmAction.action}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutating}
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {profile.stale && (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto p-0"
          onClick={() => void onRefresh()}
        >
          Refresh group details
        </Button>
      )}
    </div>
  );
}

export function ContactProfileSummary({
  conversationId,
  profile,
  loading,
  failed,
  refreshing,
  onRefresh,
}: {
  conversationId: number;
  profile?: ContactProfile;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [avatar, setAvatar] = useState<{ conversationId: number; url: string } | null>(null);
  useEffect(() => {
    if (!profile?.avatar_available) return;
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void client
      .requestBlobWithDownloadProgress(`/whatsapp/conversations/${conversationId}/contact/avatar`, {
        signal: controller.signal,
        onDownloadProgress: () => undefined,
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatar({ conversationId, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, profile?.avatar_available, profile?.picture_id]);
  if (loading) return <p className="mt-1 text-xs text-ink-faint">Loading contact profile…</p>;
  if (failed)
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
        <span>Contact profile could not be refreshed.</span>
        <Button type="button" variant="link" className="h-auto p-0" onClick={onRefresh}>
          Retry
        </Button>
      </div>
    );
  if (!profile) return null;
  return (
    <div className="mt-2 flex max-w-xl items-center gap-2 text-xs text-ink-faint">
      {avatar?.conversationId === conversationId ? (
        <img
          src={avatar.url}
          alt={`${profile.name} WhatsApp profile photo`}
          className="size-9 shrink-0 rounded-full border border-ink/30 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink/30 bg-paper font-semibold text-ink"
        >
          {profile.name.slice(0, 1).toLocaleUpperCase() || '?'}
        </span>
      )}
      <span className="min-w-0">
        {profile.verified_name && profile.verified_name !== profile.name && (
          <span className="block truncate text-ink">{profile.verified_name}</span>
        )}
        {profile.phone_number && <span className="block">+{profile.phone_number}</span>}
        {profile.status && <span className="block truncate">About: {profile.status}</span>}
      </span>
      <Button
        type="button"
        variant="link"
        className="ml-auto h-auto shrink-0 p-0"
        disabled={refreshing}
        onClick={onRefresh}
      >
        {refreshing ? 'Refreshing…' : 'Refresh contact'}
      </Button>
    </div>
  );
}
