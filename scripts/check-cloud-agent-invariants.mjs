#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CLOUD_AGENT_ADR = 'docs/decisions/0014-freellmapi-cloud-coding-agent.md';
export const VENDOR_ROOT = 'vendor/freellmapi';
export const FREELMAPI_DATA_VOLUME = 'moonwitness-freellmapi-data';
export const HARD_CODED_CLOUD_TOKEN = 'mw-cloud-adapter-secret-token';

export const EXPECTED_UPSTREAM = Object.freeze({
  upstream: 'https://github.com/tashfeenahmed/freellmapi',
  revision: 'cd65d6485788dfc7828f06c1147cdea207b28322',
  license: 'MIT',
  treeSha256: '5363e28aa9ee38786a06f3379b5d6f17012be892b3c35391cd8ca79bff23bac0',
});

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const SKIPPED_SOURCE_DIRECTORIES = new Set([
  '.git',
  '.next',
  '__fixtures__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'test',
  'tests',
]);
const SECRET_SCAN_ROOTS = ['apps', 'packages', 'scripts', VENDOR_ROOT];

function normalizeRelativePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function finding(code, file, message, line) {
  return {
    code,
    file,
    ...(line === undefined ? {} : { line }),
    message,
  };
}

export function checkVendorProvenance(upstreamText, licenseText) {
  const violations = [];
  const upstreamFile = `${VENDOR_ROOT}/UPSTREAM.json`;
  const licenseFile = `${VENDOR_ROOT}/LICENSE`;

  if (upstreamText === null || upstreamText === undefined) {
    violations.push(
      finding('MISSING_UPSTREAM_METADATA', upstreamFile, 'UPSTREAM.json is required.')
    );
  } else {
    let metadata;
    try {
      metadata = JSON.parse(upstreamText);
    } catch {
      violations.push(
        finding('INVALID_UPSTREAM_METADATA', upstreamFile, 'UPSTREAM.json must contain valid JSON.')
      );
    }

    if (metadata !== undefined) {
      if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        violations.push(
          finding('INVALID_UPSTREAM_METADATA', upstreamFile, 'UPSTREAM.json must be an object.')
        );
      } else {
        for (const [field, expected] of Object.entries(EXPECTED_UPSTREAM)) {
          if (metadata[field] !== expected) {
            violations.push(
              finding(
                'UPSTREAM_METADATA_MISMATCH',
                upstreamFile,
                `${field} must be exactly ${JSON.stringify(expected)}; received ${JSON.stringify(metadata[field])}.`
              )
            );
          }
        }
      }
    }
  }

  if (licenseText === null || licenseText === undefined) {
    violations.push(
      finding('MISSING_MIT_LICENSE', licenseFile, 'The upstream MIT LICENSE is required.')
    );
  } else if (
    !/\bMIT License\b/iu.test(licenseText) ||
    !/Permission is hereby granted, free of charge/iu.test(licenseText)
  ) {
    violations.push(
      finding(
        'INVALID_MIT_LICENSE',
        licenseFile,
        'LICENSE must contain the upstream MIT License text.'
      )
    );
  }

  return violations;
}

export function classifyForbiddenVendorPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath).replace(/^\/+|\/+$/gu, '');
  if (!normalized) return null;
  const components = normalized.split('/');
  const basename = components.at(-1);

  if (components.includes('.git')) return 'NESTED_GIT_METADATA';
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) {
    return 'RUNTIME_ENV_FILE';
  }
  if (/\.(?:sqlite3?|db3?)(?:[-_](?:wal|shm|journal))?$|\.(?:wal|shm)$/iu.test(basename)) {
    return 'SQLITE_RUNTIME_DATA';
  }
  if (components.includes('node_modules')) return 'VENDORED_DEPENDENCIES';
  if (components.includes('dist')) return 'VENDORED_BUILD_OUTPUT';
  if (
    normalized === 'data' ||
    normalized.startsWith('data/') ||
    normalized === 'server/data' ||
    normalized.startsWith('server/data/') ||
    components.includes('.encryption-key')
  ) {
    return 'VENDORED_SERVER_DATA';
  }
  return null;
}

export function findForbiddenVendoredPaths(relativePaths) {
  return relativePaths.flatMap((relativePath) => {
    const code = classifyForbiddenVendorPath(relativePath);
    if (!code) return [];
    const file = `${VENDOR_ROOT}/${normalizeRelativePath(relativePath)}`;
    return [
      finding(
        code,
        file,
        `Forbidden vendored runtime/build path: ${normalizeRelativePath(relativePath)}.`
      ),
    ];
  });
}

