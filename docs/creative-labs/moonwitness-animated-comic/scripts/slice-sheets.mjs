import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAB_DIR = path.resolve(__dirname, '..');

const ARTIFACT_DIR =
  process.argv[2] ||
  'C:\\Users\\bjo16\\.gemini\\antigravity\\brain\\00101c05-02ed-4e06-94ca-40243ff990dd';

const TARGET_W = 960;
const TARGET_H = 540;

const MAPPING = [
  {
    sheet: 'sheet_01_anim_a1_1795606987063.jpg',
    quads: [
      { pos: 'tl', out: 'animations/shared-props/p01-moon-city-establishing.webp' },
      { pos: 'tr', out: 'animations/anim-a-signal-detected/frame-01.webp' },
      { pos: 'bl', out: 'animations/anim-a-signal-detected/frame-02.webp' },
      { pos: 'br', out: 'animations/anim-a-signal-detected/frame-03.webp' },
    ],
  },
  {
    sheet: 'sheet_02_anim_a2_v2_1795606981991.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-a-signal-detected/frame-04.webp' },
      { pos: 'tr', out: 'animations/anim-a-signal-detected/frame-05.webp' },
      { pos: 'bl', out: 'animations/anim-a-signal-detected/frame-06.webp' },
      { pos: 'br', out: 'animations/shared-props/portable-receiver-closeup.webp' },
    ],
  },
  {
    sheet: 'sheet_03_anim_b1_v2_1795607009421.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-b-courier-move/frame-01.webp' },
      // Flop F02 horizontally so launch momentum flows left-to-right matching F01 -> F03 -> F04
      { pos: 'tr', out: 'animations/anim-b-courier-move/frame-02.webp', flop: true },
      { pos: 'bl', out: 'animations/anim-b-courier-move/frame-03.webp' },
      { pos: 'br', out: 'animations/anim-b-courier-move/frame-04.webp' },
    ],
  },
  {
    sheet: 'sheet_04_anim_b2_v2_1795606993761.jpg',
    quads: [
      // Flop F05 horizontally so heel-plant braking skid matches left-to-right dash momentum
      { pos: 'tl', out: 'animations/anim-b-courier-move/frame-05.webp', flop: true },
      { pos: 'tr', out: 'animations/anim-b-courier-move/frame-06.webp' },
      { pos: 'bl', out: 'animations/anim-b-courier-move/frame-07.webp' },
      { pos: 'br', out: 'animations/shared-props/archive-loft-exterior.webp' },
    ],
  },
  {
    sheet: 'sheet_05_anim_c1_1795606968245.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-c-archive-reaction/frame-01.webp' },
      { pos: 'tr', out: 'animations/anim-c-archive-reaction/frame-02.webp' },
      { pos: 'bl', out: 'animations/anim-c-archive-reaction/frame-03.webp' },
      { pos: 'br', out: 'animations/anim-c-archive-reaction/frame-04.webp' },
    ],
  },
  {
    sheet: 'sheet_06_anim_c2_v2_1795606993049.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-c-archive-reaction/frame-05.webp' },
      { pos: 'tr', out: 'animations/anim-c-archive-reaction/frame-06.webp' },
      { pos: 'bl', out: 'animations/shared-props/fragment-slip-incomplete.webp' },
      { pos: 'br', out: 'animations/shared-props/archive-folio-sealed.webp' },
    ],
  },
  {
    sheet: 'sheet_07_anim_d1_1795606968818.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-d-message-preserved/frame-01.webp' },
      { pos: 'tr', out: 'animations/anim-d-message-preserved/frame-02.webp' },
      { pos: 'bl', out: 'animations/anim-d-message-preserved/frame-03.webp' },
      { pos: 'br', out: 'animations/anim-d-message-preserved/frame-04.webp' },
    ],
  },
  {
    sheet: 'sheet_08_anim_d2_v2_1795606990868.jpg',
    quads: [
      { pos: 'tl', out: 'animations/anim-d-message-preserved/frame-05.webp' },
      { pos: 'tr', out: 'animations/anim-d-message-preserved/frame-06.webp' },
      { pos: 'bl', out: 'animations/shared-props/episode-cover-keyart.webp' },
      { pos: 'br', out: 'animations/shared-props/workbench-atmosphere.webp' },
    ],
  },
];

