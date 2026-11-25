#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(SCRIPT_DIR, '../assets/dashboard.html');
const STATE_TOKEN = '__SWARM_STATE__';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 16_384;
const MAX_FILE_LENGTH = 4_096;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TASK_STATUSES = new Set(['pending', 'ready', 'running', 'blocked', 'done', 'failed']);
const AGENT_STATUSES = new Set(['idle', 'running', 'done', 'failed', 'stopped']);
const POLL_INTERVAL_MS = 750;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    'img-src data:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const HELP = `Usage:
  node swarm-dashboard.mjs init --name <name> --goal <goal> [--dir .swarm] [--force]
  node swarm-dashboard.mjs validate [--dir .swarm]
  node swarm-dashboard.mjs render [--dir .swarm] [--output <dir>/dashboard.html]
  node swarm-dashboard.mjs serve [--dir .swarm] [--host 127.0.0.1] [--port 4177]
  node swarm-dashboard.mjs --help

Paths are resolved from the current working directory.`;

class DashboardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DashboardError';
  }
}

function errorMessage(error) {
  if (error instanceof DashboardError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { command: 'help' };
  }

  const command = argv[0];
  const definitions = {
    init: {
      '--name': 'name',
      '--goal': 'goal',
      '--dir': 'dir',
      '--force': 'force',
    },
    validate: { '--dir': 'dir' },
    render: { '--dir': 'dir', '--output': 'output' },
    serve: { '--dir': 'dir', '--host': 'host', '--port': 'port' },
  };

  if (!Object.hasOwn(definitions, command)) {
    throw new DashboardError(`Unknown command: ${command || '(missing)'}`);
  }
  if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) {
    return { command: 'help' };
  }

  const options = { command };
  const seen = new Set();
  const allowed = definitions[command];

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!Object.hasOwn(allowed, flag)) {
      throw new DashboardError(`Unknown option for ${command}: ${flag}`);
    }
    if (seen.has(flag)) {
      throw new DashboardError(`Duplicate option: ${flag}`);
    }
    seen.add(flag);

    const key = allowed[flag];
    if (key === 'force') {
      options[key] = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new DashboardError(`Missing value for ${flag}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }

  return options;
}

function resolvePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DashboardError(`${label} must be a non-empty path`);
  }
  if (value.includes('\0') || value.length > MAX_FILE_LENGTH) {
    throw new DashboardError(`${label} is not a valid path`);
  }
  return path.resolve(process.cwd(), value);
}

function boundedString(value, label, maxLength = MAX_TEXT_LENGTH, nonEmpty = true) {
  if (typeof value !== 'string') {
    throw new DashboardError(`${label} must be a string`);
  }
  if (nonEmpty && value.trim() === '') {
    throw new DashboardError(`${label} must not be empty`);
  }
  if (value.length > maxLength) {
    throw new DashboardError(`${label} must be at most ${maxLength} characters`);
  }
  return value;
}

function requiredString(record, key, label, maxLength = MAX_TEXT_LENGTH) {
  if (!Object.hasOwn(record, key)) {
    throw new DashboardError(`${label} is required`);
  }
  return boundedString(record[key], label, maxLength);
}

function optionalString(record, key, label, maxLength = MAX_TEXT_LENGTH) {
  if (!Object.hasOwn(record, key)) return undefined;
  return boundedString(record[key], label, maxLength, false);
}

