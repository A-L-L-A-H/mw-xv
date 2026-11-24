import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiPackage = '@moonwitness/ui';
const policyClasses = new Set([
  'product-adopter',
  'reference-consumer',
  'publication-shell',
  'standalone-exempt',
  'non-ui',
]);
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'dist-board',
  '.next',
  '.next-e2e',
  'generated',
  'coverage',
  'test-results',
  'playwright-report',
]);
const codeExtension = /(?:\.[cm]?[jt]sx?)$/u;
const styleExtension = /\.css$/u;
const replacements = {
  button: 'Button from @moonwitness/ui/components/button',
  input:
    'Input or Checkbox from @moonwitness/ui/components/input or @moonwitness/ui/components/checkbox',
  select: 'SelectField from @moonwitness/ui/components/select-field',
  textarea: 'Textarea from @moonwitness/ui/components/textarea',
};
const bannedIconImportPattern =
  /^(?:lucide-react|@heroicons\/react|react-icons|react-feather)(?:\/|$)/u;
const lexicalCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const normalizeFile = (file) => path.posix.normalize(file.replaceAll('\\', '/'));
const normalizeEvidence = (value) => value.replace(/\s+/g, ' ').trim();

export function uiFindingFingerprint(rule, file, evidence, occurrence = 0) {
  return createHash('sha256')
    .update(JSON.stringify([rule, normalizeFile(file), normalizeEvidence(evidence), occurrence]))
    .digest('hex');
}

function assertRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    path.isAbsolute(value) ||
    normalizeFile(value).split('/').includes('..')
  )
    throw new Error(`Invalid UI governance path for ${label}: ${String(value)}`);
}

export function validateUiGovernancePolicy(policy) {
  if (!policy || policy.version !== 1 || !policy.apps || typeof policy.apps !== 'object')
    throw new Error('Invalid UI governance policy: expected version 1 and an apps object.');
  for (const [app, config] of Object.entries(policy.apps)) {
    assertRelativePath(app, 'app');
    if (!config || !policyClasses.has(config.classification))
      throw new Error(`Invalid UI governance classification for ${app}.`);
    if (typeof config.packageName !== 'string' || !config.packageName)
      throw new Error(`Invalid UI governance packageName for ${app}.`);
    for (const key of [
      'sourceRoots',
      'publicRoots',
      'sharedSourceRoots',
      'generatedAssets',
      'routeRoots',
      'entryFiles',
    ]) {
      const values = config[key] ?? [];
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
        throw new Error(`Invalid UI governance ${key} for ${app}.`);
      for (const value of values) assertRelativePath(value, `${app}.${key}`);
    }
    if (
      config.aliases !== undefined &&
      (!config.aliases ||
        typeof config.aliases !== 'object' ||
        Array.isArray(config.aliases) ||
        Object.entries(config.aliases).some(
          ([prefix, target]) => !prefix || typeof target !== 'string'
        ))
    )
      throw new Error(`Invalid UI governance aliases for ${app}.`);
    for (const target of Object.values(config.aliases ?? {}))
      assertRelativePath(target, `${app}.aliases`);
    for (const entry of config.runtimeEvidence ?? []) {
      if (!entry || typeof entry.name !== 'string' || typeof entry.command !== 'string')
        throw new Error(`Invalid runtime evidence for ${app}.`);
      for (const file of entry.tests ?? [])
        assertRelativePath(file, `${app}.runtimeEvidence.tests`);
    }
  }
  for (const entry of policy.rules?.sharedChildClassOverrides?.reviewedDebt ?? []) {
    if (
      !entry ||
      typeof entry.file !== 'string' ||
      typeof entry.selector !== 'string' ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      !/^[a-f0-9]{64}$/.test(entry.fingerprint)
    )
      throw new Error('Invalid reviewed shared child-class debt entry.');
    assertRelativePath(entry.file, 'reviewedDebt.file');
  }
  return policy;
}

export async function loadUiGovernancePolicy(workspaceRoot) {
  const file = path.join(workspaceRoot, 'scripts/ui-governance-policy.json');
  return validateUiGovernancePolicy(JSON.parse(await readFile(file, 'utf8')));
}

async function optionalStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error(`Invalid package manifest: ${file}`);
  return manifest;
}

function hasUiDependency(manifest) {
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
    (section) => Object.hasOwn(manifest[section] ?? {}, uiPackage)
  );
}

