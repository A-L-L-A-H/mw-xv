import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(LAB_DIR, '../../..');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(message);
    console.error(`[FAIL] ${message}`);
  }
}

function walkFiles(dir, extFilter = null) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, extFilter));
    } else if (!extFilter || full.endsWith(extFilter)) {
      results.push(full);
    }
  }
  return results;
}

function validateXmlWellFormed(svgContent, relPath) {
  assert(svgContent.includes('<svg'), `${relPath}: missing <svg root tag`);
  assert(svgContent.includes('</svg>'), `${relPath}: missing </svg> closing tag`);
  assert(
    svgContent.includes('viewBox="0 0 960 540"'),
    `${relPath}: missing viewBox="0 0 960 540"`
  );
  assert(!/<script\b/i.test(svgContent), `${relPath}: contains prohibited <script> tag`);

  // Remove comments, XML declaration, doctype, and CDATA before checking entities and balancing tags
  const cleaned = svgContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  // Check for unescaped ampersands outside XML comments
  const badAmp = cleaned.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  assert(!badAmp, `${relPath}: contains unescaped '&' character`);

  const tagRegex = /<\/?([a-zA-Z0-9:_-]+)(?:\s[^<>]*?)?(\/?)>/g;
  const stack = [];
  let match;
  let tagError = null;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    const selfClosing = match[2] === '/';
    const isClosing = fullTag.startsWith('</');

    if (selfClosing) continue;
    if (isClosing) {
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        tagError = `mismatched closing tag </${tagName}> (expected </${stack[stack.length - 1] || 'NONE'}>)`;
        break;
      }
      stack.pop();
    } else {
      stack.push(tagName);
    }
  }
  if (!tagError && stack.length > 0) {
    tagError = `unclosed tags remaining: ${stack.join(', ')}`;
  }
  assert(!tagError, `${relPath}: XML tag balance check failed (${tagError})`);
}

function extractGeometryFingerprint(svgContent) {
  return svgContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 1. Validate all SVGs under LAB_DIR
const svgFiles = walkFiles(LAB_DIR, '.svg');
assert(svgFiles.length >= 31, `Expected at least 31 SVG files in lab, found ${svgFiles.length}`);

for (const svgPath of svgFiles) {
  const relPath = path.relative(LAB_DIR, svgPath).replace(/\\/g, '/');
  const content = fs.readFileSync(svgPath, 'utf8');
  validateXmlWellFormed(content, relPath);

  // Verify NO dialogue/caption sentences are baked as <text> elements inside animation frame SVGs
  if (relPath.startsWith('animations/anim-') && /frame-\d+\.svg$/.test(relPath)) {
    const textMatches = [...content.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)];
    for (const tm of textMatches) {
      const innerText = tm[1].replace(/<[^>]+>/g, '').trim();
      const words = innerText.split(/\s+/).filter(Boolean);
      assert(
        words.length <= 3,
        `${relPath}: animation frame SVG contains baked sentence in <text>: "${innerText}"`
      );
    }
  }
}

// 2. Verify frame-to-frame uniqueness across the 4 clips and total frames >= 25
const clipDirs = [
  'animations/anim-a-signal-detected',
  'animations/anim-b-courier-move',
  'animations/anim-c-archive-reaction',
  'animations/anim-d-message-preserved',
];

let totalAnimationFrames = 0;

