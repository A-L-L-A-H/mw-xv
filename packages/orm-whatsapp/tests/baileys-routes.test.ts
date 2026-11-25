import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import knex, { type Knex } from 'knex';
import { afterEach, describe, it, vi } from 'vitest';
import { BaseModel, installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import type { AttachmentStorage, StoredObjectMetadata } from '@moonwitness/orm-storage';
import {
  BaileysGatewayManager,
  DisabledAttachmentScanner,
  WhatsappMessage,
  setBaileysGatewayManager,
  whatsappDriver,
  whatsappGatewayBinary,
  whatsappGatewayRequest,
  whatsappHttpPlugin,
  whatsappManifest,
  type BaileysMessageKey,
  type BaileysQrGenerator,
  type BaileysSocket,
} from '../src/index.js';
import type { BaileysGroupMetadata } from '../src/runtime/baileys-client.js';

class MockBaileysRouteSocket implements BaileysSocket {
  readonly ev = new EventEmitter();
  user?: { id?: string; name?: string };
  readonly sentMessages: Array<{
    jid: string;
    content: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];
  readonly readKeys: BaileysMessageKey[] = [];
  readonly presenceUpdates: Array<{ type: string; toJid?: string }> = [];
  readonly groupSettingUpdates: Array<{ jid: string; setting: string }> = [];
  readonly createdGroups: Array<{ subject: string; participants: string[] }> = [];
  logoutCalls = 0;
  endCalls = 0;

  async sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    this.sentMessages.push({ jid, content, options });
    return {
      key: {
        id: `baileys-msg-${this.sentMessages.length}`,
        remoteJid: jid,
        fromMe: true,
      },
    };
  }

  async readMessages(keys: BaileysMessageKey[]): Promise<void> {
    this.readKeys.push(...keys);
  }

  async sendPresenceUpdate(type: string, toJid?: string): Promise<void> {
    this.presenceUpdates.push({ type, toJid });
  }

  async onWhatsApp(...jids: string[]): Promise<Array<{ exists?: boolean; jid?: string }>> {
    return jids.map((jid) => ({ exists: true, jid }));
  }

  async fetchStatus(_jid: string): Promise<{ status?: string }> {
    return { status: 'Native Baileys ready' };
  }

  async profilePictureUrl(_jid: string, _type?: 'image' | 'preview'): Promise<string | undefined> {
    return undefined;
  }

  async groupCreate(subject: string, participants: string[]): Promise<{ id?: string }> {
    this.createdGroups.push({ subject, participants });
    return { id: '120363999000111@g.us' };
  }

  async groupMetadata(jid: string): Promise<BaileysGroupMetadata> {
    return {
      id: jid,
      subject: 'Ops Team',
      desc: 'Operations channel',
      size: 2,
      restrict: false,
      announce: false,
      participants: [
        { id: '6281234567890@s.whatsapp.net', admin: 'superadmin' },
        { id: '628987654321@s.whatsapp.net', admin: null },
      ],
    };
  }

  async groupSettingUpdate(
    jid: string,
    setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'
  ): Promise<void> {
    this.groupSettingUpdates.push({ jid, setting });
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

const memoryStorage: AttachmentStorage = {
  async put(key, content) {
    return { key, sizeBytes: content.byteLength };
  },
  async get() {
    return null;
  },
  async delete() {
    return;
  },
  async *list(): AsyncIterable<StoredObjectMetadata> {
    yield* [] as unknown as AsyncIterable<StoredObjectMetadata>;
  },
};

const tempDirs: string[] = [];

async function makeTempAuthDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-baileys-routes-'));
  tempDirs.push(dir);
  return dir;
}

async function createTestHarness(): Promise<{
  app: FastifyInstance;
  db: Knex;
  companyId: number;
  userId: number;
}> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  BaseModel.knex(db);
  await installAddons(db, [baseManifest, jobsManifest, notificationManifest, whatsappManifest]);
  if (!(await db.schema.hasTable('organization_teams'))) {
    await db.schema.createTable('organization_teams', (table) => {
      table.increments('id').primary();
      table.integer('company_id').notNullable();
      table.string('name').notNullable();
    });
  }
  const companyRow = (await db('companies').first('id')) as { id: number };
  const companyId = Number(companyRow.id);
  const userRow = (await db('users').first('id')) as { id: number } | undefined;
  const userId = userRow ? Number(userRow.id) : 1;

  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('authenticate', async () => undefined);
  app.addHook('preHandler', async (request) => {
    request.auth = {
      userId,
      companyId,
      role: 'superadmin',
      groupPermissions: [],
      isSuperadmin: true,
    };
  });
  await app.register(whatsappHttpPlugin, {
    attachmentStorage: memoryStorage,
    attachmentScanner: new DisabledAttachmentScanner(),
  });
  await app.ready();

  return { app, db, companyId, userId };
}

