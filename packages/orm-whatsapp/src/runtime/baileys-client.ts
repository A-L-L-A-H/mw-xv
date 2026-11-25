import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { baileysAuthDir } from './config.js';
import { GowaError } from './gowa-client.js';

export type BaileysSessionLifecycleStatus =
  'disconnected' | 'connecting' | 'qr' | 'connected' | 'reconnecting';

export interface BaileysConnectionUpdate {
  connection?: 'open' | 'close' | 'connecting';
  lastDisconnect?: { error?: unknown };
  qr?: string;
  isNewLogin?: boolean;
}

export interface BaileysMessageKey {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
  participant?: string;
}

export interface BaileysUpsertMessage {
  key?: BaileysMessageKey;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | { toNumber?: () => number };
  pushName?: string | null;
}

export interface BaileysMessagesUpsertPayload {
  messages: BaileysUpsertMessage[];
  type: string;
}

export interface BaileysInboundMessageEvent {
  deviceId: string;
  type: string;
  messages: BaileysUpsertMessage[];
}

export interface BaileysSessionConnectionEvent {
  deviceId: string;
  status: BaileysSessionLifecycleStatus;
  isConnected: boolean;
  isLoggedIn: boolean;
  jid: string | null;
  qr: string | null;
}

export interface BaileysGroupParticipant {
  id: string;
  admin?: string | null;
  phoneNumber?: string;
}

export interface BaileysGroupMetadata {
  id?: string;
  subject?: string;
  desc?: string;
  size?: number;
  restrict?: boolean;
  announce?: boolean;
  ephemeralDuration?: number;
  participants?: BaileysGroupParticipant[];
}

export interface BaileysCachedChat {
  jid: string;
  name: string;
  archived: boolean;
  pinned: boolean;
  lastMessageTime: string;
}

export interface BaileysCachedMessage {
  id: string;
  chatJid: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  mediaType: string;
  sender: string | null;
  senderDisplayName: string | null;
}

export interface BaileysSocket {
  user?: { id?: string; name?: string };
  ev: {
    on(event: string, listener: (...args: unknown[]) => void): void;
    off?(event: string, listener: (...args: unknown[]) => void): void;
  };
  sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ key?: BaileysMessageKey } | undefined>;
  requestPairingCode?(phoneNumber: string): Promise<string>;
  readMessages?(keys: BaileysMessageKey[]): Promise<void>;
  sendPresenceUpdate?(type: string, toJid?: string): Promise<void>;
  onWhatsApp?(...jids: string[]): Promise<Array<{ exists?: boolean; jid?: string }>>;
  fetchStatus?(
    jid: string
  ): Promise<
    { status?: string; setAt?: Date } | Array<{ status?: { status?: string } | string }> | undefined
  >;
  profilePictureUrl?(jid: string, type?: 'image' | 'preview'): Promise<string | undefined>;
  chatModify?(mod: Record<string, unknown>, jid: string): Promise<void>;
  groupCreate?(subject: string, participants: string[]): Promise<{ id?: string } | undefined>;
  groupMetadata?(jid: string): Promise<BaileysGroupMetadata | undefined>;
  groupParticipantsUpdate?(
    jid: string,
    participants: string[],
    action: 'add' | 'remove' | 'promote' | 'demote'
  ): Promise<Array<{ status?: string; jid?: string }> | undefined>;
  groupSettingUpdate?(
    jid: string,
    setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'
  ): Promise<void>;
  groupInviteCode?(jid: string): Promise<string | undefined>;
  groupRevokeInvite?(jid: string): Promise<string | undefined>;
  groupGetInviteInfo?(code: string): Promise<BaileysGroupMetadata | undefined>;
  groupAcceptInvite?(code: string): Promise<string | undefined>;
  groupLeave?(jid: string): Promise<void>;
  logout(): Promise<void>;
  end(error?: Error): void;
}

export interface BaileysAuthState {
  state: unknown;
  saveCreds: () => Promise<void>;
}

export type BaileysAuthStateFactory = (authDir: string) => Promise<BaileysAuthState>;

export interface BaileysSocketFactoryContext {
  deviceId: string;
  authDir: string;
  authState: unknown;
  version?: [number, number, number];
}

export type BaileysSocketFactory = (
  context: BaileysSocketFactoryContext
) => Promise<BaileysSocket> | BaileysSocket;

export interface BaileysQrGenerator {
  toBuffer(text: string): Promise<Buffer>;
  toDataURL(text: string): Promise<string>;
}

export interface BaileysDeviceStatus {
  deviceId: string;
  status: BaileysSessionLifecycleStatus;
  isConnected: boolean;
  isLoggedIn: boolean;
  jid: string | null;
  phoneNumber: string | null;
  qr: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  lastError: string | null;
}

export interface BaileysSendResult {
  messageId: string;
  jid: string;
  raw: unknown;
}

export interface BaileysSendMediaInput {
  type: 'image' | 'video' | 'audio' | 'document';
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
  ptt?: boolean;
  mentions?: string[];
  replyToMessageId?: string;
}

export interface BaileysSendStatusInput {
  text?: string;
  media?: {
    type: 'image' | 'video';
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
    caption?: string;
  };
  statusJidList?: string[];
  backgroundColor?: string;
  font?: number;
}

