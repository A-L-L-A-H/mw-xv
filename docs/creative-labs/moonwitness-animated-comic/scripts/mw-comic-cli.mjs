import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMANDS = {
  'build-bundle': 'build-inline-bundle.mjs',
  'validate': 'validate-lab.mjs',
  'check-canon': 'check-canon-guardrails.mjs',
  'verify': 'playwright-verify.mjs',
  'export-pdf': 'export-print-zine.mjs',
  'export-social': 'export-social-cards.mjs',
  'export-reels': 'export-reels-9x16.mjs',
  'slice-sheets': 'slice-sheets.mjs',
};

const cmd = process.argv[2];
if (!cmd || cmd === 'help' || !COMMANDS[cmd]) {
  console.log('MoonWitness Comic Lab CLI — commands:', Object.keys(COMMANDS).join(', '));
  process.exit(cmd === 'help' ? 0 : 1);
}

const scriptPath = path.join(__dirname, COMMANDS[cmd]);
const res = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
