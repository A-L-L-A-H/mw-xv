import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, JsonValue } from '@moonwitness/types';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { AiToolDefinition } from './types.js';
import { ProviderError } from './types.js';

export const DEFAULT_DENIED_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)\.env(?:\..+)?$/iu,
  /(?:^|\/)\.git(?:\/|$)/iu,
  /(?:^|\/)node_modules(?:\/|$)/iu,
  /\.(?:pem|key|p12|pfx|crt|jks|keystore)$/iu,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/iu,
  /(?:^|\/)(?:secrets?|credentials?)(?:\.[^/]+)?$/iu,
];

export interface ReadOnlyRepoInspectorConfig {
  readonly rootDir: string;
  readonly allowlistedPaths: readonly string[];
  readonly deniedPathPatterns?: readonly RegExp[];
  readonly maxFileBytes?: number;
  readonly maxFilesPerList?: number;
  readonly maxSearchMatches?: number;
  readonly redactor?: RedactionContext;
}

export interface RepoFileReadResult {
  readonly path: string;
  readonly content: string;
  readonly untrustedWrappedContent: string;
  readonly byteLength: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly sha256: string;
}

export interface RepoFileEntry {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface RepoSearchMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly preview: string;
  readonly sha256: string;
}

const TRAVERSAL_OR_CONTROL_PATTERN = /[\0]|%2e%2e|%2f|%5c/iu;

function toPosixRelative(rootDir: string, targetDir: string): string {
  return path.relative(rootDir, targetDir).split(path.sep).join('/');
}

function isStrictSubPath(parentRealPath: string, childRealPath: string): boolean {
  const rel = path.relative(parentRealPath, childRealPath);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

function assertCleanRelativeInput(rawInput: string, allowDot = false): string {
  if (typeof rawInput !== 'string') {
    throw new ProviderError('Repository path must be a string', {
      code: 'policy_blocked',
      reasonCode: 'PATH_TRAVERSAL_BLOCKED',
      providerId: 'repo-inspector',
      correlationId: 'repo-path-validation',
      retryable: false,
    });
  }
  const trimmed = rawInput.trim();
  if (!trimmed) {
    if (allowDot) return '.';
    throw new ProviderError('Repository path cannot be empty', {
      code: 'policy_blocked',
      reasonCode: 'PATH_TRAVERSAL_BLOCKED',
      providerId: 'repo-inspector',
      correlationId: 'repo-path-validation',
      retryable: false,
    });
  }
  if (
    TRAVERSAL_OR_CONTROL_PATTERN.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    throw new ProviderError(`Disallowed absolute or encoded path "${trimmed}"`, {
      code: 'policy_blocked',
      reasonCode: 'PATH_TRAVERSAL_BLOCKED',
      providerId: 'repo-inspector',
      correlationId: 'repo-path-validation',
      retryable: false,
    });
  }

  const normalized = trimmed.replace(/\\/gu, '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new ProviderError(`Path traversal ("..") is forbidden: "${trimmed}"`, {
      code: 'policy_blocked',
      reasonCode: 'PATH_TRAVERSAL_BLOCKED',
      providerId: 'repo-inspector',
      correlationId: 'repo-path-validation',
      retryable: false,
    });
  }

  return normalized;
}

export function wrapUntrustedRepoContent(relativePath: string, content: string): string {
  return [`<untrusted_data source="repo:${relativePath}">`, content, '</untrusted_data>'].join(
    '\n'
  );
}

export class ReadOnlyRepoInspector {
  private readonly rootDir: string;
  private readonly allowlistedPaths: readonly string[];
  private readonly deniedPathPatterns: readonly RegExp[];
  private readonly maxFileBytes: number;
  private readonly maxFilesPerList: number;
  private readonly maxSearchMatches: number;
  private readonly redactor: RedactionContext;
  private realRootPromise?: Promise<string>;
  private realAllowlistedRootsPromise?: Promise<readonly string[]>;

