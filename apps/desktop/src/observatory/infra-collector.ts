import { execFile } from 'node:child_process';
import { Socket } from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import { isRecord } from '@moonwitness/types';
import { bumpCounter, clipRedacted, normalizePathSlashes, safeJsonParse } from './io.js';
import type {
  ObservatoryGitCommit,
  ObservatoryGitCommitDetail,
  ObservatoryGitDirtyFile,
  ObservatoryGitState,
  ObservatoryGitTaskCommit,
  ObservatoryLocalPortResult,
  ObservatoryLocalPortTarget,
  ObservatoryProbeResult,
  ObservatoryProbeTarget,
} from './types.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_VPS_PROBE_TARGETS: readonly ObservatoryProbeTarget[] = Object.freeze([
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

export const DEFAULT_LOCAL_PORTS: readonly ObservatoryLocalPortTarget[] = Object.freeze([
  { port: 3000, label: 'API / Dev :3000' },
  { port: 3001, label: 'API :3001' },
  { port: 3425, label: 'Magpie Gateway :3425' },
  { port: 4174, label: 'Board :4174' },
  { port: 4242, label: 'Desktop Sidecar :4242' },
  { port: 5173, label: 'Vite :5173' },
  { port: 5432, label: 'Postgres :5432' },
  { port: 6379, label: 'Redis :6379' },
  { port: 8000, label: 'Bootstrap :8000' },
]);

export function createCpuSampler(): () => number {
  const previousTotals = os.cpus().map((core) => ({
    idle: core.times.idle,
    total: Object.values(core.times).reduce((sum, val) => sum + val, 0),
  }));
  let lastPct = 0;

  return () => {
    const currentCores = os.cpus();
    let idleDelta = 0;
    let totalDelta = 0;
    for (let idx = 0; idx < currentCores.length; idx += 1) {
      const core = currentCores[idx];
      if (!core) continue;
      const currentTotal = Object.values(core.times).reduce((sum, val) => sum + val, 0);
      const prev = previousTotals[idx];
      if (prev) {
        idleDelta += core.times.idle - prev.idle;
        totalDelta += currentTotal - prev.total;
      }
      previousTotals[idx] = { idle: core.times.idle, total: currentTotal };
    }
    if (totalDelta > 0) {
      lastPct = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
    }
    return lastPct;
  };
}

const HOST_CONTROL_CHARS_PATTERN = /[\s\u0000-\u001f\u007f]/u;

/**
 * Parses and validates a probe URL. Returns a sanitized URL object, or null when the
 * URL is not a safe http(s) probe target. Callers must fetch the returned URL object,
 * never the raw string, so unvalidated input cannot reach network sinks.
 */
export function parseProbeUrl(rawUrl: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  // Credentials in the URL would leak secrets to the probed host; reject them.
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (host === '' || HOST_CONTROL_CHARS_PATTERN.test(host)) {
    return null;
  }
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return null;
  }
  return parsed;
}

export function isBlockedProbeUrl(rawUrl: string): boolean {
  return parseProbeUrl(rawUrl) === null;
}