export interface BaileysGatewayManagerOptions {
  authDir?: string;
  socketFactory?: BaileysSocketFactory;
  qrGenerator?: BaileysQrGenerator;
  authStateFactory?: BaileysAuthStateFactory;
  disconnectReasonLoggedOut?: number;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  onMessageUpsert?: (event: BaileysInboundMessageEvent) => void | Promise<void>;
  onConnectionUpdate?: (event: BaileysSessionConnectionEvent) => void | Promise<void>;
}

interface BaileysLoadedModule {
  makeWASocket: (config: Record<string, unknown>) => BaileysSocket;
  useMultiFileAuthState: (folder: string) => Promise<BaileysAuthState>;
  fetchLatestBaileysVersion?: () => Promise<{ version: [number, number, number] }>;
  DisconnectReason?: { loggedOut?: number };
}

interface QrCodeLoadedModule {
  toBuffer: (text: string, options?: Record<string, unknown>) => Promise<Buffer>;
  toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string>;
}

interface SessionState {
  deviceId: string;
  authDir: string;
  socket: BaileysSocket | null;
  status: BaileysSessionLifecycleStatus;
  isConnected: boolean;
  isLoggedIn: boolean;
  jid: string | null;
  phoneNumber: string | null;
  qr: string | null;
  qrDataUrl: string | null;
  qrPng: Buffer | null;
  pairingCode: string | null;
  lastError: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  manuallyClosed: boolean;
  connectPromise: Promise<BaileysDeviceStatus> | null;
  chats: Map<string, BaileysCachedChat>;
  messagesByChat: Map<string, BaileysCachedMessage[]>;
}

const DEFAULT_LOGGED_OUT_CODE = 401;
const DEFAULT_RECONNECT_DELAY_MS = 1_500;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const MAX_CACHED_CHATS = 500;
const MAX_CACHED_MESSAGES_PER_CHAT = 200;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

function sanitizeDeviceId(deviceId: string): string {
  const trimmed = deviceId.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || !DEVICE_ID_PATTERN.test(trimmed)) {
    throw new GowaError('Invalid WhatsApp device identifier', 400, 'INVALID_DEVICE_ID');
  }
  return trimmed;
}

function normalizePhoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const userPart = jid.split('@')[0] ?? '';
  const basePhone = userPart.split(':')[0] ?? '';
  return basePhone || null;
}

function normalizeTargetJid(recipient: string): string {
  const trimmed = recipient.trim();
  if (!trimmed) {
    throw new GowaError('Recipient JID or phone number is required', 400, 'INVALID_RECIPIENT');
  }
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/gu, '');
  if (!digits) {
    throw new GowaError('Recipient JID or phone number is required', 400, 'INVALID_RECIPIENT');
  }
  return `${digits}@s.whatsapp.net`;
}

function extractInviteCode(linkOrCode: string): string {
  const trimmed = linkOrCode.trim();
  if (!trimmed) {
    throw new GowaError('Group invite link is required', 400, 'INVALID_INVITE_LINK');
  }
  try {
    const parsed = new URL(trimmed);
    const code = parsed.pathname.replace(/^\/+/u, '').split('/')[0] ?? '';
    if (!code) throw new Error('missing code');
    return code;
  } catch {
    if (/^[A-Za-z0-9_-]{8,128}$/u.test(trimmed)) return trimmed;
    throw new GowaError('Invalid WhatsApp group invite link', 400, 'INVALID_INVITE_LINK');
  }
}

function normalizeMessageTimestamp(value: BaileysUpsertMessage['messageTimestamp']): string {
  let seconds: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    seconds = value;
  } else if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) seconds = parsed;
  } else if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
    const parsed = value.toNumber();
    if (Number.isFinite(parsed)) seconds = parsed;
  }
  if (seconds === null) return new Date().toISOString();
  const millis = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(millis).toISOString();
}

function extractUpsertBody(message: Record<string, unknown> | null | undefined): {
  content: string;
  mediaType: string;
} {
  if (!message) return { content: '', mediaType: 'text' };
  if (typeof message.conversation === 'string') {
    return { content: message.conversation, mediaType: 'text' };
  }
  const extended = message.extendedTextMessage as { text?: unknown } | undefined;
  if (extended && typeof extended.text === 'string') {
    return { content: extended.text, mediaType: 'text' };
  }
  const imageMsg = message.imageMessage as { caption?: unknown } | undefined;
  if (imageMsg && typeof imageMsg === 'object') {
    return {
      content: typeof imageMsg.caption === 'string' ? imageMsg.caption : '',
      mediaType: 'image',
    };
  }
  const videoMsg = message.videoMessage as { caption?: unknown } | undefined;
  if (videoMsg && typeof videoMsg === 'object') {
    return {
      content: typeof videoMsg.caption === 'string' ? videoMsg.caption : '',
      mediaType: 'video',
    };
  }
  if (message.audioMessage && typeof message.audioMessage === 'object') {
    return { content: '', mediaType: 'audio' };
  }
  const docMsg = message.documentMessage as { caption?: unknown; fileName?: unknown } | undefined;
  if (docMsg && typeof docMsg === 'object') {
    return {
      content:
        typeof docMsg.caption === 'string'
          ? docMsg.caption
          : typeof docMsg.fileName === 'string'
            ? docMsg.fileName
            : '',
      mediaType: 'document',
    };
  }
  if (message.stickerMessage && typeof message.stickerMessage === 'object') {
    return { content: '', mediaType: 'sticker' };
  }
  return { content: '', mediaType: 'text' };
}

function extractDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { output?: { statusCode?: unknown }; statusCode?: unknown };
  if (typeof candidate.output?.statusCode === 'number') return candidate.output.statusCode;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

async function loadBaileysModule(): Promise<BaileysLoadedModule> {
  const specifier: string = '@whiskeysockets/baileys';
  let rawModule: Record<string, unknown>;
  try {
    rawModule = (await import(specifier)) as Record<string, unknown>;
  } catch (error) {
    throw new GowaError(
      `Baileys driver unavailable: ${error instanceof Error ? error.message : 'module load failed'}`,
      503,
      'BAILEYS_UNAVAILABLE'
    );
  }
  const makeWASocket =
    typeof rawModule.makeWASocket === 'function'
      ? (rawModule.makeWASocket as BaileysLoadedModule['makeWASocket'])
      : typeof rawModule.default === 'function'
        ? (rawModule.default as BaileysLoadedModule['makeWASocket'])
        : null;
  const useMultiFileAuthState =
    typeof rawModule.useMultiFileAuthState === 'function'
      ? (rawModule.useMultiFileAuthState as BaileysLoadedModule['useMultiFileAuthState'])
      : null;
  if (!makeWASocket || !useMultiFileAuthState) {
    throw new GowaError(
      'Invalid @whiskeysockets/baileys module exports',
      503,
      'BAILEYS_UNAVAILABLE'
    );
  }
  return {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion:
      typeof rawModule.fetchLatestBaileysVersion === 'function'
        ? (rawModule.fetchLatestBaileysVersion as BaileysLoadedModule['fetchLatestBaileysVersion'])
        : undefined,
    DisconnectReason:
      rawModule.DisconnectReason && typeof rawModule.DisconnectReason === 'object'
        ? (rawModule.DisconnectReason as { loggedOut?: number })
        : undefined,
  };
}

async function loadDefaultQrGenerator(): Promise<BaileysQrGenerator> {
  const specifier: string = 'qrcode';
  let mod: QrCodeLoadedModule;
  try {
    mod = (await import(specifier)) as QrCodeLoadedModule;
  } catch (error) {
    throw new GowaError(
      `QR generator unavailable: ${error instanceof Error ? error.message : 'module load failed'}`,
      503,
      'QR_UNAVAILABLE'
    );
  }
  return {
    toBuffer: (text: string) => mod.toBuffer(text, { type: 'png', margin: 2, width: 320 }),
    toDataURL: (text: string) => mod.toDataURL(text, { margin: 2, width: 320 }),
  };
}

export class BaileysGatewayManager {
  private readonly authRoot: string;
  private readonly socketFactory?: BaileysSocketFactory;
  private readonly customQrGenerator?: BaileysQrGenerator;
  private readonly authStateFactory?: BaileysAuthStateFactory;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly sessions = new Map<string, SessionState>();
  private readonly inboundListeners = new Set<
    (event: BaileysInboundMessageEvent) => void | Promise<void>
  >();
  private readonly onConnectionUpdate?: (
    event: BaileysSessionConnectionEvent
  ) => void | Promise<void>;
  private loggedOutCode: number;
  private cachedQrGenerator: BaileysQrGenerator | null = null;

  constructor(options: BaileysGatewayManagerOptions = {}) {
    this.authRoot = path.resolve(options.authDir ?? baileysAuthDir());
    this.socketFactory = options.socketFactory;
    this.customQrGenerator = options.qrGenerator;
    this.authStateFactory = options.authStateFactory;
    this.loggedOutCode = options.disconnectReasonLoggedOut ?? DEFAULT_LOGGED_OUT_CODE;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.onConnectionUpdate = options.onConnectionUpdate;
    if (options.onMessageUpsert) {
      this.inboundListeners.add(options.onMessageUpsert);
    }
  }

  onInboundMessage(
    handler: (event: BaileysInboundMessageEvent) => void | Promise<void>
  ): () => void {
    this.inboundListeners.add(handler);
    return () => {
      this.inboundListeners.delete(handler);
    };
  }

  getDeviceStatus(deviceId: string): BaileysDeviceStatus {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (!session) {
      return {
        deviceId: safeId,
        status: 'disconnected',
        isConnected: false,
        isLoggedIn: false,
        jid: null,
        phoneNumber: null,
        qr: null,
        qrDataUrl: null,
        pairingCode: null,
        lastError: null,
      };
    }
    return this.toDeviceStatus(session);
  }

  listDevices(): BaileysDeviceStatus[] {
    return [...this.sessions.values()].map((session) => this.toDeviceStatus(session));
  }

  async getQrPng(deviceId: string): Promise<Buffer | null> {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (!session) return null;
    if (session.qrPng) return session.qrPng;
    if (!session.qr) return null;
    const qrGen = await this.resolveQrGenerator();
    session.qrPng = await qrGen.toBuffer(session.qr);
    return session.qrPng;
  }

