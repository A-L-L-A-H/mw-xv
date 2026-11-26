import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveDesktopLogsDir } from './logger.js';

export type DesktopLogLevel = 'info' | 'warn' | 'error';
export type DesktopLogSource = 'rust' | 'sidecar' | 'webview' | 'mcp' | 'mesh';

export interface DesktopLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: DesktopLogLevel;
  readonly source: DesktopLogSource;
  readonly message: string;
  readonly detail?: string;
}

export interface DesktopLogIngestInput {
  readonly level: DesktopLogLevel;
  readonly source: DesktopLogSource;
  readonly message: string;
  readonly detail?: string;
  readonly timestamp?: string;
}

export interface DesktopLogQueryFilter {
  readonly level?: DesktopLogLevel | 'all';
  readonly source?: DesktopLogSource | 'all';
  readonly search?: string;
  readonly limit?: number;
}

export interface DesktopDiagnosticMetadata {
  readonly appVersion?: string;
  readonly platform?: string;
  readonly mode?: string;
  readonly sidecarUrl?: string;
  readonly logsDir?: string;
  readonly sidecarStderrTail?: readonly string[];
  readonly capturedAt?: string;
}

export interface DesktopLogHubOptions {
  readonly logsDir?: string;
  readonly desktopHomeDir?: string;
  readonly maxEntries?: number;
  readonly maxLiveFileBytes?: number;
  readonly knownSecrets?: readonly string[];
}