export async function discoverWorkspaceApps(workspaceRoot, policy) {
  validateUiGovernancePolicy(policy);
  const appsDirectory = path.join(workspaceRoot, 'apps');
  const apps = [];
  const violations = [];
  if (!(await optionalStat(appsDirectory))) return { apps, violations };
  for (const entry of (await readdir(appsDirectory, { withFileTypes: true })).sort((a, b) =>
    lexicalCompare(a.name, b.name)
  )) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(appsDirectory, entry.name);
    const manifestFile = path.join(directory, 'package.json');
    if (!(await optionalStat(manifestFile))) continue;
    const app = `apps/${entry.name}`;
    const manifest = await readManifest(manifestFile);
    const config = policy.apps[app];
    if (!config) {
      violations.push({
        app,
        file: `${app}/package.json`,
        line: 1,
        rule: 'unclassified-workspace-app',
        message: 'Workspace app has no UI governance classification; add an explicit policy entry.',
        evidence: manifest.name ?? app,
      });
    } else if (config.packageName !== manifest.name) {
      violations.push({
        app,
        file: `${app}/package.json`,
        line: 1,
        rule: 'ui-policy-package-mismatch',
        message: `UI governance policy expects package ${config.packageName}.`,
        evidence: manifest.name ?? '',
      });
    } else if (config.classification === 'product-adopter' && !hasUiDependency(manifest)) {
      violations.push({
        app,
        file: `${app}/package.json`,
        line: 1,
        rule: 'missing-ui-dependency',
        message: 'Product adopter must declare @moonwitness/ui in a dependency section.',
        evidence: app,
      });
    }
    apps.push({ app, directory, manifest, config });
  }
  const discovered = new Set(apps.map(({ app }) => app));
  for (const app of Object.keys(policy.apps).sort(lexicalCompare)) {
    if (!discovered.has(app))
      violations.push({
        app,
        file: 'scripts/ui-governance-policy.json',
        line: 1,
        rule: 'stale-ui-policy-app',
        message: 'UI governance policy classifies an app that is not present in the workspace.',
        evidence: app,
      });
  }
  return { apps, violations };
}

function parseSource(file, source) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?jsx?$/u.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );
}

function moduleSpecifiers(ast) {
  const specifiers = [];
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return specifiers;
}

function inspectProductImports(node, report) {
  const inspect = (specifier) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    if (/^@moonwitness\/ui\/dist(?:\/|$)/u.test(specifier.text)) {
      report(
        specifier,
        'internal-ui-dist-import',
        'internal @moonwitness/ui dist import is not allowed',
        'use the public @moonwitness/ui subpath'
      );
    } else if (bannedIconImportPattern.test(specifier.text)) {
      report(
        specifier,
        'banned-icon-import',
        `direct icon library import '${specifier.text}' is not allowed`,
        'use canonical icons from @moonwitness/ui/icons/*'
      );
    }
  };
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspect(node.moduleSpecifier);
  else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
    inspect(node.moduleReference.expression);
  else if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  )
    inspect(node.arguments[0]);
}

export function findProductUiViolations(source, file = 'apps/board/src/fixture.tsx', options = {}) {
  const violations = [];
  const parsed = parseSource(normalizeFile(file), source);
  const command = options.command ?? 'pnpm board:ui:check';
  const report = (node, rule, message, detail) => {
    const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
    violations.push({
      app: options.app ?? 'apps/board',
      file: normalizeFile(file),
      line: line + 1,
      rule,
      message,
      evidence: detail,
      detail: `${detail}; then run ${command}`,
    });
  };
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      if (node.tagName.text in replacements) {
        report(
          node.tagName,
          'raw-native-control',
          `raw JSX <${node.tagName.text}> is not allowed`,
          `use ${replacements[node.tagName.text]}`
        );
      } else if (node.tagName.text === 'svg') {
        report(
          node.tagName,
          'raw-svg',
          'raw JSX <svg> is not allowed',
          'use @moonwitness/ui/icons, @moonwitness/ui/components/effects, or @moonwitness/assets'
        );
      }
    }
    inspectProductImports(node, report);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return violations;
}

export function findBoardUiViolations(source, file = 'apps/board/src/fixture.tsx') {
  return findProductUiViolations(source, file).map(
    ({ line, rule, message, detail }) =>
      `${normalizeFile(file)}:${line}: ${message.replace(' is not allowed', '')}${
        rule === 'raw-native-control' || rule === 'raw-svg' ? ' is not allowed' : ''
      } (${detail})`
  );
}

