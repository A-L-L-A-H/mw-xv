import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(LAB_DIR, '../../..');
const EVIDENCE_DIR = path.join(LAB_DIR, 'evidence');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const require = createRequire(import.meta.url);
let playwright;
const candidateModules = [
  path.join(REPO_ROOT, 'node_modules/playwright'),
  path.join(REPO_ROOT, 'apps/board/node_modules/playwright'),
  'playwright',
];
for (const modPath of candidateModules) {
  try {
    playwright = require(modPath);
    break;
  } catch {
    // try next
  }
}
if (!playwright) {
  throw new Error('Could not resolve playwright from workspace');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

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

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
        let safeRel = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
        if (!safeRel || safeRel.endsWith('/')) {
          safeRel += 'index.html';
        }
        const targetPath = path.resolve(rootDir, safeRel);
        if (!targetPath.startsWith(rootDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const ext = path.extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(targetPath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function waitForVisibleImagesLoaded(page) {
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      if (img.hidden) return false;
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && img.getAttribute('src');
    });

    await Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 3000);
        });
      })
    );
  });

  const broken = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      if (img.hidden) return false;
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && img.getAttribute('src');
    });
    return imgs
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src'));
  });

  return broken;
}

async function run() {
  const { server, port } = await startStaticServer(REPO_ROOT);
  const labUrl = `http://127.0.0.1:${port}/docs/creative-labs/moonwitness-animated-comic/index.html`;
  const browser = await playwright.chromium.launch({ headless: true });

  const consoleErrors = [];
  const pageErrors = [];
  const badHttpResponses = [];

  try {
    // Context 1: Desktop 1440x900
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        badHttpResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#meta-panel-id');

    // 1. Initial load state: PAUSED, P01, all visible images loaded
    const initPanel = await page.textContent('#meta-panel-id');
    const initState = await page.textContent('#meta-playback-state');
    assert(initPanel?.trim() === 'P01', `Initial panel must be P01, got "${initPanel}"`);
    assert(initState?.trim() === 'PAUSED', `Initial playback state must be PAUSED, got "${initState}"`);

    const initBrokenImgs = await waitForVisibleImagesLoaded(page);
    assert(initBrokenImgs.length === 0, `Initial visible images broken: ${initBrokenImgs.join(', ')}`);

    // 2. Click #btn-play and verify playback state changes and frames advance
    await page.click('#btn-play');
    const playingState = await page.textContent('#meta-playback-state');
    assert(
      playingState?.includes('PLAYING'),
      `Clicking #btn-play should set PLAYING state, got "${playingState}"`
    );

    // Wait 1250ms so P01 (1000ms) advances into P02 (ANIM-A)
    await page.waitForTimeout(1250);
    const panelAfterPlay = await page.textContent('#meta-panel-id');
    const beatAfterPlay = await page.textContent('#meta-beat-id');
    assert(
      panelAfterPlay?.trim() !== 'P01',
      `Playback should advance past P01 automatically, still at "${panelAfterPlay}"`
    );
    assert(
      beatAfterPlay?.trim() === 'ANIM-A',
      `Expected beat ANIM-A after advancing from P01, got "${beatAfterPlay}"`
    );

    // Pause and inspect ANIM-A on P03 (partial waveform lock with receiver closeup)
    await page.click('#btn-pause');
    const pausedState = await page.textContent('#meta-playback-state');
    assert(pausedState?.trim() === 'PAUSED', `#btn-pause must set PAUSED, got "${pausedState}"`);

    // Jump to P02 via filmstrip, step frames in ANIM-A, and capture 01-stage-anim-a-signal.png
    await page.click('.filmstrip-item[data-panel-id="P02"]');
    await page.click('#btn-next-frame'); // Frame 2 / 3
    await page.click('#btn-next-frame'); // Frame 3 / 3 (Whip Reaction & Overshoot)
    const animASrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(
      animASrc?.includes('anim-a-signal-detected/frame-03.svg'),
      `ANIM-A frame step expected frame-03.svg, got "${animASrc}"`
    );
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-A visible images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '01-stage-anim-a-signal.png'),
      fullPage: false,
    });

    // Test #btn-prev-frame
    await page.click('#btn-prev-frame');
    const animAPrevSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(
      animAPrevSrc?.includes('anim-a-signal-detected/frame-02.svg'),
      `#btn-prev-frame expected frame-02.svg, got "${animAPrevSrc}"`
    );

    // Jump to P04 (ANIM-B), step frames, and capture 02-stage-anim-b-courier.png
    await page.click('.filmstrip-item[data-panel-id="P04"]');
    await page.click('#btn-next-frame'); // frame-02
    await page.click('#btn-next-frame'); // frame-03 (Apex Rooftop Vault)
    const animBSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(
      animBSrc?.includes('anim-b-courier-move/frame-03.svg'),
      `ANIM-B expected frame-03.svg, got "${animBSrc}"`
    );
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-B visible images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '02-stage-anim-b-courier.png'),
      fullPage: false,
    });

    // Jump to P08 (ANIM-C reaction) or P06/P09, inspect Vesper Ink, capture 03-stage-anim-c-vesper.png
    await page.click('.filmstrip-item[data-panel-id="P06"]');
    const animCSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(
      animCSrc?.includes('anim-c-archive-reaction/frame-03.svg'),
      `ANIM-C P06 expected frame-03.svg, got "${animCSrc}"`
    );
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-C visible images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '03-stage-anim-c-vesper.png'),
      fullPage: false,
    });

    // Jump to P11 (ANIM-D quiet signal pulse), step to frame 2 (frame-04.svg), capture 04-stage-anim-d-preserved.png
    await page.click('.filmstrip-item[data-panel-id="P11"]');
    await page.click('#btn-next-frame');
    const animDSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(
      animDSrc?.includes('anim-d-message-preserved/frame-04.svg'),
      `ANIM-D P11 frame 2 expected frame-04.svg, got "${animDSrc}"`
    );
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-D visible images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '04-stage-anim-d-preserved.png'),
      fullPage: false,
    });

    // 3. Test #btn-speed-slow (0.45x), #btn-speed-normal (1.0x), #btn-replay
    await page.click('#btn-speed-slow');
    assert(
      (await page.getAttribute('#btn-speed-slow', 'aria-pressed')) === 'true',
      '#btn-speed-slow aria-pressed should be true'
    );
    await page.click('#btn-speed-normal');
    assert(
      (await page.getAttribute('#btn-speed-normal', 'aria-pressed')) === 'true',
      '#btn-speed-normal aria-pressed should be true'
    );
    await page.click('#btn-replay');
    assert(
      (await page.textContent('#meta-panel-id'))?.trim() === 'P01',
      '#btn-replay should reset panel to P01'
    );

    // 4. Switch to Static Storyboard Grid (#btn-mode-static), confirm all 12 panels render with captions and no animation running
    await page.click('#btn-mode-static');
    const gridHidden = await page.getAttribute('#static-grid-view', 'hidden');
    assert(gridHidden === null, '#static-grid-view must be visible in static mode');

    // Scroll through static grid to trigger lazy images and wait for all 12 cards to load
    await page.evaluate(() => {
      document.querySelectorAll('.static-panel-art').forEach((img) => {
        img.loading = 'eager';
      });
    });
    const staticCardCount = await page.locator('.static-panel-card').count();
    assert(staticCardCount === 12, `Static grid must render 12 panel cards, found ${staticCardCount}`);
    const staticBroken = await waitForVisibleImagesLoaded(page);
    assert(staticBroken.length === 0, `Static grid has broken images: ${staticBroken.join(', ')}`);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '05-static-storyboard-grid.png'),
      fullPage: true,
    });

    // Return to stage view
    await page.click('#btn-mode-stage');
    assert((await page.getAttribute('#theater-view', 'hidden')) === null, 'Returned to stage view');

    // 5. Test Reduced-Motion toggle (#btn-reduced-motion)
    await page.click('.filmstrip-item[data-panel-id="P04"]');
    await page.click('#btn-reduced-motion');
    const rmPressed = await page.getAttribute('#btn-reduced-motion', 'aria-pressed');
    const rmFrameCounter = await page.textContent('#meta-frame-counter');
    assert(rmPressed === 'true', '#btn-reduced-motion aria-pressed must be true when toggled on');
    assert(
      rmFrameCounter?.trim() === 'Frame 1 / 1',
      `Reduced-motion must collapse animated beat to 1 static fallback frame, got "${rmFrameCounter}"`
    );
    // Toggle off again before keyboard tests
    await page.click('#btn-reduced-motion');
    assert(
      (await page.getAttribute('#btn-reduced-motion', 'aria-pressed')) === 'false',
      '#btn-reduced-motion toggled back off'
    );

    // 6. Test keyboard controls (Space, ArrowRight, G, M, I) and Sources/Cast drawer (#btn-sources-drawer)
    await page.keyboard.press('Space');
    assert(
      (await page.textContent('#meta-playback-state'))?.includes('PLAYING'),
      'Keyboard Space should start playback'
    );
    await page.keyboard.press('Space');
    assert(
      (await page.textContent('#meta-playback-state'))?.trim() === 'PAUSED',
      'Keyboard Space should pause playback'
    );

    const frameBeforeRight = await page.textContent('#meta-frame-counter');
    await page.keyboard.press('ArrowRight');
    const frameAfterRight = await page.textContent('#meta-frame-counter');
    assert(
      frameBeforeRight !== frameAfterRight,
      `Keyboard ArrowRight should advance frame (was "${frameBeforeRight}", now "${frameAfterRight}")`
    );

    await page.keyboard.press('g');
    assert(
      (await page.getAttribute('#static-grid-view', 'hidden')) === null,
      'Keyboard G should toggle Static Grid view on'
    );
    await page.keyboard.press('g');
    assert(
      (await page.getAttribute('#theater-view', 'hidden')) === null,
      'Keyboard G should toggle Theater Stage view back on'
    );

    await page.keyboard.press('m');
    assert(
      (await page.getAttribute('#btn-reduced-motion', 'aria-pressed')) === 'true',
      'Keyboard M should enable reduced motion'
    );
    await page.keyboard.press('m');
    assert(
      (await page.getAttribute('#btn-reduced-motion', 'aria-pressed')) === 'false',
      'Keyboard M should disable reduced motion'
    );

    await page.keyboard.press('i');
    assert(
      (await page.getAttribute('#sources-drawer', 'hidden')) === null,
      'Keyboard I should open Cast & Sources drawer'
    );
    // Ensure drawer reference thumbs load
    await page.evaluate(() => {
      document.querySelectorAll('#sources-drawer img').forEach((img) => {
        img.loading = 'eager';
      });
    });
    assert(
      (await waitForVisibleImagesLoaded(page)).length === 0,
      'Cast & Sources drawer reference images loaded cleanly'
    );
    await page.click('#btn-sources-drawer');
    assert(
      (await page.getAttribute('#sources-drawer', 'hidden')) !== null,
      'Clicking #btn-sources-drawer closes drawer'
    );

    await context.close();

    // 7. Fresh context with emulateMedia({ reducedMotion: 'reduce' })
    const rmContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const rmPage = await rmContext.newPage();
    await rmPage.emulateMedia({ reducedMotion: 'reduce' });
    await rmPage.goto(labUrl, { waitUntil: 'networkidle' });
    await rmPage.waitForSelector('#btn-reduced-motion');

    const autoRmAttr = await rmPage.getAttribute('html', 'data-reduced-motion');
    const autoRmBtnText = await rmPage.textContent('#btn-reduced-motion');
    assert(
      autoRmAttr === 'true' && autoRmBtnText?.includes('ON'),
      `prefers-reduced-motion: reduce must auto-enable reduced motion on load (attr=${autoRmAttr}, text=${autoRmBtnText})`
    );
    await rmPage.click('.filmstrip-item[data-panel-id="P09"]');
    const rmP09Counter = await rmPage.textContent('#meta-frame-counter');
    assert(
      rmP09Counter?.trim() === 'Frame 1 / 1',
      `Reduced-motion context on P09 expected Frame 1 / 1, got "${rmP09Counter}"`
    );
    assert((await waitForVisibleImagesLoaded(rmPage)).length === 0, 'Reduced-motion P09 images loaded');
    await rmPage.evaluate(() => window.scrollTo(0, 0));
    await rmPage.screenshot({
      path: path.join(EVIDENCE_DIR, '06-reduced-motion-view.png'),
      fullPage: false,
    });
    await rmContext.close();

    // 8. Mobile 390x844 viewport test
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(labUrl, { waitUntil: 'networkidle' });
    await mobilePage.waitForSelector('#comic-stage');
    await mobilePage.click('.filmstrip-item[data-panel-id="P03"]');
    assert((await waitForVisibleImagesLoaded(mobilePage)).length === 0, 'Mobile P03 images loaded');

    const overflowCheck = await mobilePage.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    assert(
      overflowCheck.scrollWidth <= overflowCheck.innerWidth + 2,
      `Mobile 390x844 horizontal overflow detected: scrollWidth=${overflowCheck.scrollWidth}, innerWidth=${overflowCheck.innerWidth}`
    );

    await mobilePage.evaluate(() => window.scrollTo(0, 0));
    await mobilePage.screenshot({
      path: path.join(EVIDENCE_DIR, '07-mobile-390-preview.png'),
      fullPage: false,
    });
    await mobileContext.close();

    // Final error assertions
    assert(consoleErrors.length === 0, `Expected 0 console errors, got: ${consoleErrors.join('; ')}`);
    assert(pageErrors.length === 0, `Expected 0 uncaught page errors, got: ${pageErrors.join('; ')}`);
    assert(badHttpResponses.length === 0, `Expected 0 HTTP >= 400 responses, got: ${badHttpResponses.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(
    JSON.stringify(
      {
        status: failCount === 0 ? 'PASSED' : 'FAILED',
        passCount,
        failCount,
        consoleErrorCount: consoleErrors.length,
        pageErrorCount: pageErrors.length,
        badHttpResponseCount: badHttpResponses.length,
        screenshotsCaptured: [
          '01-stage-anim-a-signal.png',
          '02-stage-anim-b-courier.png',
          '03-stage-anim-c-vesper.png',
          '04-stage-anim-d-preserved.png',
          '05-static-storyboard-grid.png',
          '06-reduced-motion-view.png',
          '07-mobile-390-preview.png',
        ],
        failures,
      },
      null,
      2
    )
  );

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
