import { createServer, type Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDesktopHarnessBridge } from './bridge.js';
import { resolveDesktopDatabasePath, resolveDesktopHomeDir } from './local-sidecar.js';
import type { DesktopCapabilityBridge } from './types.js';

export interface DesktopCliOptions {
  readonly repoRoot: string;
  readonly desktopHomeDir: string;
  readonly sqlitePath: string;
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly healthPort: number;
  readonly offlineMode: boolean;
  readonly installAddonsOnStart: boolean;
}

export interface DesktopSidecarDaemonHandle {
  readonly bridge: DesktopCapabilityBridge;
  readonly healthUrl: string;
  readonly healthPort: number;
  readonly sqlitePath: string;
  stop(): Promise<void>;
}

export function parseDesktopCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): DesktopCliOptions {
  let repoRoot = env.MW_DESKTOP_REPO_ROOT ?? process.cwd();
  let desktopHomeDir = resolveDesktopHomeDir(env.MW_DESKTOP_HOME);
  let sqlitePath: string | undefined = env.MW_DESKTOP_SQLITE_PATH;
  let boardOrigin = env.MW_DESKTOP_BOARD_ORIGIN ?? 'http://127.0.0.1:5173';
  let apiBaseUrl = env.MW_DESKTOP_API_URL ?? 'http://127.0.0.1:3000';
  let healthPort = Number.parseInt(env.MW_DESKTOP_HEALTH_PORT ?? '0', 10) || 0;
  let offlineMode = env.MW_DESKTOP_OFFLINE === 'true';
  let installAddonsOnStart = env.MW_DESKTOP_SKIP_ADDONS !== 'true';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo-root' && argv[i + 1]) {
      repoRoot = path.resolve(argv[i + 1] ?? repoRoot);
      i += 1;
    } else if (arg === '--desktop-home' && argv[i + 1]) {
      desktopHomeDir = resolveDesktopHomeDir(argv[i + 1]);
      i += 1;
    } else if (arg === '--sqlite-path' && argv[i + 1]) {
      sqlitePath = argv[i + 1];
      i += 1;
    } else if (arg === '--board-origin' && argv[i + 1]) {
      boardOrigin = argv[i + 1] ?? boardOrigin;
      i += 1;
    } else if (arg === '--api-url' && argv[i + 1]) {
      apiBaseUrl = argv[i + 1] ?? apiBaseUrl;
      i += 1;
    } else if (arg === '--health-port' && argv[i + 1]) {
      healthPort = Number.parseInt(argv[i + 1] ?? '0', 10) || 0;
      i += 1;
    } else if (arg === '--offline') {
      offlineMode = true;
    } else if (arg === '--skip-addons') {
      installAddonsOnStart = false;
    }
  }

  return {
    repoRoot: path.resolve(repoRoot),
    desktopHomeDir,
    sqlitePath: resolveDesktopDatabasePath(sqlitePath, desktopHomeDir),
    boardOrigin,
    apiBaseUrl,
    healthPort,
    offlineMode,
    installAddonsOnStart,
  };
}

export async function startDesktopSidecarDaemon(
  options: DesktopCliOptions
): Promise<DesktopSidecarDaemonHandle> {
  const bridge = createDesktopHarnessBridge(
    {
      repoRoot: options.repoRoot,
      desktopHomeDir: options.desktopHomeDir,
      sqlitePath: options.sqlitePath,
      boardOrigin: options.boardOrigin,
      apiBaseUrl: options.apiBaseUrl,
      offlineMode: options.offlineMode,
    },
    { autoAttach: false }
  );

  try {
    if (options.installAddonsOnStart) {
      await bridge.sidecar.initializeOrmAddons();
    }

    const server: Server = createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/livez')) {
        const sidecar = bridge.sidecar.getState();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: sidecar.status !== 'stopped',
            protocolVersion: bridge.protocolVersion,
            hostSurface: bridge.hostSurface,
            sidecar,
          })
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.healthPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind loopback health server');
    }

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      bridge.dispose();
    };

    return {
      bridge,
      healthPort: address.port,
      healthUrl: `http://127.0.0.1:${address.port}/healthz`,
      sqlitePath: options.sqlitePath,
      stop,
    };
  } catch (error) {
    bridge.dispose();
    throw error;
  }
}

async function runCliMain(): Promise<void> {
  const options = parseDesktopCliArgs(process.argv.slice(2));
  const daemon = await startDesktopSidecarDaemon(options);

  const onSignal = (): void => {
    void daemon.stop().finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.stdout.write(
    `${JSON.stringify({ status: 'listening', healthUrl: daemon.healthUrl, sqlitePath: daemon.sqlitePath })}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCliMain();
}