afterEach(async () => {
  setBaileysGatewayManager(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('@moonwitness/orm-whatsapp Baileys HTTP routes integration', () => {
  it('resolves whatsappDriver() precedence across WHATSAPP_DRIVER, WHATSAPP_GOWA_BASE_URL, and WHATSAPP_GATEWAY_URL', () => {
    assert.equal(whatsappDriver({}), 'baileys');
    assert.equal(whatsappDriver({ WHATSAPP_GOWA_BASE_URL: 'http://127.0.0.1:3000' }), 'gowa');
    assert.equal(whatsappDriver({ WHATSAPP_GATEWAY_URL: 'http://gowa.test' }), 'gowa');
    assert.equal(
      whatsappDriver({
        WHATSAPP_DRIVER: 'baileys',
        WHATSAPP_GOWA_BASE_URL: 'http://127.0.0.1:3000',
        WHATSAPP_GATEWAY_URL: 'http://gowa.test',
      }),
      'baileys'
    );
    assert.equal(whatsappDriver({ WHATSAPP_DRIVER: 'gowa' }), 'gowa');
  });

  it('handles QR pairing, device status, messaging, actions, groups, and logout via HTTP routes with zero network calls', async () => {
    vi.stubEnv('WHATSAPP_DRIVER', 'baileys');
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      throw new Error('Unexpected external network fetch in Baileys mode');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysRouteSocket();
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => socket,
    });
    setBaileysGatewayManager(manager);

    const harness = await createTestHarness();
    try {
      const initialAccount = await harness.app.inject({
        method: 'GET',
        url: '/whatsapp/account',
      });
      assert.equal(initialAccount.statusCode, 200);
      assert.equal(initialAccount.json().data.status, 'disconnected');

      const connectRes = await harness.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
      });
      assert.equal(connectRes.statusCode, 202);
      assert.equal(connectRes.json().data.status, 'connecting');

      socket.ev.emit('connection.update', { qr: 'native-baileys-qr-token' });
      await new Promise((resolve) => setTimeout(resolve, 15));

      const qrAccount = await harness.app.inject({
        method: 'GET',
        url: '/whatsapp/account',
      });
      assert.equal(qrAccount.statusCode, 200);
      const qrPayload = qrAccount.json().data as { status: string; qr_code: string | null };
      assert.equal(qrPayload.status, 'qr');
      assert.ok(qrPayload.qr_code?.startsWith('data:image/png;base64,'));
      const decodedQr = Buffer.from(
        qrPayload.qr_code!.replace('data:image/png;base64,', ''),
        'base64'
      ).toString('utf8');
      assert.equal(decodedQr, 'PNG:native-baileys-qr-token');

      socket.user = { id: '6281234567890:12@s.whatsapp.net' };
      socket.ev.emit('connection.update', { connection: 'open' });
      await new Promise((resolve) => setTimeout(resolve, 15));

      const connectedAccount = await harness.app.inject({
        method: 'GET',
        url: '/whatsapp/account',
      });
      assert.equal(connectedAccount.statusCode, 200);
      assert.equal(connectedAccount.json().data.status, 'connected');
      assert.equal(connectedAccount.json().data.phone_number, '6281234567890');
      assert.equal(connectedAccount.json().data.qr_code, null);

      const deviceId = `moonwitness-company-${harness.companyId}`;

      const createConv = await harness.app.inject({
        method: 'POST',
        url: '/whatsapp/conversations',
        payload: { phone: '628987654321', name: 'Budi' },
      });
      assert.equal(createConv.statusCode, 201);
      const conversationId = Number(createConv.json().data.id);

      const enqueueMsg = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/conversations/${conversationId}/messages`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'baileys-send-msg-0001',
        },
        payload: { content: 'Hello from native Baileys route' },
      });
      assert.equal(enqueueMsg.statusCode, 202);
      const queuedMsgId = Number(enqueueMsg.json().data.id);
      assert.equal(enqueueMsg.json().data.status, 'queued');

      const sent = await whatsappGatewayRequest<{ message_id: string }>('/send/message', {
        method: 'POST',
        deviceId,
        contentType: 'application/json',
        body: JSON.stringify({
          phone: '628987654321@s.whatsapp.net',
          message: 'Hello from native Baileys route',
        }),
      });
      assert.equal(sent.message_id, 'baileys-msg-1');
      assert.equal(socket.sentMessages[0]?.jid, '628987654321@s.whatsapp.net');
      assert.deepEqual(socket.sentMessages[0]?.content, {
        text: 'Hello from native Baileys route',
      });

      await WhatsappMessage.query()
        .where({ id: queuedMsgId, company_id: harness.companyId })
        .patch({ external_id: sent.message_id, status: 'sent' });

      const reactRes = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/messages/${queuedMsgId}/reaction`,
        payload: { emoji: '👍' },
      });
      assert.equal(reactRes.statusCode, 200);
      assert.deepEqual(socket.sentMessages[1]?.content, {
        react: {
          text: '👍',
          key: { remoteJid: '628987654321@s.whatsapp.net', id: 'baileys-msg-1' },
        },
      });

      const editRes = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/messages/${queuedMsgId}/edit`,
        payload: { content: 'Updated Baileys text' },
      });
      assert.equal(editRes.statusCode, 200);
      assert.deepEqual(socket.sentMessages[2]?.content, {
        text: 'Updated Baileys text',
        edit: { remoteJid: '628987654321@s.whatsapp.net', id: 'baileys-msg-1', fromMe: true },
      });

      socket.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: {
              id: 'inbound-baileys-1',
              remoteJid: '628987654321@s.whatsapp.net',
              fromMe: false,
            },
            message: { conversation: 'Reply from customer' },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: 'Budi',
          },
        ],
      });

      const listConversations = await harness.app.inject({
        method: 'GET',
        url: '/whatsapp/conversations',
      });
      assert.equal(listConversations.statusCode, 200);
      assert.ok(listConversations.json().data.length >= 1);

      const listMessages = await harness.app.inject({
        method: 'GET',
        url: `/whatsapp/conversations/${conversationId}/messages`,
      });
      assert.equal(listMessages.statusCode, 200);
      const loadedMessages = listMessages.json().data as Array<{ content: string }>;
      assert.ok(loadedMessages.some((entry) => entry.content === 'Reply from customer'));

      const readRes = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/conversations/${conversationId}/read`,
      });
      assert.equal(readRes.statusCode, 200);
      assert.equal(readRes.json().data.marked, true);
      assert.equal(socket.readKeys[0]?.id, 'inbound-baileys-1');

      const checkContact = await harness.app.inject({
        method: 'POST',
        url: '/whatsapp/contacts/check',
        payload: { phone: '+628987654321' },
      });
      assert.equal(checkContact.statusCode, 200);
      assert.equal(checkContact.json().data.is_on_whatsapp, true);

      const contactInfo = await harness.app.inject({
        method: 'GET',
        url: `/whatsapp/conversations/${conversationId}/contact`,
      });
      assert.equal(contactInfo.statusCode, 200);
      assert.equal(contactInfo.json().data.status, 'Native Baileys ready');

      const createGroupRes = await harness.app.inject({
        method: 'POST',
        url: '/whatsapp/groups',
        headers: { 'idempotency-key': 'baileys-group-create-0001' },
        payload: { title: 'Ops Team', participants: ['+628987654321'] },
      });
      assert.equal(createGroupRes.statusCode, 201);
      const groupConvId = Number(createGroupRes.json().data.id);
      assert.equal(socket.createdGroups.length, 1);

      const lockGroupRes = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/conversations/${groupConvId}/group/settings`,
        payload: { setting: 'locked', enabled: true },
      });
      assert.equal(lockGroupRes.statusCode, 200);
      assert.deepEqual(socket.groupSettingUpdates, [
        { jid: '120363999000111@g.us', setting: 'locked' },
      ]);

      const revokeRes = await harness.app.inject({
        method: 'POST',
        url: `/whatsapp/messages/${queuedMsgId}/revoke`,
      });
      assert.equal(revokeRes.statusCode, 200);
      assert.deepEqual(socket.sentMessages[3]?.content, {
        delete: { remoteJid: '628987654321@s.whatsapp.net', id: 'baileys-msg-1', fromMe: true },
      });

      const disconnectRes = await harness.app.inject({
        method: 'POST',
        url: '/whatsapp/disconnect',
      });
      assert.equal(disconnectRes.statusCode, 200);
      assert.equal(disconnectRes.json().data.status, 'disconnected');
      assert.equal(socket.logoutCalls, 1);
      assert.equal(socket.endCalls, 1);

      const afterLogoutAccount = await harness.app.inject({
        method: 'GET',
        url: '/whatsapp/account',
      });
      assert.equal(afterLogoutAccount.statusCode, 200);
      assert.equal(afterLogoutAccount.json().data.status, 'disconnected');

      assert.equal(fetchSpy.mock.calls.length, 0);
    } finally {
      await manager.closeAll();
      await harness.app.close();
      await harness.db.destroy();
    }
  });

  it('routes /app/* lifecycle, media uploads, /send/presence, /user/info, and QR binary endpoints in Baileys mode', async () => {
    vi.stubEnv('WHATSAPP_DRIVER', 'baileys');
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      throw new Error('Unexpected external network fetch in Baileys mode');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const authDir = await makeTempAuthDir();
    const sockets: MockBaileysRouteSocket[] = [];
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => {
        const sock = new MockBaileysRouteSocket();
        sock.user = { id: '628111222333@s.whatsapp.net' };
        sockets.push(sock);
        return sock;
      },
    });
    setBaileysGatewayManager(manager);

    try {
      await whatsappGatewayRequest('/app/login', { deviceId: 'dev-app' });
      assert.equal(sockets.length, 1);

      sockets[0]!.ev.emit('connection.update', { qr: 'app-qr-code' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const qrBin = await whatsappGatewayBinary('/app/qr', 'dev-app');
      assert.equal(qrBin.status, 200);
      assert.equal(Buffer.from(await qrBin.arrayBuffer()).toString('utf8'), 'PNG:app-qr-code');

      const devices = await whatsappGatewayRequest<Array<{ device_id: string }>>('/app/devices');
      assert.equal(devices.length, 1);
      assert.equal(devices[0]?.device_id, 'dev-app');

      await whatsappGatewayRequest('/app/reconnect', { method: 'POST', deviceId: 'dev-app' });
      assert.equal(sockets.length, 2);
      assert.equal(sockets[0]!.endCalls, 1);

      sockets[1]!.ev.emit('connection.update', { connection: 'open' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await whatsappGatewayRequest('/send/presence', {
        method: 'POST',
        deviceId: 'dev-app',
        contentType: 'application/json',
        body: JSON.stringify({ type: 'composing', phone: '628999000111' }),
      });
      assert.deepEqual(sockets[1]!.presenceUpdates, [
        { type: 'composing', toJid: '628999000111@s.whatsapp.net' },
      ]);

      const mediaKinds = [
        { endpoint: '/send/image', field: 'image', mime: 'image/png', name: 'pic.png' },
        { endpoint: '/send/video', field: 'video', mime: 'video/mp4', name: 'clip.mp4' },
        { endpoint: '/send/audio', field: 'audio', mime: 'audio/ogg', name: 'voice.ogg' },
        { endpoint: '/send/file', field: 'file', mime: 'application/pdf', name: 'doc.pdf' },
      ] as const;

      for (const spec of mediaKinds) {
        const form = new FormData();
        form.set('phone', '628999000111@s.whatsapp.net');
        form.set('caption', `Caption for ${spec.field}`);
        form.set(
          spec.field,
          new Blob([Buffer.from(`bytes-${spec.field}`)], { type: spec.mime }),
          spec.name
        );
        const result = await whatsappGatewayRequest<{ message_id: string }>(spec.endpoint, {
          method: 'POST',
          deviceId: 'dev-app',
          body: form,
        });
        assert.ok(result.message_id.startsWith('baileys-msg-'));
      }
      assert.equal(sockets[1]!.sentMessages.length, 4);

      const userInfo = await whatsappGatewayRequest<{ jid: string; status: string | null }>(
        '/user/info?phone=628999000111@s.whatsapp.net',
        { deviceId: 'dev-app' }
      );
      assert.equal(userInfo.jid, '628999000111@s.whatsapp.net');
      assert.equal(userInfo.status, 'Native Baileys ready');

      const logoutRes = await whatsappGatewayRequest<{ status: string }>('/app/logout', {
        method: 'POST',
        deviceId: 'dev-app',
      });
      assert.equal(logoutRes.status, 'disconnected');
      assert.equal(sockets[1]!.logoutCalls, 1);
      assert.equal(fetchSpy.mock.calls.length, 0);
    } finally {
      await manager.closeAll();
    }
  });
});
