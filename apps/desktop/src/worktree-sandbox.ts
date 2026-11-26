import { spawn, execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ReadOnlyRepoInspector,
  buildRepoSnapshot,
  compileExecutionPacket,
  createRedactor,
  detectCapabilityOverlap,
  validateDiffScope,
  type CompiledExecutionPacket,
  type OverlapReport,
  type RepoGitRevision,
  type RepoSnapshot,
} from '@moonwitness/ai-runtime';
import type { LocalFileAttachmentStorage } from '@moonwitness/orm-storage';
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  NotFoundError,
  ValidationError,
} from '@moonwitness/types';
import { DesktopRiskGate, isSecretOrSensitivePath, redactSensitiveText } from './risk-gate.js';
import type {
  AcquireWorktreeOptions,
  BoundedPtyCommandRequest,
  BoundedPtyCommandResult,
  DesktopActionAuthContext,
  DesktopExecutionPacketRequest,
  DesktopOverlapDetectionRequest,
  DesktopRepoSnapshotOptions,
  GitWorktreeLease,
  RiskAuditRecord,
  WorktreeCommitResult,
  WorktreeDiffFile,
  WorktreeDiffSummary,
  WorktreeFileContent,
  WorktreeFileWriteResult,
  WorktreeMergeResult,
  WorktreeReadFileOptions,
  WorktreeTreeEntry,
} from './types.js';

const execFileAsync = promisify(execFile);

const RUN_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;
const GIT_REF_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u;
const BARE_COMMAND_REGEX = /^[a-zA-Z0-9._-]+$/u;

const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'node',
  'bun',
  'npm',
  'git',
  'vitest',
  'tsc',
  'eslint',
  'prettier',
];

const SAFE_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'WINDIR',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
]);

const BLOCKED_ENV_OVERRIDE_PATTERN =
  /^(?:PATH|PATHEXT|COMSPEC|SHELL|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL).*)$/iu;

const MAX_READ_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 1_048_576;

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizePathPrefix(prefix: string): string {
  return prefix
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '');
}

