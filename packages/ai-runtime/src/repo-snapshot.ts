import { sha256Hex } from './canonical-json.js';
import { compareAscii } from './sort-utils.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { ReadOnlyRepoInspector, RepoFileEntry } from './repo-inspector.js';

export type RepoManifestKind =
  'package.json' | 'Cargo.toml' | 'go.mod' | 'pyproject.toml' | 'tsconfig.json';

export interface RepoGitRevision {
  readonly headCommit: string | null;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly capturedAt?: string;
}

export interface RepoSnapshotOptions {
  readonly gitRevision?: RepoGitRevision;
  readonly rootLabel?: string;
  readonly maxFiles?: number;
  readonly maxManifestBytes?: number;
  readonly maxDocHeadings?: number;
  readonly capturedAt?: string;
  readonly redactor?: RedactionContext;
}

export interface RepoManifestSummary {
  readonly path: string;
  readonly kind: RepoManifestKind;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
  readonly name?: string;
  readonly version?: string;
}

export interface RepoScriptEntry {
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly name: string;
  readonly command: string;
}

export interface RepoDocEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly title: string | null;
  readonly headings: readonly string[];
  readonly truncated: boolean;
}

export interface RepoEntryPoint {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type RepoObservationKind = 'manifest' | 'script' | 'doc' | 'entry_point';

export interface RepoObservation {
  readonly kind: RepoObservationKind;
  readonly path: string;
  readonly sha256: string;
  readonly detail: string;
}

export interface RepoInference {
  readonly kind: 'stack_tag';
  readonly tag: string;
  readonly derivedFromPaths: readonly string[];
  readonly rationale: string;
}

export interface RepoSnapshot {
  readonly schemaVersion: 1;
  readonly rootLabel: string;
  readonly capturedAt: string;
  readonly gitRevision: RepoGitRevision | null;
  readonly scannedFileCount: number;
  readonly manifests: readonly RepoManifestSummary[];
  readonly scripts: readonly RepoScriptEntry[];
  readonly docs: readonly RepoDocEntry[];
  readonly entryPoints: readonly RepoEntryPoint[];
  readonly observations: readonly RepoObservation[];
  readonly inferences: readonly RepoInference[];
  readonly incomplete: boolean;
  readonly omittedReasons: readonly string[];
  readonly contentSha256: string;
  readonly snapshotSha256: string;
}

const DEFAULT_MAX_MANIFEST_BYTES = 128 * 1024;
const DEFAULT_MAX_DOC_HEADINGS = 20;

const MANIFEST_BASENAMES: Readonly<Record<string, RepoManifestKind>> = {
  'package.json': 'package.json',
  'Cargo.toml': 'Cargo.toml',
  'go.mod': 'go.mod',
  'pyproject.toml': 'pyproject.toml',
  'tsconfig.json': 'tsconfig.json',
};

const ENTRY_POINT_PATTERN = /(?:^|\/)src\/(?:index|main|server|cli)\.[^/]+$/u;
const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*$/u;

function getPosixBasename(posixPath: string): string {
  const slashIndex = posixPath.lastIndexOf('/');
  return slashIndex === -1 ? posixPath : posixPath.slice(slashIndex + 1);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractMarkdownHeadings(
  content: string,
  maxHeadings: number,
  redactor: RedactionContext
): { readonly title: string | null; readonly headings: readonly string[] } {
  let title: string | null = null;
  const headings: string[] = [];
  const lines = content.split(/\r?\n/u);

  for (const line of lines) {
    const match = MARKDOWN_HEADING_PATTERN.exec(line.trim());
    if (!match) continue;
    const level = match[1].length;
    const text = redactor.redactString(match[2].trim());
    if (!text) continue;
    if (level === 1 && title === null) {
      title = text;
    }
    if (headings.length < maxHeadings) {
      headings.push(text);
    }
  }

  return { title, headings };
}

function buildStackInferences(manifests: readonly RepoManifestSummary[]): readonly RepoInference[] {
  const pathsByTag = new Map<string, { paths: string[]; rationale: string }>();

  const addTag = (tag: string, filePath: string, rationale: string): void => {
    const existing = pathsByTag.get(tag);
    if (existing) {
      existing.paths.push(filePath);
    } else {
      pathsByTag.set(tag, { paths: [filePath], rationale });
    }
  };

  for (const manifest of manifests) {
    if (manifest.kind === 'package.json') {
      addTag('node', manifest.path, 'Observed package.json manifest');
    } else if (manifest.kind === 'tsconfig.json') {
      addTag('typescript', manifest.path, 'Observed tsconfig.json manifest');
    } else if (manifest.kind === 'Cargo.toml') {
      addTag('rust', manifest.path, 'Observed Cargo.toml manifest');
    } else if (manifest.kind === 'go.mod') {
      addTag('go', manifest.path, 'Observed go.mod manifest');
    } else if (manifest.kind === 'pyproject.toml') {
      addTag('python', manifest.path, 'Observed pyproject.toml manifest');
    }
  }

  return [...pathsByTag.entries()]
    .sort(([a], [b]) => compareAscii(a, b))
    .map(([tag, info]) => ({
      kind: 'stack_tag' as const,
      tag,
      derivedFromPaths: [...info.paths].sort(compareAscii),
      rationale: info.rationale,
    }));
}

export async function buildRepoSnapshot(
  inspector: ReadOnlyRepoInspector,
  options: RepoSnapshotOptions = {}
): Promise<RepoSnapshot> {
  const redactor = options.redactor ?? createRedactor();
  const rootLabel = redactor.redactString(options.rootLabel?.trim() || 'workspace');
  const maxManifestBytes = Math.max(
    1,
    Math.floor(options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES)
  );
  const maxDocHeadings = Math.max(
    0,
    Math.floor(options.maxDocHeadings ?? DEFAULT_MAX_DOC_HEADINGS)
  );
  const capturedAt =
    options.capturedAt ?? options.gitRevision?.capturedAt ?? new Date().toISOString();

  const gitRevision: RepoGitRevision | null = options.gitRevision
    ? {
        headCommit: options.gitRevision.headCommit
          ? redactor.redactString(options.gitRevision.headCommit)
          : null,
        branch: options.gitRevision.branch
          ? redactor.redactString(options.gitRevision.branch)
          : null,
        dirty: Boolean(options.gitRevision.dirty),
        ...(options.gitRevision.capturedAt !== undefined
          ? { capturedAt: options.gitRevision.capturedAt }
          : {}),
      }
    : null;

  const omittedReasons: string[] = [];
  let incomplete = false;

  const listedFiles = await inspector.listFiles('.');
  const sortedFiles: RepoFileEntry[] = [...listedFiles].sort((a, b) =>
    compareAscii(a.path, b.path)
  );

  let filesToInspect: readonly RepoFileEntry[] = sortedFiles;
  if (options.maxFiles !== undefined) {
    const cap = Math.max(0, Math.floor(options.maxFiles));
    if (sortedFiles.length > cap) {
      incomplete = true;
      omittedReasons.push(
        `maxFiles cap (${cap}) reached: ${sortedFiles.length - cap} file(s) omitted`
      );
      filesToInspect = sortedFiles.slice(0, cap);
    }
  }

  const manifests: RepoManifestSummary[] = [];
  const scripts: RepoScriptEntry[] = [];
  const docs: RepoDocEntry[] = [];
  const entryPoints: RepoEntryPoint[] = [];
  const observations: RepoObservation[] = [];

  for (const entry of filesToInspect) {
    const basename = getPosixBasename(entry.path);
    const manifestKind = MANIFEST_BASENAMES[basename];

    if (manifestKind) {
      try {
        const read = await inspector.readFile(entry.path, { maxBytes: maxManifestBytes });
        if (read.truncated) {
          incomplete = true;
          omittedReasons.push(`manifest truncated at ${maxManifestBytes} bytes: ${read.path}`);
        }

        let name: string | undefined;
        let version: string | undefined;

        if (manifestKind === 'package.json') {
          try {
            const parsed: unknown = JSON.parse(read.content);
            if (isPlainRecord(parsed)) {
              if (typeof parsed.name === 'string' && parsed.name.trim()) {
                name = redactor.redactString(parsed.name.trim());
              }
              if (typeof parsed.version === 'string' && parsed.version.trim()) {
                version = redactor.redactString(parsed.version.trim());
              }
              if (isPlainRecord(parsed.scripts)) {
                const scriptNames = Object.keys(parsed.scripts).sort(compareAscii);
                for (const scriptName of scriptNames) {
                  const rawCommand = parsed.scripts[scriptName];
                  if (typeof rawCommand !== 'string') continue;
                  const redactedCommand = redactor.redactString(rawCommand);
                  scripts.push({
                    manifestPath: read.path,
                    manifestSha256: read.sha256,
                    name: scriptName,
                    command: redactedCommand,
                  });
                  observations.push({
                    kind: 'script',
                    path: read.path,
                    sha256: read.sha256,
                    detail: `script "${scriptName}"`,
                  });
                }
              }
            }
          } catch {
            incomplete = true;
            omittedReasons.push(`manifest JSON parse failed: ${read.path}`);
          }
        }

        const summary: RepoManifestSummary = {
          path: read.path,
          kind: manifestKind,
          sha256: read.sha256,
          sizeBytes: read.byteLength,
          truncated: read.truncated,
          ...(name !== undefined ? { name } : {}),
          ...(version !== undefined ? { version } : {}),
        };
        manifests.push(summary);
        observations.push({
          kind: 'manifest',
          path: read.path,
          sha256: read.sha256,
          detail: `${manifestKind}${name ? ` (${name})` : ''}`,
        });
      } catch (error) {
        incomplete = true;
        const sanitized = redactor.redactError(error);
        omittedReasons.push(`manifest inspection failed for ${entry.path}: ${sanitized.message}`);
      }
      continue;
    }

    if (entry.path.toLowerCase().endsWith('.md')) {
      try {
        const read = await inspector.readFile(entry.path, { maxBytes: maxManifestBytes });
        if (read.truncated) {
          incomplete = true;
          omittedReasons.push(`doc truncated at ${maxManifestBytes} bytes: ${read.path}`);
        }
        const { title, headings } = extractMarkdownHeadings(read.content, maxDocHeadings, redactor);
        docs.push({
          path: read.path,
          sha256: read.sha256,
          sizeBytes: read.byteLength,
          title,
          headings,
          truncated: read.truncated,
        });
        observations.push({
          kind: 'doc',
          path: read.path,
          sha256: read.sha256,
          detail: title ? `markdown doc "${title}"` : 'markdown doc',
        });
      } catch (error) {
        incomplete = true;
        const sanitized = redactor.redactError(error);
        omittedReasons.push(`doc inspection failed for ${entry.path}: ${sanitized.message}`);
      }
      continue;
    }

    if (ENTRY_POINT_PATTERN.test(entry.path)) {
      try {
        const read = await inspector.readFile(entry.path, { maxBytes: maxManifestBytes });
        if (read.truncated) {
          incomplete = true;
          omittedReasons.push(`entry point truncated at ${maxManifestBytes} bytes: ${read.path}`);
        }
        entryPoints.push({
          path: read.path,
          sha256: read.sha256,
          sizeBytes: read.byteLength,
        });
        observations.push({
          kind: 'entry_point',
          path: read.path,
          sha256: read.sha256,
          detail: `entry point ${read.path}`,
        });
      } catch (error) {
        incomplete = true;
        const sanitized = redactor.redactError(error);
        omittedReasons.push(
          `entry point inspection failed for ${entry.path}: ${sanitized.message}`
        );
      }
    }
  }

  manifests.sort((a, b) => compareAscii(a.path, b.path));
  scripts.sort(
    (a, b) => compareAscii(a.manifestPath, b.manifestPath) || compareAscii(a.name, b.name)
  );
  docs.sort((a, b) => compareAscii(a.path, b.path));
  entryPoints.sort((a, b) => compareAscii(a.path, b.path));
  observations.sort(
    (a, b) =>
      compareAscii(a.path, b.path) ||
      compareAscii(a.kind, b.kind) ||
      compareAscii(a.detail, b.detail)
  );

  const inferences = buildStackInferences(manifests);

  const canonicalContentPayload = {
    schemaVersion: 1 as const,
    rootLabel,
    gitRevision: gitRevision
      ? {
          headCommit: gitRevision.headCommit,
          branch: gitRevision.branch,
          dirty: gitRevision.dirty,
        }
      : null,
    scannedFileCount: filesToInspect.length,
    manifests,
    scripts,
    docs,
    entryPoints,
    observations,
    inferences,
    incomplete,
    omittedReasons,
  };

  const contentSha256 = sha256Hex(JSON.stringify(canonicalContentPayload));
  const snapshotSha256 = sha256Hex(
    JSON.stringify({
      ...canonicalContentPayload,
      capturedAt,
      gitRevisionCapturedAt: gitRevision?.capturedAt ?? null,
      contentSha256,
    })
  );

  return {
    schemaVersion: 1,
    rootLabel,
    capturedAt,
    gitRevision,
    scannedFileCount: filesToInspect.length,
    manifests,
    scripts,
    docs,
    entryPoints,
    observations,
    inferences,
    incomplete,
    omittedReasons,
    contentSha256,
    snapshotSha256,
  };
}
