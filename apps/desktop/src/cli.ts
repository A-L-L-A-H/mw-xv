import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createAiMcpServer, serveAiMcpStdio, type AiMcpAuthContext } from '@moonwitness/ai-mcp';
import { DEFAULT_BOARD_ORIGIN } from '@moonwitness/types';
import { createDesktopHarnessBridge } from './bridge.js';
import { importDesktopTasks } from './importer.js';
import {
  ensureLocalWorkspaceBootstrap,
  startLocalApiServer,
  type LocalApiServerHandle,
} from './local-api-server.js';
import {
  DESKTOP_ADDONS,
  LocalSidecarController,
  resolveDesktopDatabasePath,
  resolveDesktopHomeDir,
} from './local-sidecar.js';
import type { DesktopCapabilityBridge } from './types.js';

export type DesktopCliSubcommand = 'serve' | 'mcp' | 'import';

export interface DesktopCliOptions {
  readonly subcommand?: DesktopCliSubcommand;
  readonly importPath?: string;
  readonly repoRoot: string;
  readonly desktopHomeDir: string;
  readonly sqlitePath: string;
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly healthPort: number;
  readonly apiPort?: number;
  readonly offlineMode: boolean;
  readonly installAddonsOnStart: boolean;
  readonly serveWeb?: boolean;
}

export interface DesktopSidecarDaemonHandle {
  readonly bridge: DesktopCapabilityBridge;
  readonly apiUrl: string;
  readonly mcpUrl: string;
  readonly healthUrl: string;
  readonly observatoryUrl?: string;
  readonly healthPort: number;
  readonly rpcToken: string;
  readonly sqlitePath: string;
  stop(): Promise<void>;
}

export function parseDesktopCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): DesktopCliOptions {
  let subcommand: DesktopCliSubcommand = 'serve';
  let importPath: string | undefined;
  let repoRoot = env.MW_DESKTOP_REPO_ROOT ?? process.cwd();
  let desktopHomeDir = resolveDesktopHomeDir(env.MW_DESKTOP_HOME);
  let sqlitePath: string | undefined = env.MW_DESKTOP_SQLITE_PATH;
  let boardOrigin = env.MW_DESKTOP_BOARD_ORIGIN ?? DEFAULT_BOARD_ORIGIN;
  let apiBaseUrl = env.MW_DESKTOP_API_URL ?? 'http://127.0.0.1:4242';
  let healthPort = Number.parseInt(env.MW_DESKTOP_HEALTH_PORT ?? '0', 10) || 0;
  let apiPort: number | undefined =
    env.MW_DESKTOP_API_PORT !== undefined
      ? Number.parseInt(env.MW_DESKTOP_API_PORT, 10)
      : undefined;
  let offlineMode = env.MW_DESKTOP_OFFLINE === 'true';
  let installAddonsOnStart = env.MW_DESKTOP_SKIP_ADDONS !== 'true';
  let serveWeb = env.MW_DESKTOP_SERVE_WEB === 'true';

  let startIndex = 0;
  if (argv[0] === 'serve') {
    subcommand = 'serve';
    startIndex = 1;
  } else if (argv[0] === 'mcp') {
    subcommand = 'mcp';
    startIndex = 1;
  } else if (argv[0] === 'import') {
    subcommand = 'import';
    if (argv[1] && !argv[1].startsWith('--')) {
      importPath = argv[1];
      startIndex = 2;
    } else {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < argv.length; i += 1) {
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
    } else if (arg === '--api-port' && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1] ?? '4242', 10);
      apiPort = Number.isNaN(parsed) ? 4242 : parsed;
      i += 1;
    } else if (arg === '--offline') {
      offlineMode = true;
    } else if (arg === '--skip-addons') {
      installAddonsOnStart = false;
    } else if (arg === '--serve-web') {
      serveWeb = true;
    } else if (subcommand === 'import' && !importPath && arg && !arg.startsWith('--')) {
      importPath = arg;
    }
  }

  return {
    subcommand,
    ...(importPath !== undefined ? { importPath } : {}),
    repoRoot: path.resolve(repoRoot),
    desktopHomeDir,
    sqlitePath: resolveDesktopDatabasePath(sqlitePath, desktopHomeDir),
    boardOrigin,
    apiBaseUrl,
    healthPort,
    ...(apiPort !== undefined ? { apiPort } : {}),
    offlineMode,
    installAddonsOnStart,
    serveWeb,
  };
}

