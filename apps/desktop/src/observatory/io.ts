import { existsSync, type Stats } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { redactSensitiveText } from '../risk-gate.js';
import type { ObservatorySessionStatus } from './types.js';

export const DEFAULT_HEAD_CHUNK_BYTES = 32 * 1024;
export const DEFAULT_TAIL_CHUNK_BYTES = 192 * 1024;
export const DEFAULT_DETAIL_TAIL_BYTES = 512 * 1024;
export const ACTIVE_SESSION_THRESHOLD_MS = 120_000;
export const RECENT_SESSION_THRESHOLD_MS = 15 * 60_000;

const POSTGRES_CRED_PATTERN = /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/giu;
const GOOGLE_KEY_PATTERN = /\bAIza[0-9A-Za-z_-]{20,}\b/gu;

export function clipRedacted(
  input: unknown,
  maxLength = 180,
  knownSecrets: readonly string[] = []
): string {
  if (typeof input !== 'string') return '';
  const base = redactSensitiveText(input, knownSecrets).text;
  const scrubbed = base
    .replace(POSTGRES_CRED_PATTERN, '$1[REDACTED]$2')
    .replace(GOOGLE_KEY_PATTERN, '[REDACTED_API_KEY]')
    .replace(/\s+/gu, ' ')
    .trim();
  if (scrubbed.length <= maxLength) return scrubbed;
  return `${scrubbed.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function safeJsonParse<T = unknown>(line: string): T | null {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

export interface HeadTailLinesResult {
  readonly headLines: readonly string[];
  readonly tailLines: readonly string[];
  readonly full: boolean;
}

export async function readHeadAndTailLines(
  filePath: string,
  fileSize: number,
  tailBytes = DEFAULT_TAIL_CHUNK_BYTES,
  headBytes = DEFAULT_HEAD_CHUNK_BYTES
): Promise<HeadTailLinesResult> {
  if (fileSize <= 0) {
    return { headLines: [], tailLines: [], full: true };
  }
  let handle;
  try {
    handle = await open(filePath, 'r');
    if (fileSize <= headBytes + tailBytes) {
      const buffer = Buffer.alloc(fileSize);
      const { bytesRead } = await handle.read(buffer, 0, fileSize, 0);
      const lines = buffer
        .toString('utf8', 0, bytesRead)
        .split(/\r?\n/u)
        .filter((line) => line.length > 0);
      return { headLines: lines, tailLines: lines, full: true };
    }

    const headBuffer = Buffer.alloc(headBytes);
    const headRead = await handle.read(headBuffer, 0, headBytes, 0);
    const headSplit = headBuffer.toString('utf8', 0, headRead.bytesRead).split(/\r?\n/u);
    if (headSplit.length > 1) headSplit.pop();

    const tailStart = Math.max(0, fileSize - tailBytes);
    const tailLen = fileSize - tailStart;
    const tailBuffer = Buffer.alloc(tailLen);
    const tailRead = await handle.read(tailBuffer, 0, tailLen, tailStart);
    const tailSplit = tailBuffer.toString('utf8', 0, tailRead.bytesRead).split(/\r?\n/u);
    if (tailStart > 0 && tailSplit.length > 1) tailSplit.shift();

    return {
      headLines: headSplit.filter((line) => line.length > 0),
      tailLines: tailSplit.filter((line) => line.length > 0),
      full: false,
    };
  } catch {
    return { headLines: [], tailLines: [], full: false };
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

export interface DiscoveredJsonlFile {
  readonly fullPath: string;
  readonly name: string;
  readonly stat: Stats;
}

export async function walkJsonlFiles(
  dir: string,
  maxDepth: number,
  out: DiscoveredJsonlFile[] = [],
  depth = 0
): Promise<DiscoveredJsonlFile[]> {
  if (depth > maxDepth || !existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(fullPath, maxDepth, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat) {
        out.push({ fullPath, name: entry.name, stat: fileStat });
      }
    }
  }
  return out;
}

export function normalizePathSlashes(value: string): string {
  return value.replace(/\\/gu, '/');
}

export function matchesWorkspacePath(cwd: string | null | undefined, repoRoot: string): boolean {
  if (!cwd || !repoRoot) return false;
  const normalizedCwd = normalizePathSlashes(cwd).toLowerCase().replace(/^file:\/\/\//u, '');
  const normalizedRepo = normalizePathSlashes(repoRoot).toLowerCase();
  const repoName = path.basename(normalizedRepo);
  return (
    normalizedCwd.includes(normalizedRepo) ||
    normalizedCwd.endsWith(`/${repoName}`) ||
    normalizedCwd.includes(`/${repoName}-`)
  );
}

export function deriveSessionStatus(
  mtimeMs: number,
  explicitRunState: string | null | undefined,
  hasRecentError: boolean,
  nowMs = Date.now()
): ObservatorySessionStatus {
  if (explicitRunState === 'RUN_STATE_RUNNING' || explicitRunState === 'RUN_STATE_CANCELLING') {
    return 'running';
  }
  const ageMs = nowMs - mtimeMs;
  if (ageMs <= ACTIVE_SESSION_THRESHOLD_MS) return 'running';
  if (hasRecentError && ageMs <= RECENT_SESSION_THRESHOLD_MS) return 'error';
  if (ageMs <= RECENT_SESSION_THRESHOLD_MS) return 'recent';
  return 'idle';
}
