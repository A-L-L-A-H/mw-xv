#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const PUBLIC_DIR = path.join(SCRIPT_DIR, 'public');
const VENDOR_P5_PATH = path.join(REPO_ROOT, 'vendor', 'p5', 'p5.min.js');
const MW_ASSETS_DIR = path.join(REPO_ROOT, 'packages', 'assets');
const MW_ART_DIR = path.join(REPO_ROOT, 'raw_arts', 'art');
const DEFAULT_HOME_DIR = os.homedir();

const HEAD_CHUNK_BYTES = 32 * 1024;
const TAIL_CHUNK_BYTES = 192 * 1024;
const DETAIL_TAIL_BYTES = 512 * 1024;
const ACTIVE_THRESHOLD_MS = 120_000;
const RECENT_THRESHOLD_MS = 15 * 60_000;
const SSE_TICK_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const PROBE_INTERVAL_MS = 10_000;
const GIT_INTERVAL_MS = 4_000;
const TELEMETRY_HISTORY_LIMIT = 120;

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const MIME_BY_EXT = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
});

const ALLOWED_ASSET_EXTS = new Set(['.webp', '.png', '.svg', '.woff2', '.wav']);
const ALLOWED_ART_EXTS = new Set(['.webp', '.png']);

const DEFAULT_VPS_PROBES = Object.freeze([
  { id: 'vps-ip-readyz', label: 'VPS IP :8000 /readyz', url: 'http://163.61.134.104:8000/readyz' },
  {
    id: 'vps-ip-setup',
    label: 'VPS IP :8000 /auth/setup-status',
    url: 'http://163.61.134.104:8000/auth/setup-status',
  },
  {
    id: 'vps-apps-tls',
    label: 'HTTPS apps.moonwitness.biz.id',
    url: 'https://apps.moonwitness.biz.id/readyz',
  },
  {
    id: 'vps-wa-tls',
    label: 'HTTPS wa.apps.moonwitness.biz.id',
    url: 'https://wa.apps.moonwitness.biz.id/readyz',
  },
]);

const LOCAL_PORTS = Object.freeze([
  { port: 3000, label: 'API / Dev :3000' },
  { port: 3001, label: 'API :3001' },
  { port: 3425, label: 'Magpie Gateway :3425' },
  { port: 4174, label: 'Board :4174' },
  { port: 4190, label: 'Observatory :4190' },
  { port: 4242, label: 'Desktop Sidecar :4242' },
  { port: 5173, label: 'Vite :5173' },
  { port: 5432, label: 'Postgres :5432' },
  { port: 6379, label: 'Redis :6379' },
  { port: 8000, label: 'Bootstrap :8000' },
]);

const RUNTIME_LABELS = Object.freeze({
  antigravity: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  magpie: 'Magpie Router',
  qoder: 'Qoder',
  'gemini-cli': 'Gemini CLI',
  'visual-swarm': 'Visual Swarm',
});

export function parseArgs(argv) {
  const options = {
    host: process.env.OBSERVATORY_HOST || '127.0.0.1',
    port: Number(process.env.OBSERVATORY_PORT || process.env.PORT || 4190),
    repo: process.env.OBSERVATORY_REPO || REPO_ROOT,
  };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = argv[idx];
    if (token === '--host' && argv[idx + 1]) {
      options.host = argv[++idx];
    } else if (token === '--port' && argv[idx + 1]) {
      options.port = Number(argv[++idx]);
    } else if (token === '--repo' && argv[idx + 1]) {
      options.repo = path.resolve(argv[++idx]);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    options.port = 4190;
  }
  return options;
}

export function redactSecrets(inputText) {
  if (typeof inputText !== 'string') return '';
  return inputText
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/g,
      '[REDACTED]'
    )
    .replace(
      /((?:PASSWORD|SECRET|TOKEN|API_KEY|CSRF_TOKEN|DATABASE_URL|POSTGRES_PASSWORD)\s*[:=]\s*)(["']?)[^\s"',;}\n]+\2/gi,
      '$1[REDACTED]'
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1[REDACTED]$2');
}

export function clip(rawText, maxLen = 180) {
  if (typeof rawText !== 'string') return '';
  const cleaned = redactSecrets(rawText).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

export function safeJsonParse(line) {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function validateProbeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { valid: false, reason: 'URL is required' };
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'Invalid URL syntax' };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, reason: 'Only http:// and https:// URLs are permitted' };
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === '0.0.0.0' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('fd') ||
    hostname.includes('169.254.169.254')
  ) {
    return { valid: false, reason: 'Blocked link-local or cloud metadata host' };
  }
  return { valid: true, normalizedUrl: parsedUrl.href };
}

async function readHeadAndTailLines(filePath, fileSize, tailBytes = TAIL_CHUNK_BYTES) {
  let fileHandle;
  try {
    fileHandle = await open(filePath, 'r');
    if (fileSize <= HEAD_CHUNK_BYTES + tailBytes) {
      const fullBuf = Buffer.alloc(fileSize);
      const { bytesRead } = await fileHandle.read(fullBuf, 0, fileSize, 0);
      const fullText = fullBuf.toString('utf8', 0, bytesRead);
      const lines = fullText.split(/\r?\n/).filter(Boolean);
      return { headLines: lines, tailLines: lines, full: true };
    }

    const headBuf = Buffer.alloc(HEAD_CHUNK_BYTES);
    const headRead = await fileHandle.read(headBuf, 0, HEAD_CHUNK_BYTES, 0);
    const headRaw = headBuf.toString('utf8', 0, headRead.bytesRead);
    const headSplit = headRaw.split(/\r?\n/);
    if (headSplit.length > 1) headSplit.pop();

    const tailStart = Math.max(0, fileSize - tailBytes);
    const tailLen = fileSize - tailStart;
    const tailBuf = Buffer.alloc(tailLen);
    const tailRead = await fileHandle.read(tailBuf, 0, tailLen, tailStart);
    const tailRaw = tailBuf.toString('utf8', 0, tailRead.bytesRead);
    const tailSplit = tailRaw.split(/\r?\n/);
    if (tailStart > 0 && tailSplit.length > 1) tailSplit.shift();

    return {
      headLines: headSplit.filter(Boolean),
      tailLines: tailSplit.filter(Boolean),
      full: false,
    };
  } catch {
    return { headLines: [], tailLines: [], full: false };
  } finally {
    if (fileHandle) await fileHandle.close().catch(() => {});
  }
}

function normalizePathSlashes(rawPath) {
  return typeof rawPath === 'string' ? rawPath.replace(/\\/g, '/') : '';
}

function matchesWorkspace(cwd, repoRoot) {
  if (!cwd || !repoRoot) return false;
  const left = normalizePathSlashes(cwd)
    .toLowerCase()
    .replace(/^file:\/\/\//, '');
  const right = normalizePathSlashes(repoRoot).toLowerCase();
  const repoName = path.basename(right);
  return left.includes(right) || left.endsWith(`/${repoName}`) || left.includes(`/${repoName}-`);
}

function deriveStatus(mtimeMs, explicitRunState, hasRecentError, nowMs = Date.now()) {
  if (explicitRunState === 'RUN_STATE_RUNNING') return 'running';
  if (explicitRunState === 'RUN_STATE_CANCELLING') return 'running';
  const ageMs = nowMs - mtimeMs;
  if (ageMs <= ACTIVE_THRESHOLD_MS) return 'running';
  if (hasRecentError && ageMs <= RECENT_THRESHOLD_MS) return 'error';
  if (ageMs <= RECENT_THRESHOLD_MS) return 'recent';
  return 'idle';
}

function parseAntigravityArg(rawValue) {
  if (typeof rawValue !== 'string') return rawValue;
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue.slice(1, -1);
    }
  }
  return rawValue;
}

function bumpCounter(counterMap, key, amount = 1) {
  if (!key) return;
  counterMap[key] = (counterMap[key] || 0) + amount;
}

// ============================================================================
// 1. PLAN PARSER & DEPENDENCY DAG BUILDER (.plan/*.md + wave playbooks)
// ============================================================================

