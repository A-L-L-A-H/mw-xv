import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const trackedTempDirs = new Set();

export function canonicalizePath(targetPath) {
  try {
    return realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function resolveRepoRoot() {
  let current = canonicalizePath(path.dirname(fileURLToPath(import.meta.url)));
  for (let i = 0; i < 8; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'moonwitness-monorepo') {
          return canonicalizePath(current);
        }
      } catch {
        // Continue walking up if package.json is unreadable.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return canonicalizePath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
}

export function createApiRequire() {
  const root = resolveRepoRoot();
  return createRequire(path.join(root, 'apps', 'api', 'package.json'));
}

function normalizePackageDirName(pkgName) {
  return pkgName.startsWith('@moonwitness/') ? pkgName.slice('@moonwitness/'.length) : pkgName;
}

export async function importBuiltPackage(pkgName) {
  const root = resolveRepoRoot();
  const dirName = normalizePackageDirName(pkgName);
  const distPath = path.join(root, 'packages', dirName, 'dist', 'index.js');
  if (!existsSync(distPath)) return null;
  return import(pathToFileURL(canonicalizePath(distPath)).href);
}

export async function importApiApp() {
  const root = resolveRepoRoot();
  const appDistPath = path.join(root, 'apps', 'api', 'dist', 'app.js');
  if (!existsSync(appDistPath)) return null;
  process.env.NODE_ENV = 'test';
  process.env.LOG_TO_FILE = 'false';
  process.env.LOG_LEVEL = 'silent';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  return import(pathToFileURL(canonicalizePath(appDistPath)).href);
}

function fileContainsAny(filePath, patterns) {
  if (!existsSync(filePath)) return false;
  try {
    const text = readFileSync(filePath, 'utf8');
    return patterns.some((pattern) => text.includes(pattern));
  } catch {
    return false;
  }
}

function hasAiAddonInApi(root) {
  const policyDist = path.join(root, 'apps', 'api', 'dist', 'auth', 'policy.js');
  const registryDist = path.join(root, 'apps', 'api', 'dist', 'addons', 'registry.js');

  const hasInternalPrefix = fileContainsAny(policyDist, ["'ai.'", '"ai."']);
  const hasAddonEntry = fileContainsAny(registryDist, [
    '@moonwitness/orm-ai',
    "name: 'ai'",
    'name: "ai"',
  ]);
  return hasInternalPrefix && hasAddonEntry;
}

function hasBoardBuilt(root) {
  const standaloneServerJs = path.join(
    root,
    'apps',
    'board',
    '.next',
    'standalone',
    'apps',
    'board',
    'server.js'
  );
  const buildId = path.join(root, 'apps', 'board', '.next', 'BUILD_ID');
  return existsSync(standaloneServerJs) || existsSync(buildId);
}

function hasBoardAiRoutes(root) {
  const aiBoardDir = path.join(root, 'apps', 'board', 'src', 'app', 'board', 'ai');
  if (!existsSync(aiBoardDir)) return false;
  try {
    const entries = readdirSync(aiBoardDir, { withFileTypes: true });
    return entries.some((entry) => {
      if (entry.isFile() && entry.name === 'page.tsx') return true;
      if (entry.isDirectory()) {
        return existsSync(path.join(aiBoardDir, entry.name, 'page.tsx'));
      }
      return false;
    });
  } catch {
    return false;
  }
}

function hasAiCorporationDocs(root) {
  const adrPath = path.join(
    root,
    'docs',
    'decisions',
    '0007-ai-corporation-addon-first-architecture.md'
  );
  const aiDocsDir = path.join(root, 'docs', 'ai-corporation');
  if (!existsSync(adrPath) || !existsSync(aiDocsDir)) return false;
  try {
    const entries = readdirSync(aiDocsDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith('.md'));
  } catch {
    return false;
  }
}

function hasPlaywrightInstalled(root) {
  const binName = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
  return (
    existsSync(path.join(root, 'node_modules', '.bin', binName)) ||
    existsSync(path.join(root, 'node_modules', '@playwright', 'test', 'package.json'))
  );
}

export async function checkPrerequisites(reqs = []) {
  const root = resolveRepoRoot();
  const missing = [];

  for (const req of reqs) {
    if (req.startsWith('pkg:')) {
      const pkgName = req.slice('pkg:'.length);
      const dirName = normalizePackageDirName(pkgName);
      const distPath = path.join(root, 'packages', dirName, 'dist', 'index.js');
      if (!existsSync(distPath)) missing.push(req);
      continue;
    }

    if (req === 'api:built') {
      if (!existsSync(path.join(root, 'apps', 'api', 'dist', 'app.js'))) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'api:ai-addon') {
      if (!existsSync(path.join(root, 'apps', 'api', 'dist', 'app.js')) || !hasAiAddonInApi(root)) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'mcp:built') {
      if (!existsSync(path.join(root, 'packages', 'ai-mcp', 'dist', 'index.js'))) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'eval:built') {
      if (!existsSync(path.join(root, 'packages', 'ai-evaluation', 'dist', 'index.js'))) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'board:ai-routes') {
      if (!hasBoardAiRoutes(root)) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'board:server') {
      const externalUrl = process.env.MW_E2E_BOARD_URL?.trim();
      if (!externalUrl && !(hasBoardAiRoutes(root) && hasBoardBuilt(root))) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'doc:ai-corporation') {
      if (!hasAiCorporationDocs(root)) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'env:POSTGRES_TEST_URL') {
      if (!process.env.POSTGRES_TEST_URL || !process.env.POSTGRES_TEST_URL.trim()) {
        missing.push(req);
      }
      continue;
    }

    if (req === 'cmd:playwright') {
      if (!hasPlaywrightInstalled(root)) {
        missing.push(req);
      }
      continue;
    }

    missing.push(req);
  }

  return { ok: missing.length === 0, missing };
}

export async function makeTempDir(prefix = 'mw-ai-e2e-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  trackedTempDirs.add(dir);
  return dir;
}

export async function cleanupTempDirs() {
  const dirs = [...trackedTempDirs];
  trackedTempDirs.clear();
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function createDeterministicHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function createIsolatedApi(opts = {}) {
  process.env.NODE_ENV = 'test';
  process.env.LOG_TO_FILE = 'false';

  const apiModule = await importApiApp();
  if (!apiModule || typeof apiModule.buildApp !== 'function') {
    throw new Error('apps/api/dist/app.js is not built or missing buildApp export');
  }

  const ormStorage = await importBuiltPackage('orm-storage');
  if (!ormStorage || typeof ormStorage.LocalFileAttachmentStorage !== 'function') {
    throw new Error('packages/orm-storage/dist/index.js is not built');
  }

  const ormBase = await importBuiltPackage('orm-base');
  if (!ormBase) {
    throw new Error('packages/orm-base/dist/index.js is not built');
  }

  const requireFromApi = createApiRequire();
  const knex = requireFromApi('knex');

  const db =
    opts.db ??
    knex({
      client: 'better-sqlite3',
      connection: { filename: opts.dbPath ?? ':memory:' },
      useNullAsDefault: true,
      ...(opts.foreignKeys
        ? {
            pool: {
              afterCreate(conn, done) {
                conn.pragma('foreign_keys = ON');
                done(null, conn);
              },
            },
          }
        : {}),
    });

  const ownedStorageDir = opts.attachmentStorage ? null : await makeTempDir('mw-ai-e2e-storage-');
  const storageDir = opts.storageDir ?? ownedStorageDir;
  const attachmentStorage =
    opts.attachmentStorage ?? new ormStorage.LocalFileAttachmentStorage(storageDir);

  const superadminPassword = opts.superadminPassword ?? 'test-admin-pass-123';
  const jwtSecret = opts.jwtSecret ?? 'test-secret-test-secret-test-secret-123';

  const app = await apiModule.buildApp({
    db,
    superadminPassword,
    jwtSecret,
    loginRateMax: opts.loginRateMax ?? 1000,
    attachmentStorage,
    attachmentScanner: null,
    checkWhatsAppGateway: async () => true,
    ...opts.buildAppOptions,
  });
  await app.ready();

  function authHeaders(token, companyId) {
    const headers = { authorization: `Bearer ${token}` };
    if (companyId !== undefined && companyId !== null) {
      headers['x-company-id'] = String(companyId);
    }
    return headers;
  }

  async function loginAs(login, password, companyId) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login, password },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `Login failed for "${login}" (status ${response.statusCode}): ${response.body}`
      );
    }
    const body = response.json();
    const token = body?.data?.access_token;
    const refreshToken = body?.data?.refresh_token;
    const user = body?.data?.user;
    if (!token) {
      throw new Error(`Login response for "${login}" missing access_token`);
    }
    return {
      token,
      refreshToken,
      user,
      headers: authHeaders(token, companyId),
    };
  }

  const adminLogin = await loginAs('superadmin', superadminPassword);
  const superadminToken = adminLogin.token;

  async function createCompanyAndUsers(companyOpts = {}) {
    const companyName = companyOpts.companyName ?? `Test Company ${Date.now()}`;
    const userSpecs = Array.isArray(companyOpts.users) ? companyOpts.users : [];
    const { Company, Partner, User, CompanyMembership, AccessGroup, GroupMembership } = ormBase;

    const company = await Company.query().insertAndFetch({ name: companyName });
    const defaultUserGroup = await AccessGroup.query().findOne({ code: 'user' });

    if (companyOpts.addSuperadminMembership) {
      const superadminUser = await User.query().findOne({ login: 'superadmin' });
      if (superadminUser) {
        const existingMembership = await CompanyMembership.query().findOne({
          user_id: superadminUser.id,
          company_id: company.id,
        });
        if (!existingMembership) {
          await CompanyMembership.query().insert({
            user_id: superadminUser.id,
            company_id: company.id,
            is_default: false,
          });
        }
      }
    }

    const users = {};
    for (const spec of userSpecs) {
      const password = spec.password ?? 'test-user-pass-123';
      const role = spec.role ?? 'user';
      const partner = await Partner.query().insertAndFetch({
        name: spec.partnerName ?? spec.login,
        company_id: company.id,
      });
      const user = await User.query().insertAndFetch({
        login: spec.login,
        password,
        partner_id: partner.id,
        role,
      });
      await CompanyMembership.query().insert({
        user_id: user.id,
        company_id: company.id,
        is_default: spec.isDefault ?? true,
      });
      if (role === 'user' && defaultUserGroup && companyOpts.assignDefaultUserGroup !== false) {
        const existingGroup = await GroupMembership.query().findOne({
          user_id: user.id,
          group_id: defaultUserGroup.id,
        });
        if (!existingGroup) {
          await GroupMembership.query().insert({
            user_id: user.id,
            group_id: defaultUserGroup.id,
          });
        }
      }
      const session = await loginAs(spec.login, password, company.id);
      users[spec.login] = {
        user,
        partner,
        password,
        token: session.token,
        refreshToken: session.refreshToken,
        headers: session.headers,
      };
    }

    return { company, users };
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await app.close();
    if (ownedStorageDir) {
      trackedTempDirs.delete(ownedStorageDir);
      await rm(ownedStorageDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    app,
    db,
    storageDir,
    attachmentStorage,
    superadminToken,
    authHeaders,
    loginAs,
    createCompanyAndUsers,
    close,
  };
}

function resolvePnpmCommand(root) {
  const cli = process.env.npm_execpath;
  if (typeof cli === 'string' && cli.length > 0 && existsSync(cli)) {
    if (cli.toLowerCase().endsWith('.exe')) {
      return { command: cli, prefixArgs: [] };
    }
    return { command: process.execPath, prefixArgs: [cli] };
  }

  if (process.platform === 'win32') {
    const locatedShim = spawnSync('where.exe', ['pnpm.cmd'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    const shimPaths =
      locatedShim.status === 0
        ? locatedShim.stdout
            .split(/\r?\n/u)
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];
    const pnpmCli = shimPaths
      .flatMap((shimPath) => {
        const adjacent = ['mjs', 'cjs'].map((ext) =>
          path.join(path.dirname(shimPath), 'node_modules', 'pnpm', 'bin', `pnpm.${ext}`)
        );
        let shimSource = '';
        try {
          shimSource = readFileSync(shimPath, 'utf8');
        } catch {
          // Ignore unreadable shims.
        }
        const referenced = [...shimSource.matchAll(/["']([^"'\r\n]*pnpm\.(?:mjs|cjs|js))["']/giu)]
          .map((match) => match[1])
          .filter((entry) => typeof entry === 'string')
          .map((entry) =>
            path.resolve(entry.replaceAll('%~dp0', `${path.dirname(shimPath)}${path.sep}`))
          );
        return [...adjacent, ...referenced];
      })
      .find((candidate) => existsSync(candidate));
    if (pnpmCli) {
      return { command: process.execPath, prefixArgs: [pnpmCli] };
    }
  }

  return { command: 'pnpm', prefixArgs: [] };
}

export function runPnpmScript(args, opts = {}) {
  const root = resolveRepoRoot();
  const { command, prefixArgs } = resolvePnpmCommand(root);
  return spawnSync(command, [...prefixArgs, ...args], {
    cwd: opts.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    windowsHide: true,
  });
}

export function resolveGitSha(cwd = resolveRepoRoot()) {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/iu.test(process.env.GITHUB_SHA.trim())) {
    return process.env.GITHUB_SHA.trim().toLowerCase();
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/iu.test(sha) ? sha.toLowerCase() : null;
}

async function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close(() => reject(new Error('Failed to allocate loopback port')));
        return;
      }
      const { port } = address;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function resolveNextCliJs(root) {
  const candidates = [
    path.join(root, 'apps', 'board', 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function startIsolatedBoard(apiBaseUrl, opts = {}) {
  const externalUrl = process.env.MW_E2E_BOARD_URL?.trim();
  if (externalUrl) {
    return {
      url: externalUrl.replace(/\/$/u, ''),
      external: true,
      close: async () => {},
    };
  }

  const root = resolveRepoRoot();
  const boardRoot = path.join(root, 'apps', 'board');
  const standaloneDir = path.join(boardRoot, '.next', 'standalone', 'apps', 'board');
  const standaloneServerJs = path.join(standaloneDir, 'server.js');
  const buildIdPath = path.join(boardRoot, '.next', 'BUILD_ID');
  const normalizedApiUrl = String(apiBaseUrl).trim().replace(/\/$/u, '');
  const port = opts.port ?? (await findFreeLoopbackPort());
  const boardUrl = `http://127.0.0.1:${port}`;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30_000;

  let command;
  let args;
  let spawnCwd;

  if (existsSync(standaloneServerJs)) {
    const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');
    if (!existsSync(standaloneStaticDir)) {
      const prepareScript = path.join(root, 'scripts', 'prepare-board-standalone.mjs');
      if (existsSync(prepareScript)) {
        const prep = spawnSync(process.execPath, [prepareScript], {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
        });
        if (prep.status !== 0) {
          throw new Error(
            `Failed to prepare standalone Board assets: ${prep.stderr || prep.stdout}`
          );
        }
      }
    }
    command = process.execPath;
    args = [standaloneServerJs];
    spawnCwd = standaloneDir;
  } else if (existsSync(buildIdPath)) {
    const nextCliJs = resolveNextCliJs(root);
    if (!nextCliJs) {
      throw new Error('Cannot locate Next.js CLI (next/dist/bin/next) to start built apps/board');
    }
    command = process.execPath;
    args = [nextCliJs, 'start', '--hostname', '127.0.0.1', '--port', String(port)];
    spawnCwd = boardRoot;
  } else {
    throw new Error('apps/board must be built or MW_E2E_BOARD_URL must be set');
  }

  const child = spawn(command, args, {
    cwd: spawnCwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      BOARD_API_TARGET: normalizedApiUrl,
      NEXT_PUBLIC_SITE_URL: boardUrl,
      NODE_ENV: 'production',
      ...opts.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdoutLog = '';
  let stderrLog = '';
  const appendLog = (current, chunk) => (current + chunk.toString('utf8')).slice(-16_384);
  child.stdout?.on('data', (chunk) => {
    stdoutLog = appendLog(stdoutLog, chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderrLog = appendLog(stderrLog, chunk);
  });

  let exitCode = null;
  let exitSignal = null;
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      resolve();
    });
  });

  async function stopChild() {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exitPromise;
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may already be gone.
    }
    await Promise.race([
      exitPromise,
      new Promise((resolve) => {
        const timer = globalThis.setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore kill error.
          }
          resolve();
        }, 5_000);
        timer.unref?.();
      }),
    ]);
  }

  const deadline = Date.now() + timeoutMs;
  let ready = false;
  let lastStatus = null;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await stopChild();
      throw new Error(
        `Isolated Board server exited prematurely (code=${exitCode}, signal=${exitSignal}).\nstdout: ${stdoutLog}\nstderr: ${stderrLog}`
      );
    }
    try {
      const res = await globalThis.fetch(`${boardUrl}/login`, {
        method: 'GET',
        redirect: 'manual',
      });
      lastStatus = res.status;
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => {
      const timer = globalThis.setTimeout(resolve, 250);
      timer.unref?.();
    });
  }

  if (!ready) {
    await stopChild();
    throw new Error(
      `Timed out waiting for isolated Board server at ${boardUrl}/login after ${timeoutMs}ms (lastStatus=${lastStatus}, lastError=${lastError}).\nstdout: ${stdoutLog}\nstderr: ${stderrLog}`
    );
  }

  return {
    url: boardUrl,
    port,
    external: false,
    close: stopChild,
  };
}