export const DEFAULT_LOG_HUB_CAPACITY = 1000;
export const DEFAULT_LIVE_JSONL_MAX_BYTES = 2_097_152; // 2 MiB

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/giu,
  /\bsk-[A-Za-z0-9_-]{12,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  /(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*["']?([^\s"',;}{]+)["']?/giu,
];

// Logs ingest untrusted text (stderr tails, HTTP bodies, webhook payloads).
// Strip control characters so a remote message cannot forge log lines or
// smuggle ANSI escapes into the persisted JSONL, and cap oversized payloads.
const MAX_PERSISTED_TEXT_LENGTH = 16_384;

export function sanitizeLogText(input: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  return withoutControlChars.length > MAX_PERSISTED_TEXT_LENGTH
    ? `${withoutControlChars.slice(0, MAX_PERSISTED_TEXT_LENGTH)}…[truncated]`
    : withoutControlChars;
}

export function redactSensitiveText(input: string, knownSecrets: readonly string[] = []): string {
  let result = input;
  for (const secret of knownSecrets) {
    if (secret.length >= 4) {
      result = result.split(secret).join('[REDACTED]');
    }
  }

  result = result.replace(SENSITIVE_PATTERNS[0]!, 'Bearer [REDACTED]');
  result = result.replace(SENSITIVE_PATTERNS[1]!, '[REDACTED_KEY]');
  result = result.replace(SENSITIVE_PATTERNS[2]!, '[REDACTED_TOKEN]');
  result = result.replace(SENSITIVE_PATTERNS[3]!, '[REDACTED_JWT]');
  result = result.replace(SENSITIVE_PATTERNS[4]!, (match, capturedValue: string) =>
    match.replace(capturedValue, '[REDACTED]')
  );

  return result;
}

export function readSidecarStderrTail(logsDir: string, maxLines = 40): readonly string[] {
  const candidates = [
    path.join(logsDir, 'sidecar-stderr.log'),
    path.join(logsDir, 'sidecar.stderr.log'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const content = readFileSync(candidate, 'utf8');
      const lines = content
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
      return lines.slice(-Math.max(1, maxLines)).map((line) => redactSensitiveText(line));
    } catch {
      return [];
    }
  }
  return [];
}

export function formatAiDiagnosticBundle(
  entries: readonly DesktopLogEntry[],
  metadata: DesktopDiagnosticMetadata = {}
): string {
  const capturedAt = metadata.capturedAt ?? new Date().toISOString();
  const errorCount = entries.filter((entry) => entry.level === 'error').length;
  const warnCount = entries.filter((entry) => entry.level === 'warn').length;
  const recentEntries = entries.slice(-80);

  const lines: string[] = [
    '# MoonWitness Desktop Diagnostic Bundle',
    '',
    `- **Captured At**: ${capturedAt}`,
    `- **Version**: ${metadata.appVersion ?? 'unknown'}`,
    `- **Platform**: ${metadata.platform ?? process.platform}`,
    `- **Mode**: ${metadata.mode ?? 'unknown'}`,
    `- **Entries**: ${entries.length} total (${errorCount} errors, ${warnCount} warnings)`,
  ];

  if (metadata.logsDir) {
    lines.push(`- **Logs Dir**: \`${metadata.logsDir}\``);
  }
  if (metadata.sidecarUrl) {
    lines.push(`- **Sidecar URL**: \`${metadata.sidecarUrl}\``);
  }

  lines.push('', '## Recent Log Entries', '', '```text');
  if (recentEntries.length === 0) {
    lines.push('(no log entries recorded)');
  } else {
    for (const entry of recentEntries) {
      const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
      lines.push(base);
      if (entry.detail) {
        lines.push(`  ${entry.detail.replace(/\r?\n/gu, '\n  ')}`);
      }
    }
  }
  lines.push('```');

  const stderrTail = metadata.sidecarStderrTail ?? [];
  if (stderrTail.length > 0) {
    lines.push('', '## Sidecar Stderr Tail', '', '```text', ...stderrTail, '```');
  }

  return lines.join('\n');
}

export class DesktopLogHub {
  readonly logsDir: string;
  readonly maxEntries: number;
  readonly maxLiveFileBytes: number;
  private readonly knownSecrets: readonly string[];
  private readonly buffer: DesktopLogEntry[] = [];
  private sequence = 0;

  constructor(options: DesktopLogHubOptions = {}) {
    this.logsDir = options.logsDir ?? resolveDesktopLogsDir(options.desktopHomeDir);
    this.maxEntries = Math.max(10, options.maxEntries ?? DEFAULT_LOG_HUB_CAPACITY);
    this.maxLiveFileBytes = Math.max(
      4096,
      options.maxLiveFileBytes ?? DEFAULT_LIVE_JSONL_MAX_BYTES
    );
    this.knownSecrets = options.knownSecrets ?? [];
    mkdirSync(this.logsDir, { recursive: true });
  }

  ingest(input: DesktopLogIngestInput): DesktopLogEntry {
    this.sequence += 1;
    const timestamp = input.timestamp ?? new Date().toISOString();
    const entry: DesktopLogEntry = {
      id: `log-${Date.now()}-${this.sequence}`,
      timestamp,
      level: input.level,
      source: input.source,
      message: sanitizeLogText(redactSensitiveText(input.message, this.knownSecrets)),
      ...(input.detail !== undefined
        ? { detail: sanitizeLogText(redactSensitiveText(input.detail, this.knownSecrets)) }
        : {}),
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }

    this.persistEntry(entry);
    return entry;
  }

  list(filter: DesktopLogQueryFilter = {}): readonly DesktopLogEntry[] {
    const search = filter.search?.trim().toLowerCase() ?? '';
    const filtered = this.buffer.filter((entry) => {
      if (filter.level && filter.level !== 'all' && entry.level !== filter.level) {
        return false;
      }
      if (filter.source && filter.source !== 'all' && entry.source !== filter.source) {
        return false;
      }
      if (search.length > 0) {
        const haystack =
          `${entry.message} ${entry.detail ?? ''} ${entry.source} ${entry.level}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    if (filter.limit && filter.limit > 0 && filtered.length > filter.limit) {
      return filtered.slice(-filter.limit);
    }
    return filtered;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  getEntryCount(): number {
    return this.buffer.length;
  }

  getDailyJsonlPath(dateIso = new Date().toISOString()): string {
    const day = dateIso.slice(0, 10);
    return path.join(this.logsDir, `desktop-${day}.jsonl`);
  }

  getLiveJsonlPath(): string {
    return path.join(this.logsDir, 'desktop.jsonl');
  }

  formatBundle(metadata: DesktopDiagnosticMetadata = {}): string {
    return formatAiDiagnosticBundle(this.buffer, {
      ...metadata,
      logsDir: metadata.logsDir ?? this.logsDir,
      sidecarStderrTail: metadata.sidecarStderrTail ?? readSidecarStderrTail(this.logsDir),
    });
  }

  private persistEntry(entry: DesktopLogEntry): void {
    const serialized = `${JSON.stringify(entry)}\n`;
    const dailyPath = this.getDailyJsonlPath(entry.timestamp);
    const livePath = this.getLiveJsonlPath();

    try {
      appendFileSync(dailyPath, serialized, 'utf8');
      if (existsSync(livePath) && statSync(livePath).size > this.maxLiveFileBytes) {
        writeFileSync(livePath, serialized, 'utf8');
      } else {
        appendFileSync(livePath, serialized, 'utf8');
      }
    } catch {
      // Never crash the desktop sidecar on disk I/O contention.
    }
  }
}