export function parseWavePlaybookDetails(markdown, playbookName, detailMap) {
  const sections = markdown.split(/\r?\n(?=#{2,4}\s+(?:-\s+)?\[[ xX]\]\s+[A-Z]\d{2,3}\b)/);
  for (const section of sections) {
    const header = section.match(/^#{2,4}\s+(?:-\s+)?\[[ xX]\]\s+([A-Z]\d{2,3})\s*[—-]\s*(.+)/);
    if (!header) continue;
    const taskId = header[1].trim();
    const extractBlock = (labelRegex) => {
      const blockPattern = new RegExp(
        `^-\\s+\\*\\*${labelRegex}:\\*\\*([\\s\\S]*?)(?=\\n-\\s+\\*\\*[A-Za-z]|\\n---|$)`,
        'm'
      );
      const matched = section.match(blockPattern);
      if (!matched) return '';
      return matched[1]
        .replace(/```[a-z]*\r?\n?/gi, ' ')
        .replace(/```/g, ' ')
        .trim();
    };
    const ownerFiles = clip(extractBlock('Owner File(?:\\(s\\)|\\s*\\([^)]+\\))?'), 260);
    const dependsOn = clip(extractBlock('Depends On'), 200);
    const acceptance = clip(extractBlock('Acceptance Criteria'), 380);
    const expected = clip(extractBlock('Expected Output'), 260);
    const verify = clip(extractBlock('Verify'), 320);
    const spec = clip(extractBlock('Exact Spec'), 700);

    detailMap.set(taskId, {
      playbook: playbookName,
      ownerFiles,
      dependsOn,
      acceptance,
      expected,
      verify,
      spec,
    });
  }
}

export function extractTaskDependencies(dependsOnText, validTaskIds) {
  if (!dependsOnText || /^none$/i.test(dependsOnText.trim())) return [];
  const discovered = new Set();
  const rangePattern = /\b([A-Z])(\d{2,3})\s*[–—-]\s*\1(\d{2,3})\b/g;
  for (const rangeMatch of dependsOnText.matchAll(rangePattern)) {
    const prefix = rangeMatch[1];
    const startNum = Number(rangeMatch[2]);
    const endNum = Number(rangeMatch[3]);
    const padLen = rangeMatch[2].length;
    if (
      Number.isInteger(startNum) &&
      Number.isInteger(endNum) &&
      endNum >= startNum &&
      endNum - startNum <= 30
    ) {
      for (let num = startNum; num <= endNum; num += 1) {
        const candidateId = `${prefix}${String(num).padStart(padLen, '0')}`;
        if (validTaskIds.has(candidateId)) discovered.add(candidateId);
      }
    }
  }
  const singlePattern = /\b([A-Z]\d{2,3})\b/g;
  for (const singleMatch of dependsOnText.matchAll(singlePattern)) {
    const candidateId = singleMatch[1];
    if (validTaskIds.has(candidateId)) discovered.add(candidateId);
  }
  return Array.from(discovered);
}

function parseInlineMasterTaskDetails(markdown, detailMap) {
  const headingBlocks = markdown.split(/\r?\n(?=####\s+-\s+\[[ xX]\]\s+[A-Z]\d{2,3}\b)/);
  for (const block of headingBlocks) {
    const header = block.match(/^####\s+-\s+\[[ xX]\]\s+([A-Z]\d{2,3})\s*[—-]\s*(.+)/);
    if (!header) continue;
    const taskId = header[1].trim();
    if (detailMap.has(taskId)) continue;
    const extractField = (label) => {
      const fieldPattern = new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm');
      const matched = block.match(fieldPattern);
      return matched ? matched[1].trim() : '';
    };
    const specMatch = block.match(
      /-\s+\*\*Exact Spec:\*\*([\s\S]*?)(?=\n-\s+\*\*(?:Acceptance Criteria|Expected Output|Verify|Commit):|$)/
    );
    detailMap.set(taskId, {
      playbook: 'inline-master',
      ownerFiles: extractField('Owner File\\(s\\)'),
      dependsOn: extractField('Depends On'),
      acceptance: extractField('Acceptance Criteria'),
      expected: extractField('Expected Output'),
      verify: extractField('Verify'),
      spec: specMatch ? clip(specMatch[1], 700) : '',
    });
  }
}

export function buildPlanDag(tasks, waves, activeSessions = [], dirtyFiles = []) {
  const validTaskIds = new Set(tasks.map((taskEntry) => taskEntry.id));
  const taskById = new Map(tasks.map((taskEntry) => [taskEntry.id, taskEntry]));
  const waveIndexByTitle = new Map(waves.map((waveEntry, idx) => [waveEntry.title, idx]));

  // Active hints from running sessions & dirty files
  const activeTextBlob = activeSessions
    .filter((session) => session.status === 'running')
    .map((session) => `${session.title} ${session.focus} ${session.lastTool}`.toLowerCase())
    .join(' ');
  const dirtyPathList = dirtyFiles.map((fileEntry) => fileEntry.path.toLowerCase());

  const edges = [];
  const dependentsById = new Map();
  for (const taskEntry of tasks) {
    dependentsById.set(taskEntry.id, []);
  }

  for (let idx = 0; idx < tasks.length; idx += 1) {
    const taskEntry = tasks[idx];
    let depIds = extractTaskDependencies(taskEntry.dependsOn, validTaskIds).filter(
      (depId) => depId !== taskEntry.id
    );
    // Fallback within-wave sequential dependency if explicit Depends On was empty and previous task is in the same wave
    if (
      depIds.length === 0 &&
      !taskEntry.dependsOn &&
      idx > 0 &&
      tasks[idx - 1].wave === taskEntry.wave
    ) {
      depIds = [tasks[idx - 1].id];
    }
    taskEntry.depIds = depIds;
    for (const depId of depIds) {
      edges.push({
        from: depId,
        to: taskEntry.id,
        satisfied: Boolean(taskById.get(depId)?.done),
      });
      dependentsById.get(depId)?.push(taskEntry.id);
    }
  }

  // Compute topological depth (memoized, cycle-safe)
  const depthMemo = new Map();
  const visiting = new Set();
  const computeDepth = (taskId) => {
    if (depthMemo.has(taskId)) return depthMemo.get(taskId);
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const taskEntry = taskById.get(taskId);
    let maxParentDepth = -1;
    for (const depId of taskEntry?.depIds || []) {
      maxParentDepth = Math.max(maxParentDepth, computeDepth(depId));
    }
    visiting.delete(taskId);
    const depth = maxParentDepth + 1;
    depthMemo.set(taskId, depth);
    return depth;
  };

  let doneCount = 0;
  let activeCount = 0;
  let readyCount = 0;
  let blockedCount = 0;

  const nodes = tasks.map((taskEntry, orderIndex) => {
    const depsDone = taskEntry.depIds.every((depId) => taskById.get(depId)?.done);
    const idToken = taskEntry.id.toLowerCase();
    const mentionedInRunning = new RegExp(`\\b${idToken}\\b`, 'i').test(activeTextBlob);
    const ownerTokens = (taskEntry.ownerFiles || '')
      .replace(/`/g, '')
      .split(/[,;]+/)
      .map((token) =>
        token
          .trim()
          .replace(/\/\*+$/, '')
          .toLowerCase()
      )
      .filter((token) => token.length >= 6);
    const ownerDirty = ownerTokens.some((ownerToken) =>
      dirtyPathList.some((dirtyPath) => dirtyPath.includes(ownerToken))
    );

    let dagState;
    if (taskEntry.done) {
      dagState = 'done';
      doneCount += 1;
    } else if (mentionedInRunning || (depsDone && ownerDirty)) {
      dagState = 'active';
      activeCount += 1;
    } else if (depsDone) {
      dagState = 'ready';
      readyCount += 1;
    } else {
      dagState = 'blocked';
      blockedCount += 1;
    }

    taskEntry.dagState = dagState;
    taskEntry.dependents = dependentsById.get(taskEntry.id) || [];

    return {
      id: taskEntry.id,
      title: taskEntry.title,
      wave: taskEntry.wave,
      waveIndex: waveIndexByTitle.get(taskEntry.wave) ?? 0,
      orderIndex,
      depth: computeDepth(taskEntry.id),
      state: dagState,
      done: taskEntry.done,
      depIds: taskEntry.depIds,
      dependents: taskEntry.dependents,
      commitSha: taskEntry.commitSha,
      ownerFiles: taskEntry.ownerFiles,
    };
  });

  // Compute longest remaining pending path (critical path)
  const pendingIds = new Set(nodes.filter((node) => !node.done).map((node) => node.id));
  const chainMemo = new Map();
  const longestPendingChain = (taskId) => {
    if (chainMemo.has(taskId)) return chainMemo.get(taskId);
    let bestTail = [];
    for (const nextId of dependentsById.get(taskId) || []) {
      if (!pendingIds.has(nextId)) continue;
      const tail = longestPendingChain(nextId);
      if (tail.length > bestTail.length) bestTail = tail;
    }
    const chain = [taskId, ...bestTail];
    chainMemo.set(taskId, chain);
    return chain;
  };

  let criticalPathIds = [];
  for (const node of nodes) {
    if (node.state === 'ready' || node.state === 'active') {
      const candidate = longestPendingChain(node.id);
      if (candidate.length > criticalPathIds.length) {
        criticalPathIds = candidate;
      }
    }
  }

  return {
    nodes,
    edges,
    criticalPathIds,
    stats: {
      done: doneCount,
      active: activeCount,
      ready: readyCount,
      blocked: blockedCount,
    },
  };
}

export async function collectPlans(repoRoot) {
  const planDir = path.join(repoRoot, '.plan');
  if (!existsSync(planDir)) return { plans: [], defaultPlanId: null };

  const entries = await readdir(planDir, { withFileTypes: true }).catch(() => []);
  const mdFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  const plans = [];

  for (const fileName of mdFiles) {
    const planId = fileName.replace(/\.md$/i, '');
    const masterPath = path.join(planDir, fileName);
    const content = await readFile(masterPath, 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/);

    const titleLine = lines.find((line) => line.startsWith('# ')) || `# ${planId}`;
    const title = titleLine.replace(/^#\s+/, '').trim();

    const subDir = path.join(planDir, planId);
    const waveDetailsByTask = new Map();
    const waveFiles = [];

    if (existsSync(subDir)) {
      const subEntries = await readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const subEntry of subEntries) {
        if (!subEntry.isFile() || !subEntry.name.endsWith('.md')) continue;
        waveFiles.push(subEntry.name);
        if (subEntry.name.startsWith('ADR-')) continue;
        const waveText = await readFile(path.join(subDir, subEntry.name), 'utf8').catch(() => '');
        parseWavePlaybookDetails(waveText, subEntry.name, waveDetailsByTask);
      }
    }

    // Also parse inline task blocks from master file (e.g. #### - [ ] D01 — ...)
    parseInlineMasterTaskDetails(content, waveDetailsByTask);

    const waves = [];
    let currentWave = null;
    const tasks = [];

    for (const rawLine of lines) {
      const waveMatch = rawLine.match(/^###\s+(.+)$/);
      if (waveMatch) {
        currentWave = {
          title: waveMatch[1].trim(),
          done: 0,
          total: 0,
          tasks: [],
        };
        waves.push(currentWave);
        continue;
      }

      const bulletTaskMatch = rawLine.match(
        /^\s*-\s+\[([ xX])\]\s+\*\*([A-Za-z0-9_-]+)\*\*\s*[—-]\s*(.+)$/
      );
      const headingTaskMatch = rawLine.match(
        /^####\s+-\s+\[([ xX])\]\s+([A-Za-z0-9_-]+)\s*[—-]\s*(.+)$/
      );
      const taskMatch = bulletTaskMatch || headingTaskMatch;

      if (taskMatch) {
        const done = taskMatch[1].toLowerCase() === 'x';
        const taskId = taskMatch[2].trim();
        const taskTitle = taskMatch[3].trim();
        const detail = waveDetailsByTask.get(taskId) || {};
        const taskObj = {
          id: taskId,
          title: taskTitle,
          done,
          wave: currentWave ? currentWave.title : 'General',
          playbook: detail.playbook || null,
          ownerFiles: detail.ownerFiles || '',
          dependsOn: detail.dependsOn || '',
          depIds: [],
          dependents: [],
          dagState: done ? 'done' : 'pending',
          acceptance: detail.acceptance || '',
          expected: detail.expected || '',
          verify: detail.verify || '',
          spec: detail.spec || '',
          commitSha: null,
          commitSubject: null,
        };
        tasks.push(taskObj);
        if (currentWave) {
          currentWave.tasks.push(taskObj);
          currentWave.total += 1;
          if (done) currentWave.done += 1;
        }
      }
    }

    const doneCount = tasks.filter((taskEntry) => taskEntry.done).length;
    const nextTask = tasks.find((taskEntry) => !taskEntry.done) || null;
    const fileStat = await stat(masterPath).catch(() => null);

    plans.push({
      id: planId,
      title,
      masterFile: `.plan/${fileName}`,
      waveFiles,
      updatedAt: fileStat ? new Date(fileStat.mtimeMs).toISOString() : null,
      total: tasks.length,
      done: doneCount,
      percent: tasks.length > 0 ? Math.round((doneCount / tasks.length) * 1000) / 10 : 0,
      nextTaskId: nextTask ? nextTask.id : null,
      nextTaskTitle: nextTask ? nextTask.title : null,
      waves: waves.map((waveEntry) => ({
        title: waveEntry.title,
        done: waveEntry.done,
        total: waveEntry.total,
        percent: waveEntry.total > 0 ? Math.round((waveEntry.done / waveEntry.total) * 100) : 0,
      })),
      tasks,
      dag: null,
    });
  }

  plans.sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
  const preferred =
    plans.find((planEntry) => planEntry.id === 'coolify-sovereign-paas-single-db') ||
    plans[0] ||
    null;
  return { plans, defaultPlanId: preferred ? preferred.id : null };
}

// ============================================================================
// 2. ANTIGRAVITY COLLECTOR (ConversationService API + brain/transcripts + swarm)
// ============================================================================

async function callConversationService(method, body, timeoutMs = 5000) {
  const address = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!address || !csrfToken) return null;

  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const httpResponse = await fetch(`http://${address}/product.v1.ConversationService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrfToken,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!httpResponse.ok) return null;
    return await httpResponse.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function scanFullTranscriptForSubagents(filePath, fileStat, kind, subagentScanCache) {
  const cacheKey = `${kind}:${filePath}`;
  const cached = subagentScanCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  if (fileStat.size > 25 * 1024 * 1024) {
    const emptyList = [];
    subagentScanCache.set(cacheKey, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      value: emptyList,
    });
    return emptyList;
  }

  const rawText = await readFile(filePath, 'utf8').catch(() => '');
  const found = [];
  const seen = new Set();

  for (const line of rawText.split(/\r?\n/)) {
    if (!line) continue;
    if (kind === 'ag') {
      if (!line.includes('"invoke_subagent"') && !line.includes('"name":"swarm"')) continue;
      const record = safeJsonParse(line);
      if (!record || !Array.isArray(record.tool_calls)) continue;
      for (const toolCall of record.tool_calls) {
        if (!toolCall) continue;
        const callArgs = toolCall.args || {};
        if (toolCall.name === 'invoke_subagent') {
          const role = clip(
            String(parseAntigravityArg(callArgs.Role || callArgs.TypeName || 'subagent')),
            70
          );
          const typeName = clip(String(parseAntigravityArg(callArgs.TypeName || 'subagent')), 40);
          const subModel = clip(String(parseAntigravityArg(callArgs.Model || 'inherit')), 30);
          const dedupeKey = `sub:${role}:${typeName}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            found.push({
              id: `sub-${record.step_index ?? found.length}`,
              role,
              type: typeName,
              model: subModel,
              status: 'done',
              at: record.created_at || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        } else if (
          toolCall.name === 'swarm' &&
          String(parseAntigravityArg(callArgs.action || '')) === 'add'
        ) {
          const workerName = clip(String(parseAntigravityArg(callArgs.name || 'worker')), 40);
          const workerModel = clip(String(parseAntigravityArg(callArgs.model || 'inherit')), 30);
          const dedupeKey = `swarm:${workerName}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            found.push({
              id: `swarm-${workerName}`,
              role: workerName,
              type: 'swarm-worker',
              model: workerModel,
              status: 'done',
              at: record.created_at || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        }
      }
    } else if (kind === 'claude') {
      if (!line.includes('"name":"Agent"') && !line.includes('"name":"Task"')) continue;
      const record = safeJsonParse(line);
      const blocks = Array.isArray(record?.message?.content) ? record.message.content : [];
      for (const block of blocks) {
        if (
          block &&
          block.type === 'tool_use' &&
          (block.name === 'Agent' || block.name === 'Task')
        ) {
          const role = clip(
            String(block.input?.description || block.input?.subagent_type || 'Claude Subagent'),
            70
          );
          const typeName = clip(String(block.input?.subagent_type || 'general-purpose'), 40);
          const dedupeKey = `${block.id || role}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            found.push({
              id: block.id || `claude-sub-${found.length}`,
              role,
              type: typeName,
              model: clip(String(block.input?.model || record.message?.model || 'inherit'), 40),
              status: 'done',
              at: record.timestamp || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        }
      }
    }
  }

  subagentScanCache.set(cacheKey, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: found });
  return found;
}

async function parseAntigravityTranscript(
  convId,
  transcriptPath,
  fileStat,
  fileParseCache,
  detailMode = false
) {
  const cacheKey = `ag:${transcriptPath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    transcriptPath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES
  );

  let title = '';
  let model = '';
  let focus = '';
  let lastAction = '';
  let lastTool = '';
  let lastError = '';
  let inputTokens = 0;
  let cacheTokens = 0;
  let outputTokens = 0;
  let stepCount = 0;
  let errorCount = 0;
  let hasRecentError = false;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const subagents = [];
  const events = [];
  const toolCounts = {};

  for (const line of headLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (!title && record.type === 'USER_INPUT' && typeof record.content === 'string') {
      const reqMatch = record.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
      const rawPrompt = reqMatch ? reqMatch[1] : record.content;
      title = clip(rawPrompt.replace(/^#+\s*/gm, ''), 95);
    }
    if (!model && record.model) model = record.model;
  }

  const seenSub = new Set();
  for (const line of tailLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (typeof record.step_index === 'number')
      stepCount = Math.max(stepCount, record.step_index + 1);
    if (record.created_at) lastTimestamp = record.created_at;
    if (record.model) model = record.model;
    if (typeof record.input_tokens === 'number') inputTokens += record.input_tokens;
    if (typeof record.cache_read_tokens === 'number') cacheTokens += record.cache_read_tokens;
    if (typeof record.output_tokens === 'number') outputTokens += record.output_tokens;

    if (record.status === 'ERROR' || record.error) {
      hasRecentError = true;
      errorCount += 1;
      lastError = clip(record.error || record.content || 'Step error', 160);
      events.push({
        at: record.created_at || lastTimestamp,
        kind: 'error',
        tool: 'error',
        summary: lastError,
      });
    }

    if (Array.isArray(record.tool_calls)) {
      for (const toolCall of record.tool_calls) {
        if (!toolCall || !toolCall.name) continue;
        const callArgs = toolCall.args || {};
        lastTool = toolCall.name;
        bumpCounter(toolCounts, toolCall.name);
        if (toolCall.name === 'update_focus' && callArgs.focus) {
          focus = clip(String(parseAntigravityArg(callArgs.focus)), 120);
          lastAction = focus;
          events.push({
            at: record.created_at || lastTimestamp,
            kind: 'focus',
            tool: 'update_focus',
            summary: focus,
          });
        } else if (toolCall.name === 'invoke_subagent') {
          const role = clip(
            String(parseAntigravityArg(callArgs.Role || callArgs.TypeName || 'subagent')),
            60
          );
          const typeName = clip(String(parseAntigravityArg(callArgs.TypeName || 'subagent')), 40);
          const subModel = clip(String(parseAntigravityArg(callArgs.Model || 'inherit')), 30);
          const subKey = `${typeName}:${role}:${record.step_index}`;
          if (!seenSub.has(subKey)) {
            seenSub.add(subKey);
            subagents.push({
              id: `${convId.slice(0, 8)}-s${record.step_index}`,
              role,
              type: typeName,
              model: subModel,
              status: 'done',
              at: record.created_at || lastTimestamp,
            });
          }
          lastAction = `Spawned subagent: ${role} (${typeName})`;
          events.push({
            at: record.created_at || lastTimestamp,
            kind: 'subagent',
            tool: 'invoke_subagent',
            summary: lastAction,
          });
        } else if (toolCall.name === 'swarm') {
          const action = String(parseAntigravityArg(callArgs.action || 'swarm'));
          const workerName = String(parseAntigravityArg(callArgs.name || ''));
          const summary = workerName ? `swarm ${action}: ${workerName}` : `swarm ${action}`;
          lastAction = clip(summary, 120);
          events.push({
            at: record.created_at || lastTimestamp,
            kind: 'swarm',
            tool: 'swarm',
            summary: lastAction,
          });
        } else if (toolCall.name === 'run_command') {
          const summary = clip(
            String(
              parseAntigravityArg(callArgs.toolSummary || callArgs.CommandLine || 'run_command')
            ),
            120
          );
          lastAction = summary;
          events.push({
            at: record.created_at || lastTimestamp,
            kind: 'tool',
            tool: 'run_command',
            summary,
          });
        } else {
          const target = parseAntigravityArg(
            callArgs.Path || callArgs.query || callArgs.focus || ''
          );
          const summary = target ? `${toolCall.name} ${clip(String(target), 95)}` : toolCall.name;
          lastAction = summary;
          events.push({
            at: record.created_at || lastTimestamp,
            kind: 'tool',
            tool: toolCall.name,
            summary,
          });
        }
      }
    } else if (record.type === 'USER_INPUT' && typeof record.content === 'string') {
      const reqMatch = record.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
      const userPrompt = clip(reqMatch ? reqMatch[1] : record.content, 120);
      if (userPrompt) {
        events.push({
          at: record.created_at || lastTimestamp,
          kind: 'user',
          tool: 'user',
          summary: userPrompt,
        });
      }
    }
  }

  const parsedValue = {
    title,
    model,
    focus,
    lastAction,
    lastTool,
    lastError,
    errorCount,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    stepCount,
    lastTimestamp,
    subagents,
    toolCounts,
    events: events.slice(detailMode ? -80 : -40),
  };

  fileParseCache.set(cacheKey, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    value: parsedValue,
  });
  return parsedValue;
}

// ============================================================================
// 3. CLAUDE CODE COLLECTOR (~/.claude/projects/*/*.jsonl + subagents/)
// ============================================================================

async function parseClaudeSessionFile(
  sessionId,
  filePath,
  fileStat,
  projectDir,
  fileParseCache,
  detailMode = false
) {
  const cacheKey = `claude:${filePath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    filePath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES
  );

  let title = '';
  let model = '';
  let requestedModel = '';
  let cwd = '';
  let gitBranch = '';
  let lastAction = '';
  let lastTool = '';
  let lastError = '';
  let errorCount = 0;
  let hasRecentError = false;
  let inputTokens = 0;
  let cacheTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const subagentCalls = [];
  const events = [];
  const toolCounts = {};

  const customTitlePath = path.join(projectDir, sessionId, 'custom-title.json');
  if (existsSync(customTitlePath)) {
    const rawTitle = await readFile(customTitlePath, 'utf8').catch(() => '');
    const parsedTitle = safeJsonParse(rawTitle.trim());
    if (parsedTitle && parsedTitle.customTitle) {
      title = clip(parsedTitle.customTitle, 100);
    }
  }

  for (const line of headLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (!cwd && record.cwd) cwd = record.cwd;
    if (!gitBranch && record.gitBranch) gitBranch = record.gitBranch;
    if (!title && record.customTitle) title = clip(record.customTitle, 100);
    if (!title && record.type === 'user' && record.message?.content) {
      const contentValue = record.message.content;
      if (typeof contentValue === 'string') {
        const schedMatch = contentValue.match(/<scheduled-task\s+name="([^"]+)"/);
        title = schedMatch ? `Scheduled: ${schedMatch[1]}` : clip(contentValue, 95);
      }
    }
  }

  for (const line of tailLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (record.timestamp) lastTimestamp = record.timestamp;
    if (record.cwd) cwd = record.cwd;
    if (record.gitBranch) gitBranch = record.gitBranch;
    if (record.type === 'custom-title' && record.customTitle) title = clip(record.customTitle, 100);
    if (record.type === 'agent-name' && record.agentName && !title)
      title = clip(record.agentName, 100);
    if (record.requestedModel) requestedModel = record.requestedModel;

    if (record.type === 'assistant' && record.message) {
      turns += 1;
      if (record.message.model) model = record.message.model;
      const usage = record.message.usage;
      if (usage) {
        inputTokens += Number(usage.input_tokens || 0);
        cacheTokens +=
          Number(usage.cache_read_input_tokens || 0) +
          Number(usage.cache_creation_input_tokens || 0);
        outputTokens += Number(usage.output_tokens || 0);
      }
      const blocks = Array.isArray(record.message.content) ? record.message.content : [];
      for (const block of blocks) {
        if (!block) continue;
        if (block.type === 'tool_use') {
          lastTool = block.name || 'tool';
          bumpCounter(toolCounts, lastTool);
          const desc =
            block.input?.description ||
            block.input?.file_path ||
            block.input?.pattern ||
            block.input?.command ||
            block.input?.prompt ||
            '';
          const summary = desc ? `${lastTool}: ${clip(String(desc), 110)}` : lastTool;
          lastAction = summary;
          if (block.name === 'Agent' || block.name === 'Task') {
            subagentCalls.push({
              id: block.id || `sub-${turns}`,
              role: clip(
                String(block.input?.description || block.input?.subagent_type || 'Claude Subagent'),
                70
              ),
              type: clip(String(block.input?.subagent_type || 'general-purpose'), 40),
              model: clip(String(block.input?.model || model || 'inherit'), 40),
              status: 'done',
              at: record.timestamp || lastTimestamp,
            });
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'subagent',
              tool: block.name,
              summary,
            });
          } else {
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'tool',
              tool: lastTool,
              summary,
            });
          }
        } else if (block.type === 'thinking' && block.thinking) {
          const thought = clip(block.thinking, 120);
          if (thought) {
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'focus',
              tool: 'thinking',
              summary: thought,
            });
          }
        } else if (block.type === 'text' && block.text) {
          const textSnippet = clip(block.text, 120);
          if (textSnippet) {
            lastAction = textSnippet;
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'message',
              tool: 'assistant',
              summary: textSnippet,
            });
          }
        }
      }
    } else if (record.type === 'user' && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block && block.type === 'tool_result' && block.is_error) {
          hasRecentError = true;
          errorCount += 1;
          lastError = clip(typeof block.content === 'string' ? block.content : 'Tool error', 150);
          events.push({
            at: record.timestamp || lastTimestamp,
            kind: 'error',
            tool: 'tool_result',
            summary: lastError,
          });
        }
      }
    }
  }

  const subDir = path.join(projectDir, sessionId, 'subagents');
  if (existsSync(subDir)) {
    const subFiles = await readdir(subDir).catch(() => []);
    for (const subFile of subFiles.filter((name) => name.endsWith('.jsonl')).slice(0, 15)) {
      const subId = subFile.replace(/\.jsonl$/i, '');
      const subStat = await stat(path.join(subDir, subFile)).catch(() => null);
      if (!subagentCalls.some((subEntry) => subEntry.id === subId)) {
        subagentCalls.push({
          id: subId,
          role: subId,
          type: 'subagent-file',
          model: model || requestedModel || 'claude',
          status: subStat ? deriveStatus(subStat.mtimeMs, null, false) : 'idle',
          at: subStat ? new Date(subStat.mtimeMs).toISOString() : lastTimestamp,
        });
      }
    }
  }

  const parsedValue = {
    title: title || `Claude ${sessionId.slice(0, 8)}`,
    model: model || requestedModel || 'claude-code',
    cwd,
    gitBranch,
    lastAction,
    lastTool,
    lastError,
    errorCount,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    turns,
    lastTimestamp,
    subagents: subagentCalls,
    toolCounts,
    events: events.slice(detailMode ? -80 : -40),
  };

  fileParseCache.set(cacheKey, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    value: parsedValue,
  });
  return parsedValue;
}

