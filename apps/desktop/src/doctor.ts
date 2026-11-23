import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { redactSensitiveText } from './risk-gate.js';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheckResult {
  readonly id:
    | 'sqlite_integrity'
    | 'logs_dir_writable'
    | 'dist_board_present'
    | 'api_port_health'
    | 'easytier_binary';
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly detail?: string;
}

export interface DesktopDoctorReport {
  readonly healthy: boolean;
  readonly generatedAt: string;
  readonly platform: string;
  readonly checks: readonly DoctorCheckResult[];
  readonly supportReportMarkdown: string;
}

export interface DesktopDoctorRepairResult {
  readonly repaired: boolean;
  readonly actionsTaken: readonly string[];
  readonly prunedTempFiles: number;
  readonly report: DesktopDoctorReport;
}

export interface DesktopDoctorOptions {
  readonly db: Knex;
  readonly desktopHomeDir: string | null;
  readonly distBoardDir?: string;
  readonly apiPort?: number;
  readonly apiHealthy?: boolean;
  readonly easytierBinPath?: string;
}

function resolveLogsDir(desktopHomeDir: string | null): string {
  if (desktopHomeDir && desktopHomeDir !== ':memory:') {
    return path.join(desktopHomeDir, 'logs');
  }
  return path.join(os.homedir(), '.moonwitness', 'logs');
}

function resolveTempDir(desktopHomeDir: string | null): string {
  if (desktopHomeDir && desktopHomeDir !== ':memory:') {
    return path.join(desktopHomeDir, 'tmp');
  }
  return path.join(os.homedir(), '.moonwitness', 'tmp');
}

