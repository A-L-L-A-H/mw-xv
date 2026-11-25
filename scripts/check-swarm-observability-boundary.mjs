#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.next-e2e',
  '.next-visual',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '__fixtures__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'dist-board',
  'e2e',
  'fixture',
  'fixtures',
  'node_modules',
  'out',
  'playwright-report',
  'test',
  'test-results',
  'tests',
  'vendor',
]);
const HTTP_METHODS = new Set([
  'all',
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
]);
const REQUIRED_ROUTES = Object.freeze([
  ['post', '/v1/traces'],
  ['post', '/v1/metrics'],
  ['post', '/v1/logs'],
  ['post', '/v1/qoder'],
  ['get', '/api/observability/summary'],
  ['get', '/api/observability/traces'],
  ['get', '/api/observability/traces/:traceId'],
  ['get', '/api/observability/logs'],
  ['get', '/api/observability/metrics'],
  ['get', '/api/observability/config'],
]);
const OBSERVABILITY_PLUGIN = 'packages/orm-observability/src/http-plugin.ts';
const OBSERVABILITY_MANIFEST = 'packages/orm-observability/src/manifest.ts';
const API_REGISTRY = 'apps/api/src/addons/registry.ts';
const INSTRUMENTATION_PACKAGE = 'apps/agent-observability/package.json';
const PRODUCTION_COMPOSE = 'deploy/compose/docker-compose.production.yml';
const CHECK_IDS = Object.freeze([
  'scan-integrity',
  'observability-domain-ownership',
  'observability-route-ownership',
  'addon-registration',
  'instrumentation-only-boundary',
  'shared-db-lifecycle',
  'production-credential-scope',
]);
const FORBIDDEN_INSTRUMENTATION_DEPENDENCIES = new Set([
  '@fastify/static',
  '@moonwitness/jobs',
  'better-sqlite3',
  'bullmq',
  'fastify',
  'knex',
  'pg-boss',
]);
const FORBIDDEN_INSTRUMENTATION_IMPORTS = new Set([
  '@fastify/static',
  '@moonwitness/jobs',
  'better-sqlite3',
  'bullmq',
  'fastify',
  'knex',
  'node:http',
  'node:https',
  'pg-boss',
]);
const FORBIDDEN_INSTRUMENTATION_FILES = new Set([
  'app.ts',
  'cli.ts',
  'receiver.ts',
  'server.ts',
  'telemetry-server.ts',
]);

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function addViolation(violations, code, file, line, message) {
  violations.push({ code, file, line: line ?? null, message });
}

function normalizeViolations(violations) {
  const unique = new Map();
  for (const violation of violations) {
    const normalized = {
      code: violation.code,
      file: violation.file ?? null,
      line: violation.line ?? null,
      message: violation.message,
    };
    unique.set(JSON.stringify(normalized), normalized);
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.file ?? '', right.file ?? '') ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message)
  );
}

function makeReport(rootDir, checks) {
  const violations = normalizeViolations(checks.flatMap((check) => check.violations));
  const checkedFiles = [...new Set(checks.flatMap((check) => check.checkedFiles))].sort(
    compareText
  );
  return {
    schemaVersion: 1,
    gate: 'swarm-observability-boundary',
    rootDir: path.resolve(rootDir),
    ok: violations.length === 0,
    checkedFiles,
    checks: checks.map((check) => ({
      id: check.id,
      checkedFiles: [...check.checkedFiles].sort(compareText),
      skipped: [...check.skipped].sort(compareText),
      violations: normalizeViolations(check.violations),
    })),
    violationCount: violations.length,
    violations,
  };
}

function isIgnoredName(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.next');
}

function isExcludedTestFile(name) {
  return /\.(?:test|spec)\.[^.]+$/u.test(name);
}