function requiredId(value, label) {
  const id = boundedString(value, label, MAX_ID_LENGTH);
  if (!ID_PATTERN.test(id)) {
    throw new DashboardError(`${label} must match ${ID_PATTERN}`);
  }
  return id;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(value, label) {
  if (!isRecord(value)) {
    throw new DashboardError(`${label} must be an object`);
  }
  return value;
}

function requiredArray(record, key, label) {
  if (!Object.hasOwn(record, key) || !Array.isArray(record[key])) {
    throw new DashboardError(`${label} must be an array`);
  }
  return record[key];
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(
      value
    );
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[7] !== undefined && (Number(match[7]) > 23 || Number(match[8]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function normalizeFilePath(file) {
  return path.posix.normalize(file.replaceAll('\\', '/'));
}

function validateFileOwnership(tasks) {
  const claims = [];
  for (const task of tasks) {
    const seen = new Set();
    for (const file of task.files) {
      if (file.includes('\0')) {
        throw new DashboardError(`tasks.${task.id}.files must not contain NUL characters`);
      }
      const normalized = normalizeFilePath(file);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      claims.push({ file: normalized, taskId: task.id });
    }
  }

  claims.sort((left, right) => {
    if (left.file < right.file) return -1;
    if (left.file > right.file) return 1;
    return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
  });

  const owners = new Map();
  for (const claim of claims) {
    const exactOwner = owners.get(claim.file);
    if (exactOwner && exactOwner.taskId !== claim.taskId) {
      throw new DashboardError(
        `File ownership conflict between tasks ${exactOwner.taskId} and ${claim.taskId}: ${claim.file}`
      );
    }

    if (
      claim.file !== '.' &&
      !claim.file.startsWith('/') &&
      owners.has('.') &&
      owners.get('.').taskId !== claim.taskId
    ) {
      throw new DashboardError(
        `File ownership conflict between tasks ${owners.get('.').taskId} and ${claim.taskId}: ${claim.file}`
      );
    }

    let ancestor = claim.file;
    while (ancestor.includes('/')) {
      const slash = ancestor.lastIndexOf('/');
      ancestor = slash === 0 ? '/' : ancestor.slice(0, slash);
      const ancestorOwner = owners.get(ancestor);
      if (ancestorOwner && ancestorOwner.taskId !== claim.taskId) {
        throw new DashboardError(
          `File ownership conflict between tasks ${ancestorOwner.taskId} and ${claim.taskId}: ${ancestorOwner.file} prefixes ${claim.file}`
        );
      }
      if (ancestor === '/') break;
    }

    if (!exactOwner) owners.set(claim.file, claim);
  }
}

function validateDependencyCycles(tasks) {
  const indegree = new Map();
  const dependents = new Map();
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length);
    dependents.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      dependents.get(dependency).push(task.id);
    }
  }

  const queue = tasks.filter((task) => task.dependsOn.length === 0).map((task) => task.id);
  let processed = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const taskId = queue[index];
    processed += 1;
    for (const dependent of dependents.get(taskId)) {
      const next = indegree.get(dependent) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (processed !== tasks.length) {
    const cyclic = tasks
      .filter((task) => indegree.get(task.id) > 0)
      .slice(0, 10)
      .map((task) => task.id)
      .join(', ');
    throw new DashboardError(`Task dependency cycle detected: ${cyclic}`);
  }
}

function validateManifest(input) {
  const manifest = requiredRecord(input, 'manifest');
  if (manifest.version !== 1) {
    throw new DashboardError('manifest.version must be 1');
  }
  requiredString(manifest, 'name', 'manifest.name');
  requiredString(manifest, 'goal', 'manifest.goal');
  for (const key of ['startedAt', 'updatedAt']) {
    const value = requiredString(manifest, key, `manifest.${key}`, 64);
    if (!isIsoTimestamp(value)) {
      throw new DashboardError(`manifest.${key} must be a valid ISO timestamp`);
    }
  }

  const rawTasks = requiredArray(manifest, 'tasks', 'manifest.tasks');
  const rawAgents = requiredArray(manifest, 'agents', 'manifest.agents');
  const rawEvents = requiredArray(manifest, 'events', 'manifest.events');
  const tasks = [];
  const agents = [];
  const events = [];
  const taskIds = new Set();
  const agentIds = new Set();
  const eventIds = new Set();

  for (let index = 0; index < rawTasks.length; index += 1) {
    const label = `manifest.tasks[${index}]`;
    const task = requiredRecord(rawTasks[index], label);
    const id = requiredId(task.id, `${label}.id`);
    if (taskIds.has(id)) throw new DashboardError(`Duplicate task id: ${id}`);
    taskIds.add(id);

    requiredString(task, 'title', `${label}.title`);
    if (!Object.hasOwn(task, 'status') || !TASK_STATUSES.has(task.status)) {
      throw new DashboardError(`${label}.status must be one of: ${[...TASK_STATUSES].join(', ')}`);
    }
    const dependsOn = requiredArray(task, 'dependsOn', `${label}.dependsOn`);
    for (let dependencyIndex = 0; dependencyIndex < dependsOn.length; dependencyIndex += 1) {
      requiredId(dependsOn[dependencyIndex], `${label}.dependsOn[${dependencyIndex}]`);
    }
    if (Object.hasOwn(task, 'owner')) {
      requiredId(task.owner, `${label}.owner`);
    }
    const files = requiredArray(task, 'files', `${label}.files`);
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      boundedString(files[fileIndex], `${label}.files[${fileIndex}]`, MAX_FILE_LENGTH);
    }
    optionalString(task, 'summary', `${label}.summary`);
    tasks.push(task);
  }

  for (let index = 0; index < rawAgents.length; index += 1) {
    const label = `manifest.agents[${index}]`;
    const agent = requiredRecord(rawAgents[index], label);
    const id = requiredId(agent.id, `${label}.id`);
    if (agentIds.has(id)) throw new DashboardError(`Duplicate agent id: ${id}`);
    agentIds.add(id);

    requiredString(agent, 'name', `${label}.name`);
    requiredString(agent, 'role', `${label}.role`);
    if (!Object.hasOwn(agent, 'status') || !AGENT_STATUSES.has(agent.status)) {
      throw new DashboardError(`${label}.status must be one of: ${[...AGENT_STATUSES].join(', ')}`);
    }
    if (
      typeof agent.progress !== 'number' ||
      !Number.isFinite(agent.progress) ||
      agent.progress < 0 ||
      agent.progress > 100
    ) {
      throw new DashboardError(`${label}.progress must be a number from 0 to 100`);
    }
    const taskIdsForAgent = requiredArray(agent, 'taskIds', `${label}.taskIds`);
    for (let taskIndex = 0; taskIndex < taskIdsForAgent.length; taskIndex += 1) {
      requiredId(taskIdsForAgent[taskIndex], `${label}.taskIds[${taskIndex}]`);
    }
    optionalString(agent, 'message', `${label}.message`);
    agents.push(agent);
  }

  for (const task of tasks) {
    if (task.dependsOn.includes(task.id)) {
      throw new DashboardError(`Task ${task.id} cannot depend on itself`);
    }
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) {
        throw new DashboardError(`Task ${task.id} references unknown dependency: ${dependency}`);
      }
    }
    if (task.owner !== undefined && !agentIds.has(task.owner)) {
      throw new DashboardError(`Task ${task.id} references unknown owner: ${task.owner}`);
    }
  }

  for (const agent of agents) {
    for (const taskId of agent.taskIds) {
      if (!taskIds.has(taskId)) {
        throw new DashboardError(`Agent ${agent.id} references unknown task: ${taskId}`);
      }
    }
  }

  for (let index = 0; index < rawEvents.length; index += 1) {
    const label = `manifest.events[${index}]`;
    const event = requiredRecord(rawEvents[index], label);
    const id = requiredId(event.id, `${label}.id`);
    if (eventIds.has(id)) throw new DashboardError(`Duplicate event id: ${id}`);
    eventIds.add(id);

    const at = requiredString(event, 'at', `${label}.at`, 64);
    if (!isIsoTimestamp(at)) {
      throw new DashboardError(`${label}.at must be a valid ISO timestamp`);
    }
    if (Object.hasOwn(event, 'agentId')) {
      const agentId = requiredId(event.agentId, `${label}.agentId`);
      if (!agentIds.has(agentId)) {
        throw new DashboardError(`Event ${id} references unknown agent: ${agentId}`);
      }
    }
    if (Object.hasOwn(event, 'taskId')) {
      const taskId = requiredId(event.taskId, `${label}.taskId`);
      if (!taskIds.has(taskId)) {
        throw new DashboardError(`Event ${id} references unknown task: ${taskId}`);
      }
    }
    requiredString(event, 'type', `${label}.type`);
    requiredString(event, 'message', `${label}.message`);
    events.push(event);
  }

  validateDependencyCycles(tasks);
  validateFileOwnership(tasks);
  return manifest;
}

