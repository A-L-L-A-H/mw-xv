import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  classifyComposeDocument,
  loadCoolifyTemplateCatalog,
  type CoolifyCompatibility,
} from './coolify-template-pack.js';

/**
 * Unified PaaS template catalog: merges raw upstream packs
 * (paas-template-pack-dokploy, paas-template-pack-bigbear) into the same
 * entry shape as the Coolify catalog, with cross-pack deduplication.
 *
 * Dedup rule: canonical slug normalization strips DB-suffix variants
 * (`-with-postgres`, `-with-mariadb`, `_17`, ...). For a canonical app
 * present in multiple packs, precedence is dokploy > coolify > bigbear
 * (Dokploy blueprints use `expose:` instead of hardcoded ports and carry
 * structured template.toml variables).
 */

export type UnifiedPackSource = 'coolify' | 'dokploy' | 'bigbear' | 'moonwitness';

export interface UnifiedTemplateEntry {
  id: string;
  canonicalId: string;
  name: string;
  slogan: string;
  category: string;
  tags: string[];
  documentation?: string;
  logo?: string;
  compatibility: CoolifyCompatibility;
  compatibilityReasons: string[];
  serviceCount: number;
  services: string[];
  source: UnifiedPackSource;
  /** Other packs that carry the same canonical app. */
  duplicateSources: UnifiedPackSource[];
  composeYaml: string;
  composeDoc: Record<string, unknown>;
}

interface RawDokployMeta {
  id?: string;
  name?: string;
  description?: string;
  logo?: string;
  links?: Array<{ repoUrl?: string; website?: string }>;
  tags?: string[];
  categories?: string[];
}

interface RawBigbearXcasaos {
  title?: { en?: string } | string;
  tagline?: { en?: string } | string;
  description?: { en?: string } | string;
  category?: string;
  icon?: string;
  developer?: string;
}

export function canonicalTemplateSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-with-(postgres(?:ql)?|mysql|mariadb|sqlite|databases|runner)(-with-.*)?$/g, '')
    .replace(/-with-(postgres(?:ql)?|mysql|mariadb|sqlite|databases|runner)$/g, '')
    .replace(/-\d+(?:\.\d+)*$/g, '')
    .replace(/-+$|^-+/g, '');
}

function resolvePackDir(packName: string, envKey: string): string {
  const customTemplatesDir = process.env.MW_TEMPLATES_DIR?.trim();
  if (customTemplatesDir) {
    const directCandidate = path.resolve(customTemplatesDir, packName);
    if (existsSync(directCandidate)) {
      return directCandidate;
    }
    const packsCandidate = path.resolve(customTemplatesDir, 'packs', packName);
    if (existsSync(packsCandidate)) {
      return packsCandidate;
    }
  }

  const envDir = process.env[envKey]?.trim();
  if (envDir && existsSync(envDir)) {
    return path.resolve(envDir);
  }

  try {
    const req = createRequire(import.meta.url);
    const resolved = path.dirname(req.resolve(`${packName}/package.json`));
    if (existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Fall through to relative monorepo path resolution.
  }

  const baseDir =
    (import.meta as { dirname?: string }).dirname ?? path.dirname(fileURLToPath(import.meta.url));
  const fallback = path.resolve(baseDir, `../../${packName}`);
  if (existsSync(fallback)) {
    return fallback;
  }

  throw new Error(`Unable to locate template pack: ${packName}`);
}

export function resolveDokployPackPath(): string {
  return resolvePackDir('paas-template-pack-dokploy', 'MW_DOKPLOY_TEMPLATE_PACK_DIR');
}

export function resolveBigbearPackPath(): string {
  return resolvePackDir('paas-template-pack-bigbear', 'MW_BIGBEAR_TEMPLATE_PACK_DIR');
}

function pickLocalized(
  value: RawBigbearXcasaos['title'],
): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof value.en === 'string') {
    return value.en;
  }
  return '';
}

function formatTemplateName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const DOKPLOY_CACHE_KEY = 'dokploy';
const BIGBEAR_CACHE_KEY = 'bigbear';
const entryCache = new Map<string, Map<string, UnifiedTemplateEntry>>();

function clearUnifiedCache(): void {
  entryCache.delete(DOKPLOY_CACHE_KEY);
  entryCache.delete(BIGBEAR_CACHE_KEY);
}

export function clearUnifiedTemplateCatalogCache(): void {
  clearUnifiedCache();
}

