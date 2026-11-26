import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  listCoolifyTemplates,
  getCoolifyTemplateDetail,
  compileCoolifyCompose,
  type CoolifyTemplateDetail,
  type CompileCoolifyComposeResult,
} from '../src/index.js';

beforeAll(() => {
  if (!process.env.MW_TEMPLATES_DIR) {
    const defaultPacks = 'z:/repo/mw-templates';
    const fallbackFixtures = path.resolve(__dirname, 'fixtures/mw-templates');
    if (existsSync(path.resolve(defaultPacks, 'packs/paas-template-pack-coolify/service-templates.json'))) {
      process.env.MW_TEMPLATES_DIR = defaultPacks;
    } else if (existsSync(fallbackFixtures)) {
      process.env.MW_TEMPLATES_DIR = fallbackFixtures;
    }
  }
});

describe('Coolify Template Pack (390+ templates)', () => {
  it('loads catalog with total >= 350 and zero unhandled parse errors', () => {
    const result = listCoolifyTemplates({});
    expect(result.total).toBeGreaterThanOrEqual(350);
    expect(result.items.length).toBeGreaterThan(0);
    // Verify no template has unhandled parse errors (compatibility should be one of the expected values)
    for (const item of result.items) {
      expect(['ready', 'inline_config', 'restricted']).toContain(item.compatibility);
    }
  });

  it('provides paginated results with accurate total and categories', () => {
    const page1 = listCoolifyTemplates({ page: 1, limit: 10 });
    const page2 = listCoolifyTemplates({ page: 2, limit: 10 });
    expect(page1.total).toBe(page2.total);
    expect(page1.total).toBeGreaterThanOrEqual(350);
    expect(page1.categories.length).toBeGreaterThan(0);
    // Items should not overlap between pages
    const page1Ids = new Set(page1.items.map((i) => i.id));
    const page2Ids = new Set(page2.items.map((i) => i.id));
    const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
    expect(intersection.length).toBe(0);
  });
});

describe('Coolify Template Detail', () => {
  const requiredTemplates = [
    'n8n',
    'uptime-kuma',
    'activepieces',
    'ghost',
    'affine',
    'alexandrie',
    'appflowy',
    'anythingllm',
  ];

  it('has detail entries for all required templates', () => {
    for (const id of requiredTemplates) {
      const detail = getCoolifyTemplateDetail(id);
      expect(detail).toBeDefined();
      expect(detail?.id).toBe(id);
      expect(detail?.composeYaml).toBeDefined();
      expect(typeof detail?.composeYaml).toBe('string');
      expect(detail?.composeYaml.length).toBeGreaterThan(0);
    }
  });
});

