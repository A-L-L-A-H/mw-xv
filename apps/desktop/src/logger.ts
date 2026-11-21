import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { createLogger } from '@moonwitness/logger';
import { AI_LOGGER_REDACT_PATHS, createRedactor } from '@moonwitness/ai-runtime';
import { resolveDesktopHomeDir } from './local-sidecar.js';

export const DEFAULT_LOG_MAX_BYTES_PER_FILE = 1_048_576; // 1 MiB
export const DEFAULT_LOG_MAX_FILES = 5;

export interface DesktopLoggerOptions {
  readonly desktopHomeDir?: string;
  readonly service?: string;
  readonly level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  readonly maxBytesPerFile?: number;
  readonly maxFiles?: number;
  readonly knownSecrets?: readonly string[];
}

export function resolveDesktopLogsDir(desktopHomeDir?: string): string {
  return path.join(resolveDesktopHomeDir(desktopHomeDir), 'logs');
}

export class RotatingLocalLogSink {
  readonly logsDir: string;
  readonly maxBytesPerFile: number;
  readonly maxFiles: number;
  private fileIndex = 0;

  constructor(options: {
    readonly logsDir: string;
    readonly maxBytesPerFile?: number;
    readonly maxFiles?: number;
  }) {
    this.logsDir = options.logsDir;
    this.maxBytesPerFile = Math.max(512, options.maxBytesPerFile ?? DEFAULT_LOG_MAX_BYTES_PER_FILE);
    this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_LOG_MAX_FILES);
    mkdirSync(this.logsDir, { recursive: true });
  }

  writeLine(line: string): string {
    const targetPath = this.resolveCurrentLogFile();
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    const byteLen = Buffer.byteLength(payload, 'utf8');

    let writePath = targetPath;
    if (existsSync(writePath)) {
      const currentSize = statSync(writePath).size;
      if (currentSize + byteLen > this.maxBytesPerFile) {
        this.fileIndex += 1;
        writePath = path.join(
          this.logsDir,
          `desktop-${Date.now()}-${String(this.fileIndex).padStart(4, '0')}.log`
        );
      }
    }

    appendFileSync(writePath, payload, 'utf8');
    this.pruneOldFiles();
    return writePath;
  }

  listLogFiles(): readonly string[] {
    if (!existsSync(this.logsDir)) return [];
    return readdirSync(this.logsDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => path.join(this.logsDir, name))
      .sort((a, b) => {
        const diff = statSync(a).mtimeMs - statSync(b).mtimeMs;
        return diff !== 0 ? diff : a.localeCompare(b);
      });
  }

  private resolveCurrentLogFile(): string {
    const existing = this.listLogFiles();
    if (existing.length > 0) {
      return existing[existing.length - 1]!;
    }
    this.fileIndex += 1;
    return path.join(
      this.logsDir,
      `desktop-${Date.now()}-${String(this.fileIndex).padStart(4, '0')}.log`
    );
  }

  private pruneOldFiles(): void {
    const files = this.listLogFiles();
    if (files.length <= this.maxFiles) return;
    const toDelete = files.slice(0, files.length - this.maxFiles);
    for (const filePath of toDelete) {
      try {
        unlinkSync(filePath);
      } catch {
        // ignore concurrent cleanup
      }
    }
  }
}

export interface DesktopLoggerHandle {
  readonly logger: ReturnType<typeof createLogger>;
  readonly sink: RotatingLocalLogSink;
  readonly logsDir: string;
  readonly redactPaths: readonly string[];
  writeAuditLine(event: string, fields: Readonly<Record<string, unknown>>): string;
}

export function createDesktopLogger(options?: DesktopLoggerOptions): DesktopLoggerHandle {
  const logsDir = resolveDesktopLogsDir(options?.desktopHomeDir);
  const sink = new RotatingLocalLogSink({
    logsDir,
    maxBytesPerFile: options?.maxBytesPerFile,
    maxFiles: options?.maxFiles,
  });
  const redactor = createRedactor(options?.knownSecrets ?? []);

  const logger = createLogger({
    name: options?.service ?? 'moonwitness-desktop',
    level: options?.level ?? 'info',
    logDir: logsDir,
    enableFile: false,
    enableConsole: false,
  });

  const writeAuditLine = (event: string, fields: Readonly<Record<string, unknown>>): string => {
    const entry = {
      timestamp: new Date().toISOString(),
      service: options?.service ?? 'moonwitness-desktop',
      event,
      ...redactor.redactObject(fields),
    };
    return sink.writeLine(JSON.stringify(entry));
  };

  return {
    logger,
    sink,
    logsDir,
    redactPaths: [...AI_LOGGER_REDACT_PATHS],
    writeAuditLine,
  };
}
