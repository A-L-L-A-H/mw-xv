#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const INDEX_HTML_PATH = path.join(SCRIPT_DIR, 'public', 'index.html');
const HOME_DIR = os.homedir();

const HEAD_CHUNK_BYTES = 32 * 1024;
const TAIL_CHUNK_BYTES = 192 * 1024;
const DETAIL_TAIL_BYTES = 512 * 1024;
const ACTIVE_THRESHOLD_MS = 120_000;
const RECENT_THRESHOLD_MS = 15 * 60_000;
const SSE_TICK_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const PROBE_INTERVAL_MS = 10_000;
const GIT_INTERVAL_MS = 4_000;

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
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const DEFAULT_VPS_PROBES = Object.freeze([
  { id: 'vps-ip-readyz', label: 'VPS IP :8000 /readyz', url: 'http://163.61.134.104:8000/readyz' },
  {
    id: 'vps-ip-setup',
    label: 'VPS IP :8000 /auth/setup-status',
    url: 'http://163.61.134.104:8000/auth/setup-status',
  },
  { id: 'vps-apps-tls', label: 'HTTPS apps.moonwitness.biz.id', url: 'https://apps.moonwitness.biz.id/readyz' },
  { id: 'vps-wa-tls', label: 'HTTPS wa.apps.moonwitness.biz.id', url: 'https://wa.apps.moonwitness.biz.id/readyz' },
]);

const LOCAL_PORTS = Object.freeze([
  { port: 3000, label: 'API / Dev :3000' },
  { port: 3001, label: 'API :3001' },
  { port: 4174, label: 'Board :4174' },
  { port: 4190, label: 'Observatory :4190' },
  { port: 5173, label: 'Vite :5173' },
  { port: 5432, label: 'Postgres :5432' },
  { port: 6379, label: 'Redis :6379' },
  { port: 8000, label: 'Bootstrap :8000' },
]);

function parseArgs(argv) {
  const opts = {
    host: process.env.OBSERVATORY_HOST || '127.0.0.1',
    port: Number(process.env.OBSERVATORY_PORT || process.env.PORT || 4190),
    repo: process.env.OBSERVATORY_REPO || REPO_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) {
      opts.host = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      opts.port = Number(argv[++i]);
    } else if (arg === '--repo' && argv[i + 1]) {
      opts.repo = path.resolve(argv[++i]);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    opts.port = 4190;
  }
  return opts;
}