/** Load raw Dokploy blueprints as UnifiedTemplateEntry map keyed by blueprint id. */
export function loadDokployTemplateCatalog(): Map<string, UnifiedTemplateEntry> {
  const cached = entryCache.get(DOKPLOY_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const packDir = resolveDokployPackPath();
  const blueprintsDir = path.join(packDir, 'blueprints');
  const catalog = new Map<string, UnifiedTemplateEntry>();

  let blueprintIds: string[];
  try {
    blueprintIds = readdirSync(blueprintsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    entryCache.set(DOKPLOY_CACHE_KEY, catalog);
    return catalog;
  }

  for (const bp of blueprintIds) {
    const composePath = path.join(blueprintsDir, bp, 'docker-compose.yml');
    if (!existsSync(composePath)) {
      continue;
    }
    try {
      const composeYaml = readFileSync(composePath, 'utf8');
      const parsed = parseYaml(composeYaml);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const composeDoc = parsed as Record<string, unknown>;
      const { compatibility, reasons, serviceNames } = classifyComposeDocument(composeDoc);

      let meta: RawDokployMeta = {};
      const metaPath = path.join(blueprintsDir, bp, 'meta.json');
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RawDokployMeta;
        } catch {
          // Keep empty meta; blueprint still loads without metadata.
        }
      }

      const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name : formatTemplateName(bp);
      catalog.set(bp, {
        id: bp,
        canonicalId: canonicalTemplateSlug(bp),
        name,
        slogan: typeof meta.description === 'string' ? meta.description : '',
        category: Array.isArray(meta.categories) && meta.categories.length
          ? meta.categories[0].toLowerCase()
          : 'other',
        tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        documentation: Array.isArray(meta.links)
          ? meta.links.find((l) => typeof l?.website === 'string')?.website
          : undefined,
        logo: typeof meta.logo === 'string' ? meta.logo : undefined,
        compatibility,
        compatibilityReasons: reasons,
        serviceCount: serviceNames.length,
        services: serviceNames,
        source: 'dokploy',
        duplicateSources: [],
        composeYaml,
        composeDoc,
      });
    } catch {
      // Skip malformed blueprint so one broken YAML never breaks the catalog.
    }
  }

  entryCache.set(DOKPLOY_CACHE_KEY, catalog);
  return catalog;
}

