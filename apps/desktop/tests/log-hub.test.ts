import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DesktopLogHub,
  formatAiDiagnosticBundle,
  readSidecarStderrTail,
  redactSensitiveText,
} from '../src/log-hub.js';

const tempDirs: string[] = [];

function createTempLogsDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mw-log-hub-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('DesktopLogHub', () => {
  it('enforces bounded ring buffer capacity', () => {
    const logsDir = createTempLogsDir();
    const hub = new DesktopLogHub({ logsDir, maxEntries: 15 });

    for (let index = 1; index <= 25; index += 1) {
      hub.ingest({
        level: 'info',
        source: 'sidecar',
        message: `event-${index}`,
      });
    }

    const entries = hub.list();
    expect(entries).toHaveLength(15);
    expect(entries[0]?.message).toBe('event-11');
    expect(entries[entries.length - 1]?.message).toBe('event-25');
  });

  it('writes rotating daily JSONL and live desktop.jsonl files with redaction', () => {
    const logsDir = createTempLogsDir();
    const hub = new DesktopLogHub({
      logsDir,
      knownSecrets: ['super-secret-mesh-token'],
    });

    const timestamp = '2026-11-23T03:05:00.000Z';
    const entry = hub.ingest({
      level: 'error',
      source: 'mcp',
      timestamp,
      message: 'Auth failed with Bearer abc123xyz and sk-1234567890abcdef',
      detail: 'token=super-secret-mesh-token',
    });

    expect(entry.message).not.toContain('abc123xyz');
    expect(entry.message).not.toContain('sk-1234567890abcdef');
    expect(entry.detail).not.toContain('super-secret-mesh-token');

    const dailyContent = readFileSync(hub.getDailyJsonlPath(timestamp), 'utf8');
    const liveContent = readFileSync(hub.getLiveJsonlPath(), 'utf8');
    expect(dailyContent).toContain('[REDACTED]');
    expect(liveContent).toContain('[REDACTED_KEY]');
  });

  it('filters entries by level, source, and search query', () => {
    const logsDir = createTempLogsDir();
    const hub = new DesktopLogHub({ logsDir });

    hub.ingest({ level: 'info', source: 'rust', message: 'Sidecar started' });
    hub.ingest({ level: 'warn', source: 'mesh', message: 'Peer latency spike' });
    hub.ingest({ level: 'error', source: 'webview', message: 'Chunk load failure' });

    expect(hub.list({ level: 'error' })).toHaveLength(1);
    expect(hub.list({ source: 'mesh' })).toHaveLength(1);
    expect(hub.list({ search: 'chunk' })[0]?.source).toBe('webview');

    hub.clear();
    expect(hub.getEntryCount()).toBe(0);
  });

  it('reads redacted sidecar stderr tail and formats concise AI diagnostic bundle', () => {
    const logsDir = createTempLogsDir();
    writeFileSync(
      path.join(logsDir, 'sidecar-stderr.log'),
      'line-1 ok\nline-2 api_key=my_secret_value_99\n',
      'utf8'
    );

    const tail = readSidecarStderrTail(logsDir, 10);
    expect(tail).toHaveLength(2);
    expect(tail[1]).toContain('[REDACTED]');
    expect(tail[1]).not.toContain('my_secret_value_99');

    const bundle = formatAiDiagnosticBundle(
      [
        {
          id: 'log-1',
          timestamp: '2026-11-23T03:10:00.000Z',
          level: 'error',
          source: 'sidecar',
          message: 'SQLite lock timeout',
          detail: 'SQLITE_BUSY',
        },
      ],
      {
        appVersion: '1.0.0',
        platform: 'win32',
        mode: 'developer',
        logsDir,
        sidecarStderrTail: tail,
      }
    );

    expect(bundle).toContain('# MoonWitness Desktop Diagnostic Bundle');
    expect(bundle).toContain('SQLite lock timeout');
    expect(bundle).toContain('## Sidecar Stderr Tail');
    expect(redactSensitiveText('password=hunter2')).toContain('[REDACTED]');
  });
});
