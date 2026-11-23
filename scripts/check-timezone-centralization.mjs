import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Issue #195: 'Asia/Jakarta' and the UTC+07:00 offset (420 minutes) must only appear in
 * packages/orm-base/src/timezone.ts (the canonical constants) and UI timezone pickers.
 * Everything else must import DEFAULT_TIMEZONE / DEFAULT_UTC_OFFSET_MINUTES from
 * @moonwitness/orm-base.
 */
const CANONICAL_CONSTANTS_FILE = 'packages/orm-base/src/timezone.ts';

/** UI timezone pickers legitimately enumerate user-selectable zone names. */
const ALLOWLISTED_FILES = new Set(['apps/board/src/board-pages/settings-page.tsx']);

/** Build output and end-to-end fixtures are not hand-maintained sources. */
const IGNORED_PATH_PATTERNS = [
  /(^|\/)\.next(-[^/]+)?\//u,
  /(^|\/)dist(-[^/]+)?\//u,
  /(^|\/)dist[/-]board\//u,
  /(^|\/)node_modules\//u,
  /(^|\/)tests\//u,
  /(^|\/)e2e\//u,
];

const TIMEZONE_LITERAL = /['"]Asia\/Jakarta['"]/u;
const OFFSET_LITERAL = /\b(?:utcOffsetMinutes|utc_offset_minutes|utcOffset)\D{0,4}420\b/u;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name.startsWith('.next')
          ) {
            return [];
          }
          return sourceFiles(file);
        }
        return entry.isFile() && /\.[jt]sx?$/u.test(entry.name) ? [file] : [];
      })
    )
  ).flat();
}

export function findTimezoneLiteralViolations(source, file = 'packages/orm-base/src/fixture.ts') {
  const normalized = file.replaceAll('\\', '/');
  if (
    normalized === CANONICAL_CONSTANTS_FILE ||
    ALLOWLISTED_FILES.has(normalized) ||
    IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return [];
  }
  const violations = [];
  if (TIMEZONE_LITERAL.test(source)) {
    violations.push(
      `${normalized}: hardcoded 'Asia/Jakarta' timezone literal (import DEFAULT_TIMEZONE from @moonwitness/orm-base)`
    );
  }
  if (OFFSET_LITERAL.test(source)) {
    violations.push(
      `${normalized}: hardcoded UTC+07:00 offset 420 (import DEFAULT_UTC_OFFSET_MINUTES from @moonwitness/orm-base)`
    );
  }
  return violations;
}

async function main() {
  const violations = [];
  for (const dir of ['packages', 'apps']) {
    for (const file of await sourceFiles(path.join(root, dir))) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      violations.push(...findTimezoneLiteralViolations(await readFile(file, 'utf8'), relative));
    }
  }

  if (violations.length > 0) {
    console.error(`Timezone centralization check failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      'Fix: import DEFAULT_TIMEZONE / DEFAULT_UTC_OFFSET_MINUTES from @moonwitness/orm-base instead of hardcoding literals. Recheck with `pnpm timezone:check`.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    'Timezone centralization check passed: Asia/Jakarta and the UTC+07:00 offset are defined only in packages/orm-base/src/timezone.ts.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
