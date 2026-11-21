import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseCliArgs(argv) {
  const parsed = { file: path.join(defaultRoot, '.agents/rules/learned-invariants.md') };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const val = argv[i + 1];
    if (val === undefined) throw new Error(`Missing value for ${flag}`);
    i += 1;
    if (flag === '--id') parsed.id = val;
    else if (flag === '--title') parsed.title = val;
    else if (flag === '--symptom') parsed.symptom = val;
    else if (flag === '--root-cause') parsed.rootCause = val;
    else if (flag === '--invariant') parsed.invariant = val;
    else if (flag === '--file') parsed.file = path.resolve(val);
  }
  return parsed;
}

/**
 * Records a structured post-mortem rule entry into learned-invariants markdown with ID deduplication.
 */
export async function recordPostmortem(options) {
  const id = String(options.id ?? '').trim();
  const title = String(options.title ?? id).trim();
  const symptom = String(options.symptom ?? '').trim();
  const rootCause = String(options.rootCause ?? '').trim();
  const invariant = String(options.invariant ?? '').trim();
  const targetFile = options.file ?? path.join(defaultRoot, '.agents/rules/learned-invariants.md');

  if (!id || !symptom || !rootCause || !invariant) {
    throw new Error('Required fields: --id, --symptom, --root-cause, --invariant');
  }

  await mkdir(path.dirname(targetFile), { recursive: true });
  const existing = existsSync(targetFile)
    ? await readFile(targetFile, 'utf8')
    : '# Learned Repository Invariants\n';
  if (new RegExp(`^##\\s+${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:`, 'mu').test(existing)) {
    return { recorded: false, reason: 'duplicate_id', id, file: targetFile };
  }

  const block = [
    '',
    `## ${id}: ${title}`,
    `- **Symptom**: ${symptom}`,
    `- **Root Cause**: ${rootCause}`,
    `- **Invariant**: ${invariant}`,
    '',
  ].join('\n');

  await appendFile(targetFile, block, 'utf8');
  return { recorded: true, id, file: targetFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliArgs(process.argv.slice(2));
  const outcome = await recordPostmortem(options);
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}