/** Load raw BigBear CasaOS apps as UnifiedTemplateEntry map keyed by app id. */
export function loadBigbearTemplateCatalog(): Map<string, UnifiedTemplateEntry> {
  const cached = entryCache.get(BIGBEAR_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const packDir = resolveBigbearPackPath();
  const appsDir = path.join(packDir, 'apps');
  const catalog = new Map<string, UnifiedTemplateEntry>();

  let appIds: string[];
  try {
    appIds = readdirSync(appsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    entryCache.set(BIGBEAR_CACHE_KEY, catalog);
    return catalog;
  }

  for (const app of appIds) {
    const composePath = path.join(appsDir, app, 'docker-compose.yml');
    if (!existsSync(composePath)) {
      continue;
    }
    try {
      const composeYaml = readFileSync(composePath, 'utf8');
      const parsed = parseYaml(composeYaml);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const composeDoc = parsed as Record<string, unknown>;
      const { compatibility, reasons, serviceNames } = classifyComposeDocument(composeDoc);

      // Metadata lives in the x-casaos extension key (first service).
      let meta: RawBigbearXcasaos = {};
      const servicesRaw = composeDoc.services;
      if (servicesRaw && typeof servicesRaw === 'object' && !Array.isArray(servicesRaw)) {
        for (const svcVal of Object.values(servicesRaw)) {
          if (svcVal && typeof svcVal === 'object' && !Array.isArray(svcVal)) {
            const svc = svcVal as Record<string, unknown>;
            if (svc['x-casaos'] && typeof svc['x-casaos'] === 'object') {
              meta = svc['x-casaos'] as RawBigbearXcasaos;
              break;
            }
          }
        }
      }

      const fallbackName = formatTemplateName(app);
      catalog.set(app, {
        id: app,
        canonicalId: canonicalTemplateSlug(app),
        name: pickLocalized(meta.title) || fallbackName,
        slogan: pickLocalized(meta.tagline) || pickLocalized(meta.description),
        category: typeof meta.category === 'string' && meta.category.trim()
          ? meta.category.trim().toLowerCase()
          : 'other',
        tags: [],
        documentation: undefined,
        logo: typeof meta.icon === 'string' ? meta.icon : undefined,
        compatibility,
        compatibilityReasons: reasons,
        serviceCount: serviceNames.length,
        services: serviceNames,
        source: 'bigbear',
        duplicateSources: [],
        composeYaml,
        composeDoc,
      });
    } catch {
      // Skip malformed app so one broken YAML never breaks the catalog.
    }
  }

  entryCache.set(BIGBEAR_CACHE_KEY, catalog);
  return catalog;
}

export interface UnifiedCatalogOptions {
  sources?: UnifiedPackSource[];
  /** Keep duplicate variants from non-preferred packs instead of marking duplicateSources. */
  keepDuplicates?: boolean;
}

export interface UnifiedCatalog {
  /** Canonical slug -> preferred entry (deduplicated across packs). */
  byCanonical: Map<string, UnifiedTemplateEntry>;
  /** All raw entries across selected sources keyed by `source:id`. */
  all: Map<string, UnifiedTemplateEntry>;
  duplicates: Array<{ canonicalId: string; preferred: UnifiedPackSource; duplicates: UnifiedPackSource[] }>;
}

const SOURCE_PRECEDENCE: UnifiedPackSource[] = ['moonwitness', 'dokploy', 'coolify', 'bigbear'];

export function loadUnifiedTemplateCatalog(options: UnifiedCatalogOptions = {}): UnifiedCatalog {
  const sources = options.sources ?? ['coolify', 'dokploy', 'bigbear'];
  const keepDuplicates = options.keepDuplicates ?? false;

  const byCanonical = new Map<string, UnifiedTemplateEntry>();
  const all = new Map<string, UnifiedTemplateEntry>();
  const duplicates: UnifiedCatalog['duplicates'] = [];

  // Bucket canonical slugs across sources first so duplicateSources is complete.
  const canonicalSources = new Map<string, UnifiedPackSource[]>();
  const canonicalPreferred = new Map<string, UnifiedTemplateEntry>();

  const register = (entries: Map<string, UnifiedTemplateEntry>) => {
    for (const entry of entries.values()) {
      all.set(`${entry.source}:${entry.id}`, entry);
      const list = canonicalSources.get(entry.canonicalId) ?? [];
      if (!list.includes(entry.source)) {
        list.push(entry.source);
      }
      canonicalSources.set(entry.canonicalId, list);

      const preferred = SOURCE_PRECEDENCE.indexOf(entry.source);
      const existing = canonicalPreferred.get(entry.canonicalId);
      if (!existing) {
        canonicalPreferred.set(entry.canonicalId, entry);
        continue;
      }
      const existingRank = SOURCE_PRECEDENCE.indexOf(existing.source);
      if (preferred < existingRank) {
        canonicalPreferred.set(entry.canonicalId, entry);
      }
    }
  };

  if (sources.includes('coolify')) {
    register(loadCoolifyAsUnified());
  }
  if (sources.includes('dokploy')) {
    register(loadDokployTemplateCatalog());
  }
  if (sources.includes('bigbear')) {
    register(loadBigbearTemplateCatalog());
  }

  for (const [canonicalId, entry] of canonicalPreferred) {
    const dupSources = (canonicalSources.get(canonicalId) ?? []).filter((s) => s !== entry.source);
    if (dupSources.length > 0) {
      duplicates.push({ canonicalId, preferred: entry.source, duplicates: dupSources });
    }
    const finalEntry: UnifiedTemplateEntry = {
      ...entry,
      duplicateSources: dupSources,
    };
    if (keepDuplicates) {
      byCanonical.set(`${entry.source}:${entry.id}`, finalEntry);
    } else {
      byCanonical.set(canonicalId, finalEntry);
    }
  }

  return { byCanonical, all, duplicates: duplicates.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)) };
}

function loadCoolifyAsUnified(): Map<string, UnifiedTemplateEntry> {
  // Reuse the existing Coolify loader and adapt entries.
  const cached = entryCache.get('coolify');
  if (cached) {
    return cached;
  }
  const coolifyCatalog = loadCoolifyEntriesAsUnified();
  entryCache.set('coolify', coolifyCatalog);
  return coolifyCatalog;
}

function loadCoolifyEntriesAsUnified(): Map<string, UnifiedTemplateEntry> {
  const out = new Map<string, UnifiedTemplateEntry>();
  try {
    for (const entry of loadCoolifyTemplateCatalog().values()) {
      out.set(entry.id, {
        ...entry,
        canonicalId: canonicalTemplateSlug(entry.id),
        source: 'coolify',
        duplicateSources: [],
      });
    }
  } catch {
    // Coolify pack missing: catalog still works with other sources.
  }
  return out;
}
