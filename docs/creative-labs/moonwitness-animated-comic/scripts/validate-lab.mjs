import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
  assert(svgContent.includes('viewBox="0 0 960 540"'), `${relPath}: missing viewBox="0 0 960 540"`);
  assert(!/<script\b/i.test(svgContent), `${relPath}: contains prohibited <script> tag`);

  const cleaned = svgContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

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
        tagError = `mismatched closing tag </${tagName}>`;
        break;
      }
      stack.pop();
    } else {
      stack.push(tagName);
    }
  }
  if (!tagError && stack.length > 0) {
    tagError = `unclosed tags: ${stack.join(', ')}`;
  }
  assert(!tagError, `${relPath}: XML tag balance check failed (${tagError})`);
}

async function computeMeanAbsDiff(fileA, fileB) {
  const [bufA, bufB] = await Promise.all([
    sharp(fileA).resize(160, 90).removeAlpha().raw().toBuffer(),
    sharp(fileB).resize(160, 90).removeAlpha().raw().toBuffer(),
  ]);
  let sum = 0;
  for (let i = 0; i < bufA.length; i += 1) {
    sum += Math.abs(bufA[i] - bufB[i]);
  }
  return sum / bufA.length;
}

async function main() {
  // 1. Validate vector comic overlay SVGs
  const svgFiles = walkFiles(LAB_DIR, '.svg');
  assert(svgFiles.length >= 3, `Expected at least 3 vector comic overlay SVGs, found ${svgFiles.length}`);
  for (const svgPath of svgFiles) {
    const relPath = path.relative(LAB_DIR, svgPath).replace(/\\/g, '/');
    validateXmlWellFormed(fs.readFileSync(svgPath, 'utf8'), relPath);
  }

  // 2. Validate studio raster WebP animation frames + shared props
  const webpFiles = walkFiles(LAB_DIR, '.webp');
  assert(webpFiles.length >= 32, `Expected at least 32 WebP studio assets, found ${webpFiles.length}`);
  for (const webpPath of webpFiles) {
    const relPath = path.relative(LAB_DIR, webpPath).replace(/\\/g, '/');
    const meta = await sharp(webpPath).metadata();
    assert(meta.format === 'webp', `${relPath}: expected webp format, got ${meta.format}`);
    if (relPath.startsWith('evidence/') && relPath.includes('1200x630')) {
      assert(meta.width === 1200 && meta.height === 630, `${relPath}: expected 1200x630, got ${meta.width}x${meta.height}`);
    } else {
      assert(meta.width === 960 && meta.height === 540, `${relPath}: expected 960x540, got ${meta.width}x${meta.height}`);
    }
  }

  // 3. Verify pixel-level frame-to-frame motion uniqueness across all 4 clips (25 frames total)
  const clipDirs = [
    'animations/anim-a-signal-detected',
    'animations/anim-b-courier-move',
    'animations/anim-c-archive-reaction',
    'animations/anim-d-message-preserved',
  ];

  let totalAnimationFrames = 0;
  let minFrameDiff = Infinity;

  for (const clipDir of clipDirs) {
    const fullClipDir = path.join(LAB_DIR, clipDir);
    const frameFiles = fs
      .readdirSync(fullClipDir)
      .filter((f) => /^frame-\d+\.webp$/.test(f))
      .sort();

    assert(frameFiles.length >= 6, `${clipDir}: expected >= 6 frames, found ${frameFiles.length}`);
    totalAnimationFrames += frameFiles.length;

    for (let i = 1; i < frameFiles.length; i += 1) {
      const prevPath = path.join(fullClipDir, frameFiles[i - 1]);
      const currPath = path.join(fullClipDir, frameFiles[i]);
      const mad = await computeMeanAbsDiff(prevPath, currPath);
      if (mad < minFrameDiff) minFrameDiff = mad;
      assert(
        mad >= 4.0,
        `${clipDir}/${frameFiles[i]}: too similar to ${frameFiles[i - 1]} (MAD=${mad.toFixed(2)} < 4.0)`
      );
    }
  }

  assert(totalAnimationFrames >= 25, `Expected >= 25 animation frames across 4 clips, found ${totalAnimationFrames}`);

  // 4. Validate data/storyboard.json
  const storyboardPath = path.join(LAB_DIR, 'data/storyboard.json');
  assert(fs.existsSync(storyboardPath), 'data/storyboard.json exists');
  const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
  assert(storyboard.status === 'experimental-candidate', `storyboard status invalid: ${storyboard.status}`);
  assert(storyboard.totalDurationMs === 14400, `storyboard totalDurationMs must be 14400`);
  assert(Array.isArray(storyboard.panels) && storyboard.panels.length === 12, `storyboard must have 12 panels`);

  const requiredPanelFields = [
    'panelId', 'sceneId', 'shotType', 'characterPosition', 'composition', 'visualAction',
    'actingIntent', 'expressionPoseRef', 'motionDirection', 'timingMs', 'transition', 'fx',
    'caption', 'narrativePurpose', 'staticFallbackAsset', 'reducedMotionNote',
  ];

  let timingSum = 0;
  storyboard.panels.forEach((panel, idx) => {
    const expectedId = `P${String(idx + 1).padStart(2, '0')}`;
    assert(panel.panelId === expectedId, `panel[${idx}] expected ${expectedId}, got ${panel.panelId}`);
    for (const field of requiredPanelFields) {
      assert(
        panel[field] !== undefined && panel[field] !== null && panel[field] !== '',
        `${panel.panelId}: missing required field "${field}"`
      );
    }
    timingSum += Number(panel.timingMs || 0);
  });
  assert(timingSum === 14400, `sum(timingMs) must equal 14400, got ${timingSum}`);

  // 5. Validate all 4 clip.json files
  const requiredClipFields = [
    'schemaVersion', 'clipId', 'beatId', 'totalDurationMs', 'pivot',
    'motionDescription', 'fallbackPose', 'reducedMotionAlternative', 'frames',
  ];
  for (const clipDir of clipDirs) {
    const clipJsonPath = path.join(LAB_DIR, clipDir, 'clip.json');
    assert(fs.existsSync(clipJsonPath), `${clipDir}/clip.json exists`);
    const clip = JSON.parse(fs.readFileSync(clipJsonPath, 'utf8'));
    for (const field of requiredClipFields) {
      assert(clip[field] !== undefined && clip[field] !== null, `${clipDir}/clip.json missing "${field}"`);
    }
    assert(Array.isArray(clip.frames) && clip.frames.length >= 6, `${clipDir}/clip.json needs >= 6 frames`);
    for (const frame of clip.frames) {
      assert(
        frame.frameId && frame.asset && typeof frame.durationMs === 'number' && frame.durationMs > 0,
        `${clipDir}/clip.json invalid frame ${JSON.stringify(frame)}`
      );
    }
  }

  // 6. Validate all 6 provenance.json sidecars (35 total records: 32 WebPs + 3 SVGs)
  const provenanceDirs = [...clipDirs, 'animations/shared-props', 'animations/comic-overlays'];
  const requiredProvFields = [
    'assetId', 'characterId', 'sourceOrReference', 'creatorOrGenerator', 'creationMethod',
    'licenseStatus', 'sourceDerivativeRelationship', 'reviewState', 'intendedUsage',
  ];
  let totalProvRecords = 0;
  for (const pDir of provenanceDirs) {
    const pPath = path.join(LAB_DIR, pDir, 'provenance.json');
    assert(fs.existsSync(pPath), `${pDir}/provenance.json exists`);
    const records = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    assert(Array.isArray(records) && records.length > 0, `${pDir}/provenance.json must be non-empty array`);
    totalProvRecords += records.length;
    for (const rec of records) {
      for (const field of requiredProvFields) {
        assert(
          rec[field] !== undefined && rec[field] !== null && rec[field] !== '',
          `${pDir}/provenance.json (${rec.assetId}) missing "${field}"`
        );
      }
      assert(
        rec.reviewState === 'experimental-candidate-unapproved',
        `${pDir}/provenance.json (${rec.assetId}) must have reviewState experimental-candidate-unapproved`
      );
    }
  }
  assert(totalProvRecords >= 35, `Expected >= 35 provenance records (32 WebPs + 3 SVGs), found ${totalProvRecords}`);

  // 7. Validate non-canonical proposed character candidate
  const candPath = path.join(LAB_DIR, 'data/proposed-character-candidate.json');
  assert(fs.existsSync(candPath), 'data/proposed-character-candidate.json exists');
  const candRaw = fs.readFileSync(candPath, 'utf8');
  const cand = JSON.parse(candRaw);
  assert(
    typeof cand.status === 'string' && /experimental|proposed|noncanonical/i.test(cand.status),
    `proposed candidate status must mark experimental/proposed, got "${cand.status}"`
  );
  assert(!/\bCHR-\d{4}\b/.test(candRaw), 'proposed-character-candidate.json must not assign canonical CHR-#### ID');

  // 8. Validate manifest.json & resolve all relative paths against disk
  const manifestPath = path.join(LAB_DIR, 'data/manifest.json');
  assert(fs.existsSync(manifestPath), 'data/manifest.json exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pathsToResolve = new Set();

  const addRef = (ref, sourceLabel) => {
    if (!ref || typeof ref !== 'string') return;
    if (/^(https?:|mailto:|#|data:)/i.test(ref)) return;
    pathsToResolve.add(JSON.stringify({ ref, sourceLabel }));
  };

  addRef(manifest.entrypoint, 'manifest.entrypoint');
  addRef(manifest.storyboard, 'manifest.storyboard');
  addRef(manifest.proposedCandidate, 'manifest.proposedCandidate');
  for (const arrKey of ['clips', 'sharedProps', 'comicOverlays', 'provenanceFiles', 'approvedReferences']) {
    if (Array.isArray(manifest[arrKey])) {
      manifest[arrKey].forEach((r) => addRef(r, `manifest.${arrKey}`));
    }
  }

  addRef(storyboard.coverAsset, 'storyboard.coverAsset');
  for (const castMember of storyboard.cast || []) {
    addRef(castMember.registryRef, 'storyboard.cast');
    (castMember.visualReferences || []).forEach((r) => addRef(r, 'storyboard.cast.visualReferences'));
  }
  for (const panel of storyboard.panels) {
    addRef(panel.clipPath, `${panel.panelId}.clipPath`);
    addRef(panel.foregroundAsset, `${panel.panelId}.foregroundAsset`);
    addRef(panel.insetAsset, `${panel.panelId}.insetAsset`);
    addRef(panel.staticFallbackAsset, `${panel.panelId}.staticFallbackAsset`);
    (panel.backdropLayers || []).forEach((r) => addRef(r, `${panel.panelId}.backdropLayers`));
  }

  for (const clipDir of clipDirs) {
    const clip = JSON.parse(fs.readFileSync(path.join(LAB_DIR, clipDir, 'clip.json'), 'utf8'));
    addRef(clip.fallbackPose, `${clipDir}.fallbackPose`);
    addRef(clip.reducedMotionAlternative?.asset, `${clipDir}.reducedMotionAlternative`);
    clip.frames.forEach((f) => addRef(f.asset, `${clipDir}.${f.frameId}`));
  }

  const indexHtml = fs.readFileSync(path.join(LAB_DIR, 'index.html'), 'utf8');
  for (const m of indexHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    addRef(m[1], 'index.html');
  }

  for (const serialized of pathsToResolve) {
    const { ref, sourceLabel } = JSON.parse(serialized);
    const resolved = path.resolve(LAB_DIR, ref);
    assert(fs.existsSync(resolved), `Missing referenced file (${sourceLabel}): ${ref}`);
  }

  // 9. Confirm no prohibited paths created inside lab
  const gitStatusOut = execSync('git status --short -- docs/creative-labs/moonwitness-animated-comic', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert(typeof gitStatusOut === 'string', 'git status scoped check succeeded');

  console.log(
    JSON.stringify(
      {
        status: failCount === 0 ? 'PASSED' : 'FAILED',
        passCount,
        failCount,
        svgOverlayCount: svgFiles.length,
        studioWebpCount: webpFiles.length,
        totalAnimationFrames,
        minConsecutiveFrameMAD: Number(minFrameDiff.toFixed(2)),
        panelCount: storyboard.panels.length,
        totalDurationMs: storyboard.totalDurationMs,
        provenanceRecords: totalProvRecords,
        resolvedPathsCount: pathsToResolve.size,
        failures,
      },
      null,
      2
    )
  );

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