function globRegex(pattern) {
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        expression += '.*';
        i++;
      } else expression += '[^/]*';
    } else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${expression}$`, 'u');
}

function isGeneratedAsset(app, file, config) {
  const appRelative = file.slice(app.length + 1);
  return (config.generatedAssets ?? []).some((pattern) => globRegex(pattern).test(appRelative));
}

async function sourceFilesIn(directory, workspaceRoot) {
  const files = [];
  if (!(await optionalStat(directory))) return files;
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    lexicalCompare(a.name, b.name)
  )) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesIn(file, workspaceRoot)));
    else if (
      entry.isFile() &&
      (codeExtension.test(entry.name) || styleExtension.test(entry.name))
    ) {
      files.push({
        file: normalizeFile(path.relative(workspaceRoot, file)),
        source: await readFile(file, 'utf8'),
      });
    }
  }
  return files;
}

async function publicFilesIn(workspaceRoot, app, config) {
  const directory = path.join(workspaceRoot, app);
  const handAuthored = [];
  const generatedCopies = [];
  const otherAssets = [];
  const walk = async (current) => {
    if (!(await optionalStat(current))) return;
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      lexicalCompare(a.name, b.name)
    )) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) || entry.name === 'generated') await walk(file);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = normalizeFile(path.relative(workspaceRoot, file));
      if (isGeneratedAsset(app, relative, config)) {
        generatedCopies.push(relative);
      } else if (
        codeExtension.test(entry.name) ||
        styleExtension.test(entry.name) ||
        /\.html?$/u.test(entry.name)
      ) {
        handAuthored.push({ file: relative, source: await readFile(file, 'utf8') });
      } else {
        otherAssets.push(relative);
      }
    }
  };
  for (const publicRoot of config.publicRoots ?? []) await walk(path.join(directory, publicRoot));
  return {
    handAuthoredFiles: handAuthored.map(({ file }) => file),
    generatedCopies,
    otherAssets,
    files: handAuthored,
    note: 'Generated public asset copies are inventoried but excluded from styling-debt audits.',
  };
}

export async function collectAppUiSources(workspaceRoot, app, config) {
  const files = [];
  for (const sourceRoot of config.sourceRoots ?? [])
    files.push(...(await sourceFilesIn(path.join(workspaceRoot, app, sourceRoot), workspaceRoot)));
  const publicUi = await publicFilesIn(workspaceRoot, app, config);
  files.push(...publicUi.files);
  const publicUiSummary = { ...publicUi };
  delete publicUiSummary.files;
  const unique = new Map();
  for (const file of files) if (!unique.has(file.file)) unique.set(file.file, file);
  return { files: [...unique.values()], publicUi: publicUiSummary };
}

function componentSubpath(specifier) {
  if (!specifier.startsWith(`${uiPackage}/components/`)) return undefined;
  const subpath = `./${specifier.slice(uiPackage.length + 1)}`;
  return subpath.includes('*') ? undefined : subpath;
}

function componentExportName(subpath) {
  return subpath
    .split('/')
    .at(-1)
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function exportedComponentSubpaths(manifest) {
  return Object.keys(manifest.exports ?? {})
    .filter((key) => key.startsWith('./components/') && !key.includes('*'))
    .sort(lexicalCompare);
}

async function resolveLocalModule(workspaceRoot, file, specifier, config) {
  let base;
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(file), specifier);
  else {
    const alias = Object.entries(config.aliases ?? {})
      .sort(([left], [right]) => lexicalCompare(right, left))
      .find(([prefix]) => specifier === prefix || specifier.startsWith(`${prefix}/`));
    if (!alias) return undefined;
    base = path.resolve(
      workspaceRoot,
      alias[1],
      specifier.slice(alias[0].length).replace(/^\/+/u, '')
    );
  }
  const candidates = [
    base,
    ...['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.cts', '.css'].map((ext) => `${base}${ext}`),
  ];
  if (/\.jsx?$/u.test(base)) {
    const withoutExtension = base.replace(/\.jsx?$/u, '');
    candidates.push(`${withoutExtension}.tsx`, `${withoutExtension}.ts`);
  }
  if (/\.mjs$/u.test(base)) candidates.push(`${base.replace(/\.mjs$/u, '.mts')}`);
  for (const extension of ['index.tsx', 'index.ts', 'index.jsx', 'index.js', 'index.mjs'])
    candidates.push(path.join(base, extension));
  for (const candidate of candidates) {
    if (!candidate.startsWith(`${workspaceRoot}${path.sep}`)) continue;
    if ((await optionalStat(candidate))?.isFile()) return candidate;
  }
  return undefined;
}

async function existingCodeFile(file) {
  return (await optionalStat(file))?.isFile() && codeExtension.test(file) ? file : undefined;
}

function routePathsForFile(file, config) {
  for (const routeRoot of config.routeRoots ?? []) {
    const prefix = `${routeRoot.replace(/\/$/u, '')}/`;
    if (!file.startsWith(prefix)) continue;
    const routeFile = file.slice(prefix.length).replace(/(?:\.page)?\.[cm]?[jt]sx?$/u, '');
    const routeSegments = routeFile.split('/');
    if (
      /^(?:page|layout|loading|error|not-found|template|default|global-error)$/u.test(
        routeSegments.at(-1) ?? ''
      )
    )
      routeSegments.pop();
    const segments = routeSegments.flatMap((segment) => {
      if (!segment || segment.startsWith('_') || /^\([^)]*\)$/u.test(segment)) return [];
      if (segment === 'index') return [];
      if (/^\[\[\.\.\./.test(segment)) return [`*${segment.slice(4, -2)}`];
      if (/^\[\.\.\./.test(segment)) return [`*${segment.slice(4, -1)}`];
      if (/^\[[^\]]+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    });
    return [`/${segments.join('/')}`];
  }
  return [];
}

function routeDeclarations(ast, file) {
  const declarations = [];
  const add = (node, kind) => {
    if (!ts.isStringLiteralLike(node) || !node.text.startsWith('/')) return;
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    declarations.push({ file, line: line + 1, kind, path: node.text });
  };
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      (ts.isIdentifier(node.left) || ts.isIdentifier(node.right))
    ) {
      if (ts.isStringLiteralLike(node.right)) add(node.right, 'exact');
      else if (ts.isStringLiteralLike(node.left)) add(node.left, 'exact');
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'startsWith'
    )
      add(node.arguments[0], 'prefix');
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return declarations;
}

function isTypePosition(node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

function isReferenceIdentifier(node) {
  const parent = node.parent;
  if (!parent || ts.isTypeNode(parent)) return false;
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent)) return false;
  if (ts.isExportSpecifier(parent) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  if (
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent)
  )
    return false;
  return true;
}

function inspectAdoption(ast, file, availableComponents) {
  const productImports = new Set();
  const importedComponents = new Set();
  const importedNames = new Map();
  const bindings = [];
  const namespaceBindings = new Map();
  const componentByExport = new Map(
    availableComponents.map((subpath) => [componentExportName(subpath), subpath])
  );
  const addBinding = (binding) => {
    bindings.push(binding);
    if (binding.kind === 'namespace') namespaceBindings.set(binding.local, binding);
  };
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier !== uiPackage && !specifier.startsWith(`${uiPackage}/`)) continue;
    productImports.add(specifier);
    const subpath = componentSubpath(specifier);
    if (!subpath || !availableComponents.includes(subpath)) continue;
    importedComponents.add(subpath);
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) {
      addBinding({ local: clause.name.text, imported: 'default', subpath, kind: 'named' });
      if (!importedNames.has(subpath)) importedNames.set(subpath, new Set());
      importedNames.get(subpath).add('default');
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      addBinding({ local: named.name.text, imported: '*', subpath, kind: 'namespace' });
      if (!importedNames.has(subpath)) importedNames.set(subpath, new Set());
      importedNames.get(subpath).add('*');
    } else if (named)
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        addBinding({ local: element.name.text, imported, subpath, kind: 'named' });
        if (!importedNames.has(subpath)) importedNames.set(subpath, new Set());
        importedNames.get(subpath).add(imported);
      }
  }
  for (const specifier of moduleSpecifiers(ast))
    if (specifier === uiPackage || specifier.startsWith(`${uiPackage}/`))
      productImports.add(specifier);
  for (const specifier of productImports) {
    const subpath = componentSubpath(specifier);
    if (subpath && availableComponents.includes(subpath)) importedComponents.add(subpath);
  }
  const usages = new Map();
  const markUsage = (binding, imported, jsx) => {
    const key = binding.subpath;
    if (!usages.has(key)) usages.set(key, { named: new Set(), jsx: new Set(), files: new Set() });
    const usage = usages.get(key);
    usage.named.add(imported);
    if (jsx) usage.jsx.add(imported);
    usage.files.add(file);
  };
  const localBindings = new Map(bindings.map((binding) => [binding.local, binding]));
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      localBindings.has(node.tagName.text)
    ) {
      const binding = localBindings.get(node.tagName.text);
      markUsage(binding, binding.imported, true);
    } else if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isPropertyAccessExpression(node.tagName) &&
      ts.isIdentifier(node.tagName.expression) &&
      namespaceBindings.has(node.tagName.expression.text)
    ) {
      const binding = namespaceBindings.get(node.tagName.expression.text);
      const subpath = componentByExport.get(node.tagName.name.text);
      if (subpath) {
        importedComponents.add(subpath);
        markUsage({ ...binding, subpath }, node.tagName.name.text, true);
      }
    }
    if (
      ts.isIdentifier(node) &&
      localBindings.has(node.text) &&
      !isTypePosition(node) &&
      isReferenceIdentifier(node)
    ) {
      const binding = localBindings.get(node.text);
      markUsage(binding, binding.imported, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const namedComponents = [...usages.keys()].sort(lexicalCompare);
  return {
    productImports: [...productImports].sort(lexicalCompare),
    importedComponents: [...importedComponents].sort(lexicalCompare),
    importedNames: [...importedNames].map(([subpath, names]) => [
      subpath,
      [...names].sort(lexicalCompare),
    ]),
    namedComponents,
    jsxComponents: namedComponents.filter((subpath) => usages.get(subpath).jsx.size),
    usages: [...usages].map(([subpath, usage]) => [
      subpath,
      {
        named: [...usage.named].sort(lexicalCompare),
        jsx: [...usage.jsx].sort(lexicalCompare),
        files: [...usage.files].sort(lexicalCompare),
      },
    ]),
  };
}

async function runtimeEvidence(workspaceRoot, config) {
  const evidence = [];
  for (const entry of config.runtimeEvidence ?? []) {
    const tests = [];
    for (const file of entry.tests ?? [])
      tests.push({ file, present: Boolean(await optionalStat(path.join(workspaceRoot, file))) });
    evidence.push({
      name: entry.name,
      kind: entry.kind ?? 'test',
      command: entry.command,
      enforcement: entry.enforcement ?? 'separate-ci-lane',
      tests,
      present: tests.every(({ present }) => present),
      executed: false,
    });
  }
  return evidence;
}

export async function analyzeAppAdoption(workspaceRoot, app, config, uiManifest) {
  const { files: initialFiles, publicUi } = await collectAppUiSources(workspaceRoot, app, config);
  const filesByPath = new Map(initialFiles.map((file) => [file.file, file]));
  const parsedByPath = new Map();
  const parsed = (file) => {
    if (!parsedByPath.has(file)) {
      const source = filesByPath.get(file)?.source;
      parsedByPath.set(file, source === undefined ? undefined : parseSource(file, source));
    }
    return parsedByPath.get(file);
  };
  const routeRoots = (config.routeRoots ?? []).map((routeRoot) => path.posix.join(app, routeRoot));
  const routeEntries = [];
  for (const entry of config.entryFiles ?? []) {
    const relative = normalizeFile(path.join(app, entry));
    if (filesByPath.has(relative)) routeEntries.push(relative);
  }
  if (!(config.entryFiles ?? []).length) {
    for (const file of filesByPath.keys()) {
      if (
        routeRoots.some(
          (routeRoot) =>
            file.startsWith(`${routeRoot.replace(/\/$/u, '')}/`) &&
            /(?:^|\/)(?:page|layout|loading|error|not-found|template|default|global-error)\.[cm]?[jt]sx?$/u.test(
              file
            )
        )
      )
        routeEntries.push(file);
    }
  }
  const allowedRoots = [app, ...(config.sharedSourceRoots ?? [])].map((value) =>
    path.resolve(workspaceRoot, value)
  );
  const allowedFile = (file) =>
    allowedRoots.some((allowed) => file === allowed || file.startsWith(`${allowed}${path.sep}`));
  const reachableFiles = new Set();
  const pending = [...routeEntries].sort(lexicalCompare);
  while (pending.length) {
    const relative = pending.pop();
    if (reachableFiles.has(relative)) continue;
    reachableFiles.add(relative);
    const ast = parsed(relative);
    if (!ast) continue;
    const absolute = path.join(workspaceRoot, relative);
    for (const specifier of moduleSpecifiers(ast)) {
      const base = await resolveLocalModule(workspaceRoot, absolute, specifier, config);
      if (!base || !allowedFile(base)) continue;
      const resolved = await existingCodeFile(base);
      if (!resolved) continue;
      const resolvedRelative = normalizeFile(path.relative(workspaceRoot, resolved));
      if (!filesByPath.has(resolvedRelative))
        filesByPath.set(resolvedRelative, {
          file: resolvedRelative,
          source: await readFile(resolved, 'utf8'),
        });
      if (!reachableFiles.has(resolvedRelative)) pending.push(resolvedRelative);
    }
  }
  const availableComponents = exportedComponentSubpaths(uiManifest);
  const aggregate = {
    productImports: new Set(),
    importedComponents: new Set(),
    namedComponents: new Set(),
    jsxComponents: new Set(),
    reachableImportedComponents: new Set(),
    reachableNamedComponents: new Set(),
    reachableJsxComponents: new Set(),
  };
  const componentDetails = new Map();
  const violations = [];
  for (const { file, source } of [...filesByPath.values()].sort((a, b) =>
    lexicalCompare(a.file, b.file)
  )) {
    if (!codeExtension.test(file)) continue;
    const ast = parsed(file);
    const adoption = inspectAdoption(ast, file, availableComponents);
    for (const value of adoption.productImports) aggregate.productImports.add(value);
    for (const value of adoption.importedComponents) {
      aggregate.importedComponents.add(value);
      if (reachableFiles.has(file)) aggregate.reachableImportedComponents.add(value);
    }
    for (const value of adoption.namedComponents) {
      aggregate.namedComponents.add(value);
      if (reachableFiles.has(file)) aggregate.reachableNamedComponents.add(value);
    }
    for (const value of adoption.jsxComponents) {
      aggregate.jsxComponents.add(value);
      if (reachableFiles.has(file)) aggregate.reachableJsxComponents.add(value);
    }
    for (const subpath of adoption.importedComponents) {
      if (!componentDetails.has(subpath))
        componentDetails.set(subpath, {
          subpath,
          importedNames: new Set(),
          named: new Set(),
          jsx: new Set(),
          files: new Set(),
        });
    }
    for (const [subpath, names] of adoption.importedNames)
      for (const name of names) componentDetails.get(subpath).importedNames.add(name);
    for (const [subpath, usage] of adoption.usages) {
      const detail = componentDetails.get(subpath);
      for (const name of usage.named) detail.named.add(name);
      for (const name of usage.jsx) detail.jsx.add(name);
      for (const usageFile of usage.files) detail.files.add(usageFile);
    }
    if (config.classification === 'product-adopter')
      violations.push(
        ...findProductUiViolations(source, file, {
          app,
          command: app === 'apps/board' ? 'pnpm board:ui:check' : 'pnpm ui:governance:check',
        })
      );
  }
  if (!routeEntries.length && config.browser)
    violations.push({
      app,
      file: `${app}/package.json`,
      line: 1,
      rule: 'missing-route-entry',
      message: 'Browser app has no discoverable route or application entry.',
      evidence: app,
    });
  const routeDeclarationsFound = [];
  const routePaths = new Set();
  for (const entry of routeEntries) {
    for (const routePath of routePathsForFile(entry, { ...config, routeRoots }))
      routePaths.add(routePath);
    const ast = parsed(entry);
    if (!ast) continue;
    for (const declaration of routeDeclarations(ast, entry)) {
      routeDeclarationsFound.push(declaration);
      routePaths.add(declaration.path);
    }
  }
  const sorted = (set) => [...set].sort(lexicalCompare);
  return {
    app,
    packageName: config.packageName,
    classification: config.classification,
    browser: Boolean(config.browser),
    scannedFiles: [...filesByPath.keys()].sort(lexicalCompare),
    productImports: sorted(aggregate.productImports),
    importedComponents: sorted(aggregate.importedComponents),
    namedComponents: sorted(aggregate.namedComponents),
    jsxComponents: sorted(aggregate.jsxComponents),
    reachableImportedComponents: sorted(aggregate.reachableImportedComponents),
    reachableNamedComponents: sorted(aggregate.reachableNamedComponents),
    reachableJsxComponents: sorted(aggregate.reachableJsxComponents),
    importedWithoutNamedUsage: sorted(
      new Set(
        [...aggregate.importedComponents].filter(
          (subpath) => !aggregate.namedComponents.has(subpath)
        )
      )
    ),
    namedOutsideRoutes: sorted(
      new Set(
        [...aggregate.namedComponents].filter(
          (subpath) => !aggregate.reachableNamedComponents.has(subpath)
        )
      )
    ),
    unusedComponents: availableComponents.filter(
      (subpath) => !aggregate.importedComponents.has(subpath)
    ),
    componentUsage: [...componentDetails.values()]
      .map((detail) => ({
        subpath: detail.subpath,
        importedNames: [...detail.importedNames].sort(lexicalCompare),
        named: [...detail.named].sort(lexicalCompare),
        jsx: [...detail.jsx].sort(lexicalCompare),
        files: [...detail.files].sort(lexicalCompare),
      }))
      .sort((a, b) => lexicalCompare(a.subpath, b.subpath)),
    routeReachability: {
      method: 'static local import graph from route/application entries; not browser execution',
      entryFiles: [...routeEntries].sort(lexicalCompare),
      reachableFiles: [...reachableFiles].sort(lexicalCompare),
      paths: [...routePaths].sort(lexicalCompare),
      declarations: routeDeclarationsFound.sort(
        (a, b) =>
          lexicalCompare(a.file, b.file) || a.line - b.line || lexicalCompare(a.path, b.path)
      ),
    },
    runtimeEvidence: await runtimeEvidence(workspaceRoot, config),
    publicUi,
    violations,
  };
}

function aliasFindings(files, scope) {
  const findings = [];
  for (const { file, source } of files) {
    if (!codeExtension.test(file) && !styleExtension.test(file)) continue;
    for (const match of source.matchAll(/(?<![\w-])--ink(?:-[\w-]+)?/gu)) {
      const line = source.slice(0, match.index).match(/\n/g)?.length ?? 0;
      const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
      findings.push({
        scope,
        file: normalizeFile(file),
        line: line + 1,
        column: match.index - lineStart + 1,
        token: match[0],
        canonicalToken:
          match[0] === '--ink' ? '--mw-ink' : match[0].replace(/^--ink-/u, '--mw-ink-'),
        rule: 'noncanonical-ink-token',
        baselineEligible: false,
        message:
          scope === 'package-internal'
            ? 'Replace the package-internal --ink alias with its canonical --mw-* token.'
            : 'Consumer still defines or references a legacy --ink alias; review it with the package-internal canonicalization.',
      });
    }
  }
  return findings.sort(
    (a, b) => lexicalCompare(a.file, b.file) || a.line - b.line || a.column - b.column
  );
}

export async function auditWorkspacePolicy(workspaceRoot, options = {}) {
  const policy = options.policy ?? (await loadUiGovernancePolicy(workspaceRoot));
  validateUiGovernancePolicy(policy);
  const uiManifest =
    options.uiManifest ??
    (await readManifest(path.join(workspaceRoot, 'packages/ui/package.json')));
  const { apps, violations } = await discoverWorkspaceApps(workspaceRoot, policy);
  const adoption = [];
  const publicUi = {};
  for (const entry of apps) {
    if (
      !entry.config ||
      !['product-adopter', 'reference-consumer', 'publication-shell'].includes(
        entry.config.classification
      )
    )
      continue;
    const report = await analyzeAppAdoption(workspaceRoot, entry.app, entry.config, uiManifest);
    adoption.push(report);
    publicUi[entry.app] = report.publicUi;
    violations.push(...report.violations);
  }
  for (const entry of apps) {
    if (!entry.config || publicUi[entry.app]) continue;
    const inventory = await publicFilesIn(workspaceRoot, entry.app, entry.config);
    delete inventory.files;
    publicUi[entry.app] = inventory;
  }
  const packageFiles = await sourceFilesIn(
    path.join(workspaceRoot, 'packages/ui/src'),
    workspaceRoot
  );
  const consumerFiles = [];
  for (const report of adoption)
    for (const file of report.scannedFiles) {
      if (consumerFiles.some((entry) => entry.file === file)) continue;
      const source = await readFile(path.join(workspaceRoot, file), 'utf8');
      consumerFiles.push({ file, source });
    }
  const catalog = adoption.find((report) => report.classification === 'reference-consumer');
  const availableComponents = exportedComponentSubpaths(uiManifest);
  return {
    policy,
    apps: apps
      .map(({ app, manifest, config }) => ({
        app,
        packageName: manifest.name,
        classification: config?.classification ?? 'unclassified',
        scanned: Boolean(
          config &&
          ['product-adopter', 'reference-consumer', 'publication-shell'].includes(
            config.classification
          )
        ),
        uiDependencyDeclared: hasUiDependency(manifest),
      }))
      .sort((a, b) => lexicalCompare(a.app, b.app)),
    adoption: adoption.sort((a, b) => lexicalCompare(a.app, b.app)),
    catalogReferenceCoverage: {
      availableComponents,
      referencedComponents: catalog?.jsxComponents ?? [],
      importedWithoutJsxReference: (catalog?.importedComponents ?? []).filter(
        (subpath) => !(catalog?.jsxComponents ?? []).includes(subpath)
      ),
      missingComponents: availableComponents.filter(
        (subpath) => !(catalog?.jsxComponents ?? []).includes(subpath)
      ),
      protectedPublicApis: policy.knip?.protectedPublicApis ?? [],
      note: 'Reference coverage is reported independently; unused public APIs are preserved for Knip review.',
    },
    publicUi,
    independentChecks: policy.independentChecks ?? {},
    knip: policy.knip,
    aliasDebt: aliasFindings(packageFiles, 'package-internal'),
    consumerAliasDebt: aliasFindings(consumerFiles, 'consumer'),
    violations: violations.sort(
      (a, b) =>
        lexicalCompare(a.file, b.file) ||
        a.line - b.line ||
        lexicalCompare(a.rule, b.rule) ||
        lexicalCompare(normalizeEvidence(a.evidence), normalizeEvidence(b.evidence))
    ),
  };
}

function selectedApps(args, report) {
  const appArg = args.find((arg) => arg.startsWith('--app='));
  if (appArg) {
    const value = appArg.slice('--app='.length);
    const matches = report.apps.filter(
      ({ app, packageName }) => app === value || app === `apps/${value}` || packageName === value
    );
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous --app value: ${value}`);
    return new Set([matches[0].app]);
  }
  if (args.includes('--all-product-apps'))
    return new Set(
      report.apps
        .filter(({ classification }) => classification === 'product-adopter')
        .map(({ app }) => app)
    );
  return new Set(['apps/board']);
}

