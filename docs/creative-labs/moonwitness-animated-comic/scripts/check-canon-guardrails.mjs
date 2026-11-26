import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const errors = [];

function check(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    errors.push(msg);
    console.error(`[GUARDRAIL FAIL] ${msg}`);
  }
}

// 1. Candidate record must NEVER assign a canonical CHR-#### ID
const candRaw = fs.readFileSync(path.join(LAB_DIR, 'data/proposed-character-candidate.json'), 'utf8');
check(!/\bCHR-\d{4}\b/.test(candRaw), 'proposed-character-candidate.json must not contain canonical CHR-#### ID');
const cand = JSON.parse(candRaw);
check(cand.humanReviewRequired === true, 'proposed-character-candidate.json must require humanReviewRequired: true');
check(cand.canonicalIdAssigned === null, 'proposed-character-candidate.json must have canonicalIdAssigned: null');

// 2. All provenance sidecars must stay experimental-candidate-unapproved
const provDirs = [
  'animations/anim-a-signal-detected',
  'animations/anim-b-courier-move',
  'animations/anim-c-archive-reaction',
  'animations/anim-d-message-preserved',
  'animations/shared-props',
  'animations/comic-overlays',
];
for (const dir of provDirs) {
  const recs = JSON.parse(fs.readFileSync(path.join(LAB_DIR, dir, 'provenance.json'), 'utf8'));
  for (const r of recs) {
    check(
      r.reviewState === 'experimental-candidate-unapproved',
      `${dir}/provenance.json (${r.assetId}) must remain experimental-candidate-unapproved`
    );
  }
}

// 3. Gap matrix must cover all 19 historical CHR-0001..CHR-0019 records
const gapMd = fs.readFileSync(path.join(LAB_DIR, 'docs/CHARACTER_GAP_RESEARCH.md'), 'utf8');
for (let i = 1; i <= 19; i += 1) {
  const id = `CHR-${String(i).padStart(4, '0')}`;
  check(gapMd.includes(id), `CHARACTER_GAP_RESEARCH.md missing historical record ${id}`);
}

// 4. Storyboard must explicitly declare experimental-candidate & non-transcript disclaimer
const sb = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'data/storyboard.json'), 'utf8'));
check(sb.status === 'experimental-candidate', 'storyboard.json must declare experimental-candidate');
check(/NOT a recovered historical transcript/i.test(sb.editorialDisclaimer || ''), 'storyboard.json must retain non-transcript disclaimer');

console.log(JSON.stringify({ status: failed === 0 ? 'PASSED' : 'FAILED', passed, failed, errors }, null, 2));
if (failed > 0) process.exit(1);
