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
}

const DEFAULT_LOGGED_OUT_CODE = 401;
const DEFAULT_RECONNECT_DELAY_MS = 1_500;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
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

  async sendText(
    deviceId: string,
    recipient: string,
    text: string,
    options: { replyToMessageId?: string; mentions?: string[] } = {}
  ): Promise<BaileysSendResult> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    const content: Record<string, unknown> = { text };
    if (options.mentions?.length) {
      content.mentions = options.mentions;
    }
    const sendOptions = options.replyToMessageId
      ? { quoted: { key: { remoteJid: jid, id: options.replyToMessageId } } }
      : undefined;
    const raw = await socket.sendMessage(jid, content, sendOptions);
    return {
      messageId: raw?.key?.id ?? `baileys-${Date.now()}`,
      jid,
      raw,
    };
  }

  async sendMedia(
    deviceId: string,
    recipient: string,
    media: BaileysSendMediaInput
  ): Promise<BaileysSendResult> {
    const socket = this.requireConnectedSocket(deviceId);
    const jid = normalizeTargetJid(recipient);
    const content = this.buildMediaContent(media);
    const raw = await socket.sendMessage(jid, content);
    return {
      messageId: raw?.key?.id ?? `baileys-${Date.now()}`,
      jid,
      raw,
    };
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
    };
    this.sessions.set(deviceId, session);
    return session;
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