function redactSecrets(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/g, '[REDACTED]')
    .replace(
      /((?:PASSWORD|SECRET|TOKEN|API_KEY|CSRF_TOKEN|DATABASE_URL|POSTGRES_PASSWORD)\s*[:=]\s*)(["']?)[^\s"',;}\n]+\2/gi,
      '$1[REDACTED]',
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1[REDACTED]$2');
}

function clip(text, max = 180) {
  if (typeof text !== 'string') return '';
  const cleaned = redactSecrets(text).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function safeJsonParse(line) {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readHeadAndTailLines(filePath, fileSize, tailBytes = TAIL_CHUNK_BYTES) {
  let fh;
  try {
    fh = await open(filePath, 'r');
    if (fileSize <= HEAD_CHUNK_BYTES + tailBytes) {
      const buf = Buffer.alloc(fileSize);
      const { bytesRead } = await fh.read(buf, 0, fileSize, 0);
      const text = buf.toString('utf8', 0, bytesRead);
      const lines = text.split(/\r?\n/).filter(Boolean);
      return { headLines: lines, tailLines: lines, full: true };
    }

    const headBuf = Buffer.alloc(HEAD_CHUNK_BYTES);
    const headRes = await fh.read(headBuf, 0, HEAD_CHUNK_BYTES, 0);
    const headRaw = headBuf.toString('utf8', 0, headRes.bytesRead);
    const headSplit = headRaw.split(/\r?\n/);
    if (headSplit.length > 1) headSplit.pop();

    const tailStart = Math.max(0, fileSize - tailBytes);
    const tailLen = fileSize - tailStart;
    const tailBuf = Buffer.alloc(tailLen);
    const tailRes = await fh.read(tailBuf, 0, tailLen, tailStart);
    const tailRaw = tailBuf.toString('utf8', 0, tailRes.bytesRead);
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
    if (fh) await fh.close().catch(() => {});
  }
}

function normalizePathSlashes(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
}

function matchesWorkspace(cwd, repoRoot) {
  if (!cwd || !repoRoot) return false;
  const a = normalizePathSlashes(cwd).toLowerCase().replace(/^file:\/\/\//, '');
  const b = normalizePathSlashes(repoRoot).toLowerCase();
  const repoName = path.basename(b);
  return a.includes(b) || a.endsWith(`/${repoName}`) || a.includes(`/${repoName}-`);
}

function deriveStatus(mtimeMs, explicitRunState, hasRecentError) {
  if (explicitRunState === 'RUN_STATE_RUNNING') return 'running';
  if (explicitRunState === 'RUN_STATE_CANCELLING') return 'running';
  const age = Date.now() - mtimeMs;
  if (age <= ACTIVE_THRESHOLD_MS) return 'running';
  if (hasRecentError && age <= RECENT_THRESHOLD_MS) return 'error';
  if (age <= RECENT_THRESHOLD_MS) return 'recent';
  return 'idle';
}

function parseAntigravityArg(val) {
  if (typeof val !== 'string') return val;
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      return JSON.parse(val);
    } catch {
      return val.slice(1, -1);
    }
  }
  return val;
}

// ============================================================================
// 1. PLAN PARSER (.plan/*.md + wave playbooks)
// ============================================================================

async function collectPlans(repoRoot) {
  const planDir = path.join(repoRoot, '.plan');
  if (!existsSync(planDir)) return { plans: [], defaultPlanId: null };

  const entries = await readdir(planDir, { withFileTypes: true }).catch(() => []);
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  const plans = [];

  for (const fileName of mdFiles) {
    const planId = fileName.replace(/\.md$/i, '');
    const masterPath = path.join(planDir, fileName);
    const content = await readFile(masterPath, 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/);

    const titleLine = lines.find((l) => l.startsWith('# ')) || `# ${planId}`;
    const title = titleLine.replace(/^#\s+/, '').trim();

    const subDir = path.join(planDir, planId);
    const waveDetailsByTask = new Map();
    const waveFiles = [];

    if (existsSync(subDir)) {
      const subEntries = await readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const se of subEntries) {
        if (!se.isFile() || !se.name.endsWith('.md')) continue;
        waveFiles.push(se.name);
        if (se.name.startsWith('ADR-')) continue;
        const wText = await readFile(path.join(subDir, se.name), 'utf8').catch(() => '');
        parseWavePlaybookDetails(wText, se.name, waveDetailsByTask);
      }
    }

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

      const taskMatch = rawLine.match(/^\s*-\s+\[([ xX])\]\s+\*\*([A-Za-z0-9_-]+)\*\*\s*[—-]\s*(.+)$/);
      if (taskMatch) {
        const done = taskMatch[1].toLowerCase() === 'x';
        const id = taskMatch[2].trim();
        const taskTitle = taskMatch[3].trim();
        const detail = waveDetailsByTask.get(id) || {};
        const taskObj = {
          id,
          title: taskTitle,
          done,
          wave: currentWave ? currentWave.title : 'General',
          playbook: detail.playbook || null,
          ownerFiles: detail.ownerFiles || '',
          dependsOn: detail.dependsOn || '',
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

    const doneCount = tasks.filter((t) => t.done).length;
    const nextTask = tasks.find((t) => !t.done) || null;
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
      waves: waves.map((w) => ({
        title: w.title,
        done: w.done,
        total: w.total,
        percent: w.total > 0 ? Math.round((w.done / w.total) * 100) : 0,
      })),
      tasks,
    });
  }

  plans.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const preferred = plans.find((p) => p.id === 'coolify-sovereign-paas-single-db') || plans[0] || null;
  return { plans, defaultPlanId: preferred ? preferred.id : null };
}

function parseWavePlaybookDetails(markdown, playbookName, map) {
  const sections = markdown.split(/\r?\n(?=###\s+\[[ xX]\]\s+M\d+)/);
  for (const sec of sections) {
    const header = sec.match(/^###\s+\[[ xX]\]\s+(M\d+)\s*[—-]\s*(.+)/);
    if (!header) continue;
    const id = header[1].trim();
    const extractField = (label) => {
      const re = new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm');
      const m = sec.match(re);
      return m ? m[1].trim() : '';
    };
    const specMatch = sec.match(/-\s+\*\*Exact Spec:\*\*([\s\S]*?)(?=\n-\s+\*\*(?:Acceptance Criteria|Expected Output|Verify|Commit):|$)/);
    map.set(id, {
      playbook: playbookName,
      ownerFiles: extractField('Owner File\\(s\\)'),
      dependsOn: extractField('Depends On'),
      acceptance: extractField('Acceptance Criteria'),
      expected: extractField('Expected Output'),
      verify: extractField('Verify'),
      spec: specMatch ? clip(specMatch[1], 700) : '',
    });
  }
}

// ============================================================================
// 2. ANTIGRAVITY COLLECTOR (ConversationService API + brain/transcripts + swarm)
// ============================================================================

let cachedAgApi = {
  connected: false,
  map: new Map(),
  childrenByParent: new Map(),
  updatedAt: 0,
};

async function callConversationService(method, body, timeoutMs = 5000) {
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!addr || !csrf) return null;

  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${addr}/product.v1.ConversationService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAntigravityLiveApi() {
  const data = await callConversationService('ListConversations', { pageSize: 15, includeArchived: false }, 10000);
  if (!data || !Array.isArray(data.conversations)) {
    cachedAgApi = { ...cachedAgApi, connected: false };
    return;
  }

  const map = new Map();
  for (const conv of data.conversations) {
    if (conv && conv.id) map.set(conv.id, conv);
  }

  // Fetch live child/subagent conversations for top 5 most recent conversations + current conversation
  const parentIds = new Set(data.conversations.slice(0, 5).map((c) => c.id));
  if (process.env.ANTIGRAVITY_CONVERSATION_ID) parentIds.add(process.env.ANTIGRAVITY_CONVERSATION_ID);

  const childrenByParent = new Map();
  await Promise.all(
    Array.from(parentIds).map(async (pid) => {
      const childRes = await callConversationService(
        'ListConversations',
        { parentConversationId: pid, pageSize: 30, includeArchived: false },
        8000,
      );
      if (childRes && Array.isArray(childRes.conversations) && childRes.conversations.length > 0) {
        childrenByParent.set(pid, childRes.conversations);
        for (const ch of childRes.conversations) {
          if (ch && ch.id) map.set(ch.id, ch);
        }
      }
    }),
  );

  cachedAgApi = {
    connected: true,
    map,
    childrenByParent,
    updatedAt: Date.now(),
  };
}

const fileParseCache = new Map();
const subagentScanCache = new Map();

async function scanFullTranscriptForSubagents(filePath, fileStat, kind) {
  const key = `${kind}:${filePath}`;
  const cached = subagentScanCache.get(key);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  // Bound full scan to files <= 25 MB so huge transcripts stay snappy
  if (fileStat.size > 25 * 1024 * 1024) {
    const empty = [];
    subagentScanCache.set(key, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: empty });
    return empty;
  }

  const raw = await readFile(filePath, 'utf8').catch(() => '');
  const found = [];
  const seen = new Set();

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    if (kind === 'ag') {
      if (!line.includes('"invoke_subagent"') && !line.includes('"name":"swarm"')) continue;
      const rec = safeJsonParse(line);
      if (!rec || !Array.isArray(rec.tool_calls)) continue;
      for (const tc of rec.tool_calls) {
        if (!tc) continue;
        const args = tc.args || {};
        if (tc.name === 'invoke_subagent') {
          const role = clip(String(parseAntigravityArg(args.Role || args.TypeName || 'subagent')), 70);
          const typeName = clip(String(parseAntigravityArg(args.TypeName || 'subagent')), 40);
          const subModel = clip(String(parseAntigravityArg(args.Model || 'inherit')), 30);
          const dedupe = `sub:${role}:${typeName}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            found.push({
              id: `sub-${rec.step_index ?? found.length}`,
              role,
              type: typeName,
              model: subModel,
              status: 'done',
              at: rec.created_at || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        } else if (tc.name === 'swarm' && String(parseAntigravityArg(args.action || '')) === 'add') {
          const wName = clip(String(parseAntigravityArg(args.name || 'worker')), 40);
          const wModel = clip(String(parseAntigravityArg(args.model || 'inherit')), 30);
          const dedupe = `swarm:${wName}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            found.push({
              id: `swarm-${wName}`,
              role: wName,
              type: 'swarm-worker',
              model: wModel,
              status: 'done',
              at: rec.created_at || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        }
      }
    } else if (kind === 'claude') {
      if (!line.includes('"name":"Agent"') && !line.includes('"name":"Task"')) continue;
      const rec = safeJsonParse(line);
      const blocks = Array.isArray(rec?.message?.content) ? rec.message.content : [];
      for (const blk of blocks) {
        if (blk && blk.type === 'tool_use' && (blk.name === 'Agent' || blk.name === 'Task')) {
          const role = clip(String(blk.input?.description || blk.input?.subagent_type || 'Claude Subagent'), 70);
          const typeName = clip(String(blk.input?.subagent_type || 'general-purpose'), 40);
          const dedupe = `${blk.id || role}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            found.push({
              id: blk.id || `claude-sub-${found.length}`,
              role,
              type: typeName,
              model: clip(String(blk.input?.model || rec.message?.model || 'inherit'), 40),
              status: 'done',
              at: rec.timestamp || new Date(fileStat.mtimeMs).toISOString(),
            });
          }
        }
      }
    }
  }

  subagentScanCache.set(key, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: found });
  return found;
}

async function parseAntigravityTranscript(convId, transcriptPath, fileStat, detailMode = false) {
  const cacheKey = `ag:${transcriptPath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    transcriptPath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES,
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
  let hasRecentError = false;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const subagents = [];
  const events = [];

  for (const line of headLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (!title && rec.type === 'USER_INPUT' && typeof rec.content === 'string') {
      const reqMatch = rec.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
      const rawPrompt = reqMatch ? reqMatch[1] : rec.content;
      title = clip(rawPrompt.replace(/^#+\s*/gm, ''), 95);
    }
    if (!model && rec.model) model = rec.model;
  }

  const seenSub = new Set();
  for (const line of tailLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (typeof rec.step_index === 'number') stepCount = Math.max(stepCount, rec.step_index + 1);
    if (rec.created_at) lastTimestamp = rec.created_at;
    if (rec.model) model = rec.model;
    if (typeof rec.input_tokens === 'number') inputTokens += rec.input_tokens;
    if (typeof rec.cache_read_tokens === 'number') cacheTokens += rec.cache_read_tokens;
    if (typeof rec.output_tokens === 'number') outputTokens += rec.output_tokens;

    if (rec.status === 'ERROR' || rec.error) {
      hasRecentError = true;
      lastError = clip(rec.error || rec.content || 'Step error', 160);
      events.push({
        at: rec.created_at || lastTimestamp,
        kind: 'error',
        tool: 'error',
        summary: lastError,
      });
    }

    if (Array.isArray(rec.tool_calls)) {
      for (const tc of rec.tool_calls) {
        if (!tc || !tc.name) continue;
        const args = tc.args || {};
        lastTool = tc.name;
        if (tc.name === 'update_focus' && args.focus) {
          focus = clip(String(parseAntigravityArg(args.focus)), 120);
          lastAction = focus;
          events.push({ at: rec.created_at || lastTimestamp, kind: 'focus', tool: 'update_focus', summary: focus });
        } else if (tc.name === 'invoke_subagent') {
          const role = clip(String(parseAntigravityArg(args.Role || args.TypeName || 'subagent')), 60);
          const typeName = clip(String(parseAntigravityArg(args.TypeName || 'subagent')), 40);
          const subModel = clip(String(parseAntigravityArg(args.Model || 'inherit')), 30);
          const key = `${typeName}:${role}:${rec.step_index}`;
          if (!seenSub.has(key)) {
            seenSub.add(key);
            subagents.push({
              id: `${convId.slice(0, 8)}-s${rec.step_index}`,
              role,
              type: typeName,
              model: subModel,
              at: rec.created_at || lastTimestamp,
            });
          }
          lastAction = `Spawned subagent: ${role} (${typeName})`;
          events.push({ at: rec.created_at || lastTimestamp, kind: 'subagent', tool: 'invoke_subagent', summary: lastAction });
        } else if (tc.name === 'swarm') {
          const action = String(parseAntigravityArg(args.action || 'swarm'));
          const wName = String(parseAntigravityArg(args.name || ''));
          const summary = wName ? `swarm ${action}: ${wName}` : `swarm ${action}`;
          lastAction = clip(summary, 120);
          events.push({ at: rec.created_at || lastTimestamp, kind: 'swarm', tool: 'swarm', summary: lastAction });
        } else if (tc.name === 'run_command') {
          const summary = clip(
            String(parseAntigravityArg(args.toolSummary || args.CommandLine || 'run_command')),
            120,
          );
          lastAction = summary;
          events.push({ at: rec.created_at || lastTimestamp, kind: 'tool', tool: 'run_command', summary });
        } else {
          const target = parseAntigravityArg(args.Path || args.query || args.focus || '');
          const summary = target ? `${tc.name} ${clip(String(target), 95)}` : tc.name;
          lastAction = summary;
          events.push({ at: rec.created_at || lastTimestamp, kind: 'tool', tool: tc.name, summary });
        }
      }
    } else if (rec.type === 'USER_INPUT' && typeof rec.content === 'string') {
      const reqMatch = rec.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
      const msg = clip(reqMatch ? reqMatch[1] : rec.content, 120);
      if (msg) {
        events.push({ at: rec.created_at || lastTimestamp, kind: 'user', tool: 'user', summary: msg });
      }
    }
  }

  const value = {
    title,
    model,
    focus,
    lastAction,
    lastTool,
    lastError,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    stepCount,
    lastTimestamp,
    subagents,
    events: events.slice(-40),
  };

  fileParseCache.set(cacheKey, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value });
  return value;
}

async function collectAntigravity(repoRoot) {
  const brainDir = path.join(HOME_DIR, '.gemini', 'antigravity', 'brain');
  const liveApi = cachedAgApi;
  const sessions = [];
  const swarms = [];
  const dirs = [];

  if (existsSync(brainDir)) {
    const entries = await readdir(brainDir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const tPath = path.join(brainDir, ent.name, '.system_generated', 'logs', 'transcript.jsonl');
      const st = await stat(tPath).catch(() => null);
      if (st && st.isFile()) {
        dirs.push({ convId: ent.name, transcriptPath: tPath, st });
      }
    }
    dirs.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  }

  const topDirs = dirs.slice(0, 20);
  const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID || '';

  for (const item of topDirs) {
    const [parsed, scannedSubagents] = await Promise.all([
      parseAntigravityTranscript(item.convId, item.transcriptPath, item.st, false),
      scanFullTranscriptForSubagents(item.transcriptPath, item.st, 'ag'),
    ]);
    const live = liveApi.map.get(item.convId);
    const liveChildren = liveApi.childrenByParent.get(item.convId) || [];
    const mergedSubagents = [...scannedSubagents];
    for (const sub of parsed.subagents) {
      if (!mergedSubagents.some((m) => m.role === sub.role && m.type === sub.type)) {
        mergedSubagents.push(sub);
      }
    }
    for (const ch of liveChildren) {
      if (!mergedSubagents.some((m) => m.id === ch.id)) {
        mergedSubagents.unshift({
          id: ch.id,
          role: clip(ch.annotations?.title || ch.state?.summary || ch.id.slice(0, 8), 70),
          type: 'live-subagent',
          model: 'antigravity',
          status: ch.state?.runState === 'RUN_STATE_RUNNING' ? 'running' : 'idle',
          at: ch.state?.updateTime || ch.metadata?.createTime || parsed.lastTimestamp,
        });
      }
    }
    const swarmPlanPath = path.join(brainDir, item.convId, '.system_generated', 'swarm', 'plan.json');
    let swarmPlan = null;
    if (existsSync(swarmPlanPath)) {
      const rawPlan = await readFile(swarmPlanPath, 'utf8').catch(() => '');
      const jsonPlan = safeJsonParse(rawPlan.trim());
      if (jsonPlan && jsonPlan.goal) {
        swarmPlan = jsonPlan;
        swarms.push({
          runtime: 'antigravity',
          conversationId: item.convId,
          title: clip(jsonPlan.goal.title || 'Swarm', 100),
          line: clip(jsonPlan.goal.line || '', 180),
          workers: Object.entries(jsonPlan.tasks || {}).map(([name, desc]) => ({
            name,
            task: clip(String(desc), 140),
          })),
          threads: (jsonPlan.threads || []).map((th) => ({
            id: th.id,
            title: clip(th.title || th.id, 80),
            tasks: Array.isArray(th.tasks) ? th.tasks : [],
          })),
        });
      }
    }

    const explicitRunState = live?.state?.runState || null;
    const status = deriveStatus(item.st.mtimeMs, explicitRunState, parsed.hasRecentError);
    const title =
      clip(live?.annotations?.title || live?.state?.summary || parsed.title || `Conversation ${item.convId.slice(0, 8)}`, 100);

    sessions.push({
      id: item.convId,
      runtime: 'antigravity',
      runtimeLabel: 'Antigravity',
      title,
      status,
      runState: explicitRunState || (status === 'running' ? 'ACTIVE' : 'IDLE'),
      model: parsed.model || 'antigravity',
      branch: null,
      cwd: repoRoot,
      inCurrentWorkspace: true,
      isCurrentSession: item.convId === currentConvId,
      parentId: live?.metadata?.parentConversationId || null,
      rootId: live?.metadata?.rootConversationId || null,
      focus: parsed.focus || parsed.lastAction || '',
      lastTool: parsed.lastTool || '',
      lastError: parsed.lastError || '',
      steps: parsed.stepCount,
      tokens: {
        input: parsed.inputTokens,
        cached: parsed.cacheTokens,
        output: parsed.outputTokens,
        total: parsed.inputTokens + parsed.outputTokens,
      },
      subagents: mergedSubagents,
      swarmWorkers: swarmPlan ? Object.keys(swarmPlan.tasks || {}).length : 0,
      updatedAt: live?.state?.updateTime || parsed.lastTimestamp,
      mtimeMs: item.st.mtimeMs,
      sourcePath: item.transcriptPath,
      recentEvents: parsed.events.slice(-8),
    });
  }

  // Link Antigravity parent/child subagents if ConversationService returned child metadata
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const s of sessions) {
    if (s.parentId && byId.has(s.parentId)) {
      const parent = byId.get(s.parentId);
      if (!parent.subagents.some((sub) => sub.id === s.id)) {
        parent.subagents.push({
          id: s.id,
          role: s.title,
          type: 'conversation',
          model: s.model,
          status: s.status,
          at: s.updatedAt,
        });
      }
    }
  }

  return { connectedApi: liveApi.connected, sessions, swarms };
}

// ============================================================================
// 3. CLAUDE CODE COLLECTOR (~/.claude/projects/*/*.jsonl + subagents/)
// ============================================================================

async function parseClaudeSessionFile(sessionId, filePath, fileStat, projectDir, detailMode = false) {
  const cacheKey = `claude:${filePath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    filePath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES,
  );

  let title = '';
  let model = '';
  let requestedModel = '';
  let cwd = '';
  let gitBranch = '';
  let lastAction = '';
  let lastTool = '';
  let lastError = '';
  let hasRecentError = false;
  let inputTokens = 0;
  let cacheTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const subagentCalls = [];
  const events = [];

  // Check custom-title.json if available
  const customTitlePath = path.join(projectDir, sessionId, 'custom-title.json');
  if (existsSync(customTitlePath)) {
    const raw = await readFile(customTitlePath, 'utf8').catch(() => '');
    const parsedTitle = safeJsonParse(raw.trim());
    if (parsedTitle && parsedTitle.customTitle) {
      title = clip(parsedTitle.customTitle, 100);
    }
  }

  for (const line of headLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (!cwd && rec.cwd) cwd = rec.cwd;
    if (!gitBranch && rec.gitBranch) gitBranch = rec.gitBranch;
    if (!title && rec.customTitle) title = clip(rec.customTitle, 100);
    if (!title && rec.type === 'user' && rec.message?.content) {
      const c = rec.message.content;
      if (typeof c === 'string') {
        const schedMatch = c.match(/<scheduled-task\s+name="([^"]+)"/);
        title = schedMatch ? `Scheduled: ${schedMatch[1]}` : clip(c, 95);
      }
    }
  }

  for (const line of tailLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (rec.timestamp) lastTimestamp = rec.timestamp;
    if (rec.cwd) cwd = rec.cwd;
    if (rec.gitBranch) gitBranch = rec.gitBranch;
    if (rec.type === 'custom-title' && rec.customTitle) title = clip(rec.customTitle, 100);
    if (rec.type === 'agent-name' && rec.agentName && !title) title = clip(rec.agentName, 100);
    if (rec.requestedModel) requestedModel = rec.requestedModel;

    if (rec.type === 'assistant' && rec.message) {
      turns += 1;
      if (rec.message.model) model = rec.message.model;
      const u = rec.message.usage;
      if (u) {
        inputTokens += Number(u.input_tokens || 0);
        cacheTokens += Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
        outputTokens += Number(u.output_tokens || 0);
      }
      const blocks = Array.isArray(rec.message.content) ? rec.message.content : [];
      for (const blk of blocks) {
        if (!blk) continue;
        if (blk.type === 'tool_use') {
          lastTool = blk.name || 'tool';
          const desc =
            blk.input?.description ||
            blk.input?.file_path ||
            blk.input?.pattern ||
            blk.input?.command ||
            blk.input?.prompt ||
            '';
          const summary = desc ? `${lastTool}: ${clip(String(desc), 110)}` : lastTool;
          lastAction = summary;
          if (blk.name === 'Agent' || blk.name === 'Task') {
            subagentCalls.push({
              id: blk.id || `sub-${turns}`,
              role: clip(String(blk.input?.description || blk.input?.subagent_type || 'Claude Subagent'), 70),
              type: clip(String(blk.input?.subagent_type || 'general-purpose'), 40),
              model: clip(String(blk.input?.model || model || 'inherit'), 40),
              at: rec.timestamp || lastTimestamp,
            });
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'subagent', tool: blk.name, summary });
          } else {
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'tool', tool: lastTool, summary });
          }
        } else if (blk.type === 'thinking' && blk.thinking) {
          const thought = clip(blk.thinking, 120);
          if (thought) {
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'focus', tool: 'thinking', summary: thought });
          }
        } else if (blk.type === 'text' && blk.text) {
          const txt = clip(blk.text, 120);
          if (txt) {
            lastAction = txt;
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'message', tool: 'assistant', summary: txt });
          }
        }
      }
    } else if (rec.type === 'user' && Array.isArray(rec.message?.content)) {
      for (const blk of rec.message.content) {
        if (blk && blk.type === 'tool_result' && blk.is_error) {
          hasRecentError = true;
          lastError = clip(typeof blk.content === 'string' ? blk.content : 'Tool error', 150);
          events.push({ at: rec.timestamp || lastTimestamp, kind: 'error', tool: 'tool_result', summary: lastError });
        }
      }
    }
  }

  // Also check real subagent jsonl files in <sessionId>/subagents/
  const subDir = path.join(projectDir, sessionId, 'subagents');
  if (existsSync(subDir)) {
    const subFiles = await readdir(subDir).catch(() => []);
    for (const sf of subFiles.filter((f) => f.endsWith('.jsonl')).slice(0, 15)) {
      const subId = sf.replace(/\.jsonl$/i, '');
      const subStat = await stat(path.join(subDir, sf)).catch(() => null);
      if (!subagentCalls.some((s) => s.id === subId)) {
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

  const value = {
    title: title || `Claude ${sessionId.slice(0, 8)}`,
    model: model || requestedModel || 'claude-code',
    cwd,
    gitBranch,
    lastAction,
    lastTool,
    lastError,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    turns,
    lastTimestamp,
    subagents: subagentCalls,
    events: events.slice(-40),
  };

  fileParseCache.set(cacheKey, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value });
  return value;
}

async function collectClaudeCode(repoRoot) {
  const projectsRoot = path.join(HOME_DIR, '.claude', 'projects');
  if (!existsSync(projectsRoot)) return [];

  const projEntries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];

  for (const proj of projEntries) {
    if (!proj.isDirectory()) continue;
    const projPath = path.join(projectsRoot, proj.name);
    const files = await readdir(projPath, { withFileTypes: true }).catch(() => []);
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const fullPath = path.join(projPath, f.name);
      const st = await stat(fullPath).catch(() => null);
      if (st) {
        candidates.push({
          sessionId: f.name.replace(/\.jsonl$/i, ''),
          fullPath,
          projPath,
          st,
        });
      }
    }
  }

  candidates.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const sessions = [];

  for (const c of candidates.slice(0, 18)) {
    const [parsed, scannedSubs] = await Promise.all([
      parseClaudeSessionFile(c.sessionId, c.fullPath, c.st, c.projPath, false),
      scanFullTranscriptForSubagents(c.fullPath, c.st, 'claude'),
    ]);
    const mergedSubs = [...parsed.subagents];
    for (const sub of scannedSubs) {
      if (!mergedSubs.some((m) => m.id === sub.id || m.role === sub.role)) {
        mergedSubs.push(sub);
      }
    }
    const status = deriveStatus(c.st.mtimeMs, null, parsed.hasRecentError);
    sessions.push({
      id: c.sessionId,
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
      steps: parsed.turns,
      tokens: {
        input: parsed.inputTokens,
        cached: parsed.cacheTokens,
        output: parsed.outputTokens,
        total: parsed.inputTokens + parsed.outputTokens,
      },
      subagents: mergedSubs,
      swarmWorkers: 0,
      updatedAt: parsed.lastTimestamp,
      mtimeMs: c.st.mtimeMs,
      sourcePath: c.fullPath,
      recentEvents: parsed.events.slice(-8),
    });
  }

  return sessions;
}

// ============================================================================
// 4. CODEX COLLECTOR (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// ============================================================================

async function walkJsonlFiles(dir, maxDepth, out = [], depth = 0) {
  if (depth > maxDepth || !existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkJsonlFiles(full, maxDepth, out, depth + 1);
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      const st = await stat(full).catch(() => null);
      if (st) out.push({ full, name: ent.name, st });
    }
  }
  return out;
}

async function parseCodexRollout(filePath, fileStat, detailMode = false) {
  const cacheKey = `codex:${filePath}:${detailMode ? 'd' : 's'}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const { headLines, tailLines } = await readHeadAndTailLines(
    filePath,
    fileStat.size,
    detailMode ? DETAIL_TAIL_BYTES : TAIL_CHUNK_BYTES,
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
  let hasRecentError = false;
  let inputTokens = 0;
  let cacheTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let steps = 0;
  let lastTimestamp = new Date(fileStat.mtimeMs).toISOString();
  const events = [];

  for (const line of headLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (rec.type === 'session_meta' && rec.payload) {
      sessionId = rec.payload.session_id || rec.payload.id || sessionId;
      cwd = rec.payload.cwd || cwd;
      originator = rec.payload.originator || originator;
      gitBranch = rec.payload.git?.branch || gitBranch;
      model = rec.payload.base_instructions?.provenance?.model || model;
    } else if (rec.type === 'event_msg' && rec.payload?.type === 'thread_settings_applied') {
      model = rec.payload.thread_settings?.model || model;
      cwd = rec.payload.thread_settings?.cwd || cwd;
    } else if (rec.type === 'event_msg' && rec.payload?.type === 'thread_goal_updated') {
      if (rec.payload.goal?.objective) title = clip(rec.payload.goal.objective, 105);
      if (rec.payload.goal?.status) goalStatus = rec.payload.goal.status;
    }
  }

  for (const line of tailLines) {
    const rec = safeJsonParse(line);
    if (!rec) continue;
    if (rec.timestamp) lastTimestamp = rec.timestamp;
    if (typeof rec.ordinal === 'number') steps = Math.max(steps, rec.ordinal + 1);

    if (rec.type === 'token_usage_record' && rec.payload?.thread_token_usage) {
      const tu = rec.payload.thread_token_usage;
      inputTokens = Number(tu.input_tokens || inputTokens);
      cacheTokens = Number(tu.cached_input_tokens || cacheTokens);
      outputTokens = Number(tu.output_tokens || outputTokens);
      totalTokens = Number(tu.total_tokens || inputTokens + outputTokens);
    } else if (rec.type === 'event_msg' && rec.payload) {
      const p = rec.payload;
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const tu = p.info.total_token_usage;
        inputTokens = Number(tu.input_tokens || inputTokens);
        cacheTokens = Number(tu.cached_input_tokens || cacheTokens);
        outputTokens = Number(tu.output_tokens || outputTokens);
        totalTokens = Number(tu.total_tokens || inputTokens + outputTokens);
      } else if (p.type === 'thread_goal_updated' && p.goal) {
        if (p.goal.objective) title = clip(p.goal.objective, 105);
        if (p.goal.status) goalStatus = p.goal.status;
      } else if (p.type === 'item_completed' && p.item) {
        if (p.item.type === 'AgentMessage') {
          const textPart = (p.item.content || []).find((c) => c.text)?.text || '';
          const summary = clip(textPart, 130);
          if (summary) {
            lastAction = summary;
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'message', tool: 'commentary', summary });
          }
        } else if (p.item.type === 'CommandExecution') {
          const cmd = Array.isArray(p.item.command) ? p.item.command.slice(-1)[0] : String(p.item.command || '');
          const failed = p.item.status === 'failed' || (typeof p.item.exit_code === 'number' && p.item.exit_code !== 0);
          lastTool = 'exec_command';
          const summary = clip(cmd, 115);
          lastAction = summary;
          if (failed) {
            hasRecentError = true;
            lastError = `exit=${p.item.exit_code ?? 1}: ${summary}`;
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'error', tool: 'exec_command', summary: lastError });
          } else {
            events.push({ at: rec.timestamp || lastTimestamp, kind: 'tool', tool: 'exec_command', summary });
          }
        }
      }
    } else if (rec.type === 'response_item' && rec.payload?.type === 'custom_tool_call') {
      lastTool = rec.payload.name || 'exec';
      const summary = `${lastTool}: ${clip(String(rec.payload.input || ''), 100)}`;
      lastAction = summary;
      events.push({ at: rec.timestamp || lastTimestamp, kind: 'tool', tool: lastTool, summary });
    }
  }

  const value = {
    sessionId,
    title: title || `${originator} ${sessionId.slice(0, 8)}`,
    model: model || 'codex',
    cwd,
    gitBranch,
    goalStatus,
    lastAction,
    lastTool,
    lastError,
    hasRecentError,
    inputTokens,
    cacheTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    steps,
    lastTimestamp,
    events: events.slice(-40),
  };

  fileParseCache.set(cacheKey, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value });
  return value;
}

async function collectCodex(repoRoot) {
  const codexRoot = path.join(HOME_DIR, '.codex', 'sessions');
  if (!existsSync(codexRoot)) return [];
  const files = await walkJsonlFiles(codexRoot, 4);
  files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

  const sessions = [];
  for (const f of files.slice(0, 14)) {
    const parsed = await parseCodexRollout(f.full, f.st, false);
    const status = deriveStatus(f.st.mtimeMs, null, parsed.hasRecentError);
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
      steps: parsed.steps,
      tokens: {
        input: parsed.inputTokens,
        cached: parsed.cacheTokens,
        output: parsed.outputTokens,
        total: parsed.totalTokens,
      },
      subagents: [],
      swarmWorkers: 0,
      updatedAt: parsed.lastTimestamp,
      mtimeMs: f.st.mtimeMs,
      sourcePath: f.full,
      recentEvents: parsed.events.slice(-8),
    });
  }
  return sessions;
}

// ============================================================================
// 5. OTHER CODING AGENTS (Qoder, Gemini CLI, Visual-Swarm manifest)
// ============================================================================

async function collectGenericJsonlRuntime(dirPath, runtime, runtimeLabel, repoRoot) {
  if (!existsSync(dirPath)) return [];
  const files = await walkJsonlFiles(dirPath, 3);
  files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

  const sessions = [];
  for (const f of files.slice(0, 8)) {
    const { tailLines } = await readHeadAndTailLines(f.full, f.st.size, 32 * 1024);
    let lastAction = '';
    let model = runtime;
    for (const line of tailLines.slice(-15)) {
      const rec = safeJsonParse(line);
      if (!rec) continue;
      if (rec.model) model = String(rec.model);
      const txt = rec.summary || rec.message || rec.content || rec.text;
      if (typeof txt === 'string' && txt.trim()) lastAction = clip(txt, 110);
    }
    const status = deriveStatus(f.st.mtimeMs, null, false);
    sessions.push({
      id: path.basename(f.full, '.jsonl'),
      runtime,
      runtimeLabel,
      title: `${runtimeLabel} ${path.basename(f.full, '.jsonl').slice(0, 24)}`,
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
      steps: tailLines.length,
      tokens: { input: 0, cached: 0, output: 0, total: 0 },
      subagents: [],
      swarmWorkers: 0,
      updatedAt: new Date(f.st.mtimeMs).toISOString(),
      mtimeMs: f.st.mtimeMs,
      sourcePath: f.full,
      recentEvents: lastAction
        ? [{ at: new Date(f.st.mtimeMs).toISOString(), kind: 'message', tool: runtime, summary: lastAction }]
        : [],
    });
  }
  return sessions;
}

async function collectLocalSwarmManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, '.swarm', 'swarm.json');
  if (!existsSync(manifestPath)) return null;
  const raw = await readFile(manifestPath, 'utf8').catch(() => '');
  const data = safeJsonParse(raw.trim());
  if (!data || !data.name) return null;
  return {
    runtime: 'visual-swarm',
    title: clip(data.name, 90),
    line: clip(data.goal || '', 160),
    updatedAt: data.updatedAt || null,
    workers: (data.agents || []).map((a) => ({
      name: a.name || a.id,
      role: a.role || '',
      status: a.status || 'idle',
      progress: Number(a.progress || 0),
      task: clip(a.message || (a.taskIds || []).join(', '), 120),
    })),
    tasks: (data.tasks || []).map((t) => ({
      id: t.id,
      title: clip(t.title || t.id, 90),
      status: t.status || 'pending',
      owner: t.owner || '',
    })),
  };
}

// ============================================================================
// 6. GIT + LIVE SERVER / VPS PROBES
// ============================================================================

let cachedGitState = {
  branch: 'unknown',
  head: '',
  dirtyCount: 0,
  commits: [],
  commitByTaskId: {},
  updatedAt: null,
};

async function refreshGitState(repoRoot) {
  try {
    const [branchRes, statusRes, logRes] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: repoRoot, timeout: 3500 }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot, timeout: 3500 }),
      execFileAsync('git', ['log', '-n', '30', '--pretty=format:%h%x09%cI%x09%an%x09%s'], {
        cwd: repoRoot,
        timeout: 3500,
      }),
    ]);

    const branch = branchRes.stdout.trim() || 'HEAD';
    const dirtyLines = statusRes.stdout.split(/\r?\n/).filter(Boolean);
    const commits = [];
    const commitByTaskId = {};

    for (const line of logRes.stdout.split(/\r?\n/).filter(Boolean)) {
      const [sha, at, author, subject] = line.split('\t');
      const taskMatch = (subject || '').match(/\b(M\d{2})\b/);
      const taskId = taskMatch ? taskMatch[1] : null;
      if (taskId && !commitByTaskId[taskId]) {
        commitByTaskId[taskId] = { sha, subject: clip(subject, 90), at };
      }
      commits.push({
        sha,
        at,
        author: clip(author || '', 30),
        subject: clip(subject || '', 110),
        taskId,
      });
    }

    cachedGitState = {
      branch,
      head: commits[0]?.sha || '',
      dirtyCount: dirtyLines.length,
      commits: commits.slice(0, 18),
      commitByTaskId,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    // Keep last git snapshot
  }
}