function isWithinRealRoot(realRoot: string, realCandidate: string): boolean {
  const rel = path.relative(realRoot, realCandidate);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function validateGitRef(value: string, label: string): string {
  if (
    !GIT_REF_REGEX.test(value) ||
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.endsWith('.lock') ||
    value.endsWith('/') ||
    value.includes('//')
  ) {
    throw new ValidationError(`Invalid ${label}: '${value}'`);
  }
  return value;
}

export interface WorktreeSandboxOptions {
  readonly repoRoot: string;
  readonly worktreeBaseDir?: string;
  readonly allowedPathPrefixes?: readonly string[];
  readonly allowedCommands?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly knownSecrets?: readonly string[];
  readonly riskGate?: DesktopRiskGate;
  readonly attachmentStorage?: LocalFileAttachmentStorage;
  readonly onAuditRecord?: (record: RiskAuditRecord) => void;
}

export class WorktreeSandbox {
  readonly repoRoot: string;
  readonly worktreeRootDir: string;
  private readonly lockRootDir: string;
  private readonly defaultAllowedPaths: readonly string[];
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly knownSecrets: readonly string[];
  private readonly riskGate: DesktopRiskGate;
  private readonly attachmentStorage?: LocalFileAttachmentStorage;
  private readonly onAuditRecord?: (record: RiskAuditRecord) => void;
  private readonly worktreeBaseRelDir: string;
  private readonly leases = new Map<string, GitWorktreeLease>();
  private fencingCounter = 0;

  constructor(options: WorktreeSandboxOptions) {
    if (!options.repoRoot || !existsSync(options.repoRoot)) {
      throw new ValidationError(`Repository root does not exist: '${options.repoRoot}'`);
    }
    this.repoRoot = realpathSync(options.repoRoot);
    const baseDir = options.worktreeBaseDir ?? '.mw-worktrees';
    if (path.isAbsolute(baseDir) || baseDir.includes('..')) {
      throw new ValidationError(
        `worktreeBaseDir must be a relative path inside repoRoot: '${baseDir}'`
      );
    }
    this.worktreeBaseRelDir = normalizePathPrefix(baseDir);
    this.worktreeRootDir = path.resolve(this.repoRoot, baseDir);
    if (!isWithinRealRoot(this.repoRoot, this.worktreeRootDir)) {
      throw new ValidationError('worktreeBaseDir escapes repoRoot');
    }
    this.lockRootDir = path.join(this.worktreeRootDir, '.locks');
    this.defaultAllowedPaths = (options.allowedPathPrefixes ?? [])
      .map(normalizePathPrefix)
      .filter(Boolean);
    this.allowedCommands = new Set(options.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS);
    this.defaultTimeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(100, options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS)
    );
    this.maxOutputBytes = Math.min(
      MAX_OUTPUT_BYTES,
      Math.max(1024, options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES)
    );
    this.knownSecrets = options.knownSecrets ?? [];
    this.riskGate = options.riskGate ?? new DesktopRiskGate();
    this.attachmentStorage = options.attachmentStorage;
    this.onAuditRecord = options.onAuditRecord;
  }

  /** DSK-5.4: Ensure `.mw-worktrees/` is ignored via `.git/info/exclude`. */
  ensureWorktreeExcluded(): void {
    const gitDir = path.join(this.repoRoot, '.git');
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return;
    const infoDir = path.join(gitDir, 'info');
    mkdirSync(infoDir, { recursive: true });
    const excludePath = path.join(infoDir, 'exclude');
    const rule = `${this.worktreeBaseRelDir}/`;
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    const lines = existing.split(/\r?\n/u).map((l) => l.trim());
    if (!lines.includes(rule) && !lines.includes(this.worktreeBaseRelDir)) {
      const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      writeFileSync(excludePath, `${existing}${prefix}${rule}\n`, 'utf8');
    }
  }

  async acquire(options: AcquireWorktreeOptions): Promise<GitWorktreeLease> {
    if (!RUN_ID_REGEX.test(options.runId)) {
      throw new ValidationError(`Invalid runId '${options.runId}'`);
    }
    // runId is combined into file-system paths; reject any character that could
    // alter where those paths land even if the regex above is ever loosened.
    if (
      options.runId.includes('/') ||
      options.runId.includes('\\') ||
      options.runId.includes('..')
    ) {
      throw new ValidationError(`Invalid runId '${options.runId}'`);
    }
    const existing = this.leases.get(options.runId);
    if (existing && existing.status === 'active') {
      throw new ConcurrencyConflictError(
        `Worktree lease already active for run '${options.runId}'`
      );
    }

    const baseRef = validateGitRef(options.baseRef ?? 'HEAD', 'baseRef');
    this.fencingCounter += 1;
    const fencingToken = this.fencingCounter;
    const branchName = validateGitRef(
      options.branchName ?? `mw/run-${options.runId}-${fencingToken}`,
      'branchName'
    );
    const worktreePath = path.resolve(this.worktreeRootDir, `run-${options.runId}`);
    // Containment check against the resolved worktree root, guarding against
    // any path-separator or traversal component that slipped past validation.
    const resolvedWorktreeRoot = path.resolve(this.worktreeRootDir);
    if (
      worktreePath !== resolvedWorktreeRoot &&
      !worktreePath.startsWith(resolvedWorktreeRoot + path.sep)
    ) {
      throw new AccessDeniedError('Computed worktree path escapes worktree root');
    }
    if (!isWithinRealRoot(this.worktreeRootDir, worktreePath)) {
      throw new AccessDeniedError('Computed worktree path escapes worktree root');
    }

    mkdirSync(this.lockRootDir, { recursive: true });
    this.ensureWorktreeExcluded();
    const lockFile = path.join(this.lockRootDir, `run-${options.runId}.lock.json`);
    const leaseId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      writeFileSync(
        lockFile,
        JSON.stringify({ leaseId, runId: options.runId, fencingToken, createdAt }),
        { encoding: 'utf8', flag: 'wx' }
      );
    } catch (error) {
      throw new ConcurrencyConflictError(
        `Worktree lock already exists on disk for run '${options.runId}'`,
        { cause: error }
      );
    }

    if (existsSync(worktreePath)) {
      rmSync(lockFile, { force: true });
      throw new ConcurrencyConflictError(
        `Worktree directory already exists for run '${options.runId}': ${worktreePath}`
      );
    }

    try {
      await this.runGit(this.repoRoot, [
        'worktree',
        'add',
        '-b',
        branchName,
        worktreePath,
        baseRef,
      ]);
      const headCommit = (await this.runGit(worktreePath, ['rev-parse', 'HEAD'])).trim();
      const allowedPaths = (options.allowedPaths ?? this.defaultAllowedPaths)
        .map(normalizePathPrefix)
        .filter(Boolean);

      const lease: GitWorktreeLease = {
        leaseId,
        runId: options.runId,
        branchName,
        worktreePath: realpathSync(worktreePath),
        baseRef,
        headCommit,
        fencingToken,
        status: 'active',
        createdAt,
        allowedPaths,
      };
      this.leases.set(options.runId, lease);
      return lease;
    } catch (error) {
      rmSync(lockFile, { force: true });
      if (existsSync(worktreePath)) {
        await this.runGit(this.repoRoot, ['worktree', 'remove', '--force', worktreePath]).catch(
          () => undefined
        );
      }
      throw error;
    }
  }

  getLease(runId: string): GitWorktreeLease {
    const lease = this.leases.get(runId);
    if (!lease || lease.status !== 'active') {
      throw new NotFoundError(`No active worktree lease for run '${runId}'`);
    }
    return lease;
  }

  listLeases(): readonly GitWorktreeLease[] {
    return [...this.leases.values()];
  }

  async readFile(
    runId: string,
    relativePath: string,
    options?: WorktreeReadFileOptions
  ): Promise<WorktreeFileContent> {
    const lease = this.getLease(runId);
    const resolved = this.resolveWorktreePath(lease, relativePath, {
      requireExists: true,
      allowDirectory: false,
    });
    const st = statSync(resolved.absolutePath);
    if (!st.isFile()) {
      throw new ValidationError(`Target path is not a regular file: '${relativePath}'`);
    }
    if (st.size > MAX_READ_BYTES) {
      throw new ValidationError(
        `File '${relativePath}' exceeds max read limit (${MAX_READ_BYTES} bytes)`
      );
    }

    const rawBytes = readFileSync(resolved.absolutePath);
    if (rawBytes.includes(0)) {
      throw new ValidationError(`Binary file rejected by UTF-8 reader: '${relativePath}'`);
    }

    const rawText = rawBytes.toString('utf8');
    const allLines = rawText.split(/\r?\n/u);
    let sliced = rawText;
    let startLine: number | undefined;
    let endLine: number | undefined;

    if (options?.startLine !== undefined || options?.endLine !== undefined) {
      startLine = Math.max(1, Math.floor(options.startLine ?? 1));
      endLine = Math.min(allLines.length, Math.floor(options.endLine ?? allLines.length));
      if (startLine > endLine && allLines.length > 0) {
        throw new ValidationError(
          `Invalid line range [${startLine}, ${endLine}] for '${relativePath}'`
        );
      }
      sliced = allLines.slice(startLine - 1, endLine).join('\n');
    }

    const redactedResult = redactSensitiveText(sliced, this.knownSecrets);
    const content = redactedResult.text;

    return {
      runId,
      relativePath: resolved.relativePath,
      content,
      sha256: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      totalLines: allLines.length,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
      redacted: redactedResult.redacted,
    };
  }

  /** DSK-7.6: Allowlisted directory tree lister respecting `.gitignore`, `.git`, and `.mw-worktrees`. */
  async listTree(
    runId: string,
    options?: { readonly relativeDir?: string; readonly maxEntries?: number }
  ): Promise<readonly WorktreeTreeEntry[]> {
    const lease = this.getLease(runId);
    const maxEntries = Math.max(1, Math.min(5000, options?.maxEntries ?? 500));
    const startDir = options?.relativeDir
      ? this.resolveWorktreePath(lease, options.relativeDir, {
          requireExists: true,
          allowDirectory: true,
          skipAllowlist: true,
        }).absolutePath
      : lease.worktreePath;

    const realRoot = realpathSync(lease.worktreePath);
    const gitignorePatterns = this.loadGitignorePatterns(lease.worktreePath);
    const entries: WorktreeTreeEntry[] = [];

    const walk = (dirPath: string): void => {
      if (entries.length >= maxEntries) return;
      const dirents = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      for (const dirent of dirents) {
        if (entries.length >= maxEntries) return;
        if (dirent.name === '.git' || dirent.name === this.worktreeBaseRelDir) continue;
        const fullPath = path.join(dirPath, dirent.name);
        if (dirent.isSymbolicLink()) continue;

        const relPath = path.relative(realRoot, fullPath).replaceAll('\\', '/');
        if (isSecretOrSensitivePath(relPath)) continue;
        if (matchesSimpleGitignore(relPath, dirent.name, gitignorePatterns)) continue;

        try {
          const realCandidate = realpathSync(fullPath);
          if (!isWithinRealRoot(realRoot, realCandidate)) continue;
        } catch {
          continue;
        }

        const allowlist =
          lease.allowedPaths.length > 0 ? lease.allowedPaths : this.defaultAllowedPaths;
        if (dirent.isDirectory()) {
          const dirRelevant =
            allowlist.length === 0 ||
            allowlist.some(
              (prefix) =>
                relPath === prefix ||
                relPath.startsWith(`${prefix}/`) ||
                prefix.startsWith(`${relPath}/`)
            );
          if (!dirRelevant) continue;
          entries.push({ path: relPath, kind: 'dir' });
          walk(fullPath);
        } else if (dirent.isFile()) {
          if (
            allowlist.length > 0 &&
            !allowlist.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`))
          ) {
            continue;
          }
          const st = statSync(fullPath);
          entries.push({ path: relPath, kind: 'file', sizeBytes: st.size });
        }
      }
    };

    walk(startDir);
    return entries;
  }

  private loadGitignorePatterns(worktreePath: string): readonly string[] {
    const gitignorePath = path.join(worktreePath, '.gitignore');
    if (!existsSync(gitignorePath)) return [];
    return readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
  }

  async writeFile(
    runId: string,
    relativePath: string,
    content: string,
    auth: DesktopActionAuthContext
  ): Promise<WorktreeFileWriteResult> {
    const lease = this.getLease(runId);
    this.riskGate.assertAllowed({
      runId,
      action: 'worktree.write',
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
      targetPath: relativePath,
    });

    const resolved = this.resolveWorktreePath(lease, relativePath, {
      requireExists: false,
      allowDirectory: false,
    });
    const parentDir = path.dirname(resolved.absolutePath);
    mkdirSync(parentDir, { recursive: true });

    // Re-verify parent directory realpath after creation to close symlink races.
    const realRoot = realpathSync(lease.worktreePath);
    const realParent = realpathSync(parentDir);
    if (!isWithinRealRoot(realRoot, realParent)) {
      throw new AccessDeniedError(`Target parent escapes worktree sandbox: '${relativePath}'`);
    }
    if (existsSync(resolved.absolutePath) && lstatSync(resolved.absolutePath).isSymbolicLink()) {
      throw new AccessDeniedError(`Symlink overwrite rejected: '${relativePath}'`);
    }

    writeFileSync(resolved.absolutePath, content, 'utf8');
    return {
      runId,
      relativePath: resolved.relativePath,
      sha256: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  async inspectDiff(
    runId: string,
    options?: { readonly attachmentStorage?: LocalFileAttachmentStorage }
  ): Promise<WorktreeDiffSummary> {
    const lease = this.getLease(runId);
    const statusRaw = await this.runGit(lease.worktreePath, ['status', '--porcelain=v1', '-z']);
    const statusEntries = parsePorcelainZ(statusRaw);
    const numstatRaw = await this.runGit(lease.worktreePath, ['diff', '--numstat', '-z']);
    const numstats = parseNumstatZ(numstatRaw);

    const files: WorktreeDiffFile[] = statusEntries
      .filter((entry) => !isSecretOrSensitivePath(entry.path))
      .map((entry) => {
        const stats = numstats.get(entry.path) ?? { additions: 0, deletions: 0 };
        return {
          path: entry.path,
          status: entry.status,
          additions: stats.additions,
          deletions: stats.deletions,
        };
      });

    const rawPatch = await this.runGit(lease.worktreePath, ['diff', '--no-color']);
    const patch = redactSensitiveText(rawPatch, this.knownSecrets).text;
    const patchSha256 = sha256Hex(patch);

    const effectiveAllowed =
      lease.allowedPaths.length > 0
        ? lease.allowedPaths
        : this.defaultAllowedPaths.length > 0
          ? this.defaultAllowedPaths
          : ['.'];
    const diffScope = validateDiffScope(
      files.map((file) => file.path),
      effectiveAllowed
    );

    let patchStorageKey: string | undefined;
    const storage = options?.attachmentStorage ?? this.attachmentStorage;
    if (storage && patch.length > 0) {
      const storageKey = randomUUID();
      const stored = await storage.put(storageKey, Buffer.from(patch, 'utf8'));
      patchStorageKey = stored.key;
    }

    return {
      runId,
      leaseId: lease.leaseId,
      branchName: lease.branchName,
      headCommit: lease.headCommit,
      clean: statusEntries.length === 0,
      files,
      outOfScopeFiles: diffScope.outOfScopeFiles,
      scopeClean: diffScope.scopeClean,
      patch,
      patchSha256,
      ...(patchStorageKey ? { patchStorageKey } : {}),
    };
  }

  /**
   * M13.02: R0 read-only revision-pinned repository snapshot inside the leased worktree.
   * Gates strictly through `DesktopRiskGate` (`repo.read` + `git.status`), collects Git
   * metadata with `shell: false`, and delegates manifest/script/doc scanning to
   * `@moonwitness/ai-runtime`'s `buildRepoSnapshot` over `ReadOnlyRepoInspector`.
   */
  async inspectRepoSnapshot(
    runId: string,
    auth: DesktopActionAuthContext,
    options?: DesktopRepoSnapshotOptions
  ): Promise<RepoSnapshot> {
    const lease = this.getLease(runId);
    const realWorktreeRoot = realpathSync(this.worktreeRootDir);
    const realLeasePath = realpathSync(lease.worktreePath);
    if (!isWithinRealRoot(realWorktreeRoot, realLeasePath)) {
      throw new AccessDeniedError('Leased worktree path escapes worktree root');
    }

    const readDecision = this.riskGate.assertAllowed({
      runId,
      action: 'repo.read',
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
      ...(options?.targetPath !== undefined ? { targetPath: options.targetPath } : {}),
    });
    this.onAuditRecord?.(readDecision.auditEntry);

    const gitDecision = this.riskGate.assertAllowed({
      runId,
      action: 'git.status',
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
    });
    this.onAuditRecord?.(gitDecision.auditEntry);

    const allowlistedPaths = this.resolveSnapshotAllowlist(lease, auth, options?.targetPath);

    const gitExecOptions = {
      cwd: realLeasePath,
      encoding: 'utf8' as const,
      shell: false,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    };
    const [headResult, branchResult, statusResult] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], gitExecOptions),
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], gitExecOptions),
      execFileAsync('git', ['status', '--porcelain'], gitExecOptions),
    ]);

    const headCommit = headResult.stdout.trim() || null;
    const branch = branchResult.stdout.trim() || null;
    const dirty = statusResult.stdout.trim().length > 0;
    const gitRevision: RepoGitRevision = {
      headCommit,
      branch,
      dirty,
      capturedAt: new Date().toISOString(),
    };

    const redactor = createRedactor(this.knownSecrets);
    const inspector = new ReadOnlyRepoInspector({
      rootDir: realLeasePath,
      allowlistedPaths,
      ...(options?.maxFiles !== undefined
        ? { maxFilesPerList: Math.max(1, Math.floor(options.maxFiles)) + 1 }
        : {}),
      redactor,
    });

    return buildRepoSnapshot(inspector, {
      gitRevision,
      rootLabel: options?.rootLabel ?? `worktree:${runId}`,
      ...(options?.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
      ...(options?.maxManifestBytes !== undefined
        ? { maxManifestBytes: options.maxManifestBytes }
        : {}),
      ...(options?.maxDocHeadings !== undefined ? { maxDocHeadings: options.maxDocHeadings } : {}),
      redactor,
    });
  }

  /**
   * M13.04: R0 deterministic Execution Packet compiler bound to an active worktree lease.
   * Enforces company match, out-of-lease scope blocking, and `inspectRepoSnapshot` R0 gates.
   */
  async compileExecutionPacket(
    runId: string,
    auth: DesktopActionAuthContext,
    request: DesktopExecutionPacketRequest
  ): Promise<CompiledExecutionPacket> {
    if (request.contract.companyId !== auth.companyId) {
      throw new AccessDeniedError(
        `Cross-company contract ${request.contract.companyId} rejected for auth company ${auth.companyId}`
      );
    }

    const lease = this.getLease(runId);
    const effectiveLeasePaths =
      lease.allowedPaths.length > 0 ? lease.allowedPaths : this.defaultAllowedPaths;

    for (const scopePath of request.contract.scopePaths) {
      const normalizedScope = normalizePathPrefix(scopePath);
      if (
        !normalizedScope ||
        normalizedScope.split('/').includes('..') ||
        isSecretOrSensitivePath(normalizedScope)
      ) {
        throw new AccessDeniedError(
          `Sensitive or unsafe scope path rejected in execution packet: '${scopePath}'`
        );
      }
      const withinLease = effectiveLeasePaths.some((allowed) => {
        const prefix = normalizePathPrefix(allowed);
        if (!prefix || prefix === '.') return true;
        return normalizedScope === prefix || normalizedScope.startsWith(`${prefix}/`);
      });
      if (!withinLease) {
        throw new AccessDeniedError(
          `Execution packet scope path '${scopePath}' is outside worktree lease allowedPaths`
        );
      }
    }

    const snapshot = await this.inspectRepoSnapshot(runId, auth, request.snapshotOptions);
    const redactor = createRedactor(this.knownSecrets);
    return compileExecutionPacket({
      contract: request.contract,
      repoSnapshot: snapshot,
      allowedCapabilities: request.allowedCapabilities,
      verificationCommands: request.verificationCommands,
      ...(request.approvedSkills !== undefined ? { approvedSkills: request.approvedSkills } : {}),
      ...(request.policyLimits !== undefined ? { policyLimits: request.policyLimits } : {}),
      ...(request.targetBranch !== undefined ? { targetBranch: request.targetBranch } : {}),
      redactor,
    });
  }

  /**
   * M13.06: R0 read-only capability overlap detector bound to an active worktree lease.
   * Reuses `inspectRepoSnapshot` R0 gates (`repo.read` + `git.status`, tenant & allowlist checks)
   * and returns an advisory-only `OverlapReport` (`automatedMutationsAllowed: false`).
   */
  async detectCapabilityOverlap(
    runId: string,
    auth: DesktopActionAuthContext,
    request: DesktopOverlapDetectionRequest
  ): Promise<OverlapReport> {
    const snapshot = await this.inspectRepoSnapshot(runId, auth, request.snapshotOptions);
    const lease = this.getLease(runId);
    const realLeasePath = realpathSync(lease.worktreePath);
    const allowlistedPaths = this.resolveSnapshotAllowlist(
      lease,
      auth,
      request.snapshotOptions?.targetPath
    );
    const redactor = createRedactor(this.knownSecrets);
    const inspector = new ReadOnlyRepoInspector({
      rootDir: realLeasePath,
      allowlistedPaths,
      ...(request.snapshotOptions?.maxFiles !== undefined
        ? { maxFilesPerList: Math.max(1, Math.floor(request.snapshotOptions.maxFiles)) + 1 }
        : {}),
      redactor,
    });

    return detectCapabilityOverlap({
      companyId: auth.companyId,
      repoSnapshot: snapshot,
      requirements: request.requirements,
      ...(request.existingTasks !== undefined ? { existingTasks: request.existingTasks } : {}),
      inspector,
      redactor,
    });
  }

  private resolveSnapshotAllowlist(
    lease: GitWorktreeLease,
    auth: DesktopActionAuthContext,
    rawTargetPath?: string
  ): readonly string[] {
    const sanitizePrefixes = (rawList: readonly string[]): readonly string[] => {
      const cleaned: string[] = [];
      for (const raw of rawList) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (
          trimmed.includes('\0') ||
          path.isAbsolute(trimmed) ||
          /^[A-Za-z]:/u.test(trimmed) ||
          trimmed.startsWith('\\\\') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('/') ||
          trimmed.startsWith('\\')
        ) {
          throw new AccessDeniedError(`Absolute or external snapshot path rejected: '${raw}'`);
        }
        const normalized = normalizePathPrefix(trimmed);
        if (normalized.split('/').includes('..')) {
          throw new AccessDeniedError(`Path traversal ('..') rejected in snapshot path: '${raw}'`);
        }
        if (normalized && isSecretOrSensitivePath(normalized)) {
          throw new AccessDeniedError(`Sensitive or secret snapshot path rejected: '${raw}'`);
        }
        cleaned.push(normalized || '.');
      }
      return cleaned;
    };

    const leaseAllowlist = sanitizePrefixes(
      lease.allowedPaths.length > 0 ? lease.allowedPaths : this.defaultAllowedPaths
    );
    const grantAllowlist = sanitizePrefixes(auth.grant.allowedPaths ?? []);

    if (rawTargetPath !== undefined) {
      const resolved = this.resolveWorktreePath(lease, rawTargetPath, {
        requireExists: true,
        allowDirectory: true,
      });
      if (
        grantAllowlist.length > 0 &&
        !grantAllowlist.some(
          (prefix) =>
            prefix === '.' ||
            resolved.relativePath === prefix ||
            resolved.relativePath.startsWith(`${prefix}/`)
        )
      ) {
        throw new AccessDeniedError(
          `Snapshot targetPath '${resolved.relativePath}' is outside capability grant allowedPaths`
        );
      }
      return [resolved.relativePath];
    }

    if (leaseAllowlist.length > 0 && grantAllowlist.length > 0) {
      const intersected = new Set<string>();
      for (const leasePrefix of leaseAllowlist) {
        for (const grantPrefix of grantAllowlist) {
          if (leasePrefix === '.') {
            intersected.add(grantPrefix);
          } else if (grantPrefix === '.') {
            intersected.add(leasePrefix);
          } else if (leasePrefix === grantPrefix || leasePrefix.startsWith(`${grantPrefix}/`)) {
            intersected.add(leasePrefix);
          } else if (grantPrefix.startsWith(`${leasePrefix}/`)) {
            intersected.add(grantPrefix);
          }
        }
      }
      if (intersected.size === 0) {
        throw new AccessDeniedError(
          'No overlapping allowed paths between worktree lease and capability grant'
        );
      }
      return [...intersected];
    }

    if (grantAllowlist.length > 0) return grantAllowlist;
    if (leaseAllowlist.length > 0) return leaseAllowlist;
    return ['.'];
  }

  /**
   * DSK-5.6: Attempt a clean git merge into the worktree; on conflict, abort cleanly
   * so the worktree remains intact and uncorrupted.
   */
  async mergeBranch(
    runId: string,
    sourceRef: string,
    auth: DesktopActionAuthContext
  ): Promise<WorktreeMergeResult> {
    const lease = this.getLease(runId);
    const validRef = validateGitRef(sourceRef, 'sourceRef');
    const decision = this.riskGate.assertAllowed({
      runId,
      action: 'git.commit_local',
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
    });
    this.onAuditRecord?.(decision.auditEntry);

    try {
      await this.runGit(lease.worktreePath, [
        '-c',
        'user.name=MoonWitness Harness',
        '-c',
        'user.email=harness@moonwitness.local',
        'merge',
        '--no-edit',
        validRef,
      ]);
      const headCommit = (await this.runGit(lease.worktreePath, ['rev-parse', 'HEAD'])).trim();
      this.leases.set(runId, { ...lease, headCommit });
      return {
        runId,
        sourceRef: validRef,
        merged: true,
        conflicted: false,
        abortedCleanly: false,
        message: `Merged '${validRef}' cleanly`,
      };
    } catch (error) {
      let abortedCleanly: boolean;
      try {
        await this.runGit(lease.worktreePath, ['merge', '--abort']);
        abortedCleanly = true;
      } catch {
        abortedCleanly = false;
      }
      return {
        runId,
        sourceRef: validRef,
        merged: false,
        conflicted: true,
        abortedCleanly,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async commit(
    runId: string,
    message: string,
    auth: DesktopActionAuthContext
  ): Promise<WorktreeCommitResult> {
    const lease = this.getLease(runId);
    const trimmedMessage = message.trim();
    if (!trimmedMessage || trimmedMessage.length > 500) {
      throw new ValidationError('Commit message must be a non-empty string up to 500 characters');
    }

    this.riskGate.assertAllowed({
      runId,
      action: 'git.commit_local',
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
    });

    const statusRaw = await this.runGit(lease.worktreePath, ['status', '--porcelain=v1', '-z']);
    const entries = parsePorcelainZ(statusRaw);
    if (entries.length === 0) {
      throw new ValidationError(`Worktree for run '${runId}' has no changes to commit`);
    }

    const stagedFiles: string[] = [];
    for (const entry of entries) {
      if (isSecretOrSensitivePath(entry.path)) {
        throw new AccessDeniedError(
          `Refusing to stage sensitive or secret path '${entry.path}' in worktree commit`
        );
      }
      this.assertWithinAllowlist(lease, entry.path);
      if (!entry.status.includes('D')) {
        this.resolveWorktreePath(lease, entry.path, {
          requireExists: false,
          allowDirectory: false,
        });
      }
      stagedFiles.push(entry.path);
    }

    await this.runGit(lease.worktreePath, ['add', '--', ...stagedFiles]);
    await this.runGit(lease.worktreePath, [
      '-c',
      'user.name=MoonWitness Harness',
      '-c',
      'user.email=harness@moonwitness.local',
      'commit',
      '-m',
      trimmedMessage,
    ]);
    const commitSha = (await this.runGit(lease.worktreePath, ['rev-parse', 'HEAD'])).trim();
    const updatedLease: GitWorktreeLease = { ...lease, headCommit: commitSha };
    this.leases.set(runId, updatedLease);

    return {
      runId,
      leaseId: lease.leaseId,
      branchName: lease.branchName,
      commitSha,
      message: trimmedMessage,
      stagedFiles,
    };
  }

  async executeBoundedCommand(
    request: BoundedPtyCommandRequest,
    auth: DesktopActionAuthContext
  ): Promise<BoundedPtyCommandResult> {
    const lease = this.getLease(request.runId);
    if (!BARE_COMMAND_REGEX.test(request.command)) {
      throw new AccessDeniedError(
        `Command '${request.command}' must be a bare executable name without path separators or shell syntax`
      );
    }
    if (!this.allowedCommands.has(request.command)) {
      throw new AccessDeniedError(
        `Command '${request.command}' is not in the desktop sandbox command allowlist`
      );
    }
    for (const arg of request.args) {
      if (typeof arg !== 'string' || arg.includes('\0')) {
        throw new ValidationError('Command arguments must be valid strings without NUL bytes');
      }
    }

    const action = request.action ?? 'pty.exec_local';
    const fullCommandPreview = [request.command, ...request.args].join(' ');
    const decision = this.riskGate.assertAllowed({
      runId: request.runId,
      action,
      companyId: auth.companyId,
      agentId: auth.agentId,
      workContractId: auth.workContractId,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      humanApproval: auth.humanApproval,
      targetCommand: fullCommandPreview,
    });
    this.onAuditRecord?.(decision.auditEntry);

    if (request.signal?.aborted) {
      throw new ValidationError(`Command '${request.command}' aborted before start`);
    }

    const cwd = request.cwdRelative
      ? this.resolveWorktreePath(lease, request.cwdRelative, {
          requireExists: true,
          allowDirectory: true,
          skipAllowlist: true,
        }).absolutePath
      : lease.worktreePath;

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(100, request.timeoutMs ?? this.defaultTimeoutMs)
    );
    const maxOutputBytes = Math.min(
      MAX_OUTPUT_BYTES,
      Math.max(256, request.maxOutputBytes ?? this.maxOutputBytes)
    );

    const childEnv = this.buildSanitizedEnv(request.envOverrides);
    const executable = request.command === 'node' ? process.execPath : request.command;
    const startTime = Date.now();

    const execution = await new Promise<{
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly timedOut: boolean;
      readonly truncated: boolean;
      readonly stdout: string;
      readonly stderr: string;
    }>((resolve, reject) => {
      const child = spawn(executable, [...request.args], {
        cwd,
        env: childEnv,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const killTree = (): void => {
        terminateProcessTree(child.pid);
        try {
          child.kill('SIGKILL');
        } catch {
          // already exited
        }
      };

      const onAbort = (): void => {
        timedOut = true;
        killTree();
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const appendChunk = (target: Buffer[], chunk: Buffer): void => {
        if (truncated) return;
        const remaining = maxOutputBytes - totalBytes;
        if (remaining <= 0) {
          truncated = true;
          killTree();
          return;
        }
        if (chunk.length > remaining) {
          target.push(chunk.subarray(0, remaining));
          totalBytes += remaining;
          truncated = true;
          killTree();
          return;
        }
        target.push(chunk);
        totalBytes += chunk.length;
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => appendChunk(stdoutChunks, chunk));
      child.stderr.on('data', (chunk: Buffer) => appendChunk(stderrChunks, chunk));

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });

      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        resolve({
          exitCode,
          signal: signal ? String(signal) : null,
          timedOut,
          truncated,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });
    });

    const stdout = redactSensitiveText(execution.stdout, this.knownSecrets).text;
    const stderr = redactSensitiveText(execution.stderr, this.knownSecrets).text;

    return {
      runId: request.runId,
      leaseId: lease.leaseId,
      command: request.command,
      args: [...request.args],
      cwd,
      exitCode: execution.exitCode,
      signal: execution.signal,
      timedOut: execution.timedOut,
      truncated: execution.truncated,
      stdout,
      stderr,
      stdoutSha256: sha256Hex(stdout),
      stderrSha256: sha256Hex(stderr),
      durationMs: Math.max(0, Date.now() - startTime),
    };
  }

  async release(
    runId: string,
    options?: { readonly removeBranch?: boolean; readonly maxRetries?: number }
  ): Promise<GitWorktreeLease> {
    const lease = this.getLease(runId);
    const lockFile = path.join(this.lockRootDir, `run-${runId}.lock.json`);
    const maxRetries = Math.max(1, options?.maxRetries ?? 4);

    if (existsSync(lease.worktreePath)) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          await this.runGit(this.repoRoot, ['worktree', 'remove', '--force', lease.worktreePath]);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          const msg = error instanceof Error ? error.message : String(error);
          const isWindowsLock = /EBUSY|EPERM|Permission denied|Device or resource busy/iu.test(msg);
          if (!isWindowsLock || attempt === maxRetries) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, attempt * 75));
        }
      }
      if (lastError && existsSync(lease.worktreePath)) {
        rmSync(lease.worktreePath, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
        await this.runGit(this.repoRoot, ['worktree', 'prune']).catch(() => undefined);
      }
    }
    if (options?.removeBranch) {
      await this.runGit(this.repoRoot, ['branch', '-D', lease.branchName]).catch(() => undefined);
    }
    rmSync(lockFile, { force: true });

    const released: GitWorktreeLease = {
      ...lease,
      status: 'released',
      releasedAt: new Date().toISOString(),
    };
    this.leases.set(runId, released);
    return released;
  }

  private assertWithinAllowlist(lease: GitWorktreeLease, normalizedRelativePath: string): void {
    const allowlist = lease.allowedPaths.length > 0 ? lease.allowedPaths : this.defaultAllowedPaths;
    if (allowlist.length === 0) return;
    const matched = allowlist.some(
      (prefix) =>
        normalizedRelativePath === prefix || normalizedRelativePath.startsWith(`${prefix}/`)
    );
    if (!matched) {
      throw new AccessDeniedError(
        `Path '${normalizedRelativePath}' is outside the allowed worktree path allowlist`
      );
    }
  }

  private resolveWorktreePath(
    lease: GitWorktreeLease,
    rawRelativePath: string,
    options: {
      readonly requireExists: boolean;
      readonly allowDirectory: boolean;
      readonly skipAllowlist?: boolean;
    }
  ): { readonly relativePath: string; readonly absolutePath: string } {
    if (typeof rawRelativePath !== 'string' || rawRelativePath.trim() === '') {
      throw new ValidationError('Worktree path must be a non-empty relative path');
    }
    if (rawRelativePath.includes('\0')) {
      throw new AccessDeniedError('Path contains NUL byte');
    }
    if (
      path.isAbsolute(rawRelativePath) ||
      /^[A-Za-z]:/u.test(rawRelativePath) ||
      rawRelativePath.startsWith('\\\\') ||
      rawRelativePath.startsWith('//') ||
      rawRelativePath.startsWith('/') ||
      rawRelativePath.startsWith('\\')
    ) {
      throw new AccessDeniedError(`Absolute or external path rejected: '${rawRelativePath}'`);
    }

    const slashNormalized = rawRelativePath.replaceAll('\\', '/');
    const rawSegments = slashNormalized.split('/');
    for (const seg of rawSegments) {
      if (seg === '..') {
        throw new AccessDeniedError(`Path traversal ('..') rejected: '${rawRelativePath}'`);
      }
    }

    const cleanSegments = rawSegments.filter((seg) => seg !== '' && seg !== '.');
    if (cleanSegments.length === 0) {
      if (!options.allowDirectory) {
        throw new ValidationError(`File path cannot be empty or root: '${rawRelativePath}'`);
      }
      return { relativePath: '.', absolutePath: lease.worktreePath };
    }

    const normalizedRelative = cleanSegments.join('/');
    if (isSecretOrSensitivePath(normalizedRelative)) {
      throw new AccessDeniedError(`Sensitive or secret path rejected: '${normalizedRelative}'`);
    }
    if (!options.skipAllowlist) {
      this.assertWithinAllowlist(lease, normalizedRelative);
    }

    const realRoot = realpathSync(lease.worktreePath);
    let cursor = lease.worktreePath;
    for (const seg of cleanSegments) {
      cursor = path.join(cursor, seg);
      if (existsSync(cursor)) {
        const lstat = lstatSync(cursor);
        if (lstat.isSymbolicLink()) {
          throw new AccessDeniedError(
            `Symbolic link rejected in sandbox path: '${normalizedRelative}'`
          );
        }
        const realSegment = realpathSync(cursor);
        if (!isWithinRealRoot(realRoot, realSegment)) {
          throw new AccessDeniedError(
            `Resolved path escapes worktree sandbox: '${normalizedRelative}'`
          );
        }
      }
    }

    const absolutePath = path.resolve(lease.worktreePath, ...cleanSegments);
    if (!isWithinRealRoot(realRoot, path.dirname(absolutePath)) && absolutePath !== realRoot) {
      throw new AccessDeniedError(`Path escapes worktree sandbox: '${normalizedRelative}'`);
    }

    if (options.requireExists && !existsSync(absolutePath)) {
      throw new NotFoundError(`Worktree path not found: '${normalizedRelative}'`);
    }

    return { relativePath: normalizedRelative, absolutePath };
  }

  private buildSanitizedEnv(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (BLOCKED_ENV_OVERRIDE_PATTERN.test(key)) {
          throw new AccessDeniedError(`Environment variable override '${key}' is prohibited`);
        }
        env[key] = value;
      }
    }
    return env;
  }

  private async runGit(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }
}

function parsePorcelainZ(raw: string): Array<{ readonly status: string; readonly path: string }> {
  if (!raw) return [];
  const tokens = raw.split('\0');
  const entries: Array<{ readonly status: string; readonly path: string }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.length < 4) continue;
    const status = token.slice(0, 2);
    const filePath = token.slice(3).replaceAll('\\', '/');
    entries.push({ status, path: filePath });
    if (status.startsWith('R') || status.startsWith('C')) {
      i += 1;
    }
  }
  return entries;
}

function parseNumstatZ(
  raw: string
): Map<string, { readonly additions: number; readonly deletions: number }> {
  const map = new Map<string, { readonly additions: number; readonly deletions: number }>();
  if (!raw) return map;
  const tokens = raw.split('\0');
  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split('\t');
    if (parts.length < 3) continue;
    const additions = parts[0] === '-' ? 0 : Number.parseInt(parts[0] ?? '0', 10) || 0;
    const deletions = parts[1] === '-' ? 0 : Number.parseInt(parts[1] ?? '0', 10) || 0;
    const filePath = parts.slice(2).join('\t').replaceAll('\\', '/');
    map.set(filePath, { additions, deletions });
  }
  return map;
}

export function terminateProcessTree(pid: number | undefined): void {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }
}

function matchesSimpleGitignore(
  relativePath: string,
  baseName: string,
  patterns: readonly string[]
): boolean {
  for (const raw of patterns) {
    const cleaned = raw.replace(/^\/+/u, '').replace(/\/+$/u, '');
    if (!cleaned) continue;
    if (cleaned.startsWith('*.')) {
      const ext = cleaned.slice(1);
      if (baseName.endsWith(ext)) return true;
    } else if (
      baseName === cleaned ||
      relativePath === cleaned ||
      relativePath.startsWith(`${cleaned}/`)
    ) {
      return true;
    }
  }
  return false;
}
