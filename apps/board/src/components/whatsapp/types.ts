import { ApiError } from '@moonwitness/client';

export type Account = {
  id?: number;
  status: string;
  direct_uploads?: boolean;
  phone_number?: string | null;
  qr_code?: string | null;
  last_error?: string | null;
  webhook_configured?: boolean;
  permissions?: {
    manage: boolean;
    manageConversations: boolean;
    createConversation: boolean;
    send: boolean;
    manageMessages: boolean;
  };
};

export type Conversation = {
  id: number;
  jid: string;
  name: string;
  is_group: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  assigned_team_id?: number | null;
  assigned_team_name?: string | null;
  work_state?: 'open' | 'closed';
  unread_count: number;
  last_message?: string | null;
  last_message_at?: string | null;
  labels?: ConversationLabel[];
};

export type ContactProfile = {
  name: string;
  phone_number: string | null;
  verified_name: string | null;
  status: string | null;
  avatar_available?: boolean;
  picture_id?: string | null;
};

export type GroupProfile = {
  name: string;
  avatar_available?: boolean;
  topic: string | null;
  participant_count: number | null;
  participants: Array<{
    jid: string;
    phone_number: string | null;
    display_name: string | null;
    is_admin: boolean;
    is_super_admin: boolean;
  }>;
  is_locked: boolean | null;
  is_announce: boolean | null;
  is_ephemeral: boolean | null;
  synced_at: string | null;
  stale: boolean;
  pending_operation?: boolean;
  left?: boolean;
};

export type ConversationLabel = { id: number; name: string; color: string };
export type ConversationAgent = {
  id: number;
  login: string;
  team_id: number | null;
  team_name: string | null;
};
export type ConversationTeam = { id: number; name: string };
export type QueueFilter = 'all' | 'mine' | 'unassigned';
export type WorkStateFilter = 'all' | 'open' | 'closed';
export type UploadProgressState = {
  percent: number | null;
  bytesPerSecond: number;
};
export type ConversationPage = {
  items: Conversation[];
  nextOffset: number;
  hasMore: boolean;
};

export type Message = {
  id: number;
  direction: string;
  is_last_read?: boolean;
  is_unread?: boolean;
  content?: string | null;
  status: string;
  retryable?: boolean;
  last_error?: string | null;
  message_type: string;
  provider_type?: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
  media_scan_status?: 'not_applicable' | 'pending' | 'clean' | 'infected';
  sender_jid?: string | null;
  sender_display_name?: string | null;
  reply_to?: {
    id?: number;
    direction?: string;
    content?: string | null;
    message_type?: string;
    provider_type?: string | null;
    media_file_name?: string | null;
    unavailable?: boolean;
  } | null;
  is_forwarded?: boolean;
  is_edited?: boolean;
  is_deleted?: boolean;
  reactions?: Array<{
    emoji: string;
    sender_jid: string | null;
    sender_display_name?: string | null;
    is_from_me: boolean;
    timestamp?: string | null;
  }>;
  create_date: string;
};

export type InternalNote = {
  id: number;
  user_id: number;
  author_name: string;
  body: string;
  create_date: string;
};

export type ConversationFilter = 'all' | 'unread' | 'private' | 'groups';
export type WhatsAppInboxPreferences = {
  selectedConversationId: number | null;
  selectedLabelId: number | null;
  conversationFilter: ConversationFilter;
  queueFilter: QueueFilter;
  teamId: number | null;
  workStateFilter: WorkStateFilter;
  showArchived: boolean;
  sendOnEnter: boolean;
};

export const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
export const providerTypeLabels: Record<string, string> = {
  contact: 'Contact card',
  location: 'Location',
  live_location: 'Live location',
  poll: 'Poll',
  call: 'Call event',
  event: 'Event',
  protocol: 'System message',
  group_event_join: 'Group update',
  group_event_leave: 'Group update',
  group_event_promote: 'Group update',
  group_event_demote: 'Group update',
  view_once: 'View-once media',
};

export const defaultInboxPreferences: WhatsAppInboxPreferences = {
  selectedConversationId: null,
  selectedLabelId: null,
  conversationFilter: 'all',
  queueFilter: 'all',
  teamId: null,
  workStateFilter: 'open',
  showArchived: false,
  sendOnEnter: true,
};

export const statusLabel: Record<string, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting',
  qr: 'Scan the QR code',
  qr_expired: 'QR code expired',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  error: 'Connection error',
};

export const messageStatusLabel: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  received: 'Received',
  failed: 'Failed',
  unknown: 'Status unknown',
};

const BLOCKED_DOWNLOAD_EXTENSIONS = new Set([
  'ade',
  'adp',
  'bat',
  'cmd',
  'com',
  'cpl',
  'dll',
  'docm',
  'exe',
  'hta',
  'htm',
  'html',
  'jar',
  'js',
  'jse',
  'lnk',
  'mht',
  'mhtml',
  'msi',
  'msp',
  'ocx',
  'pif',
  'potm',
  'ppam',
  'pps',
  'pptm',
  'ps1',
  'reg',
  'scf',
  'scr',
  'sct',
  'shb',
  'shs',
  'svg',
  'url',
  'vb',
  'vbe',
  'vbs',
  'ws',
  'wsc',
  'wsf',
  'wsh',
  'xlsm',
  'xlam',
  'xll',
  'xsl',
  'xml',
]);