function expandBraces(pattern) {
  const match = /\{([^{}]+)\}/u.exec(pattern);
  if (!match) return [pattern];
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((choice) => expandBraces(`${prefix}${choice}${suffix}`));
}

function globToRegExp(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[\\^$+?.()|{}[\]]/gu, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'u');
}

function globMatchesPath(pattern, target) {
  const normalizedPattern = normalizeRelativePath(pattern)
    .replace(/^\/+|\/+$/gu, '')
    .replace(/^\.\//u, '');
  if (!normalizedPattern) return false;
  const normalizedTarget = normalizeRelativePath(target).replace(/^\/+|\/+$/gu, '');
  const parts = normalizedTarget.split('/');
  const candidates = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  return expandBraces(normalizedPattern).some((expanded) => {
    const regex = globToRegExp(expanded);
    return candidates.some((candidate) => regex.test(candidate));
  });
}

function yamlScalar(rawValue) {
  let value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value.replace(/\s+#.*$/u, '').trim();
}

function parseFlowList(rawValue) {
  const content = rawValue.trim().slice(1, -1);
  return content.match(/(?:'[^']*'|"[^"]*"|[^,]+)/gu)?.map(yamlScalar) ?? [];
}

function workspaceIncludesVendor(source) {
  if (source.trimStart().startsWith('{')) {
    try {
      const manifest = JSON.parse(source);
      const rawWorkspaces = Array.isArray(manifest?.workspaces)
        ? manifest.workspaces
        : Array.isArray(manifest?.workspaces?.packages)
          ? manifest.workspaces.packages
          : [];
      return rawWorkspaces.some((pattern) =>
        typeof pattern === 'string' && workspacePatternIncludesVendor(pattern.trim())
      );
    } catch {
      return false;
    }
  }
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^packages:\s*(.*)$/u.exec(lines[index]);
    if (!header) continue;
    const inline = yamlScalar(header[1]);
    const patterns = inline.startsWith('[') ? parseFlowList(inline) : [];
    if (patterns.some((pattern) => workspacePatternIncludesVendor(pattern))) return true;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      if (!/^\s+/u.test(line)) break;
      const item = /^\s+-\s+(.+?)\s*$/u.exec(line);
      if (!item) continue;
      const pattern = yamlScalar(item[1]);
      if (workspacePatternIncludesVendor(pattern)) return true;
    }
    return false;
  }
  return false;
}

function workspacePatternIncludesVendor(pattern) {
  if (!pattern || pattern.startsWith('!')) return false;
  return (
    globMatchesPath(pattern, 'vendor/freellmapi') ||
    globMatchesPath(pattern, 'vendor/freellmapi/package.json')
  );
}

export function checkWorkspaceExclusion(source) {
  if (source === null || source === undefined) {
    return [
      finding('MISSING_WORKSPACE_FILE', 'package.json', 'package.json is required.'),
    ];
  }
  if (!workspaceIncludesVendor(source)) return [];
  return [
    finding(
      'VENDOR_IN_PNPM_WORKSPACE',
      'package.json',
      'vendor/freellmapi must remain outside the workspace.'
    ),
  ];
}

export function dockerIgnoreExcludesVendor(source) {
  let excluded = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = negated ? line.slice(1) : line;
    if (globMatchesPath(pattern, 'vendor/freellmapi/UPSTREAM.json')) excluded = !negated;
  }
  return excluded;
}

export function checkDockerIgnore(source) {
  if (source === null || source === undefined) {
    return [
      finding('MISSING_DOCKERIGNORE', '.dockerignore', 'The root .dockerignore is required.'),
    ];
  }
  if (dockerIgnoreExcludesVendor(source)) return [];
  return [
    finding(
      'VENDOR_NOT_DOCKER_IGNORED',
      '.dockerignore',
      'The root .dockerignore must exclude vendor/ from application image contexts.'
    ),
  ];
}

function stripYamlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === '"' && character === '"') {
      quote = null;
      continue;
    }
    if (quote === "'" && character === "'" && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'") {
      quote = null;
      continue;
    }
    if (quote === null && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (quote === null && character === '#' && (index === 0 || /\s/u.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function indentation(line) {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

export function extractComposeServiceBlocks(source) {
  const lines = source.split(/\r?\n/u).map(stripYamlComment);
  const servicesIndex = lines.findIndex(
    (line) => indentation(line) === 0 && line.trim() === 'services:'
  );
  if (servicesIndex < 0) return {};

  const blocks = {};
  let serviceIndent = null;
  let currentService = null;
  for (let index = servicesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = indentation(line);
    if (indent === 0) break;
    if (serviceIndent === null) serviceIndent = indent;
    if (indent < serviceIndent) break;

    if (indent === serviceIndent) {
      const header = /^\s*([A-Za-z0-9_.-]+):\s*(.*)$/u.exec(line);
      if (!header) continue;
      currentService = header[1];
      blocks[currentService] = [];
      const remainder = header[2].trim();
      if (remainder && !remainder.startsWith('&')) blocks[currentService].push(remainder);
    } else if (currentService !== null) {
      blocks[currentService].push(line);
    }
  }

  return Object.fromEntries(
    Object.entries(blocks).map(([name, blockLines]) => [name, blockLines.join('\n')])
  );
}

function extractTopLevelMappingBlock(source, key) {
  const lines = source.split(/\r?\n/u).map(stripYamlComment);
  const headerIndex = lines.findIndex(
    (line) => indentation(line) === 0 && line.trim() === `${key}:`
  );
  if (headerIndex < 0) return '';
  const block = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (indentation(line) === 0) break;
    block.push(line);
  }
  return block.join('\n');
}

function yamlAnchorName(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '&') {
      const match = /^&([A-Za-z0-9_][A-Za-z0-9_.-]*)/u.exec(line.slice(index + 1));
      if (match) return match[1];
    }
  }
  return null;
}

function collectYamlAnchors(source) {
  const lines = source.split(/\r?\n/u).map(stripYamlComment);
  const anchors = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const anchorName = yamlAnchorName(lines[index]);
    if (!anchorName || anchors.has(anchorName)) continue;
    const anchorIndent = indentation(lines[index]);
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].trim()) continue;
      if (indentation(lines[cursor]) <= anchorIndent) break;
      block.push(lines[cursor]);
    }
    anchors.set(anchorName, block.join('\n'));
  }
  return anchors;
}

function yamlAliasReferences(text) {
  const references = [];
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(
      /(?:^|[\s:[,{]+)\*([A-Za-z0-9_][A-Za-z0-9_.-]*)(?=$|[\s,\]}])/gmu
    )) {
      references.push(match[1]);
    }
  }
  return references;
}

function expandComposeBlock(block, anchors) {
  const expanded = [block];
  const pending = yamlAliasReferences(block);
  const seen = new Set();
  const unresolved = new Set();
  while (pending.length > 0) {
    const reference = pending.shift();
    if (seen.has(reference)) continue;
    seen.add(reference);
    const anchor = anchors.get(reference);
    if (!anchor) {
      unresolved.add(reference);
      continue;
    }
    expanded.push(anchor);
    pending.push(...yamlAliasReferences(anchor));
  }
  return { text: expanded.join('\n'), unresolved: [...unresolved].sort() };
}

function propertySections(text, key) {
  const lines = text.split('\n').map(stripYamlComment);
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(`^(\\s*)${key}\\s*:\\s*(.*)$`, 'u').exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const sectionLines = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].trim()) continue;
      if (indentation(lines[cursor]) <= indent) break;
      sectionLines.push(lines[cursor]);
    }
    sections.push({ indent, inline: match[2].trim(), lines: sectionLines });
  }
  return sections;
}

function hasPublishedPorts(text) {
  return propertySections(text, 'ports').some((section) => {
    if (!section.inline) return section.lines.length > 0;
    if (section.inline.startsWith('*')) return true;
    if (/^(?:null|~)$/iu.test(section.inline)) return false;
    if (section.inline.startsWith('[')) return section.inline.replace(/\s/gu, '') !== '[]';
    return true;
  });
}