async function trimDividerEdges(buffer, flop = false) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const maxTrimX = Math.floor(width * 0.04);
  const maxTrimY = Math.floor(height * 0.04);

  const isBorderLine = (coords) => {
    let darkCount = 0;
    let brightCount = 0;
    for (const [x, y] of coords) {
      const idx = (y * width + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (r < 20 && g < 20 && b < 20) darkCount += 1;
      else if (r > 240 && g > 240 && b > 240) brightCount += 1;
    }
    return darkCount / coords.length > 0.88 || brightCount / coords.length > 0.88;
  };

  let top = 0;
  while (top < maxTrimY) {
    const row = Array.from({ length: width }, (_, x) => [x, top]);
    if (!isBorderLine(row)) break;
    top += 1;
  }

  let bottom = height - 1;
  while (height - 1 - bottom < maxTrimY) {
    const row = Array.from({ length: width }, (_, x) => [x, bottom]);
    if (!isBorderLine(row)) break;
    bottom -= 1;
  }

  let left = 0;
  while (left < maxTrimX) {
    const col = Array.from({ length: height }, (_, y) => [left, y]);
    if (!isBorderLine(col)) break;
    left += 1;
  }

  let right = width - 1;
  while (width - 1 - right < maxTrimX) {
    const col = Array.from({ length: height }, (_, y) => [right, y]);
    if (!isBorderLine(col)) break;
    right -= 1;
  }

  // Always inset at least 4px on interior divider seam edges to strip JPEG ringing
  const safeTop = Math.min(Math.max(top, 4) + 2, maxTrimY);
  const safeLeft = Math.min(Math.max(left, 4) + 2, maxTrimX);
  const safeRight = Math.max(Math.min(right, width - 5) - 2, width - maxTrimX);
  const safeBottom = Math.max(Math.min(bottom, height - 5) - 2, height - maxTrimY);

  const cropW = Math.max(64, safeRight - safeLeft + 1);
  const cropH = Math.max(64, safeBottom - safeTop + 1);

  let pipe = sharp(buffer).extract({ left: safeLeft, top: safeTop, width: cropW, height: cropH });
  if (flop) pipe = pipe.flop();
  return pipe
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 90, effort: 5 })
    .toBuffer();
}

async function run() {
  const results = [];
  for (const entry of MAPPING) {
    const sheetPath = path.join(ARTIFACT_DIR, entry.sheet);
    if (!fs.existsSync(sheetPath)) {
      throw new Error(`Missing source sheet: ${sheetPath}`);
    }
    const meta = await sharp(sheetPath).metadata();
    const halfW = Math.floor(meta.width / 2);
    const halfH = Math.floor(meta.height / 2);

    const rects = {
      tl: { left: 0, top: 0, width: halfW, height: halfH },
      tr: { left: halfW, top: 0, width: meta.width - halfW, height: halfH },
      bl: { left: 0, top: halfH, width: halfW, height: meta.height - halfH },
      br: { left: halfW, top: halfH, width: meta.width - halfW, height: meta.height - halfH },
    };

    for (const q of entry.quads) {
      const quadBuf = await sharp(sheetPath).extract(rects[q.pos]).png().toBuffer();
      const webpBuf = await trimDividerEdges(quadBuf, Boolean(q.flop));
      const outPath = path.join(LAB_DIR, q.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, webpBuf);
      results.push({ out: q.out, bytes: webpBuf.length });
    }
  }
  const totalKB = Math.round(results.reduce((s, r) => s + r.bytes, 0) / 1024);
  console.log(JSON.stringify({ sliced: results.length, totalKB, files: results }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
