'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { formatDateTime } from '@/lib/date-format';
import {
  readWhatsAppInboxPreferences,
  type Account,
  type ContactProfile,
  type Conversation,
  type ConversationAgent,
  type ConversationFilter,
  type ConversationLabel,
  type ConversationPage,
  type ConversationTeam,
  type GroupProfile,
  type Message,
  type QueueFilter,
  type WorkStateFilter,
} from '@/components/whatsapp/types';

export function useWhatsAppInbox(inboxPreferenceScope: string) {
  const queryClient = useQueryClient();
  const [inboxPreferences, setInboxPreferences] = useState(() =>
    readWhatsAppInboxPreferences(inboxPreferenceScope)
  );
  const {
    selectedConversationId: selected,
    selectedLabelId,
    conversationFilter,
    queueFilter,
    teamId,
    workStateFilter,
    showArchived,
  } = inboxPreferences;

  const setSelected = (selectedConversationId: number | null) =>
    setInboxPreferences((current) => ({ ...current, selectedConversationId }));
  const setConversationFilter = (conversationFilter: ConversationFilter) =>
    setInboxPreferences((current) => ({ ...current, conversationFilter }));
  const setSelectedLabelId = (selectedLabelId: number | null) =>
    setInboxPreferences((current) => ({ ...current, selectedLabelId }));
  const setQueueFilter = (queueFilter: QueueFilter) =>
    setInboxPreferences((current) => ({ ...current, queueFilter }));
  const setTeamId = (teamId: number | null) =>
    setInboxPreferences((current) => ({ ...current, teamId }));
  const setWorkStateFilter = (workStateFilter: WorkStateFilter) =>
    setInboxPreferences((current) => ({ ...current, workStateFilter }));
  const setShowArchived = (showArchived: boolean) =>
    setInboxPreferences((current) => ({ ...current, showArchived }));
  const setSendOnEnter = (sendOnEnter: boolean) =>
    setInboxPreferences((current) => ({ ...current, sendOnEnter }));

  const [conversationSearch, setConversationSearch] = useState('');
  const [debouncedConversationSearch, setDebouncedConversationSearch] = useState('');
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const loadingMoreConversationsRef = useRef(false);
  const [olderPage, setOlderPage] = useState<{
    conversationId: number;
    messages: Message[];
    nextOffset: number;
    hasMore: boolean;
  } | null>(null);
  const [loadingOlderConversationId, setLoadingOlderConversationId] = useState<number | null>(null);
  const loadingOlderRef = useRef<number | null>(null);
  const activeConversationIdRef = useRef<number | undefined>(undefined);
  const [clockNow, setClockNow] = useState(0);

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(inboxPreferenceScope, JSON.stringify(inboxPreferences));
    } catch {
      // The inbox remains usable when browser storage is unavailable.
    }
  }, [inboxPreferenceScope, inboxPreferences]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedConversationSearch(conversationSearch.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [conversationSearch]);

  const accountQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'account']),
    queryFn: async () => (await client.request<{ data: Account }>('/whatsapp/account')).data,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const labelsQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'labels']),
    queryFn: async () =>
      (await client.request<{ data: ConversationLabel[] }>('/whatsapp/labels')).data,
    enabled: accountQuery.data?.status === 'connected',
  });

  const agentsQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'agents']),
    queryFn: async () =>
      (
        await client.request<{
          data: { members: ConversationAgent[]; teams: ConversationTeam[] };
        }>('/whatsapp/agents')
      ).data,
    enabled: accountQuery.data?.status === 'connected',
  });

  const effectiveTeamId =
    teamId !== null &&
    agentsQuery.data &&
    !agentsQuery.data.teams.some((team) => team.id === teamId)
      ? null
      : teamId;
  const effectiveSelectedLabelId =
    selectedLabelId !== null &&
    labelsQuery.data &&
    !labelsQuery.data.some((label) => label.id === selectedLabelId)
      ? null
      : selectedLabelId;

  const conversationsQueryKey = scopedQueryKey([
    'whatsapp',
    'conversations',
    debouncedConversationSearch,
    showArchived,
    conversationFilter,
    queueFilter,
    effectiveTeamId,
    workStateFilter,
    effectiveSelectedLabelId,
  ]);

  const conversationsQuery = useQuery({
    queryKey: conversationsQueryKey,
    queryFn: async () => {
      const page = (
        await client.request<{ data: Conversation[] }>(
          `/whatsapp/conversations?limit=50&offset=0&archived=${showArchived}&unread=${conversationFilter === 'unread'}&queue=${queueFilter}&work_state=${workStateFilter}${effectiveTeamId ? `&team_id=${effectiveTeamId}` : ''}${effectiveSelectedLabelId ? `&label_id=${effectiveSelectedLabelId}` : ''}${debouncedConversationSearch ? `&search=${encodeURIComponent(debouncedConversationSearch)}` : ''}`
        )
      ).data;
      const cached = queryClient.getQueryData<ConversationPage>(conversationsQueryKey);
      const pageIds = new Set(page.map((conversation) => conversation.id));
      const preserveCachedConversations =
        queueFilter === 'all' && effectiveTeamId === null && workStateFilter === 'all';
      const cachedItems =
        preserveCachedConversations && cached?.items
          ? cached.items.filter(
              (item) =>
                item.is_archived === showArchived &&
                (conversationFilter !== 'unread' || item.unread_count > 0) &&
                !pageIds.has(item.id)
            )
          : [];
      const items = [...page, ...cachedItems];
      return {
        items,
        nextOffset: Math.max(cached?.nextOffset ?? 0, items.length),
        hasMore: cached?.hasMore ?? page.length === 50,
      } satisfies ConversationPage;
    },
    enabled: accountQuery.data?.status === 'connected',
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const filteredConversations = (conversationsQuery.data?.items ?? []).filter((conversation) => {
    const matchesFilter =
      conversationFilter === 'all' ||
      (conversationFilter === 'unread' && conversation.unread_count > 0) ||
      (conversationFilter === 'groups' && conversation.is_group) ||
      (conversationFilter === 'private' && !conversation.is_group);
    const query = conversationSearch.trim().toLocaleLowerCase();
    const digits = query.replace(/\D/gu, '');
    const matchesSearch =
      !query ||
      (conversationSearch.trim() === debouncedConversationSearch &&
        Boolean(debouncedConversationSearch)) ||
      `${conversation.name} ${conversation.jid}`.toLocaleLowerCase().includes(query) ||
      (digits.length > 0 && conversation.jid.replace(/\D/gu, '').includes(digits));
    const matchesLabel =
      effectiveSelectedLabelId === null ||
      conversation.labels?.some((label) => label.id === effectiveSelectedLabelId);
    const matchesQueue =
      queueFilter === 'all' ||
      (queueFilter === 'mine' && conversation.assigned_user_id === client.currentUser?.id) ||
      (queueFilter === 'unassigned' &&
        !conversation.assigned_user_id &&
        !conversation.assigned_team_id);
    const matchesTeam =
      effectiveTeamId === null || conversation.assigned_team_id === effectiveTeamId;
    const matchesState =
      workStateFilter === 'all' || (conversation.work_state ?? 'open') === workStateFilter;
    return (
      matchesFilter && matchesSearch && matchesLabel && matchesQueue && matchesTeam && matchesState
    );
  });

  const activeConversation =
    filteredConversations.find((item) => item.id === selected) ?? filteredConversations[0];

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id;
  }, [activeConversation?.id]);

  const contactProfileQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'contact', activeConversation?.id]),
    queryFn: async () =>
      (
        await client.request<{ data: ContactProfile }>(
          `/whatsapp/conversations/${activeConversation!.id}/contact`
        )
      ).data,
    enabled:
      accountQuery.data?.status === 'connected' &&
      Boolean(activeConversation && !activeConversation.is_group),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const groupProfileQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'group-profile', activeConversation?.id]),
    queryFn: async () =>
      (
        await client.request<{ data: GroupProfile }>(
          `/whatsapp/conversations/${activeConversation!.id}/group`
        )
      ).data,
    enabled: accountQuery.data?.status === 'connected' && Boolean(activeConversation?.is_group),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const messagesQuery = useQuery({
    queryKey: scopedQueryKey(['whatsapp', 'messages', activeConversation?.id]),
    queryFn: async () =>
      (
        await client.request<{ data: Message[] }>(
          `/whatsapp/conversations/${activeConversation!.id}/messages?limit=50&offset=0`
        )
      ).data,
    enabled: accountQuery.data?.status === 'connected' && Boolean(activeConversation),
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
  });

  const loadMoreConversations = async () => {
    const current = queryClient.getQueryData<ConversationPage>(conversationsQueryKey);
    if (!current?.hasMore || loadingMoreConversationsRef.current) return;
    loadingMoreConversationsRef.current = true;
    setLoadingMoreConversations(true);
    try {
      const page = (
        await client.request<{ data: Conversation[] }>(
          `/whatsapp/conversations?limit=50&offset=${current.nextOffset}&archived=${showArchived}&unread=${conversationFilter === 'unread'}&queue=${queueFilter}&work_state=${workStateFilter}${effectiveTeamId ? `&team_id=${effectiveTeamId}` : ''}${effectiveSelectedLabelId ? `&label_id=${effectiveSelectedLabelId}` : ''}${debouncedConversationSearch ? `&search=${encodeURIComponent(debouncedConversationSearch)}` : ''}`
        )
      ).data;
      queryClient.setQueryData<ConversationPage>(conversationsQueryKey, (latest) => {
        const currentItems = latest?.items ?? current.items;
        const ids = new Set(currentItems.map((conversation) => conversation.id));
        return {
          items: [...currentItems, ...page.filter((conversation) => !ids.has(conversation.id))],
          nextOffset: current.nextOffset + page.length,
          hasMore: page.length === 50,
        };
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load more conversations');
    } finally {
      loadingMoreConversationsRef.current = false;
      setLoadingMoreConversations(false);
    }
  };

  const currentOlderPage = olderPage?.conversationId === activeConversation?.id ? olderPage : null;
  const olderMessages = currentOlderPage?.messages ?? [];
  const olderMessageOffset = currentOlderPage?.nextOffset ?? messagesQuery.data?.length ?? 50;
  const hasOlderMessages = currentOlderPage?.hasMore ?? messagesQuery.data?.length === 50;
  const loadingOlderMessages = loadingOlderConversationId === activeConversation?.id;

  const messageList = Array.from(
    new Map(
      [...(messagesQuery.data ?? []), ...olderMessages].map((message) => [message.id, message])
    ).values()
  );
  const readCursorIndex = messageList.findIndex((message) => message.is_last_read);
  const oldestUnreadIndex = messageList.reduce(
    (oldestIndex, message, index) => (message.is_unread ? index : oldestIndex),
    -1
  );
  const newMessagesDividerIndex =
    readCursorIndex >= 0 ? readCursorIndex : oldestUnreadIndex >= 0 ? oldestUnreadIndex + 1 : -1;

  const loadOlderMessages = async () => {
    if (!activeConversation || !hasOlderMessages) return;
    const requestedConversationId = activeConversation.id;
    if (loadingOlderRef.current === requestedConversationId) return;
    loadingOlderRef.current = requestedConversationId;
    setLoadingOlderConversationId(requestedConversationId);
    try {
      const page = (
        await client.request<{ data: Message[] }>(
          `/whatsapp/conversations/${requestedConversationId}/messages?limit=50&offset=${olderMessageOffset}`
        )
      ).data;
      if (activeConversationIdRef.current !== requestedConversationId) return;
      setOlderPage((current) => {
        const currentMessages =
          current?.conversationId === requestedConversationId ? current.messages : [];
        const byId = new Map(currentMessages.map((message) => [message.id, message]));
        for (const message of page) byId.set(message.id, message);
        return {
          conversationId: requestedConversationId,
          messages: [...byId.values()],
          nextOffset: olderMessageOffset + page.length,
          hasMore: page.length === 50,
        };
      });
    } catch (error) {
      if (activeConversationIdRef.current === requestedConversationId) {
        toast.error(error instanceof Error ? error.message : 'Could not load older messages');
      }
    } finally {
      if (loadingOlderRef.current === requestedConversationId) {
        loadingOlderRef.current = null;
        setLoadingOlderConversationId((current) =>
          current === requestedConversationId ? null : current
        );
      }
    }
  };

  const jumpToQuotedMessage = async (message: Message) => {
    const targetId = message.reply_to?.id;
    const conversationId = activeConversation?.id;
    if (!targetId || !conversationId) return;
    if (!document.getElementById(`whatsapp-message-${targetId}`)) {
      if (loadingOlderRef.current === conversationId) return;
      loadingOlderRef.current = conversationId;
      setLoadingOlderConversationId(conversationId);
      let offset = olderMessageOffset;
      let hasMore = hasOlderMessages;
      const loaded = [...olderMessages];
      try {
        while (hasMore && offset < 5_000 && activeConversationIdRef.current === conversationId) {
          const page = (
            await client.request<{ data: Message[] }>(
              `/whatsapp/conversations/${conversationId}/messages?limit=50&offset=${offset}`
            )
          ).data;
          loaded.push(...page);
          offset += page.length;
          hasMore = page.length === 50;
          if (page.some((item) => item.id === targetId)) break;
        }
        setOlderPage((current) => {
          const existing = current?.conversationId === conversationId ? current.messages : [];
          const byId = new Map([...existing, ...loaded].map((item) => [item.id, item]));
          return { conversationId, messages: [...byId.values()], nextOffset: offset, hasMore };
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load the quoted message');
        return;
      } finally {
        loadingOlderRef.current = null;
        setLoadingOlderConversationId((current) => (current === conversationId ? null : current));
      }
      if (!loaded.some((item) => item.id === targetId)) {
        toast.error('Quoted message is outside the available history');
        return;
      }
    }
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`whatsapp-message-${targetId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus({ preventScroll: true });
    });
  };

  const account = accountQuery.data;
  const status = account?.status ?? 'disconnected';
  const connected = status === 'connected';
  const lastInboxSyncLabel = conversationsQuery.dataUpdatedAt
    ? formatDateTime(conversationsQuery.dataUpdatedAt, 'time')
    : null;

  const retryWhatsAppData = () => {
    const retries: Promise<unknown>[] = [accountQuery.refetch(), conversationsQuery.refetch()];
    if (connected && activeConversation) retries.push(messagesQuery.refetch());
    void Promise.all(retries);
  };

  return {
    inboxPreferences,
    setSelected,
    setConversationFilter,
    setSelectedLabelId,
    setQueueFilter,
    setTeamId,
    setWorkStateFilter,
    setShowArchived,
    setSendOnEnter,
    conversationSearch,
    setConversationSearch,
    accountQuery,
    labelsQuery,
    agentsQuery,
    conversationsQuery,
    conversationsQueryKey,
    contactProfileQuery,
    groupProfileQuery,
    messagesQuery,
    effectiveTeamId,
    effectiveSelectedLabelId,
    filteredConversations,
    activeConversation,
    loadingMoreConversations,
    loadMoreConversations,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    jumpToQuotedMessage,
    messageList,
    newMessagesDividerIndex,
    clockNow,
    account,
    status,
    connected,
    lastInboxSyncLabel,
    retryWhatsAppData,
  };
}
