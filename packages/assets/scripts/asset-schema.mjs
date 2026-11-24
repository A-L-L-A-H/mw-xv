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
  assertValid(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    filePath,
    '$',
    'must be an object'
  );
  assertValid(manifest.schemaVersion === 1, filePath, 'schemaVersion', 'must equal 1');
  assertValid(Array.isArray(manifest.assets), filePath, 'assets', 'must be an array');

  const byPath = new Map();
  const byId = new Map();
  for (const [index, asset] of manifest.assets.entries()) {
    const field = `assets[${index}]`;
    assertValid(
      asset && typeof asset === 'object' && !Array.isArray(asset),
      filePath,
      field,
      'must be an object'
    );
    assertValid(
      typeof asset.path === 'string' && asset.path.length > 0,
      filePath,
      `${field}.path`,
      'must be a non-empty path'
    );
    assertValid(
      !byPath.has(asset.path),
      filePath,
      `${field}.path`,
      `duplicates ${byPath.get(asset.path)}`
    );
    byPath.set(asset.path, index);

    const id = asset.id ?? asset.path;
    assertValid(
      typeof id === 'string' && id.length > 0,
      filePath,
      `${field}.id`,
      'must be a non-empty string'
    );
    assertValid(!byId.has(id), filePath, `${field}.id`, `duplicates ${byId.get(id)}`);
    byId.set(id, asset.path);

    for (const key of ['pack', 'domain', 'subject']) assertOptionalTag(asset, key, filePath);
    if (asset.status !== undefined) {
      assertValid(
        ASSET_STATUSES.has(asset.status),
        filePath,
        `${field}.status`,
        'must be draft, review, approved, or blocked'
      );
    }
    if (asset.variants !== undefined) {
      assertValid(
        Array.isArray(asset.variants),
        filePath,
        `${field}.variants`,
        'must be an array of canonical asset paths'
      );
      assertValid(
        new Set(asset.variants).size === asset.variants.length,
        filePath,
        `${field}.variants`,
        'must not contain duplicates'
      );
      for (const [variantIndex, variantPath] of asset.variants.entries()) {
        assertValid(
          typeof variantPath === 'string' && variantPath.length > 0,
          filePath,
          `${field}.variants[${variantIndex}]`,
          'must be a non-empty path'
        );
      }
    }
    for (const key of ['sourceAsset']) {
      if (asset[key] !== undefined)
        assertValid(
          typeof asset[key] === 'string' && asset[key].length > 0,
          filePath,
          `${field}.${key}`,
          'must be a non-empty canonical asset path'
        );
    }
    for (const key of ['width', 'height']) {
      if (asset[key] !== undefined)
        assertValid(
          Number.isInteger(asset[key]) && asset[key] > 0,
          filePath,
          `${field}.${key}`,
          'must be a positive integer'
        );
    }
    for (const key of ['focalPoint', 'pivot']) {
      if (asset[key] !== undefined && typeof asset[key] !== 'string')
        assertNormalizedPoint(asset[key], filePath, `${field}.${key}`);
    }
    if (asset.spriteSheet !== undefined) {
      const sheet = asset.spriteSheet;
      assertValid(
        sheet && typeof sheet === 'object' && !Array.isArray(sheet),
        filePath,
        `${field}.spriteSheet`,
        'must be an object'
      );
      for (const key of [
        'atlas',
        'frameWidth',
        'frameHeight',
        'frameCount',
        'frameDurationMs',
        'columns',
        'rows',
      ]) {
        assertValid(
          sheet[key] !== undefined,
          filePath,
          `${field}.spriteSheet.${key}`,
          'is required'
        );
      }
      assertValid(
        typeof sheet.atlas === 'string' && sheet.atlas.length > 0,
        filePath,
        `${field}.spriteSheet.atlas`,
        'must be a canonical asset path'
      );
      for (const key of [
        'frameWidth',
        'frameHeight',
        'frameCount',
        'frameDurationMs',
        'columns',
        'rows',
      ]) {
        assertValid(
          Number.isInteger(sheet[key]) && sheet[key] > 0,
          filePath,
          `${field}.spriteSheet.${key}`,
          'must be a positive integer'
        );
      }
      assertValid(
        typeof sheet.loop === 'boolean',
        filePath,
        `${field}.spriteSheet.loop`,
        'must be a boolean'
      );
      assertValid(
        ['forward', 'reverse', 'ping-pong'].includes(sheet.direction),
        filePath,
        `${field}.spriteSheet.direction`,
        'must be forward, reverse, or ping-pong'
      );
      assertNormalizedPoint(sheet.pivot, filePath, `${field}.spriteSheet.pivot`);
      assertValid(
        sheet.frameCount <= sheet.columns * sheet.rows,
        filePath,
        `${field}.spriteSheet.frameCount`,
        'exceeds the declared atlas grid'
      );
      const atlas = manifest.assets.find(({ path }) => path === sheet.atlas);
      assertValid(
        Boolean(atlas),
        filePath,
        `${field}.spriteSheet.atlas`,
        `references missing asset path ${sheet.atlas}`
      );
      assertValid(
        sheet.columns * sheet.frameWidth <= atlas.width,
        filePath,
        `${field}.spriteSheet.columns`,
        'exceeds atlas width'
      );
      assertValid(
        sheet.rows * sheet.frameHeight <= atlas.height,
        filePath,
        `${field}.spriteSheet.rows`,
        'exceeds atlas height'
      );
    }
  }

  for (const [index, asset] of manifest.assets.entries()) {
    for (const [field, reference] of [
      ['sourceAsset', asset.sourceAsset],
      ...(asset.variants ?? []).map((path, variantIndex) => [`variants[${variantIndex}]`, path]),
    ]) {
      if (reference === undefined) continue;
      assertValid(
        byPath.has(reference),
        filePath,
        `assets[${index}].${field}`,
        `references missing asset path ${reference}`
      );
      assertValid(
        reference !== asset.path,
        filePath,
        `assets[${index}].${field}`,
        'cannot reference itself'
      );
    }
  }

  return { assetCount: manifest.assets.length };
}