for (const clipDir of clipDirs) {
  const fullClipDir = path.join(LAB_DIR, clipDir);
  const frameFiles = fs
    .readdirSync(fullClipDir)
    .filter((f) => /^frame-\d+\.svg$/.test(f))
    .sort();

  assert(frameFiles.length >= 6, `${clipDir}: expected >= 6 frames, found ${frameFiles.length}`);
  totalAnimationFrames += frameFiles.length;

  let prevFingerprint = null;
  let prevPathData = null;

  for (const frameFile of frameFiles) {
    const fullFramePath = path.join(fullClipDir, frameFile);
    const content = fs.readFileSync(fullFramePath, 'utf8');
    const fp = extractGeometryFingerprint(content);

    // Extract all d="..." and points="..." attributes to ensure real geometry difference
    const geomAttrs = [
      ...[...content.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]),
      ...[...content.matchAll(/\bpoints="([^"]+)"/g)].map((m) => m[1]),
      ...[...content.matchAll(/\b(?:cx|cy|r|x1|y1|x2|y2|width|height)="([^"]+)"/g)].map((m) => m[1]),
    ].join('|');

    if (prevFingerprint !== null) {
      assert(
        fp !== prevFingerprint,
        `${clipDir}/${frameFile}: identical SVG content to previous frame`
      );
      assert(
        geomAttrs !== prevPathData,
        `${clipDir}/${frameFile}: geometry attributes identical to previous frame (clone/translate wrapper)`
      );
    }
    prevFingerprint = fp;
    prevPathData = geomAttrs;
  }
}

assert(
  totalAnimationFrames >= 25,
  `Expected total animation frames >= 25 across 4 clips, found ${totalAnimationFrames}`
);

// 3. Validate data/storyboard.json
const storyboardPath = path.join(LAB_DIR, 'data/storyboard.json');
assert(fs.existsSync(storyboardPath), 'data/storyboard.json exists');
const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));

assert(
  storyboard.status === 'experimental-candidate',
  `storyboard.json: status must be "experimental-candidate", got "${storyboard.status}"`
);
assert(
  storyboard.totalDurationMs === 14400,
  `storyboard.json: totalDurationMs must be 14400, got ${storyboard.totalDurationMs}`
);
assert(
  Array.isArray(storyboard.panels) && storyboard.panels.length === 12,
  `storyboard.json: must have 12 panels, got ${storyboard.panels?.length}`
);

const requiredPanelFields = [
  'panelId',
  'sceneId',
  'shotType',
  'characterPosition',
  'composition',
  'visualAction',
  'actingIntent',
  'expressionPoseRef',
  'motionDirection',
  'timingMs',
  'transition',
  'fx',
  'caption',
  'narrativePurpose',
  'staticFallbackAsset',
  'reducedMotionNote',
];

let timingSum = 0;
storyboard.panels.forEach((panel, idx) => {
  const expectedId = `P${String(idx + 1).padStart(2, '0')}`;
  assert(
    panel.panelId === expectedId,
    `storyboard.json panel[${idx}]: expected panelId "${expectedId}", got "${panel.panelId}"`
  );
  for (const field of requiredPanelFields) {
    assert(
      panel[field] !== undefined && panel[field] !== null && panel[field] !== '',
      `storyboard.json ${panel.panelId}: missing required field "${field}"`
    );
  }
  timingSum += Number(panel.timingMs || 0);
});

assert(
  timingSum === 14400,
  `storyboard.json: sum of panel timingMs must equal 14400, got ${timingSum}`
);

// 4. Validate all 4 animations/*/clip.json
const requiredClipFields = [
  'schemaVersion',
  'clipId',
  'beatId',
  'totalDurationMs',
  'pivot',
  'motionDescription',
  'fallbackPose',
  'reducedMotionAlternative',
  'frames',
];

for (const clipDir of clipDirs) {
  const clipJsonPath = path.join(LAB_DIR, clipDir, 'clip.json');
  assert(fs.existsSync(clipJsonPath), `${clipDir}/clip.json exists`);
  const clip = JSON.parse(fs.readFileSync(clipJsonPath, 'utf8'));
  for (const field of requiredClipFields) {
    assert(
      clip[field] !== undefined && clip[field] !== null,
      `${clipDir}/clip.json: missing required field "${field}"`
    );
  }
  assert(
    Array.isArray(clip.frames) && clip.frames.length >= 6,
    `${clipDir}/clip.json: frames must be an array with >= 6 items`
  );
  for (const frame of clip.frames) {
    assert(
      frame.frameId && frame.asset && typeof frame.durationMs === 'number' && frame.durationMs > 0,
      `${clipDir}/clip.json: invalid frame entry ${JSON.stringify(frame)}`
    );
  }
}