function volumeListItems(section) {
  const items = [];
  let listIndent = null;
  let current = null;
  for (const line of section.lines) {
    const item = /^(\s*)-\s*(.*)$/u.exec(line);
    if (item && (listIndent === null || item[1].length === listIndent)) {
      if (current) items.push(current);
      listIndent = item[1].length;
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(current);
  return items;
}

function volumeItems(text) {
  return propertySections(text, 'volumes').flatMap((section) => {
    if (section.inline.startsWith('[')) {
      return parseFlowList(section.inline).map((raw) => ({ rawLines: [raw], unresolved: false }));
    }
    if (section.inline) {
      return [{ rawLines: [section.inline], unresolved: section.inline.startsWith('*') }];
    }
    return volumeListItems(section).map((rawLines) => ({ rawLines, unresolved: false }));
  });
}

function isHostLikeSource(source) {
  return /^(?:\.{1,2}(?:\/|$)|[\\/]|~|[A-Za-z]:[\\/]|\$)/u.test(source);
}

function parseVolumeItem({ rawLines, unresolved }) {
  if (unresolved) return { kind: 'unresolved', source: null, target: null };

  const firstLine = rawLines[0] ?? '';
  const firstValue = /^\s*-\s*(.*)$/u.exec(firstLine)?.[1] ?? firstLine;
  const looksLong = /^type\s*:/u.test(firstValue.trim()) || rawLines.length > 1;
  if (looksLong) {
    const property = (key) => {
      for (const line of rawLines) {
        const match = new RegExp(`^\\s*(?:-\\s*)?${key}\\s*:\\s*(.*)$`, 'u').exec(line);
        if (match) return yamlScalar(match[1]);
      }
      return null;
    };
    const type = property('type');
    const source = property('source');
    const target = property('target');
    return {
      kind:
        type === 'bind' || (!type && source && isHostLikeSource(source))
          ? 'bind'
          : (type ?? 'volume'),
      source,
      target,
    };
  }

  const raw = yamlScalar(firstValue);
  if (raw.startsWith('$')) return { kind: 'unresolved', source: raw, target: null };
  if (raw.length === 0) return { kind: 'volume', source: null, target: null };

  let separator = raw.indexOf(':');
  if (/^[A-Za-z]:[\\/]/u.test(raw)) separator = raw.indexOf(':', 2);
  if (separator < 0) return { kind: 'volume', source: null, target: raw };
  const source = raw.slice(0, separator);
  const target = raw.slice(separator + 1).split(':')[0];
  return {
    kind: source && isHostLikeSource(source) ? 'bind' : 'volume',
    source: source || null,
    target,
  };
}

function mappingKeyDeclared(block, key) {
  const lines = block.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return false;
  const indent = Math.min(...lines.map(indentation));
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return lines.some((line) => new RegExp(`^ {${indent}}${escapedKey}\\s*:`, 'u').test(line));
}

/** Resolve the effective Docker volume name of a top-level Compose volume key. */
function declaredVolumeNames(block) {
  const names = new Map();
  const lines = block.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^\s{2}([A-Za-z0-9_.-]+):\s*$/u.exec(lines[index]);
    if (!header) continue;
    let effectiveName = header[1];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].trim()) continue;
      if (indentation(lines[cursor]) <= 2) break;
      const name = /^\s+name:\s*(.+?)\s*$/u.exec(lines[cursor]);
      if (name) effectiveName = yamlScalar(name[1]);
    }
    names.set(header[1], effectiveName);
  }
  return names;
}

const ROOTLESS_SOCKET_PATH = /^\/run\/user\/(?:[0-9]+)\/docker\.sock$/u;

/** Extract the default from `${VAR:-/default}` so an env reference can be reviewed. */
function composeEnvDefault(value) {
  if (typeof value !== 'string') return null;
  const match = /\$\{[A-Za-z0-9_]+:-([^}]*)\}/u.exec(value);
  if (match) return match[1].trim();
  return value.trim();
}

function isDedicatedRootlessSocket(value) {
  const candidate = composeEnvDefault(value);
  return candidate !== null && ROOTLESS_SOCKET_PATH.test(candidate);
}

