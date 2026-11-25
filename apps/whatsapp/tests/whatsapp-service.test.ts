import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, it, vi } from 'vitest';
import {
  BaileysGatewayManager,
  type BaileysQrGenerator,
  type BaileysSocket,
} from '@moonwitness/orm-whatsapp';
import { buildApp } from '../src/app.js';

class MockBaileysSocket implements BaileysSocket {
  readonly ev = new EventEmitter();
  user?: { id?: string; name?: string };
  readonly sentMessages: Array<{
    jid: string;
    content: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

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

  async requestPairingCode(_phoneNumber: string): Promise<string> {
    return '1234-5678';
  }

  async logout(): Promise<void> {
    return undefined;
  }

  end(): void {
    return undefined;
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
const appsToClose: FastifyInstance[] = [];

async function makeTempAuthDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-whatsapp-app-test-'));
  tempDirs.push(dir);
  return dir;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

afterEach(async () => {
  while (appsToClose.length > 0) {
    const app = appsToClose.pop()!;
    await app.close();
  }
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('@moonwitness/whatsapp standalone service', () => {
  it('serves unauthenticated health probes and enforces Basic/Bearer auth on gateway & ORM APIs', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => socket,
    });

    const app = await buildApp({
      registerVite: false,
      baileysManager: manager,
      env: {
        NODE_ENV: 'test',
        WHATSAPP_SQLITE_PATH: ':memory:',
        WHATSAPP_BAILEYS_AUTH_DIR: authDir,
        WHATSAPP_GATEWAY_USERNAME: 'admin',
        WHATSAPP_GATEWAY_PASSWORD: 'secret-password',
        WHATSAPP_API_KEY: 'test-api-key-12345',
      },
    });
    appsToClose.push(app);

    const healthz = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(healthz.statusCode, 200);
    assert.equal(healthz.json().driver, 'baileys');

    const readyz = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(readyz.statusCode, 200);
    assert.equal(readyz.json().database, 'connected');

    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');

    const unauthDevices = await app.inject({ method: 'GET', url: '/devices' });
    assert.equal(unauthDevices.statusCode, 401);

    const wrongAuth = await app.inject({
      method: 'GET',
      url: '/api/v1/overview',
      headers: { authorization: basicAuthHeader('admin', 'wrong') },
    });
    assert.equal(wrongAuth.statusCode, 401);

    const okBasic = await app.inject({
      method: 'GET',
      url: '/devices',
      headers: { authorization: basicAuthHeader('admin', 'secret-password') },
    });
    assert.equal(okBasic.statusCode, 200);
    assert.deepEqual(okBasic.json(), []);

    const okBearer = await app.inject({
      method: 'GET',
      url: '/api/v1/overview',
      headers: { authorization: 'Bearer test-api-key-12345' },
    });
    assert.equal(okBearer.statusCode, 200);
    assert.equal(okBearer.json().data.driver, 'baileys');
  });

  it('supports GoWA-compat routes and persists accounts, conversations, and messages in ORM', async () => {
    const authDir = await makeTempAuthDir();
    const socket = new MockBaileysSocket();
    socket.user = { id: '628111222333:1@s.whatsapp.net' };
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => socket,
    });

    const app = await buildApp({
      registerVite: false,
      baileysManager: manager,
      env: {
        NODE_ENV: 'test',
        WHATSAPP_SQLITE_PATH: ':memory:',
        WHATSAPP_BAILEYS_AUTH_DIR: authDir,
        WHATSAPP_GATEWAY_USERNAME: 'moonwitness',
        WHATSAPP_GATEWAY_PASSWORD: 'moonwitness-password',
      },
    });
    appsToClose.push(app);
    const auth = { authorization: basicAuthHeader('moonwitness', 'moonwitness-password') };

    const loginRes = await app.inject({
      method: 'GET',
      url: '/app/login?device_id=ops-1',
      headers: auth,
    });
    assert.equal(loginRes.statusCode, 200);

    socket.ev.emit('connection.update', { qr: 'qr-ticket-001' });
    await new Promise((resolve) => setTimeout(resolve, 15));

    const qrPng = await app.inject({
      method: 'GET',
      url: '/statics/qr/ops-1.png',
      headers: auth,
    });
    assert.equal(qrPng.statusCode, 200);
    assert.equal(qrPng.headers['content-type'], 'image/png');

    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 15));

    const gowaSend = await app.inject({
      method: 'POST',
      url: '/send/message',
      headers: { ...auth, 'x-device-id': 'ops-1' },
      payload: { phone: '6281234567890', message: 'Hello via GoWA compat' },
    });
    assert.equal(gowaSend.statusCode, 200);
    assert.equal(gowaSend.json().message_id, 'baileys-msg-1');

    const v1Send = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: auth,
      payload: {
        device_id: 'ops-1',
        to: '6281234567890',
        message: 'Hello via ORM API v1',
      },
    });
    assert.equal(v1Send.statusCode, 201);
    assert.equal(v1Send.json().data.message_id, 'baileys-msg-2');

    // Simulate inbound WhatsApp message via Baileys event
    socket.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'inbound-msg-1', remoteJid: '6281234567890@s.whatsapp.net', fromMe: false },
          pushName: 'Budi',
          message: { conversation: 'Inbound reply' },
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const accountsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: auth,
    });
    assert.equal(accountsRes.statusCode, 200);
    assert.equal(accountsRes.json().data.length, 1);
    assert.equal(accountsRes.json().data[0].gateway_device_id, 'ops-1');

    const convsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: auth,
    });
    assert.equal(convsRes.statusCode, 200);
    assert.equal(convsRes.json().data.length, 1);
    const convId = convsRes.json().data[0].id as number;

    const msgsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: auth,
    });
    assert.equal(msgsRes.statusCode, 200);
    assert.equal(msgsRes.json().data.length, 3);

    const overviewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/overview',
      headers: auth,
    });
    assert.equal(overviewRes.statusCode, 200);
    assert.deepEqual(overviewRes.json().data.counts, {
      accounts: 1,
      conversations: 1,
      messages: 3,
      statuses: 0,
    });
  });

  it('serves React SPA HTML at GET / via @fastify/vite', async () => {
    const authDir = await makeTempAuthDir();
    const manager = new BaileysGatewayManager({
      authDir,
      qrGenerator: stubQrGenerator,
      authStateFactory: async () => ({ state: {}, saveCreds: async () => undefined }),
      socketFactory: async () => new MockBaileysSocket(),
    });

    const app = await buildApp({
      registerVite: true,
      baileysManager: manager,
      env: {
        NODE_ENV: 'test',
        WHATSAPP_SQLITE_PATH: ':memory:',
        WHATSAPP_BAILEYS_AUTH_DIR: authDir,
        WHATSAPP_GATEWAY_USERNAME: 'moonwitness',
        WHATSAPP_GATEWAY_PASSWORD: 'moonwitness-password',
      },
    });
    appsToClose.push(app);

    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /text\/html/u);
    assert.match(res.body, /<div id="root"><\/div>/u);
  });
});
