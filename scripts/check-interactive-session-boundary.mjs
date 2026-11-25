#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const PRODUCTION_COMPOSE_FILES = [
  { file: 'deploy/compose/docker-compose.production.yml', required: true },
  { file: 'deploy/compose/docker-compose.prd.yml', required: false },
];
const CHECK_IDS = Object.freeze([
  'scan-integrity',
  'addon-http-route-boundary',
  'opencode-import-boundary',
  'browser-native-import-boundary',
  'desktop-authority-boundary',
  'production-sandbox-boundary',
]);
const INTERACTIVE_ROUTE_FILE_PATTERN =
  /(?:^|[-_.])(?:interactive[-_.]?sessions?|coding[-_.]?sessions?|sessions?[-_.]?(?:interactive|coding))(?:[-_.]|$)/iu;
const INTERACTIVE_ROUTE_PATH_PATTERN = /(?:^|\/)(?:interactive|coding)-sessions?(?:\/|$)/iu;
const ROUTE_METHODS = new Set(['all', 'connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const OPENCODE_PACKAGE_PATTERN = /^(?:@opencode(?:\/|$)|@opencode-ai(?:\/|$)|opencode(?:\/|$)|opencode-ai(?:\/|$))/iu;
const VENDOR_OPENCODE_PATTERN = /(?:^|\/)vendor\/opencode(?:\/|$)/iu;
const AUTHORITY_NAME_PATTERN =
  /^(?:(?:interactive|coding)sessions?(?:runner|loop|store|registry|authority|repository|aggregate|model)?|sessions?(?:runner|loop|store|registry|authority|repository|aggregate)|models?(?:store|registry|authority|repository|aggregate))$/iu;
const AUTHORITY_FACTORY_PATTERN =
  /^(?:create|define|register|install)(?:(?:interactive|coding)?sessions?(?:runner|loop|store|registry|authority|repository|aggregate|model)?|models?(?:store|registry|authority|repository|aggregate))$/iu;
const SQL_CALL_NAMES = new Set(['exec', 'execute', 'query', 'raw', 'sql']);
const SQL_CREATE_TABLE_PATTERN =
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([A-Za-z_][A-Za-z0-9_.$]*)/iu;

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function addViolation(violations, code, file, line, message) {
  violations.push({ code, file, line, message });
}

function normalizeViolations(violations) {
  const unique = new Map();
  for (const violation of violations) {
    const normalized = {
      code: violation.code,
      file: violation.file,
      line: violation.line ?? null,
      message: violation.message,
    };
    unique.set(JSON.stringify(normalized), normalized);
  }
  return [...unique.values()].sort((left, right) =>
    compareText(left.file ?? '', right.file ?? '') ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
}

function isIgnoredName(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.next');
}

function isExcludedTestFile(name) {
  return /\.(?:test|spec)\.[^.]+$/iu.test(name);
}

async function walkSourceTree(rootDir, relativeRoot, files, errors) {
  const absoluteRoot = path.join(rootDir, ...relativeRoot.split('/'));
  let rootStat;
  try {
    rootStat = await fs.lstat(absoluteRoot);
  } catch (error) {
    errors.push({
      code: error.code === 'ENOENT' ? 'MISSING_SOURCE_ROOT' : 'SOURCE_ROOT_READ_ERROR',
      file: relativeRoot,
      line: null,
      message:
        error.code === 'ENOENT'
          ? `Required first-party source root is missing: ${relativeRoot}.`
          : `Cannot inspect source root ${relativeRoot}: ${error.message}`,
    });
    return;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    errors.push({
      code: 'INVALID_SOURCE_ROOT',
      file: relativeRoot,
      line: null,
      message: `First-party source root must be a real directory, not a symlink or file: ${relativeRoot}.`,
    });
    return;
  }

  async function visit(absoluteDirectory, relativeDirectory) {
    let entries;
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      errors.push({
        code: 'SOURCE_DIRECTORY_READ_ERROR',
        file: relativeDirectory,
        line: null,
        message: `Cannot list source directory ${relativeDirectory}: ${error.message}`,
      });
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      if (entry.isDirectory() && isIgnoredName(entry.name)) continue;
      const relativeFile = `${relativeDirectory}/${entry.name}`;
      const absoluteFile = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push({
          code: 'UNSCANNED_SOURCE_SYMLINK',
          file: relativeFile,
          line: null,
          message: `Source symlinks are not followed; inspect the target explicitly: ${relativeFile}.`,
        });
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

function readQuotedString(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  let value = '';
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === quote) return { end: cursor + 1, value };
    if (character === '\\') {
      const escaped = source[cursor + 1];
      if (escaped === undefined) return { end: source.length, value };
      if (escaped === '\r' && source[cursor + 2] === '\n') {
        cursor += 3;
        continue;
      }
      if (escaped === 'x') {
        const digits = source.slice(cursor + 2, cursor + 4);
        if (/^[0-9a-f]{2}$/iu.test(digits)) {
          value += String.fromCharCode(Number.parseInt(digits, 16));
          cursor += 4;
          continue;
        }
      }
      if (escaped === 'u') {
        const braced = source[cursor + 2] === '{';
        const length = braced ? source.indexOf('}', cursor + 3) - cursor - 3 : 4;
        const digitsStart = cursor + (braced ? 3 : 2);
        if (length >= 0 && /^[0-9a-f]+$/iu.test(source.slice(digitsStart, digitsStart + length))) {
          try {
            value += String.fromCodePoint(Number.parseInt(source.slice(digitsStart, digitsStart + length), 16));
            cursor = digitsStart + length + (braced ? 1 : 0);
            continue;
          } catch {
            // Keep malformed Unicode escapes literal; they cannot name a valid package.
          }
        }
      }
      const escapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '0': '\0' };
      value += Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped;
      cursor += 2;
      continue;
    }
    value += character;
    cursor += 1;
  }
  return { end: source.length, value };
}

function skipQuotedString(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipTemplate(source, start) {
  let cursor = start + 1;
  let value = '';
  let dynamic = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '`') return { end: cursor + 1, value: dynamic ? null : value };
    if (character === '$' && source[cursor + 1] === '{') {
      dynamic = true;
      cursor = skipTemplateExpression(source, cursor + 2);
      continue;
    }
    if (!dynamic) value += character;
    cursor += 1;
  }
  return { end: source.length, value: dynamic ? null : value };
}

function skipTemplateExpression(source, start) {
  let cursor = start;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    const character = source[cursor];
    if (character === "'" || character === '"') {
      cursor = skipQuotedString(source, cursor);
      continue;
    }
    if (character === '`') {
      cursor = skipTemplate(source, cursor).end;
      continue;
    }
    if (character === '/' && source[cursor + 1] === '/') {
      const newline = source.indexOf('\n', cursor + 2);
      cursor = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (character === '/' && source[cursor + 1] === '*') {
      const close = source.indexOf('*/', cursor + 2);
      cursor = close === -1 ? source.length : close + 2;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    cursor += 1;
  }
  return cursor;
}

function readRegularExpression(source, start) {
  let cursor = start + 1;
  let inCharacterClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '\n' || character === '\r') return null;
    if (character === '[') inCharacterClass = true;
    if (character === ']') inCharacterClass = false;
    if (character === '/' && !inCharacterClass) {
      cursor += 1;
      while (cursor < source.length && /[A-Za-z]/u.test(source[cursor])) cursor += 1;
      return cursor;
    }
    cursor += 1;
  }
  return null;
}

