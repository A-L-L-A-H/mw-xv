import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SENSITIVE_KEY_PATTERN =
  /^(email|phone|mobile|token|secret|password|authorization|cookie|jid|api_?key)$/iu;

function scrubText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]')
    .replace(/\b\d{7,15}@s\.whatsapp\.net\b/giu, '[REDACTED_JID]')
    .replace(/\+?\d[\d\s-]{7,15}\d/gu, '[REDACTED_PHONE]');
}

function sanitizeEventValue(value, stats) {
  if (typeof value === 'string') {
    const scrubbed = scrubText(value);
    if (scrubbed !== value) stats.scrubbedFieldsCount += 1;
    return scrubbed;
  }
  if (Array.isArray(value)) {
    return value.map((element) => sanitizeEventValue(element, stats));
  }
  if (typeof value === 'object' && value !== null) {
    const output = {};
    for (const [key, propVal] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        stats.scrubbedFieldsCount += 1;
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeEventValue(propVal, stats);
      }
    }
    return output;
  }
  return value;
}

/**
 * Aggregates local operational friction signals into sanitized backlog candidates with strict
 * PII/secret removal.
 */
export async function collectSanitizedSignals(options = {}) {
  const repositoryRoot = options.repositoryRoot
    ? path.resolve(options.repositoryRoot)
    : defaultRoot;
  let rawEvents = Array.isArray(options.events) ? options.events : undefined;

  if (!rawEvents) {
    const candidateFile =
      options.inputFile ?? path.join(repositoryRoot, 'evolution/signals-sample.json');
    if (existsSync(candidateFile)) {
      const parsed = JSON.parse(await readFile(candidateFile, 'utf8'));
      rawEvents = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
    } else {
      rawEvents = [];
    }
  }

  const stats = { scrubbedFieldsCount: 0 };
  const sanitizedSignals = rawEvents.map((event) => sanitizeEventValue(event, stats));
  const countsByRoute = new Map();
  for (const sig of sanitizedSignals) {
    if (!sig || typeof sig !== 'object') continue;
    const key = `${String(sig.route ?? 'unknown')}|${String(sig.category ?? 'general')}`;
    countsByRoute.set(key, (countsByRoute.get(key) ?? 0) + 1);
  }

  const candidates = Array.from(countsByRoute.entries())
    .map(([compound, count]) => {
      const [route, category] = compound.split('|');
      return { route, category, occurrences: count };
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.route.localeCompare(b.route));

  return {
    format: 'moonwitness-evolution-signals/v1',
    collectedAt: new Date().toISOString(),
    totalSignals: sanitizedSignals.length,
    scrubbedFieldsCount: stats.scrubbedFieldsCount,
    candidates,
    signals: sanitizedSignals,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let inputFile;
  const idx = process.argv.indexOf('--input');
  if (idx !== -1 && process.argv[idx + 1]) {
    inputFile = path.resolve(process.argv[idx + 1]);
  }
  const report = await collectSanitizedSignals({ inputFile });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
