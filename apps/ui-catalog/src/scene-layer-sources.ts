export type SceneLayerSourceInput = { id: string };

/** Resolve imported artwork by canonical scene layer ID, never by array position. */
export function resolveSceneLayerSources<T extends SceneLayerSourceInput>(
  layers: readonly T[],
  sourcesById: Readonly<Record<string, string | undefined>>
): Array<T & { src: string }> {
  const seen = new Set<string>();
  for (const layer of layers) {
    if (!layer.id || seen.has(layer.id)) {
      throw new Error(`Scene layer IDs must be unique and non-empty; duplicate "${layer.id}".`);
    }
    seen.add(layer.id);
  }
  for (const id of Object.keys(sourcesById)) {
    if (!seen.has(id)) throw new Error(`Unexpected imported source mapping for scene layer "${id}".`);
  }
  return layers.map((layer) => {
    const src = sourcesById[layer.id];
    if (typeof src !== 'string' || !src.trim()) {
      throw new Error(`Scene layer "${layer.id}" is missing an imported source mapping.`);
    }
    return { ...layer, src };
  });
}