let cachedProbes = {
  vps: DEFAULT_VPS_PROBES.map((p) => ({ ...p, status: 'pending', httpCode: null, latencyMs: null, detail: '' })),
  localPorts: LOCAL_PORTS.map((p) => ({ ...p, open: false })),
  updatedAt: null,
};

async function probeHttpTarget(target) {
  const started = Date.now();
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    let detail = '';
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const body = await res.text().catch(() => '');
      const parsed = safeJsonParse(body.trim());
      if (parsed && typeof parsed.setupRequired === 'boolean') {
        detail = parsed.setupRequired ? 'setupRequired: true' : 'claimed';
      } else if (parsed && parsed.status) {
        detail = String(parsed.status);
      }
    }
    const ok = res.status >= 200 && res.status < 400;
    return {
      ...target,
      status: ok ? 'up' : 'warn',
      httpCode: res.status,
      latencyMs,
      detail,
    };
  } catch (err) {
    return {
      ...target,
      status: 'down',
      httpCode: null,
      latencyMs: Date.now() - started,
      detail: err?.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeLocalTcpPort(port) {
  return new Promise((resolve) => {
    const sock = new Socket();
    let settled = false;
    const finish = (openState) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(openState);
    };
    sock.setTimeout(350);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

async function refreshProbes() {
  const [vpsResults, portResults] = await Promise.all([
    Promise.all(DEFAULT_VPS_PROBES.map(probeHttpTarget)),
    Promise.all(LOCAL_PORTS.map(async (p) => ({ ...p, open: await probeLocalTcpPort(p.port) }))),
  ]);
  cachedProbes = {
    vps: vpsResults,
    localPorts: portResults,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// 7. AGGREGATED SNAPSHOT + DETAIL ENDPOINT + SSE SERVER
// ============================================================================

async function buildSnapshot(repoRoot) {
  const [planBundle, agBundle, claudeSessions, codexSessions, qoderSessions, geminiSessions, localSwarm] =
    await Promise.all([
      collectPlans(repoRoot),
      collectAntigravity(repoRoot),
      collectClaudeCode(repoRoot),
      collectCodex(repoRoot),
      collectGenericJsonlRuntime(path.join(HOME_DIR, '.qoder', 'projects'), 'qoder', 'Qoder', repoRoot),
      collectGenericJsonlRuntime(path.join(HOME_DIR, '.gemini', 'tmp'), 'gemini-cli', 'Gemini CLI', repoRoot),
      collectLocalSwarmManifest(repoRoot),
    ]);

  // Attach git commit SHAs to plan tasks
  for (const p of planBundle.plans) {
    for (const t of p.tasks) {
      const hit = cachedGitState.commitByTaskId[t.id];
      if (hit) {
        t.commitSha = hit.sha;
        t.commitSubject = hit.subject;
      }
    }
  }

  const allSessions = [
    ...agBundle.sessions,
    ...claudeSessions,
    ...codexSessions,
    ...qoderSessions,
    ...geminiSessions,
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Unified real-time activity feed across all agents
  const feed = [];
  for (const s of allSessions.slice(0, 24)) {
    for (const ev of s.recentEvents || []) {
      feed.push({
        at: ev.at || s.updatedAt,
        runtime: s.runtime,
        runtimeLabel: s.runtimeLabel,
        sessionId: s.id,
        sessionTitle: clip(s.title, 48),
        kind: ev.kind,
        tool: ev.tool,
        summary: ev.summary,
      });
    }
  }
  feed.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  const runtimeCounts = {};
  let runningCount = 0;
  let subagentTotal = 0;
  let totalInput = 0;
  let totalCached = 0;
  let totalOutput = 0;

  for (const s of allSessions) {
    runtimeCounts[s.runtime] = (runtimeCounts[s.runtime] || 0) + 1;
    if (s.status === 'running') runningCount += 1;
    subagentTotal += (s.subagents || []).length;
    totalInput += s.tokens?.input || 0;
    totalCached += s.tokens?.cached || 0;
    totalOutput += s.tokens?.output || 0;
  }

  const swarms = [...agBundle.swarms];
  if (localSwarm) swarms.push(localSwarm);

  const memTotalGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const memUsedGb = Math.round(((os.totalmem() - os.freemem()) / 1024 ** 3) * 10) / 10;

  return {
    rawSessions: allSessions,
    snapshot: {
      generatedAt: new Date().toISOString(),
      repoRoot: normalizePathSlashes(repoRoot),
      antigravityApiConnected: agBundle.connectedApi,
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        cpus: os.cpus().length,
        memUsedGb,
        memTotalGb,
        memPct: memTotalGb > 0 ? Math.round((memUsedGb / memTotalGb) * 100) : 0,
        uptimeSec: Math.round(process.uptime()),
      },
      summary: {
        totalSessions: allSessions.length,
        runningSessions: runningCount,
        subagents: subagentTotal,
        swarms: swarms.length,
        runtimeCounts,
        tokens: {
          input: totalInput,
          cached: totalCached,
          output: totalOutput,
          total: totalInput + totalOutput,
        },
      },
      plans: planBundle.plans,
      defaultPlanId: planBundle.defaultPlanId,
      sessions: allSessions.map(({ sourcePath: _sp, ...publicSession }) => publicSession),
      swarms,
      activityFeed: feed.slice(0, 60),
      git: cachedGitState,
      probes: cachedProbes,
    },
  };
}

async function readSessionDetail(runtime, id, snapshotSessions) {
  const target = snapshotSessions.find((s) => s.runtime === runtime && s.id === id);
  if (!target || !target.sourcePath) return null;
  const st = await stat(target.sourcePath).catch(() => null);
  if (!st) return null;

  if (runtime === 'antigravity') {
    const detail = await parseAntigravityTranscript(id, target.sourcePath, st, true);
    return { ...target, sourcePath: undefined, detail };
  }
  if (runtime === 'claude') {
    const detail = await parseClaudeSessionFile(id, target.sourcePath, st, path.dirname(target.sourcePath), true);
    return { ...target, sourcePath: undefined, detail };
  }
  if (runtime === 'codex') {
    const detail = await parseCodexRollout(target.sourcePath, st, true);
    return { ...target, sourcePath: undefined, detail };
  }
  return { ...target, sourcePath: undefined, detail: { events: target.recentEvents || [] } };
}

async function startServer() {
  const opts = parseArgs(process.argv.slice(2));
  const clients = new Set();
  let lastSnapshot = null;
  let lastRawSessions = [];
  let lastPayloadJson = '';
  let refreshInFlight = false;

  await Promise.all([refreshGitState(opts.repo), refreshProbes(), refreshAntigravityLiveApi()]);

  async function refreshAndBroadcast(force = false) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const { snapshot, rawSessions } = await buildSnapshot(opts.repo);
      lastRawSessions = rawSessions;
      lastSnapshot = snapshot;
      const json = JSON.stringify(snapshot);
      if (force || json !== lastPayloadJson) {
        lastPayloadJson = json;
        const frame = `event: snapshot\ndata: ${json}\n\n`;
        for (const res of clients) {
          try {
            res.write(frame);
          } catch {
            clients.delete(res);
          }
        }
      }
    } finally {
      refreshInFlight = false;
    }
  }

  await refreshAndBroadcast(true);

  const sseTimer = setInterval(() => {
    void refreshAndBroadcast(false);
  }, SSE_TICK_MS);

  const gitTimer = setInterval(() => {
    void refreshGitState(opts.repo);
  }, GIT_INTERVAL_MS);

  const agApiTimer = setInterval(() => {
    void refreshAntigravityLiveApi();
  }, 4_000);

  const probeTimer = setInterval(() => {
    void refreshProbes();
  }, PROBE_INTERVAL_MS);

  const heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, HEARTBEAT_MS);

  // Instant fs.watch on .plan directory for immediate UI updates
  const planDir = path.join(opts.repo, '.plan');
  let planWatcher = null;
  let debounceTimer = null;
  if (existsSync(planDir)) {
    try {
      planWatcher = watch(planDir, { recursive: true }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void refreshGitState(opts.repo).then(() => refreshAndBroadcast(true));
        }, 200);
      });
    } catch {
      // Fallback to 2s interval polling
    }
  }

  const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method !== 'GET') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
      const html = await readFile(INDEX_HTML_PATH, 'utf8').catch(() => '<h1>Observatory UI missing</h1>');
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (reqUrl.pathname === '/health') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          host: opts.host,
          port: opts.port,
          clients: clients.size,
          uptimeSec: Math.round(process.uptime()),
        }),
      );
      return;
    }

    if (reqUrl.pathname === '/api/state') {
      if (!lastSnapshot || reqUrl.searchParams.get('fresh') === '1') {
        await Promise.all([refreshGitState(opts.repo), refreshProbes()]);
        await refreshAndBroadcast(true);
      }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(lastPayloadJson || JSON.stringify(lastSnapshot || {}));
      return;
    }

    if (reqUrl.pathname === '/api/session') {
      const runtime = reqUrl.searchParams.get('runtime') || '';
      const id = reqUrl.searchParams.get('id') || '';
      const detail = await readSessionDetail(runtime, id, lastRawSessions);
      if (!detail) {
        res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detail));
      return;
    }

    if (reqUrl.pathname === '/api/stream') {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      if (lastPayloadJson) {
        res.write(`event: snapshot\ndata: ${lastPayloadJson}\n\n`);
      }
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  const cleanup = () => {
    clearInterval(sseTimer);
    clearInterval(gitTimer);
    clearInterval(agApiTimer);
    clearInterval(probeTimer);
    clearInterval(heartbeatTimer);
    if (planWatcher) planWatcher.close();
    for (const c of clients) c.end();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  server.listen(opts.port, opts.host, () => {
    process.stdout.write(`MoonWitness Agent Observatory listening at http://${opts.host}:${opts.port}\n`);
  });
}

startServer().catch((err) => {
  process.stderr.write(`Fatal observatory error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