export function formatConversationAddress(conversation: Conversation): string {
  const [localPart, domain] = conversation.jid.split('@');
  const identifier = localPart?.split(':')[0]?.trim();
  if (!identifier) return conversation.jid;

  if (conversation.is_group || domain === 'g.us') return `Group ID: ${identifier}`;
  if (domain === 's.whatsapp.net' && /^\d+$/.test(identifier)) return `+${identifier}`;
  if (domain === 'lid') return `WhatsApp ID: ${identifier}`;
  return conversation.jid;
}

export function formatTransferRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatMediaSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function safeMediaDownloadName(fileName: string | null | undefined): {
  name: string;
  blockedExtension: string | null;
} {
  const original =
    (fileName ?? 'attachment')
      .normalize('NFC')
      .replace(/[\\/\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '_')
      .trim()
      .replace(/[. ]+$/u, '')
      .slice(0, 200) || 'attachment';
  const extension = original.match(/\.([a-z0-9]{1,12})$/iu)?.[1]?.toLowerCase();
  if (extension && BLOCKED_DOWNLOAD_EXTENSIONS.has(extension)) {
    return { name: `${original}.download`, blockedExtension: `.${extension}` };
  }
  return { name: original, blockedExtension: null };
}

export function messageFallbackLabel(providerType?: string | null): string {
  return providerType ? (providerTypeLabels[providerType] ?? 'Unsupported message type') : '';
}

export function summarizeReactions(reactions: Message['reactions'] = []) {
  const summary = new Map<string, { emoji: string; count: number; includesMe: boolean }>();
  for (const reaction of reactions) {
    const current = summary.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      count: 0,
      includesMe: false,
    };
    current.count++;
    current.includesMe ||= reaction.is_from_me;
    summary.set(reaction.emoji, current);
  }
  return [...summary.values()];
}

export function mediaLoadFailureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError')
    return 'Download cancelled. Try again when ready.';
  const message = error instanceof Error ? error.message : '';
  if (message.includes('10 MiB'))
    return 'This media exceeds the 10 MiB limit and cannot be cached.';
  if (error instanceof ApiError && error.status === 404)
    return 'This attachment is no longer available.';
  if (message === 'Media storage is temporarily unavailable')
    return 'Attachment storage is temporarily unavailable. Try again.';
  if (error instanceof ApiError && (error.status === 502 || message.includes('WhatsApp gateway')))
    return 'WhatsApp could not retrieve this attachment. Try again.';
  if (error instanceof ApiError && error.status === 503)
    return 'WhatsApp services are temporarily busy. Try again.';
  return 'Attachment could not be loaded. Try again.';
}

export function readWhatsAppInboxPreferences(key: string): WhatsAppInboxPreferences {
  try {
    if (typeof window === 'undefined') return { ...defaultInboxPreferences };
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...defaultInboxPreferences };
    const value = JSON.parse(raw) as Partial<WhatsAppInboxPreferences>;
    const validFilters: ConversationFilter[] = ['all', 'unread', 'private', 'groups'];
    const validQueueFilters: QueueFilter[] = ['all', 'mine', 'unassigned'];
    const validWorkStates: WorkStateFilter[] = ['all', 'open', 'closed'];
    return {
      selectedConversationId:
        typeof value.selectedConversationId === 'number' &&
        Number.isSafeInteger(value.selectedConversationId) &&
        value.selectedConversationId > 0
          ? value.selectedConversationId
          : null,
      selectedLabelId:
        typeof value.selectedLabelId === 'number' &&
        Number.isSafeInteger(value.selectedLabelId) &&
        value.selectedLabelId > 0
          ? value.selectedLabelId
          : null,
      conversationFilter: validFilters.includes(value.conversationFilter as ConversationFilter)
        ? (value.conversationFilter as ConversationFilter)
        : defaultInboxPreferences.conversationFilter,
      queueFilter: validQueueFilters.includes(value.queueFilter as QueueFilter)
        ? (value.queueFilter as QueueFilter)
        : defaultInboxPreferences.queueFilter,
      teamId:
        typeof value.teamId === 'number' && Number.isSafeInteger(value.teamId) && value.teamId > 0
          ? value.teamId
          : null,
      workStateFilter: validWorkStates.includes(value.workStateFilter as WorkStateFilter)
        ? (value.workStateFilter as WorkStateFilter)
        : defaultInboxPreferences.workStateFilter,
      showArchived: typeof value.showArchived === 'boolean' ? value.showArchived : false,
      sendOnEnter: typeof value.sendOnEnter === 'boolean' ? value.sendOnEnter : true,
    };
  } catch {
    return { ...defaultInboxPreferences };
  }
}
