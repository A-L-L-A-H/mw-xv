import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveCoolifyServiceTemplatesPath,
  loadCoolifyTemplateCatalog,
  clearCoolifyTemplateCatalogCache,
} from '../src/coolify-template-pack.js';
import {
  resolveDokployPackPath,
  resolveBigbearPackPath,
  loadDokployTemplateCatalog,
  loadBigbearTemplateCatalog,
  clearUnifiedTemplateCatalogCache,
} from '../src/unified-template-pack.js';

describe('MW_TEMPLATES_DIR external template catalog resolution', () => {
  const origTemplatesDir = process.env.MW_TEMPLATES_DIR;
  const origCoolifyDir = process.env.MW_COOLIFY_TEMPLATE_PACK_DIR;
  const origDokployDir = process.env.MW_DOKPLOY_TEMPLATE_PACK_DIR;
  const origBigbearDir = process.env.MW_BIGBEAR_TEMPLATE_PACK_DIR;

  let tempDir: string;

  beforeEach(() => {
    delete process.env.MW_COOLIFY_TEMPLATE_PACK_DIR;
    delete process.env.MW_DOKPLOY_TEMPLATE_PACK_DIR;
    delete process.env.MW_BIGBEAR_TEMPLATE_PACK_DIR;
    clearCoolifyTemplateCatalogCache();
    clearUnifiedTemplateCatalogCache();
    tempDir = mkdtempSync(path.join(tmpdir(), 'mw-templates-test-'));
  });

  afterEach(() => {
    if (origTemplatesDir !== undefined) {
      process.env.MW_TEMPLATES_DIR = origTemplatesDir;
    } else {
      delete process.env.MW_TEMPLATES_DIR;
    }
    if (origCoolifyDir !== undefined) {
      process.env.MW_COOLIFY_TEMPLATE_PACK_DIR = origCoolifyDir;
    }
    if (origDokployDir !== undefined) {
      process.env.MW_DOKPLOY_TEMPLATE_PACK_DIR = origDokployDir;
    }
    if (origBigbearDir !== undefined) {
      process.env.MW_BIGBEAR_TEMPLATE_PACK_DIR = origBigbearDir;
    }
    clearCoolifyTemplateCatalogCache();
    clearUnifiedTemplateCatalogCache();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('resolves templates from direct layout <MW_TEMPLATES_DIR>/<packName>', () => {
    const coolifyDir = path.join(tempDir, 'paas-template-pack-coolify');
    const dokployDir = path.join(tempDir, 'paas-template-pack-dokploy');
    const bigbearDir = path.join(tempDir, 'paas-template-pack-bigbear');

    mkdirSync(coolifyDir, { recursive: true });
    mkdirSync(dokployDir, { recursive: true });
    mkdirSync(bigbearDir, { recursive: true });

    const coolifyTemplatesPath = path.join(coolifyDir, 'service-templates.json');
    const fakeCoolifyData = {
      testapp: {
        slogan: 'Custom Coolify App',
        category: 'test',
        compose: Buffer.from('version: "3.8"\nservices:\n  app:\n    image: nginx:latest\n').toString('base64'),
      },
    };
    writeFileSync(coolifyTemplatesPath, JSON.stringify(fakeCoolifyData), 'utf8');

    // Create a mock blueprint for dokploy
    const bpDir = path.join(dokployDir, 'blueprints', 'custom-dokploy');
    mkdirSync(bpDir, { recursive: true });
    writeFileSync(
      path.join(bpDir, 'docker-compose.yml'),
      'services:\n  web:\n    image: redis:alpine\n',
      'utf8',
    );
    writeFileSync(
      path.join(bpDir, 'meta.json'),
      JSON.stringify({ name: 'Custom Dokploy', categories: ['tools'] }),
      'utf8',
    );

    // Create a mock app for bigbear
    const appDir = path.join(bigbearDir, 'apps', 'custom-bigbear');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'docker-compose.yml'),
      'services:\n  srv:\n    image: memcached:alpine\n    x-casaos:\n      title: Custom Bigbear\n',
      'utf8',
    );

    process.env.MW_TEMPLATES_DIR = tempDir;

    expect(resolveCoolifyServiceTemplatesPath()).toBe(coolifyTemplatesPath);
    expect(resolveDokployPackPath()).toBe(dokployDir);
    expect(resolveBigbearPackPath()).toBe(bigbearDir);

    const coolifyCatalog = loadCoolifyTemplateCatalog();
    expect(coolifyCatalog.has('testapp')).toBe(true);
    expect(coolifyCatalog.get('testapp')?.slogan).toBe('Custom Coolify App');

    const dokployCatalog = loadDokployTemplateCatalog();
    expect(dokployCatalog.has('custom-dokploy')).toBe(true);

    const bigbearCatalog = loadBigbearTemplateCatalog();
    expect(bigbearCatalog.has('custom-bigbear')).toBe(true);
  });

  it('resolves templates from nested layout <MW_TEMPLATES_DIR>/packs/<packName>', () => {
    const packsDir = path.join(tempDir, 'packs');
    const coolifyDir = path.join(packsDir, 'paas-template-pack-coolify');
    const dokployDir = path.join(packsDir, 'paas-template-pack-dokploy');
    const bigbearDir = path.join(packsDir, 'paas-template-pack-bigbear');

    mkdirSync(coolifyDir, { recursive: true });
    mkdirSync(dokployDir, { recursive: true });
    mkdirSync(bigbearDir, { recursive: true });

    const coolifyTemplatesPath = path.join(coolifyDir, 'service-templates.json');
    writeFileSync(coolifyTemplatesPath, JSON.stringify({}), 'utf8');

    process.env.MW_TEMPLATES_DIR = tempDir;

    expect(resolveCoolifyServiceTemplatesPath()).toBe(coolifyTemplatesPath);
    expect(resolveDokployPackPath()).toBe(dokployDir);
    expect(resolveBigbearPackPath()).toBe(bigbearDir);
  });
});