function checkComposeService(name, block, anchors, isGateway, volumeNames = new Map()) {
  const violations = [];
  const expanded = expandComposeBlock(block, anchors);
  for (const reference of expanded.unresolved) {
    violations.push(
      finding(
        'UNRESOLVED_COMPOSE_ALIAS',
        'deploy/compose/docker-compose.production.yml',
        `${name} references unresolved YAML alias ${reference}; its effective ports and mounts cannot be verified.`
      )
    );
  }
  if (hasPublishedPorts(expanded.text)) {
    violations.push(
      finding(
        'PRODUCTION_SERVICE_PUBLISHED_PORT',
        'deploy/compose/docker-compose.production.yml',
        `${name} must not publish ports in production.`
      )
    );
  }
  if (/\bdocker\.sock\b/iu.test(expanded.text)) {
    violations.push(
      finding(
        'PRODUCTION_SERVICE_DOCKER_SOCKET',
        'deploy/compose/docker-compose.production.yml',
        `${name} must not reference a Docker socket in the canonical production stack. Enable container execution explicitly with deploy/compose/docker-compose.agent-sandbox-socket.yml and a dedicated rootless daemon.`
      )
    );
  }

  const mounts = volumeItems(expanded.text).map(parseVolumeItem);
  for (const mount of mounts) {
    if (mount.kind !== 'bind' && mount.kind !== 'unresolved') continue;
    const dedicatedRootless =
      !isGateway &&
      mount.kind === 'bind' &&
      isDedicatedRootlessSocket(mount.source) &&
      isDedicatedRootlessSocket(mount.target);
    if (!dedicatedRootless) {
      violations.push(
        finding(
          'PRODUCTION_SERVICE_HOST_MOUNT',
          'deploy/compose/docker-compose.production.yml',
          `${name} must not use host repository/bind mounts; use isolated named volumes.`
        )
      );
    }
  }

  if (
    isGateway &&
    !mounts.some(
      (mount) =>
        mount.kind === 'volume' &&
        (mount.source === FREELMAPI_DATA_VOLUME ||
          volumeNames.get(mount.source ?? '') === FREELMAPI_DATA_VOLUME) &&
        mount.target?.replace(/\/+$/u, '') === '/app/server/data'
    )
  ) {
    violations.push(
      finding(
        'FREELMAPI_DATA_VOLUME_MISSING',
        'deploy/compose/docker-compose.production.yml',
        `freellmapi must mount named volume ${FREELMAPI_DATA_VOLUME} at /app/server/data.`
      )
    );
  }

  return violations;
}

export function checkProductionCompose(source) {
  if (source === null || source === undefined) {
    return {
      violations: [
        finding(
          'MISSING_PRODUCTION_COMPOSE',
          'deploy/compose/docker-compose.production.yml',
          'The canonical production Compose file is required.'
        ),
      ],
      skipped: [],
    };
  }

  const violations = [];
  const skipped = [];
  const services = extractComposeServiceBlocks(source);
  const anchors = collectYamlAnchors(source);
  const volumesBlock = extractTopLevelMappingBlock(source, 'volumes');
  const volumeNames = declaredVolumeNames(volumesBlock);

  if (!Object.hasOwn(services, 'freellmapi')) {
    violations.push(
      finding(
        'MISSING_FREELMAPI_SERVICE',
        'deploy/compose/docker-compose.production.yml',
        'Production Compose must define an internal-only freellmapi service.'
      )
    );
  } else {
    violations.push(
      ...checkComposeService('freellmapi', services.freellmapi, anchors, true, volumeNames)
    );
    const declared =
      mappingKeyDeclared(volumesBlock, FREELMAPI_DATA_VOLUME) ||
      [...volumeNames.values()].includes(FREELMAPI_DATA_VOLUME);
    if (!declared) {
      violations.push(
        finding(
          'FREELMAPI_DATA_VOLUME_UNDECLARED',
          'deploy/compose/docker-compose.production.yml',
          `Named volume ${FREELMAPI_DATA_VOLUME} must be declared in production Compose.`
        )
      );
    }
  }

  if (!Object.hasOwn(services, 'agent-sandbox')) {
    skipped.push(
      'agent-sandbox Compose block is absent; its isolation rules apply when it is added.'
    );
  } else {
    violations.push(
      ...checkComposeService(
        'agent-sandbox',
        services['agent-sandbox'],
        anchors,
        false,
        volumeNames
      )
    );
  }

  return { violations, skipped };
}

function forbiddenBoardModule(specifier) {
  if (
    specifier === '@moonwitness/orm' ||
    specifier.startsWith('@moonwitness/orm/') ||
    specifier.startsWith('@moonwitness/orm-')
  ) {
    return 'ORM access belongs in packages/orm-* and apps/api, not Board.';
  }
  if (specifier === '@moonwitness/ai-runtime' || specifier.startsWith('@moonwitness/ai-runtime/')) {
    return 'AI runtime and provider execution belong outside Board.';
  }
  if (/^(?:node:)?fs(?:\/promises)?$/u.test(specifier)) {
    return 'Board must not import Node filesystem modules.';
  }
  if (/^(?:node:)?child_process$/u.test(specifier)) {
    return 'Board must not import Node child_process.';
  }
  if (
    specifier === 'docker' ||
    specifier.startsWith('docker/') ||
    specifier === 'dockerode' ||
    specifier === 'docker-modem' ||
    specifier.startsWith('@docker/')
  ) {
    return 'Board must not control Docker or sandbox infrastructure.';
  }
  if (specifier === 'node-pty' || specifier.startsWith('node-pty/')) {
    return 'Board must not import PTY execution.';
  }
  return null;
}