function signatureFrom(info) {
  return `${info.mtimeNs}:${info.size}`;
}

function fileError(error, filePath, label, action = 'read') {
  if (error instanceof DashboardError) return error;
  if (error?.code === 'ENOENT') return new DashboardError(`${label} not found: ${filePath}`);
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new DashboardError(`Permission denied: ${filePath}`);
  }
  if (error?.code === 'EISDIR') return new DashboardError(`${label} is not a file: ${filePath}`);
  return new DashboardError(`Could not ${action} ${filePath}: ${error.message}`);
}

async function readBoundedFile(filePath, label = 'File', maxBytes = MAX_MANIFEST_BYTES) {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new DashboardError(`${label} is not a file: ${filePath}`);
    if (before.size > BigInt(maxBytes)) {
      throw new DashboardError(`${label} exceeds the ${maxBytes}-byte limit`);
    }

    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new DashboardError(`${label} exceeds the ${maxBytes}-byte limit`);
    }

    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || after.size > BigInt(maxBytes)) {
      throw new DashboardError(`${label} changed while being read; try again`);
    }
    if (signatureFrom(before) !== signatureFrom(after)) {
      throw new DashboardError(`${label} changed while being read; try again`);
    }

    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
    return { text, signature: signatureFrom(after) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DashboardError(`${label} must contain valid UTF-8`);
    }
    throw fileError(error, filePath, label);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DashboardError(`${label} must contain valid JSON`);
  }
}

