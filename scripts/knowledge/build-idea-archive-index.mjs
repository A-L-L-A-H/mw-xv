#!/usr/bin/env node
/**
 * Deterministic, read-only machine index for the Total Idea Archive.
 *
 * Scans docs/knowledge/idea-archive/*.md for stable-ID table rows and emits
 * docs/knowledge/idea-archive/INDEX.json. No network, no timestamps, no source
 * bytes are copied: only IDs, titles, status labels and issue references.
 *
 * Usage:
 *   node scripts/knowledge/build-idea-archive-index.mjs            # write
 *   node scripts/knowledge/build-idea-archive-index.mjs --check    # verify
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const archiveDir = path.join(root, 'docs', 'knowledge', 'idea-archive');
const outputFile = path.join(archiveDir, 'INDEX.json');
const checkOnly = process.argv.includes('--check');

const ID_PATTERN = /^((?:IDEA|PRJ|CAN|CHR|FRM|UNR|SRC-LIB|MW-STORY-LEAD)-\d{4})$/;
const NAMESPACE_ORDER = ['IDEA', 'PRJ', 'CAN', 'MW-STORY-LEAD', 'CHR', 'FRM', 'SRC-LIB', 'UNR'];

export function plain(text) {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result.replace(/[<>]/g, '').trim();
}

function parseRow(line) {
  if (!line.startsWith('|')) return null;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length < 3) return null;
  const id = plain(cells[0]).replace(/^\*\*|\*\*$/g, '');
  if (!ID_PATTERN.test(id)) return null;
  return {
    id,
    title: plain(cells[1]),
    source: plain(cells[cells.length - 2]),
    status: plain(cells[cells.length - 1]),
    issues: [...line.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])),
  };
}

function namespaceOf(id) {
  return id.slice(0, id.lastIndexOf('-'));
}

export async function build() {
  const files = (await readdir(archiveDir)).filter((name) => name.endsWith('.md')).sort();
  const byId = new Map();

  function add(record, name) {
    const existing = byId.get(record.id);
    if (existing && existing.file === name) return; // keep first definition in a file
    if (existing) {
      existing.alsoReferencedIn.push(name);
      return;
    }
    byId.set(record.id, {
      ...record,
      namespace: namespaceOf(record.id),
      issues: [...new Set(record.issues)].sort((a, b) => a - b),
      file: name,
      alsoReferencedIn: [],
    });
  }

  for (const name of files) {
    const content = await readFile(path.join(archiveDir, name), 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const row = parseRow(line);
      if (row) add(row, name);
    }

    // Section-style definitions, e.g. "## FRM-0015 — CRAYON Framework v1.3".
    for (let i = 0; i < lines.length; i += 1) {
      const heading =
        /^##\s+((?:IDEA|PRJ|CAN|CHR|FRM|UNR|SRC-LIB|MW-STORY-LEAD)-\d{4})\s+[—-]\s*(.+)$/.exec(
          lines[i]
        );
      if (!heading) continue;
      const section = [];
      for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j]); j += 1)
        section.push(lines[j]);
      const sourceLine = section.find((line) => /^\*\*Source:\*\*/.test(line)) ?? '';
      const statusLine = section.find((line) => /^- Status:/.test(line)) ?? '';
      const issues = [
        ...section
          .slice(0, 6)
          .join('\n')
          .matchAll(/#(\d+)\b/g),
      ].map((m) => Number(m[1]));
      add(
        {
          id: heading[1],
          title: plain(heading[2]),
          status: plain(statusLine.replace(/^- Status:\s*/, '')) || 'SECTION-DEFINED',
          source: plain(sourceLine.replace(/^\*\*Source:\*\*\s*/, '')),
          issues,
        },
        name
      );
    }
  }

  const entries = [...byId.values()].sort((a, b) => {
    const byNamespace = NAMESPACE_ORDER.indexOf(a.namespace) - NAMESPACE_ORDER.indexOf(b.namespace);
    return byNamespace || a.id.localeCompare(b.id, 'en');
  });

  const counts = {};
  for (const entry of entries) counts[entry.namespace] = (counts[entry.namespace] ?? 0) + 1;

  return {
    schemaVersion: 1,
    format: 'moonwitness-idea-archive-index/v1',
    generator: 'scripts/knowledge/build-idea-archive-index.mjs',
    note: 'Navigation index only. Not a task registry, not canon authority, not source bytes.',
    countedFiles: files.length,
    counts,
    entries,
  };
}

async function main() {
  const index = await build();
  const serialized = `${JSON.stringify(index, null, 2)}\n`;

  if (checkOnly) {
    let current;
    try {
      current = await readFile(outputFile, 'utf8');
    } catch {
      process.stderr.write(`Missing generated index: ${path.relative(root, outputFile)}\n`);
      process.exit(1);
    }
    if (current !== serialized) {
      process.stderr.write(
        'Idea archive index differs from deterministic projection. Run the generator without --check.\n'
      );
      process.exit(1);
    }
    process.stdout.write(`Idea archive index is current (${index.entries.length} records).\n`);
  } else {
    await writeFile(outputFile, serialized, 'utf8');
    process.stdout.write(
      `Wrote ${path.relative(root, outputFile)} (${index.entries.length} records).\n`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
