import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(LAB_DIR, '../../..');
const OUT_PDF = path.join(LAB_DIR, 'evidence/ep-lab-01-zine-booklet.pdf');

const require = createRequire(import.meta.url);
let playwright;
for (const mod of [
  path.join(REPO_ROOT, 'node_modules/playwright'),
  path.join(REPO_ROOT, 'apps/board/node_modules/playwright'),
  'playwright',
]) {
  try {
    playwright = require(mod);
    break;
  } catch {
    // next
  }
}
if (!playwright) throw new Error('Playwright not found');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function serve(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const target = path.resolve(root, rel);
      if (!target.startsWith(root) || !fs.existsSync(target)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function run() {
  const { server, port } = await serve(REPO_ROOT);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    await page.goto(`http://127.0.0.1:${port}/docs/creative-labs/moonwitness-animated-comic/index.html`, {
      waitUntil: 'networkidle',
    });
    await page.click('#btn-mode-static');
    await page.waitForSelector('.static-panel-card');
    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('.static-panel-art'));
      imgs.forEach((img) => {
        img.loading = 'eager';
      });
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise((r) => {
                img.addEventListener('load', r, { once: true });
                img.addEventListener('error', r, { once: true });
              })
        )
      );
    });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    const tmp = `${OUT_PDF}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, pdfBuf);
    try {
      fs.rmSync(OUT_PDF, { force: true });
    } catch {
      // ignore
    }
    fs.renameSync(tmp, OUT_PDF);
    console.log(JSON.stringify({ ok: true, out: 'evidence/ep-lab-01-zine-booklet.pdf', bytes: pdfBuf.length }));
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