function classifyGitArea(filePath: string): string {
  const normalized = normalizePathSlashes(filePath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return 'root';
  if (parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'tools') {
    return parts[1] ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0] ?? 'root';
}

function mapPorcelainStatus(code: string): ObservatoryGitDirtyFile['status'] {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

export async function collectGitState(
  repoRoot: string,
  knownSecrets: readonly string[] = []
): Promise<ObservatoryGitState> {
  try {
    const [branchRes, statusRes, logRes, diffStatRes, revListRes, stashRes] = await Promise.all([
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

    const branch = branchRes.stdout.trim() || 'HEAD';
    const dirtyLines = statusRes.stdout.split(/\r?\n/u).filter((line) => line.length > 0);
    const dirtyFiles: ObservatoryGitDirtyFile[] = [];
    const dirtyByArea: Record<string, number> = {};

    for (const rawLine of dirtyLines) {
      const code = rawLine.slice(0, 2);
      let relPath = rawLine.slice(3).trim();
      if (relPath.includes(' -> ')) {
        relPath = relPath.split(' -> ').pop()?.trim() ?? relPath;
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
          status: mapPorcelainStatus(code),
          path: normalizedPath,
          area,
        });
      }
    }

    const diffStatText = diffStatRes.stdout.trim();
    const filesMatch = diffStatText.match(/(\d+)\s+files?\s+changed/u);
    const insMatch = diffStatText.match(/(\d+)\s+insertions?/u);
    const delMatch = diffStatText.match(/(\d+)\s+deletions?/u);

    let ahead = 0;
    let behind = 0;
    const revParts = revListRes.stdout.trim().split(/\s+/u);
    if (revParts.length === 2) {
      ahead = Number(revParts[0]) || 0;
      behind = Number(revParts[1]) || 0;
    }

    const stashCount = stashRes.stdout.split(/\r?\n/u).filter(Boolean).length;

    const commits: ObservatoryGitCommit[] = [];
    const commitByTaskId: Record<string, ObservatoryGitTaskCommit> = {};

    for (const line of logRes.stdout.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
      const [sha = '', at = '', author = '', subject = ''] = line.split('\t');
      const taskMatch = subject.match(/\b([A-Z]\d{2,3})\b/u);
      const taskId = taskMatch && taskMatch[1] ? taskMatch[1] : null;
      const cleanSubject = clipRedacted(subject, 110, knownSecrets);
      if (taskId && !commitByTaskId[taskId]) {
        commitByTaskId[taskId] = { sha, subject: cleanSubject, at };
      }
      commits.push({
        sha,
        at,
        author: clipRedacted(author, 30, knownSecrets),
        subject: cleanSubject,
        taskId,
      });
    }

    return {
      branch,
      head: commits[0]?.sha ?? '',
      ahead,
      behind,
      stashCount,
      dirtyCount: dirtyLines.length,
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
  } catch {
    return {
      branch: 'unknown',
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
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function readGitCommitDetail(
  repoRoot: string,
  rawSha: string,
  knownSecrets: readonly string[] = []
): Promise<ObservatoryGitCommitDetail | null> {
  if (typeof rawSha !== 'string' || !/^[0-9a-f]{6,40}$/iu.test(rawSha.trim())) {
    return null;
  }
  const sha = rawSha.trim();
  try {
    const [headerOut, numstatOut] = await Promise.all([
      execFileAsync('git', ['show', '--stat', '--format=fuller', '--no-patch', sha], {
        cwd: repoRoot,
        timeout: 3500,
      }),
      execFileAsync('git', ['show', '--numstat', '--format=', sha], {
        cwd: repoRoot,
        timeout: 3500,
      }),
    ]);

    const changedFiles = numstatOut.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(0, 60)
      .map((line) => {
        const [added = '0', removed = '0', ...rest] = line.split('\t');
        const filePath = rest.join('\t');
        return {
          added: added === '-' ? 0 : Number(added) || 0,
          removed: removed === '-' ? 0 : Number(removed) || 0,
          path: normalizePathSlashes(filePath),
        };
      });

    return {
      sha,
      header: clipRedacted(headerOut.stdout, 2000, knownSecrets),
      changedFiles,
    };
  } catch {
    return null;
  }
}

export async function probeHttpTarget(
  target: ObservatoryProbeTarget
): Promise<ObservatoryProbeResult> {
  // Fetch only the validated URL object; the raw string never reaches the network sink.
  const validatedUrl = parseProbeUrl(target.url);
  if (!validatedUrl) {
    return {
      ...target,
      status: 'blocked',
      httpCode: null,
      latencyMs: 0,
      detail: 'Blocked by SSRF metadata guard',
    };
  }

  const started = Date.now();
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  timer.unref();

  try {
    const response = await fetch(validatedUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    let detail = '';
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const text = (await response.text().catch(() => '')).slice(0, 8192);
      const parsed = safeJsonParse<Record<string, unknown>>(text.trim());
      if (parsed && isRecord(parsed)) {
        if (typeof parsed.setupRequired === 'boolean') {
          detail = parsed.setupRequired ? 'setupRequired: true' : 'claimed';
        } else if (typeof parsed.status === 'string') {
          detail = parsed.status.slice(0, 40);
        }
      }
    }
    const ok = response.status >= 200 && response.status < 400;
    return {
      ...target,
      status: ok ? 'up' : 'warn',
      httpCode: response.status,
      latencyMs,
      detail,
    };
  } catch (error) {
    return {
      ...target,
      status: 'down',
      httpCode: null,
      latencyMs: Date.now() - started,
      detail: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function probeLoopbackPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (isOpen: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(350);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

export async function probeVpsTargets(
  targets: readonly ObservatoryProbeTarget[] = DEFAULT_VPS_PROBE_TARGETS
): Promise<readonly ObservatoryProbeResult[]> {
  return Promise.all(targets.map((target) => probeHttpTarget(target)));
}

export async function probeLocalPorts(
  ports: readonly ObservatoryLocalPortTarget[] = DEFAULT_LOCAL_PORTS
): Promise<readonly ObservatoryLocalPortResult[]> {
  return Promise.all(
    ports.map(async (item) => ({
      ...item,
      open: await probeLoopbackPort(item.port),
    }))
  );
}