async function readManifestSnapshot(manifestPath) {
  const { text, signature } = await readBoundedFile(manifestPath, 'Manifest');
  const state = parseJson(text, 'Manifest');
  validateManifest(state);
  return { state, signature };
}

async function writeAtomic(filePath, content, overwrite = true) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle;

  try {
    await mkdir(directory, { recursive: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (overwrite) {
      await rename(temporary, filePath);
    } else {
      try {
        await link(temporary, filePath);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new DashboardError(`Refusing to overwrite existing file: ${filePath}`);
        }
        throw error;
      }
      await unlink(temporary);
    }
  } catch (error) {
    throw fileError(error, filePath, 'Output', 'write');
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function initSwarm(options) {
  const directory = resolvePath(options.dir ?? '.swarm', '--dir');
  const name = boundedString(options.name, '--name');
  const goal = boundedString(options.goal, '--goal');
  const manifestPath = path.join(directory, 'swarm.json');
  const ignorePath = path.join(directory, '.gitignore');
  const overwrite = options.force === true;

  await mkdir(directory, { recursive: true });
  if (!overwrite) {
    for (const target of [ignorePath, manifestPath]) {
      try {
        await lstat(target);
        throw new DashboardError(`Refusing to overwrite existing file: ${target}`);
      } catch (error) {
        if (error instanceof DashboardError) throw error;
        if (error?.code !== 'ENOENT') throw fileError(error, target, 'Output', 'inspect');
      }
    }
  }

  const now = new Date().toISOString();
  const manifest = {
    version: 1,
    name,
    goal,
    startedAt: now,
    updatedAt: now,
    tasks: [],
    agents: [],
    events: [],
  };
  validateManifest(manifest);

  await writeAtomic(ignorePath, '*\n!.gitignore\n', overwrite);
  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, overwrite);
  return { ok: true, dir: directory, manifest: manifestPath };
}

async function validateSwarm(options) {
  const directory = resolvePath(options.dir ?? '.swarm', '--dir');
  const manifestPath = path.join(directory, 'swarm.json');
  const { state } = await readManifestSnapshot(manifestPath);
  return {
    ok: true,
    valid: true,
    manifest: manifestPath,
    tasks: state.tasks.length,
    agents: state.agents.length,
    events: state.events.length,
  };
}

function escapeJsonForScript(value) {
  const escapes = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return JSON.stringify(value, null, 2).replace(
    /[<>&\u2028\u2029]/g,
    (character) => escapes[character]
  );
}

function renderTemplate(template, state) {
  const first = template.indexOf(STATE_TOKEN);
  if (first === -1 || first !== template.lastIndexOf(STATE_TOKEN)) {
    throw new DashboardError('Dashboard template must contain exactly one __SWARM_STATE__ token');
  }

  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let validPlacement = false;
  for (const match of template.matchAll(scriptPattern)) {
    const tokenOffset = match[2].indexOf(STATE_TOKEN);
    if (tokenOffset === -1) continue;
    const jsonType =
      /(?:^|\s)type\s*=\s*(?:"application\/json"|'application\/json'|application\/json)(?=\s|$)/i;
    if (jsonType.test(match[1])) {
      validPlacement = true;
      break;
    }
  }
  if (!validPlacement) {
    throw new DashboardError(
      'Dashboard template must place __SWARM_STATE__ inside a JSON script tag'
    );
  }

  return template.replace(STATE_TOKEN, escapeJsonForScript(state));
}

async function renderDashboard(options) {
  const directory = resolvePath(options.dir ?? '.swarm', '--dir');
  const output = resolvePath(options.output ?? path.join(directory, 'dashboard.html'), '--output');
  const { state } = await readManifestSnapshot(path.join(directory, 'swarm.json'));
  const { text: template } = await readBoundedFile(TEMPLATE_PATH, 'Dashboard template');
  const html = renderTemplate(template, state);
  await writeAtomic(output, html);
  return { ok: true, output };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, html) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function hostForUrl(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

async function serveDashboard(options) {
  const directory = resolvePath(options.dir ?? '.swarm', '--dir');
  const host = boundedString(options.host ?? '127.0.0.1', '--host', 253);
  const rawPort = options.port ?? '4177';
  if (!/^\d+$/.test(rawPort)) throw new DashboardError('--port must be an integer from 0 to 65535');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new DashboardError('--port must be an integer from 0 to 65535');
  }

  const manifestPath = path.join(directory, 'swarm.json');
  const initial = await readManifestSnapshot(manifestPath);
  const { text: template } = await readBoundedFile(TEMPLATE_PATH, 'Dashboard template');
  const html = renderTemplate(template, initial.state);
  const clients = new Set();
  let currentState = initial.state;
  let currentError;
  let lastSignature = initial.signature;
  let lastStatError;
  let pollInFlight = false;
  let shuttingDown = false;

  function writeToClient(res, chunk) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      return;
    }
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
      res.destroy();
    }
  }

  function sendEvent(res, type, data) {
    writeToClient(res, `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(type, data) {
    for (const res of clients) sendEvent(res, type, data);
  }

  async function pollManifest() {
    if (pollInFlight || shuttingDown) return;
    pollInFlight = true;
    try {
      let observedSignature;
      try {
        const info = await stat(manifestPath, { bigint: true });
        if (!info.isFile()) throw new DashboardError(`Manifest is not a file: ${manifestPath}`);
        observedSignature = signatureFrom(info);
      } catch (error) {
        const message = errorMessage(error);
        if (message !== lastStatError) {
          lastStatError = message;
          lastSignature = undefined;
          currentError = message;
          broadcast('error', { error: message });
        }
        return;
      }

      lastStatError = undefined;
      if (observedSignature === lastSignature) return;

      try {
        const snapshot = await readManifestSnapshot(manifestPath);
        if (snapshot.signature === lastSignature) return;
        currentState = snapshot.state;
        currentError = undefined;
        lastSignature = snapshot.signature;
        broadcast('state', currentState);
      } catch (error) {
        lastSignature = observedSignature;
        currentError = errorMessage(error);
        broadcast('error', { error: currentError });
      }
    } finally {
      pollInFlight = false;
    }
  }

  async function handleRequest(req, res) {
    res.on('error', () => {});
    const queryIndex = (req.url ?? '/').indexOf('?');
    const pathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);
    const knownRoute = ['/', '/dashboard.html', '/api/state', '/api/events'].includes(pathname);

    if (!knownRoute) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return;
    }
    if (pathname === '/' || pathname === '/dashboard.html') {
      sendHtml(res, html);
      return;
    }
    if (pathname === '/api/events') {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      clients.add(res);
      sendEvent(res, 'state', currentState);
      if (currentError) sendEvent(res, 'error', { error: currentError });
      res.on('close', () => clients.delete(res));
      return;
    }

    try {
      const { state } = await readManifestSnapshot(manifestPath);
      sendJson(res, 200, state);
    } catch (error) {
      sendJson(res, 503, { error: errorMessage(error) });
    }
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(error) });
      else res.destroy();
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${hostForUrl(host)}:${actualPort}`;
  const pollTimer = setInterval(() => {
    void pollManifest();
  }, POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    for (const res of clients) writeToClient(res, ': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  function shutdown() {
    if (shuttingDown) {
      process.exit(0);
      return;
    }
    shuttingDown = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    for (const res of clients) res.end();
    clients.clear();
    server.close(() => {
      process.stdout.write(`${JSON.stringify({ ok: true, message: 'server stopped' })}\n`);
    });
    server.closeIdleConnections?.();
    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 5_000);
    forceTimer.unref();
  }

  server.on('error', (error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`);
    shutdown();
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdout.write(`${JSON.stringify({ ok: true, url, dir: directory })}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let result;
  switch (options.command) {
    case 'help':
      process.stdout.write(`${HELP}\n`);
      return;
    case 'init':
      result = await initSwarm(options);
      break;
    case 'validate':
      result = await validateSwarm(options);
      break;
    case 'render':
      result = await renderDashboard(options);
      break;
    case 'serve':
      await serveDashboard(options);
      return;
    default:
      throw new DashboardError(`Unknown command: ${options.command}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`);
  process.exitCode = 1;
});
