import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopSourceRoot = path.join(root, 'apps/desktop/src');
const boardSourceRoot = path.join(root, 'apps/board/src');

const BANNED_DESKTOP_SOURCE_PATTERNS = [
  {
    pattern: /\bdefine(?:Model|Addon)\s*\(/u,
    rule: 'apps/desktop must not call defineModel or defineAddon',
  },
];

const BANNED_BOARD_IMPORT_PATTERNS = [
  {
    pattern: /^(?:better-sqlite3|node-pty|tauri(?:\/[^'"]*)?)$/u,
    rule: 'apps/board must not import native desktop or SQLite/PTY runtime modules',
  },
  {
    pattern: /^node:(?:fs|fs\/promises|child_process|os|process)$/u,
    rule: 'apps/board must not import Node runtime modules',
  },
];

const BOARD_RUNTIME_IMPORT_PREFIXES = ['@moonwitness/orm', 'tauri', 'better-sqlite3', 'node-pty'];

function isDesktopSourceFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.startsWith('apps/desktop/src/') && /\.(?:[cm]?[jt]s)$/u.test(normalized);
}

function isBoardSourceFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.startsWith('apps/board/src/') && /\.(?:[cm]?[jt]sx?)$/u.test(normalized);
}

export function findDesktopNonOverlapViolations(source, file = 'apps/desktop/src/example.ts') {
  if (!isDesktopSourceFile(file)) return [];
  const relativePath = file.split(path.sep).join('/');
  const violations = [];
  for (const { pattern, rule } of BANNED_DESKTOP_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      violations.push(`${relativePath}: ${rule}`);
      break;
    }
  }
  return violations;
}

export function findBoardRuntimeImportViolations(source, file = 'apps/board/src/example.tsx') {
  if (!isBoardSourceFile(file)) return [];
  const relativePath = file.split(path.sep).join('/');
  const violations = [];
  for (const match of source.matchAll(
    /(?:\bimport\s+(?:type\s+)?[^'"]*?from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/gu
  )) {
    const specifier = match[1];
    if (BANNED_BOARD_IMPORT_PATTERNS.some((banned) => banned.pattern.test(specifier))) {
      violations.push(`${relativePath}: forbidden runtime import '${specifier}'`);
    } else if (
      BOARD_RUNTIME_IMPORT_PREFIXES.some(
        (prefix) => specifier.startsWith(`${prefix}/`) || specifier === prefix
      )
    ) {
      violations.push(`${relativePath}: forbidden runtime import '${specifier}'`);
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...(await sourceFiles(filePath)));
    } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files;
}

async function main() {
  const violations = [];
  for (const file of await sourceFiles(desktopSourceRoot)) {
    violations.push(...findDesktopNonOverlapViolations(await readFile(file, 'utf8'), file));
  }
  for (const file of await sourceFiles(boardSourceRoot)) {
    violations.push(...findBoardRuntimeImportViolations(await readFile(file, 'utf8'), file));
  }

  if (violations.length > 0) {
    console.error(`Desktop non-overlap check failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    'Desktop non-overlap check passed: apps/desktop defines no ORM models/addons and apps/board imports no desktop/native runtime modules.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