async function main(args) {
  const allowed = new Set(['--json', '--all-product-apps', '--list-apps', '--strict-alias-debt']);
  for (const arg of args) {
    if (!allowed.has(arg) && !arg.startsWith('--app='))
      throw new Error(
        `Unknown argument: ${arg}. Allowed: --json, --app=<app>, --all-product-apps, --list-apps, --strict-alias-debt.`
      );
  }
  const report = await auditWorkspacePolicy(root);
  if (args.includes('--list-apps')) {
    for (const app of report.apps)
      console.log(`${app.app} (${app.packageName}): ${app.classification}`);
    return;
  }
  const selected = selectedApps(args, report);
  const classificationViolations = report.violations.filter(
    ({ app }) => !app || !selected.has(app)
  );
  const selectedViolations = report.violations.filter(({ app }) => app && selected.has(app));
  const aliasFailures = args.includes('--strict-alias-debt') ? report.aliasDebt : [];
  const failures = [...classificationViolations, ...selectedViolations];
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          selectedApps: [...selected].sort(lexicalCompare),
          ...report,
          selectedViolations,
          classificationViolations,
          aliasFailures,
        },
        null,
        2
      )
    );
  } else {
    const names = [...selected].sort(lexicalCompare).join(', ');
    for (const app of report.adoption.filter((entry) => selected.has(entry.app))) {
      console.log(
        `${app.app} [${app.classification}]: ${app.productImports.length} UI module import(s), ${app.importedComponents.length} imported component(s), ${app.namedComponents.length} named usage(s), ${app.jsxComponents.length} JSX usage(s), ${app.reachableNamedComponents.length} route-reachable named usage(s).`
      );
      console.log(
        `  Routes: ${app.routeReachability.entryFiles.length} entr(ies), ${app.routeReachability.reachableFiles.length} reachable file(s). Runtime evidence is reported separately and is not executed by this static check.`
      );
    }
    for (const violation of failures)
      console.error(
        `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}${
          violation.detail
            ? ` (${violation.detail})`
            : violation.evidence
              ? ` (${violation.evidence})`
              : ''
        }`
      );
    if (report.aliasDebt.length) {
      console.error(
        `Package-internal --ink alias debt: ${report.aliasDebt.length} occurrence(s); canonicalization is report-only unless --strict-alias-debt is set.`
      );
      for (const finding of report.aliasDebt)
        console.error(
          `  ${finding.file}:${finding.line}:${finding.column} ${finding.token} -> ${finding.canonicalToken}`
        );
    }
    if (!failures.length && !aliasFailures.length) {
      if (selected.size === 1 && selected.has('apps/board'))
        console.log(
          'Board shared UI check passed: no native controls or internal UI package imports found.'
        );
      else console.log(`Shared UI policy check passed for ${names}.`);
    }
  }
  process.exitCode = failures.length || aliasFailures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Shared UI policy check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
