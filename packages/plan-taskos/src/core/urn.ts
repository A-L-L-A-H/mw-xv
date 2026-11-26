const WORK_URN_PATTERN =
  /^urn:mw:work:([a-z0-9][a-z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63}):([a-z0-9][a-z0-9-]{1,63})(?::([A-Za-z][A-Za-z0-9_-]{0,63}))?(?:\/([A-Za-z][A-Za-z0-9_-]{0,63}))?(?:#([A-Za-z][A-Za-z0-9_-]{0,63}))?$/;

export interface BuildWorkUrnInput {
  org: string;
  repo: string;
  planId: string;
  waveId?: string;
  taskId?: string;
  acId?: string;
}

export interface ParsedWorkUrn {
  org: string;
  repo: string;
  planId: string;
  waveId?: string;
  taskId?: string;
  acId?: string;
}

function assertSegment(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`Invalid ${label} segment: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertCodeSegment(value: string, label: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`Invalid ${label} segment: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Build a canonical work URN:
 * `urn:mw:work:<org>/<repo>:<planId>[:<waveId>[/<taskId>[#<acId>]]]`
 */
export function buildWorkUrn(input: BuildWorkUrnInput): string {
  const { org, repo, planId, waveId, taskId, acId } = input;
  if (taskId && !waveId) {
    throw new Error("taskId requires waveId");
  }
  if (acId && !taskId) {
    throw new Error("acId requires taskId");
  }
  let urn =
    `urn:mw:work:${assertSegment(org, "org")}/${assertSegment(repo, "repo")}:` +
    assertSegment(planId, "planId");
  if (waveId) {
    urn += `:${assertCodeSegment(waveId, "waveId")}`;
    if (taskId) {
      urn += `/${assertCodeSegment(taskId, "taskId")}`;
      if (acId) {
        urn += `#${assertCodeSegment(acId, "acId")}`;
      }
    }
  }
  return urn;
}

export function buildDocUrn(input: { org: string; repo: string; slug: string }): string {
  const slug = input.slug.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error(`Invalid doc slug: ${JSON.stringify(input.slug)}`);
  }
  return `urn:mw:doc:${assertSegment(input.org, "org")}/${assertSegment(input.repo, "repo")}:${slug}`;
}

export function buildFileUrn(posixPath: string): string {
  if (!posixPath || posixPath.includes("\\")) {
    throw new Error(`Invalid posix path: ${JSON.stringify(posixPath)}`);
  }
  return `urn:mw:file:${posixPath}`;
}

export function buildInvariantUrn(invId: string): string {
  if (!/^INV-[A-Za-z0-9-]{1,63}$/.test(invId)) {
    throw new Error(`Invalid invariant id: ${JSON.stringify(invId)}`);
  }
  return `urn:mw:inv:${invId}`;
}

export function buildMemoryUrn(memoryId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(memoryId)) {
    throw new Error(`Invalid memory id: ${JSON.stringify(memoryId)}`);
  }
  return `urn:mw:memory:${memoryId}`;
}

/**
 * Fail-closed parse: returns typed components, or `null` when the raw string
 * does not match the work URN grammar.
 */
export function parseWorkUrn(raw: string): ParsedWorkUrn | null {
  const match = WORK_URN_PATTERN.exec(raw);
  if (!match) {
    return null;
  }
  const [, org, repo, planId, waveId, taskId, acId] = match;
  return {
    org,
    repo,
    planId,
    ...(waveId ? { waveId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(acId ? { acId } : {}),
  };
}

/**
 * Normalize dotted ORM task codes (`M0.01` -> `M0_01`) to satisfy
 * `^[A-Za-z][A-Za-z0-9_-]{1,63}$`. The original raw code must be preserved
 * by callers in `external_ref`.
 */
export function normalizeOrmTaskCode(rawCode: string): string {
  if (!rawCode) {
    throw new Error("normalizeOrmTaskCode: empty code");
  }
  const normalized = rawCode.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(normalized)) {
    throw new Error(`normalizeOrmTaskCode: cannot normalize ${JSON.stringify(rawCode)}`);
  }
  return normalized;
}