  async connect(
    deviceId: string,
    options: { phoneNumber?: string } = {}
  ): Promise<BaileysDeviceStatus> {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.getOrCreateSession(safeId);
    if (session.isConnected && session.isLoggedIn && session.socket) {
      return this.toDeviceStatus(session);
    }
    if (session.connectPromise) {
      return session.connectPromise;
    }

    session.manuallyClosed = false;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    const connectTask = this.openSession(session, options);
    session.connectPromise = connectTask;
    try {
      return await connectTask;
    } finally {
      if (session.connectPromise === connectTask) {
        session.connectPromise = null;
      }
    }
  }

  async requestPairingCode(deviceId: string, phoneNumber: string): Promise<string> {
    const safeId = sanitizeDeviceId(deviceId);
    const digits = phoneNumber.replace(/\D/gu, '');
    if (!digits) {
      throw new GowaError('Phone number is required for pairing code', 400, 'INVALID_PHONE');
    }
    await this.connect(safeId);
    const session = this.sessions.get(safeId);
    if (!session?.socket) {
      throw new GowaError('WhatsApp socket is not initialized', 503, 'SOCKET_NOT_READY');
    }
    if (typeof session.socket.requestPairingCode !== 'function') {
      throw new GowaError(
        'Pairing code is not supported by the active WhatsApp socket',
        501,
        'PAIRING_UNSUPPORTED'
      );
    }
    const code = await session.socket.requestPairingCode(digits);
    session.pairingCode = code;
    return code;
  }

  async reconnect(deviceId: string): Promise<BaileysDeviceStatus> {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (session) {
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      const existingSocket = session.socket;
      session.socket = null;
      session.isConnected = false;
      session.reconnectAttempts = 0;
      session.manuallyClosed = false;
      session.connectPromise = null;
      if (existingSocket) {
        try {
          existingSocket.end();
        } catch {
          // Ignore close errors while resetting the socket for reconnect.
        }
      }
    }
    return this.connect(safeId);
  }

  async sendText(
    deviceId: string,
    recipient: string,
    text: string,
    options: { replyToMessageId?: string; mentions?: string[] } = {}
  ): Promise<BaileysSendResult> {
    const safeId = sanitizeDeviceId(deviceId);
    const socket = this.requireConnectedSocket(safeId);
    const jid = normalizeTargetJid(recipient);
    const content: Record<string, unknown> = { text };
    if (options.mentions?.length) {
      content.mentions = options.mentions;
    }
    const sendOptions = options.replyToMessageId
      ? { quoted: { key: { remoteJid: jid, id: options.replyToMessageId } } }
      : undefined;
    const raw = await socket.sendMessage(jid, content, sendOptions);
    const messageId = raw?.key?.id ?? `baileys-${Date.now()}`;
    const session = this.sessions.get(safeId);
    if (session) {
      this.recordCachedMessage(session, {
        id: messageId,
        chatJid: jid,
        content: text,
        timestamp: new Date().toISOString(),
        isFromMe: true,
        mediaType: 'text',
        sender: session.jid,
        senderDisplayName: null,
      });
    }
    return {
      messageId,
      jid,
      raw,
    };
  }

  async sendMedia(
    deviceId: string,
    recipient: string,
    media: BaileysSendMediaInput
  ): Promise<BaileysSendResult> {
    const safeId = sanitizeDeviceId(deviceId);
    const socket = this.requireConnectedSocket(safeId);
    const jid = normalizeTargetJid(recipient);
    const content = this.buildMediaContent(media);
    const sendOptions = media.replyToMessageId
      ? { quoted: { key: { remoteJid: jid, id: media.replyToMessageId } } }
      : undefined;
    const raw = await socket.sendMessage(jid, content, sendOptions);
    const messageId = raw?.key?.id ?? `baileys-${Date.now()}`;
    const session = this.sessions.get(safeId);
    if (session) {
      this.recordCachedMessage(session, {
        id: messageId,
        chatJid: jid,
        content: media.caption ?? media.fileName ?? '',
        timestamp: new Date().toISOString(),
        isFromMe: true,
        mediaType: media.type,
        sender: session.jid,
        senderDisplayName: null,
      });
    }
    return {
      messageId,
      jid,
      raw,
    };
  }

