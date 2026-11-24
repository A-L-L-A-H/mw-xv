import type { Addon } from '@moonwitness/orm';

/**
 * Static addon manifest shape mirroring the imports inside
 * `apps/api/src/addons/registry.ts` (`API_ADDONS[]`).
 *
 * This module performs PURE STATIC enumeration: it never calls
 * `defineAddon`, `defineModel`, `Registry.register`, or any database API.
 * Each entry is a runtime manifest object already built by its owning
 * `packages/orm-*` package; we only read `.name` and `.models[].modelName`.
 */
export interface MoonWitnessAddonManifest {
  readonly name: string;
  readonly manifest: Addon;
}

export interface ModelCatalogEntry {
  readonly modelName: string;
  readonly addonName: string;
}

let cachedCatalog: readonly ModelCatalogEntry[] | null = null;

/**
 * Register a manifest for catalog enumeration. This is a plain data
 * collection call — it does NOT touch the ORM `Registry` and never
 * instantiates or mutates models.
 */
export function registerMoonWitnessManifest(manifest: MoonWitnessAddonManifest): void {
  registeredManifests.push(manifest);
  cachedCatalog = null;
}

const registeredManifests: MoonWitnessAddonManifest[] = [];

/**
 * Enumerate every model name declared across the registered manifests in
 * registration order, deduplicated, sorted for stable output.
 */
export function listMoonWitnessModels(): readonly ModelCatalogEntry[] {
  if (!cachedCatalog) {
    const seen = new Map<string, string>();
    for (const { name, manifest } of registeredManifests) {
      for (const model of manifest.models) {
        if (!seen.has(model.modelName)) {
          seen.set(model.modelName, name);
        }
      }
    }
    cachedCatalog = [...seen.entries()]
      .map(([modelName, addonName]) => ({ modelName, addonName }))
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
  }
  return cachedCatalog;
}

/** Read-only field-kind inspection for a single model, or null when unknown. */
export function describeMoonWitnessModel(modelName: string): {
  readonly modelName: string;
  readonly addonName: string;
  readonly fields: readonly string[];
} | null {
  for (const { name, manifest } of registeredManifests) {
    const model = manifest.models.find((candidate) => candidate.modelName === modelName);
    if (model) {
      const fields = Object.keys(model.fields ?? {}).sort();
      return { modelName, addonName: name, fields };
    }
  }
  return null;
}
