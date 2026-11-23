import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { runDesktopDoctor, runDesktopDoctorRepair } from '../src/doctor.js';

describe('Desktop Self-Repair Doctor (Wave D.23)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs all 5 health checks and exports a redacted support report', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-doctor-test-'));
    tempDirs.push(tmpHome);
    const distBoardDir = path.join(tmpHome, 'dist-board');
    fs.mkdirSync(distBoardDir, { recursive: true });
    fs.writeFileSync(path.join(distBoardDir, 'index.html'), '<html></html>', 'utf8');

    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    try {
      const report = await runDesktopDoctor({
        db,
        desktopHomeDir: tmpHome,
        distBoardDir,
        apiPort: 4242,
        apiHealthy: true,
      });

      expect(report.healthy).toBe(true);
      expect(report.checks.map((c) => c.id)).toEqual([
        'sqlite_integrity',
        'logs_dir_writable',
        'dist_board_present',
        'api_port_health',
        'easytier_binary',
      ]);
      expect(report.checks.find((c) => c.id === 'sqlite_integrity')?.status).toBe('ok');
      expect(report.checks.find((c) => c.id === 'dist_board_present')?.status).toBe('ok');
      expect(report.supportReportMarkdown).toContain('# MoonWitness Desktop Support Report');
    } finally {
      await db.destroy();
    }
  });

  it('performs safe non-destructive repair by creating missing dirs and pruning stale temp files', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-doctor-repair-'));
    tempDirs.push(tmpHome);
    const tmpDir = path.join(tmpHome, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'orphan.tmp'), 'stale', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'keep.json'), '{}', 'utf8');

    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    try {
      const repair = await runDesktopDoctorRepair({
        db,
        desktopHomeDir: tmpHome,
        distBoardDir: path.join(tmpHome, 'missing-dist-board'),
        apiPort: 4242,
      });

      expect(repair.repaired).toBe(true);
      expect(repair.prunedTempFiles).toBe(1);
      expect(fs.existsSync(path.join(tmpHome, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'orphan.tmp'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'keep.json'))).toBe(true);
      expect(repair.report.checks.find((c) => c.id === 'logs_dir_writable')?.status).toBe('ok');
    } finally {
      await db.destroy();
    }
  });
});