  constructor(config: ReadOnlyRepoInspectorConfig) {
    if (!config.rootDir || !config.rootDir.trim()) {
      throw new Error('ReadOnlyRepoInspector requires a non-empty rootDir');
    }
    if (!config.allowlistedPaths || config.allowlistedPaths.length === 0) {
      throw new Error('ReadOnlyRepoInspector requires at least one allowlisted path');
    }
    this.rootDir = path.resolve(config.rootDir);
    this.allowlistedPaths = config.allowlistedPaths.map((entry) =>
      assertCleanRelativeInput(entry, true)
    );
    this.deniedPathPatterns = config.deniedPathPatterns ?? DEFAULT_DENIED_PATH_PATTERNS;
    this.maxFileBytes = config.maxFileBytes ?? 256 * 1024;
    this.maxFilesPerList = config.maxFilesPerList ?? 200;
    this.maxSearchMatches = config.maxSearchMatches ?? 100;
    this.redactor = config.redactor ?? createRedactor();
  }

  private getRealRoot(): Promise<string> {
    if (!this.realRootPromise) {
      this.realRootPromise = fs.realpath(this.rootDir);
    }
    return this.realRootPromise;
  }

  private getRealAllowlistedRoots(): Promise<readonly string[]> {
    if (!this.realAllowlistedRootsPromise) {
      this.realAllowlistedRootsPromise = (async () => {
        const realRoot = await this.getRealRoot();
        const resolved: string[] = [];
        for (const allowEntry of this.allowlistedPaths) {
          const candidate = path.resolve(realRoot, allowEntry);
          if (!isStrictSubPath(realRoot, candidate)) {
            throw new ProviderError(`Allowlist path escapes root: "${allowEntry}"`, {
              code: 'policy_blocked',
              reasonCode: 'PATH_OUTSIDE_ALLOWLIST',
              providerId: 'repo-inspector',
              correlationId: 'allowlist-init',
              retryable: false,
            });
          }
          try {
            const realAllow = await fs.realpath(candidate);
            if (!isStrictSubPath(realRoot, realAllow)) {
              throw new ProviderError(`Allowlist symlink escapes root: "${allowEntry}"`, {
                code: 'policy_blocked',
                reasonCode: 'SYMLINK_ESCAPE_BLOCKED',
                providerId: 'repo-inspector',
                correlationId: 'allowlist-init',
                retryable: false,
              });
            }
            resolved.push(realAllow);
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
              resolved.push(candidate);
            } else {
              throw error;
            }
          }
        }
        return resolved;
      })();
    }
    return this.realAllowlistedRootsPromise;
  }

  private isDeniedRelativePath(relPosixPath: string): boolean {
    return this.deniedPathPatterns.some((pattern) => pattern.test(relPosixPath));
  }

  private async resolveSafeTarget(
    relativePath: string,
    allowDot = false
  ): Promise<{ readonly realTarget: string; readonly relPosix: string }> {
    const cleanInput = assertCleanRelativeInput(relativePath, allowDot);
    const realRoot = await this.getRealRoot();
    const realAllowlisted = await this.getRealAllowlistedRoots();

    const lexicalTarget = path.resolve(realRoot, cleanInput);
    if (!isStrictSubPath(realRoot, lexicalTarget)) {
      throw new ProviderError(`Path escapes repository root: "${relativePath}"`, {
        code: 'policy_blocked',
        reasonCode: 'PATH_TRAVERSAL_BLOCKED',
        providerId: 'repo-inspector',
        correlationId: 'repo-path-validation',
        retryable: false,
      });
    }

    let realTarget: string;
    try {
      realTarget = await fs.realpath(lexicalTarget);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new ProviderError(`Repository path not found: "${cleanInput}"`, {
          code: 'policy_blocked',
          reasonCode: 'PATH_NOT_FOUND',
          providerId: 'repo-inspector',
          correlationId: 'repo-path-validation',
          retryable: false,
        });
      }
      throw error;
    }

    if (!isStrictSubPath(realRoot, realTarget)) {
      throw new ProviderError(`Symlink target escapes repository root: "${relativePath}"`, {
        code: 'policy_blocked',
        reasonCode: 'SYMLINK_ESCAPE_BLOCKED',
        providerId: 'repo-inspector',
        correlationId: 'repo-path-validation',
        retryable: false,
      });
    }

    const relPosix = toPosixRelative(realRoot, realTarget) || '.';
    if (relPosix !== '.' && this.isDeniedRelativePath(relPosix)) {
      throw new ProviderError(`Access to sensitive repository path denied: "${relPosix}"`, {
        code: 'policy_blocked',
        reasonCode: 'SENSITIVE_PATH_BLOCKED',
        providerId: 'repo-inspector',
        correlationId: 'repo-path-validation',
        retryable: false,
      });
    }

    if (
      !(allowDot && cleanInput === '.') &&
      !realAllowlisted.some((allowedRoot) => isStrictSubPath(allowedRoot, realTarget))
    ) {
      throw new ProviderError(`Repository path is outside allowlist: "${relPosix}"`, {
        code: 'policy_blocked',
        reasonCode: 'PATH_OUTSIDE_ALLOWLIST',
        providerId: 'repo-inspector',
        correlationId: 'repo-path-validation',
        retryable: false,
      });
    }

    return { realTarget, relPosix };
  }

  async readFile(
    relativePath: string,
    options?: { readonly startLine?: number; readonly endLine?: number; readonly maxBytes?: number }
  ): Promise<RepoFileReadResult> {
    const { realTarget, relPosix } = await this.resolveSafeTarget(relativePath, false);
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) {
      throw new ProviderError(`Path is not a regular file: "${relPosix}"`, {
        code: 'policy_blocked',
        reasonCode: 'PATH_OUTSIDE_ALLOWLIST',
        providerId: 'repo-inspector',
        correlationId: 'repo-read',
        retryable: false,
      });
    }

    const maxBytes = Math.min(this.maxFileBytes, options?.maxBytes ?? this.maxFileBytes);
    const rawBuffer = await fs.readFile(realTarget);
    const sha256 = createHash('sha256').update(rawBuffer).digest('hex');

    let truncated = false;
    let sliceBuffer = rawBuffer;
    if (rawBuffer.byteLength > maxBytes) {
      sliceBuffer = rawBuffer.subarray(0, maxBytes);
      truncated = true;
    }

    const fullText = sliceBuffer.toString('utf8');
    const allLines = fullText.split(/\r?\n/u);
    const totalLines = allLines.length;

    let selectedText = fullText;
    if (options?.startLine !== undefined || options?.endLine !== undefined) {
      const start = Math.max(1, options.startLine ?? 1);
      const end = Math.min(totalLines, options.endLine ?? totalLines);
      if (end < totalLines || start > 1) {
        truncated = truncated || end < totalLines;
      }
      selectedText = allLines.slice(start - 1, end).join('\n');
    }

    const redactedContent = this.redactor.redactString(selectedText);
    return {
      path: relPosix,
      content: redactedContent,
      untrustedWrappedContent: wrapUntrustedRepoContent(relPosix, redactedContent),
      byteLength: rawBuffer.byteLength,
      totalLines,
      truncated,
      sha256,
    };
  }

  async listFiles(relativeDir = '.'): Promise<readonly RepoFileEntry[]> {
    const realRoot = await this.getRealRoot();
    const realAllowlisted = await this.getRealAllowlistedRoots();
    const entries: RepoFileEntry[] = [];
    const visitedDirs = new Set<string>();

    const walk = async (dirPath: string): Promise<void> => {
      if (entries.length >= this.maxFilesPerList) return;
      let canonicalDir: string;
      try {
        canonicalDir = await fs.realpath(dirPath);
      } catch {
        return;
      }
      if (!isStrictSubPath(realRoot, canonicalDir)) return;
      if (visitedDirs.has(canonicalDir)) return;
      visitedDirs.add(canonicalDir);

      const dirents = await fs.readdir(canonicalDir, { withFileTypes: true });
      dirents.sort((a, b) => a.name.localeCompare(b.name));

      for (const dirent of dirents) {
        if (entries.length >= this.maxFilesPerList) break;
        const childLexical = path.join(canonicalDir, dirent.name);
        let childReal: string;
        try {
          childReal = await fs.realpath(childLexical);
        } catch {
          continue;
        }
        if (!isStrictSubPath(realRoot, childReal)) continue;
        if (!realAllowlisted.some((allowedRoot) => isStrictSubPath(allowedRoot, childReal))) {
          continue;
        }
        const relPosix = toPosixRelative(realRoot, childReal);
        if (!relPosix || this.isDeniedRelativePath(relPosix)) continue;

        const stat = await fs.stat(childReal);
        if (stat.isDirectory()) {
          await walk(childReal);
        } else if (stat.isFile()) {
          entries.push({ path: relPosix, sizeBytes: stat.size });
        }
      }
    };

    if (relativeDir === '.' || relativeDir === '') {
      for (const allowedRoot of realAllowlisted) {
        if (entries.length >= this.maxFilesPerList) break;
        try {
          const stat = await fs.stat(allowedRoot);
          if (stat.isDirectory()) {
            await walk(allowedRoot);
          } else if (stat.isFile()) {
            const relPosix = toPosixRelative(realRoot, allowedRoot);
            if (!this.isDeniedRelativePath(relPosix)) {
              entries.push({ path: relPosix, sizeBytes: stat.size });
            }
          }
        } catch {
          // ignore non-existent allowlist roots during listing
        }
      }
      return entries;
    }

    const { realTarget, relPosix } = await this.resolveSafeTarget(relativeDir, false);
    const stat = await fs.stat(realTarget);
    if (stat.isFile()) {
      return [{ path: relPosix, sizeBytes: stat.size }];
    }
    await walk(realTarget);
    return entries;
  }

  async searchFiles(
    query: string,
    options?: { readonly pathPrefix?: string; readonly maxMatches?: number }
  ): Promise<readonly RepoSearchMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const maxMatches = Math.min(
      this.maxSearchMatches,
      options?.maxMatches ?? this.maxSearchMatches
    );
    const files = await this.listFiles(options?.pathPrefix ?? '.');
    const matches: RepoSearchMatch[] = [];

    for (const file of files) {
      if (matches.length >= maxMatches) break;
      const read = await this.readFile(file.path);
      const lines = read.content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        if (matches.length >= maxMatches) break;
        if (lines[index].includes(trimmed)) {
          matches.push({
            path: file.path,
            lineNumber: index + 1,
            preview: lines[index].slice(0, 240),
            sha256: read.sha256,
          });
        }
      }
    }

    return matches;
  }
}