// 5. Validate all 6 provenance.json files
const provenanceRelPaths = [
  'animations/anim-a-signal-detected/provenance.json',
  'animations/anim-b-courier-move/provenance.json',
  'animations/anim-c-archive-reaction/provenance.json',
  'animations/anim-d-message-preserved/provenance.json',
  'animations/shared-props/provenance.json',
  'animations/comic-overlays/provenance.json',
];

const requiredProvenanceFields = [
  'assetId',
  'characterId',
  'sourceOrReference',
  'creatorOrGenerator',
  'creationMethod',
  'licenseStatus',
  'sourceDerivativeRelationship',
  'reviewState',
  'intendedUsage',
];

let totalProvenanceRecords = 0;
for (const provRel of provenanceRelPaths) {
  const provPath = path.join(LAB_DIR, provRel);
  assert(fs.existsSync(provPath), `${provRel} exists`);
  const records = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  assert(Array.isArray(records) && records.length > 0, `${provRel}: must be a non-empty array`);
  records.forEach((rec, idx) => {
    totalProvenanceRecords += 1;
    for (const field of requiredProvenanceFields) {
      assert(
        typeof rec[field] === 'string' && rec[field].trim().length > 0,
        `${provRel}[${idx}]: missing or empty "${field}"`
      );
    }
    assert(
      rec.reviewState === 'experimental-candidate-unapproved',
      `${provRel}[${idx}]: reviewState must be "experimental-candidate-unapproved", got "${rec.reviewState}"`
    );
  });
}

// 6. Validate data/proposed-character-candidate.json
const candidatePath = path.join(LAB_DIR, 'data/proposed-character-candidate.json');
assert(fs.existsSync(candidatePath), 'data/proposed-character-candidate.json exists');
const candidateRaw = fs.readFileSync(candidatePath, 'utf8');
const candidate = JSON.parse(candidateRaw);

assert(
  typeof candidate.status === 'string' &&
    /experimental|proposed/i.test(candidate.status),
  `proposed-character-candidate.json: status must include experimental/proposed, got "${candidate.status}"`
);
assert(
  !/CHR-\d{4}/.test(candidateRaw),
  'proposed-character-candidate.json: must NOT contain any canonical CHR-#### identifier'
);

// 7. Resolve EVERY relative path referenced in index.html, styles.css, app.js, manifest.json, storyboard.json, and all clip.json files
const resolvedCheckedPaths = new Set();

function checkDiskPath(relRef, baseDir, contextLabel) {
  if (!relRef || typeof relRef !== 'string') return;
  const cleaned = relRef.split('?')[0].split('#')[0].trim();
  if (!cleaned || cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('data:')) {
    return;
  }
  // Handle descriptions like "animations/anim-a-signal-detected/frame-01.svg (rooftop idle lean)"
  const pathToken = cleaned.split(/\s+/)[0];
  const targetPath = path.resolve(baseDir, pathToken);
  resolvedCheckedPaths.add(targetPath);
  assert(
    fs.existsSync(targetPath),
    `${contextLabel}: referenced path "${pathToken}" does not exist on disk (resolved: ${targetPath})`
  );
}

