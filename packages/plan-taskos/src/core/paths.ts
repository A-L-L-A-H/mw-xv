export class InvalidRepoPathError extends Error {
  constructor(message: string) {
    super(`normalizeRepoPath: ${message}`);
    this.name = "InvalidRepoPathError";
  }
}

/**
 * Normalize a repo-relative path to POSIX form:
 * - backslashes -> forward slashes
 * - strips leading `./`
 * - collapses duplicate slashes
 * - rejects empty paths, absolute paths (`/...`, `C:...`), NUL bytes, and
 *   `..` traversal segments with an explicit error (fail-closed).
 */
export function normalizeRepoPath(raw: string): string {
  if (raw.includes("\0")) {
    throw new InvalidRepoPathError("NUL byte in path");
  }
  const converted = raw.replaceAll("\\", "/");
  if (converted.startsWith("/")) {
    throw new InvalidRepoPathError(`absolute path not allowed: ${JSON.stringify(raw)}`);
  }
  if (/^[A-Za-z]:/.test(converted)) {
    throw new InvalidRepoPathError(`drive-absolute path not allowed: ${JSON.stringify(raw)}`);
  }
  let normalized = converted
    .split("/")
    .filter((segment) => segment !== ".")
    .filter((segment, index, segments) => segment !== "" && !(index === 0 && segments[0] === ""))
    .join("/");
  // Collapse any interior duplicate slashes.
  normalized = normalized.replace(/\/{2,}/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (!normalized) {
    throw new InvalidRepoPathError(`empty path: ${JSON.stringify(raw)}`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new InvalidRepoPathError(`traversal segment '..' not allowed: ${JSON.stringify(raw)}`);
  }
  if (segments.some((segment) => segment.length === 0)) {
    throw new InvalidRepoPathError(`empty segment in path: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

/** Split a glob pattern into literal/wildcard tokens, POSIX semantics. */
type GlobToken =
  | { kind: "literal"; text: string }
  | { kind: "single" } // `?`
  | { kind: "wild" } // `*` (within one segment)
  | { kind: "globstar" }; // `**`

function parseGlobTokens(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let literal = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "*") {
      if (literal) {
        tokens.push({ kind: "literal", text: literal });
        literal = "";
      }
      if (pattern.startsWith("**", index)) {
        tokens.push({ kind: "globstar" });
        index += 2;
        // Swallow an adjacent slash: `a/**/b` also matches `a/b`.
        if (pattern[index] === "/") {
          index += 1;
        }
      } else {
        tokens.push({ kind: "wild" });
        index += 1;
      }
      continue;
    }
    if (char === "?") {
      if (literal) {
        tokens.push({ kind: "literal", text: literal });
        literal = "";
      }
      tokens.push({ kind: "single" });
      index += 1;
      continue;
    }
    literal += char;
    index += 1;
  }
  if (literal) {
    tokens.push({ kind: "literal", text: literal });
  }
  return tokens;
}

function matchGlob(pattern: string, path: string): boolean {
  const tokens = parseGlobTokens(pattern);
  const remaining = path;

  function matchAt(tokenIndex: number, position: number): boolean {
    if (tokenIndex === tokens.length) {
      return position === remaining.length;
    }
    const token = tokens[tokenIndex];
    switch (token.kind) {
      case "literal": {
        const text = token.text;
        if (!remaining.startsWith(text, position)) {
          return false;
        }
        return matchAt(tokenIndex + 1, position + text.length);
      }
      case "single": {
        if (position >= remaining.length || remaining[position] === "/") {
          return false;
        }
        return matchAt(tokenIndex + 1, position + 1);
      }
      case "wild": {
        // `*` matches zero or more characters, but never `/`.
        for (let end = position; end <= remaining.length; end += 1) {
          if (end > position && remaining[end - 1] === "/") {
            break;
          }
          if (matchAt(tokenIndex + 1, end)) {
            return true;
          }
        }
        return false;
      }
      case "globstar": {
        // `**` matches zero or more segments.
        for (let end = position; end <= remaining.length; end += 1) {
          if (end > position && remaining[end - 1] === "/" && end > position) {
            // valid boundary
          }
          if (matchAt(tokenIndex + 1, end)) {
            return true;
          }
          // advance to the next slash boundary
          const nextSlash = remaining.indexOf("/", end);
          if (nextSlash < 0) {
            break;
          }
          end = nextSlash;
        }
        return false;
      }
    }
  }

  return matchAt(0, 0);
}

/**
 * Deterministic POSIX glob matching (`*`, `**`, `?`).
 */
export function globMatchesPath(pattern: string, filePath: string): boolean {
  return matchGlob(normalizeRepoPath(pattern), normalizeRepoPath(filePath));
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToConservativeRegex(pattern: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:[^/]+/)*";
      index += 3;
      continue;
    }
    if (pattern.startsWith("/**", index)) {
      source += "(?:/[^/]+)*";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += escapeForRegex(char);
    index += 1;
  }
  return new RegExp(`${source}$`, "u");
}

/**
 * Static conservative overlap proof: returns `true` whenever ANY path could
 * satisfy both patterns (e.g. `packages/orm-cloud/src/**` overlaps
 * `packages/orm-cloud/src/http.ts`). False negatives are impossible for the
 * supported grammar; a `true` result may still require runtime confirmation,
 * so treat `false` as the only decisive no.
 */
export function globsMayOverlap(patternA: string, patternB: string): boolean {
  const a = normalizeRepoPath(patternA);
  const b = normalizeRepoPath(patternB);
  if (a === b) {
    return true;
  }
  // A concrete path or pattern that the other pattern matches -> overlap.
  if (matchGlob(a, b) || matchGlob(b, a)) {
    return true;
  }
  // Conservative wildcard generalization: strip wildcards from each side and
  // let the generalized regexes intersect.
  const generalize = (pattern: string): string => {
    let generalized = pattern.replace(/\*\*/g, "A");
    generalized = generalized.replace(/\*/g, "A");
    generalized = generalized.replace(/\?/g, "A");
    // Any literal segment could be replaced by a wildcard-matched segment,
    // so compare only fixed non-wildcard structure at both ends.
    return generalized;
  };
  const regexA = globToConservativeRegex(a.replace(/[?*]+/g, "A").replace(/A(\.A)*$/u, "A"));
  const regexB = globToConservativeRegex(b.replace(/[?*]+/g, "A").replace(/A(\.A)*$/u, "A"));
  const wildcardA = /[*?]/.test(a);
  const wildcardB = /[*?]/.test(b);
  if (!wildcardA && !wildcardB) {
    return false; // two concrete paths, already compared above
  }
  // Mutual static-segment compatibility: compare the concrete prefix/suffix
  // structure of both patterns. If either side can match a path the other
  // side also matches, the generalized regexes both accept the empty-ish
  // candidate; the conservative answer is YES unless concrete fixed segments
  // provably disagree at the same index.
  const segA = a.split("/");
  const segB = b.split("/");
  const minLength = Math.min(segA.length, segB.length);
  // If one pattern has more segments than the other and neither ends in a
  // globstar family pattern, they can still overlap via a trailing `**`
  // pattern. Handle the decisive disagreement check:
  const canGrowA = wildcardA || segA.length >= minLength;
  const canGrowB = wildcardB || segB.length >= minLength;
  if (!canGrowA && segA.length !== segB.length) {
    return false;
  }
  if (!canGrowB && segA.length !== segB.length) {
    return false;
  }
  for (let i = 0; i < minLength; i += 1) {
    const sa = segA[i];
    const sb = segB[i];
    const wildA = /[*?]/.test(sa);
    const wildB = /[*?]/.test(sb);
    if (wildA || wildB) {
      continue;
    }
    if (sa !== sb) {
      // Different concrete segment at the same index — but one side may still
      // be matched with fewer leading segments if it is a globstar start.
      const aHasLeadingGlobstar = segA.slice(0, i).some((s) => /\*\*/.test(s));
      const bHasLeadingGlobstar = segB.slice(0, i).some((s) => /\*\*/.test(s));
      if (!aHasLeadingGlobstar && !bHasLeadingGlobstar) {
        return false;
      }
      // Even with leading globstars, a differing concrete segment at the same
      // index can only coincide if one pattern's globstar absorbed it.
      const aAbsorbs = segA.some((s, j) => j < i && /\*\*/.test(s));
      const bAbsorbs = segB.some((s, j) => j < i && /\*\*/.test(s));
      if (!aAbsorbs && !bAbsorbs) {
        return false;
      }
      return true;
    }
  }
  // One pattern is a strict prefix (segment-wise) of the other: overlap only
  // if the shorter side ends with a wildcard or globstar.
  if (segA.length !== segB.length) {
    const [shorter, longer] = segA.length < segB.length ? [segA, segB] : [segB, segA];
    const lastShorter = shorter[shorter.length - 1];
    if (/[*?]/.test(lastShorter) || lastShorter === "**") {
      return true;
    }
    // The longer side's next segment could be matched by `**` in the shorter
    // side only when the shorter side contains a globstar before its end.
    if (shorter.some((s) => /\*\*/.test(s))) {
      return true;
    }
    return false;
  }
  // Same segment count with at least one wildcard: fall back to regex
  // generalization intersection check on a synthetic candidate.
  const ga = generalize(a);
  const gb = generalize(b);
  if (ga === gb) {
    return true;
  }
  // Last-resort conservative answer with wildcards present.
  return true;
}
