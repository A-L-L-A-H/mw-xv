export function validateCharacterRegistry(registry, filePath = 'character-registry.json') {
  const byId = new Map();
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error(filePath + ': registry must be an object');
  }
  if (registry.schemaVersion !== 1) {
    throw new Error(filePath + ': schemaVersion must be 1');
  }
  if (!Array.isArray(registry.characters)) {
    throw new Error(filePath + ': characters must be an array');
  }
  for (const [index, character] of registry.characters.entries()) {
    const field = `characters[${index}]`;
    if (!character || typeof character !== 'object' || Array.isArray(character)) {
      throw new Error(filePath + ': ' + field + ' must be an object');
    }
    for (const key of ['characterId','role','depictionPolicy','silhouette','outfit','proportions','license','status']) {
      if (typeof character[key] !== 'string' || character[key].trim().length === 0) {
        throw new Error(filePath + ': ' + field + '.' + key + ' must be a non-empty string');
      }
    }
    for (const key of ['paletteTokens','allowedVariants','prohibitedVariants','masterAssetIds','variantAssetIds']) {
      if (!Array.isArray(character[key])) {
        throw new Error(filePath + ': ' + field + '.' + key + ' must be an array');
      }
      for (const [itemIndex, item] of (character[key] ?? []).entries()) {
        if (typeof item !== 'string' || item.trim().length === 0) {
          throw new Error(filePath + ': ' + field + '.' + key + '[' + itemIndex + '] must be a non-empty string');
        }
      }
    }
    const ALLOWED_DEPICTION = new Set(['anonymous-back-facing','identified-approved','silhouette-only']);
    if (!ALLOWED_DEPICTION.has(character.depictionPolicy)) {
      throw new Error(filePath + ': ' + field + '.depictionPolicy must be one of anonymous-back-facing, identified-approved, silhouette-only');
    }
    const ALLOWED_STATUS = new Set(['draft','review','approved','blocked']);
    if (!ALLOWED_STATUS.has(character.status)) {
      throw new Error(filePath + ': ' + field + '.status must be draft, review, approved, or blocked');
    }
    const id = character.characterId;
    if (byId.has(id)) {
      throw new Error(filePath + ': ' + field + '.characterId duplicates ' + byId.get(id));
    }
    byId.set(id, index);
    if (character.masterAssetIds.some((a) => character.variantAssetIds.includes(a))) {
      throw new Error(filePath + ': ' + field + ' master and variant asset ids must not overlap');
    }
  }
  return { characterCount: registry.characters.length, characterIds: [...byId.keys()] };
}
