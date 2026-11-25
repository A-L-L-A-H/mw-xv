import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  collectManifestAssets,
  measureUiCatalogAssets,
  renderBundleSummary,
  resolveCatalogAssetPath,
  summarizeBundleGroup,
  validateBundleBudget,
} from '../../../scripts/check-ui-catalog-budget.mjs';

const limits = { maxRawBytes: 1_000_000, maxGzipBytes: 1_000_000 };

function createBudget() {
  const budgetLimits = () => ({ ...limits });
  return {
    schemaVersion: 2,
    groups: {
      initial: { javascript: budgetLimits(), stylesheet: budgetLimits() },
      lazy: { javascript: budgetLimits(), stylesheet: budgetLimits() },
      total: { javascript: budgetLimits(), stylesheet: budgetLimits() },
    },
    sections: {
      scene: { entry: 'src/SceneLab.tsx', javascript: budgetLimits() },
      assets: { entry: 'src/AssetBrowser.tsx', javascript: budgetLimits() },
    },
  };
}

function createManifest() {
  return {
    'src/main.tsx': {
      file: 'assets/main.js',
      src: 'src/main.tsx',
      isEntry: true,
      imports: ['_shared.js'],
      dynamicImports: ['src/SceneLab.tsx', 'src/AssetBrowser.tsx'],
      css: ['assets/main.css'],
    },
    '_shared.js': { file: 'assets/shared.js', imports: [] },
    'src/SceneLab.tsx': {
      file: 'assets/SceneLab.js',
      src: 'src/SceneLab.tsx',
      isDynamicEntry: true,
      imports: ['_shared.js', '_scene-shared.js'],
      css: ['assets/scene.css'],
    },
    '_scene-shared.js': { file: 'assets/scene-shared.js', imports: [] },
    'src/AssetBrowser.tsx': {
      file: 'assets/AssetBrowser.js',
      src: 'src/AssetBrowser.tsx',
      isDynamicEntry: true,
      imports: ['_shared.js', '_shared.js'],
    },
  };
}

function createReader() {
  const files = new Map(
    [
      'assets/main.js',
      'assets/shared.js',
      'assets/SceneLab.js',
      'assets/scene-shared.js',
      'assets/AssetBrowser.js',
      'assets/main.css',
      'assets/scene.css',
    ].map((name) => [name, Buffer.from(`contents:${name}`)])
  );
  return async (name) => {
    const contents = files.get(name);
    if (!contents) throw new Error(`Missing test asset ${name}`);
    return contents;
  };
}

test('bundle measurement reports raw/gzip sizes and passes within the declared budget', () => {
  const group = summarizeBundleGroup(
    'JavaScript',
    [{ name: 'catalog.js', contents: Buffer.from('catalog output') }],
    { maxRawBytes: 100, maxGzipBytes: 100 }
  );

  assert.equal(group.rawBytes, Buffer.byteLength('catalog output'));
  assert.ok(group.gzipBytes > 0);
  assert.equal(group.passed, true);
  assert.match(renderBundleSummary([group]), /\| JavaScript \|/u);
});

test('bundle measurement fails when either raw or gzip limit is crossed', () => {
  const rawOverBudget = summarizeBundleGroup(
    'JavaScript',
    [{ name: 'catalog.js', contents: Buffer.from('large') }],
    { maxRawBytes: 1, maxGzipBytes: 100 }
  );
  const gzipOverBudget = summarizeBundleGroup(
    'Stylesheet',
    [{ name: 'catalog.css', contents: Buffer.alloc(512, 0) }],
    { maxRawBytes: 1024, maxGzipBytes: 1 }
  );

  assert.equal(rawOverBudget.passed, false);
  assert.equal(gzipOverBudget.passed, false);
});

test('bundle measurement rejects an absent required asset group instead of silently skipping it', () => {
  assert.throws(
    () => summarizeBundleGroup('JavaScript', [], { maxRawBytes: 100, maxGzipBytes: 100 }),
    /No JavaScript bundle files/u
  );
  const emptyLazyStylesheet = summarizeBundleGroup(
    'Lazy stylesheet',
    [],
    { maxRawBytes: 1, maxGzipBytes: 1 },
    { allowEmpty: true }
  );
  assert.equal(emptyLazyStylesheet.rawBytes, 0);
  assert.equal(emptyLazyStylesheet.gzipBytes, 0);
  assert.equal(emptyLazyStylesheet.passed, true);
});