async function walkSourceTree(rootDir, relativeRoot, files, errors) {
  const absoluteRoot = path.join(rootDir, ...relativeRoot.split('/'));
  let rootStat;
  try {
    rootStat = await fs.lstat(absoluteRoot);
  } catch (error) {
    addViolation(
      errors,
      error.code === 'ENOENT' ? 'MISSING_SOURCE_ROOT' : 'SOURCE_ROOT_READ_ERROR',
      relativeRoot,
      null,
      error.code === 'ENOENT'
        ? `Required first-party source root is missing: ${relativeRoot}.`
        : `Cannot inspect source root ${relativeRoot}: ${error.message}`
    );
    return;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    addViolation(
      errors,
      'INVALID_SOURCE_ROOT',
      relativeRoot,
      null,
      `First-party source root must be a real directory, not a symlink or file: ${relativeRoot}.`
    );
    return;
  }

  async function visit(absoluteDirectory, relativeDirectory) {
    let entries;
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      addViolation(
        errors,
        'SOURCE_DIRECTORY_READ_ERROR',
        relativeDirectory,
        null,
        `Cannot list source directory ${relativeDirectory}: ${error.message}`
      );
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && isIgnoredName(entry.name)) continue;
      const relativeFile = `${relativeDirectory}/${entry.name}`;
      const absoluteFile = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        addViolation(
          errors,
          'UNSCANNED_SOURCE_SYMLINK',
          relativeFile,
          null,
          `Source symlinks are not followed; inspect the target explicitly: ${relativeFile}.`
        );
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absoluteFile, relativeFile);
        continue;
      }
      if (!entry.isFile() || isExcludedTestFile(entry.name)) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(toPosix(relativeFile));
    }
  }

  await visit(absoluteRoot, relativeRoot);
}

function parseSource(file, source, errors) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const diagnostic of parsed.parseDiagnostics ?? []) {
    const { line } = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    addViolation(
      errors,
      'SOURCE_PARSE_ERROR',
      file,
      line + 1,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    );
  }
  return parsed;
}

function reportNode(violations, code, file, parsed, node, message) {
  const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
  addViolation(violations, code, file, line + 1, message);
}

function stringValue(node) {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function objectProperty(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  return object.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === name
  );
}

function httpRoute(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  if (!method || !HTTP_METHODS.has(method.toLowerCase())) return undefined;
  const route = node.arguments[0] ? stringValue(node.arguments[0]) : undefined;
  return route ? { method: method.toLowerCase(), route } : undefined;
}

