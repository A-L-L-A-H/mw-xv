import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');

const COVER_SRC = path.join(LAB_DIR, 'animations/shared-props/episode-cover-keyart.webp');
const OUT_OG = path.join(LAB_DIR, 'evidence/ep-lab-01-og-card-1200x630.webp');

const overlaySvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#08090e" stop-opacity="0.15"/>
        <stop offset="65%" stop-color="#08090e" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#08090e" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <rect x="36" y="34" width="385" height="34" fill="#ffe031" stroke="#0d0d0d" stroke-width="3"/>
    <text x="52" y="57" font-family="monospace" font-size="16" font-weight="700" fill="#0d0d0d">MOONWITNESS ANIMATED COMIC · EP-LAB-01</text>
    <text x="38" y="556" font-family="Impact, sans-serif" font-size="52" letter-spacing="1.5" fill="#f3efe4">WHEN THE MOON RISES, WE SHARE A MESSAGE</text>
    <text x="40" y="594" font-family="monospace" font-size="18" font-weight="700" fill="#00b8f0">EXPERIMENTAL 2.5D MOTION-COMIC LAB · KURO SIGNAL &amp; VESPER INK</text>
    <rect x="6" y="6" width="1188" height="618" fill="none" stroke="#ff2e88" stroke-width="6"/>
  </svg>`
);

const buf = await sharp(COVER_SRC)
  .resize(1200, 630, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
  .composite([{ input: overlaySvg, top: 0, left: 0 }])
  .webp({ quality: 90, effort: 5 })
  .toBuffer();

const tmp = `${OUT_OG}.tmp-${process.pid}`;
fs.writeFileSync(tmp, buf);
try {
  fs.rmSync(OUT_OG, { force: true });
} catch {
  // ignore
}
fs.renameSync(tmp, OUT_OG);
console.log(JSON.stringify({ ok: true, out: 'evidence/ep-lab-01-og-card-1200x630.webp', bytes: buf.length }));
