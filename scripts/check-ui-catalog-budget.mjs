import { gzipSync } from 'node:zlib';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(root, 'apps/ui-catalog/dist');
const manifestPath = path.join(root, 'apps/ui-catalog/dist/.vite/manifest.json');
const budgetPath = path.join(root, 'apps/ui-catalog/bundle-budget.json');
const assetKinds = ['javascript', 'stylesheet'];

function validateLimits(name, limits) {
  if (
    typeof limits !== 'object' ||
    limits === null ||
    !Number.isSafeInteger(limits.maxRawBytes) ||
    !Number.isSafeInteger(limits.maxGzipBytes) ||
    limits.maxRawBytes <= 0 ||
    limits.maxGzipBytes <= 0
  ) {
    throw new Error(`UI catalog ${name} budget limits must be positive safe integers.`);
  }
}

export function validateBundleBudget(value) {
  if (typeof value !== 'object' || value === null || value.schemaVersion !== 2) {
    throw new Error('UI catalog bundle budget must use schemaVersion 2.');
  }
  for (const groupName of ['initial', 'lazy', 'total']) {
    for (const kind of assetKinds) {
      validateLimits(`${groupName} ${kind}`, value.groups?.[groupName]?.[kind]);
    }
  }
  if (typeof value.sections !== 'object' || value.sections === null) {
    throw new Error('UI catalog bundle budget must declare lazy section limits.');
  }
  for (const [sectionId, section] of Object.entries(value.sections)) {
    if (
      typeof section.entry !== 'string' ||
      section.entry.length === 0 ||
      path.isAbsolute(section.entry) ||
      section.entry.split(/[\\/]/u).includes('..')
    ) {
      throw new Error(`UI catalog section ${sectionId} needs a safe manifest entry pattern.`);
    }
    validateLimits(`section ${sectionId} javascript`, section.javascript);
  }
  return value;
}

export function summarizeBundleGroup(name, files, limits, { allowEmpty = false } = {}) {
  if (files.length === 0 && !allowEmpty) throw new Error(`No ${name} bundle files were found.`);
  const uniqueFiles = [...new Map(files.map((file) => [file.name, file])).values()];
  const rawBytes = uniqueFiles.reduce((total, file) => total + file.contents.byteLength, 0);
  const gzipBytes = uniqueFiles.reduce(
    (total, file) => total + gzipSync(file.contents).byteLength,
    0
  );
  const rawPass = rawBytes <= limits.maxRawBytes;
  const gzipPass = gzipBytes <= limits.maxGzipBytes;
  return {
    name,
    files: uniqueFiles.map(({ name: fileName }) => fileName).sort(),
    rawBytes,
    gzipBytes,
    maxRawBytes: limits.maxRawBytes,
    maxGzipBytes: limits.maxGzipBytes,
    passed: rawPass && gzipPass,
  };
}