// ============================================================================
// 4. CODEX & GENERIC JSONL COLLECTORS
// ============================================================================

async function walkJsonlFiles(dirPath, maxDepth, collected = [], depth = 0) {
  if (depth > maxDepth || !existsSync(dirPath)) return collected;
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(fullPath, maxDepth, collected, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat) collected.push({ fullPath, name: entry.name, stat: fileStat });
    }
  }
  return collected;
}

async function parseCodexRollout(filePath, fileStat, fileParseCache, detailMode = false) {
  const cacheKey = `codex:${filePath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    filePath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES
  );

  let sessionId = path.basename(filePath, '.jsonl');
  let title = '';
  let model = '';
  let cwd = '';
  let gitBranch = '';
  let originator = 'Codex';
  let goalStatus = '';
  let lastAction = '';
  let lastTool = '';
  let lastError = '';
  let errorCount = 0;
  let hasRecentError = false;
  let inputTokens = 0;
  let cacheTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let steps = 0;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const events = [];
  const toolCounts = {};

  for (const line of headLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (record.type === 'session_meta' && record.payload) {
      sessionId = record.payload.session_id || record.payload.id || sessionId;
      cwd = record.payload.cwd || cwd;
      originator = record.payload.originator || originator;
      gitBranch = record.payload.git?.branch || gitBranch;
      model = record.payload.base_instructions?.provenance?.model || model;
    } else if (record.type === 'event_msg' && record.payload?.type === 'thread_settings_applied') {
      model = record.payload.thread_settings?.model || model;
      cwd = record.payload.thread_settings?.cwd || cwd;
    } else if (record.type === 'event_msg' && record.payload?.type === 'thread_goal_updated') {
      if (record.payload.goal?.objective) title = clip(record.payload.goal.objective, 105);
      if (record.payload.goal?.status) goalStatus = record.payload.goal.status;
    }
  }

  for (const line of tailLines) {
    const record = safeJsonParse(line);
    if (!record) continue;
    if (record.timestamp) lastTimestamp = record.timestamp;
    if (typeof record.ordinal === 'number') steps = Math.max(steps, record.ordinal + 1);

    if (record.type === 'token_usage_record' && record.payload?.thread_token_usage) {
      const usage = record.payload.thread_token_usage;
      inputTokens = Number(usage.input_tokens || inputTokens);
      cacheTokens = Number(usage.cached_input_tokens || cacheTokens);
      outputTokens = Number(usage.output_tokens || outputTokens);
      totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
    } else if (record.type === 'event_msg' && record.payload) {
      const eventPayload = record.payload;
      if (eventPayload.type === 'token_count' && eventPayload.info?.total_token_usage) {
        const usage = eventPayload.info.total_token_usage;
        inputTokens = Number(usage.input_tokens || inputTokens);
        cacheTokens = Number(usage.cached_input_tokens || cacheTokens);
        outputTokens = Number(usage.output_tokens || outputTokens);
        totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
      } else if (eventPayload.type === 'thread_goal_updated' && eventPayload.goal) {
        if (eventPayload.goal.objective) title = clip(eventPayload.goal.objective, 105);
        if (eventPayload.goal.status) goalStatus = eventPayload.goal.status;
      } else if (eventPayload.type === 'item_completed' && eventPayload.item) {
        const completedEntry = eventPayload.item;
        if (completedEntry.type === 'AgentMessage') {
          const textPart = (completedEntry.content || []).find((chunk) => chunk.text)?.text || '';
          const summary = clip(textPart, 130);
          if (summary) {
            lastAction = summary;
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'message',
              tool: 'commentary',
              summary,
            });
          }
        } else if (completedEntry.type === 'CommandExecution') {
          const cmdText = Array.isArray(completedEntry.command)
            ? completedEntry.command.slice(-1)[0]
            : String(completedEntry.command || '');
          const failed =
            completedEntry.status === 'failed' ||
            (typeof completedEntry.exit_code === 'number' && completedEntry.exit_code !== 0);
          lastTool = 'exec_command';
          bumpCounter(toolCounts, lastTool);
          const summary = clip(cmdText, 115);
          lastAction = summary;
          if (failed) {
            hasRecentError = true;
            errorCount += 1;
            lastError = `exit=${completedEntry.exit_code ?? 1}: ${summary}`;
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'error',
              tool: 'exec_command',
              summary: lastError,
            });
          } else {
            events.push({
              at: record.timestamp || lastTimestamp,
              kind: 'tool',
              tool: 'exec_command',
              summary,
            });
          }
        }
      }
    } else if (record.type === 'response_item' && record.payload?.type === 'custom_tool_call') {
      lastTool = record.payload.name || 'exec';
      bumpCounter(toolCounts, lastTool);
      const summary = `${lastTool}: ${clip(String(record.payload.input || ''), 100)}`;
      lastAction = summary;
      events.push({ at: record.timestamp || lastTimestamp, kind: 'tool', tool: lastTool, summary });
    }
  }

  const parsedValue = {
    sessionId,
    title: title || `${originator} ${sessionId.slice(0, 8)}`,
    model: model || 'codex',
    cwd,
    gitBranch,
    goalStatus,
    lastAction,
    lastTool,
    lastError,
    errorCount,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    steps,
    lastTimestamp,
    toolCounts,
    events: events.slice(detailMode ? -80 : -40),
  };

  fileParseCache.set(cacheKey, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    value: parsedValue,
  });
  return parsedValue;
}

async function collectGenericJsonlRuntime(dirPath, runtime, runtimeLabel, repoRoot) {
  if (!existsSync(dirPath)) return [];
  const files = await walkJsonlFiles(dirPath, 3);
  files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  const sessions = [];
  for (const fileEntry of files.slice(0, 8)) {
    const { tailLines } = await readHeadAndTailLines(
      fileEntry.fullPath,
      fileEntry.stat.size,
      32 * 1024
    );
    let lastAction = '';
    let model = runtime;
    for (const line of tailLines.slice(-15)) {
      const record = safeJsonParse(line);
      if (!record) continue;
      if (record.model) model = String(record.model);
      const snippet = record.summary || record.message || record.content || record.text;
      if (typeof snippet === 'string' && snippet.trim()) lastAction = clip(snippet, 110);
    }
    const status = deriveStatus(fileEntry.stat.mtimeMs, null, false);
    sessions.push({
      id: path.basename(fileEntry.fullPath, '.jsonl'),
      runtime,
      runtimeLabel,
      title: `${runtimeLabel} ${path.basename(fileEntry.fullPath, '.jsonl').slice(0, 24)}`,
      status,
      runState: status.toUpperCase(),
      model,
      branch: null,
      cwd: repoRoot,
      inCurrentWorkspace: true,
      isCurrentSession: false,
      parentId: null,
      rootId: null,
      focus: lastAction,
      lastTool: '',
      lastError: '',
      errorCount: 0,
      steps: tailLines.length,
      tokens: { input: 0, cached: 0, output: 0, total: 0 },
      subagents: [],
      swarmWorkers: 0,
      toolCounts: {},
      updatedAt: new Date(fileEntry.stat.mtimeMs).toISOString(),
      mtimeMs: fileEntry.stat.mtimeMs,
      sourcePath: fileEntry.fullPath,
      recentEvents: lastAction
        ? [
            {
              at: new Date(fileEntry.stat.mtimeMs).toISOString(),
              kind: 'message',
              tool: runtime,
              summary: lastAction,
            },
          ]
        : [],
    });
  }
  return sessions;
}

async function collectLocalSwarmManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, '.swarm', 'swarm.json');
  if (!existsSync(manifestPath)) return null;
  const rawManifest = await readFile(manifestPath, 'utf8').catch(() => '');
  const manifest = safeJsonParse(rawManifest.trim());
  if (!manifest || !manifest.name) return null;
  return {
    runtime: 'visual-swarm',
    title: clip(manifest.name, 90),
    line: clip(manifest.goal || '', 160),
    updatedAt: manifest.updatedAt || null,
    workers: (manifest.agents || []).map((agentEntry) => ({
      name: agentEntry.name || agentEntry.id,
      role: agentEntry.role || '',
      status: agentEntry.status || 'idle',
      progress: Number(agentEntry.progress || 0),
      task: clip(agentEntry.message || (agentEntry.taskIds || []).join(', '), 120),
    })),
    tasks: (manifest.tasks || []).map((taskEntry) => ({
      id: taskEntry.id,
      title: clip(taskEntry.title || taskEntry.id, 90),
      status: taskEntry.status || 'pending',
      owner: taskEntry.owner || '',
    })),
  };
}

// ============================================================================
// 4B. OPENCODE COLLECTOR (~/.local/share/opencode/opencode.db — SQLite v2)
// ============================================================================

function parseOpenCodeModelField(rawModel) {
  if (!rawModel) return 'opencode';
  const parsed = typeof rawModel === 'string' ? safeJsonParse(rawModel.trim()) : rawModel;
  if (!parsed) return clip(String(rawModel), 48);
  const prov = parsed.providerID ? `${parsed.providerID}/` : '';
  const variant = parsed.variant ? ` (${parsed.variant})` : '';
  return clip(`${prov}${parsed.id || 'opencode'}${variant}`, 56);
}

function parseOpenCodeParts(partRows) {
  let focus = '';
  let lastTool = '';
  let lastError = '';
  let errorCount = 0;
  let hasRecentError = false;
  const toolCounts = {};
  const events = [];

  for (const row of [...partRows].reverse()) {
    const parsedPart = safeJsonParse(row.data || '');
    const atIso = row.time_updated ? new Date(Number(row.time_updated)).toISOString() : null;
    if (!parsedPart) continue;

    if (row.type === 'tool' || parsedPart.type === 'tool') {
      const toolName = parsedPart.name || parsedPart.tool || 'tool';
      lastTool = toolName;
      bumpCounter(toolCounts, toolName);
      const toolInput = parsedPart.state?.input || parsedPart.input || {};
      const targetHint = redactSecrets(
        String(
          toolInput.path ||
            toolInput.filePath ||
            toolInput.command ||
            toolInput.pattern ||
            toolInput.description ||
            ''
        )
      );
      const summary = targetHint ? `${toolName}: ${clip(targetHint, 105)}` : toolName;
      focus = summary;
      const failed = parsedPart.state?.status === 'error' || Boolean(parsedPart.state?.error);
      if (failed) {
        hasRecentError = true;
        errorCount += 1;
        lastError = clip(redactSecrets(String(parsedPart.state?.error || summary)), 150);
        events.push({ at: atIso, kind: 'error', tool: toolName, summary: lastError });
      } else {
        events.push({ at: atIso, kind: 'tool', tool: toolName, summary });
      }
    } else if (row.type === 'reasoning' || parsedPart.type === 'reasoning') {
      const thought = clip(redactSecrets(String(parsedPart.text || '')), 120);
      if (thought) {
        if (!focus) focus = thought;
        events.push({ at: atIso, kind: 'focus', tool: 'reasoning', summary: thought });
      }
    } else if (row.type === 'text' || parsedPart.type === 'text') {
      const txt = clip(redactSecrets(String(parsedPart.text || '')), 120);
      if (txt) {
        focus = txt;
        events.push({ at: atIso, kind: 'message', tool: 'opencode', summary: txt });
      }
    }
  }

  return { focus, lastTool, lastError, errorCount, hasRecentError, toolCounts, events };
}

export async function collectOpenCodeSessions(homeDir, repoRoot, openCodeCache = null) {
  const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  if (!existsSync(dbPath)) return [];

  const dbStat = await stat(dbPath).catch(() => null);
  const walStat = await stat(`${dbPath}-wal`).catch(() => null);
  if (!dbStat) return [];

  const cacheSig = `${dbStat.mtimeMs}:${dbStat.size}:${walStat?.mtimeMs || 0}:${walStat?.size || 0}`;
  if (openCodeCache && openCodeCache.sig === cacheSig) {
    return openCodeCache.sessions;
  }

  let sqliteDb;
  try {
    sqliteDb = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const hasV2 = sqliteDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_v2'")
      .get();
    if (!hasV2) return [];

    const rows = sqliteDb
      .prepare(
        `SELECT id, parent_id, title, directory, agent, model, cost,
                tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                time_created, time_updated, time_busy, time_idle, time_archived
         FROM session_v2
         WHERE time_archived IS NULL
         ORDER BY time_updated DESC
         LIMIT 16`
      )
      .all();

    const partStmt = sqliteDb.prepare(
      `SELECT type, time_updated, data
       FROM session_part
       WHERE session_id = ?
       ORDER BY time_updated DESC
       LIMIT 28`
    );

    const msgCountStmt = sqliteDb.prepare(
      `SELECT COUNT(*) AS cnt FROM session_message WHERE session_id = ?`
    );

    const nowMs = Date.now();
    const sessions = [];

    for (const row of rows) {
      const partRows = partStmt.all(row.id);
      const parsedParts = parseOpenCodeParts(partRows);
      const stepCount = Number(msgCountStmt.get(row.id)?.cnt || partRows.length);
      const updatedMs = Number(row.time_updated || row.time_created || dbStat.mtimeMs);
      const isBusy =
        Boolean(row.time_busy) &&
        (!row.time_idle || Number(row.time_busy) > Number(row.time_idle)) &&
        nowMs - updatedMs <= 180_000;
      const status = isBusy
        ? 'running'
        : deriveStatus(updatedMs, null, parsedParts.hasRecentError, nowMs);

      const inputTokens = Number(row.tokens_input || 0);
      const cachedTokens = Number(row.tokens_cache_read || 0) + Number(row.tokens_cache_write || 0);
      const outputTokens = Number(row.tokens_output || 0);

      sessions.push({
        id: row.id,
        runtime: 'opencode',
        runtimeLabel: 'OpenCode',
        title: clip(row.title || `OpenCode ${row.id.slice(0, 10)}`, 100),
        status,
        runState: isBusy ? 'BUSY' : status.toUpperCase(),
        model: parseOpenCodeModelField(row.model),
        branch: null,
        cwd: row.directory || null,
        inCurrentWorkspace: matchesWorkspace(row.directory, repoRoot),
        isCurrentSession: false,
        parentId: row.parent_id || null,
        rootId: null,
        focus: parsedParts.focus || (row.agent ? `agent:${row.agent}` : 'Ready'),
        lastTool: parsedParts.lastTool || '',
        lastError: parsedParts.lastError || '',
        errorCount: parsedParts.errorCount,
        steps: stepCount,
        cost: Number(row.cost || 0),
        tokens: {
          input: inputTokens,
          cached: cachedTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
        subagents: [],
        swarmWorkers: 0,
        toolCounts: parsedParts.toolCounts,
        updatedAt: new Date(updatedMs).toISOString(),
        mtimeMs: updatedMs,
        sourcePath: dbPath,
        recentEvents: parsedParts.events.slice(-10),
      });
    }

    // Link OpenCode parent/child subagent sessions
    const byId = new Map(sessions.map((entry) => [entry.id, entry]));
    for (const entry of sessions) {
      if (entry.parentId && byId.has(entry.parentId)) {
        const parent = byId.get(entry.parentId);
        parent.subagents.push({
          id: entry.id,
          role: entry.title,
          type: 'opencode-child',
          model: entry.model,
          status: entry.status,
          at: entry.updatedAt,
        });
      }
    }

    if (openCodeCache) {
      openCodeCache.sig = cacheSig;
      openCodeCache.sessions = sessions;
    }
    return sessions;
  } catch {
    return openCodeCache?.sessions || [];
  } finally {
    if (sqliteDb) {
      try {
        sqliteDb.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

function readOpenCodeDetail(dbPath, sessionId) {
  let sqliteDb;
  try {
    sqliteDb = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const partRows = sqliteDb
      .prepare(
        `SELECT type, time_updated, data
         FROM session_part
         WHERE session_id = ?
         ORDER BY time_updated DESC
         LIMIT 80`
      )
      .all(sessionId);
    return parseOpenCodeParts(partRows);
  } catch {
    return { events: [], toolCounts: {} };
  } finally {
    if (sqliteDb) {
      try {
        sqliteDb.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

// ============================================================================
// 4C. MAGPIE ROUTER / GATEWAY COLLECTOR (~/.config/magpie/)
// ============================================================================

function normalizeMagpieTargetRuntime(agentName) {
  const lowered = String(agentName || '').toLowerCase();
  if (lowered.includes('opencode')) return 'opencode';
  if (lowered.includes('claude')) return 'claude';
  if (lowered.includes('codex')) return 'codex';
  if (lowered.includes('antigravity') || lowered.includes('gemini')) return 'antigravity';
  if (lowered.includes('qoder')) return 'qoder';
  return null;
}

export async function collectMagpieTelemetry(homeDir, repoRoot, magpieCache = null) {
  const magpieDir = path.join(homeDir, '.config', 'magpie');
  const emptySummary = {
    connected: false,
    addr: null,
    version: null,
    totalRecentCalls: 0,
    okCalls: 0,
    rateLimit429: 0,
    errorCalls: 0,
    avgLatencyMs: 0,
    avgTtftMs: 0,
    providers: [],
    memoryStats: null,
    recentRoutes: [],
    routedRuntimes: [],
  };
  if (!existsSync(magpieDir)) return { sessions: [], summary: emptySummary };

  const usagePath = path.join(magpieDir, 'usage.jsonl');
  const gatewayPath = path.join(magpieDir, 'gateway.json');
  const memStatsPath = path.join(magpieDir, 'memory-stats.json');

  const [usageStat, gatewayRaw, memStatsRaw] = await Promise.all([
    stat(usagePath).catch(() => null),
    readFile(gatewayPath, 'utf8').catch(() => ''),
    readFile(memStatsPath, 'utf8').catch(() => ''),
  ]);

  const gatewayInfo = safeJsonParse(gatewayRaw.trim());
  const memStatsJson = safeJsonParse(memStatsRaw.trim());
  let memoryStats = null;
  if (memStatsJson && memStatsJson.days) {
    const dayKeys = Object.keys(memStatsJson.days).sort();
    const latestDay = dayKeys[dayKeys.length - 1];
    if (latestDay) {
      const dayRec = memStatsJson.days[latestDay] || {};
      memoryStats = {
        day: latestDay,
        searches: Number(dayRec.searches || 0),
        found: Number(dayRec.found || 0),
        recalled: Number(dayRec.recalled || 0),
        created: Object.values(dayRec.created || {}).reduce(
          (acc, num) => acc + Number(num || 0),
          0
        ),
      };
    }
  }

  let gatewayPort = 3425;
  if (gatewayInfo?.addr && typeof gatewayInfo.addr === 'string') {
    const portPart = Number(gatewayInfo.addr.split(':').pop());
    if (Number.isInteger(portPart) && portPart > 0 && portPart < 65536) {
      gatewayPort = portPart;
    }
  }
  const gatewayOpen = gatewayInfo ? await probeLocalTcpPort(gatewayPort) : false;

  const cacheSig = `${usageStat?.mtimeMs || 0}:${usageStat?.size || 0}:${gatewayOpen}:${memoryStats?.searches || 0}`;
  if (magpieCache && magpieCache.sig === cacheSig) {
    return magpieCache.bundle;
  }

  if (!usageStat) {
    const bundle = {
      sessions: [],
      summary: {
        ...emptySummary,
        connected: gatewayOpen,
        addr: gatewayInfo?.addr || null,
        version: gatewayInfo?.version || null,
        memoryStats,
      },
    };
    if (magpieCache) {
      magpieCache.sig = cacheSig;
      magpieCache.bundle = bundle;
    }
    return bundle;
  }

  // Bounded 256KB tail-read (usage.jsonl can exceed 100MB!)
  const { tailLines } = await readHeadAndTailLines(usagePath, usageStat.size, 256 * 1024);
  const nowMs = Date.now();
  const cutoffMs = nowMs - 2 * 60 * 60_000;

  const streamMap = new Map();
  const providerMap = new Map();
  const routedRuntimeSet = new Set();
  const recentRoutes = [];
  let okCalls = 0;
  let rateLimit429 = 0;
  let errorCalls = 0;
  let sumLatencyMs = 0;
  let sumTtftMs = 0;
  let latencyCount = 0;
  let ttftCount = 0;

  for (const line of tailLines) {
    const entry = safeJsonParse(line);
    if (!entry || !entry.t) continue;
    const entryMs = Date.parse(entry.t);
    if (!Number.isFinite(entryMs) || entryMs < cutoffMs) continue;

    const agentTag = clip(redactSecrets(String(entry.agent || 'client')), 32);
    const providerTag = clip(
      redactSecrets(String(entry.provider || 'router')).replace(/\S+@\S+/g, 'provider'),
      36
    );
    const servedModel = clip(redactSecrets(String(entry.served || entry.model || 'auto')), 48);
    const routeGroup = clip(redactSecrets(String(entry.req || '')), 40);
    const statusCode = Number(entry.status || 0);
    const msVal = Number(entry.ms || 0);
    const ttftVal = Number(entry.ttft_ms || 0);
    const inTok = Number(entry.in || 0);
    const outTok = Number(entry.out || 0);
    const cacheTok = Number(entry.cache_read || 0) + Number(entry.cache_write || 0);
    const is429 = statusCode === 429;
    const isErr = statusCode >= 400;

    if (statusCode >= 200 && statusCode < 400) okCalls += 1;
    else if (is429) rateLimit429 += 1;
    else if (isErr) errorCalls += 1;

    if (msVal > 0) {
      sumLatencyMs += msVal;
      latencyCount += 1;
    }
    if (ttftVal > 0) {
      sumTtftMs += ttftVal;
      ttftCount += 1;
    }

    const mappedRt = normalizeMagpieTargetRuntime(agentTag);
    if (mappedRt) routedRuntimeSet.add(mappedRt);

    // Aggregate per-provider metrics (strictly sanitized — no host/account emails)
    let provStats = providerMap.get(providerTag);
    if (!provStats) {
      provStats = {
        provider: providerTag,
        calls: 0,
        ok: 0,
        rateLimits: 0,
        errors: 0,
        tokens: 0,
        sumMs: 0,
        models: new Set(),
      };
      providerMap.set(providerTag, provStats);
    }
    provStats.calls += 1;
    if (!isErr) provStats.ok += 1;
    else if (is429) provStats.rateLimits += 1;
    else provStats.errors += 1;
    provStats.tokens += inTok + outTok;
    provStats.sumMs += msVal;
    provStats.models.add(servedModel);

    // Aggregate into virtual Magpie Router stream sessions
    const streamKey = `${agentTag}::${providerTag}::${servedModel}`;
    let streamObj = streamMap.get(streamKey);
    if (!streamObj) {
      streamObj = {
        id: streamKey,
        agentTag,
        providerTag,
        servedModel,
        routeGroup,
        targetRuntime: mappedRt,
        calls: 0,
        errorCount: 0,
        hasRecentError: false,
        lastError: '',
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        lastMs: entryMs,
        lastIso: entry.t,
        subagentIds: new Set(),
        toolCounts: {},
        events: [],
      };
      streamMap.set(streamKey, streamObj);
    }

    streamObj.calls += 1;
    streamObj.inputTokens += inTok;
    streamObj.cachedTokens += cacheTok;
    streamObj.outputTokens += outTok;
    if (entryMs >= streamObj.lastMs) {
      streamObj.lastMs = entryMs;
      streamObj.lastIso = entry.t;
    }
    if (entry.subagent) streamObj.subagentIds.add(String(entry.subagent).slice(0, 14));
    const stopTag = entry.stop ? `route:${entry.stop}` : 'route:complete';
    bumpCounter(streamObj.toolCounts, stopTag);

    const routeSummary = `${providerTag}/${servedModel} HTTP ${statusCode || 200} · ${msVal}ms (ttft ${ttftVal}ms)`;
    if (isErr) {
      streamObj.errorCount += 1;
      streamObj.hasRecentError = true;
      streamObj.lastError = routeSummary;
    }
    streamObj.events.push({
      at: entry.t,
      kind: isErr ? 'error' : 'tool',
      tool: is429 ? 'rate_limit_429' : 'magpie_route',
      summary: `${agentTag} → ${routeSummary}`,
    });

    recentRoutes.push({
      at: entry.t,
      agent: agentTag,
      targetRuntime: mappedRt,
      provider: providerTag,
      model: servedModel,
      status: statusCode || 200,
      ms: msVal,
      ttftMs: ttftVal,
      tokens: inTok + outTok,
      cached: cacheTok,
    });
  }

  const sessions = Array.from(streamMap.values())
    .sort((left, right) => right.lastMs - left.lastMs)
    .slice(0, 12)
    .map((streamObj) => {
      const status = deriveStatus(streamObj.lastMs, null, streamObj.hasRecentError, nowMs);
      const subagents = Array.from(streamObj.subagentIds)
        .slice(0, 8)
        .map((subId) => ({
          id: subId,
          role: `${streamObj.agentTag} sub:${subId.slice(0, 8)}`,
          type: 'magpie-routed',
          model: streamObj.servedModel,
          status: status === 'running' ? 'running' : 'idle',
          at: streamObj.lastIso,
        }));
      return {
        id: streamObj.id,
        runtime: 'magpie',
        runtimeLabel: 'Magpie Router',
        title: clip(`Magpie → ${streamObj.agentTag} (${streamObj.providerTag})`, 96),
        status,
        runState: gatewayOpen && status === 'running' ? 'ROUTING' : status.toUpperCase(),
        model: streamObj.servedModel,
        branch: streamObj.routeGroup || null,
        cwd: repoRoot,
        inCurrentWorkspace: true,
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        targetRuntime: streamObj.targetRuntime,
        focus:
          streamObj.events[streamObj.events.length - 1]?.summary ||
          `${streamObj.providerTag} ready`,
        lastTool: streamObj.hasRecentError ? 'rate_limit_429' : 'magpie_route',
        lastError: streamObj.lastError,
        errorCount: streamObj.errorCount,
        steps: streamObj.calls,
        tokens: {
          input: streamObj.inputTokens,
          cached: streamObj.cachedTokens,
          output: streamObj.outputTokens,
          total: streamObj.inputTokens + streamObj.outputTokens,
        },
        subagents,
        swarmWorkers: 0,
        toolCounts: streamObj.toolCounts,
        updatedAt: streamObj.lastIso,
        mtimeMs: streamObj.lastMs,
        sourcePath: usagePath,
        recentEvents: streamObj.events.slice(-12),
      };
    });

  const providers = Array.from(providerMap.values())
    .map((provStats) => ({
      provider: provStats.provider,
      calls: provStats.calls,
      ok: provStats.ok,
      rateLimits: provStats.rateLimits,
      errors: provStats.errors,
      tokens: provStats.tokens,
      avgMs: provStats.calls > 0 ? Math.round(provStats.sumMs / provStats.calls) : 0,
      models: Array.from(provStats.models).slice(0, 4),
    }))
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 10);

  const summary = {
    connected: gatewayOpen,
    addr: gatewayInfo?.addr || `127.0.0.1:${gatewayPort}`,
    version: gatewayInfo?.version || null,
    totalRecentCalls: okCalls + rateLimit429 + errorCalls,
    okCalls,
    rateLimit429,
    errorCalls,
    avgLatencyMs: latencyCount > 0 ? Math.round(sumLatencyMs / latencyCount) : 0,
    avgTtftMs: ttftCount > 0 ? Math.round(sumTtftMs / ttftCount) : 0,
    providers,
    memoryStats,
    recentRoutes: recentRoutes.slice(-24).reverse(),
    routedRuntimes: Array.from(routedRuntimeSet),
  };

  const bundle = { sessions, summary };
  if (magpieCache) {
    magpieCache.sig = cacheSig;
    magpieCache.bundle = bundle;
  }
  return bundle;
}

// ============================================================================
// 5. GIT WORKSPACE RADAR & LIVE SERVER / VPS PROBES
// ============================================================================

function classifyGitArea(filePath) {
  const normalized = normalizePathSlashes(filePath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return 'root';
  if (parts.length === 1) return 'root';
  if (parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'tools') {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

function mapPorcelainLabel(code) {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

export async function collectGitSnapshot(repoRoot) {
  const [branchOut, statusOut, logOut, diffStatOut, revListOut, stashOut] = await Promise.all([
    execFileAsync('git', ['branch', '--show-current'], { cwd: repoRoot, timeout: 3500 }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot, timeout: 3500 }),
    execFileAsync('git', ['log', '-n', '30', '--pretty=format:%h%x09%cI%x09%an%x09%s'], {
      cwd: repoRoot,
      timeout: 3500,
    }),
    execFileAsync('git', ['diff', '--shortstat'], { cwd: repoRoot, timeout: 3500 }).catch(() => ({
      stdout: '',
    })),
    execFileAsync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], {
      cwd: repoRoot,
      timeout: 2500,
    }).catch(() => ({ stdout: '' })),
    execFileAsync('git', ['stash', 'list'], { cwd: repoRoot, timeout: 2500 }).catch(() => ({
      stdout: '',
    })),
  ]);

  const branch = branchOut.stdout.trim() || 'HEAD';
  const rawDirtyLines = statusOut.stdout.split(/\r?\n/).filter(Boolean);
  const dirtyFiles = [];
  const dirtyByArea = {};

  for (const rawLine of rawDirtyLines) {
    const code = rawLine.slice(0, 2);
    let relPath = rawLine.slice(3).trim();
    if (relPath.includes(' -> ')) {
      relPath = relPath.split(' -> ').pop().trim();
    }
    if (relPath.startsWith('"') && relPath.endsWith('"')) {
      relPath = relPath.slice(1, -1);
    }
    const normalizedPath = normalizePathSlashes(relPath);
    const area = classifyGitArea(normalizedPath);
    bumpCounter(dirtyByArea, area);
    if (dirtyFiles.length < 80) {
      dirtyFiles.push({
        code: code.trim() || 'M',
        status: mapPorcelainLabel(code),
        path: normalizedPath,
        area,
      });
    }
  }

  const diffStatText = (diffStatOut.stdout || '').trim();
  const filesMatch = diffStatText.match(/(\d+)\s+files?\s+changed/);
  const insMatch = diffStatText.match(/(\d+)\s+insertions?/);
  const delMatch = diffStatText.match(/(\d+)\s+deletions?/);

  let ahead = 0;
  let behind = 0;
  const revParts = (revListOut.stdout || '').trim().split(/\s+/);
  if (revParts.length === 2) {
    ahead = Number(revParts[0]) || 0;
    behind = Number(revParts[1]) || 0;
  }

  const stashCount = (stashOut.stdout || '').split(/\r?\n/).filter(Boolean).length;

  const commits = [];
  const commitByTaskId = {};
  for (const line of logOut.stdout.split(/\r?\n/).filter(Boolean)) {
    const [sha, committedAt, author, subject] = line.split('\t');
    const taskMatch = (subject || '').match(/\b([A-Z]\d{2,3})\b/);
    const taskId = taskMatch ? taskMatch[1] : null;
    if (taskId && !commitByTaskId[taskId]) {
      commitByTaskId[taskId] = { sha, subject: clip(subject, 90), at: committedAt };
    }
    commits.push({
      sha,
      at: committedAt,
      author: clip(author || '', 30),
      subject: clip(subject || '', 110),
      taskId,
    });
  }

  return {
    branch,
    head: commits[0]?.sha || '',
    ahead,
    behind,
    stashCount,
    dirtyCount: rawDirtyLines.length,
    dirtyFiles,
    dirtyByArea,
    diffStat: {
      filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
      insertions: insMatch ? Number(insMatch[1]) : 0,
      deletions: delMatch ? Number(delMatch[1]) : 0,
    },
    commits: commits.slice(0, 24),
    commitByTaskId,
    updatedAt: new Date().toISOString(),
  };
}

export async function readGitCommitDetail(repoRoot, rawSha) {
  if (typeof rawSha !== 'string' || !/^[0-9a-f]{6,40}$/i.test(rawSha.trim())) {
    return null;
  }
  try {
    const sha = rawSha.trim();
    const { stdout } = await execFileAsync(
      'git',
      ['show', '--stat', '--format=fuller', '--no-patch', sha],
      { cwd: repoRoot, timeout: 3500 }
    );
    const statOut = await execFileAsync('git', ['show', '--numstat', '--format=', sha], {
      cwd: repoRoot,
      timeout: 3500,
    });
    const changedFiles = statOut.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 60)
      .map((line) => {
        const [added, removed, filePath] = line.split('\t');
        return {
          added: added === '-' ? 0 : Number(added) || 0,
          removed: removed === '-' ? 0 : Number(removed) || 0,
          path: normalizePathSlashes(filePath || ''),
        };
      });
    return {
      sha,
      header: redactSecrets(stdout).trim(),
      changedFiles,
    };
  } catch {
    return null;
  }
}

export async function probeHttpTarget(target) {
  const validation = validateProbeUrl(target.url);
  if (!validation.valid) {
    return {
      ...target,
      status: 'down',
      httpCode: null,
      latencyMs: 0,
      detail: validation.reason,
    };
  }
  const startedMs = Date.now();
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const httpResponse = await fetch(validation.normalizedUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedMs;
    let detail = '';
    const contentType = httpResponse.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const bodyText = (await httpResponse.text().catch(() => '')).slice(0, 8192);
      const parsedBody = safeJsonParse(bodyText.trim());
      if (parsedBody && typeof parsedBody.setupRequired === 'boolean') {
        detail = parsedBody.setupRequired ? 'setupRequired: true' : 'claimed';
      } else if (parsedBody && parsedBody.status) {
        detail = clip(String(parsedBody.status), 40);
      }
    }
    const isUp = httpResponse.status >= 200 && httpResponse.status < 400;
    return {
      ...target,
      url: validation.normalizedUrl,
      status: isUp ? 'up' : 'warn',
      httpCode: httpResponse.status,
      latencyMs,
      detail,
    };
  } catch (err) {
    return {
      ...target,
      status: 'down',
      httpCode: null,
      latencyMs: Date.now() - startedMs,
      detail: err?.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeLocalTcpPort(port) {
  return new Promise((resolve) => {
    const tcpSocket = new Socket();
    let settled = false;
    const finish = (isOpen) => {
      if (settled) return;
      settled = true;
      tcpSocket.destroy();
      resolve(isOpen);
    };
    tcpSocket.setTimeout(350);
    tcpSocket.once('connect', () => finish(true));
    tcpSocket.once('error', () => finish(false));
    tcpSocket.once('timeout', () => finish(false));
    tcpSocket.connect(port, '127.0.0.1');
  });
}

// ============================================================================
// 6. NEURAL FLOW GRAPH & ANALYTICS SYNTHESIZERS (100% REAL TELEMETRY)
// ============================================================================

export function buildFlowGraph(
  sessions,
  swarms,
  activePlan,
  gitState,
  probes,
  activityFeed,
  repoRoot
) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();

  const addNode = (nodeDef) => {
    if (nodeIds.has(nodeDef.id)) return;
    nodeIds.add(nodeDef.id);
    nodes.push(nodeDef);
  };

  const repoName = path.basename(normalizePathSlashes(repoRoot)) || 'workspace';
  addNode({
    id: 'hub:workspace',
    tier: 0,
    kind: 'hub',
    label: repoName,
    sublabel: `${gitState.branch}@${gitState.head || 'HEAD'}`,
    status: gitState.dirtyCount > 0 ? 'running' : 'idle',
    runtime: 'hub',
    metrics: {
      dirtyCount: gitState.dirtyCount,
      commits: gitState.commits.length,
    },
  });

  // Group sessions by runtime
  const runtimeGroups = new Map();
  for (const session of sessions) {
    if (!runtimeGroups.has(session.runtime)) {
      runtimeGroups.set(session.runtime, []);
    }
    runtimeGroups.get(session.runtime).push(session);
  }

  for (const [runtime, rtSessions] of runtimeGroups.entries()) {
    const runningCount = rtSessions.filter((entry) => entry.status === 'running').length;
    const errorCount = rtSessions.filter(
      (entry) => entry.status === 'error' || entry.errorCount > 0
    ).length;
    const totalTokens = rtSessions.reduce((acc, entry) => acc + (entry.tokens?.total || 0), 0);
    const runtimeNodeId = `rt:${runtime}`;
    addNode({
      id: runtimeNodeId,
      tier: 1,
      kind: 'runtime',
      runtime,
      label: RUNTIME_LABELS[runtime] || runtime,
      sublabel: `${runningCount} active · ${rtSessions.length} total`,
      status: runningCount > 0 ? 'running' : errorCount > 0 ? 'error' : 'recent',
      metrics: {
        sessions: rtSessions.length,
        running: runningCount,
        tokens: totalTokens,
        errors: errorCount,
      },
    });
    edges.push({
      id: `edge:hub-${runtime}`,
      from: 'hub:workspace',
      to: runtimeNodeId,
      kind: 'runtime-link',
      runtime,
      weight: Math.max(1, runningCount * 3 + Math.min(rtSessions.length, 6)),
      active: runningCount > 0,
    });
  }

  // Select prioritized sessions for crisp topology visualization (cap Magpie virtual streams to top 3)
  const statusRank = { running: 4, error: 3, recent: 2, idle: 1 };
  const sortedCandidates = [...sessions].sort((left, right) => {
    const rankDiff = (statusRank[right.status] || 0) - (statusRank[left.status] || 0);
    if (rankDiff !== 0) return rankDiff;
    const subDiff = (right.subagents?.length || 0) - (left.subagents?.length || 0);
    if (subDiff !== 0 && right.status !== 'idle') return subDiff;
    return right.mtimeMs - left.mtimeMs;
  });
  const rankedSessions = [];
  const perRuntimePicked = {};
  for (const candidate of sortedCandidates) {
    if (rankedSessions.length >= 20) break;
    const rtCap = candidate.runtime === 'magpie' ? 3 : 6;
    const rtCount = perRuntimePicked[candidate.runtime] || 0;
    if (rtCount >= rtCap) continue;
    perRuntimePicked[candidate.runtime] = rtCount + 1;
    rankedSessions.push(candidate);
  }

  const sessionNodeById = new Map();
  let subagentNodesAdded = 0;

  for (const session of rankedSessions) {
    const agentNodeId = `agent:${session.runtime}:${session.id}`;
    sessionNodeById.set(session.id, agentNodeId);
    addNode({
      id: agentNodeId,
      tier: 2,
      kind: 'agent',
      runtime: session.runtime,
      targetRuntime: session.targetRuntime || null,
      sessionId: session.id,
      label: clip(session.title, 34),
      sublabel: clip(session.lastTool || session.model || session.status, 30),
      status: session.status,
      isCurrentSession: Boolean(session.isCurrentSession),
      focus: session.focus || '',
      model: session.model,
      lastError: session.lastError || '',
      metrics: {
        tokens: session.tokens?.total || 0,
        steps: session.steps || 0,
        subagents: (session.subagents || []).length,
        errors: session.errorCount || 0,
      },
    });
    edges.push({
      id: `edge:rt-${agentNodeId}`,
      from: `rt:${session.runtime}`,
      to: agentNodeId,
      kind: 'session-link',
      runtime: session.runtime,
      weight: Math.max(1, Math.min(6, Math.ceil((session.steps || 1) / 25))),
      active: session.status === 'running',
    });

    // Attach top subagents per session (bounded to 28 total across graph for legibility)
    const subLimit = session.status === 'running' ? 6 : 3;
    for (const subEntry of (session.subagents || []).slice(0, subLimit)) {
      if (subagentNodesAdded >= 28) break;
      const subNodeId = `sub:${session.id.slice(0, 8)}:${subagentNodesAdded}`;
      subagentNodesAdded += 1;
      addNode({
        id: subNodeId,
        tier: 3,
        kind: 'subagent',
        runtime: session.runtime,
        parentSessionId: session.id,
        label: clip(subEntry.role || subEntry.id, 26),
        sublabel: clip(subEntry.type || subEntry.model || 'subagent', 24),
        status:
          subEntry.status === 'running'
            ? 'running'
            : session.status === 'running'
              ? 'recent'
              : 'idle',
        metrics: {
          model: subEntry.model || 'inherit',
        },
      });
      edges.push({
        id: `edge:sub-${subNodeId}`,
        from: agentNodeId,
        to: subNodeId,
        kind: 'subagent-link',
        runtime: session.runtime,
        weight: 2,
        active: subEntry.status === 'running' || session.status === 'running',
      });
    }
  }

  // Attach active swarm workers
  for (let swarmIdx = 0; swarmIdx < swarms.length; swarmIdx += 1) {
    const swarmEntry = swarms[swarmIdx];
    const swarmNodeId = `swarm:${swarmIdx}`;
    addNode({
      id: swarmNodeId,
      tier: 3,
      kind: 'swarm',
      runtime: swarmEntry.runtime || 'visual-swarm',
      label: clip(swarmEntry.title || 'Swarm', 28),
      sublabel: `${(swarmEntry.workers || []).length} workers`,
      status: 'running',
      metrics: { workers: (swarmEntry.workers || []).length },
    });
    const parentAgentNode = swarmEntry.conversationId
      ? sessionNodeById.get(swarmEntry.conversationId)
      : null;
    edges.push({
      id: `edge:swarm-${swarmIdx}`,
      from: parentAgentNode || 'hub:workspace',
      to: swarmNodeId,
      kind: 'swarm-link',
      runtime: 'visual-swarm',
      weight: 3,
      active: true,
    });
  }

  // Tier 4 targets: active plan waves + top dirty areas + live VPS endpoints + open local ports
  if (activePlan && Array.isArray(activePlan.waves)) {
    const topWaves = activePlan.waves.slice(0, 5);
    for (let waveIdx = 0; waveIdx < topWaves.length; waveIdx += 1) {
      const waveEntry = topWaves[waveIdx];
      const waveNodeId = `wave:${activePlan.id}:${waveIdx}`;
      const waveComplete = waveEntry.total > 0 && waveEntry.done === waveEntry.total;
      const waveInProgress = waveEntry.done > 0 && waveEntry.done < waveEntry.total;
      addNode({
        id: waveNodeId,
        tier: 4,
        kind: 'plan-wave',
        runtime: 'plan',
        planId: activePlan.id,
        waveTitle: waveEntry.title,
        label: clip(waveEntry.title.replace(/^Wave\s+/i, 'W'), 28),
        sublabel: `${waveEntry.done}/${waveEntry.total} (${waveEntry.percent}%)`,
        status: waveComplete ? 'running' : waveInProgress ? 'recent' : 'idle',
        metrics: { done: waveEntry.done, total: waveEntry.total, percent: waveEntry.percent },
      });
    }

    // Correlate active/recent sessions with plan tasks / waves
    for (const session of rankedSessions) {
      const agentNodeId = sessionNodeById.get(session.id);
      if (!agentNodeId) continue;
      const haystack = `${session.title} ${session.focus}`.toUpperCase();
      const matchedTask = activePlan.tasks.find((taskEntry) =>
        new RegExp(`\\b${taskEntry.id}\\b`, 'i').test(haystack)
      );
      if (matchedTask) {
        const waveIdx = activePlan.waves.findIndex(
          (waveEntry) => waveEntry.title === matchedTask.wave
        );
        if (waveIdx >= 0 && waveIdx < 5) {
          edges.push({
            id: `edge:task-${session.id.slice(0, 8)}-${waveIdx}`,
            from: agentNodeId,
            to: `wave:${activePlan.id}:${waveIdx}`,
            kind: 'plan-link',
            runtime: session.runtime,
            weight: 3,
            active: session.status === 'running',
            label: matchedTask.id,
          });
        }
      }
    }
  }

  // Top dirty areas as workspace targets
  const topDirtyAreas = Object.entries(gitState.dirtyByArea || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);
  for (const [areaName, fileCount] of topDirtyAreas) {
    const areaNodeId = `area:${areaName}`;
    addNode({
      id: areaNodeId,
      tier: 4,
      kind: 'workspace-area',
      runtime: 'git',
      label: areaName,
      sublabel: `${fileCount} dirty file${fileCount === 1 ? '' : 's'}`,
      status: 'recent',
      metrics: { dirtyFiles: fileCount },
    });
    // Link active running workspace agents to top modified areas
    const runningWorkspaceAgents = rankedSessions.filter(
      (session) => session.status === 'running' && session.inCurrentWorkspace
    );
    for (const activeAgent of runningWorkspaceAgents.slice(0, 3)) {
      edges.push({
        id: `edge:area-${activeAgent.id.slice(0, 8)}-${areaName}`,
        from: `agent:${activeAgent.runtime}:${activeAgent.id}`,
        to: areaNodeId,
        kind: 'workspace-link',
        runtime: activeAgent.runtime,
        weight: 2,
        active: true,
      });
    }
  }

  // VPS probes as Tier 4 infra targets
  for (const probe of (probes.vps || []).slice(0, 4)) {
    const vpsNodeId = `vps:${probe.id}`;
    addNode({
      id: vpsNodeId,
      tier: 4,
      kind: 'infra',
      runtime: 'infra',
      label: clip(probe.label, 28),
      sublabel: probe.httpCode
        ? `HTTP ${probe.httpCode} · ${probe.latencyMs ?? 0}ms`
        : probe.status.toUpperCase(),
      status: probe.status === 'up' ? 'running' : probe.status === 'warn' ? 'recent' : 'error',
      metrics: { latencyMs: probe.latencyMs || 0, httpCode: probe.httpCode },
    });
    edges.push({
      id: `edge:vps-${probe.id}`,
      from: 'hub:workspace',
      to: vpsNodeId,
      kind: 'infra-link',
      runtime: 'infra',
      weight: 1.5,
      active: probe.status === 'up',
    });
  }

  // Cross-runtime Magpie Router power-up conduits (Magpie -> OpenCode / Claude / Codex / Antigravity)
  if (nodeIds.has('rt:magpie')) {
    const magpieLinkedTargets = new Set();
    for (const session of sessions) {
      if (session.runtime === 'magpie' && session.targetRuntime) {
        magpieLinkedTargets.add(session.targetRuntime);
      }
    }
    for (const targetRt of magpieLinkedTargets) {
      const targetRtNodeId = `rt:${targetRt}`;
      if (nodeIds.has(targetRtNodeId)) {
        edges.push({
          id: `edge:magpie-boost-${targetRt}`,
          from: 'rt:magpie',
          to: targetRtNodeId,
          kind: 'router-link',
          runtime: 'magpie',
          weight: 3.5,
          active: true,
          label: 'ROUTE',
        });
      }
    }
  }

  // Real-time event pulses for p5 particle emission (balance Magpie vs coding hero pulses)
  const balancedFeed = [];
  let magpiePulsesCount = 0;
  for (const eventEntry of activityFeed || []) {
    if (balancedFeed.length >= 30) break;
    if (eventEntry.runtime === 'magpie') {
      if (magpiePulsesCount >= 5) continue;
      magpiePulsesCount += 1;
    }
    balancedFeed.push(eventEntry);
  }
  const pulses = balancedFeed.map((eventEntry, idx) => {
    const agentNodeId = sessionNodeById.get(eventEntry.sessionId) || `rt:${eventEntry.runtime}`;
    return {
      id: `${eventEntry.at || idx}-${eventEntry.sessionId}-${idx}`,
      at: eventEntry.at,
      runtime: eventEntry.runtime,
      kind: eventEntry.kind,
      tool: eventEntry.tool,
      summary: eventEntry.summary,
      fromNode: `rt:${eventEntry.runtime}`,
      toNode: agentNodeId,
    };
  });

  return { nodes, edges, pulses };
}

export function computeAnalytics(sessions, activityFeed, nowMs = Date.now()) {
  const toolStats = new Map();
  const runtimeStats = new Map();
  const modelStats = new Map();
  const errorLedger = [];

  for (const session of sessions) {
    // Runtime aggregation
    let rtEntry = runtimeStats.get(session.runtime);
    if (!rtEntry) {
      rtEntry = {
        runtime: session.runtime,
        label: session.runtimeLabel || RUNTIME_LABELS[session.runtime] || session.runtime,
        sessions: 0,
        running: 0,
        subagents: 0,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        errors: 0,
      };
      runtimeStats.set(session.runtime, rtEntry);
    }
    rtEntry.sessions += 1;
    if (session.status === 'running') rtEntry.running += 1;
    rtEntry.subagents += (session.subagents || []).length;
    rtEntry.inputTokens += session.tokens?.input || 0;
    rtEntry.cachedTokens += session.tokens?.cached || 0;
    rtEntry.outputTokens += session.tokens?.output || 0;
    rtEntry.totalTokens += session.tokens?.total || 0;
    rtEntry.errors += session.errorCount || (session.lastError ? 1 : 0);

    // Model aggregation
    const modelName = session.model || session.runtime;
    let modelEntry = modelStats.get(modelName);
    if (!modelEntry) {
      modelEntry = { model: modelName, runtime: session.runtime, sessions: 0, tokens: 0, steps: 0 };
      modelStats.set(modelName, modelEntry);
    }
    modelEntry.sessions += 1;
    modelEntry.tokens += session.tokens?.total || 0;
    modelEntry.steps += session.steps || 0;

    // Tool histogram
    for (const [toolName, callCount] of Object.entries(session.toolCounts || {})) {
      let toolEntry = toolStats.get(toolName);
      if (!toolEntry) {
        toolEntry = { name: toolName, calls: 0, errors: 0, runtimes: new Set() };
        toolStats.set(toolName, toolEntry);
      }
      toolEntry.calls += Number(callCount || 0);
      toolEntry.runtimes.add(session.runtime);
    }

    // Error ledger
    if (session.lastError) {
      errorLedger.push({
        at: session.updatedAt,
        runtime: session.runtime,
        runtimeLabel: session.runtimeLabel,
        sessionId: session.id,
        sessionTitle: clip(session.title, 60),
        tool: session.lastTool || 'error',
        message: session.lastError,
      });
    }
  }

  for (const feedEvent of activityFeed) {
    if (feedEvent.kind === 'error') {
      const toolEntry = toolStats.get(feedEvent.tool || 'error');
      if (toolEntry) toolEntry.errors += 1;
    }
  }

  const runtimeBreakdown = Array.from(runtimeStats.values())
    .map((rtEntry) => {
      const denom = rtEntry.inputTokens + rtEntry.cachedTokens;
      return {
        ...rtEntry,
        cacheHitPct: denom > 0 ? Math.round((rtEntry.cachedTokens / denom) * 1000) / 10 : 0,
      };
    })
    .sort((left, right) => right.running - left.running || right.totalTokens - left.totalTokens);

  const toolFrequency = Array.from(toolStats.values())
    .map((toolEntry) => ({
      name: toolEntry.name,
      calls: toolEntry.calls,
      errors: toolEntry.errors,
      runtimes: Array.from(toolEntry.runtimes),
    }))
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 18);

  const modelBreakdown = Array.from(modelStats.values())
    .sort((left, right) => right.tokens - left.tokens || right.sessions - left.sessions)
    .slice(0, 12);

  // Real 24-bucket activity timeline over last 60 minutes (2.5m per bucket)
  const bucketCount = 24;
  const windowMs = 60 * 60_000;
  const bucketSpanMs = windowMs / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, idx) => ({
    index: idx,
    label: `-${Math.round(((bucketCount - idx) * bucketSpanMs) / 60_000)}m`,
    total: 0,
    tools: 0,
    subagents: 0,
    errors: 0,
  }));

  for (const feedEvent of activityFeed) {
    const eventMs = Date.parse(feedEvent.at || '');
    if (!Number.isFinite(eventMs)) continue;
    const ageMs = nowMs - eventMs;
    if (ageMs < 0 || ageMs > windowMs) continue;
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((windowMs - ageMs) / bucketSpanMs))
    );
    const bucket = buckets[bucketIdx];
    bucket.total += 1;
    if (feedEvent.kind === 'error') bucket.errors += 1;
    else if (feedEvent.kind === 'subagent' || feedEvent.kind === 'swarm') bucket.subagents += 1;
    else bucket.tools += 1;
  }

  errorLedger.sort((left, right) => (right.at || '').localeCompare(left.at || ''));

  return {
    toolFrequency,
    runtimeBreakdown,
    modelBreakdown,
    activityBuckets: buckets,
    errorLedger: errorLedger.slice(0, 25),
  };
}

export function formatSnapshotMarkdown(snapshot) {
  const lines = [
    `# MoonWitness Agent Observatory Report`,
    '',
    `- **Generated:** ${snapshot.generatedAt}`,
    `- **Repository:** \`${snapshot.repoRoot}\``,
    `- **Git:** \`${snapshot.git.branch}@${snapshot.git.head || 'HEAD'}\` (${snapshot.git.dirtyCount} dirty files)`,
    `- **Host:** ${snapshot.host.hostname} (${snapshot.host.platform}) · CPU ${snapshot.host.cpuPct}% · RAM ${snapshot.host.memUsedGb}/${snapshot.host.memTotalGb} GB (${snapshot.host.memPct}%)`,
    `- **Agents:** ${snapshot.summary.runningSessions} running / ${snapshot.summary.totalSessions} tracked · ${snapshot.summary.subagents} subagents · ${snapshot.summary.swarms} swarm(s)`,
    `- **Tokens Observed:** ${snapshot.summary.tokens.total.toLocaleString()} (in ${snapshot.summary.tokens.input.toLocaleString()}, cache ${snapshot.summary.tokens.cached.toLocaleString()}, out ${snapshot.summary.tokens.output.toLocaleString()})`,
    '',
    '## Plans Progress',
  ];

  for (const planEntry of snapshot.plans || []) {
    const dagStats = planEntry.dag?.stats;
    lines.push(
      `- **${planEntry.id}**: ${planEntry.done}/${planEntry.total} (${planEntry.percent}%)` +
        (dagStats
          ? ` — ready: ${dagStats.ready}, active: ${dagStats.active}, blocked: ${dagStats.blocked}`
          : '') +
        (planEntry.nextTaskId
          ? ` — next: \`${planEntry.nextTaskId}\` ${planEntry.nextTaskTitle}`
          : ' — COMPLETE')
    );
  }

  lines.push('', '## Active & Recent Agents');
  for (const session of (snapshot.sessions || []).slice(0, 15)) {
    lines.push(
      `- [${session.status.toUpperCase()}] **${session.runtimeLabel}** \`${session.id.slice(0, 8)}\` (${session.model}) — ${session.title} — _${session.focus || session.lastTool || 'Idle'}_`
    );
  }

  if ((snapshot.analytics?.errorLedger || []).length > 0) {
    lines.push('', '## Recent Errors');
    for (const errEntry of snapshot.analytics.errorLedger.slice(0, 10)) {
      lines.push(
        `- [${errEntry.runtimeLabel}] **${errEntry.sessionTitle}**: \`${errEntry.message}\``
      );
    }
  }

  if (snapshot.magpie && (snapshot.magpie.connected || snapshot.magpie.totalRecentCalls > 0)) {
    lines.push(
      '',
      '## Magpie Router',
      `- **Gateway:** ${snapshot.magpie.addr || 'local'} (${snapshot.magpie.connected ? 'ONLINE' : 'STANDBY'}) · ${snapshot.magpie.totalRecentCalls} recent calls (${snapshot.magpie.okCalls} ok, ${snapshot.magpie.rateLimit429}×429, avg ${snapshot.magpie.avgLatencyMs}ms)`
    );
  }

  lines.push('', '## VPS Health Probes');
  for (const probe of snapshot.probes?.vps || []) {
    lines.push(
      `- [${probe.status.toUpperCase()}] **${probe.label}** — HTTP ${probe.httpCode ?? 'ERR'} (${probe.latencyMs ?? '—'}ms) ${probe.detail || ''}`
    );
  }

  return `${lines.join('\n')}\n`;
}

