import { beforeAll, describe, expect, it, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalTemplateSlug,
  clearUnifiedTemplateCatalogCache,
  loadBigbearTemplateCatalog,
  loadDokployTemplateCatalog,
  loadUnifiedTemplateCatalog,
} from '../src/unified-template-pack.js';
import { clearCoolifyTemplateCatalogCache } from '../src/coolify-template-pack.js';

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

describe('canonicalTemplateSlug', () => {
  it('strips DB-suffix variants', () => {
    expect(canonicalTemplateSlug('forgejo-with-mariadb')).toBe('forgejo');
    expect(canonicalTemplateSlug('gitea-with-postgres')).toBe('gitea');
    expect(canonicalTemplateSlug('keycloak-with-postgres')).toBe('keycloak');
    expect(canonicalTemplateSlug('docuseal-with-postgres')).toBe('docuseal');
    expect(canonicalTemplateSlug('flowise-with-databases')).toBe('flowise');
    // Runner variant collapses to the base app too — same tool, different recipe.
    expect(canonicalTemplateSlug('forgejo-with-runner-with-mariadb')).toBe('forgejo');
    expect(canonicalTemplateSlug('forgejo-with-runner')).toBe('forgejo');
  });

  it('strips version suffixes and normalizes underscores', () => {
    expect(canonicalTemplateSlug('odoo_17')).toBe('odoo');
    expect(canonicalTemplateSlug('odoo_18')).toBe('odoo');
    expect(canonicalTemplateSlug('n8n-queue')).toBe('n8n-queue');
  });

  it('keeps plain slugs unchanged', () => {
    expect(canonicalTemplateSlug('uptime-kuma')).toBe('uptime-kuma');
    expect(canonicalTemplateSlug('ghost')).toBe('ghost');
  });
});

describe('loadUnifiedTemplateCatalog', () => {
  beforeEach(() => {
    clearUnifiedTemplateCatalogCache();
    clearCoolifyTemplateCatalogCache();
  });

  it('loads raw entries from all three upstream packs', { timeout: 30_000 }, () => {
    const dokploy = loadDokployTemplateCatalog();
    const bigbear = loadBigbearTemplateCatalog();
    expect(dokploy.size).toBeGreaterThan(400);
    expect(bigbear.size).toBeGreaterThan(30);

    const dokployEntry = dokploy.get('uptime-kuma');
    expect(dokployEntry?.source).toBe('dokploy');
    expect(dokployEntry?.composeYaml).toContain('services:');

    const bigbearEntry = bigbear.get('actual-server');
    expect(bigbearEntry?.source).toBe('bigbear');
    expect(bigbearEntry?.name.toLowerCase()).toContain('actual');
  });

  it('dedupes canonical apps across packs with dokploy precedence', () => {
    const cat = loadUnifiedTemplateCatalog();
    const forgejo = cat.byCanonical.get('forgejo');
    expect(forgejo).toBeDefined();
    expect(forgejo?.source).toBe('dokploy');
    expect(forgejo?.duplicateSources).toContain('coolify');

    const keycloak = cat.byCanonical.get('keycloak');
    expect(keycloak?.source).toBe('dokploy');

    const odoo = cat.byCanonical.get('odoo');
    expect(odoo?.source).toBe('dokploy');

    expect(cat.duplicates.length).toBeGreaterThan(50);
  });

  it('classifies compatibility against control-plane rules', () => {
    const cat = loadUnifiedTemplateCatalog();
    // All restricted templates must carry at least one reason.
    for (const entry of cat.all.values()) {
      if (entry.compatibility === 'restricted') {
        expect(entry.compatibilityReasons.length).toBeGreaterThan(0);
      }
    }
    // BigBear host-mode bind mounts must be restricted, not ready.
    const adguard = loadBigbearTemplateCatalog().get('adguard-home');
    expect(adguard?.compatibility).toBe('restricted');
    expect(adguard?.compatibilityReasons.some((r) => r.includes('host bind'))).toBe(true);
  });

  it('keeps every entry keyed with source prefix in all-map', () => {
    const cat = loadUnifiedTemplateCatalog();
    expect(cat.all.has('dokploy:uptime-kuma')).toBe(true);
    expect(cat.all.has('bigbear:actual-server')).toBe(true);
    expect(cat.all.size).toBeGreaterThan(cat.byCanonical.size);
  });
});