/** Render a metadata-only guide; this never crops or creates production frames. */
export function renderSpriteSheetGuide(asset, { label = asset.path } = {}) {
  const sheet = asset.spriteSheet;
  if (!sheet) throw new Error(`${asset.path}: spriteSheet metadata is required`);
  if (!Number.isInteger(sheet.frameCount) || sheet.frameCount < 1 || sheet.frameCount > 4096) {
    throw new Error(`${asset.path}: frameCount must be between 1 and 4096 to render a guide`);
  }
  const width = sheet.columns * sheet.frameWidth;
  const height = sheet.rows * sheet.frameHeight;
  const escapeXml = (value) =>
    String(value).replace(
      /[&<>"']/gu,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[character]
    );
  const cells = Array.from({ length: sheet.frameCount }, (_, index) => {
    const x = (index % sheet.columns) * sheet.frameWidth;
    const y = Math.floor(index / sheet.columns) * sheet.frameHeight;
    return { x, y, number: index + 1 };
  });
  const outlines = cells
    .map(
      ({ x, y }) =>
        `<rect x="${x}" y="${y}" width="${sheet.frameWidth}" height="${sheet.frameHeight}"/>`
    )
    .join('');
  const numbers = cells
    .map(({ x, y, number }) => `<text x="${x + 8}" y="${y + 24}">${number}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Frame metadata guide for ${escapeXml(label)}"><rect width="${width}" height="${height}" fill="#10151f"/><g fill="none" stroke="#ffcc4d">${outlines}</g><g fill="#ffcc4d" font-family="monospace" font-size="16">${numbers}</g></svg>`;
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
    assertValid(
      entry && typeof entry === 'object' && !Array.isArray(entry),
      filePath,
      field,
      'must be an object'
    );
    assertValid(
      typeof entry.path === 'string' && entry.path.length > 0,
      filePath,
      `${field}.path`,
      'must be a non-empty path'
    );
    assertValid(!seen.has(entry.path), filePath, `${field}.path`, 'must be unique');
    seen.add(entry.path);
    assertValid(
      manifestSources.has(entry.path),
      filePath,
      `${field}.path`,
      'must match a canonical source asset'
    );
    for (const key of ['creator', 'source', 'license', 'modifications']) {
      assertValid(
        typeof entry[key] === 'string' && entry[key].trim().length > 0,
        filePath,
        `${field}.${key}`,
        'must be a non-empty string'
      );
    }
    assertValid(
      ['draft', 'review', 'approved', 'blocked'].includes(entry.status),
      filePath,
      `${field}.status`,
      'must be draft, review, approved, or blocked'
    );
    assertValid(
      typeof entry.distribution === 'string' && entry.distribution.trim().length > 0,
      filePath,
      `${field}.distribution`,
      'must describe distribution eligibility'
    );
    if (entry.license === 'unverified' || entry.termsVerified === false) {
      assertValid(
        entry.status === 'blocked' && /blocked/iu.test(entry.distribution),
        filePath,
        field,
        'unverified rights must be blocked from distribution'
      );
    }
    if (entry.status === 'approved') {
      assertValid(
        entry.license !== 'unverified' && entry.termsVerified !== false,
        filePath,
        field,
        'approved provenance must have verified rights'
      );
    }
  }

  for (const path of manifestSources.keys()) {
    assertValid(seen.has(path), filePath, 'sourceAssets', `is missing provenance for ${path}`);
  }

  return { sourceAssetCount: seen.size };
}