// ============================================================================
// 7. OBSERVATORY SERVER ENGINE (MODULAR, TESTABLE, INSTANT BOOT)
// ============================================================================

function createCpuSampler() {
  let previousTotals = os.cpus().map((core) => ({
    idle: core.times.idle,
    total: Object.values(core.times).reduce((sum, val) => sum + val, 0),
  }));
  let lastPct = 0;

  return () => {
    const currentCores = os.cpus();
    let idleDelta = 0;
    let totalDelta = 0;
    for (let idx = 0; idx < currentCores.length; idx += 1) {
      const times = currentCores[idx].times;
      const currentTotal = Object.values(times).reduce((sum, val) => sum + val, 0);
      const prev = previousTotals[idx];
      if (prev) {
        idleDelta += times.idle - prev.idle;
        totalDelta += currentTotal - prev.total;
      }
      previousTotals[idx] = { idle: times.idle, total: currentTotal };
    }
    if (totalDelta > 0) {
      lastPct = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
    }
    return lastPct;
  };
}

export function createObservatoryController(config = {}) {
  const repoRoot = config.repoRoot || REPO_ROOT;
  const homeDir = config.homeDir || DEFAULT_HOME_DIR;
  const enableNetworkProbes = config.enableNetworkProbes !== false;
  const enableAntigravityApi = config.enableAntigravityApi !== false;
  const vpsTargets = config.vpsTargets || DEFAULT_VPS_PROBES;

  const fileParseCache = new Map();
  const subagentScanCache = new Map();
  const openCodeCache = { sig: '', sessions: [] };
  const magpieCache = { sig: '', bundle: null };
  const sampleCpuPct = createCpuSampler();

  let cachedAgApi = {
    connected: false,
    map: new Map(),
    childrenByParent: new Map(),
    updatedAt: 0,
  };

  let cachedGitState = {
    branch: 'loading',
    head: '',
    ahead: 0,
    behind: 0,
    stashCount: 0,
    dirtyCount: 0,
    dirtyFiles: [],
    dirtyByArea: {},
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    commits: [],
    commitByTaskId: {},
    updatedAt: null,
  };

  let cachedProbes = {
    vps: vpsTargets.map((probe) => ({
      ...probe,
      status: 'pending',
      httpCode: null,
      latencyMs: null,
      detail: '',
    })),
    localPorts: LOCAL_PORTS.map((portEntry) => ({ ...portEntry, open: false })),
    updatedAt: null,
  };

  const telemetryHistory = [];
  let previousTokensTotal = null;

  async function refreshAntigravityLiveApi() {
    if (!enableAntigravityApi) return;
    const responsePayload = await callConversationService(
      'ListConversations',
      { pageSize: 15, includeArchived: false },
      10000
    );
    if (!responsePayload || !Array.isArray(responsePayload.conversations)) {
      cachedAgApi = { ...cachedAgApi, connected: false };
      return;
    }

    const convMap = new Map();
    for (const conv of responsePayload.conversations) {
      if (conv && conv.id) convMap.set(conv.id, conv);
    }

    const parentIds = new Set(responsePayload.conversations.slice(0, 5).map((conv) => conv.id));
    if (process.env.ANTIGRAVITY_CONVERSATION_ID)
      parentIds.add(process.env.ANTIGRAVITY_CONVERSATION_ID);

    const childrenByParent = new Map();
    await Promise.all(
      Array.from(parentIds).map(async (parentId) => {
        const childPayload = await callConversationService(
          'ListConversations',
          { parentConversationId: parentId, pageSize: 30, includeArchived: false },
          8000
        );
        if (
          childPayload &&
          Array.isArray(childPayload.conversations) &&
          childPayload.conversations.length > 0
        ) {
          childrenByParent.set(parentId, childPayload.conversations);
          for (const childConv of childPayload.conversations) {
            if (childConv && childConv.id) convMap.set(childConv.id, childConv);
          }
        }
      })
    );

    cachedAgApi = {
      connected: true,
      map: convMap,
      childrenByParent,
      updatedAt: Date.now(),
    };
  }

  async function collectAntigravity() {
    const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
    const liveApi = cachedAgApi;
    const sessions = [];
    const swarms = [];
    const candidateDirs = [];

    if (existsSync(brainDir)) {
      const entries = await readdir(brainDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const transcriptPath = path.join(
          brainDir,
          entry.name,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );
        const fileStat = await stat(transcriptPath).catch(() => null);
        if (fileStat && fileStat.isFile()) {
          candidateDirs.push({ convId: entry.name, transcriptPath, stat: fileStat });
        }
      }
      candidateDirs.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    }

    const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID || '';

    for (const dirEntry of candidateDirs.slice(0, 20)) {
      const [parsed, scannedSubagents] = await Promise.all([
        parseAntigravityTranscript(
          dirEntry.convId,
          dirEntry.transcriptPath,
          dirEntry.stat,
          fileParseCache,
          false
        ),
        scanFullTranscriptForSubagents(
          dirEntry.transcriptPath,
          dirEntry.stat,
          'ag',
          subagentScanCache
        ),
      ]);
      const liveMeta = liveApi.map.get(dirEntry.convId);
      const liveChildren = liveApi.childrenByParent.get(dirEntry.convId) || [];
      const mergedSubagents = [...scannedSubagents];

      for (const subEntry of parsed.subagents) {
        if (
          !mergedSubagents.some(
            (existing) => existing.role === subEntry.role && existing.type === subEntry.type
          )
        ) {
          mergedSubagents.push(subEntry);
        }
      }
      for (const childConv of liveChildren) {
        if (!mergedSubagents.some((existing) => existing.id === childConv.id)) {
          mergedSubagents.unshift({
            id: childConv.id,
            role: clip(
              childConv.annotations?.title || childConv.state?.summary || childConv.id.slice(0, 8),
              70
            ),
            type: 'live-subagent',
            model: 'antigravity',
            status: childConv.state?.runState === 'RUN_STATE_RUNNING' ? 'running' : 'idle',
            at:
              childConv.state?.updateTime || childConv.metadata?.createTime || parsed.lastTimestamp,
          });
        }
      }

      const swarmPlanPath = path.join(
        brainDir,
        dirEntry.convId,
        '.system_generated',
        'swarm',
        'plan.json'
      );
      let swarmPlan = null;
      if (existsSync(swarmPlanPath)) {
        const rawPlan = await readFile(swarmPlanPath, 'utf8').catch(() => '');
        const jsonPlan = safeJsonParse(rawPlan.trim());
        if (jsonPlan && jsonPlan.goal) {
          swarmPlan = jsonPlan;
          swarms.push({
            runtime: 'antigravity',
            conversationId: dirEntry.convId,
            title: clip(jsonPlan.goal.title || 'Swarm', 100),
            line: clip(jsonPlan.goal.line || '', 180),
            workers: Object.entries(jsonPlan.tasks || {}).map(([workerName, desc]) => ({
              name: workerName,
              task: clip(String(desc), 140),
            })),
            threads: (jsonPlan.threads || []).map((threadEntry) => ({
              id: threadEntry.id,
              title: clip(threadEntry.title || threadEntry.id, 80),
              tasks: Array.isArray(threadEntry.tasks) ? threadEntry.tasks : [],
            })),
          });
        }
      }

      const explicitRunState = liveMeta?.state?.runState || null;
      const status = deriveStatus(dirEntry.stat.mtimeMs, explicitRunState, parsed.hasRecentError);
      const title = clip(
        liveMeta?.annotations?.title ||
          liveMeta?.state?.summary ||
          parsed.title ||
          `Conversation ${dirEntry.convId.slice(0, 8)}`,
        100
      );

      sessions.push({
        id: dirEntry.convId,
        runtime: 'antigravity',
        runtimeLabel: 'Antigravity',
        title,
        status,
        runState: explicitRunState || (status === 'running' ? 'ACTIVE' : 'IDLE'),
        model: parsed.model || 'antigravity',
        branch: null,
        cwd: repoRoot,
        inCurrentWorkspace: true,
        isCurrentSession: dirEntry.convId === currentConvId,
        parentId: liveMeta?.metadata?.parentConversationId || null,
        rootId: liveMeta?.metadata?.rootConversationId || null,
        focus: parsed.focus || parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        errorCount: parsed.errorCount || 0,
        steps: parsed.stepCount,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.inputTokens + parsed.outputTokens,
        },
        subagents: mergedSubagents,
        swarmWorkers: swarmPlan ? Object.keys(swarmPlan.tasks || {}).length : 0,
        toolCounts: parsed.toolCounts || {},
        updatedAt: liveMeta?.state?.updateTime || parsed.lastTimestamp,
        mtimeMs: dirEntry.stat.mtimeMs,
        sourcePath: dirEntry.transcriptPath,
        recentEvents: parsed.events.slice(-10),
      });
    }

    const sessionById = new Map(sessions.map((entry) => [entry.id, entry]));
    for (const session of sessions) {
      if (session.parentId && sessionById.has(session.parentId)) {
        const parentSession = sessionById.get(session.parentId);
        if (!parentSession.subagents.some((subEntry) => subEntry.id === session.id)) {
          parentSession.subagents.push({
            id: session.id,
            role: session.title,
            type: 'conversation',
            model: session.model,
            status: session.status,
            at: session.updatedAt,
          });
        }
      }
    }

    return { connectedApi: liveApi.connected, sessions, swarms };
  }

  async function collectClaudeCode() {
    const projectsRoot = path.join(homeDir, '.claude', 'projects');
    if (!existsSync(projectsRoot)) return [];

    const projEntries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
    const candidates = [];

    for (const projEntry of projEntries) {
      if (!projEntry.isDirectory()) continue;
      const projPath = path.join(projectsRoot, projEntry.name);
      const files = await readdir(projPath, { withFileTypes: true }).catch(() => []);
      for (const fileEntry of files) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.jsonl')) continue;
        const fullPath = path.join(projPath, fileEntry.name);
        const fileStat = await stat(fullPath).catch(() => null);
        if (fileStat) {
          candidates.push({
            sessionId: fileEntry.name.replace(/\.jsonl$/i, ''),
            fullPath,
            projPath,
            stat: fileStat,
          });
        }
      }
    }

    candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    const sessions = [];

    for (const candidate of candidates.slice(0, 18)) {
      const [parsed, scannedSubs] = await Promise.all([
        parseClaudeSessionFile(
          candidate.sessionId,
          candidate.fullPath,
          candidate.stat,
          candidate.projPath,
          fileParseCache,
          false
        ),
        scanFullTranscriptForSubagents(
          candidate.fullPath,
          candidate.stat,
          'claude',
          subagentScanCache
        ),
      ]);
      const mergedSubs = [...parsed.subagents];
      for (const subEntry of scannedSubs) {
        if (
          !mergedSubs.some(
            (existing) => existing.id === subEntry.id || existing.role === subEntry.role
          )
        ) {
          mergedSubs.push(subEntry);
        }
      }
      const status = deriveStatus(candidate.stat.mtimeMs, null, parsed.hasRecentError);
      sessions.push({
        id: candidate.sessionId,
        runtime: 'claude',
        runtimeLabel: 'Claude Code',
        title: parsed.title,
        status,
        runState: status.toUpperCase(),
        model: parsed.model,
        branch: parsed.gitBranch || null,
        cwd: parsed.cwd || null,
        inCurrentWorkspace: matchesWorkspace(parsed.cwd, repoRoot),
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        errorCount: parsed.errorCount || 0,
        steps: parsed.turns,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.inputTokens + parsed.outputTokens,
        },
        subagents: mergedSubs,
        swarmWorkers: 0,
        toolCounts: parsed.toolCounts || {},
        updatedAt: parsed.lastTimestamp,
        mtimeMs: candidate.stat.mtimeMs,
        sourcePath: candidate.fullPath,
        recentEvents: parsed.events.slice(-10),
      });
    }

    return sessions;
  }

  async function collectCodex() {
    const codexRoot = path.join(homeDir, '.codex', 'sessions');
    if (!existsSync(codexRoot)) return [];
    const files = await walkJsonlFiles(codexRoot, 4);
    files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

    const sessions = [];
    for (const fileEntry of files.slice(0, 14)) {
      const parsed = await parseCodexRollout(
        fileEntry.fullPath,
        fileEntry.stat,
        fileParseCache,
        false
      );
      const status = deriveStatus(fileEntry.stat.mtimeMs, null, parsed.hasRecentError);
      sessions.push({
        id: parsed.sessionId,
        runtime: 'codex',
        runtimeLabel: 'Codex',
        title: parsed.title,
        status,
        runState: parsed.goalStatus ? parsed.goalStatus.toUpperCase() : status.toUpperCase(),
        model: parsed.model,
        branch: parsed.gitBranch || null,
        cwd: parsed.cwd || null,
        inCurrentWorkspace: matchesWorkspace(parsed.cwd, repoRoot),
        isCurrentSession: false,
        parentId: null,
        rootId: null,
        focus: parsed.lastAction || '',
        lastTool: parsed.lastTool || '',
        lastError: parsed.lastError || '',
        errorCount: parsed.errorCount || 0,
        steps: parsed.steps,
        tokens: {
          input: parsed.inputTokens,
          cached: parsed.cacheTokens,
          output: parsed.outputTokens,
          total: parsed.totalTokens,
        },
        subagents: [],
        swarmWorkers: 0,
        toolCounts: parsed.toolCounts || {},
        updatedAt: parsed.lastTimestamp,
        mtimeMs: fileEntry.stat.mtimeMs,
        sourcePath: fileEntry.fullPath,
        recentEvents: parsed.events.slice(-10),
      });
    }
    return sessions;
  }

  async function refreshGitState() {
    try {
      cachedGitState = await collectGitSnapshot(repoRoot);
    } catch {
      // Preserve last valid git snapshot
    }
  }

  async function refreshProbes() {
    const [vpsResults, portResults] = await Promise.all([
      enableNetworkProbes
        ? Promise.all(vpsTargets.map(probeHttpTarget))
        : Promise.resolve(cachedProbes.vps),
      Promise.all(
        LOCAL_PORTS.map(async (portEntry) => ({
          ...portEntry,
          open: await probeLocalTcpPort(portEntry.port),
        }))
      ),
    ]);
    cachedProbes = {
      vps: vpsResults,
      localPorts: portResults,
      updatedAt: new Date().toISOString(),
    };
  }

  async function buildSnapshot() {
    const [
      planBundle,
      agBundle,
      claudeSessions,
      codexSessions,
      openCodeSessions,
      magpieBundle,
      qoderSessions,
      geminiSessions,
      localSwarm,
    ] = await Promise.all([
      collectPlans(repoRoot),
      collectAntigravity(),
      collectClaudeCode(),
      collectCodex(),
      collectOpenCodeSessions(homeDir, repoRoot, openCodeCache),
      collectMagpieTelemetry(homeDir, repoRoot, magpieCache),
      collectGenericJsonlRuntime(
        path.join(homeDir, '.qoder', 'projects'),
        'qoder',
        'Qoder',
        repoRoot
      ),
      collectGenericJsonlRuntime(
        path.join(homeDir, '.gemini', 'tmp'),
        'gemini-cli',
        'Gemini CLI',
        repoRoot
      ),
      collectLocalSwarmManifest(repoRoot),
    ]);

    const allSessions = [
      ...agBundle.sessions,
      ...claudeSessions,
      ...codexSessions,
      ...openCodeSessions,
      ...magpieBundle.sessions,
      ...qoderSessions,
      ...geminiSessions,
    ].sort((left, right) => right.mtimeMs - left.mtimeMs);

    // Attach git commit SHAs and build live DAGs for every plan
    for (const planEntry of planBundle.plans) {
      for (const taskEntry of planEntry.tasks) {
        const commitHit = cachedGitState.commitByTaskId[taskEntry.id];
        if (commitHit) {
          taskEntry.commitSha = commitHit.sha;
          taskEntry.commitSubject = commitHit.subject;
        }
      }
      planEntry.dag = buildPlanDag(
        planEntry.tasks,
        planEntry.waves,
        allSessions,
        cachedGitState.dirtyFiles || []
      );
    }

    const activityFeed = [];
    for (const session of allSessions.slice(0, 30)) {
      for (const eventEntry of session.recentEvents || []) {
        activityFeed.push({
          at: eventEntry.at || session.updatedAt,
          runtime: session.runtime,
          runtimeLabel: session.runtimeLabel,
          sessionId: session.id,
          sessionTitle: clip(session.title, 48),
          kind: eventEntry.kind,
          tool: eventEntry.tool,
          summary: eventEntry.summary,
        });
      }
    }
    activityFeed.sort((left, right) => (right.at || '').localeCompare(left.at || ''));

    const runtimeCounts = {};
    let runningCount = 0;
    let errorSessionCount = 0;
    let subagentTotal = 0;
    let totalInput = 0;
    let totalCached = 0;
    let totalOutput = 0;

    for (const session of allSessions) {
      runtimeCounts[session.runtime] = (runtimeCounts[session.runtime] || 0) + 1;
      if (session.status === 'running') runningCount += 1;
      if (session.status === 'error' || session.lastError) errorSessionCount += 1;
      subagentTotal += (session.subagents || []).length;
      totalInput += session.tokens?.input || 0;
      totalCached += session.tokens?.cached || 0;
      totalOutput += session.tokens?.output || 0;
    }

    const swarms = [...agBundle.swarms];
    if (localSwarm) swarms.push(localSwarm);

    const memTotalGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
    const memUsedGb = Math.round(((os.totalmem() - os.freemem()) / 1024 ** 3) * 10) / 10;
    const memPct = memTotalGb > 0 ? Math.round((memUsedGb / memTotalGb) * 100) : 0;
    const cpuPct = sampleCpuPct();
    const tokensTotal = totalInput + totalOutput;
    const tokenDelta =
      previousTokensTotal === null ? 0 : Math.max(0, tokensTotal - previousTokensTotal);
    previousTokensTotal = tokensTotal;

    const vpsProbes = cachedProbes.vps || [];
    const upProbes = vpsProbes.filter((probe) => probe.status === 'up');
    const measuredLatencies = vpsProbes
      .map((probe) => probe.latencyMs)
      .filter((ms) => typeof ms === 'number' && ms >= 0);
    const vpsAvgLatencyMs =
      measuredLatencies.length > 0
        ? Math.round(measuredLatencies.reduce((acc, ms) => acc + ms, 0) / measuredLatencies.length)
        : 0;

    const nowIso = new Date().toISOString();
    const recentWindowCutoffMs = Date.now() - 120_000;
    const recentEventsInWindow = activityFeed.filter(
      (entry) => Date.parse(entry.at || '') >= recentWindowCutoffMs
    );

    telemetryHistory.push({
      at: nowIso,
      cpuPct,
      memPct,
      runningSessions: runningCount,
      totalSessions: allSessions.length,
      subagents: subagentTotal,
      tokensTotal,
      tokenDelta,
      recentEvents: recentEventsInWindow.length,
      errors: errorSessionCount,
      vpsUp: upProbes.length,
      vpsAvgLatencyMs,
    });
    if (telemetryHistory.length > TELEMETRY_HISTORY_LIMIT) {
      telemetryHistory.shift();
    }

    const activePlan =
      planBundle.plans.find((planEntry) => planEntry.id === planBundle.defaultPlanId) ||
      planBundle.plans[0] ||
      null;
    const flowGraph = buildFlowGraph(
      allSessions,
      swarms,
      activePlan,
      cachedGitState,
      cachedProbes,
      activityFeed,
      repoRoot
    );
    const analytics = computeAnalytics(allSessions, activityFeed);

    const cacheDenom = totalInput + totalCached;
    const cacheHitPct = cacheDenom > 0 ? Math.round((totalCached / cacheDenom) * 1000) / 10 : 0;

    const battle = {
      bossName: activePlan ? clip(activePlan.title, 54) : 'REPO CHAOS BOSS',
      bossHpPct: activePlan ? Math.max(0, Math.round((100 - activePlan.percent) * 10) / 10) : 100,
      bossShieldCount: activePlan?.dag?.stats?.blocked || 0,
      readyStrikeCount: activePlan?.dag?.stats?.ready || 0,
      activeWarriors: runningCount,
      sidekickSwarmCount: subagentTotal,
      glitchCount: errorSessionCount + vpsProbes.filter((probe) => probe.status === 'down').length,
      magpieBoostCalls: magpieBundle.summary.totalRecentCalls,
    };

    return {
      rawSessions: allSessions,
      snapshot: {
        version: 3,
        generatedAt: nowIso,
        repoRoot: normalizePathSlashes(repoRoot),
        antigravityApiConnected: agBundle.connectedApi,
        host: {
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus().length,
          cpuModel: clip(os.cpus()[0]?.model || 'CPU', 48),
          cpuPct,
          memUsedGb,
          memTotalGb,
          memPct,
          uptimeSec: Math.round(process.uptime()),
        },
        summary: {
          totalSessions: allSessions.length,
          runningSessions: runningCount,
          errorSessions: errorSessionCount,
          subagents: subagentTotal,
          swarms: swarms.length,
          runtimeCounts,
          tokens: {
            input: totalInput,
            cached: totalCached,
            output: totalOutput,
            total: tokensTotal,
            delta: tokenDelta,
            cacheHitPct,
          },
        },
        plans: planBundle.plans,
        defaultPlanId: planBundle.defaultPlanId,
        sessions: allSessions.map(({ sourcePath: _sp, ...publicSession }) => publicSession),
        swarms,
        magpie: magpieBundle.summary,
        battle,
        activityFeed: activityFeed.slice(0, 90),
        git: cachedGitState,
        probes: cachedProbes,
        flowGraph,
        analytics,
        telemetryHistory: telemetryHistory.slice(),
      },
    };
  }

  async function readSessionDetail(runtime, id, snapshotSessions) {
    const target = snapshotSessions.find(
      (session) => session.runtime === runtime && session.id === id
    );
    if (!target || !target.sourcePath) return null;
    const fileStat = await stat(target.sourcePath).catch(() => null);
    if (!fileStat) return null;

    if (runtime === 'antigravity') {
      const detail = await parseAntigravityTranscript(
        id,
        target.sourcePath,
        fileStat,
        fileParseCache,
        true
      );
      return { ...target, sourcePath: undefined, detail };
    }
    if (runtime === 'claude') {
      const detail = await parseClaudeSessionFile(
        id,
        target.sourcePath,
        fileStat,
        path.dirname(target.sourcePath),
        fileParseCache,
        true
      );
      return { ...target, sourcePath: undefined, detail };
    }
    if (runtime === 'codex') {
      const detail = await parseCodexRollout(target.sourcePath, fileStat, fileParseCache, true);
      return { ...target, sourcePath: undefined, detail };
    }
    if (runtime === 'opencode') {
      const detail = readOpenCodeDetail(target.sourcePath, id);
      return { ...target, sourcePath: undefined, detail };
    }
    return {
      ...target,
      sourcePath: undefined,
      detail: { events: target.recentEvents || [], toolCounts: target.toolCounts || {} },
    };
  }

  return {
    repoRoot,
    refreshAntigravityLiveApi,
    refreshGitState,
    refreshProbes,
    buildSnapshot,
    readSessionDetail,
  };
}