export interface RepoToolBundle {
  readonly definitions: readonly AiToolDefinition[];
  readonly executeTool: (name: string, args: JsonObject) => Promise<JsonValue>;
}

export function createReadOnlyRepoTools(inspector: ReadOnlyRepoInspector): RepoToolBundle {
  const definitions: readonly AiToolDefinition[] = [
    {
      name: 'repo_list_files',
      description: 'Read-only allowlisted listing of files in the repository scope.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string' },
        },
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'repo_read_file',
      description: 'Read-only bounded file read within allowlisted repository paths.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'repo_search_files',
      description: 'Read-only substring search within allowlisted repository paths.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          pathPrefix: { type: 'string' },
          maxMatches: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      strict: true,
    },
  ];

  const executeTool = async (name: string, args: JsonObject): Promise<JsonValue> => {
    if (name === 'repo_list_files') {
      const dir = typeof args.dir === 'string' ? args.dir : '.';
      const files = await inspector.listFiles(dir);
      return {
        untrustedData: true,
        files: files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })),
      };
    }
    if (name === 'repo_read_file') {
      const targetPath = typeof args.path === 'string' ? args.path : '';
      const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
      const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;
      const read = await inspector.readFile(targetPath, { startLine, endLine });
      return {
        untrustedData: true,
        path: read.path,
        sha256: read.sha256,
        totalLines: read.totalLines,
        truncated: read.truncated,
        content: read.untrustedWrappedContent,
      };
    }
    if (name === 'repo_search_files') {
      const query = typeof args.query === 'string' ? args.query : '';
      const pathPrefix = typeof args.pathPrefix === 'string' ? args.pathPrefix : undefined;
      const maxMatches = typeof args.maxMatches === 'number' ? args.maxMatches : undefined;
      const matches = await inspector.searchFiles(query, { pathPrefix, maxMatches });
      return {
        untrustedData: true,
        matches: matches.map((match) => ({
          path: match.path,
          lineNumber: match.lineNumber,
          preview: match.preview,
          sha256: match.sha256,
        })),
      };
    }

    throw new ProviderError(`Unknown read-only repo tool "${name}"`, {
      code: 'policy_blocked',
      reasonCode: 'TOOL_NOT_ALLOWED',
      providerId: 'repo-inspector',
      correlationId: 'repo-tool',
      retryable: false,
    });
  };

  return { definitions, executeTool };
}
