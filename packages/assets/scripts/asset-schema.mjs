const ASSET_STATUSES = new Set(['draft', 'review', 'approved', 'blocked']);

function assertValid(condition, filePath, field, message) {
  if (!condition) throw new Error(`${filePath}: ${field} ${message}`);
}

function assertNormalizedPoint(value, filePath, field) {
  assertValid(
    value && typeof value === 'object' && !Array.isArray(value),
    filePath,
    field,
    'must be an object with normalized x and y values'
  );
  assertValid(
    Number.isFinite(value.x) && value.x >= 0 && value.x <= 1,
    filePath,
    `${field}.x`,
    'must be between 0 and 1'
  );
  assertValid(
    Number.isFinite(value.y) && value.y >= 0 && value.y <= 1,
    filePath,
    `${field}.y`,
    'must be between 0 and 1'
  );
}

function assertOptionalTag(asset, key, filePath) {
  if (asset[key] === undefined) return;
  assertValid(
    typeof asset[key] === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(asset[key]),
    filePath,
    `assets.${asset.path}.${key}`,
    'must be a lowercase hyphenated identifier'
  );
}

/** Validate the canonical v1 manifest and backward-compatible optional extensions. */
export function validateAssetManifest(manifest, filePath = 'manifest.json') {
  assertValid(manifest && typeof manifest === 'object' && !Array.isArray(manifest), filePath, '$', 'must be an object');
  assertValid(manifest.schemaVersion === 1, filePath, 'schemaVersion', 'must equal 1');
  assertValid(Array.isArray(manifest.assets), filePath, 'assets', 'must be an array');

  const byPath = new Map();
  const byId = new Map();
  for (const [index, asset] of manifest.assets.entries()) {
    const field = `assets[${index}]`;
    assertValid(asset && typeof asset === 'object' && !Array.isArray(asset), filePath, field, 'must be an object');
    assertValid(typeof asset.path === 'string' && asset.path.length > 0, filePath, `${field}.path`, 'must be a non-empty path');
    assertValid(!byPath.has(asset.path), filePath, `${field}.path`, `duplicates ${byPath.get(asset.path)}`);
    byPath.set(asset.path, index);

    const id = asset.id ?? asset.path;
    assertValid(typeof id === 'string' && id.length > 0, filePath, `${field}.id`, 'must be a non-empty string');
    assertValid(!byId.has(id), filePath, `${field}.id`, `duplicates ${byId.get(id)}`);
    byId.set(id, asset.path);

    for (const key of ['pack', 'domain', 'subject']) assertOptionalTag(asset, key, filePath);
    if (asset.status !== undefined) {
      assertValid(ASSET_STATUSES.has(asset.status), filePath, `${field}.status`, 'must be draft, review, approved, or blocked');
    }
    if (asset.variants !== undefined) {
      assertValid(Array.isArray(asset.variants), filePath, `${field}.variants`, 'must be an array of canonical asset paths');
      assertValid(new Set(asset.variants).size === asset.variants.length, filePath, `${field}.variants`, 'must not contain duplicates');
      for (const [variantIndex, variantPath] of asset.variants.entries()) {
        assertValid(typeof variantPath === 'string' && variantPath.length > 0, filePath, `${field}.variants[${variantIndex}]`, 'must be a non-empty path');
      }
    }
    for (const key of ['sourceAsset']) {
      if (asset[key] !== undefined) assertValid(typeof asset[key] === 'string' && asset[key].length > 0, filePath, `${field}.${key}`, 'must be a non-empty canonical asset path');
    }
    for (const key of ['width', 'height']) {
      if (asset[key] !== undefined) assertValid(Number.isInteger(asset[key]) && asset[key] > 0, filePath, `${field}.${key}`, 'must be a positive integer');
    }
    for (const key of ['focalPoint', 'pivot']) {
      if (asset[key] !== undefined && typeof asset[key] !== 'string') assertNormalizedPoint(asset[key], filePath, `${field}.${key}`);
    }
  }

  for (const [index, asset] of manifest.assets.entries()) {
    for (const [field, reference] of [['sourceAsset', asset.sourceAsset], ...(asset.variants ?? []).map((path, variantIndex) => [`variants[${variantIndex}]`, path])]) {
      if (reference === undefined) continue;
      assertValid(byPath.has(reference), filePath, `assets[${index}].${field}`, `references missing asset path ${reference}`);
      assertValid(reference !== asset.path, filePath, `assets[${index}].${field}`, 'cannot reference itself');
    }
  }

  return { assetCount: manifest.assets.length };
}

/** Ensure source provenance is complete and unknown rights are never distributable. */
export function validateSourceProvenance(manifest, licenses, filePath = 'licenses.json') {
  const manifestSources = new Map(
    manifest.assets
      .filter((asset) => asset.kind === 'source' && asset.pack)
      .map((asset) => [asset.path, asset])
  );
  const provenanceEntries = licenses.sourceAssets ?? [];
  assertValid(Array.isArray(provenanceEntries), filePath, 'sourceAssets', 'must be an array');
  const seen = new Set();

  for (const [index, entry] of provenanceEntries.entries()) {
    const field = `sourceAssets[${index}]`;
    assertValid(entry && typeof entry === 'object' && !Array.isArray(entry), filePath, field, 'must be an object');
    assertValid(typeof entry.path === 'string' && entry.path.length > 0, filePath, `${field}.path`, 'must be a non-empty path');
    assertValid(!seen.has(entry.path), filePath, `${field}.path`, 'must be unique');
    seen.add(entry.path);
    assertValid(manifestSources.has(entry.path), filePath, `${field}.path`, 'must match a canonical source asset');
    for (const key of ['creator', 'source', 'license', 'modifications']) {
      assertValid(typeof entry[key] === 'string' && entry[key].trim().length > 0, filePath, `${field}.${key}`, 'must be a non-empty string');
    }
    assertValid(['draft', 'review', 'approved', 'blocked'].includes(entry.status), filePath, `${field}.status`, 'must be draft, review, approved, or blocked');
    assertValid(typeof entry.distribution === 'string' && entry.distribution.trim().length > 0, filePath, `${field}.distribution`, 'must describe distribution eligibility');
    if (entry.license === 'unverified' || entry.termsVerified === false) {
      assertValid(entry.status === 'blocked' && /blocked/iu.test(entry.distribution), filePath, field, 'unverified rights must be blocked from distribution');
    }
    if (entry.status === 'approved') {
      assertValid(entry.license !== 'unverified' && entry.termsVerified !== false, filePath, field, 'approved provenance must have verified rights');
    }
  }

  for (const path of manifestSources.keys()) {
    assertValid(seen.has(path), filePath, 'sourceAssets', `is missing provenance for ${path}`);
  }

  return { sourceAssetCount: seen.size };
}
