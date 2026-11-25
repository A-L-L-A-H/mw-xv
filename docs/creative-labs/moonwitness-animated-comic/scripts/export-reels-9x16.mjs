#!/usr/bin/env node
/**
 * MW-XV 9:16 Vertical Reels / Shorts Exporter (1080x1920)
 * Captures a vertical WebM video of the MoonWitness Animated Comic Lab in Webtoon mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const LAB_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const EVIDENCE_DIR = path.join(LAB_DIR, 'evidence');
const OUT_FILE = path.join(EVIDENCE_DIR, 'ep-lab-01-reels-9x16.webm');

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tmpDir = path.join(EVIDENCE_DIR, '.tmp-reels');
  fs.mkdirSync(tmpDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    recordVideo: {
      dir: tmpDir,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();
  const indexUrl = pathToFileURL(path.join(LAB_DIR, 'index.html')).href;
  await page.goto(indexUrl, { waitUntil: 'networkidle' });

  const webtoonBtn = page.locator('#btn-mode-webtoon');
  if (await webtoonBtn.count()) {
    await webtoonBtn.click();
  }
  await page.waitForTimeout(800);

  for (let i = 0; i < 6; i += 1) {
    await page.evaluate((step) => {
      window.scrollTo({ top: step * 420, behavior: 'smooth' });
    }, i);
    await page.waitForTimeout(700);
  }

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();

  if (fs.existsSync(OUT_FILE)) fs.rmSync(OUT_FILE, { force: true });
  fs.renameSync(videoPath, OUT_FILE);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const stat = fs.statSync(OUT_FILE);
  console.log(`Exported 9:16 Reels WebM: ${OUT_FILE} (${stat.size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
