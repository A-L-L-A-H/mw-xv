/* global document, window, fetch, Image, localStorage, history, PerformanceObserver, MutationObserver, ResizeObserver, HTMLElement, HTMLImageElement, HTMLCanvasElement, CanvasRenderingContext2D, AudioContext */

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
  '.jpg': 'image/jpeg',
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
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
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
      resolve({ server, port: server.address().port });
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

  return page.evaluate(() => {
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
}

async function saveShot(page, filename, opts = { fullPage: false }) {
  const buf = await page.screenshot(opts);
  const finalPath = path.join(EVIDENCE_DIR, filename);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, buf);
  try {
    fs.rmSync(finalPath, { force: true });
  } catch {
    // ignore if absent
  }
  fs.renameSync(tmpPath, finalPath);
}

async function run() {
  const { server, port } = await startStaticServer(REPO_ROOT);
  const labUrl = `http://127.0.0.1:${port}/docs/creative-labs/moonwitness-animated-comic/index.html`;
  const browser = await playwright.chromium.launch({ headless: true });

  const consoleErrors = [];
  const pageErrors = [];
  const badHttpResponses = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('response', (res) => {
      if (res.status() >= 400) badHttpResponses.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#meta-panel-id');

    // 1. Initial load: PAUSED on P01, zero broken images, stage + caption + controls fit cleanly
    assert((await page.textContent('#meta-panel-id'))?.trim() === 'P01', 'Initial panel is P01');
    assert((await page.textContent('#meta-playback-state'))?.trim() === 'PAUSED', 'Starts PAUSED');
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'Initial images loaded cleanly');

    // 2. Click Play and verify P01 advances to ANIM-A
    await page.click('#btn-play');
    assert((await page.textContent('#meta-playback-state'))?.includes('PLAYING'), 'Play starts playback');
    await page.waitForTimeout(1200);
    assert((await page.textContent('#meta-panel-id'))?.trim() !== 'P01', 'Playback advances past P01');
    assert((await page.textContent('#meta-beat-id'))?.trim() === 'ANIM-A', 'Advances into ANIM-A');
    await page.click('#btn-pause');
    assert((await page.textContent('#meta-playback-state'))?.trim() === 'PAUSED', 'Pause stops playback');

    // 3. Capture ANIM-A (P03 with Receiver Macro PiP inset!)
    await page.click('.filmstrip-item[data-panel-id="P03"]');
    await page.click('#btn-next-frame');
    await page.click('#btn-next-frame'); // Frame 3/3 (frame-06.webp)
    const animASrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(animASrc?.includes('anim-a-signal-detected/frame-06.webp'), `ANIM-A P03 expected frame-06.webp, got ${animASrc}`);
    const insetVisibleP03 = await page.isVisible('#stage-inset-card');
    assert(insetVisibleP03, 'P03 displays receiver macro PiP inset card');
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-A images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveShot(page, '01-stage-anim-a-signal.png', { fullPage: false });

    // Prev frame check
    await page.click('#btn-prev-frame');
    assert(
      (await page.getAttribute('#stage-frame-img', 'src'))?.includes('anim-a-signal-detected/frame-05.webp'),
      'Prev frame steps back to frame-05.webp'
    );

    // 4. Capture ANIM-B (P04 Frame 3/7 Apex Rooftop Vault or Frame 4/7 Smear Dash)
    await page.click('.filmstrip-item[data-panel-id="P04"]');
    await page.click('#btn-next-frame'); // F02
    await page.click('#btn-next-frame'); // F03
    const animBSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(animBSrc?.includes('anim-b-courier-move/frame-03.webp'), `ANIM-B expected frame-03.webp, got ${animBSrc}`);
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-B images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveShot(page, '02-stage-anim-b-courier.png', { fullPage: false });

    // 5. Capture ANIM-C (P08 Two-Shot Impatient Kuro vs Calm Vesper)
    await page.click('.filmstrip-item[data-panel-id="P08"]');
    const animCSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(animCSrc?.includes('anim-c-archive-reaction/frame-04.webp'), `ANIM-C P08 expected frame-04.webp, got ${animCSrc}`);
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-C images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveShot(page, '03-stage-anim-c-vesper.png', { fullPage: false });

    // 6. Capture ANIM-D (P11 Quiet Concentric Signal Pulse over Moon City)
    await page.click('.filmstrip-item[data-panel-id="P11"]');
    await page.click('#btn-next-frame'); // F04 quiet pulse
    const animDSrc = await page.getAttribute('#stage-frame-img', 'src');
    assert(animDSrc?.includes('anim-d-message-preserved/frame-04.webp'), `ANIM-D P11 expected frame-04.webp, got ${animDSrc}`);
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'ANIM-D images loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveShot(page, '04-stage-anim-d-preserved.png', { fullPage: false });

    // 7. Speed 0.45x / 1.0x & Replay
    await page.click('#btn-speed-slow');
    assert((await page.getAttribute('#btn-speed-slow', 'aria-pressed')) === 'true', 'Slow 0.45x toggles on');
    await page.click('#btn-speed-normal');
    assert((await page.getAttribute('#btn-speed-normal', 'aria-pressed')) === 'true', 'Normal 1.0x toggles back');
    await page.click('#btn-replay');
    assert((await page.textContent('#meta-panel-id'))?.trim() === 'P01', 'Replay returns to P01');

    // 8. Static Comic Page Grid (all 12 illustrated panels)
    await page.click('#btn-mode-static');
    await page.waitForSelector('.static-panel-card');
    const cardCount = await page.locator('.static-panel-card').count();
    assert(cardCount === 12, `Static comic grid must render 12 cards, got ${cardCount}`);
    // Scroll briefly to trigger lazy images
    await page.evaluate(() => {
      document.querySelectorAll('.static-panel-art').forEach((img) => {
        img.loading = 'eager';
      });
    });
    assert((await waitForVisibleImagesLoaded(page)).length === 0, 'All 12 static comic page panels loaded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveShot(page, '05-static-storyboard-grid.png', { fullPage: true });

    // 9. Keyboard shortcuts & Cast/Pipeline drawer
    await page.keyboard.press('g');
    assert((await page.getAttribute('#btn-mode-stage', 'aria-pressed')) === 'true', 'Key G returns to Theater Stage');
    await page.keyboard.press('i');
    assert(await page.isVisible('#sources-drawer'), 'Key I opens Cast & Pipeline drawer');
    await page.keyboard.press('i');
    assert(!(await page.isVisible('#sources-drawer')), 'Key I closes Cast & Pipeline drawer');
    await page.keyboard.press('ArrowRight');
    assert((await page.textContent('#meta-panel-id'))?.trim() === 'P02', 'ArrowRight advances from P01 to P02');
    await page.keyboard.press('Space');
    assert((await page.textContent('#meta-playback-state'))?.includes('PLAYING'), 'Space starts playback');
    await page.keyboard.press('Space');
    assert((await page.textContent('#meta-playback-state'))?.trim() === 'PAUSED', 'Space pauses playback');
    await page.keyboard.press('m');
    assert((await page.getAttribute('html', 'data-reduced-motion')) === 'true', 'Key M enables reduced motion');

    await context.close();

    // 10. Context 2: Fresh prefers-reduced-motion: reduce
    const reducedCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const reducedPage = await reducedCtx.newPage();
    reducedPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    reducedPage.on('pageerror', (err) => pageErrors.push(String(err)));
    reducedPage.on('response', (res) => {
      if (res.status() >= 400) badHttpResponses.push(`${res.status()} ${res.url()}`);
    });
    await reducedPage.goto(labUrl, { waitUntil: 'networkidle' });
    assert((await reducedPage.getAttribute('html', 'data-reduced-motion')) === 'true', 'Auto-detects prefers-reduced-motion');
    await reducedPage.click('.filmstrip-item[data-panel-id="P10"]');
    assert((await reducedPage.textContent('#meta-frame-counter'))?.trim() === 'Frame 1 / 1', 'Reduced motion locks single static frame');
    assert((await waitForVisibleImagesLoaded(reducedPage)).length === 0, 'Reduced motion images loaded');
    await reducedPage.evaluate(() => window.scrollTo(0, 0));
    await saveShot(reducedPage, '06-reduced-motion-view.png', { fullPage: false });
    await reducedCtx.close();

    // 11. Context 3: Mobile 390x844 responsive check
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobileCtx.newPage();
    mobilePage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    mobilePage.on('pageerror', (err) => pageErrors.push(String(err)));
    mobilePage.on('response', (res) => {
      if (res.status() >= 400) badHttpResponses.push(`${res.status()} ${res.url()}`);
    });
    await mobilePage.goto(labUrl, { waitUntil: 'networkidle' });
    await mobilePage.click('.filmstrip-item[data-panel-id="P03"]');
    await mobilePage.waitForTimeout(300);
    assert((await waitForVisibleImagesLoaded(mobilePage)).length === 0, 'Mobile images loaded');
    const overflow = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert(
      overflow.scrollWidth <= overflow.innerWidth + 2,
      `Mobile horizontal overflow: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`
    );
    await mobilePage.evaluate(() => window.scrollTo(0, 0));
    await saveShot(mobilePage, '07-mobile-390-preview.png', { fullPage: false });
    await mobileCtx.close();

    // 12. Context 4: Zero-server file:// direct open test (inline-bundle.js fallback)
    const fileUrl = `file:///${path.join(LAB_DIR, 'index.html').replace(/\\/g, '/')}`;
    const fileCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const filePage = await fileCtx.newPage();
    await filePage.goto(fileUrl, { waitUntil: 'load' });
    await filePage.waitForSelector('.filmstrip-item');
    const filePanelCount = await filePage.locator('.filmstrip-item').count();
    assert(filePanelCount === 12, `file:// zero-server load must render 12 panels, got ${filePanelCount}`);
    const soundInitText = await filePage.textContent('#btn-sound-toggle');
    assert(soundInitText?.includes('Sound: OFF'), `Sound must start OFF, got "${soundInitText}"`);
    await filePage.click('#btn-sound-toggle');
    assert((await filePage.textContent('#btn-sound-toggle'))?.includes('Sound: ON'), 'Sound toggle switches ON');
    await filePage.click('#btn-sound-toggle');
    assert((await filePage.textContent('#btn-sound-toggle'))?.includes('Sound: OFF'), 'Sound toggle switches OFF');
    await fileCtx.close();

    // 13. Context 5: Record real 1280x720 WebM screen recording of full EP-LAB-01 animatic playback
    const tmpVideoDir = path.join(EVIDENCE_DIR, '.tmp-video');
    fs.mkdirSync(tmpVideoDir, { recursive: true });
    const recCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: tmpVideoDir, size: { width: 1280, height: 720 } },
    });
    const recPage = await recCtx.newPage();
    await recPage.goto(labUrl, { waitUntil: 'networkidle' });
    await recPage.waitForSelector('#btn-play');
    await recPage.waitForTimeout(400);
    await recPage.click('#btn-play');
    // Wait for full episode playback to reach P12 & pause (with 20s upper bound)
    await recPage.waitForFunction(
      () => {
        const panel = document.getElementById('meta-panel-id')?.textContent?.trim();
        const st = document.getElementById('meta-playback-state')?.textContent?.trim();
        return panel === 'P12' && st === 'PAUSED';
      },
      { timeout: 22000 }
    );
    await recPage.waitForTimeout(500);
    const videoObj = recPage.video();
    await recCtx.close();
    const recordedPath = await videoObj.path();
    const finalVideoPath = path.join(EVIDENCE_DIR, 'ep-lab-01-animatic.webm');
    try {
      fs.rmSync(finalVideoPath, { force: true });
    } catch {
      // ignore
    }
    fs.copyFileSync(recordedPath, finalVideoPath);
    fs.rmSync(tmpVideoDir, { recursive: true, force: true });
    const videoBytes = fs.statSync(finalVideoPath).size;
    assert(videoBytes > 50000, `Recorded WebM animatic should be >50KB, got ${videoBytes} bytes`);

    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join('; ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`);
    assert(badHttpResponses.length === 0, `HTTP >=400 errors: ${badHttpResponses.join('; ')}`);

    console.log(
      JSON.stringify(
        {
          status: failCount === 0 ? 'PASSED' : 'FAILED',
          passCount,
          failCount,
          screenshots: 7,
          consoleErrors: consoleErrors.length,
          pageErrors: pageErrors.length,
          badHttpResponses: badHttpResponses.length,
          failures,
        },
        null,
        2
      )
    );
    if (failCount > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
