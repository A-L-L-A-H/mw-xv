import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Fastify from 'fastify';
import { whatsappManifest, whatsappHttpPlugin } from '../src/index.js';
import { DisabledAttachmentScanner } from '../src/runtime/clamav-scanner.js';
import type { AttachmentStorage, StoredObjectMetadata } from '@moonwitness/orm-storage';

const stubStorage: AttachmentStorage = {
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

describe('@moonwitness/orm-whatsapp manifest.httpPlugins', () => {
  it('exposes whatsappHttpPlugin in manifest.httpPlugins and mounts all WhatsApp routes', async () => {
    assert.ok(Array.isArray(whatsappManifest.httpPlugins));
    assert.equal(whatsappManifest.httpPlugins.length, 1);
    assert.strictEqual(whatsappManifest.httpPlugins[0], whatsappHttpPlugin);

    const app = Fastify({ logger: false });
    const mountedRoutes: string[] = [];
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method !== 'HEAD') mountedRoutes.push(`${method} ${route.url}`);
      }
    });
    app.decorate('authenticate', async () => undefined);
    app.decorate('db', {} as never);

    await app.register(whatsappHttpPlugin, {
      attachmentStorage: stubStorage,
      attachmentScanner: new DisabledAttachmentScanner(),
    });
    await app.ready();

    // Verify key routes from all 10 sub-plugins are registered
    assert.ok(mountedRoutes.includes('POST /whatsapp/gowa/webhook/:deviceId'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/account'));
    assert.ok(mountedRoutes.includes('POST /whatsapp/connect'));
    assert.ok(mountedRoutes.includes('POST /whatsapp/disconnect'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/conversations'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/statuses'));
    assert.ok(mountedRoutes.includes('POST /whatsapp/groups'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/labels'));
    assert.ok(mountedRoutes.includes('POST /whatsapp/conversations/:id/messages'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/media/:id'));
    assert.ok(mountedRoutes.includes('GET /whatsapp/media/:id/thumbnail'));
    assert.ok(mountedRoutes.some((r) => r.includes('/whatsapp/messages/:id/')));
    assert.ok(mountedRoutes.length >= 40, `Expected >= 40 routes, got ${mountedRoutes.length}`);

    await app.close();
  });
});