function staticString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return node.text;
  if (ts.isComputedPropertyName(node)) return staticString(node.expression);
  return null;
}

function isProcessEnvExpression(node) {
  if (ts.isParenthesizedExpression(node)) return isProcessEnvExpression(node.expression);
  if (ts.isPropertyAccessExpression(node)) {
    return (
      node.name.text === 'env' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process'
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      staticString(node.argumentExpression) === 'env' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process'
    );
  }
  return false;
}

export function checkBoardSource(relativePath, source) {
  const violations = [];
  const normalized = normalizeRelativePath(relativePath);
  const scriptKind = normalized.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : normalized.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(normalized, source, ts.ScriptTarget.Latest, true, scriptKind);
  const report = (node, code, message) => {
    const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
    violations.push(finding(code, normalized, message, line + 1));
  };
  const checkModule = (node, specifierNode) => {
    const specifier = staticString(specifierNode);
    if (!specifier) return;
    const reason = forbiddenBoardModule(specifier);
    if (reason) report(node, 'BOARD_FORBIDDEN_IMPORT', `${specifier}: ${reason}`);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      checkModule(node, node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      checkModule(node, node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      ((node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          node.arguments[0]))
    ) {
      checkModule(node, node.arguments[0]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      checkModule(node, node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      checkModule(node, node.argument.literal);
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isProcessEnvExpression(node.expression)
    ) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : staticString(node.argumentExpression);
      if (name?.startsWith('MW_AI_')) {
        report(node, 'BOARD_MW_AI_ENV_ACCESS', `Board must not read process.env.${name}.`);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      isProcessEnvExpression(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const name = propertyName(element.propertyName ?? element.name);
        if (name?.startsWith('MW_AI_')) {
          report(
            element,
            'BOARD_MW_AI_ENV_ACCESS',
            `Board must not destructure process.env.${name}.`
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

function isFreellmProviderKindComparison(node) {
  if (ts.isParenthesizedExpression(node)) return isFreellmProviderKindComparison(node.expression);
  if (!ts.isBinaryExpression(node)) return false;
  // Use the real TypeScript SyntaxKind names for == and ===. `EqualsToken`
  // is assignment (`=`), not comparison, and the CaseInsensitive variants do
  // not exist; accepting undefined silently disabled this invariant check.
  if (
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return false;
  }
  const isProviderKind = (candidate) =>
    ts.isPropertyAccessExpression(candidate) &&
    candidate.name.text === 'kind' &&
    ts.isIdentifier(candidate.expression) &&
    candidate.expression.text === 'provider';
  return (
    (isProviderKind(node.left) && staticString(node.right) === 'freellmapi') ||
    (isProviderKind(node.right) && staticString(node.left) === 'freellmapi')
  );
}

function statementReturnsTrue(node) {
  if (ts.isReturnStatement(node)) {
    return node.expression?.kind === ts.SyntaxKind.TrueKeyword;
  }
  return ts.isBlock(node) && node.statements.some(statementReturnsTrue);
}

function statementContainsReturn(node) {
  if (ts.isReturnStatement(node)) return true;
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isReturnStatement(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export function checkCloudEgressClassification(source) {
  const file = 'packages/ai-runtime/src/classification-router.ts';
  if (source === null || source === undefined) {
    return [
      finding('MISSING_CLASSIFICATION_ROUTER', file, 'The classification router is required.'),
    ];
  }
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let target = null;
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'isProviderCloudEgress' &&
      node.body
    ) {
      target = node;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'isProviderCloudEgress' &&
      node.initializer &&
      ts.isArrowFunction(node.initializer) &&
      ts.isBlock(node.initializer.body)
    ) {
      target = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  if (!target) {
    return [
      finding(
        'MISSING_CLOUD_EGRESS_CLASSIFIER',
        file,
        'isProviderCloudEgress must explicitly classify the freellmapi provider kind.'
      ),
    ];
  }

  let mayHaveReturned = false;
  let recognized = false;
  for (const statement of target.body.statements) {
    if (mayHaveReturned) break;
    if (
      ts.isIfStatement(statement) &&
      isFreellmProviderKindComparison(statement.expression) &&
      statementReturnsTrue(statement.thenStatement)
    ) {
      recognized = true;
      break;
    }
    if (statementContainsReturn(statement)) mayHaveReturned = true;
  }

  return recognized
    ? []
    : [
        finding(
          'FREELMAPI_NOT_CLOUD_EGRESS',
          file,
          'isProviderCloudEgress must return true for freellmapi before any deployment-zone override.'
        ),
      ];
}

export function findHardCodedCloudAdapterToken(source) {
  const matches = [];
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(HARD_CODED_CLOUD_TOKEN);
    if (column >= 0) matches.push({ line: index + 1, column: column + 1 });
  }
  return matches;
}

async function walkTree(rootDir, relativeRoot = '') {
  const entries = [];
  const errors = [];
  let missingRoot = false;
  const visit = async (relativeDirectory) => {
    const absoluteDirectory = path.join(rootDir, relativeDirectory);
    let directoryEntries;
    try {
      directoryEntries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        if (!relativeDirectory) missingRoot = true;
        return;
      }
      errors.push(
        finding(
          'TREE_READ_ERROR',
          relativeDirectory || '.',
          `Unable to inspect directory: ${error?.message ?? String(error)}`
        )
      );
      return;
    }
    directoryEntries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of directoryEntries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      entries.push({
        relativePath,
        directory: entry.isDirectory(),
        file: entry.isFile(),
        symlink: entry.isSymbolicLink(),
      });
      if (entry.isDirectory()) await visit(relativePath);
    }
  };
  await visit(relativeRoot);
  entries.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
  return { entries, errors, missingRoot };
}

async function readText(rootDir, relativePath) {
  try {
    return { text: await readFile(path.join(rootDir, relativePath), 'utf8'), error: null };
  } catch (error) {
    return { text: null, error };
  }
}

function readFinding(relativePath, error) {
  if (error?.code === 'ENOENT') {
    return finding('MISSING_REQUIRED_FILE', relativePath, 'Required file is missing.');
  }
  return finding(
    'FILE_READ_ERROR',
    relativePath,
    `Unable to read file: ${error?.message ?? String(error)}`
  );
}

function shouldScanProductionSource(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const components = normalized.split('/');
  const basename = components.at(-1);
  if (components.some((component) => SKIPPED_SOURCE_DIRECTORIES.has(component))) return false;
  if (/\.(?:test|spec)\.[^.]+$/u.test(basename)) return false;
  if (normalized === 'scripts/check-cloud-agent-invariants.mjs') return false;
  return SOURCE_EXTENSIONS.has(path.posix.extname(basename));
}

export async function evaluateCloudAgentInvariants({ rootDir = defaultRoot } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const checks = [];
  const addCheck = (id, violations, skipped = []) => {
    checks.push({ id, ok: violations.length === 0, violations, skipped });
  };

  const adr = await readText(resolvedRoot, CLOUD_AGENT_ADR);
  addCheck(
    'adr-0014',
    adr.error
      ? [readFinding(CLOUD_AGENT_ADR, adr.error)]
      : adr.text.trim()
        ? []
        : [finding('EMPTY_ADR_0014', CLOUD_AGENT_ADR, 'ADR 0014 must not be empty.')]
  );

  const [upstream, license] = await Promise.all([
    readText(resolvedRoot, `${VENDOR_ROOT}/UPSTREAM.json`),
    readText(resolvedRoot, `${VENDOR_ROOT}/LICENSE`),
  ]);
  const provenanceViolations = [
    ...(upstream.error ? [readFinding(`${VENDOR_ROOT}/UPSTREAM.json`, upstream.error)] : []),
    ...(license.error ? [readFinding(`${VENDOR_ROOT}/LICENSE`, license.error)] : []),
    ...checkVendorProvenance(
      upstream.error ? null : upstream.text,
      license.error ? null : license.text
    ),
  ];
  addCheck('vendor-provenance', provenanceViolations);

  const vendorTree = await walkTree(resolvedRoot, VENDOR_ROOT);
  const vendorRelativePaths = vendorTree.entries.map((entry) =>
    entry.relativePath.slice(`${VENDOR_ROOT}/`.length)
  );
  addCheck('vendor-tree', [
    ...vendorTree.errors,
    ...findForbiddenVendoredPaths(vendorRelativePaths),
  ]);

  const workspace = await readText(resolvedRoot, 'package.json');
  addCheck(
    'bun-workspace',
    workspace.error
      ? [readFinding('package.json', workspace.error)]
      : checkWorkspaceExclusion(workspace.text)
  );

  const dockerIgnore = await readText(resolvedRoot, '.dockerignore');
  addCheck(
    'dockerignore',
    dockerIgnore.error
      ? [readFinding('.dockerignore', dockerIgnore.error)]
      : checkDockerIgnore(dockerIgnore.text)
  );

  const compose = await readText(resolvedRoot, 'deploy/compose/docker-compose.production.yml');
  const composeResult = compose.error
    ? {
        violations: [readFinding('deploy/compose/docker-compose.production.yml', compose.error)],
        skipped: [],
      }
    : checkProductionCompose(compose.text);
  addCheck('production-compose', composeResult.violations, composeResult.skipped);

  const boardRoot = 'apps/board/src';
  const boardTree = await walkTree(resolvedRoot, boardRoot);
  const boardViolations = [...boardTree.errors];
  if (boardTree.missingRoot) {
    boardViolations.push(
      finding('MISSING_BOARD_SOURCE', boardRoot, 'Board source must be inspected.')
    );
  }
  for (const entry of boardTree.entries) {
    if (!entry.file || !shouldScanProductionSource(entry.relativePath)) continue;
    const source = await readText(resolvedRoot, entry.relativePath);
    if (source.error) boardViolations.push(readFinding(entry.relativePath, source.error));
    else boardViolations.push(...checkBoardSource(entry.relativePath, source.text));
  }
  addCheck('board-boundary', boardViolations);

  const classification = await readText(
    resolvedRoot,
    'packages/ai-runtime/src/classification-router.ts'
  );
  addCheck(
    'cloud-egress',
    classification.error
      ? [readFinding('packages/ai-runtime/src/classification-router.ts', classification.error)]
      : checkCloudEgressClassification(classification.text)
  );

  const secretViolations = [];
  for (const scanRoot of SECRET_SCAN_ROOTS) {
    const tree = await walkTree(resolvedRoot, scanRoot);
    secretViolations.push(...tree.errors);
    for (const entry of tree.entries) {
      if (!entry.file || !shouldScanProductionSource(entry.relativePath)) continue;
      const source = await readText(resolvedRoot, entry.relativePath);
      if (source.error) {
        secretViolations.push(readFinding(entry.relativePath, source.error));
        continue;
      }
      for (const match of findHardCodedCloudAdapterToken(source.text)) {
        secretViolations.push(
          finding(
            'HARD_CODED_CLOUD_ADAPTER_TOKEN',
            entry.relativePath,
            'The retired hard-coded cloud-adapter fallback must be replaced by fail-closed secret resolution.',
            match.line
          )
        );
      }
    }
  }
  addCheck('hard-coded-secret', secretViolations);

  const violations = checks.flatMap((check) => check.violations);
  return {
    ok: violations.length === 0,
    rootDir: resolvedRoot,
    checkCount: checks.length,
    violationCount: violations.length,
    checks,
    skipped: checks.flatMap((check) => check.skipped),
    violations,
  };
}

export async function runCloudAgentGateCli(argv, options = {}) {
  const jsonOutput = argv.includes('--json');
  const unknownArguments = argv.filter((argument) => argument !== '--json');
  let result;
  if (unknownArguments.length > 0) {
    result = {
      ok: false,
      checkCount: 0,
      violationCount: 1,
      checks: [],
      skipped: [],
      violations: [
        finding(
          'INVALID_ARGUMENTS',
          'scripts/check-cloud-agent-invariants.mjs',
          `Unknown argument(s): ${unknownArguments.join(', ')}. Supported option: --json.`
        ),
      ],
    };
  } else {
    result = await evaluateCloudAgentInvariants({ rootDir: options.rootDir ?? defaultRoot });
  }

  const writeStdout = options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));
  if (jsonOutput) {
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    const skipped = result.skipped.length > 0 ? ` Skipped: ${result.skipped.join(' ')}` : '';
    writeStdout(`Cloud coding-agent invariants passed (${result.checkCount} checks).${skipped}\n`);
  } else {
    writeStderr(`Cloud coding-agent invariants failed (${result.violationCount} violation(s)):\n`);
    for (const violation of result.violations) {
      const line = violation.line === undefined ? '' : `:${violation.line}`;
      writeStderr(`  - [${violation.code}] ${violation.file}${line}: ${violation.message}\n`);
    }
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runCloudAgentGateCli(process.argv.slice(2));
}
