import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';
import {
  BaileysGatewayManager,
  GowaError,
  baileysAuthDir,
  setBaileysGatewayManager,
  whatsappDriver,
  whatsappGatewayBinary,
  whatsappGatewayRequest,
  type BaileysInboundMessageEvent,
  type BaileysQrGenerator,
  type BaileysSocket,
} from '../src/index.js';

class MockBaileysSocket implements BaileysSocket {
  readonly ev = new EventEmitter();
  user?: { id?: string; name?: string };
  readonly sentMessages: Array<{
    jid: string;
    content: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];
  readonly readKeys: Array<Record<string, unknown>> = [];
  logoutCalls = 0;
  endCalls = 0;
  pairingCodeValue = '1234-5678';

  async sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    this.sentMessages.push({ jid, content, options });
    return {
      key: {
        id: `msg-${this.sentMessages.length}`,
        remoteJid: jid,
        fromMe: true,
      },
    };
  }

  async requestPairingCode(_phoneNumber: string): Promise<string> {
    return this.pairingCodeValue;
  }

  async readMessages(keys: Array<{ remoteJid?: string; id?: string; participant?: string }>) {
    this.readKeys.push(...keys);
  }

  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }

  end(): void {
    this.endCalls += 1;
  }
}

const stubQrGenerator: BaileysQrGenerator = {
  async toBuffer(text: string): Promise<Buffer> {
    return Buffer.from(`PNG:${text}`, 'utf8');
  },
  async toDataURL(text: string): Promise<string> {
    return `data:image/png;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
  },
};

const tempDirs: string[] = [];

async function makeTempAuthDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-baileys-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  setBaileysGatewayManager(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('@moonwitness/orm-whatsapp Baileys driver & gateway', () => {
  it('selects whatsappDriver() and resolves baileysAuthDir() from env', () => {
    assert.equal(whatsappDriver({}), 'baileys');
    assert.equal(whatsappDriver({ WHATSAPP_GOWA_BASE_URL: 'http://127.0.0.1:3000' }), 'gowa');
    assert.equal(
      whatsappDriver({
        WHATSAPP_DRIVER: 'baileys',
        WHATSAPP_GOWA_BASE_URL: 'http://127.0.0.1:3000',
      }),
      'baileys'
    );
    assert.equal(whatsappDriver({ WHATSAPP_DRIVER: 'gowa' }), 'gowa');
    assert.equal(baileysAuthDir({}), path.resolve('.moonwitness/whatsapp-baileys-auth'));
    assert.equal(
      baileysAuthDir({ WHATSAPP_BAILEYS_AUTH_DIR: '/var/lib/mw/wa-auth' }),
      path.resolve('/var/lib/mw/wa-auth')
    );
  });

  it('connects session, generates QR PNG + data URL, supports pairing code, and transitions to connected', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    let saveCredsCalls = 0;

    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({
        state: {},
        saveCreds: async () => {
          saveCredsCalls += 1;
        },
      }),
      socketFactory: async () => socket,
    });

    const initial = await manager.connect('company-1', { phoneNumber: '+62 812-3456-7890' });
    assert.equal(initial.deviceId, 'company-1');
    assert.equal(initial.status, 'connecting');
    assert.equal(initial.pairingCode, '1234-5678');

    socket.ev.emit('creds.update');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(saveCredsCalls, 1);

    socket.ev.emit('connection.update', { qr: 'qr-payload-abc' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const qrStatus = manager.getDeviceStatus('company-1');
    assert.equal(qrStatus.status, 'qr');
    assert.equal(qrStatus.qr, 'qr-payload-abc');
    assert.ok(qrStatus.qrDataUrl?.startsWith('data:image/png;base64,'));
    const png = await manager.getQrPng('company-1');
    assert.equal(png?.toString('utf8'), 'PNG:qr-payload-abc');

    socket.user = { id: '6281234567890:15@s.whatsapp.net' };
    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const openStatus = manager.getDeviceStatus('company-1');
    assert.equal(openStatus.status, 'connected');
    assert.equal(openStatus.isConnected, true);
    assert.equal(openStatus.isLoggedIn, true);
    assert.equal(openStatus.phoneNumber, '6281234567890');
    assert.equal(openStatus.qr, null);
    assert.equal(await manager.getQrPng('company-1'), null);

    await manager.closeAll();
    assert.equal(socket.endCalls, 1);
  });

  it('sends text, media, and status updates and bridges inbound messages.upsert', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    socket.user = { id: '628111222333@s.whatsapp.net' };
    const inboundEvents: BaileysInboundMessageEvent[] = [];

    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => socket,
      onMessageUpsert: (event) => {
        inboundEvents.push(event);
      },
    });

    await manager.connect('dev-send');
    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const textResult = await manager.sendText('dev-send', '628999888777', 'Hello Baileys', {
      replyToMessageId: 'orig-1',
    });
    assert.equal(textResult.jid, '628999888777@s.whatsapp.net');
    assert.equal(textResult.messageId, 'msg-1');
    assert.deepEqual(socket.sentMessages[0]?.content, { text: 'Hello Baileys' });

    const imgBuf = Buffer.from('fake-image');
    const mediaResult = await manager.sendMedia('dev-send', '120363001@g.us', {
      type: 'image',
      buffer: imgBuf,
      mimeType: 'image/png',
      caption: 'Photo',
    });
    assert.equal(mediaResult.jid, '120363001@g.us');
    assert.equal(socket.sentMessages[1]?.content.mimetype, 'image/png');
    assert.equal(socket.sentMessages[1]?.content.caption, 'Photo');

    const docBuf = Buffer.from('pdf-bytes');
    await manager.sendMedia('dev-send', '628999888777@s.whatsapp.net', {
      type: 'document',
      buffer: docBuf,
      mimeType: 'application/pdf',
      fileName: 'invoice.pdf',
    });
    assert.equal(socket.sentMessages[2]?.content.fileName, 'invoice.pdf');

    const statusResult = await manager.sendStatus('dev-send', {
      text: 'Daily update',
      statusJidList: ['628999888777@s.whatsapp.net'],
    });
    assert.equal(statusResult.jid, 'status@broadcast');
    assert.deepEqual(socket.sentMessages[3]?.content, { text: 'Daily update' });

    socket.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'in-1', remoteJid: '628999888777@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Hi there' },
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(inboundEvents.length, 1);
    assert.equal(inboundEvents[0]?.deviceId, 'dev-send');
    assert.equal(inboundEvents[0]?.messages[0]?.key?.id, 'in-1');

    await manager.closeAll();
  });

  it('auto-reconnects on transient close but cleans up without reconnect on loggedOut', async () => {
    const authDir = await makeTempAuthDir();
    const sockets: MockBaileysSocket[] = [];

    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      reconnectDelayMs: 15,
      authStateFactory: async (dir) => {
        await writeFile(path.join(dir, 'creds.json'), '{}', 'utf8');
        return { state: {}, saveCreds: async () => undefined };
      },
      socketFactory: async () => {
        const sock = new MockBaileysSocket();
        sock.user = { id: '628111000@s.whatsapp.net' };
        sockets.push(sock);
        return sock;
      },
    });

    await manager.connect('dev-reconn');
    sockets[0]!.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Transient disconnect (status 515) triggers reconnect
    sockets[0]!.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 515 } } },
    });
    assert.equal(manager.getDeviceStatus('dev-reconn').status, 'reconnecting');

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sockets.length, 2);

    // loggedOut (401) stops reconnecting and wipes auth directory
    const sessionAuthPath = path.join(authDir, 'dev-reconn');
    assert.equal(existsSync(sessionAuthPath), true);

    sockets[1]!.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(sockets.length, 2);
    const finalStatus = manager.getDeviceStatus('dev-reconn');
    assert.equal(finalStatus.status, 'disconnected');
    assert.equal(finalStatus.isLoggedIn, false);
    assert.equal(existsSync(sessionAuthPath), false);
  });

  it('cleans up socket and auth files on explicit logout', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async (dir) => {
        await writeFile(path.join(dir, 'creds.json'), '{}', 'utf8');
        return { state: {}, saveCreds: async () => undefined };
      },
      socketFactory: async () => socket,
    });

    await manager.connect('dev-logout');
    const sessionAuthPath = path.join(authDir, 'dev-logout');
    assert.equal(existsSync(sessionAuthPath), true);

    await manager.logout('dev-logout');
    assert.equal(socket.logoutCalls, 1);
    assert.equal(socket.endCalls, 1);
    assert.equal(existsSync(sessionAuthPath), false);
    assert.equal(manager.getDeviceStatus('dev-logout').status, 'disconnected');
  });

  it('routes whatsappGatewayRequest and whatsappGatewayBinary between Baileys and GoWA', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    socket.user = { id: '628555444333@s.whatsapp.net' };

    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => socket,
    });
    setBaileysGatewayManager(manager);

    vi.stubEnv('WHATSAPP_DRIVER', 'baileys');

    const loginRes = await whatsappGatewayRequest<{ qr_link?: string; qr?: string }>(
      '/devices/dev-gw/login'
    );
    assert.equal(loginRes.qr_link, undefined);

    socket.ev.emit('connection.update', { qr: 'gw-qr-token' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const qrBinary = await whatsappGatewayBinary('/statics/qr/dev-gw.png');
    assert.equal(qrBinary.status, 200);
    assert.equal(qrBinary.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await qrBinary.arrayBuffer()).toString('utf8'), 'PNG:gw-qr-token');

    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const statusRes = await whatsappGatewayRequest<{
      is_connected: boolean;
      is_logged_in: boolean;
      jid: string | null;
    }>('/devices/dev-gw/status');
    assert.equal(statusRes.is_connected, true);
    assert.equal(statusRes.is_logged_in, true);
    assert.equal(statusRes.jid, '628555444333@s.whatsapp.net');

    const sendRes = await whatsappGatewayRequest<{ message_id: string }>('/send/message', {
      method: 'POST',
      deviceId: 'dev-gw',
      contentType: 'application/json',
      body: JSON.stringify({ phone: '62812345678', message: 'Routed via gateway' }),
    });
    assert.equal(sendRes.message_id, 'msg-1');

    // Switch driver to GoWA and verify fetch delegation
    vi.stubEnv('WHATSAPP_DRIVER', 'gowa');
    vi.stubEnv('WHATSAPP_GATEWAY_URL', 'http://gowa.local');
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/statics/test.png')) {
        return new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(
        JSON.stringify({ code: 'SUCCESS', results: { is_connected: true, is_logged_in: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const gowaStatus = await whatsappGatewayRequest<{ is_connected: boolean }>(
      '/devices/dev-gw/status'
    );
    assert.equal(gowaStatus.is_connected, true);

    const gowaBin = await whatsappGatewayBinary('/statics/test.png', 'dev-gw');
    assert.equal(gowaBin.status, 200);
    assert.equal(fetchMock.mock.calls.length, 2);

    vi.stubEnv('WHATSAPP_DRIVER', 'baileys');
    await assert.rejects(
      () => whatsappGatewayBinary('/statics/qr/missing-device.png'),
      (err) => err instanceof GowaError && err.statusCode === 404
    );

    await manager.closeAll();
  });
});
