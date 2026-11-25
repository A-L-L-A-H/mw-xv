import { execFile } from 'node:child_process';
import { Socket } from 'node:net';
import { promisify } from 'node:util';
import { isRecord } from '@moonwitness/types';
import { clipRedacted, safeJsonParse } from './io.js';
import type {
  ObservatoryGitCommit,
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
  { id: 'vps-apps-tls', label: 'HTTPS apps.moonwitness.biz.id', url: 'https://apps.moonwitness.biz.id/readyz' },
  { id: 'vps-wa-tls', label: 'HTTPS wa.apps.moonwitness.biz.id', url: 'https://wa.apps.moonwitness.biz.id/readyz' },
]);

export const DEFAULT_LOCAL_PORTS: readonly ObservatoryLocalPortTarget[] = Object.freeze([
  { port: 3000, label: 'API / Dev :3000' },
  { port: 3001, label: 'API :3001' },
  { port: 4174, label: 'Board :4174' },
  { port: 4242, label: 'Desktop Sidecar :4242' },
  { port: 5173, label: 'Vite :5173' },
  { port: 5432, label: 'Postgres :5432' },
  { port: 6379, label: 'Redis :6379' },
  { port: 8000, label: 'Bootstrap :8000' },
]);

export function isBlockedProbeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return true;
  }
  return false;
}

export async function collectGitState(
  repoRoot: string,
  knownSecrets: readonly string[] = []
): Promise<ObservatoryGitState> {
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
    const dirtyLines = statusRes.stdout.split(/\r?\n/u).filter((line) => line.length > 0);
    const commits: ObservatoryGitCommit[] = [];
    const commitByTaskId: Record<string, ObservatoryGitTaskCommit> = {};

    for (const line of logRes.stdout.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
      const [sha = '', at = '', author = '', subject = ''] = line.split('\t');
      const taskMatch = subject.match(/\b([MD]\d{2})\b/u);
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
      dirtyCount: dirtyLines.length,
      commits: commits.slice(0, 18),
      commitByTaskId,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      branch: 'unknown',
      head: '',
      dirtyCount: 0,
      commits: [],
      commitByTaskId: {},
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function probeHttpTarget(target: ObservatoryProbeTarget): Promise<ObservatoryProbeResult> {
  if (isBlockedProbeUrl(target.url)) {
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
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    let detail = '';
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const text = await response.text().catch(() => '');
      const parsed = safeJsonParse<Record<string, unknown>>(text.trim());
      if (parsed && isRecord(parsed)) {
        if (typeof parsed.setupRequired === 'boolean') {
          detail = parsed.setupRequired ? 'setupRequired: true' : 'claimed';
        } else if (typeof parsed.status === 'string') {
          detail = parsed.status;
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

function probeLoopbackPort(port: number): Promise<boolean> {
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
