#!/usr/bin/env node
import { loadUnifiedTemplateCatalog } from '../src/unified-template-pack.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, 'dist');
mkdirSync(outDir, { recursive: true });

const catalog = loadUnifiedTemplateCatalog({ sources: ['moonwitness', 'dokploy', 'coolify', 'bigbear'] });

// Convert to simplified JSON for Go consumption
const output = {
  generatedAt: new Date().toISOString(),
  totalCanonical: catalog.byCanonical.size,
  totalRaw: catalog.all.size,
  duplicates: catalog.duplicates.length,
  templates: Array.from(catalog.byCanonical.values()).map((e) => ({
    id: e.id,
    canonicalId: e.canonicalId,
    name: e.name,
    slogan: e.slogan,
    category: e.category,
    tags: e.tags,
    documentation: e.documentation ?? '',
    logo: e.logo ?? '',
    source: e.source,
    duplicateSources: e.duplicateSources,
    compatibility: e.compatibility,
    compatibilityReasons: e.compatibilityReasons,
    serviceCount: e.serviceCount,
    services: e.services,
    composeYaml: e.composeYaml,
  })),
};

writeFileSync(path.join(outDir, 'unified-template-catalog.json'), JSON.stringify(output, null, 2));
console.log(`Generated unified-template-catalog.json: ${output.totalCanonical} canonical, ${output.totalRaw} raw, ${output.duplicates} duplicate groups`);

// Also generate Go-friendly index (only ready/inline_config, no restricted)
const filtered = output.templates.filter((t) => t.compatibility !== 'restricted');
writeFileSync(path.join(outDir, 'unified-template-catalog-ready.json'), JSON.stringify({
  generatedAt: output.generatedAt,
  totalCanonical: filtered.length,
  templates: filtered.map((t) => ({
    id: t.id,
    canonicalId: t.canonicalId,
    name: t.name,
    slogan: t.slogan,
    category: t.category,
    tags: t.tags,
    documentation: t.documentation,
    logo: t.logo,
    source: t.source,
    duplicateSources: t.duplicateSources,
    serviceCount: t.serviceCount,
    services: t.services,
    composeYaml: t.composeYaml,
  })),
}, null, 2));
console.log(`Generated unified-template-catalog-ready.json: ${filtered.length} deployable templates`);