test('bundle measurement deduplicates files by path before reporting bytes', () => {
  const file = { name: 'catalog.js', contents: Buffer.from('catalog output') };
  const group = summarizeBundleGroup('JavaScript', [file, file], {
    maxRawBytes: 100,
    maxGzipBytes: 100,
  });
  assert.deepEqual(group.files, ['catalog.js']);
  assert.equal(group.rawBytes, Buffer.byteLength('catalog output'));
});

test('manifest graph separates initial and lazy assets, deduplicates imports, and measures sections', async () => {
  const { groups, sections } = await measureUiCatalogAssets(
    createManifest(),
    createBudget(),
    createReader()
  );

  assert.deepEqual(groups.initial.javascript.files, ['assets/main.js', 'assets/shared.js']);
  assert.deepEqual(groups.initial.stylesheet.files, ['assets/main.css']);
  assert.deepEqual(groups.lazy.javascript.files, [
    'assets/AssetBrowser.js',
    'assets/SceneLab.js',
    'assets/scene-shared.js',
  ]);
  assert.deepEqual(groups.lazy.stylesheet.files, ['assets/scene.css']);
  assert.equal(groups.total.javascript.files.length, 5);
  assert.deepEqual(sections.scene.files, ['assets/SceneLab.js', 'assets/scene-shared.js']);
  assert.deepEqual(sections.assets.files, ['assets/AssetBrowser.js']);
  assert.equal(
    groups.total.javascript.rawBytes,
    groups.initial.javascript.rawBytes + groups.lazy.javascript.rawBytes
  );
});

test('manifest traversal follows nested dynamic imports without losing shared chunks', () => {
  const manifest = createManifest();
  manifest['src/SceneLab.tsx'].dynamicImports = ['_scene-shared.js'];
  const graph = collectManifestAssets(manifest, ['src/SceneLab.tsx'], { includeDynamic: true });
  assert.deepEqual(graph.javascript, [
    'assets/SceneLab.js',
    'assets/scene-shared.js',
    'assets/shared.js',
  ]);
});

test('asset path resolution rejects traversal, absolute paths, and backslash separators', () => {
  const directory = path.resolve('/tmp/ui-catalog-dist/assets');
  assert.equal(
    resolveCatalogAssetPath('/assets/main.js', directory),
    path.join(directory, 'assets/main.js')
  );
  for (const unsafe of [
    '../secret.js',
    '/../secret.js',
    'assets/../../secret.js',
    '..\\secret.js',
  ]) {
    assert.throws(
      () => resolveCatalogAssetPath(unsafe, directory),
      /Unsafe UI catalog asset path/u
    );
  }
});

test('missing manifest chunks and orphan output fail instead of being silently omitted', async () => {
  const missingImport = createManifest();
  missingImport['src/main.tsx'].imports = ['missing.js'];
  assert.throws(
    () => collectManifestAssets(missingImport, ['src/main.tsx']),
    /missing chunk missing.js/u
  );

  const orphan = createManifest();
  orphan['orphan.js'] = { file: 'assets/orphan.js', imports: [] };
  await assert.rejects(
    () => measureUiCatalogAssets(orphan, createBudget(), createReader()),
    /outside the initial\/lazy graph: assets\/orphan.js/u
  );
});

test('schema v2 requires group and lazy-section limits and preserves total ceilings', async () => {
  assert.throws(() => validateBundleBudget({ schemaVersion: 1 }), /schemaVersion 2/u);
  const missingSection = createBudget();
  delete missingSection.sections;
  assert.throws(() => validateBundleBudget(missingSection), /lazy section limits/u);
  const invalidLimits = createBudget();
  invalidLimits.groups.initial.javascript.maxRawBytes = 0;
  assert.throws(() => validateBundleBudget(invalidLimits), /positive safe integers/u);

  const manifest = createManifest();
  const unmatched = createBudget();
  delete unmatched.sections.assets;
  await assert.rejects(
    () => measureUiCatalogAssets(manifest, unmatched, createReader()),
    /lack section budgets: src\/AssetBrowser.tsx/u
  );

  const committed = JSON.parse(
    await readFile(new URL('../bundle-budget.json', import.meta.url), 'utf8')
  );
  assert.equal(committed.schemaVersion, 2);
  assert.deepEqual(committed.groups.total.javascript, {
    maxRawBytes: 635000,
    maxGzipBytes: 188000,
  });
  assert.deepEqual(committed.groups.total.stylesheet, {
    maxRawBytes: 164000,
    maxGzipBytes: 29000,
  });
});