function canStartRegularExpression(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.kind === 'punctuation' && /^[=([{,:;!?&|+\-*%^~<>]$/u.test(previous.value)) return true;
  return (
    previous.kind === 'identifier' &&
    /^(?:await|case|delete|do|else|in|instanceof|of|return|throw|typeof|void|yield)$/u.test(previous.value)
  );
}

function isIdentifierStart(character) {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character) {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

/** A small lexer is sufficient for structural checks and avoids matching comments or string contents. */
function lexJavaScript(source) {
  const tokens = [];
  let offset = 0;
  let advancedOffset = 0;
  let line = 1;
  let column = 1;

  function advance(end) {
    for (; advancedOffset < end; advancedOffset += 1) {
      if (source[advancedOffset] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  }

  function push(kind, value, startLine, startColumn) {
    tokens.push({ kind, value, line: startLine, column: startColumn });
  }

  while (offset < source.length) {
    const start = offset;
    const startLine = line;
    const startColumn = column;
    const character = source[offset];

    if (/\s/u.test(character)) {
      offset += 1;
      advance(offset);
      continue;
    }
    if (character === '/' && source[offset + 1] === '/') {
      const newline = source.indexOf('\n', offset + 2);
      offset = newline === -1 ? source.length : newline;
      advance(offset);
      continue;
    }
    if (character === '/' && source[offset + 1] === '*') {
      const close = source.indexOf('*/', offset + 2);
      offset = close === -1 ? source.length : close + 2;
      advance(offset);
      continue;
    }
    if (character === "'" || character === '"') {
      const quoted = readQuotedString(source, offset);
      offset = quoted.end;
      advance(offset);
      push('string', quoted.value, startLine, startColumn);
      continue;
    }
    if (character === '`') {
      const template = skipTemplate(source, offset);
      offset = template.end;
      advance(offset);
      push(template.value === null ? 'dynamic-template' : 'string', template.value, startLine, startColumn);
      continue;
    }
    if (isIdentifierStart(character)) {
      offset += 1;
      while (isIdentifierPart(source[offset])) offset += 1;
      const value = source.slice(start, offset);
      advance(offset);
      push('identifier', value, startLine, startColumn);
      continue;
    }
    if (/[0-9]/u.test(character)) {
      offset += 1;
      while (offset < source.length && /[A-Za-z0-9_.]/u.test(source[offset])) offset += 1;
      advance(offset);
      push('number', source.slice(start, offset), startLine, startColumn);
      continue;
    }
    if (character === '/' && canStartRegularExpression(tokens)) {
      const end = readRegularExpression(source, offset);
      if (end !== null) {
        offset = end;
        advance(offset);
        push('regex', source.slice(start, offset), startLine, startColumn);
        continue;
      }
    }
    offset += 1;
    advance(offset);
    push('punctuation', character, startLine, startColumn);
  }
  return tokens;
}

function isStringToken(token) {
  return token?.kind === 'string' && token.value !== null;
}

export function findModuleSpecifiers(source) {
  const tokens = lexJavaScript(source);
  const specifiers = [];
  function add(token) {
    if (isStringToken(token)) specifiers.push({ specifier: token.value, line: token.line, column: token.column });
  }
  function addReExportFrom(startIndex) {
    let braceDepth = 0;
    for (let cursor = startIndex + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (token.value === ';' || token.value === '=') return;
      if (cursor > startIndex + 1 && token.kind === 'identifier' && /^(?:import|export)$/u.test(token.value)) return;
      if (token.value === '{') braceDepth += 1;
      if (token.value === '}') {
        braceDepth -= 1;
        if (braceDepth === 0 && tokens[cursor + 1]?.value !== 'from') return;
      }
      if (token.kind === 'identifier' && token.value === 'from') {
        add(tokens[cursor + 1]);
        return;
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'identifier') continue;
    if (token.value === 'import') {
      add(tokens[index + 1]);
      if (tokens[index + 1]?.value === '(') add(tokens[index + 2]);
      else if (tokens[index + 1]?.value !== '.') addReExportFrom(index);
    }
    if (token.value === 'export') {
      const next = tokens[index + 1];
      if (next?.value === '{' || next?.value === '*' || (next?.value === 'type' && /^(?:\{|\*)$/u.test(tokens[index + 2]?.value ?? ''))) {
        addReExportFrom(index);
      }
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '(') add(tokens[index + 2]);
  }
  return specifiers;
}

function isOpenCodeSpecifier(specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  return OPENCODE_PACKAGE_PATTERN.test(normalized) || VENDOR_OPENCODE_PATTERN.test(normalized);
}

function isBrowserNativeSpecifier(specifier) {
  return (
    specifier === 'node-pty' ||
    specifier.startsWith('node-pty/') ||
    specifier === 'tauri' ||
    specifier.startsWith('tauri/') ||
    specifier.startsWith('@tauri-apps/') ||
    specifier === 'better-sqlite3' ||
    specifier.startsWith('better-sqlite3/') ||
    specifier.startsWith('node:')
  );
}

function checkInteractiveRoutes(file, source, violations) {
  const basename = path.posix.basename(file);
  if (INTERACTIVE_ROUTE_FILE_PATTERN.test(basename)) {
    addViolation(
      violations,
      'CUSTOM_INTERACTIVE_SESSION_API_ROUTE_FILE',
      file,
      null,
      `Interactive-session routes must be registered by the owning addon manifest.httpPlugins, not added as ${basename}.`
    );
  }
  const tokens = lexJavaScript(source);
  for (let index = 2; index < tokens.length; index += 1) {
    const method = tokens[index];
    const route = tokens[index + 2];
    if (
      method.kind === 'identifier' &&
      ROUTE_METHODS.has(method.value) &&
      tokens[index - 1]?.value === '.' &&
      tokens[index + 1]?.value === '(' &&
      isStringToken(route) &&
      route.value.startsWith('/') &&
      INTERACTIVE_ROUTE_PATH_PATTERN.test(route.value)
    ) {
      addViolation(
        violations,
        'CUSTOM_INTERACTIVE_SESSION_API_ROUTE',
        file,
        route.line,
        `Route ${JSON.stringify(route.value)} must live in the owning addon manifest.httpPlugins, not apps/api/src/routes.`
      );
    }
  }
}

function isAuthorityTableName(name) {
  const normalized = name.toLowerCase();
  if (/^(?:(?:desktop|local)_)?(?:(?:interactive|coding)_)?sessions?$/u.test(normalized)) return true;
  if (
    /^(?:(?:desktop|local)_)?(?:(?:interactive|coding)_)?session_(?:runner|loop|store|registry|authority|repository|aggregate|model|events?|checkpoints?|commands?)$/u.test(
      normalized
    )
  ) {
    return true;
  }
  return /^(?:(?:desktop|local)_)?models?(?:_(?:store|registry|authority|repository|aggregate))?$/u.test(normalized);
}

function checkDesktopAuthority(file, source, violations) {
  const tokens = lexJavaScript(source);
  const reported = new Set();
  const declarationKeywords = new Set(['class', 'interface', 'type', 'enum', 'function', 'const', 'let', 'var']);

  function report(kind, token, name) {
    const key = `${token.line}:${name}`;
    if (reported.has(key)) return;
    reported.add(key);
    addViolation(
      violations,
      kind,
      file,
      token.line,
      `Desktop must not define a second session/model authority (${name}); packages/orm-ai owns session models, events, and checkpoints.`
    );
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'identifier') continue;
    if (declarationKeywords.has(token.value)) {
      const nameIndex = token.value === 'function' && tokens[index + 1]?.value === '*' ? index + 2 : index + 1;
      const name = tokens[nameIndex];
      if (name?.kind === 'identifier' && (AUTHORITY_NAME_PATTERN.test(name.value) || AUTHORITY_FACTORY_PATTERN.test(name.value))) {
        report('DESKTOP_SECOND_AUTHORITY_DEFINITION', name, name.value);
      }
    }
    if (
      tokens[index + 1]?.value === '(' &&
      (nameIsAuthorityCall(token.value) || AUTHORITY_NAME_PATTERN.test(token.value))
    ) {
      report('DESKTOP_SECOND_AUTHORITY_FACTORY', token, token.value);
    }
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const value = tokens[index];
    if (!isStringToken(value)) continue;
    const previous = tokens[index - 1];
    const beforePrevious = tokens[index - 2];
    const isSqlExecution =
      previous?.value === '(' &&
      beforePrevious?.kind === 'identifier' &&
      SQL_CALL_NAMES.has(beforePrevious.value);
    const isTaggedSql = previous?.kind === 'identifier' && previous.value === 'sql';
    if (!isSqlExecution && !isTaggedSql) continue;
    const match = SQL_CREATE_TABLE_PATTERN.exec(value.value);
    if (match && isAuthorityTableName(match[1])) {
      addViolation(
        violations,
        'DESKTOP_SECOND_AUTHORITY_TABLE',
        file,
        value.line,
        `Desktop must not create session/model authority table ${match[1]}; packages/orm-ai owns the schema.`
      );
    }
  }
}

function nameIsAuthorityCall(name) {
  return name === 'defineModel' || name === 'defineAddon' || AUTHORITY_FACTORY_PATTERN.test(name);
}

function stripYamlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/u.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function indentation(line) {
  return line.match(/^ */u)?.[0].length ?? 0;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitFlowItems(value) {
  const items = [];
  let start = 0;
  let quote = null;
  let squareDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '[') squareDepth += 1;
    if (character === ']') squareDepth -= 1;
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth -= 1;
    if (character === ',' && squareDepth === 0 && braceDepth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items.filter((item) => item.trim() !== '');
}

function parseYamlKeyValue(raw) {
  let quote = null;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ':') {
      return { key: unquoteYamlScalar(raw.slice(0, index)), value: unquoteYamlScalar(raw.slice(index + 1)) };
    }
  }
  return null;
}

function splitShortVolume(raw) {
  const value = unquoteYamlScalar(raw);
  let quote = null;
  let interpolationDepth = 0;
  const separators = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '$' && value[index + 1] === '{') {
      interpolationDepth += 1;
      index += 1;
      continue;
    }
    if (character === '}' && interpolationDepth > 0) {
      interpolationDepth -= 1;
      continue;
    }
    if (character === ':' && interpolationDepth === 0) {
      if (index === 1 && /[A-Za-z]/u.test(value[0]) && /[\\/]/u.test(value[index + 1] ?? '')) continue;
      separators.push(index);
    }
  }
  if (separators.length === 0) return null;
  const first = separators[0];
  const second = separators[1] ?? -1;
  return {
    source: value.slice(0, first),
    target: value.slice(first + 1, second === -1 ? value.length : second),
    mode: second === -1 ? '' : value.slice(second + 1),
  };
}

function isHostBindSource(source) {
  return (
    source === '.' ||
    source === '..' ||
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('~/') ||
    source.startsWith('$') ||
    source.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/u.test(source)
  );
}

function composeLines(source) {
  return source.split(/\r?\n/u).map((raw, index) => ({ text: stripYamlComment(raw), line: index + 1 }));
}

function extractServices(lines) {
  const services = new Map();
  let inServices = false;
  let serviceIndent = null;
  let inlineServices = null;
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    const { text, line } = lines[index];
    if (!text.trim()) continue;
    const indent = indentation(text);
    if (!inServices) {
      const match = /^services\s*:\s*(.*)$/u.exec(text);
      if (indent === 0 && match) {
        inServices = true;
        if (match[1].trim() && match[1].trim() !== '{}') inlineServices = { line, value: match[1].trim() };
      }
      continue;
    }
    if (indent === 0) break;
    if (serviceIndent === null) serviceIndent = indent;
    if (indent !== serviceIndent) continue;
    const match = /^(['"]?)([A-Za-z0-9_.-]+)\1\s*:\s*(.*)$/u.exec(text.trim());
    if (match) starts.push({ name: match[2], index, line, headerTail: match[3].trim() });
  }

  for (let startIndex = 0; startIndex < starts.length; startIndex += 1) {
    const start = starts[startIndex];
    let end = starts[startIndex + 1]?.index ?? lines.length;
    for (let cursor = start.index + 1; cursor < end; cursor += 1) {
      if (lines[cursor].text.trim() && indentation(lines[cursor].text) <= serviceIndent) {
        end = cursor;
        break;
      }
    }
    services.set(start.name, {
      name: start.name,
      startLine: start.line,
      headerTail: start.headerTail,
      lines: lines.slice(start.index + 1, end).filter(({ text }) => text.trim()),
    });
  }
  return { services, inlineServices };
}

function servicePropertyIndent(block) {
  return block.lines.reduce((minimum, line) => Math.min(minimum, indentation(line.text)), Number.POSITIVE_INFINITY);
}

function volumeGroups(sectionLines) {
  const groups = [];
  let current = null;
  for (const line of sectionLines) {
    const match = /^\s*-\s*(.*)$/u.exec(line.text);
    if (match) {
      if (current) groups.push(current);
      current = { firstLine: line.line, lines: [line], raw: match[1].trim() };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) groups.push(current);
  return groups;
}

function longVolumeProperties(group) {
  const properties = new Map();
  for (const line of group.lines) {
    let raw = /^\s*-\s*(.*)$/u.exec(line.text)?.[1] ?? line.text.trim();
    if (raw.startsWith('{') && raw.endsWith('}')) {
      for (const item of splitFlowItems(raw.slice(1, -1))) {
        const property = parseYamlKeyValue(item);
        if (property) properties.set(property.key, { ...property, line: line.line });
      }
      continue;
    }
    const property = parseYamlKeyValue(raw);
    if (property) properties.set(property.key, { ...property, line: line.line });
  }
  return properties;
}

function containsUnexpandedAlias(text) {
  return /(?:^\s*<<\s*:\s*|:\s*)\*[A-Za-z_][A-Za-z0-9_.-]*/u.test(text) || /^\s*-\s*\*/u.test(text);
}

function checkProductionCompose(file, source, violations, skipped) {
  const lines = composeLines(source);
  const { services, inlineServices } = extractServices(lines);
  if (inlineServices) {
    addViolation(
      violations,
      'UNSUPPORTED_PRODUCTION_COMPOSE',
      file,
      inlineServices.line,
      'Inline services mappings are not auditable by this builtins-only gate; use block YAML for the production Compose file.'
    );
  }
  const block = services.get('agent-sandbox');
  if (!block) {
    skipped.push(`${file}: agent-sandbox service is absent; sandbox mount rules have no candidates.`);
    return;
  }
  if (block.headerTail && !block.headerTail.startsWith('&')) {
    addViolation(
      violations,
      'UNSUPPORTED_PRODUCTION_COMPOSE',
      file,
      block.startLine,
      'The production agent-sandbox service must use a block mapping so mounts can be audited.'
    );
  }

  for (const line of block.lines) {
    if (containsUnexpandedAlias(line.text)) {
      addViolation(
        violations,
        'UNRESOLVED_COMPOSE_ALIAS',
        file,
        line.line,
        'Compose aliases are not expanded; inherited agent-sandbox mounts must be written explicitly for this gate.'
      );
    }
    if (/^\s*extends\s*:/u.test(line.text)) {
      addViolation(
        violations,
        'UNSUPPORTED_COMPOSE_EXTENDS',
        file,
        line.line,
        'Compose extends can inherit host mounts; write the production agent-sandbox service explicitly.'
      );
    }
    if (/\bdocker\.sock\b/iu.test(line.text)) {
      addViolation(
        violations,
        'PRODUCTION_SANDBOX_DOCKER_SOCKET',
        file,
        line.line,
        'Canonical production agent-sandbox must not mount or address a Docker socket.'
      );
    }
  }

  const propertyIndent = servicePropertyIndent(block);
  if (!Number.isFinite(propertyIndent)) return;
  for (let index = 0; index < block.lines.length; index += 1) {
    const line = block.lines[index];
    const match = /^(\s*)volumes\s*:\s*(.*)$/u.exec(line.text);
    if (!match || match[1].length !== propertyIndent) continue;
    const tail = match[2].trim();
    let items = [];

    if (tail.startsWith('[') && tail.endsWith(']')) {
      items = splitFlowItems(tail.slice(1, -1)).map((raw) => ({ raw, firstLine: line.line, lines: [line] }));
    } else if (tail === '') {
      const section = [];
      for (let cursor = index + 1; cursor < block.lines.length; cursor += 1) {
        const candidate = block.lines[cursor];
        if (indentation(candidate.text) <= propertyIndent) break;
        section.push(candidate);
      }
      items = volumeGroups(section);
    } else if (containsUnexpandedAlias(tail)) {
      continue;
    } else {
      addViolation(
        violations,
        'UNSUPPORTED_PRODUCTION_COMPOSE',
        file,
        line.line,
        'agent-sandbox volumes must be an explicit block or flow sequence.'
      );
      continue;
    }

    for (const item of items) {
      const firstProperty = parseYamlKeyValue(item.raw);
      const isLongSyntax =
        item.raw.startsWith('{') ||
        /^(?:bind|consistency|propagation|read_only|source|target|tmpfs|type|volume)\s*:/u.test(item.raw);
      if (firstProperty && isLongSyntax) {
        const properties = longVolumeProperties(item);
        const type = properties.get('type')?.value;
        const source = properties.get('source')?.value;
        const target = properties.get('target')?.value;
        if (type === 'bind') {
          addViolation(
            violations,
            'PRODUCTION_SANDBOX_HOST_BIND',
            file,
            item.firstLine,
            `Canonical production agent-sandbox must not use a host bind mount${target ? ` at ${JSON.stringify(target)}` : ''}; use a named volume and snapshot API.`
          );
        } else if (type !== 'volume' && type !== 'tmpfs' && type !== 'image') {
          addViolation(
            violations,
            'UNSUPPORTED_PRODUCTION_SANDBOX_VOLUME',
            file,
            item.firstLine,
            'Every long-form agent-sandbox mount must declare an auditable type of bind, volume, tmpfs, or image.'
          );
        } else if (source && isHostBindSource(source) && type !== 'bind') {
          addViolation(
            violations,
            'PRODUCTION_SANDBOX_HOST_BIND',
            file,
            item.firstLine,
            `Mount source ${JSON.stringify(source)} is host-shaped but the mount is not declared as bind; write an explicit named volume.`
          );
        }
        continue;
      }

      const volume = splitShortVolume(item.raw);
      if (volume && isHostBindSource(volume.source)) {
        addViolation(
          violations,
          'PRODUCTION_SANDBOX_HOST_BIND',
          file,
          item.firstLine,
          `Canonical production agent-sandbox must not bind host source ${JSON.stringify(volume.source)}; use a named volume and snapshot API.`
        );
      }
    }
  }
}

async function readSourceFiles(rootDir, files, errors) {
  const contents = new Map();
  for (const file of [...files].sort(compareText)) {
    try {
      contents.set(file, await fs.readFile(path.join(rootDir, ...file.split('/')), 'utf8'));
    } catch (error) {
      errors.push({
        code: 'SOURCE_FILE_READ_ERROR',
        file,
        line: null,
        message: `Cannot read source file ${file}: ${error.message}`,
      });
    }
  }
  return contents;
}

function makeReport(rootDir, checks) {
  const normalizedChecks = checks.map((check) => ({
    id: check.id,
    ok: check.violations.length === 0,
    checkedFiles: sortedUnique(check.checkedFiles),
    skipped: sortedUnique(check.skipped),
    violations: normalizeViolations(check.violations),
  }));
  const checkedFiles = sortedUnique(normalizedChecks.flatMap((check) => check.checkedFiles));
  const violations = normalizeViolations(normalizedChecks.flatMap((check) => check.violations));
  return {
    schemaVersion: 1,
    gate: 'interactive-session-boundary',
    rootDir,
    ok: normalizedChecks.every((check) => check.ok),
    checkedFiles,
    checks: normalizedChecks,
    violationCount: violations.length,
    violations,
  };
}

export async function evaluateInteractiveSessionBoundary(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT_DIR);
  const integrityErrors = [];
  const sourceFiles = [];
  for (const relativeRoot of ['apps', 'packages']) {
    await walkSourceTree(rootDir, relativeRoot, sourceFiles, integrityErrors);
  }
  sourceFiles.sort(compareText);
  const contents = await readSourceFiles(rootDir, sourceFiles, integrityErrors);
  const composeContents = new Map();
  const composeSkipped = [];

  for (const { file, required } of PRODUCTION_COMPOSE_FILES) {
    try {
      composeContents.set(file, await fs.readFile(path.join(rootDir, ...file.split('/')), 'utf8'));
    } catch (error) {
      if (!required && error.code === 'ENOENT') {
        composeSkipped.push(`${file}: optional production compatibility file is absent.`);
        continue;
      }
      integrityErrors.push({
        code: required && error.code === 'ENOENT' ? 'MISSING_PRODUCTION_COMPOSE' : 'PRODUCTION_COMPOSE_READ_ERROR',
        file,
        line: null,
        message:
          required && error.code === 'ENOENT'
            ? `Required production Compose file is missing: ${file}.`
            : `Cannot read production Compose file ${file}: ${error.message}`,
      });
    }
  }

  const routeViolations = [];
  const openCodeViolations = [];
  const browserViolations = [];
  const desktopViolations = [];
  const sandboxViolations = [];
  const routeFiles = [];
  const openCodeFiles = [];
  const browserFiles = [];
  const desktopFiles = [];
  const sandboxFiles = [];

  for (const [file, source] of contents) {
    if (file.startsWith('apps/api/src/routes/')) {
      routeFiles.push(file);
      checkInteractiveRoutes(file, source, routeViolations);
    }

    openCodeFiles.push(file);
    for (const { specifier, line } of findModuleSpecifiers(source)) {
      if (isOpenCodeSpecifier(specifier)) {
        addViolation(
          openCodeViolations,
          'OPENCODE_IMPORT',
          file,
          line,
          `First-party code must not import ${JSON.stringify(specifier)}; vendor/opencode is an untouched upstream snapshot, not a runtime dependency.`
        );
      }
    }

    if (file.startsWith('apps/board/src/') || file.startsWith('packages/ui/src/')) {
      browserFiles.push(file);
      for (const { specifier, line } of findModuleSpecifiers(source)) {
        if (isBrowserNativeSpecifier(specifier)) {
          addViolation(
            browserViolations,
            'BROWSER_NATIVE_IMPORT',
            file,
            line,
            `Browser UI must not import native/runtime module ${JSON.stringify(specifier)}; PTY and database execution stay behind the server adapter.`
          );
        }
      }
    }

    if (file.startsWith('apps/desktop/')) {
      desktopFiles.push(file);
      checkDesktopAuthority(file, source, desktopViolations);
    }
  }

  for (const [file, source] of composeContents) {
    sandboxFiles.push(file);
    checkProductionCompose(file, source, sandboxViolations, composeSkipped);
  }

  const checks = [
    { id: CHECK_IDS[0], checkedFiles: [], skipped: [], violations: integrityErrors },
    {
      id: CHECK_IDS[1],
      checkedFiles: routeFiles,
      skipped: [],
      violations: routeViolations,
    },
    {
      id: CHECK_IDS[2],
      checkedFiles: openCodeFiles,
      skipped: [],
      violations: openCodeViolations,
    },
    {
      id: CHECK_IDS[3],
      checkedFiles: browserFiles,
      skipped: [],
      violations: browserViolations,
    },
    {
      id: CHECK_IDS[4],
      checkedFiles: desktopFiles,
      skipped: [],
      violations: desktopViolations,
    },
    {
      id: CHECK_IDS[5],
      checkedFiles: sandboxFiles,
      skipped: composeSkipped,
      violations: sandboxViolations,
    },
  ];
  return makeReport(rootDir, checks);
}

function invalidArgumentReport(rootDir, message) {
  const violation = { code: 'INVALID_ARGUMENTS', file: null, line: null, message };
  return {
    schemaVersion: 1,
    gate: 'interactive-session-boundary',
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
    gate: 'interactive-session-boundary',
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
      `interactive-session-boundary: PASS (${report.checks.length} checks, ${report.checkedFiles.length} files checked).\n`
    );
    for (const skipped of report.checks.flatMap((check) => check.skipped)) stdout.write(`Skipped: ${skipped}\n`);
    return;
  }
  if (report.checks.length === 0) {
    stderr.write(`interactive-session-boundary: FAIL\n${report.violations.map((item) => item.message).join('\n')}\n`);
    stderr.write('Usage: node scripts/check-interactive-session-boundary.mjs [--root <directory>] [--json]\n');
    return;
  }
  stderr.write(
    `interactive-session-boundary: FAIL (${report.violationCount} violations, ${report.checkedFiles.length} files checked).\n`
  );
  for (const violation of report.violations) {
    const location = violation.file ? `${violation.file}${violation.line ? `:${violation.line}` : ''}` : '<cli>';
    stderr.write(`  - [${violation.code}] ${location}: ${violation.message}\n`);
  }
  stderr.write('Use --json for the stable machine-readable report.\n');
}

export async function runInteractiveSessionBoundaryCli(
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
        const report = invalidArgumentReport(rootDir, '--root requires a directory path.');
        return emitInvalidArgument(report);
      }
      rootDir = value;
      index += 1;
      continue;
    }
    const report = invalidArgumentReport(rootDir, `Unknown argument: ${JSON.stringify(argument)}.`);
    return emitInvalidArgument(report);
  }

  let report;
  try {
    report = await evaluateInteractiveSessionBoundary({ rootDir });
  } catch (error) {
    report = executionErrorReport(rootDir, error);
  }
  if (json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else writeHumanReport(report, stdout, stderr);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runInteractiveSessionBoundaryCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