export async function startDesktopSidecarDaemon(
  options: DesktopCliOptions
): Promise<DesktopSidecarDaemonHandle> {
  const effectivePort = options.apiPort !== undefined ? options.apiPort : options.healthPort;
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

  let apiServer: LocalApiServerHandle | null = null;
  try {
    if (options.installAddonsOnStart) {
      await bridge.sidecar.initializeOrmAddons();
    }

    const serveWebDistDir = options.serveWeb
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-board')
      : undefined;

    apiServer = await startLocalApiServer({
      bridge,
      host: '127.0.0.1',
      port: effectivePort,
      repoRoot: options.repoRoot,
      ...(serveWebDistDir ? { serveWebDistDir } : {}),
    });

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      if (apiServer) {
        await apiServer.stop();
      }
      bridge.dispose();
    };

    return {
      bridge,
      apiUrl: apiServer.apiUrl,
      mcpUrl: apiServer.mcpUrl,
      healthUrl: apiServer.healthUrl,
      ...(options.serveWeb
        ? { observatoryUrl: `${apiServer.apiUrl}/board/desktop/observatory` }
        : {}),
      healthPort: apiServer.port,
      rpcToken: apiServer.rpcToken,
      sqlitePath: options.sqlitePath,
      stop,
    };
  } catch (error) {
    if (apiServer) {
      await apiServer.stop();
    }
    bridge.dispose();
    throw error;
  }
}

async function runMcpSubcommand(options: DesktopCliOptions): Promise<void> {
  const sidecar = new LocalSidecarController({
    sqlitePath: options.sqlitePath,
    desktopHomeDir: options.desktopHomeDir,
    offlineMode: true,
  });
  try {
    await sidecar.initializeOrmAddons(DESKTOP_ADDONS);
    const db = sidecar.getOrmKnex();
    if (!db) {
      throw new Error('Failed to initialize SQLite ORM Knex handle for MCP');
    }
    const workspace = await ensureLocalWorkspaceBootstrap(db);
    sidecar.setActiveCompany(workspace.companyId);

    const mcpServer = createAiMcpServer({ db });
    const authContext: AiMcpAuthContext = {
      companyId: workspace.companyId,
      userId: workspace.userId,
      actorRole: 'superadmin',
      role: 'superadmin',
      grants: ['agent.registry_read@v1', 'project.read@v1', 'project.write@v1'],
    };

    const stdioHandle = serveAiMcpStdio(mcpServer, authContext);
    const onSignal = (): void => {
      void stdioHandle.close().finally(() => {
        sidecar.close();
        process.exit(0);
      });
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    await stdioHandle.done;
    await mcpServer.close();
  } finally {
    sidecar.close();
  }
}

async function runImportSubcommand(options: DesktopCliOptions): Promise<void> {
  if (!options.importPath) {
    throw new Error('Missing import source path. Usage: moonwitness-desktop import <path>');
  }
  const sidecar = new LocalSidecarController({
    sqlitePath: options.sqlitePath,
    desktopHomeDir: options.desktopHomeDir,
    offlineMode: true,
  });
  try {
    await sidecar.initializeOrmAddons(DESKTOP_ADDONS);
    const db = sidecar.getOrmKnex();
    if (!db) {
      throw new Error('Failed to initialize SQLite ORM Knex handle for import');
    }
    const workspace = await ensureLocalWorkspaceBootstrap(db);
    sidecar.setActiveCompany(workspace.companyId);
    const summary = await importDesktopTasks({
      db,
      companyId: workspace.companyId,
      userId: workspace.userId,
      sourcePath: options.importPath,
    });
    process.stdout.write(`${JSON.stringify({ status: 'imported', ...summary })}\n`);
  } finally {
    sidecar.close();
  }
}

async function runCliMain(): Promise<void> {
  const options = parseDesktopCliArgs(process.argv.slice(2));
  if (options.subcommand === 'mcp') {
    await runMcpSubcommand(options);
    return;
  }
  if (options.subcommand === 'import') {
    await runImportSubcommand(options);
    return;
  }

  const effectiveOptions: DesktopCliOptions = {
    ...options,
    apiPort: options.apiPort ?? (options.healthPort > 0 ? options.healthPort : 4242),
  };
  const daemon = await startDesktopSidecarDaemon(effectiveOptions);

  const onSignal = (): void => {
    void daemon.stop().finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.stdout.write(
    `${JSON.stringify({
      status: 'listening',
      apiUrl: daemon.apiUrl,
      mcpUrl: daemon.mcpUrl,
      healthUrl: daemon.healthUrl,
      ...(daemon.observatoryUrl ? { observatoryUrl: daemon.observatoryUrl } : {}),
      sqlitePath: daemon.sqlitePath,
      rpcToken: daemon.rpcToken,
    })}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCliMain();
}