function checkDomainOwnership(file, parsed, violations) {
  const allowed = file.startsWith('packages/orm-observability/src/');
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'defineModel') {
        const model = node.arguments[0] ? stringValue(node.arguments[0]) : undefined;
        if (model?.startsWith('observability.') && !allowed) {
          reportNode(
            violations,
            'SECOND_OBSERVABILITY_MODEL_AUTHORITY',
            file,
            parsed,
            node,
            `Observability model ${JSON.stringify(model)} must be defined only under packages/orm-observability/src.`
          );
        }
      }
      if (node.expression.text === 'defineAddon' && node.arguments[0]) {
        const name = objectProperty(node.arguments[0], 'name');
        const initializer =
          name && ts.isPropertyAssignment(name) ? stringValue(name.initializer) : undefined;
        if (initializer === 'observability' && !allowed) {
          reportNode(
            violations,
            'SECOND_OBSERVABILITY_ADDON_AUTHORITY',
            file,
            parsed,
            node,
            'The observability addon must be defined only under packages/orm-observability/src.'
          );
        }
      }
    }
    if (ts.isClassDeclaration(node) && /TelemetryStore$/u.test(node.name?.text ?? '') && !allowed) {
      reportNode(
        violations,
        'SECOND_OBSERVABILITY_STORE_AUTHORITY',
        file,
        parsed,
        node,
        'Telemetry store implementations must be defined only under packages/orm-observability/src.'
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

function isObservabilityRoute(route) {
  return (
    /^\/v1\/(?:traces|metrics|logs|qoder)(?:\/|$)/u.test(route) ||
    route.startsWith('/api/observability/')
  );
}

function checkRouteOwnership(file, parsed, violations, routes) {
  if (
    file.startsWith('apps/api/src/routes/') &&
    /(?:^|[-_.])(?:observability|telemetry)(?:[-_.]|$)/iu.test(path.posix.basename(file))
  ) {
    addViolation(
      violations,
      'OBSERVABILITY_API_ROUTE_FILE',
      file,
      1,
      'Observability routes must be registered by packages/orm-observability/src/http-plugin.ts through manifest.httpPlugins.'
    );
  }
  function visit(node) {
    const route = httpRoute(node);
    if (route && isObservabilityRoute(route.route)) {
      routes.push(route);
      if (file !== OBSERVABILITY_PLUGIN) {
        reportNode(
          violations,
          'OBSERVABILITY_ROUTE_OUTSIDE_ADDON',
          file,
          parsed,
          node,
          `${route.method.toUpperCase()} ${route.route} must be registered only by ${OBSERVABILITY_PLUGIN}.`
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

function checkAddonRegistration(file, parsed, violations) {
  if (file === OBSERVABILITY_MANIFEST) {
    let found = false;
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineAddon'
      ) {
        const plugins = node.arguments[0] && objectProperty(node.arguments[0], 'httpPlugins');
        const initializer =
          plugins && ts.isPropertyAssignment(plugins) ? plugins.initializer : undefined;
        if (initializer && ts.isArrayLiteralExpression(initializer)) {
          found = initializer.elements.some(
            (element) => ts.isIdentifier(element) && element.text === 'observabilityHttpPlugin'
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    if (!found) {
      addViolation(
        violations,
        'MISSING_OBSERVABILITY_HTTP_PLUGIN',
        file,
        1,
        'observabilityAddon must expose observabilityHttpPlugin through manifest.httpPlugins.'
      );
    }
  }

  if (file === API_REGISTRY) {
    let registered = false;
    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'API_ADDONS' &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        registered = node.initializer.elements.some((element) => {
          if (!ts.isObjectLiteralExpression(element)) return false;
          const name = objectProperty(element, 'name');
          const manifest = objectProperty(element, 'manifest');
          const manifestName =
            manifest && ts.isShorthandPropertyAssignment(manifest)
              ? manifest.name.text
              : manifest &&
                  ts.isPropertyAssignment(manifest) &&
                  ts.isIdentifier(manifest.initializer)
                ? manifest.initializer.text
                : undefined;
          return (
            name &&
            ts.isPropertyAssignment(name) &&
            stringValue(name.initializer) === 'observability' &&
            manifestName === 'observabilityAddon'
          );
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    if (!registered) {
      addViolation(
        violations,
        'MISSING_API_OBSERVABILITY_ADDON',
        file,
        1,
        'API_ADDONS must register the observability manifest from @moonwitness/orm-observability.'
      );
    }
  }
}

function checkInstrumentationPackage(file, parsed, violations) {
  if (!file.startsWith('apps/agent-observability/src/')) return;
  const basename = path.posix.basename(file);
  if (FORBIDDEN_INSTRUMENTATION_FILES.has(basename)) {
    addViolation(
      violations,
      'STANDALONE_OBSERVABILITY_SOURCE',
      file,
      1,
      `${basename} is a second receiver/server entrypoint; keep apps/agent-observability instrumentation-only.`
    );
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && stringValue(node.moduleSpecifier);
      if (specifier && FORBIDDEN_INSTRUMENTATION_IMPORTS.has(specifier)) {
        reportNode(
          violations,
          'INSTRUMENTATION_SERVER_IMPORT',
          file,
          parsed,
          node.moduleSpecifier,
          `Instrumentation must not import server/database/queue module ${JSON.stringify(specifier)}.`
        );
      }
      if (
        file === 'apps/agent-observability/src/index.ts' &&
        specifier &&
        /^\.\/(?:app|cli|receiver|server|telemetry-server)\.js$/u.test(specifier)
      ) {
        reportNode(
          violations,
          'INSTRUMENTATION_SERVER_EXPORT',
          file,
          parsed,
          node.moduleSpecifier,
          `Instrumentation package must not export second server entrypoint ${JSON.stringify(specifier)}.`
        );
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (method === 'listen' || (ts.isIdentifier(callee) && callee.text === 'createServer')) {
        reportNode(
          violations,
          'INSTRUMENTATION_LISTENER',
          file,
          parsed,
          node,
          'Instrumentation must not open an HTTP listener; the API addon owns ingress.'
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

function checkSharedDbLifecycle(file, parsed, violations) {
  if (file !== OBSERVABILITY_PLUGIN) return;
  let nonOwningStoreFound = false;
  function visit(node) {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'SqlTelemetryStore' &&
      node.arguments?.[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const closeDb = objectProperty(node.arguments[1], 'closeDb');
      if (
        closeDb &&
        ts.isPropertyAssignment(closeDb) &&
        closeDb.initializer.kind === ts.SyntaxKind.FalseKeyword
      ) {
        nonOwningStoreFound = true;
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'destroy' &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'db'
    ) {
      reportNode(
        violations,
        'ADDON_DESTROYS_SHARED_DB',
        file,
        parsed,
        node,
        'The observability addon must never destroy the API-owned Knex instance.'
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!nonOwningStoreFound) {
    addViolation(
      violations,
      'ADDON_OWNS_SHARED_DB_LIFECYCLE',
      file,
      1,
      'The HTTP plugin must construct SqlTelemetryStore with { closeDb: false }.'
    );
  }
}

function checkProductionCredentialScope(source, violations) {
  if (!source) return;
  let inServices = false;
  let service;
  let inEnvironment = false;
  let apiBindings = 0;
  const lines = source.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\s+#.*$/u, '').trimEnd();
    if (/^services:\s*$/u.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/u.test(line)) {
      inServices = false;
    }
    if (!inServices) continue;
    const serviceMatch = line.match(/^ {2}([a-z][\w-]*):\s*$/u);
    if (serviceMatch) {
      service = serviceMatch[1];
      inEnvironment = false;
      continue;
    }
    if (!service) continue;
    if (/^ {4}environment:\s*$/u.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (/^ {4}\S/u.test(line)) inEnvironment = false;
    if (!/^\s+OBSERVABILITY_INGEST_TOKEN:/u.test(line)) continue;
    if (service === 'api' && inEnvironment) {
      apiBindings += 1;
      if (!/^ {6}OBSERVABILITY_INGEST_TOKEN: \$\{OBSERVABILITY_INGEST_TOKEN:-\}\s*$/u.test(line)) {
        addViolation(
          violations,
          'INVALID_OBSERVABILITY_CREDENTIAL_BINDING',
          PRODUCTION_COMPOSE,
          index + 1,
          'The API must receive the optional ingest token through ${OBSERVABILITY_INGEST_TOKEN:-}.'
        );
      }
    } else {
      addViolation(
        violations,
        'OBSERVABILITY_CREDENTIAL_OUTSIDE_API',
        PRODUCTION_COMPOSE,
        index + 1,
        'The write-only ingest credential must not be passed to another service or shared anchor.'
      );
    }
  }
  if (apiBindings !== 1) {
    addViolation(
      violations,
      'MISSING_API_OBSERVABILITY_CREDENTIAL',
      PRODUCTION_COMPOSE,
      1,
      'Production Compose must bind OBSERVABILITY_INGEST_TOKEN exactly once in the api environment.'
    );
  }
}

async function readRequiredFile(rootDir, file, contents, errors) {
  const absoluteFile = path.join(rootDir, ...file.split('/'));
  try {
    const stat = await fs.lstat(absoluteFile);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('required path must be a regular file, not a symlink');
    contents.set(file, await fs.readFile(absoluteFile, 'utf8'));
  } catch (error) {
    addViolation(
      errors,
      error.code === 'ENOENT' ? 'MISSING_REQUIRED_FILE' : 'REQUIRED_FILE_READ_ERROR',
      file,
      null,
      error.code === 'ENOENT'
        ? `Required single-authority contract file is missing: ${file}.`
        : `Cannot read required contract file ${file}: ${error.message}`
    );
  }
}

async function readPackageJson(rootDir, errors) {
  const contents = new Map();
  await readRequiredFile(rootDir, INSTRUMENTATION_PACKAGE, contents, errors);
  const source = contents.get(INSTRUMENTATION_PACKAGE);
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch (error) {
    addViolation(
      errors,
      'INVALID_INSTRUMENTATION_PACKAGE',
      INSTRUMENTATION_PACKAGE,
      null,
      `Cannot parse instrumentation package.json: ${error.message}`
    );
    return undefined;
  }
}

function checkPackageManifest(packageJson, violations) {
  if (!packageJson || typeof packageJson !== 'object') return;
  for (const script of ['dev', 'start']) {
    if (packageJson.scripts && Object.hasOwn(packageJson.scripts, script)) {
      addViolation(
        violations,
        'STANDALONE_OBSERVABILITY_SCRIPT',
        INSTRUMENTATION_PACKAGE,
        null,
        `Instrumentation package must not expose a ${JSON.stringify(script)} server script.`
      );
    }
  }
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies).sort(compareText)) {
    if (FORBIDDEN_INSTRUMENTATION_DEPENDENCIES.has(dependency)) {
      addViolation(
        violations,
        'INSTRUMENTATION_SERVER_DEPENDENCY',
        INSTRUMENTATION_PACKAGE,
        null,
        `Instrumentation package must not depend on server/database/queue package ${JSON.stringify(dependency)}.`
      );
    }
  }
}

async function directoryContainsFile(rootDir, relativeDirectory) {
  const absoluteDirectory = path.join(rootDir, ...relativeDirectory.split('/'));
  try {
    const stat = await fs.lstat(absoluteDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) return true;
      if (
        entry.isDirectory() &&
        (await directoryContainsFile(rootDir, `${relativeDirectory}/${entry.name}`))
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function evaluateSwarmObservabilityBoundary({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const sourceFiles = [];
  const integrityErrors = [];
  for (const relativeRoot of ['apps', 'packages']) {
    await walkSourceTree(rootDir, relativeRoot, sourceFiles, integrityErrors);
  }
  sourceFiles.sort(compareText);

  const requiredFiles = [
    OBSERVABILITY_PLUGIN,
    OBSERVABILITY_MANIFEST,
    API_REGISTRY,
    PRODUCTION_COMPOSE,
  ];
  const requiredContents = new Map();
  for (const file of requiredFiles)
    await readRequiredFile(rootDir, file, requiredContents, integrityErrors);
  const packageJson = await readPackageJson(rootDir, integrityErrors);

  for (const directory of ['public', 'static', 'dashboard']) {
    if (await directoryContainsFile(rootDir, `apps/agent-observability/${directory}`)) {
      addViolation(
        integrityErrors,
        'STANDALONE_OBSERVABILITY_UI',
        `apps/agent-observability/${directory}`,
        null,
        'Instrumentation package must not contain a static operator dashboard.'
      );
    }
  }

  const contents = new Map();
  await Promise.all(
    sourceFiles.map(async (file) => {
      try {
        contents.set(file, await fs.readFile(path.join(rootDir, ...file.split('/')), 'utf8'));
      } catch (error) {
        addViolation(
          integrityErrors,
          'SOURCE_FILE_READ_ERROR',
          file,
          null,
          `Cannot read source file ${file}: ${error.message}`
        );
      }
    })
  );
  for (const [file, source] of requiredContents)
    if (!contents.has(file)) contents.set(file, source);

  const domainViolations = [];
  const routeViolations = [];
  const registrationViolations = [];
  const instrumentationViolations = [];
  const lifecycleViolations = [];
  const credentialViolations = [];
  const routeFiles = [];
  const registrationFiles = [];
  const instrumentationFiles = [];
  const pluginRoutes = [];

  for (const file of sourceFiles) {
    const source = contents.get(file);
    if (source === undefined) continue;
    const parsed = parseSource(file, source, integrityErrors);
    checkDomainOwnership(file, parsed, domainViolations);
    const previousRouteCount = pluginRoutes.length;
    checkRouteOwnership(file, parsed, routeViolations, pluginRoutes);
    if (pluginRoutes.length > previousRouteCount || file.startsWith('apps/api/src/routes/'))
      routeFiles.push(file);
    if (file === OBSERVABILITY_MANIFEST || file === API_REGISTRY) {
      registrationFiles.push(file);
      checkAddonRegistration(file, parsed, registrationViolations);
    }
    if (file.startsWith('apps/agent-observability/src/')) {
      instrumentationFiles.push(file);
      checkInstrumentationPackage(file, parsed, instrumentationViolations);
    }
    checkSharedDbLifecycle(file, parsed, lifecycleViolations);
  }

  for (const [method, route] of REQUIRED_ROUTES) {
    if (
      !pluginRoutes.some((candidate) => candidate.method === method && candidate.route === route)
    ) {
      addViolation(
        routeViolations,
        'MISSING_OBSERVABILITY_ROUTE',
        OBSERVABILITY_PLUGIN,
        1,
        `Required addon route is missing: ${method.toUpperCase()} ${route}.`
      );
    }
  }
  checkPackageManifest(packageJson, instrumentationViolations);
  checkProductionCredentialScope(requiredContents.get(PRODUCTION_COMPOSE), credentialViolations);

  const checks = [
    {
      id: CHECK_IDS[0],
      checkedFiles: [...sourceFiles, INSTRUMENTATION_PACKAGE, PRODUCTION_COMPOSE],
      skipped: [],
      violations: integrityErrors,
    },
    { id: CHECK_IDS[1], checkedFiles: sourceFiles, skipped: [], violations: domainViolations },
    { id: CHECK_IDS[2], checkedFiles: routeFiles, skipped: [], violations: routeViolations },
    {
      id: CHECK_IDS[3],
      checkedFiles: registrationFiles,
      skipped: [],
      violations: registrationViolations,
    },
    {
      id: CHECK_IDS[4],
      checkedFiles: instrumentationFiles,
      skipped: [],
      violations: instrumentationViolations,
    },
    {
      id: CHECK_IDS[5],
      checkedFiles: [OBSERVABILITY_PLUGIN],
      skipped: [],
      violations: lifecycleViolations,
    },
    {
      id: CHECK_IDS[6],
      checkedFiles: [PRODUCTION_COMPOSE],
      skipped: [],
      violations: credentialViolations,
    },
  ];
  return makeReport(rootDir, checks);
}

function invalidArgumentReport(rootDir, message) {
  const violation = { code: 'INVALID_ARGUMENTS', file: null, line: null, message };
  return {
    schemaVersion: 1,
    gate: 'swarm-observability-boundary',
    rootDir: path.resolve(rootDir),
    ok: false,
    checkedFiles: [],
    checks: [],
    violationCount: 1,
    violations: [violation],
  };
}

function executionErrorReport(rootDir, error) {
  const violation = {
    code: 'GATE_EXECUTION_ERROR',
    file: null,
    line: null,
    message: `Boundary gate could not complete: ${error instanceof Error ? error.message : String(error)}`,
  };
  return {
    schemaVersion: 1,
    gate: 'swarm-observability-boundary',
    rootDir: path.resolve(rootDir),
    ok: false,
    checkedFiles: [],
    checks: [],
    violationCount: 1,
    violations: [violation],
  };
}

function writeHumanReport(report, stdout, stderr) {
  if (report.ok) {
    stdout.write(
      `swarm-observability-boundary: PASS (${report.checks.length} checks, ${report.checkedFiles.length} files checked).\n`
    );
    return;
  }
  if (report.checks.length === 0) {
    stderr.write(
      `swarm-observability-boundary: FAIL\n${report.violations.map((item) => item.message).join('\n')}\n`
    );
    stderr.write(
      'Usage: node scripts/check-swarm-observability-boundary.mjs [--root <directory>] [--json]\n'
    );
    return;
  }
  stderr.write(
    `swarm-observability-boundary: FAIL (${report.violationCount} violations, ${report.checkedFiles.length} files checked).\n`
  );
  for (const violation of report.violations) {
    const location = violation.file
      ? `${violation.file}${violation.line ? `:${violation.line}` : ''}`
      : '<cli>';
    stderr.write(`  - [${violation.code}] ${location}: ${violation.message}\n`);
  }
  stderr.write('Use --json for the stable machine-readable report.\n');
}

export async function runSwarmObservabilityBoundaryCli(
  argv = [],
  { rootDir = DEFAULT_ROOT_DIR, stdout = process.stdout, stderr = process.stderr } = {}
) {
  let json = false;
  const jsonRequested = argv.includes('--json');
  function emitInvalidArgument(report) {
    if (jsonRequested) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else writeHumanReport(report, stdout, stderr);
    return 1;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        return emitInvalidArgument(
          invalidArgumentReport(rootDir, '--root requires a directory path.')
        );
      }
      rootDir = value;
      index += 1;
      continue;
    }
    return emitInvalidArgument(
      invalidArgumentReport(rootDir, `Unknown argument: ${JSON.stringify(argument)}.`)
    );
  }

  let report;
  try {
    report = await evaluateSwarmObservabilityBoundary({ rootDir });
  } catch (error) {
    report = executionErrorReport(rootDir, error);
  }
  if (json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else writeHumanReport(report, stdout, stderr);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runSwarmObservabilityBoundaryCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