  async sendPresence(deviceId: string, presenceType: string, recipient?: string): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.sendPresenceUpdate === 'function') {
      const targetJid = recipient?.trim() ? normalizeTargetJid(recipient) : undefined;
      await socket.sendPresenceUpdate(presenceType, targetJid);
    }
  }

  async sendReaction(
    deviceId: string,
    recipient: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    await socket.sendMessage(jid, {
      react: {
        text: emoji,
        key: { remoteJid: jid, id: messageId },
      },
    });
  }

  async editMessage(
    deviceId: string,
    recipient: string,
    messageId: string,
    text: string
  ): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    await socket.sendMessage(jid, {
      text,
      edit: { remoteJid: jid, id: messageId, fromMe: true },
    });
  }

  async revokeMessage(deviceId: string, recipient: string, messageId: string): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    await socket.sendMessage(jid, {
      delete: { remoteJid: jid, id: messageId, fromMe: true },
    });
  }

  async checkNumber(deviceId: string, phone: string): Promise<boolean> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.onWhatsApp !== 'function') {
      throw new GowaError(
        'WhatsApp number verification is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const jid = normalizeTargetJid(phone);
    const results = await socket.onWhatsApp(jid);
    return Boolean(results?.[0]?.exists);
  }

  async getUserInfo(
    deviceId: string,
    recipient: string
  ): Promise<{ jid: string; verifiedName: string | null; status: string | null }> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    let userStatus: string | null = null;
    if (typeof socket.fetchStatus === 'function') {
      try {
        const fetched = await socket.fetchStatus(jid);
        if (Array.isArray(fetched)) {
          const entry = fetched[0];
          if (typeof entry?.status === 'string') {
            userStatus = entry.status;
          } else if (entry?.status && typeof entry.status.status === 'string') {
            userStatus = entry.status.status;
          }
        } else if (fetched && typeof fetched.status === 'string') {
          userStatus = fetched.status;
        }
      } catch {
        // Privacy settings may disallow status lookups.
      }
    }
    return { jid, verifiedName: null, status: userStatus };
  }

  async getAvatarUrl(
    deviceId: string,
    recipient: string,
    isPreview = true
  ): Promise<string | null> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.profilePictureUrl !== 'function') return null;
    const jid = normalizeTargetJid(recipient);
    try {
      const url = await socket.profilePictureUrl(jid, isPreview ? 'preview' : 'image');
      return typeof url === 'string' && url ? url : null;
    } catch {
      return null;
    }
  }

  listChats(
    deviceId: string,
    options: { limit?: number; offset?: number; archived?: boolean; search?: string } = {}
  ): BaileysCachedChat[] {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (!session) return [];
    const searchLower = options.search?.trim().toLowerCase() ?? '';
    const filtered = [...session.chats.values()]
      .filter((chat) => options.archived === undefined || chat.archived === options.archived)
      .filter(
        (chat) =>
          !searchLower ||
          chat.name.toLowerCase().includes(searchLower) ||
          chat.jid.toLowerCase().includes(searchLower)
      )
      .sort((left, right) => Date.parse(right.lastMessageTime) - Date.parse(left.lastMessageTime));
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, options.limit ?? 100);
    return filtered.slice(offset, offset + limit);
  }

  listChatMessages(
    deviceId: string,
    jid: string,
    options: { limit?: number; offset?: number; startTime?: string } = {}
  ): BaileysCachedMessage[] {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (!session) return [];
    const targetJid = normalizeTargetJid(jid);
    const startMs = options.startTime ? Date.parse(options.startTime) : NaN;
    const entries = session.messagesByChat.get(targetJid) ?? [];
    const filtered = Number.isFinite(startMs)
      ? entries.filter((entry) => Date.parse(entry.timestamp) >= startMs)
      : entries;
    const ordered = [...filtered].sort(
      (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
    );
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, options.limit ?? 100);
    return ordered.slice(offset, offset + limit);
  }

  async setChatArchived(deviceId: string, jid: string, archived: boolean): Promise<void> {
    const safeId = sanitizeDeviceId(deviceId);
    const socket = this.requireConnectedSocket(safeId);
    const targetJid = normalizeTargetJid(jid);
    if (typeof socket.chatModify === 'function') {
      await socket.chatModify({ archive: archived, lastMessages: [] }, targetJid);
    }
    const existing = this.sessions.get(safeId)?.chats.get(targetJid);
    if (existing) existing.archived = archived;
  }

  async setChatPinned(deviceId: string, jid: string, pinned: boolean): Promise<void> {
    const safeId = sanitizeDeviceId(deviceId);
    const socket = this.requireConnectedSocket(safeId);
    const targetJid = normalizeTargetJid(jid);
    if (typeof socket.chatModify === 'function') {
      await socket.chatModify({ pin: pinned }, targetJid);
    }
    const existing = this.sessions.get(safeId)?.chats.get(targetJid);
    if (existing) existing.pinned = pinned;
  }

  async createGroup(deviceId: string, title: string, participants: string[]): Promise<string> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupCreate !== 'function') {
      throw new GowaError(
        'Group creation is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const participantJids = participants.map((entry) => normalizeTargetJid(entry));
    const created = await socket.groupCreate(title, participantJids);
    if (!created?.id) {
      throw new GowaError('WhatsApp did not return a group identifier', 502, 'GROUP_CREATE_FAILED');
    }
    return created.id;
  }

  async getGroupMetadata(deviceId: string, groupJid: string): Promise<BaileysGroupMetadata> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupMetadata !== 'function') {
      throw new GowaError(
        'Group metadata lookup is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const metadata = await socket.groupMetadata(groupJid);
    if (!metadata) {
      throw new GowaError('WhatsApp group not found', 404, 'GROUP_NOT_FOUND');
    }
    return metadata;
  }

  async updateGroupParticipants(
    deviceId: string,
    groupJid: string,
    participants: string[],
    action: 'add' | 'remove' | 'promote' | 'demote'
  ): Promise<Array<{ participant: string; status: string }>> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupParticipantsUpdate !== 'function') {
      throw new GowaError(
        'Group participant updates are not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const participantJids = participants.map((entry) => normalizeTargetJid(entry));
    const updated = await socket.groupParticipantsUpdate(groupJid, participantJids, action);
    if (!Array.isArray(updated)) {
      return participantJids.map((jid) => ({ participant: jid, status: 'success' }));
    }
    return updated.map((entry, index) => ({
      participant: entry.jid ?? participantJids[index] ?? '',
      status:
        !entry.status || entry.status === '200' || entry.status === 'success'
          ? 'success'
          : entry.status,
    }));
  }

  async updateGroupSetting(
    deviceId: string,
    groupJid: string,
    setting: 'locked' | 'announce',
    enabled: boolean
  ): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupSettingUpdate !== 'function') {
      throw new GowaError(
        'Group setting updates are not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const baileysSetting =
      setting === 'locked'
        ? enabled
          ? 'locked'
          : 'unlocked'
        : enabled
          ? 'announcement'
          : 'not_announcement';
    await socket.groupSettingUpdate(groupJid, baileysSetting);
  }

  async getGroupInviteLink(deviceId: string, groupJid: string, reset = false): Promise<string> {
    const socket = this.requireConnectedSocket(deviceId);
    const code = reset
      ? typeof socket.groupRevokeInvite === 'function'
        ? await socket.groupRevokeInvite(groupJid)
        : undefined
      : typeof socket.groupInviteCode === 'function'
        ? await socket.groupInviteCode(groupJid)
        : undefined;
    if (!code) {
      throw new GowaError(
        'Group invite link is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    return code.startsWith('https://chat.whatsapp.com/')
      ? code
      : `https://chat.whatsapp.com/${code}`;
  }

  async getGroupInfoFromLink(deviceId: string, link: string): Promise<BaileysGroupMetadata> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupGetInviteInfo !== 'function') {
      throw new GowaError(
        'Group invite preview is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const code = extractInviteCode(link);
    const info = await socket.groupGetInviteInfo(code);
    if (!info) {
      throw new GowaError('WhatsApp group invite not found', 404, 'INVITE_NOT_FOUND');
    }
    return info;
  }

  async joinGroupWithLink(deviceId: string, link: string): Promise<string> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupAcceptInvite !== 'function') {
      throw new GowaError(
        'Group join by link is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    const code = extractInviteCode(link);
    const groupId = await socket.groupAcceptInvite(code);
    return groupId ?? '';
  }

  async leaveGroup(deviceId: string, groupJid: string): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.groupLeave !== 'function') {
      throw new GowaError(
        'Leaving groups is not supported by the active socket',
        501,
        'NOT_IMPLEMENTED'
      );
    }
    await socket.groupLeave(groupJid);
  }

  async sendStatus(deviceId: string, payload: BaileysSendStatusInput): Promise<BaileysSendResult> {
    const socket = this.requireConnectedSocket(deviceId);
    if (!payload.media && !payload.text?.trim()) {
      throw new GowaError('Status must contain text or media', 400, 'INVALID_STATUS');
    }
    const content: Record<string, unknown> = payload.media
      ? this.buildMediaContent({
          type: payload.media.type,
          buffer: payload.media.buffer,
          mimeType: payload.media.mimeType,
          fileName: payload.media.fileName,
          caption: payload.media.caption ?? payload.text,
        })
      : { text: payload.text ?? '' };
    const options: Record<string, unknown> = {
      statusJidList: payload.statusJidList ?? [],
    };
    if (payload.backgroundColor) options.backgroundColor = payload.backgroundColor;
    if (payload.font !== undefined) options.font = payload.font;
    const raw = await socket.sendMessage('status@broadcast', content, options);
    return {
      messageId: raw?.key?.id ?? `baileys-status-${Date.now()}`,
      jid: 'status@broadcast',
      raw,
    };
  }

  async markRead(deviceId: string, keys: BaileysMessageKey[]): Promise<void> {
    const socket = this.requireConnectedSocket(deviceId);
    if (typeof socket.readMessages === 'function' && keys.length > 0) {
      await socket.readMessages(keys);
    }
  }

  async logout(deviceId: string): Promise<void> {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    const sessionAuthDir = session?.authDir ?? path.join(this.authRoot, safeId);
    if (session) {
      session.manuallyClosed = true;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      if (session.socket) {
        await session.socket.logout().catch(() => undefined);
        try {
          session.socket.end();
        } catch {
          // Ignore close errors during logout cleanup.
        }
        session.socket = null;
      }
      this.sessions.delete(safeId);
    }
    await rm(sessionAuthDir, { recursive: true, force: true });
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.manuallyClosed = true;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      if (session.socket) {
        try {
          session.socket.end();
        } catch {
          // Ignore close errors during shutdown.
        }
        session.socket = null;
      }
      session.isConnected = false;
    }
    this.sessions.clear();
  }

  private getOrCreateSession(deviceId: string): SessionState {
    const existing = this.sessions.get(deviceId);
    if (existing) return existing;
    const session: SessionState = {
      deviceId,
      authDir: path.join(this.authRoot, deviceId),
      socket: null,
      status: 'disconnected',
      isConnected: false,
      isLoggedIn: false,
      jid: null,
      phoneNumber: null,
      qr: null,
      qrDataUrl: null,
      qrPng: null,
      pairingCode: null,
      lastError: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      manuallyClosed: false,
      connectPromise: null,
      chats: new Map(),
      messagesByChat: new Map(),
    };
    this.sessions.set(deviceId, session);
    return session;
  }

  private recordCachedMessage(session: SessionState, message: BaileysCachedMessage): void {
    const chatJid = message.chatJid;
    if (!chatJid || chatJid === 'status@broadcast') return;
    const existingChat = session.chats.get(chatJid);
    if (existingChat) {
      if (Date.parse(message.timestamp) >= Date.parse(existingChat.lastMessageTime)) {
        existingChat.lastMessageTime = message.timestamp;
      }
      if (!message.isFromMe && message.senderDisplayName && existingChat.name === chatJid) {
        existingChat.name = message.senderDisplayName;
      }
    } else {
      if (session.chats.size >= MAX_CACHED_CHATS) {
        const oldestKey = session.chats.keys().next().value;
        if (oldestKey) {
          session.chats.delete(oldestKey);
          session.messagesByChat.delete(oldestKey);
        }
      }
      session.chats.set(chatJid, {
        jid: chatJid,
        name: !message.isFromMe && message.senderDisplayName ? message.senderDisplayName : chatJid,
        archived: false,
        pinned: false,
        lastMessageTime: message.timestamp,
      });
    }
    const existingMessages = session.messagesByChat.get(chatJid) ?? [];
    const existingIndex = existingMessages.findIndex((entry) => entry.id === message.id);
    if (existingIndex >= 0) {
      existingMessages[existingIndex] = message;
    } else {
      existingMessages.push(message);
      if (existingMessages.length > MAX_CACHED_MESSAGES_PER_CHAT) {
        existingMessages.splice(0, existingMessages.length - MAX_CACHED_MESSAGES_PER_CHAT);
      }
    }
    session.messagesByChat.set(chatJid, existingMessages);
  }

  private requireConnectedSocket(deviceId: string): BaileysSocket {
    const safeId = sanitizeDeviceId(deviceId);
    const session = this.sessions.get(safeId);
    if (!session?.socket || !session.isConnected) {
      throw new GowaError('WhatsApp device is not connected', 409, 'NOT_CONNECTED');
    }
    return session.socket;
  }

  private buildMediaContent(media: BaileysSendMediaInput): Record<string, unknown> {
    if (media.type === 'image') {
      return {
        image: media.buffer,
        mimetype: media.mimeType,
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.mentions?.length ? { mentions: media.mentions } : {}),
      };
    }
    if (media.type === 'video') {
      return {
        video: media.buffer,
        mimetype: media.mimeType,
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.mentions?.length ? { mentions: media.mentions } : {}),
      };
    }
    if (media.type === 'audio') {
      return {
        audio: media.buffer,
        mimetype: media.mimeType,
        ptt: Boolean(media.ptt),
      };
    }
    return {
      document: media.buffer,
      mimetype: media.mimeType,
      fileName: media.fileName ?? 'attachment',
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.mentions?.length ? { mentions: media.mentions } : {}),
    };
  }

  private async resolveQrGenerator(): Promise<BaileysQrGenerator> {
    if (this.customQrGenerator) return this.customQrGenerator;
    if (!this.cachedQrGenerator) {
      this.cachedQrGenerator = await loadDefaultQrGenerator();
    }
    return this.cachedQrGenerator;
  }

  private async openSession(
    session: SessionState,
    options: { phoneNumber?: string }
  ): Promise<BaileysDeviceStatus> {
    session.status = 'connecting';
    session.lastError = null;
    await mkdir(session.authDir, { recursive: true });

    let baileysModule: BaileysLoadedModule | null = null;
    if (!this.socketFactory || !this.authStateFactory) {
      try {
        baileysModule = await loadBaileysModule();
        if (typeof baileysModule.DisconnectReason?.loggedOut === 'number') {
          this.loggedOutCode = baileysModule.DisconnectReason.loggedOut;
        }
      } catch (error) {
        if (!this.socketFactory) throw error;
      }
    }

    const authState = this.authStateFactory
      ? await this.authStateFactory(session.authDir)
      : baileysModule
        ? await baileysModule.useMultiFileAuthState(session.authDir)
        : { state: {}, saveCreds: async () => undefined };

    let version: [number, number, number] | undefined;
    if (baileysModule?.fetchLatestBaileysVersion) {
      try {
        const fetched = await baileysModule.fetchLatestBaileysVersion();
        version = fetched.version;
      } catch {
        // Proceed with Baileys default version if version lookup is offline.
      }
    }

    const socket = this.socketFactory
      ? await this.socketFactory({
          deviceId: session.deviceId,
          authDir: session.authDir,
          authState: authState.state,
          version,
        })
      : baileysModule!.makeWASocket({
          auth: authState.state,
          ...(version ? { version } : {}),
          printQRInTerminal: false,
        });

    session.socket = socket;
    this.wireSocketEvents(session, socket, authState.saveCreds);

    if (options.phoneNumber && typeof socket.requestPairingCode === 'function') {
      const digits = options.phoneNumber.replace(/\D/gu, '');
      if (digits) {
        session.pairingCode = await socket.requestPairingCode(digits);
      }
    }

    return this.toDeviceStatus(session);
  }

  private wireSocketEvents(
    session: SessionState,
    socket: BaileysSocket,
    saveCreds: () => Promise<void>
  ): void {
    socket.ev.on('creds.update', () => {
      void Promise.resolve(saveCreds()).catch(() => undefined);
    });

    socket.ev.on('connection.update', (rawUpdate: unknown) => {
      if (session.socket !== socket) return;
      const update = (rawUpdate ?? {}) as BaileysConnectionUpdate;
      void this.handleConnectionUpdate(session, update);
    });

    socket.ev.on('messages.upsert', (rawEvent: unknown) => {
      if (session.socket !== socket) return;
      const payload = (rawEvent ?? {}) as Partial<BaileysMessagesUpsertPayload>;
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const type = typeof payload.type === 'string' ? payload.type : 'notify';
      for (const upsertMessage of messages) {
        const remoteJid = upsertMessage.key?.remoteJid;
        const messageId = upsertMessage.key?.id;
        if (!remoteJid || !messageId) continue;
        const extracted = extractUpsertBody(upsertMessage.message);
        this.recordCachedMessage(session, {
          id: messageId,
          chatJid: remoteJid,
          content: extracted.content,
          timestamp: normalizeMessageTimestamp(upsertMessage.messageTimestamp),
          isFromMe: upsertMessage.key?.fromMe === true,
          mediaType: extracted.mediaType,
          sender: upsertMessage.key?.participant ?? remoteJid,
          senderDisplayName:
            typeof upsertMessage.pushName === 'string' && upsertMessage.pushName.trim()
              ? upsertMessage.pushName.trim()
              : null,
        });
      }
      const event: BaileysInboundMessageEvent = {
        deviceId: session.deviceId,
        type,
        messages,
      };
      for (const listener of this.inboundListeners) {
        void Promise.resolve(listener(event)).catch(() => undefined);
      }
    });
  }

  private async handleConnectionUpdate(
    session: SessionState,
    update: BaileysConnectionUpdate
  ): Promise<void> {
    if (update.qr) {
      session.qr = update.qr;
      session.qrPng = null;
      session.qrDataUrl = null;
      session.status = 'qr';
      session.isConnected = false;
      try {
        const qrGen = await this.resolveQrGenerator();
        const [png, dataUrl] = await Promise.all([
          qrGen.toBuffer(update.qr),
          qrGen.toDataURL(update.qr),
        ]);
        session.qrPng = png;
        session.qrDataUrl = dataUrl;
      } catch (error) {
        session.lastError = error instanceof Error ? error.message : 'QR generation failed';
      }
      this.emitConnectionUpdate(session);
    }

    if (update.connection === 'open') {
      session.status = 'connected';
      session.isConnected = true;
      session.isLoggedIn = true;
      session.qr = null;
      session.qrPng = null;
      session.qrDataUrl = null;
      session.pairingCode = null;
      session.lastError = null;
      session.reconnectAttempts = 0;
      const jid = session.socket?.user?.id ?? session.jid;
      session.jid = jid ?? null;
      session.phoneNumber = normalizePhoneFromJid(jid) ?? session.phoneNumber;
      this.emitConnectionUpdate(session);
      return;
    }

    if (update.connection === 'close') {
      const statusCode = extractDisconnectStatusCode(update.lastDisconnect?.error);
      const isLoggedOut = statusCode === this.loggedOutCode;
      session.isConnected = false;
      session.socket = null;

      if (session.manuallyClosed || isLoggedOut) {
        session.isLoggedIn = false;
        session.status = 'disconnected';
        session.qr = null;
        session.qrPng = null;
        session.qrDataUrl = null;
        session.pairingCode = null;
        if (isLoggedOut) {
          session.jid = null;
          session.phoneNumber = null;
          session.lastError = 'WhatsApp session was logged out';
          await rm(session.authDir, { recursive: true, force: true }).catch(() => undefined);
        }
        this.emitConnectionUpdate(session);
        return;
      }

      if (session.reconnectAttempts >= this.maxReconnectAttempts) {
        session.status = 'disconnected';
        session.lastError = 'WhatsApp reconnect limit reached';
        this.emitConnectionUpdate(session);
        return;
      }

      session.status = 'reconnecting';
      session.lastError =
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error.message
          : 'WhatsApp connection closed; reconnecting';
      const delay = this.reconnectDelayMs * Math.max(1, 2 ** session.reconnectAttempts);
      session.reconnectAttempts += 1;
      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        if (!session.manuallyClosed) {
          void this.connect(session.deviceId).catch(() => undefined);
        }
      }, delay);
      this.emitConnectionUpdate(session);
    }
  }

  private emitConnectionUpdate(session: SessionState): void {
    if (!this.onConnectionUpdate) return;
    void Promise.resolve(
      this.onConnectionUpdate({
        deviceId: session.deviceId,
        status: session.status,
        isConnected: session.isConnected,
        isLoggedIn: session.isLoggedIn,
        jid: session.jid,
        qr: session.qr,
      })
    ).catch(() => undefined);
  }

  private toDeviceStatus(session: SessionState): BaileysDeviceStatus {
    return {
      deviceId: session.deviceId,
      status: session.status,
      isConnected: session.isConnected,
      isLoggedIn: session.isLoggedIn,
      jid: session.jid,
      phoneNumber: session.phoneNumber,
      qr: session.qr,
      qrDataUrl: session.qrDataUrl,
      pairingCode: session.pairingCode,
      lastError: session.lastError,
    };
  }
}