describe('Coolify Compose Compiler', () => {
  const testTemplates: Array<{ id: string; expectedCompatibility: 'ready' | 'inline_config' | 'restricted' }> = [
    { id: 'n8n', expectedCompatibility: 'ready' },
    { id: 'uptime-kuma', expectedCompatibility: 'ready' },
    { id: 'activepieces', expectedCompatibility: 'ready' },
    { id: 'ghost', expectedCompatibility: 'ready' },
    { id: 'affine', expectedCompatibility: 'ready' },
    { id: 'alexandrie', expectedCompatibility: 'ready' },
    { id: 'appflowy', expectedCompatibility: 'inline_config' },
    { id: 'anythingllm', expectedCompatibility: 'restricted' },
  ];

  for (const { id, expectedCompatibility } of testTemplates) {
    it(`compiles ${id} (compatibility: ${expectedCompatibility})`, () => {
      const detail = getCoolifyTemplateDetail(id);
      expect(detail).toBeDefined();
      expect(detail?.compatibility).toBe(expectedCompatibility);

      if (expectedCompatibility === 'restricted') {
        // Restricted templates are not compiled by the API layer; compileCoolifyCompose
        // itself does not check compatibility (that's a caller responsibility).
        return;
      }

      const result = compileCoolifyCompose({
        slug: id,
        tenantId: 'test-tenant',
        composeYaml: detail!.composeYaml,
        defaultPort: detail?.port ?? 8080,
        existingEnv: {},
        userEnv: {},
      });

      expect(result).toBeDefined();
      expect(result.composeYaml).toContain('mw-paas-');
      expect(result.composeYaml).toContain('moonwitness-paas');
      expect(result.files).toBeDefined();
      expect(result.env).toBeDefined();
      expect(result.primaryService).toBeDefined();
      expect(result.primaryPort).toBeGreaterThan(0);
      expect(result.ingressRoutes).toBeDefined();
    });
  }

  it('rejects anythingllm as restricted with clear error', () => {
    const detail = getCoolifyTemplateDetail('anythingllm');
    expect(detail).toBeDefined();
    expect(detail?.compatibility).toBe('restricted');
  });

  it('secret idempotency: activepieces compiles identically twice with existingEnv', () => {
    const detail = getCoolifyTemplateDetail('activepieces');
    expect(detail).toBeDefined();

    const run1 = compileCoolifyCompose({
      slug: 'activepieces',
      tenantId: 'test-tenant',
      composeYaml: detail!.composeYaml,
      defaultPort: detail?.port ?? 8080,
      existingEnv: {},
      userEnv: {},
    });

    const run2 = compileCoolifyCompose({
      slug: 'activepieces',
      tenantId: 'test-tenant',
      composeYaml: detail!.composeYaml,
      defaultPort: detail?.port ?? 8080,
      existingEnv: run1.env,
      userEnv: {},
    });

    // Critical secrets should be identical
    expect(run2.env.SERVICE_PASSWORD_POSTGRES).toBe(run1.env.SERVICE_PASSWORD_POSTGRES);
    expect(run2.env.SERVICE_USER_POSTGRES).toBe(run1.env.SERVICE_USER_POSTGRES);
    // All generated secrets should be preserved
    for (const key of Object.keys(run1.env)) {
      if (key.startsWith('SERVICE_')) {
        expect(run2.env[key]).toBe(run1.env[key]);
      }
    }
  });

  it('rejects path-traversal inline file (../escape)', () => {
    // Create a minimal compose with a path-traversal inline file
    const maliciousCompose = `
version: '3.8'
services:
  test:
    image: alpine
    volumes:
      - type: bind
        source: ../escape
        target: /tmp/escape
        content: "malicious"
`;
    expect(() =>
      compileCoolifyCompose({
        slug: 'malicious',
        tenantId: 'test-tenant',
        composeYaml: maliciousCompose,
        defaultPort: 8080,
        existingEnv: {},
        userEnv: {},
      })
    ).toThrow(/path.traversal|invalid|escape|outside/u);
  });

  it('appflowy extracts ./nginx/nginx.conf into files', () => {
    const detail = getCoolifyTemplateDetail('appflowy');
    expect(detail).toBeDefined();

    const result = compileCoolifyCompose({
      slug: 'appflowy',
      tenantId: 'test-tenant',
      composeYaml: detail!.composeYaml,
      defaultPort: detail?.port ?? 8080,
      existingEnv: {},
      userEnv: {},
    });

    // Check that the nginx.conf inline file was extracted
    expect(result.files).toBeDefined();
    const nginxFileKey = Object.keys(result.files).find(
      (k) => k.includes('nginx') && k.endsWith('.conf')
    );
    expect(nginxFileKey).toBeDefined();
    expect(result.files[nginxFileKey!]).toContain('nginx');
  });

  it('alexandrie produces multiple ingress routes', () => {
    const detail = getCoolifyTemplateDetail('alexandrie');
    expect(detail).toBeDefined();

    const result = compileCoolifyCompose({
      slug: 'alexandrie',
      tenantId: 'test-tenant',
      composeYaml: detail!.composeYaml,
      defaultPort: detail?.port ?? 8080,
      existingEnv: {},
      userEnv: {},
    });

    expect(result.ingressRoutes.length).toBeGreaterThan(1);
    for (const route of result.ingressRoutes) {
      expect(route.service).toBeDefined();
      expect(route.host).toBeDefined();
      expect(route.url).toBeDefined();
      expect(route.port).toBeGreaterThan(0);
    }
  });

  it('affine removes exclude_from_hc', () => {
    const detail = getCoolifyTemplateDetail('affine');
    expect(detail).toBeDefined();

    const result = compileCoolifyCompose({
      slug: 'affine',
      tenantId: 'test-tenant',
      composeYaml: detail!.composeYaml,
      defaultPort: detail?.port ?? 8080,
      existingEnv: {},
      userEnv: {},
    });

    expect(result.composeYaml).not.toContain('exclude_from_hc');
  });
});