function resolveConfinedMount(baseDir, subPath, allowedExts, cacheImmutable) {
  if (!subPath || subPath.includes('..') || subPath.includes('\0') || subPath.includes('\\')) {
    return null;
  }
  const resolvedRoot = path.resolve(baseDir);
  const candidatePath = path.resolve(resolvedRoot, `.${subPath}`);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (!candidatePath.startsWith(rootPrefix)) {
    return null;
  }
  const ext = path.extname(candidatePath).toLowerCase();
  if (allowedExts && !allowedExts.has(ext)) return null;
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) return null;
  return { filePath: candidatePath, contentType, cacheImmutable };
}

function resolveSafeStaticFile(pathname) {
  if (pathname === '/vendor/p5.min.js') {
    return {
      filePath: VENDOR_P5_PATH,
      contentType: 'application/javascript; charset=utf-8',
      cacheImmutable: true,
    };
  }
  if (pathname.startsWith('/mw-assets/')) {
    return resolveConfinedMount(
      MW_ASSETS_DIR,
      pathname.slice('/mw-assets'.length),
      ALLOWED_ASSET_EXTS,
      true
    );
  }
  if (pathname.startsWith('/mw-art/')) {
    return resolveConfinedMount(
      MW_ART_DIR,
      pathname.slice('/mw-art'.length),
      ALLOWED_ART_EXTS,
      true
    );
  }
  const normalized = pathname === '/' ? '/index.html' : pathname;
  return resolveConfinedMount(PUBLIC_DIR, normalized, null, false);
}