// manifest.json
const manifestPath = path.join(LAB_DIR, 'data/manifest.json');
assert(fs.existsSync(manifestPath), 'data/manifest.json exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
checkDiskPath(manifest.entrypoint, LAB_DIR, 'manifest.json:entrypoint');
checkDiskPath(manifest.storyboard, LAB_DIR, 'manifest.json:storyboard');
checkDiskPath(manifest.proposedCandidate, LAB_DIR, 'manifest.json:proposedCandidate');
(manifest.clips || []).forEach((p) => checkDiskPath(p, LAB_DIR, 'manifest.json:clips'));
(manifest.provenanceFiles || []).forEach((p) => checkDiskPath(p, LAB_DIR, 'manifest.json:provenanceFiles'));
(manifest.approvedReferences || []).forEach((p) => checkDiskPath(p, LAB_DIR, 'manifest.json:approvedReferences'));

// storyboard.json references
(storyboard.cast || []).forEach((member) => {
  checkDiskPath(member.registryRef, LAB_DIR, `storyboard.json:cast:${member.characterId}:registryRef`);
  (member.visualReferences || []).forEach((ref) =>
    checkDiskPath(ref, LAB_DIR, `storyboard.json:cast:${member.characterId}:visualReferences`)
  );
});
storyboard.panels.forEach((panel) => {
  if (panel.clipPath) checkDiskPath(panel.clipPath, LAB_DIR, `storyboard.json:${panel.panelId}:clipPath`);
  if (panel.expressionPoseRef)
    checkDiskPath(panel.expressionPoseRef, LAB_DIR, `storyboard.json:${panel.panelId}:expressionPoseRef`);
  if (panel.foregroundAsset)
    checkDiskPath(panel.foregroundAsset, LAB_DIR, `storyboard.json:${panel.panelId}:foregroundAsset`);
  if (panel.staticFallbackAsset)
    checkDiskPath(panel.staticFallbackAsset, LAB_DIR, `storyboard.json:${panel.panelId}:staticFallbackAsset`);
  (panel.backdropLayers || []).forEach((layer) => {
    const src = typeof layer === 'string' ? layer : layer?.asset;
    checkDiskPath(src, LAB_DIR, `storyboard.json:${panel.panelId}:backdropLayers`);
  });
});

// clip.json references
for (const clipDir of clipDirs) {
  const clipJsonPath = path.join(LAB_DIR, clipDir, 'clip.json');
  const clip = JSON.parse(fs.readFileSync(clipJsonPath, 'utf8'));
  checkDiskPath(clip.fallbackPose, LAB_DIR, `${clipDir}/clip.json:fallbackPose`);
  if (clip.reducedMotionAlternative?.asset) {
    checkDiskPath(
      clip.reducedMotionAlternative.asset,
      LAB_DIR,
      `${clipDir}/clip.json:reducedMotionAlternative.asset`
    );
  }
  for (const frame of clip.frames) {
    checkDiskPath(frame.asset, LAB_DIR, `${clipDir}/clip.json:${frame.frameId}`);
  }
}

// index.html references
const indexHtml = fs.readFileSync(path.join(LAB_DIR, 'index.html'), 'utf8');
for (const match of indexHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const ref = match[1];
  if (!ref.startsWith('#') && ref !== '') {
    checkDiskPath(ref, LAB_DIR, 'index.html');
  }
}

// styles.css url(...) references
const stylesCss = fs.readFileSync(path.join(LAB_DIR, 'styles.css'), 'utf8');
for (const match of stylesCss.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
  checkDiskPath(match[1], LAB_DIR, 'styles.css');
}

// app.js fetch('./...') references
const appJs = fs.readFileSync(path.join(LAB_DIR, 'app.js'), 'utf8');
for (const match of appJs.matchAll(/fetch\(['"]([^'"]+)['"]\)/g)) {
  checkDiskPath(match[1], LAB_DIR, 'app.js');
}

// 8. Check git status --short for prohibited files or out-of-scope changes
const gitStatusOutput = execSync('git status --short -uall', { cwd: REPO_ROOT, encoding: 'utf8' });
const statusLines = gitStatusOutput
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

// Verify no prohibited paths inside docs/creative-labs/ or newly untracked prohibited dirs
for (const line of statusLines) {
  const filePart = line.slice(2).trim().replace(/^"|"$/g, '');
  assert(
    !filePart.startsWith('docs/creative-labs/') ||
      filePart.startsWith('docs/creative-labs/moonwitness-animated-comic/'),
    `git status: unexpected creative-labs path modified outside moonwitness-animated-comic: ${filePart}`
  );
}

console.log(
  JSON.stringify(
    {
      status: failCount === 0 ? 'PASSED' : 'FAILED',
      passCount,
      failCount,
      svgCount: svgFiles.length,
      totalAnimationFrames,
      panelCount: storyboard.panels.length,
      totalDurationMs: timingSum,
      provenanceRecords: totalProvenanceRecords,
      resolvedPathsCount: resolvedCheckedPaths.size,
      failures,
    },
    null,
    2
  )
);

if (failCount > 0) {
  process.exit(1);
}
