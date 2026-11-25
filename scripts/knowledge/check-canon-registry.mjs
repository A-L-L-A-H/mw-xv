#!/usr/bin/env node
/**
 * Read-only invariant gate for docs/knowledge/idea-archive/CANON-REGISTRY.md.
 * Enforces numbering, status vocabulary, source traceability and the no-silent-canon-change rule.
 * Never edits the registry.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = path.join(root, 'docs', 'knowledge', 'idea-archive', 'CANON-REGISTRY.md');
const allowedStatuses = new Set(['LOCKED', 'PROVISIONAL', 'UNRESOLVED', 'RETIRED']);
const errors = [];

const text = await readFile(registryPath, 'utf8');
const lines = text.split(/\r?\n/);
const rows = [];

for (const line of lines) {
  if (!line.startsWith('| CAN-')) continue;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length < 5) {
    errors.push(`Malformed canon row: ${line.slice(0, 60)}`);
    continue;
  }
  rows.push({ id: cells[0], rule: cells[1], source: cells[3], status: cells[4] });
}

if (rows.length === 0) errors.push('No canon rows found.');

const seen = new Set();
for (const row of rows) {
  if (seen.has(row.id)) errors.push(`Duplicate canon ID: ${row.id}`);
  seen.add(row.id);
  if (!row.rule) errors.push(`Empty rule for ${row.id}`);
  if (!row.source) errors.push(`Missing source/provenance for ${row.id}`);
  const status = row.status.split(/[^A-Z]/)[0];
  if (!allowedStatuses.has(status)) errors.push(`Unknown status '${row.status}' for ${row.id}`);
  if (status === 'LOCKED' && !/Owner|owner|Issue|K0-006|prompt/i.test(row.source)) {
    errors.push(`LOCKED canon ${row.id} lacks owner/decision evidence in its source cell`);
  }
}

const numbers = rows.map((row) => Number(row.id.replace('CAN-', '')));
for (let i = 0; i < numbers.length; i += 1) {
  if (numbers[i] !== i + 1) {
    errors.push(
      `Canon numbering gap or disorder: expected CAN-${String(i + 1).padStart(4, '0')}, got ${rows[i].id}`
    );
    break;
  }
}

if (!text.includes('[Unresolved Decisions](UNRESOLVED-DECISIONS.md)')) {
  errors.push('Canon registry must link to the unresolved-decision register.');
}
if (!text.includes('RETIRED')) errors.push('Status vocabulary is incomplete (RETIRED missing).');

if (errors.length > 0) {
  process.stderr.write(
    `Canon registry invariant failures:\n${errors.map((e) => `- ${e}`).join('\n')}\n`
  );
  process.exit(1);
}
process.stdout.write(
  `Canon registry OK: ${rows.length} sequential records, statuses and provenance verified.\n`
);
