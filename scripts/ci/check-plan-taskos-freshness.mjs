import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();
const planDir = path.join(repoRoot, '.plan', 'sovereign-empire-v2');

console.log('Checking PlanTaskOS freshness for sovereign-empire-v2...');

if (!fs.existsSync(planDir)) {
  console.error('Missing .plan/sovereign-empire-v2 directory');
  process.exit(1);
}

const manifestPath = path.join(planDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Missing manifest.json');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.plan_id !== 'sovereign-empire-v2') {
  console.error(`Invalid plan_id: ${manifest.plan_id}`);
  process.exit(1);
}

for (const wave of manifest.waves) {
  const waveFile = path.join(repoRoot, wave.wave_file);
  const specFile = path.join(repoRoot, wave.spec_file);

  if (!fs.existsSync(waveFile)) {
    console.error(`Missing wave file: ${wave.wave_file}`);
    process.exit(1);
  }
  if (!fs.existsSync(specFile)) {
    console.error(`Missing spec file: ${wave.spec_file}`);
    process.exit(1);
  }
}

try {
  execSync('node packages/plan-taskos/dist/cli.js lint', { stdio: 'inherit' });
} catch {
  console.error('PlanTaskOS lint failed');
  process.exit(1);
}

console.log('PlanTaskOS sovereign-empire-v2 freshness verified 100% clean.');