export async function createObservatoryServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 4190;
  const repoRoot = options.repo || REPO_ROOT;
  const controller = createObservatoryController({
    repoRoot,
    homeDir: options.homeDir,
    enableNetworkProbes: options.enableNetworkProbes,
    enableAntigravityApi: options.enableAntigravityApi,
    vpsTargets: options.vpsTargets,
  });

  const sseClients = new Set();
  let lastSnapshot = null;
  let lastRawSessions = [];
  let lastPayloadJson = '';
  let refreshInFlight = false;

  async function refreshAndBroadcast(force = false) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const built = await controller.buildSnapshot();
      lastRawSessions = built.rawSessions;
      lastSnapshot = built.snapshot;
      const serialized = JSON.stringify(built.snapshot);
      if (force || serialized !== lastPayloadJson) {
        lastPayloadJson = serialized;
        const sseFrame = `event: snapshot\ndata: ${serialized}\n\n`;
        for (const clientStream of sseClients) {
          try {
            clientStream.write(sseFrame);
          } catch {
            sseClients.delete(clientStream);
          }
        }
      }
    } finally {
      refreshInFlight = false;
    }
  }

  // Fast initial snapshot immediately (does not block on slow external network probes)
  await controller.refreshGitState();
  await refreshAndBroadcast(true);

  const timers = [];
  let planWatcher = null;
  let debounceTimer = null;

  if (options.enableBackgroundTimers !== false) {
    // Trigger initial slow probes asynchronously right after boot
    void Promise.all([controller.refreshProbes(), controller.refreshAntigravityLiveApi()]).then(
      () => refreshAndBroadcast(true)
    );

    const sseTimer = setInterval(() => {
      void refreshAndBroadcast(false);
    }, SSE_TICK_MS);
    sseTimer.unref();

    const gitTimer = setInterval(() => {
      void controller.refreshGitState();
    }, GIT_INTERVAL_MS);
    gitTimer.unref();

    const agApiTimer = setInterval(() => {
      void controller.refreshAntigravityLiveApi();
    }, 4_000);
    agApiTimer.unref();

    const probeTimer = setInterval(() => {
      void controller.refreshProbes();
    }, PROBE_INTERVAL_MS);
    probeTimer.unref();

    const heartbeatTimer = setInterval(() => {
      for (const clientStream of sseClients) {
        try {
          clientStream.write(': keepalive\n\n');
        } catch {
          sseClients.delete(clientStream);
        }
      }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref();

    timers.push(sseTimer, gitTimer, agApiTimer, probeTimer, heartbeatTimer);

    const planDir = path.join(repoRoot, '.plan');
    if (existsSync(planDir)) {
      try {
        planWatcher = watch(planDir, { recursive: true }, () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            void controller.refreshGitState().then(() => refreshAndBroadcast(true));
          }, 200);
          debounceTimer.unref();
        });
      } catch {
        // Fallback to interval polling
      }
    }
  }

  const httpServer = createServer(async (httpRequest, httpResponse) => {
    const reqUrl = new URL(
      httpRequest.url || '/',
      `http://${httpRequest.headers.host || '127.0.0.1'}`
    );

    if (httpRequest.method !== 'GET') {
      httpResponse.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      httpResponse.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    if (reqUrl.pathname === '/health') {
      httpResponse.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      httpResponse.end(
        JSON.stringify({
          ok: true,
          version: 3,
          host,
          port: httpServer.address()?.port ?? port,
          clients: sseClients.size,
          uptimeSec: Math.round(process.uptime()),
          p5Vendored: existsSync(VENDOR_P5_PATH),
        })
      );
      return;
    }

    if (reqUrl.pathname === '/api/state') {
      if (!lastSnapshot || reqUrl.searchParams.get('fresh') === '1') {
        await Promise.all([controller.refreshGitState(), controller.refreshProbes()]);
        await refreshAndBroadcast(true);
      }
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
      });
      httpResponse.end(lastPayloadJson || JSON.stringify(lastSnapshot || {}));
      return;
    }

    if (reqUrl.pathname === '/api/session') {
      const runtime = reqUrl.searchParams.get('runtime') || '';
      const id = reqUrl.searchParams.get('id') || '';
      const detail = await controller.readSessionDetail(runtime, id, lastRawSessions);
      if (!detail) {
        httpResponse.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        httpResponse.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
      });
      httpResponse.end(JSON.stringify(detail));
      return;
    }

    if (reqUrl.pathname === '/api/git/commit') {
      const sha = reqUrl.searchParams.get('sha') || '';
      const detail = await readGitCommitDetail(repoRoot, sha);
      if (!detail) {
        httpResponse.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        httpResponse.end(JSON.stringify({ error: 'Invalid or unknown commit SHA' }));
        return;
      }
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
      });
      httpResponse.end(JSON.stringify(detail));
      return;
    }

    if (reqUrl.pathname === '/api/probe') {
      const targetUrl = reqUrl.searchParams.get('url') || '';
      const validation = validateProbeUrl(targetUrl);
      if (!validation.valid) {
        httpResponse.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        httpResponse.end(JSON.stringify({ error: validation.reason }));
        return;
      }
      const probeResult = await probeHttpTarget({
        id: 'custom-probe',
        label: validation.normalizedUrl,
        url: validation.normalizedUrl,
      });
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
      });
      httpResponse.end(JSON.stringify(probeResult));
      return;
    }

    if (reqUrl.pathname === '/api/export') {
      if (!lastSnapshot) await refreshAndBroadcast(true);
      const format = (reqUrl.searchParams.get('format') || 'json').toLowerCase();
      if (format === 'markdown' || format === 'md') {
        const mdReport = formatSnapshotMarkdown(lastSnapshot);
        httpResponse.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="moonwitness-observatory-report.md"',
        });
        httpResponse.end(mdReport);
        return;
      }
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="moonwitness-observatory-snapshot.json"',
      });
      httpResponse.end(JSON.stringify(lastSnapshot, null, 2));
      return;
    }

    if (reqUrl.pathname === '/api/stream') {
      httpResponse.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      httpResponse.write('retry: 2000\n\n');
      if (lastPayloadJson) {
        httpResponse.write(`event: snapshot\ndata: ${lastPayloadJson}\n\n`);
      }
      sseClients.add(httpResponse);
      httpRequest.on('close', () => {
        sseClients.delete(httpResponse);
      });
      return;
    }

    // Safe static asset serving (public/* + /vendor/p5.min.js)
    const resolvedAsset = resolveSafeStaticFile(reqUrl.pathname);
    if (resolvedAsset && existsSync(resolvedAsset.filePath)) {
      const fileContent = await readFile(resolvedAsset.filePath).catch(() => null);
      if (fileContent) {
        const headers = {
          ...SECURITY_HEADERS,
          'Content-Type': resolvedAsset.contentType,
        };
        if (resolvedAsset.cacheImmutable) {
          headers['Cache-Control'] = 'public, max-age=86400, immutable';
        }
        httpResponse.writeHead(200, headers);
        httpResponse.end(fileContent);
        return;
      }
    }

    httpResponse.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    httpResponse.end(JSON.stringify({ error: 'Not Found' }));
  });

  const stop = async () => {
    for (const timer of timers) clearInterval(timer);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (planWatcher) planWatcher.close();
    for (const clientStream of sseClients) clientStream.end();
    sseClients.clear();
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return {
    server: httpServer,
    address: httpServer.address(),
    refreshAndBroadcast,
    stop,
  };
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry) {
  const cliOptions = parseArgs(process.argv.slice(2));
  createObservatoryServer(cliOptions)
    .then((handle) => {
      const boundPort = handle.address?.port ?? cliOptions.port;
      process.stdout.write(
        `MoonWitness Agent Observatory v3 listening at http://${cliOptions.host}:${boundPort}\n`
      );
      const handleShutdown = () => {
        void handle.stop().finally(() => process.exit(0));
      };
      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);
    })
    .catch((err) => {
      process.stderr.write(
        `Fatal observatory error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    });
}