function findEasyTierBinary(desktopHomeDir: string | null, explicitPath?: string): string | null {
  if (explicitPath && fs.existsSync(explicitPath) && fs.statSync(explicitPath).isFile()) {
    return explicitPath;
  }
  const envBin = process.env.MW_EASYTIER_BIN?.trim();
  if (envBin && fs.existsSync(envBin) && fs.statSync(envBin).isFile()) {
    return envBin;
  }
  const binName = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core';
  const baseHome =
    desktopHomeDir && desktopHomeDir !== ':memory:'
      ? desktopHomeDir
      : path.join(os.homedir(), '.moonwitness');
  const homeCandidate = path.join(baseHome, 'bin', binName);
  if (fs.existsSync(homeCandidate) && fs.statSync(homeCandidate).isFile()) {
    return homeCandidate;
  }
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const candidate = path.join(trimmed, binName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function formatSupportReportMarkdown(
  checks: readonly DoctorCheckResult[],
  generatedAt: string,
): string {
  const lines = [
    '# MoonWitness Desktop Support Report',
    '',
    `- Generated At: \`${generatedAt}\``,
    `- Platform: \`${process.platform}\` (\`${process.arch}\`)`,
    `- Node: \`${process.version}\``,
    '',
    '## Health Checks',
    ...checks.map(
      (check) =>
        `- [${check.status.toUpperCase()}] **${check.id}**: ${redactSensitiveText(check.message).text}${
          check.detail ? ` (${redactSensitiveText(check.detail).text})` : ''
        }`,
    ),
    '',
  ];
  return lines.join('\n');
}

export async function runDesktopDoctor(
  options: DesktopDoctorOptions,
): Promise<DesktopDoctorReport> {
  const checks: DoctorCheckResult[] = [];

  // 1. SQLite PRAGMA integrity_check
  try {
    const raw: unknown = await options.db.raw('PRAGMA integrity_check');
    const rows = Array.isArray(raw) ? raw : [];
    const firstRow = rows[0] as Record<string, unknown> | undefined;
    const integrityValue =
      firstRow && typeof firstRow.integrity_check === 'string'
        ? firstRow.integrity_check
        : 'ok';
    const isOk = integrityValue.toLowerCase() === 'ok';
    checks.push({
      id: 'sqlite_integrity',
      status: isOk ? 'ok' : 'fail',
      message: isOk ? 'SQLite integrity_check passed' : `SQLite integrity issue: ${integrityValue}`,
    });
  } catch (err) {
    checks.push({
      id: 'sqlite_integrity',
      status: 'fail',
      message: 'SQLite integrity_check failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. logs/ directory writability
  const logsDir = resolveLogsDir(options.desktopHomeDir);
  try {
    if (!fs.existsSync(logsDir)) {
      checks.push({
        id: 'logs_dir_writable',
        status: 'warn',
        message: 'Desktop logs directory does not exist yet',
        detail: logsDir,
      });
    } else {
      const probeFile = path.join(logsDir, `.doctor-probe-${process.pid}.tmp`);
      fs.writeFileSync(probeFile, 'ok', 'utf8');
      fs.rmSync(probeFile, { force: true });
      checks.push({
        id: 'logs_dir_writable',
        status: 'ok',
        message: 'Desktop logs directory is writable',
        detail: logsDir,
      });
    }
  } catch (err) {
    checks.push({
      id: 'logs_dir_writable',
      status: 'fail',
      message: 'Desktop logs directory is not writable',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. dist-board/index.html presence
  const distBoardDir =
    options.distBoardDir ?? path.resolve(process.cwd(), 'apps', 'desktop', 'dist-board');
  const distBoardIndex = path.join(distBoardDir, 'index.html');
  if (fs.existsSync(distBoardIndex)) {
    checks.push({
      id: 'dist_board_present',
      status: 'ok',
      message: 'Bundled dist-board/index.html is present',
      detail: distBoardIndex,
    });
  } else {
    checks.push({
      id: 'dist_board_present',
      status: 'warn',
      message: 'dist-board/index.html not found (run desktop UI build for packaged bundle)',
      detail: distBoardIndex,
    });
  }

  // 4. API port health
  const apiHealthy = options.apiHealthy ?? true;
  checks.push({
    id: 'api_port_health',
    status: apiHealthy ? 'ok' : 'fail',
    message: apiHealthy
      ? `Local desktop API server healthy${options.apiPort ? ` on port ${options.apiPort}` : ''}`
      : 'Local desktop API server is unreachable',
  });

  // 5. EasyTier binary availability
  const easytierPath = findEasyTierBinary(options.desktopHomeDir, options.easytierBinPath);
  checks.push({
    id: 'easytier_binary',
    status: easytierPath ? 'ok' : 'warn',
    message: easytierPath
      ? 'EasyTier mesh binary available'
      : 'EasyTier mesh binary not installed (optional for Workspace mode)',
    ...(easytierPath ? { detail: easytierPath } : {}),
  });

  const healthy = checks.every((check) => check.status !== 'fail');
  const generatedAt = new Date().toISOString();
  const supportReportMarkdown = formatSupportReportMarkdown(checks, generatedAt);

  return {
    healthy,
    generatedAt,
    platform: process.platform,
    checks,
    supportReportMarkdown,
  };
}

export async function runDesktopDoctorRepair(
  options: DesktopDoctorOptions,
): Promise<DesktopDoctorRepairResult> {
  const actionsTaken: string[] = [];
  let prunedTempFiles = 0;

  const logsDir = resolveLogsDir(options.desktopHomeDir);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    actionsTaken.push(`created_logs_dir:${logsDir}`);
  }

  const tmpDir = resolveTempDir(options.desktopHomeDir);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
    actionsTaken.push(`created_tmp_dir:${tmpDir}`);
  } else {
    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.tmp') || entry.name.endsWith('.stale'))) {
        fs.rmSync(path.join(tmpDir, entry.name), { force: true });
        prunedTempFiles += 1;
      }
    }
    if (prunedTempFiles > 0) {
      actionsTaken.push(`pruned_temp_files:${prunedTempFiles}`);
    }
  }

  const report = await runDesktopDoctor(options);
  return {
    repaired: true,
    actionsTaken,
    prunedTempFiles,
    report,
  };
}
