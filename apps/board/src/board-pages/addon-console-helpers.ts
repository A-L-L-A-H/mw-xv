export interface AddonModelSummary {
  readonly model: string;
  readonly menu: { readonly label?: string };
}

export interface AddonSummary<T extends AddonModelSummary = AddonModelSummary> {
  readonly addon: string;
  readonly models: readonly T[];
}

export function extractModelAddon(model: string): string {
  const dot = model.indexOf('.');
  return dot === -1 ? model : model.slice(0, dot);
}

export function groupModelsByAddon<T extends AddonModelSummary>(
  models: readonly T[]
): readonly AddonSummary<T>[] {
  const grouped = new Map<string, T[]>();
  for (const item of models) {
    const addon = extractModelAddon(item.model);
    const list = grouped.get(addon) ?? [];
    list.push(item);
    grouped.set(addon, list);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([addon, list]) => ({
      addon,
      models: list.sort((a, b) => a.model.localeCompare(b.model)),
    }));
}
