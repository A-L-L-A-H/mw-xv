/**
 * Curated registration of MoonWitness addon manifests for the read-only
 * MCP catalog. This file contains ZERO `defineModel` / `defineAddon`
 * calls — it only imports already-built manifests from `packages/orm-*`
 * and hands them to the pure enumerator in `catalog.ts`.
 *
 * Keep in sync with `apps/api/src/addons/registry.ts` (`API_ADDONS[]`).
 */
import type { Addon } from '@moonwitness/orm';
import { registerMoonWitnessManifest } from './catalog.js';

interface NamedManifest {
  readonly name: string;
  readonly manifest: Addon;
}

type MaybeManifest = NamedManifest | undefined;

function registerIfPresent(entry: MaybeManifest): void {
  if (entry && entry.manifest && Array.isArray(entry.manifest.models)) {
    registerMoonWitnessManifest({ name: entry.name, manifest: entry.manifest });
  }
}

export const MANIFEST_KEYS = [
  'base',
  'auth',
  'jobs',
  'notification',
  'workflow',
  'organization',
  'project',
  'crm',
  'sales',
  'subscription',
  'integration',
  'request',
  'knowledge',
  'ai',
  'a2a',
  'storage',
  'whatsapp',
  'isp',
  'cloud',
] as const;

export type ManifestKey = (typeof MANIFEST_KEYS)[number];

export type ManifestLoaderMap = Readonly<Record<ManifestKey, () => Promise<MaybeManifest>>>;

export async function registerCatalogManifests(loaders: ManifestLoaderMap): Promise<void> {
  const entries = await Promise.all(MANIFEST_KEYS.map((key) => loaders[key]()));
  for (const entry of entries) registerIfPresent(entry);
}