export function renderBundleSummary(groups) {
  const lines = [
    '## UI catalog bundle budget',
    '',
    '| Asset | Raw | Budget | Gzip | Budget | Result |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const group of groups) {
    lines.push(
      `| ${group.name} | ${group.rawBytes} B | ${group.maxRawBytes} B | ${group.gzipBytes} B | ${group.maxGzipBytes} B | ${group.passed ? 'pass' : 'over budget'} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function resolveCatalogAssetPath(name, directory = distDirectory) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0') || name.includes('\\')) {
    throw new Error(`Unsafe UI catalog asset path: ${String(name)}`);
  }
  const relative = name.replace(/^\/+/u, '');
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`Unsafe UI catalog asset path: ${name}`);
  }
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error(`Unsafe UI catalog asset path: ${name}`);
  }
  return resolved;
}

function addAsset(names, name, kind) {
  resolveCatalogAssetPath(name);
  const extension = kind === 'javascript' ? '.js' : '.css';
  if (!name.endsWith(extension)) {
    throw new Error(`UI catalog ${kind} manifest entry has an unexpected extension: ${name}`);
  }
  names.add(name.replace(/^\/+/u, ''));
}

export function collectManifestAssets(
  manifest,
  entryKeys,
  { includeDynamic = false, stopAtFiles = new Set() } = {}
) {
  const javascript = new Set();
  const stylesheet = new Set();
  const visited = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (typeof chunk !== 'object' || chunk === null) {
      throw new Error(
        `UI catalog Vite manifest is missing chunk ${key}. Run the Catalog build first.`
      );
    }
    addAsset(javascript, chunk.file, 'javascript');
    if (stopAtFiles.has(chunk.file.replace(/^\/+/u, ''))) return;
    for (const asset of chunk.css ?? []) addAsset(stylesheet, asset, 'stylesheet');
    for (const imported of chunk.imports ?? []) visit(imported);
    if (includeDynamic) {
      for (const imported of chunk.dynamicImports ?? []) visit(imported);
    }
  }

  for (const key of entryKeys) visit(key);
  return {
    javascript: [...javascript].sort(),
    stylesheet: [...stylesheet].sort(),
  };
}

function difference(left, right) {
  return left.filter((name) => !right.has(name));
}

function isJavaScriptChunk(chunk) {
  return typeof chunk?.file === 'string' && chunk.file.endsWith('.js');
}

function findDynamicEntries(manifest) {
  return Object.entries(manifest)
    .filter(([, chunk]) => chunk?.isDynamicEntry === true && isJavaScriptChunk(chunk))
    .map(([key]) => key);
}

function matchSectionEntries(manifest, budget) {
  const dynamicEntries = findDynamicEntries(manifest);
  const matches = new Map();
  for (const [sectionId, section] of Object.entries(budget.sections)) {
    const entries = dynamicEntries.filter((key) => {
      const source = manifest[key]?.src ?? '';
      return source === section.entry || source.endsWith(`/${section.entry}`);
    });
    if (entries.length !== 1) {
      throw new Error(
        `UI catalog budget section ${sectionId} must match exactly one dynamic manifest entry (${section.entry}).`
      );
    }
    matches.set(sectionId, entries[0]);
  }
  const unmatched = dynamicEntries.filter((key) => ![...matches.values()].includes(key));
  if (unmatched.length > 0) {
    throw new Error(`UI catalog dynamic chunks lack section budgets: ${unmatched.join(', ')}`);
  }
  return matches;
}

export async function measureUiCatalogAssets(manifest, budget, readAsset) {
  validateBundleBudget(budget);
  const entryKeys = Object.keys(manifest).filter(
    (key) => manifest[key]?.isEntry === true && isJavaScriptChunk(manifest[key])
  );
  if (entryKeys.length === 0) {
    throw new Error('UI catalog Vite manifest has no entry chunk. Run the Catalog build first.');
  }

  const initial = collectManifestAssets(manifest, entryKeys);
  const dynamicEntries = findDynamicEntries(manifest);
  const dynamic = collectManifestAssets(manifest, dynamicEntries, { includeDynamic: true });
  const total = collectManifestAssets(
    manifest,
    Object.keys(manifest).filter((key) => isJavaScriptChunk(manifest[key]))
  );
  const initialJavaScript = new Set(initial.javascript);
  const initialStylesheet = new Set(initial.stylesheet);
  const lazy = {
    javascript: difference(dynamic.javascript, initialJavaScript).sort(),
    stylesheet: difference(dynamic.stylesheet, initialStylesheet).sort(),
  };
  for (const kind of assetKinds) {
    const accounted = new Set([...initial[kind], ...lazy[kind]]);
    const unaccounted = difference(total[kind], accounted);
    if (unaccounted.length > 0) {
      throw new Error(
        `UI catalog ${kind} chunks are outside the initial/lazy graph: ${unaccounted.join(', ')}`
      );
    }
  }

  const readFiles = async (names) =>
    Promise.all(names.map(async (name) => ({ name, contents: await readAsset(name) })));
  const measureGroup = async (groupName, graph) => ({
    javascript: summarizeBundleGroup(
      `${groupName} JavaScript`,
      await readFiles(graph.javascript),
      budget.groups[groupName].javascript
    ),
    stylesheet: summarizeBundleGroup(
      `${groupName} stylesheet`,
      await readFiles(graph.stylesheet),
      budget.groups[groupName].stylesheet,
      { allowEmpty: groupName === 'lazy' }
    ),
  });

  const groups = {
    initial: await measureGroup('initial', initial),
    lazy: await measureGroup('lazy', lazy),
    total: await measureGroup('total', total),
  };
  const sectionMatches = matchSectionEntries(manifest, budget);
  const sections = {};
  for (const [sectionId, entry] of sectionMatches) {
    const graph = collectManifestAssets(manifest, [entry], {
      includeDynamic: true,
      stopAtFiles: initialJavaScript,
    });
    sections[sectionId] = summarizeBundleGroup(
      `Section ${sectionId} JavaScript`,
      await readFiles(difference(graph.javascript, initialJavaScript).sort()),
      budget.sections[sectionId].javascript
    );
  }

  return { groups, sections };
}

async function readAsset(name) {
  return readFile(resolveCatalogAssetPath(name));
}

export async function checkUiCatalogBudget() {
  const budget = validateBundleBudget(JSON.parse(await readFile(budgetPath, 'utf8')));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { groups, sections } = await measureUiCatalogAssets(manifest, budget, readAsset);
  const summary = [
    ...Object.values(groups).flatMap((group) => Object.values(group)),
    ...Object.values(sections),
  ];
  const report = renderBundleSummary(summary);
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  const failures = summary.filter((group) => !group.passed).map((group) => group.name);
  if (failures.length > 0) {
    throw new Error(
      `UI catalog assets exceed their reviewed raw or gzip bundle budget: ${failures.join(', ')}`
    );
  }
  return { groups, sections };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkUiCatalogBudget();
}
