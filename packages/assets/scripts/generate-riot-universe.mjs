import { Buffer } from 'node:buffer';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');

const INK = '#0d0d0d';
const PAPER = '#f3efe4';
const NIGHT = '#0e0e10';
const CHARCOAL = '#17171a';
const YELLOW = '#ffe031';
const MAGENTA = '#ff2e88';
const CYAN = '#00b8f0';
const VIOLET = '#c084fc';

function assetSlug(filePath) {
  return filePath
    .replace(/\.svg$/u, '')
    .replace(/[^a-zA-Z\d]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

async function atomicWrite(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}

/**
 * Remove exterior near-white backdrop using 4-edge BFS flood-fill with 1px
 * anti-aliased edge feathering so interior whites (eyes, teeth, bandage,
 * Vesper's silver-cream hair) remain strictly opaque (alpha === 255).
 */
export async function floodFillCutout(input, extractRect = null) {
  let pipeline = sharp(input).ensureAlpha();
  if (extractRect) pipeline = pipeline.extract(extractRect);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isNearWhite = (offset) =>
    data[offset] > 240 && data[offset + 1] > 240 && data[offset + 2] > 240;

  const enqueue = (x, y) => {
    const pixel = y * width + x;
    if (visited[pixel]) return;
    if (!isNearWhite(pixel * 4)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }

  for (let pixel = 0; pixel < total; pixel += 1) {
    const offset = pixel * 4;
    if (visited[pixel]) {
      data[offset + 3] = 0;
      continue;
    }
    const x = pixel % width;
    const y = (pixel - x) / width;
    const touchesExterior =
      (x > 0 && visited[pixel - 1]) ||
      (x < width - 1 && visited[pixel + 1]) ||
      (y > 0 && visited[pixel - width]) ||
      (y < height - 1 && visited[pixel + width]);
    if (touchesExterior) {
      const luminance = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (luminance > 195) {
        const feathered = Math.round(255 - (luminance - 195) * 4.2);
        data[offset + 3] = Math.max(0, Math.min(255, feathered));
      }
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function wrapSvg(filePath, width, height, title, body) {
  const prefix = `mw-${assetSlug(filePath)}-`;
  const resolvedBody = body.replaceAll('__ID__', prefix);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" aria-label="${title}">` +
    `<title>${title}</title>${resolvedBody}</svg>\n`
  );
}

async function svgBuffer(width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
  return Buffer.from(svg, 'utf8');
}

function starPath(cx, cy, outerR, innerR, points = 4) {
  const coords = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outerR : innerR;
    const x = (cx + Math.cos(angle) * radius).toFixed(1);
    const y = (cy + Math.sin(angle) * radius).toFixed(1);
    coords.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  return `${coords.join(' ')} Z`;
}

function halftoneDots(cols, rows, startX, startY, step, radius, color, opacity = 0.25) {
  const dots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = startX + col * step + (row % 2 === 1 ? step / 2 : 0);
      const cy = startY + row * step;
      dots.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" fill-opacity="${opacity}"/>`);
    }
  }
  return dots.join('');
}

const EXPRESSION_MASTERS = {
  happy: 'source/artwork/riot-universe/kuro-signal-portrait-happy-master.png',
  excited: 'source/artwork/riot-universe/kuro-signal-portrait-excited-master.png',
  thinking: 'source/artwork/riot-universe/kuro-signal-portrait-thinking-master.png',
  celebrating: 'source/artwork/riot-universe/kuro-signal-portrait-celebrating-master.png',
};

const EXPRESSIONS = [
  {
    slug: 'happy',
    masterKey: 'happy',
    tilt: 0,
    scale: 1,
    offsetY: 0,
    overlay: `
      <path d="${starPath(426, 98, 22, 7, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <circle cx="94" cy="144" r="10" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
      <path d="M 412 162 q 24 -12 42 4" fill="none" stroke="${MAGENTA}" stroke-width="5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'excited',
    masterKey: 'excited',
    tilt: -3,
    scale: 1.04,
    offsetY: -8,
    overlay: `
      <path d="${starPath(96, 108, 28, 9, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(426, 96, 30, 10, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(442, 228, 18, 6, 4)}" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
      <path d="M 52 204 L 88 214 M 44 252 L 82 248 M 426 178 L 464 168 M 436 274 L 474 282" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'laughing',
    masterKey: 'excited',
    tilt: 4,
    scale: 1.03,
    offsetY: -6,
    overlay: `
      <path d="M 68 158 Q 92 132 118 154 M 62 186 Q 88 164 114 182" fill="none" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/>
      <path d="${starPath(418, 114, 24, 8, 5)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="M 404 188 L 448 168 M 412 214 L 458 206 M 404 240 L 444 244" stroke="${MAGENTA}" stroke-width="5.5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'angry',
    masterKey: 'happy',
    tilt: -2,
    scale: 1.05,
    offsetY: 4,
    tint: { saturation: 1.12, brightness: 0.96 },
    overlay: `
      <path d="M 382 104 Q 402 126 382 146 M 426 104 Q 406 126 426 146 M 384 102 Q 404 122 424 102 M 384 148 Q 404 128 424 148" fill="none" stroke="${MAGENTA}" stroke-width="7" stroke-linecap="round"/>
      <path d="M 46 118 L 96 144 M 40 166 L 92 174 M 426 176 L 472 152 M 432 222 L 476 218" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
      <polygon points="82,92 106,120 74,128" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>
    `,
  },
  {
    slug: 'confused',
    masterKey: 'thinking',
    tilt: 6,
    scale: 0.97,
    offsetY: 4,
    overlay: `
      <path d="M 392 128 C 392 92 446 92 446 122 C 446 146 418 152 418 176" fill="none" stroke="${CYAN}" stroke-width="9" stroke-linecap="round"/>
      <circle cx="418" cy="198" r="6.5" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
      <path d="M 86 154 C 72 154 72 182 94 182 C 110 182 110 160 98 160" fill="none" stroke="${VIOLET}" stroke-width="5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'thinking',
    masterKey: 'thinking',
    tilt: -4,
    scale: 0.98,
    offsetY: 2,
    overlay: `
      <circle cx="382" cy="182" r="9" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>
      <circle cx="408" cy="152" r="14" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>
      <path d="M 382 104 C 382 78 416 74 428 92 C 446 84 468 102 458 122 C 468 138 446 156 426 148 C 406 156 382 138 392 122 C 378 116 378 108 382 104 Z" fill="${PAPER}" stroke="${INK}" stroke-width="4.5"/>
      <circle cx="410" cy="118" r="5" fill="${CYAN}"/>
      <circle cx="426" cy="118" r="5" fill="${MAGENTA}"/>
      <circle cx="442" cy="118" r="5" fill="${YELLOW}"/>
    `,
  },
  {
    slug: 'surprised',
    masterKey: 'excited',
    tilt: 0,
    scale: 1.06,
    offsetY: -10,
    overlay: `
      <path d="M 418 76 L 424 146" stroke="${YELLOW}" stroke-width="11" stroke-linecap="round"/>
      <circle cx="424" cy="172" r="7" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="M 58 120 L 98 148 M 44 176 L 86 184 M 62 232 L 96 218 M 426 210 L 470 198 M 424 248 L 468 256" stroke="${CYAN}" stroke-width="5.5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'sad',
    masterKey: 'thinking',
    tilt: -5,
    scale: 0.95,
    offsetY: 14,
    tint: { saturation: 0.72, brightness: 0.9 },
    overlay: `
      <path d="M 384 96 C 368 96 364 114 374 122 C 366 134 380 148 396 142 C 410 150 432 146 436 132 C 452 132 456 110 440 104 C 436 86 402 82 384 96 Z" fill="#475569" stroke="${INK}" stroke-width="4.5"/>
      <path d="M 384 156 L 378 178 M 408 160 L 402 184 M 430 156 L 424 178" stroke="${CYAN}" stroke-width="4.5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'crying',
    masterKey: 'thinking',
    tilt: 5,
    scale: 0.96,
    offsetY: 10,
    tint: { saturation: 0.8, brightness: 0.93 },
    overlay: `
      <path d="M 102 168 C 86 196 86 216 102 222 C 118 216 118 196 102 168 Z" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>
      <path d="M 412 152 C 396 180 396 200 412 206 C 428 200 428 180 412 152 Z" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>
      <path d="M 88 242 Q 104 256 118 242 M 398 228 Q 414 242 428 228" fill="none" stroke="${CYAN}" stroke-width="5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'sleepy',
    masterKey: 'thinking',
    tilt: 7,
    scale: 0.96,
    offsetY: 12,
    tint: { saturation: 0.85, brightness: 0.92 },
    overlay: `
      <path d="M 412 96 A 26 26 0 1 0 442 132 A 20 20 0 1 1 412 96 Z" fill="${VIOLET}" stroke="${INK}" stroke-width="4"/>
      <circle cx="378" cy="158" r="8" fill="${VIOLET}" fill-opacity="0.7" stroke="${INK}" stroke-width="3.5"/>
      <circle cx="398" cy="134" r="11" fill="${CYAN}" fill-opacity="0.7" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'curious',
    masterKey: 'thinking',
    tilt: -6,
    scale: 1,
    offsetY: 0,
    overlay: `
      <circle cx="136" cy="96" r="18" fill="none" stroke="${CYAN}" stroke-width="4.5" stroke-dasharray="8 6"/>
      <circle cx="136" cy="96" r="30" fill="none" stroke="${CYAN}" stroke-width="3.5" stroke-opacity="0.75"/>
      <path d="${starPath(420, 128, 20, 7, 4)}" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'celebrating',
    masterKey: 'celebrating',
    tilt: 3,
    scale: 1.04,
    offsetY: -8,
    overlay: `
      <path d="${starPath(94, 102, 24, 8, 5)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(424, 106, 26, 9, 5)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>
      <rect x="64" y="182" width="18" height="10" rx="2" fill="${CYAN}" stroke="${INK}" stroke-width="3" transform="rotate(-24 73 187)"/>
      <rect x="424" y="188" width="18" height="10" rx="2" fill="${YELLOW}" stroke="${INK}" stroke-width="3" transform="rotate(28 433 193)"/>
      <path d="M 102 150 Q 134 110 148 158 M 390 158 Q 408 114 438 156" fill="none" stroke="${YELLOW}" stroke-width="5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'embarrassed',
    masterKey: 'happy',
    tilt: 4,
    scale: 0.98,
    offsetY: 6,
    overlay: `
      <path d="M 404 128 C 392 152 392 170 404 176 C 416 170 416 152 404 128 Z" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>
      <path d="M 78 148 L 106 164 M 74 170 L 102 186 M 414 196 L 444 182 M 418 218 L 448 204" stroke="${MAGENTA}" stroke-width="5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'determined',
    masterKey: 'excited',
    tilt: -2,
    scale: 1.03,
    offsetY: -4,
    overlay: `
      <path d="M 42 96 L 116 138 M 36 144 L 106 170 M 468 98 L 396 136 M 474 146 L 406 172" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/>
      <path d="M 382 192 L 424 186 L 404 216 L 434 214 L 392 252 L 404 224 L 378 226 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'victory',
    masterKey: 'celebrating',
    tilt: 2,
    scale: 1.05,
    offsetY: -10,
    overlay: `
      <path d="M 378 144 L 390 92 L 414 118 L 438 92 L 450 144 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="${starPath(98, 108, 22, 7, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(434, 198, 18, 6, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'disappointed',
    masterKey: 'thinking',
    tilt: -4,
    scale: 0.95,
    offsetY: 14,
    tint: { saturation: 0.65, brightness: 0.88 },
    overlay: `
      <path d="M 392 92 L 392 172 M 414 86 L 414 166 M 436 96 L 436 174" stroke="#64748b" stroke-width="6" stroke-linecap="round"/>
      <path d="M 68 134 Q 88 118 108 134" fill="none" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
    `,
  },
];

const POSES = [
  {
    slug: 'standing',
    view: 'front',
    tilt: 0,
    offsetY: 0,
    backFx: `<ellipse cx="256" cy="726" rx="142" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `<path d="${starPath(412, 134, 18, 6, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="3.5"/>`,
  },
  {
    slug: 'sitting',
    view: 'threeQuarter',
    tilt: -4,
    offsetY: -22,
    backFx: `
      <rect x="132" y="546" width="248" height="168" rx="12" fill="${CHARCOAL}" stroke="${INK}" stroke-width="6"/>
      <path d="M 132 586 H 380 M 156 586 L 238 714 M 356 586 L 274 714" stroke="${CYAN}" stroke-width="4.5" stroke-opacity="0.75"/>
      <ellipse cx="256" cy="728" rx="156" ry="18" fill="${INK}" fill-opacity="0.24"/>
    `,
    frontFx: `<circle cx="386" cy="142" r="14" fill="none" stroke="${CYAN}" stroke-width="4"/>`,
  },
  {
    slug: 'walking',
    view: 'threeQuarter',
    tilt: -5,
    offsetY: -4,
    backFx: `
      <ellipse cx="256" cy="724" rx="146" ry="16" fill="${INK}" fill-opacity="0.2"/>
      <path d="M 74 696 Q 96 672 126 686 Q 144 668 168 692" fill="none" stroke="${PAPER}" stroke-width="6" stroke-linecap="round"/>
      <path d="M 74 696 Q 96 672 126 686 Q 144 668 168 692" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    `,
    frontFx: `<path d="M 64 360 L 122 360 M 54 392 L 114 392" stroke="${CYAN}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    slug: 'running',
    view: 'side',
    tilt: 10,
    offsetY: -12,
    backFx: `
      <path d="M 28 240 L 154 240 M 18 320 L 138 320 M 42 420 L 166 420 M 24 530 L 146 530" stroke="${MAGENTA}" stroke-width="7" stroke-linecap="round"/>
      <path d="M 44 276 L 148 276 M 32 476 L 142 476" stroke="${CYAN}" stroke-width="5" stroke-linecap="round"/>
    `,
    frontFx: `<path d="${starPath(432, 168, 20, 7, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="3.5"/>`,
  },
  {
    slug: 'jumping',
    view: 'front',
    tilt: -4,
    offsetY: -54,
    backFx: `
      <ellipse cx="256" cy="734" rx="108" ry="13" fill="${INK}" fill-opacity="0.16"/>
      <path d="M 118 688 Q 256 624 394 688" fill="none" stroke="${YELLOW}" stroke-width="7" stroke-linecap="round"/>
      <path d="M 96 540 L 96 640 M 416 540 L 416 640" stroke="${CYAN}" stroke-width="5" stroke-linecap="round"/>
    `,
    frontFx: `
      <path d="${starPath(96, 128, 22, 7, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(418, 146, 20, 7, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>
    `,
  },
  {
    slug: 'waving',
    view: 'front',
    tilt: 3,
    offsetY: -6,
    backFx: `<ellipse cx="256" cy="726" rx="140" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <path d="M 88 186 Q 68 148 92 118 M 70 198 Q 44 148 74 106" fill="none" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/>
      <path d="${starPath(412, 124, 18, 6, 4)}" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'pointing',
    view: 'front',
    tilt: 4,
    offsetY: -4,
    backFx: `<ellipse cx="256" cy="726" rx="138" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <path d="M 358 318 L 464 294 L 444 274 M 464 294 L 444 316" fill="none" stroke="${YELLOW}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${starPath(462, 248, 16, 5, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="3"/>
    `,
  },
  {
    slug: 'reading',
    view: 'threeQuarter',
    tilt: 2,
    offsetY: -8,
    backFx: `<ellipse cx="256" cy="726" rx="142" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <path d="M 294 338 L 366 318 L 418 336 L 346 358 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 346 358 L 418 336 L 418 424 L 346 446 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 294 338 L 346 358 L 346 446 L 294 426 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    `,
  },
  {
    slug: 'gaming',
    view: 'front',
    tilt: -2,
    offsetY: -4,
    backFx: `<ellipse cx="256" cy="726" rx="144" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <rect x="196" y="346" width="120" height="64" rx="18" fill="${CHARCOAL}" stroke="${INK}" stroke-width="5"/>
      <rect x="228" y="358" width="56" height="34" rx="4" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
      <circle cx="214" cy="378" r="8" fill="${YELLOW}"/>
      <circle cx="298" cy="370" r="5" fill="${MAGENTA}"/>
      <circle cx="298" cy="386" r="5" fill="${YELLOW}"/>
    `,
  },
  {
    slug: 'working',
    view: 'side',
    tilt: 5,
    offsetY: -6,
    backFx: `<ellipse cx="256" cy="726" rx="138" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <rect x="318" y="376" width="96" height="62" rx="8" fill="${CHARCOAL}" stroke="${INK}" stroke-width="5"/>
      <rect x="330" y="388" width="72" height="32" rx="4" fill="${CYAN}" stroke="${INK}" stroke-width="3"/>
      <path d="M 336 404 L 352 396 L 366 412 L 382 394 L 396 404" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'holding-objects',
    view: 'front',
    tilt: 0,
    offsetY: -6,
    backFx: `<ellipse cx="256" cy="726" rx="146" ry="18" fill="${INK}" fill-opacity="0.22"/>`,
    frontFx: `
      <rect x="184" y="332" width="144" height="104" rx="10" fill="${YELLOW}" stroke="${INK}" stroke-width="5.5"/>
      <path d="M 184 368 H 328 M 256 332 V 436" stroke="${INK}" stroke-width="4.5"/>
      <path d="M 232 384 L 244 362 L 256 376 L 268 362 L 280 384 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="3.5"/>
    `,
  },
  {
    slug: 'celebrating',
    view: 'front',
    tilt: 3,
    offsetY: -36,
    backFx: `
      <ellipse cx="256" cy="730" rx="124" ry="15" fill="${INK}" fill-opacity="0.18"/>
      <path d="M 88 210 L 146 248 M 424 210 L 366 248 M 82 320 L 144 330 M 430 320 L 368 330" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/>
    `,
    frontFx: `
      <path d="M 218 106 L 230 56 L 256 82 L 282 56 L 294 106 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="${starPath(96, 134, 24, 8, 5)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>
      <path d="${starPath(416, 134, 24, 8, 5)}" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>
    `,
  },
];

const UI_STATES = [
  { slug: 'empty-dashboard', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: CYAN, actor: 'kuro', glyph: '<rect x="260" y="138" width="120" height="86" rx="8" fill="#17171a" stroke="#0d0d0d" stroke-width="5"/><path d="M278 168h84M278 190h56" stroke="#00b8f0" stroke-width="5" stroke-linecap="round"/>' },
  { slug: 'no-search-results', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: YELLOW, actor: 'vesper', glyph: '<circle cx="312" cy="176" r="40" fill="#17171a" stroke="#ffe031" stroke-width="6"/><path d="M342 206l32 32M296 160l32 32M328 160l-32 32" stroke="#ffe031" stroke-width="6" stroke-linecap="round"/>' },
  { slug: 'no-notifications', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: VIOLET, actor: 'kuro', glyph: '<path d="M320 132c-22 0-36 16-36 38v22l-12 16h96l-12-16v-22c0-22-14-38-36-38Z" fill="#17171a" stroke="#c084fc" stroke-width="5"/><path d="M274 134l92 84" stroke="#ff2e88" stroke-width="6" stroke-linecap="round"/>' },
  { slug: 'empty-collection', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: MAGENTA, actor: 'vesper', glyph: '<path d="M258 154h44l14 16h66v58H258Z" fill="#17171a" stroke="#ff2e88" stroke-width="5" stroke-linejoin="round"/><path d="M276 196h88" stroke="#f3efe4" stroke-width="4" stroke-dasharray="6 8"/>' },
  { slug: 'no-favorites', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: MAGENTA, actor: 'kuro', glyph: `<path d="${starPath(320, 182, 46, 20, 5)}" fill="#17171a" stroke="#ff2e88" stroke-width="5.5"/>` },
  { slug: 'no-messages', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: CYAN, actor: 'kuro', glyph: '<rect x="258" y="144" width="124" height="82" rx="8" fill="#17171a" stroke="#00b8f0" stroke-width="5"/><path d="M262 148l58 44 58-44" fill="none" stroke="#00b8f0" stroke-width="5"/>' },
  { slug: 'no-activity', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: YELLOW, actor: 'vesper', glyph: '<path d="M248 188h36l16-34 22 64 18-30h52" fill="none" stroke="#ffe031" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { slug: 'first-time', master: 'scene-onboarding-welcome-master.png', expr: 'excited', accent: YELLOW, actor: 'both', glyph: `<path d="${starPath(320, 176, 42, 14, 4)}" fill="#ffe031" stroke="#0d0d0d" stroke-width="5"/>` },
  { slug: 'loading', master: 'bg-riot-arcade-workbench-master.png', expr: 'thinking', accent: CYAN, actor: 'kuro', glyph: '<circle cx="320" cy="180" r="42" fill="none" stroke="#17171a" stroke-width="10"/><path d="M320 138a42 42 0 0 1 42 42" fill="none" stroke="#00b8f0" stroke-width="10" stroke-linecap="round"/><circle cx="320" cy="180" r="14" fill="#ffe031"/>' },
  { slug: 'success', master: 'scene-quest-victory-master.png', expr: 'celebrating', accent: YELLOW, actor: 'kuro', glyph: '<circle cx="320" cy="180" r="44" fill="#ffe031" stroke="#0d0d0d" stroke-width="6"/><path d="M298 180l16 16 32-36" fill="none" stroke="#0d0d0d" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>' },
  { slug: 'error', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: MAGENTA, actor: 'kuro', glyph: '<polygon points="320,132 370,222 270,222" fill="#ff2e88" stroke="#0d0d0d" stroke-width="6" stroke-linejoin="round"/><path d="M320 162v28" stroke="#0d0d0d" stroke-width="7" stroke-linecap="round"/><circle cx="320" cy="204" r="4.5" fill="#0d0d0d"/>' },
  { slug: 'offline', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: CYAN, actor: 'kuro', glyph: '<path d="M266 168a76 76 0 0 1 108 0M284 190a50 50 0 0 1 72 0" fill="none" stroke="#00b8f0" stroke-width="6" stroke-linecap="round"/><path d="M276 138l88 86" stroke="#ff2e88" stroke-width="7" stroke-linecap="round"/>' },
  { slug: 'network-disconnected', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: MAGENTA, actor: 'vesper', glyph: '<path d="M256 184h42m44 0h42" stroke="#00b8f0" stroke-width="7" stroke-linecap="round"/><rect x="294" y="164" width="16" height="40" rx="3" fill="#ff2e88" stroke="#0d0d0d" stroke-width="4"/><rect x="330" y="164" width="16" height="40" rx="3" fill="#ffe031" stroke="#0d0d0d" stroke-width="4"/>' },
  { slug: 'maintenance', master: 'bg-riot-arcade-workbench-master.png', expr: 'thinking', accent: YELLOW, actor: 'vesper', glyph: '<circle cx="320" cy="180" r="36" fill="#17171a" stroke="#ffe031" stroke-width="7" stroke-dasharray="14 8"/><circle cx="320" cy="180" r="14" fill="#ffe031" stroke="#0d0d0d" stroke-width="4"/>' },
  { slug: 'access-denied', master: 'bg-riot-street-alley-master.png', expr: 'thinking', accent: MAGENTA, actor: 'vesper', glyph: '<rect x="282" y="168" width="76" height="58" rx="8" fill="#17171a" stroke="#ff2e88" stroke-width="6"/><path d="M298 168v-18a22 22 0 0 1 44 0v18" fill="none" stroke="#ff2e88" stroke-width="6"/>' },
  { slug: 'not-found', master: 'bg-riot-street-alley-master.png', expr: 'thinking', accent: VIOLET, actor: 'kuro', glyph: '<circle cx="320" cy="180" r="44" fill="#17171a" stroke="#c084fc" stroke-width="6" stroke-dasharray="16 8"/><path d="M298 158l44 44M342 158l-44 44" stroke="#ffe031" stroke-width="7" stroke-linecap="round"/>' },
  { slug: 'unexpected-failure', master: 'scene-empty-signal-static-master.png', expr: 'thinking', accent: MAGENTA, actor: 'kuro', glyph: '<path d="M326 128l-34 52h32l-12 46 38-58h-32Z" fill="#ff2e88" stroke="#0d0d0d" stroke-width="5" stroke-linejoin="round"/>' },
  { slug: 'welcome', master: 'scene-onboarding-welcome-master.png', expr: 'excited', accent: YELLOW, actor: 'both', glyph: '<path d="M276 218v-72l44-24 44 24v72Z" fill="#17171a" stroke="#ffe031" stroke-width="5"/><circle cx="344" cy="184" r="5" fill="#ffe031"/>' },
  { slug: 'onboarding', master: 'scene-onboarding-welcome-master.png', expr: 'excited', accent: CYAN, actor: 'both', glyph: '<circle cx="320" cy="180" r="42" fill="#17171a" stroke="#00b8f0" stroke-width="6"/><polygon points="320,146 334,180 320,214 306,180" fill="#ffe031" stroke="#0d0d0d" stroke-width="3.5"/>' },
  { slug: 'discover', master: 'scene-onboarding-welcome-master.png', expr: 'excited', accent: CYAN, actor: 'kuro', glyph: '<circle cx="320" cy="180" r="42" fill="#17171a" stroke="#00b8f0" stroke-width="5"/><circle cx="320" cy="180" r="22" fill="none" stroke="#ff2e88" stroke-width="4"/><circle cx="320" cy="180" r="7" fill="#ffe031"/>' },
  { slug: 'explore', master: 'scene-onboarding-welcome-master.png', expr: 'happy', accent: VIOLET, actor: 'vesper', glyph: '<polygon points="274,218 302,146 368,142 340,214" fill="#17171a" stroke="#c084fc" stroke-width="5"/><circle cx="320" cy="180" r="12" fill="#00b8f0"/>' },
  { slug: 'profile', master: 'scene-onboarding-welcome-master.png', expr: 'happy', accent: YELLOW, actor: 'kuro', glyph: '<rect x="266" y="138" width="108" height="84" rx="10" fill="#17171a" stroke="#ffe031" stroke-width="5"/><circle cx="320" cy="168" r="14" fill="#ff2e88"/><path d="M294 206c6-16 46-16 52 0" fill="#00b8f0"/>' },
  { slug: 'achievement', master: 'scene-quest-victory-master.png', expr: 'celebrating', accent: YELLOW, actor: 'kuro', glyph: '<path d="M286 142h68v34c0 22-16 34-34 38-18-4-34-16-34-38Z" fill="#ffe031" stroke="#0d0d0d" stroke-width="5"/><path d="M302 224h36" stroke="#ffe031" stroke-width="8" stroke-linecap="round"/>' },
  { slug: 'completion', master: 'scene-quest-victory-master.png', expr: 'celebrating', accent: CYAN, actor: 'both', glyph: '<path d="M284 136v96M284 138l72 18-72 24Z" fill="#00b8f0" stroke="#00b8f0" stroke-width="6" stroke-linejoin="round"/>' },
  { slug: 'celebration', master: 'scene-quest-victory-master.png', expr: 'celebrating', accent: MAGENTA, actor: 'both', glyph: `<path d="${starPath(320, 178, 44, 16, 5)}" fill="#ffe031" stroke="#0d0d0d" stroke-width="5"/><path d="${starPath(260, 142, 16, 6, 4)}" fill="#ff2e88"/><path d="${starPath(380, 146, 16, 6, 4)}" fill="#00b8f0"/>` },
];

const STICKERS = [
  {
    slug: 'speech-bubble-shout',
    title: 'Riot shout speech bubble sticker',
    body: `<polygon points="128,18 158,58 210,32 198,84 242,108 200,136 226,184 172,174 166,228 124,188 78,236 86,178 24,186 58,136 18,104 68,84 52,32 104,58" fill="${YELLOW}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><polygon points="128,44 150,74 188,54 180,94 212,112 182,132 198,164 160,158 154,196 124,168 92,202 98,162 54,166 78,132 48,108 86,94 74,54 112,74" fill="${PAPER}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
  },
  {
    slug: 'speech-bubble-thought',
    title: 'Thought cloud sticker',
    body: `<path d="M 74 152 C 42 152 28 118 52 94 C 44 62 78 38 112 52 C 134 26 182 32 194 64 C 228 66 238 108 214 132 C 228 158 200 184 172 172 C 150 186 112 180 100 162 C 90 162 82 158 74 152 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><circle cx="72" cy="196" r="14" fill="${CYAN}" stroke="${INK}" stroke-width="6"/><circle cx="46" cy="224" r="9" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>`,
  },
  {
    slug: 'comic-boom',
    title: 'Comic impact burst sticker',
    body: `<path d="${starPath(128, 128, 114, 58, 10)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="${starPath(128, 128, 76, 36, 10)}" fill="${YELLOW}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><circle cx="128" cy="128" r="22" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`,
  },
  {
    slug: 'lightning-bolt',
    title: 'Signal lightning bolt sticker',
    body: `<polygon points="154,16 58,138 118,138 98,240 198,112 138,112" fill="${YELLOW}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><polygon points="144,44 82,126 126,126 112,202 176,122 132,122" fill="${CYAN}" fill-opacity="0.45"/>`,
  },
  {
    slug: 'riot-star',
    title: 'Riot star sticker',
    body: `<path d="${starPath(128, 128, 106, 44, 5)}" fill="${YELLOW}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><path d="${starPath(128, 128, 54, 22, 5)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
  },
  {
    slug: 'street-flame',
    title: 'Street flame sticker',
    body: `<path d="M 134 18 C 168 62 206 94 200 152 C 196 202 166 238 128 238 C 84 238 56 202 58 154 C 60 112 90 92 92 64 C 108 78 118 86 120 106 C 136 82 126 48 134 18 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M 130 98 C 154 128 168 152 162 184 C 158 208 142 222 126 222 C 106 222 94 202 96 178 C 98 154 118 138 130 98 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>`,
  },
  {
    slug: 'pixel-heart',
    title: 'Pixel heart sticker',
    body: `<path d="M 48 56 H 104 V 80 H 152 V 56 H 208 V 112 H 184 V 144 H 160 V 176 H 136 V 208 H 120 V 176 H 96 V 144 H 72 V 112 H 48 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="8" stroke-linejoin="miter"/><rect x="70" y="78" width="22" height="22" fill="${PAPER}"/>`,
  },
  {
    slug: 'hand-arrow',
    title: 'Hand-inked arrow sticker',
    body: `<path d="M 24 148 L 148 112 L 134 70 L 234 106 L 166 192 L 154 150 L 34 184 Z" fill="${CYAN}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
  },
  {
    slug: 'paint-splash',
    title: 'Paint splash sticker',
    body: `<path d="M 122 52 C 152 44 176 66 196 58 C 212 52 220 74 202 94 C 224 114 218 148 192 154 C 198 184 174 208 148 194 C 130 220 94 212 88 182 C 58 188 40 158 62 134 C 38 114 52 80 82 84 C 86 58 104 56 122 52 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="7"/><circle cx="44" cy="54" r="14" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/><circle cx="216" cy="196" r="12" fill="${CYAN}" stroke="${INK}" stroke-width="5"/><circle cx="204" cy="40" r="9" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'motion-burst',
    title: 'Comic motion burst sticker',
    body: `<path d="M 128 18 L 128 62 M 128 194 L 128 238 M 18 128 L 62 128 M 194 128 L 238 128 M 48 48 L 82 82 M 174 174 L 208 208 M 208 48 L 174 82 M 82 174 L 48 208" stroke="${INK}" stroke-width="14" stroke-linecap="round"/><path d="M 128 18 L 128 62 M 128 194 L 128 238 M 18 128 L 62 128 M 194 128 L 238 128 M 48 48 L 82 82 M 174 174 L 208 208 M 208 48 L 174 82 M 82 174 L 48 208" stroke="${YELLOW}" stroke-width="7" stroke-linecap="round"/><circle cx="128" cy="128" r="32" fill="${CYAN}" stroke="${INK}" stroke-width="7"/>`,
  },
  {
    slug: 'torn-tape-x',
    title: 'Torn masking tape cross sticker',
    body: `<path d="M 38 64 L 68 34 L 218 184 L 188 214 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M 188 34 L 218 64 L 68 214 L 38 184 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><circle cx="128" cy="124" r="10" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'graffiti-crown',
    title: 'MoonWitness crown sticker',
    body: `<path d="M 30 194 L 44 64 L 96 122 L 128 46 L 160 122 L 212 64 L 226 194 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><rect x="36" y="198" width="184" height="24" rx="6" fill="${MAGENTA}" stroke="${INK}" stroke-width="7"/>`,
  },
];

const GAME_ASSETS = [
  {
    slug: 'avatar-kuro',
    w: 256,
    h: 256,
    title: 'Kuro avatar medallion',
    avatarKey: 'kuro',
    body: `<circle cx="128" cy="128" r="112" fill="${CHARCOAL}" stroke="${INK}" stroke-width="10"/><circle cx="128" cy="128" r="96" fill="${CYAN}" fill-opacity="0.22" stroke="${YELLOW}" stroke-width="6"/><path d="M 80 186 C 84 146 172 146 176 186 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="6"/><circle cx="128" cy="110" r="40" fill="${PAPER}" stroke="${INK}" stroke-width="6"/><path d="M 88 106 C 92 64 164 64 168 106 L 154 96 L 138 108 L 122 94 L 104 108 Z" fill="${INK}"/>`,
  },
  {
    slug: 'avatar-vesper',
    w: 256,
    h: 256,
    title: 'Vesper avatar medallion',
    avatarKey: 'vesper',
    body: `<circle cx="128" cy="128" r="112" fill="${CHARCOAL}" stroke="${INK}" stroke-width="10"/><circle cx="128" cy="128" r="96" fill="${VIOLET}" fill-opacity="0.22" stroke="${VIOLET}" stroke-width="6"/><path d="M 84 186 C 90 148 166 148 172 186 Z" fill="${CHARCOAL}" stroke="${INK}" stroke-width="6"/><circle cx="128" cy="112" r="38" fill="${PAPER}" stroke="${INK}" stroke-width="6"/><circle cx="110" cy="84" r="14" fill="${VIOLET}" stroke="${INK}" stroke-width="4"/><circle cx="146" cy="84" r="14" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'avatar-frame-riot',
    w: 256,
    h: 256,
    title: 'Signal Riot avatar frame',
    body: `<circle cx="128" cy="128" r="112" fill="none" stroke="${INK}" stroke-width="16"/><circle cx="128" cy="128" r="112" fill="none" stroke="${YELLOW}" stroke-width="8" stroke-dasharray="48 16"/><circle cx="128" cy="128" r="98" fill="none" stroke="${MAGENTA}" stroke-width="5"/><path d="${starPath(206, 48, 22, 8, 4)}" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'badge-signal-scout',
    w: 256,
    h: 256,
    title: 'Signal Scout badge',
    body: `<polygon points="128,18 224,68 206,192 128,238 50,192 32,68" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><polygon points="128,36 206,78 190,180 128,218 66,180 50,78" fill="none" stroke="${CYAN}" stroke-width="5"/><circle cx="128" cy="132" r="44" fill="none" stroke="${CYAN}" stroke-width="6"/><circle cx="128" cy="132" r="22" fill="none" stroke="${YELLOW}" stroke-width="5"/><circle cx="128" cy="132" r="8" fill="${MAGENTA}"/>`,
  },
  {
    slug: 'badge-archive-keeper',
    w: 256,
    h: 256,
    title: 'Archive Keeper badge',
    body: `<polygon points="128,18 224,68 206,192 128,238 50,192 32,68" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><rect x="82" y="76" width="92" height="106" rx="8" fill="${PAPER}" stroke="${INK}" stroke-width="6"/><path d="M 100 104 H 156 M 100 126 H 156 M 100 148 H 138" stroke="${VIOLET}" stroke-width="7" stroke-linecap="round"/><rect x="148" y="64" width="32" height="18" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'badge-story-architect',
    w: 256,
    h: 256,
    title: 'Story Architect badge',
    body: `<polygon points="128,18 224,68 206,192 128,238 50,192 32,68" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><path d="M 76 178 L 166 88 L 188 110 L 98 200 L 70 206 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="${starPath(94, 92, 22, 8, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'badge-zero-drift',
    w: 256,
    h: 256,
    title: 'Zero Drift badge',
    body: `<polygon points="128,18 224,68 206,192 128,238 50,192 32,68" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><circle cx="128" cy="128" r="52" fill="${YELLOW}" stroke="${INK}" stroke-width="6"/><path d="M 100 128 L 120 148 L 160 104" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    slug: 'rank-rookie',
    w: 256,
    h: 256,
    title: 'Rookie rank chevron',
    body: `<polygon points="128,26 218,86 218,176 128,230 38,176 38,86" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9"/><path d="M 76 146 L 128 96 L 180 146" fill="none" stroke="${CYAN}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    slug: 'rank-vanguard',
    w: 256,
    h: 256,
    title: 'Vanguard rank dual chevron',
    body: `<polygon points="128,26 218,86 218,176 128,230 38,176 38,86" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9"/><path d="M 74 126 L 128 78 L 182 126 M 74 170 L 128 122 L 182 170" fill="none" stroke="${MAGENTA}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    slug: 'rank-legend',
    w: 256,
    h: 256,
    title: 'Legend rank crown emblem',
    body: `<polygon points="128,20 222,74 222,182 128,236 34,182 34,74" fill="${CHARCOAL}" stroke="${INK}" stroke-width="9"/><path d="M 68 172 L 80 94 L 108 128 L 128 80 L 148 128 L 176 94 L 188 172 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="${starPath(128, 52, 16, 6, 4)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="3.5"/>`,
  },
  {
    slug: 'quest-banner',
    w: 512,
    h: 192,
    title: 'Riot quest banner ribbon',
    body: `<path d="M 22 44 L 68 44 L 54 148 L 22 148 L 40 96 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M 490 44 L 444 44 L 458 148 L 490 148 L 472 96 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><rect x="52" y="28" width="408" height="120" rx="12" fill="${YELLOW}" stroke="${INK}" stroke-width="8"/><path d="M 72 50 H 440 M 72 126 H 440" stroke="${INK}" stroke-width="3" stroke-dasharray="10 8"/><path d="${starPath(106, 88, 24, 9, 5)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/><path d="${starPath(406, 88, 24, 9, 5)}" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    slug: 'reward-crate',
    w: 256,
    h: 256,
    title: 'Signal reward crate',
    body: `<rect x="44" y="88" width="168" height="130" rx="12" fill="${CHARCOAL}" stroke="${INK}" stroke-width="8"/><rect x="34" y="62" width="188" height="38" rx="8" fill="${YELLOW}" stroke="${INK}" stroke-width="8"/><rect x="114" y="62" width="28" height="156" fill="${MAGENTA}" stroke="${INK}" stroke-width="6"/><path d="M 102 62 C 82 32 118 22 128 56 C 138 22 174 32 154 62 Z" fill="${CYAN}" stroke="${INK}" stroke-width="5"/>`,
  },
  {
    slug: 'level-up-burst',
    w: 256,
    h: 256,
    title: 'Level up burst badge',
    body: `<path d="${starPath(128, 128, 112, 66, 8)}" fill="${YELLOW}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><circle cx="128" cy="128" r="56" fill="${MAGENTA}" stroke="${INK}" stroke-width="6"/><path d="M 128 84 L 160 124 H 140 V 168 H 116 V 124 H 96 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
  },
];

const ANIMATION_CLIPS = [
  { id: 'idle', masterKey: 'happy', durationMs: 260, direction: 'ping-pong', bob: [0, -6, -3, 0], tilt: [0, -1, 1, 0], fx: (i) => `<circle cx="386" cy="94" r="${8 + i * 2}" fill="${CYAN}" fill-opacity="${0.4 + i * 0.15}" stroke="${INK}" stroke-width="3"/>` },
  { id: 'blink', masterKey: 'happy', durationMs: 180, direction: 'forward', bob: [0, 2, 3, 0], tilt: [0, 0.5, 0, 0], fx: (i) => i === 1 || i === 2 ? `<path d="M 206 206 Q 232 218 254 206 M 280 206 Q 304 218 324 206" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><circle cx="404" cy="108" r="${7 + i * 2}" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>` : `<path d="${starPath(406, 108, 12 + i * 2, 4, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>` },
  { id: 'wave', masterKey: 'excited', durationMs: 200, direction: 'ping-pong', bob: [0, -8, -4, 0], tilt: [-3, 3, -2, 0], fx: (i) => `<path d="M ${84 - i * 4} 174 Q 64 136 ${88 + i * 4} 108" fill="none" stroke="${YELLOW}" stroke-width="6" stroke-linecap="round"/><path d="M ${66 - i * 4} 188 Q 42 138 ${70 + i * 4} 96" fill="none" stroke="${MAGENTA}" stroke-width="5" stroke-linecap="round"/>` },
  { id: 'celebrate', masterKey: 'celebrating', durationMs: 180, direction: 'forward', bob: [0, -16, -24, -8], tilt: [-3, 2, 4, -1], fx: (i) => `<path d="${starPath(94 + i * 6, 108 - i * 4, 22, 8, 5)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/><path d="${starPath(422 - i * 6, 114 - i * 4, 22, 8, 5)}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4"/>` },
  { id: 'think', masterKey: 'thinking', durationMs: 280, direction: 'ping-pong', bob: [0, -3, -5, -2], tilt: [-4, -6, -5, -3], fx: (i) => `<circle cx="386" cy="168" r="${6 + i}" fill="${PAPER}" stroke="${INK}" stroke-width="3.5"/><circle cx="412" cy="136" r="${10 + i * 2}" fill="${PAPER}" stroke="${INK}" stroke-width="4"/><circle cx="436" cy="100" r="${14 + i * 2}" fill="${CYAN}" stroke="${INK}" stroke-width="4"/>` },
  { id: 'loading', masterKey: 'thinking', durationMs: 180, direction: 'forward', bob: [0, -4, 0, 4], tilt: [0, 1, 0, -1], fx: (i) => `<g transform="rotate(${i * 90} 418 122)"><circle cx="418" cy="122" r="24" fill="none" stroke="${INK}" stroke-width="7"/><path d="M 418 98 A 24 24 0 0 1 442 122" fill="none" stroke="${CYAN}" stroke-width="7" stroke-linecap="round"/></g>` },
  { id: 'success', masterKey: 'celebrating', durationMs: 200, direction: 'forward', bob: [0, -10, -14, -4], tilt: [0, 2, 3, 1], fx: (i) => `<circle cx="414" cy="126" r="${22 + i * 3}" fill="${YELLOW}" stroke="${INK}" stroke-width="4.5"/><path d="M 402 126 L 412 136 L 428 114" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'error', masterKey: 'happy', durationMs: 160, direction: 'ping-pong', bob: [0, 4, -4, 2], tilt: [-4, 4, -3, 2], fx: (i) => `<polygon points="414,${86 + i * 2} 444,${144 + i * 2} 384,${144 + i * 2}" fill="${MAGENTA}" stroke="${INK}" stroke-width="4.5"/><path d="M 414 ${106 + i * 2} V ${124 + i * 2}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="414" cy="${134 + i * 2}" r="3" fill="${INK}"/>` },
];

async function placeOnCanvas(width, height, fgBuf, offsetY = 0) {
  const fgMeta = await sharp(fgBuf).metadata();
  const canvasW = Math.max(width, fgMeta.width + 40);
  const canvasH = Math.max(height, fgMeta.height + Math.abs(offsetY) * 2 + 40);
  const left = Math.round((canvasW - fgMeta.width) / 2);
  const top = Math.round((canvasH - fgMeta.height) / 2 + offsetY);
  const extractLeft = Math.round((canvasW - width) / 2);
  const extractTop = Math.round((canvasH - height) / 2);
  return sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fgBuf, left, top }])
    .extract({ left: extractLeft, top: extractTop, width, height })
    .png()
    .toBuffer();
}

async function buildCompositePortrait(cutoutBuf, { size = 512, tilt = 0, scale = 1, offsetY = 0, tint = null, overlaySvg = '', background = { r: 0, g: 0, b: 0, alpha: 0 } }) {
  const innerSize = Math.round(size * 0.84 * scale);
  let fg = sharp(cutoutBuf).resize(innerSize, innerSize, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (tilt !== 0) {
    fg = fg.rotate(tilt, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  if (tint) {
    fg = fg.modulate(tint);
  }
  const positionedFg = await placeOnCanvas(size, size, await fg.png().toBuffer(), offsetY);

  const composites = [{ input: positionedFg, left: 0, top: 0 }];
  if (overlaySvg) {
    const overlayBuf = await svgBuffer(size, size, overlaySvg);
    composites.push({ input: overlayBuf, left: 0, top: 0 });
  }

  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
    .toBuffer();
}

async function encodeWebpWithinBudget(buildPipeline, maxBytes, qualities) {
  let smallest = null;
  for (const quality of qualities) {
    const buf = await buildPipeline().webp({ quality, effort: 6 }).toBuffer();
    if (!smallest || buf.length < smallest.length) smallest = buf;
    if (buf.length <= maxBytes) return buf;
  }
  return smallest;
}

async function main() {
  const manifestPath = resolve(packageRoot, 'manifest.json');
  const licensesPath = resolve(packageRoot, 'licenses.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const licenses = JSON.parse(await readFile(licensesPath, 'utf8'));

  const riotSourceDir = resolve(packageRoot, 'source/artwork/riot-universe');
  const kuroModelPath = resolve(riotSourceDir, 'kuro-signal-model-sheet-master.png');
  const kuroHappyPath = resolve(riotSourceDir, 'kuro-signal-portrait-happy-master.png');
  const kuroExcitedPath = resolve(riotSourceDir, 'kuro-signal-portrait-excited-master.png');
  const kuroThinkingPath = resolve(riotSourceDir, 'kuro-signal-portrait-thinking-master.png');
  const kuroCelebratingPath = resolve(riotSourceDir, 'kuro-signal-portrait-celebrating-master.png');
  const kuroFullbodyPath = resolve(riotSourceDir, 'kuro-signal-fullbody-standing-master.png');
  const vesperPortraitPath = resolve(riotSourceDir, 'vesper-ink-portrait-master.png');

  stdout.write('Keying character masters via 4-edge exterior flood-fill...\n');
  const [
    kuroPortraitHappyCutout,
    kuroPortraitExcitedCutout,
    kuroPortraitThinkingCutout,
    kuroPortraitCelebratingCutout,
    kuroFullbodyStandingCutout,
    vesperPortraitCutout,
    kuroSideCutout,
    kuroThreeQuarterCutout,
  ] = await Promise.all([
    floodFillCutout(kuroHappyPath),
    floodFillCutout(kuroExcitedPath),
    floodFillCutout(kuroThinkingPath),
    floodFillCutout(kuroCelebratingPath),
    floodFillCutout(kuroFullbodyPath),
    floodFillCutout(vesperPortraitPath),
    floodFillCutout(kuroModelPath, { left: 614, top: 44, width: 208, height: 710 }),
    floodFillCutout(kuroModelPath, { left: 988, top: 38, width: 268, height: 722 }),
  ]);

  const expressionCutouts = {
    happy: kuroPortraitHappyCutout,
    excited: kuroPortraitExcitedCutout,
    thinking: kuroPortraitThinkingCutout,
    celebrating: kuroPortraitCelebratingCutout,
  };

  const viewCutouts = {
    front: kuroFullbodyStandingCutout,
    side: kuroSideCutout,
    threeQuarter: kuroThreeQuarterCutout,
  };

  const generated = [];
  const sourceProvenance = [];

  // 1. Register all 12 Direct AI Source Masters + synthesize the 2 procedural halftone masters
  const existingMasters = [
    {
      path: 'source/artwork/riot-universe/kuro-signal-model-sheet-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white sheet for Signal Riot character pipeline',
      modifications: 'Unaltered 3-view character turnaround master (front, side, 3/4) for kuro-signal.',
    },
    {
      path: 'source/artwork/riot-universe/kuro-signal-portrait-happy-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI happy bust portrait master for kuro-signal (normalized 1024x1024 RGB on #ffffff).',
    },
    {
      path: 'source/artwork/riot-universe/kuro-signal-portrait-excited-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI excited bust portrait master for kuro-signal (normalized 1024x1024 RGB on #ffffff).',
    },
    {
      path: 'source/artwork/riot-universe/kuro-signal-portrait-thinking-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI thinking bust portrait master for kuro-signal (normalized 1024x1024 RGB on #ffffff).',
    },
    {
      path: 'source/artwork/riot-universe/kuro-signal-portrait-celebrating-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI celebrating bust portrait master for kuro-signal (normalized 1024x1024 RGB on #ffffff).',
    },
    {
      path: 'source/artwork/riot-universe/kuro-signal-fullbody-standing-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI full-body standing master for kuro-signal (normalized 1024x1536 RGB contain on #ffffff).',
    },
    {
      path: 'source/artwork/riot-universe/vesper-ink-portrait-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation on solid white backdrop for Signal Riot character pipeline',
      modifications: 'Direct AI bust portrait master for vesper-ink.',
    },
    {
      path: 'source/artwork/riot-universe/bg-riot-street-alley-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation for Signal Riot nocturnal street alley environment',
      modifications: 'Direct AI 1376x768 landscape master for Signal Riot street alley backdrop.',
    },
    {
      path: 'source/artwork/riot-universe/bg-riot-arcade-workbench-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation for Signal Riot arcade studio workbench environment',
      modifications: 'Direct AI 1376x768 landscape master for Signal Riot arcade workbench backdrop.',
    },
    {
      path: 'source/artwork/riot-universe/scene-empty-signal-static-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation for Signal Riot empty/offline/static scene states',
      modifications: 'Direct AI 1376x768 narrative scene master for empty-signal-static.',
    },
    {
      path: 'source/artwork/riot-universe/scene-onboarding-welcome-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation for Signal Riot onboarding/welcome scene states',
      modifications: 'Direct AI 1376x768 narrative scene master for onboarding-welcome.',
    },
    {
      path: 'source/artwork/riot-universe/scene-quest-victory-master.png',
      creator: 'Google Gemini image generation, commissioned by MoonWitness contributors',
      source: 'Direct AI master generation for Signal Riot quest victory/celebration scene states',
      modifications: 'Direct AI 1376x768 narrative scene master for quest-victory.',
    },
  ];
  for (const item of existingMasters) {
    const meta = await sharp(resolve(packageRoot, item.path)).metadata();
    generated.push({
      path: item.path,
      kind: 'source',
      variant: 'riot-universe-master',
      format: 'png',
      width: meta.width,
      height: meta.height,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'MoonWitness Commissioned Asset (ISC pipeline)',
      source: 'packages/assets/scripts/generate-riot-universe.mjs',
    });
    sourceProvenance.push({
      path: item.path,
      creator: item.creator,
      source: item.source,
      license: 'MoonWitness Commissioned Asset (ISC pipeline)',
      termsVerified: true,
      modifications: item.modifications,
      status: 'approved',
      distribution: 'approved source master for MoonWitness Signal Riot asset pipeline',
    });
  }

  // 2. Backgrounds (2 Direct AI -> WebP + 2 procedural halftone masters -> WebP, <= 220 KB)
  const MAX_BG_BYTES = 220 * 1024;
  for (const slug of ['riot-street-alley', 'riot-arcade-workbench']) {
    const masterRel = `source/artwork/riot-universe/bg-${slug}-master.png`;
    const webpRel = `illustrations/riot-universe/backgrounds/bg-${slug}.webp`;
    const masterAbs = resolve(packageRoot, masterRel);
    const webpBuf = await encodeWebpWithinBudget(
      () => sharp(masterAbs).resize(1376, 768, { fit: 'cover', position: 'centre' }),
      MAX_BG_BYTES,
      [78, 66, 54, 44]
    );
    await atomicWrite(resolve(packageRoot, webpRel), webpBuf);
    generated.push({
      path: webpRel,
      kind: 'background',
      variant: slug,
      format: 'webp',
      width: 1376,
      height: 768,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'MoonWitness Commissioned Asset (ISC pipeline)',
      source: masterRel,
      sourceAsset: masterRel,
    });
  }

  const proceduralBgSpecs = [
    {
      slug: 'halftone-paper-light',
      notes: 'Procedural warm newsprint zine texture (#f3efe4) with Ben-Day halftone dots and corner registration marks.',
      baseColor: { r: 243, g: 239, b: 228, alpha: 1 },
      overlay: `
        ${halftoneDots(44, 24, 16, 16, 32, 2.2, INK, 0.08)}
        ${halftoneDots(20, 12, 740, 380, 32, 3.2, MAGENTA, 0.07)}
        <path d="M 28 58 L 28 28 L 58 28 M 1348 58 L 1348 28 L 1318 28 M 28 710 L 28 740 L 58 740 M 1348 710 L 1348 740 L 1318 740" fill="none" stroke="${INK}" stroke-opacity="0.24" stroke-width="3"/>
      `,
    },
    {
      slug: 'halftone-ink-dark',
      notes: 'Procedural charcoal zine backdrop (#0e0e10) with subtle halftone grid and cyan/magenta rim vignette.',
      baseColor: { r: 14, g: 14, b: 16, alpha: 1 },
      overlay: `
        ${halftoneDots(44, 24, 16, 16, 32, 2.2, PAPER, 0.07)}
        ${halftoneDots(18, 10, 820, 40, 30, 3, CYAN, 0.09)}
        <rect x="18" y="18" width="1340" height="732" fill="none" stroke="${MAGENTA}" stroke-opacity="0.18" stroke-width="3"/>
      `,
    },
  ];

  for (const bg of proceduralBgSpecs) {
    const masterRel = `source/artwork/riot-universe/bg-${bg.slug}-master.png`;
    const webpRel = `illustrations/riot-universe/backgrounds/bg-${bg.slug}.webp`;
    const overlayBuf = await svgBuffer(1376, 768, bg.overlay);
    const masterBuf = await sharp({ create: { width: 1376, height: 768, channels: 4, background: bg.baseColor } })
      .composite([{ input: overlayBuf, left: 0, top: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await atomicWrite(resolve(packageRoot, masterRel), masterBuf);
    const webpBuf = await encodeWebpWithinBudget(
      () => sharp(masterBuf),
      MAX_BG_BYTES,
      [78, 66, 54, 44]
    );
    await atomicWrite(resolve(packageRoot, webpRel), webpBuf);

    generated.push({
      path: masterRel,
      kind: 'source',
      variant: 'riot-universe-background-master',
      format: 'png',
      width: 1376,
      height: 768,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'ISC',
      source: 'packages/assets/scripts/generate-riot-universe.mjs',
    });
    sourceProvenance.push({
      path: masterRel,
      creator: 'MoonWitness contributors',
      source: 'Procedural comic-halftone SVG/sharp rasterizer',
      license: 'ISC',
      termsVerified: true,
      modifications: bg.notes,
      status: 'approved',
      distribution: 'approved source master for MoonWitness Signal Riot asset pipeline',
    });
    generated.push({
      path: webpRel,
      kind: 'background',
      variant: bg.slug,
      format: 'webp',
      width: 1376,
      height: 768,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'ISC',
      source: masterRel,
      sourceAsset: masterRel,
    });
  }

  // 3. 16 Kuro Expressions (512x512 PNG + WebP)
  stdout.write('Generating 16 Kuro expression cutouts (.png + .webp)...\n');
  for (const expr of EXPRESSIONS) {
    const cutout = expressionCutouts[expr.masterKey];
    const sourceMasterRel = EXPRESSION_MASTERS[expr.masterKey];
    const pngBuf = await buildCompositePortrait(cutout, {
      size: 512,
      tilt: expr.tilt,
      scale: expr.scale,
      offsetY: expr.offsetY,
      tint: expr.tint,
      overlaySvg: expr.overlay,
    });
    const webpBuf = await sharp(pngBuf).webp({ quality: 86, alphaQuality: 96, effort: 6 }).toBuffer();
    const pngRel = `illustrations/riot-universe/characters/kuro-signal-expression-${expr.slug}.png`;
    const webpRel = `illustrations/riot-universe/characters/kuro-signal-expression-${expr.slug}.webp`;
    await atomicWrite(resolve(packageRoot, pngRel), pngBuf);
    await atomicWrite(resolve(packageRoot, webpRel), webpBuf);
    for (const [path, format] of [[pngRel, 'png'], [webpRel, 'webp']]) {
      generated.push({
        path,
        kind: 'character-sprite',
        variant: `expression-${expr.slug}`,
        subject: 'kuro-signal',
        format,
        width: 512,
        height: 512,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'MoonWitness Commissioned Asset (ISC pipeline)',
        source: sourceMasterRel,
        sourceAsset: sourceMasterRel,
      });
    }
  }

  // 4. 12 Kuro Poses (512x768 PNG + WebP)
  stdout.write('Generating 12 Kuro full-body pose cutouts (.png + .webp)...\n');
  for (const pose of POSES) {
    const baseCutout = viewCutouts[pose.view];
    const poseSourceRel =
      pose.view === 'front'
        ? 'source/artwork/riot-universe/kuro-signal-fullbody-standing-master.png'
        : 'source/artwork/riot-universe/kuro-signal-model-sheet-master.png';
    let fg = sharp(baseCutout).resize(400, 640, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (pose.tilt !== 0) fg = fg.rotate(pose.tilt, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const positionedFg = await placeOnCanvas(512, 768, await fg.png().toBuffer(), pose.offsetY);
    const composites = [];
    if (pose.backFx) composites.push({ input: await svgBuffer(512, 768, pose.backFx), left: 0, top: 0 });
    composites.push({ input: positionedFg, left: 0, top: 0 });
    if (pose.frontFx) composites.push({ input: await svgBuffer(512, 768, pose.frontFx), left: 0, top: 0 });

    const pngBuf = await sharp({
      create: { width: 512, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(composites)
      .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
      .toBuffer();
    const webpBuf = await sharp(pngBuf).webp({ quality: 86, alphaQuality: 96, effort: 6 }).toBuffer();

    const pngRel = `illustrations/riot-universe/characters/kuro-signal-pose-${pose.slug}.png`;
    const webpRel = `illustrations/riot-universe/characters/kuro-signal-pose-${pose.slug}.webp`;
    await atomicWrite(resolve(packageRoot, pngRel), pngBuf);
    await atomicWrite(resolve(packageRoot, webpRel), webpBuf);
    for (const [path, format] of [[pngRel, 'png'], [webpRel, 'webp']]) {
      generated.push({
        path,
        kind: 'character-sprite',
        variant: `pose-${pose.slug}`,
        subject: 'kuro-signal',
        format,
        width: 512,
        height: 768,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'MoonWitness Commissioned Asset (ISC pipeline)',
        source: poseSourceRel,
        sourceAsset: poseSourceRel,
      });
    }
  }

  // 5. Vesper portrait (512x512 PNG + WebP)
  {
    const pngBuf = await buildCompositePortrait(vesperPortraitCutout, { size: 512, scale: 1.06, offsetY: 16 });
    const webpBuf = await sharp(pngBuf).webp({ quality: 86, alphaQuality: 96, effort: 6 }).toBuffer();
    const pngRel = 'illustrations/riot-universe/characters/vesper-ink-portrait.png';
    const webpRel = 'illustrations/riot-universe/characters/vesper-ink-portrait.webp';
    await atomicWrite(resolve(packageRoot, pngRel), pngBuf);
    await atomicWrite(resolve(packageRoot, webpRel), webpBuf);
    for (const [path, format] of [[pngRel, 'png'], [webpRel, 'webp']]) {
      generated.push({
        path,
        kind: 'character-sprite',
        variant: 'portrait',
        subject: 'vesper-ink',
        format,
        width: 512,
        height: 512,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'MoonWitness Commissioned Asset (ISC pipeline)',
        source: 'source/artwork/riot-universe/vesper-ink-portrait-master.png',
        sourceAsset: 'source/artwork/riot-universe/vesper-ink-portrait-master.png',
      });
    }
  }

  // 6. 25 UI States (640x480 WebP <= 160 KB)
  stdout.write('Generating 25 UI state vignettes (.webp)...\n');
  const MAX_STATE_BYTES = 160 * 1024;
  for (const state of UI_STATES) {
    const rel = `illustrations/riot-universe/states/state-${state.slug}.webp`;
    const masterRel = `source/artwork/riot-universe/${state.master}`;
    const overlaySvg = `
      <rect x="0" y="0" width="640" height="480" fill="${NIGHT}" fill-opacity="0.48"/>
      <rect x="16" y="16" width="608" height="448" rx="14" fill="none" stroke="${state.accent}" stroke-width="5"/>
      <rect x="24" y="24" width="592" height="432" rx="10" fill="none" stroke="${INK}" stroke-width="4"/>
      ${halftoneDots(12, 5, 36, 36, 22, 2, state.accent, 0.2)}
      ${state.glyph}
    `;
    const composites = [{ input: await svgBuffer(640, 480, overlaySvg), left: 0, top: 0 }];
    if (state.actor === 'kuro' || state.actor === 'both') {
      const kuroCutout = expressionCutouts[state.expr];
      const kBuf = await sharp(kuroCutout).resize(240, 240, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      composites.push({ input: kBuf, left: state.actor === 'both' ? 40 : 28, top: 218 });
    }
    if (state.actor === 'vesper' || state.actor === 'both') {
      const vBuf = await sharp(vesperPortraitCutout).resize(230, 230, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      composites.push({ input: vBuf, left: state.actor === 'both' ? 378 : 386, top: 226 });
    }
    const masterAbs = resolve(packageRoot, masterRel);
    const webpBuf = await encodeWebpWithinBudget(
      () =>
        sharp(masterAbs)
          .resize(640, 480, { fit: 'cover', position: 'centre' })
          .composite(composites),
      MAX_STATE_BYTES,
      [80, 68, 56, 44]
    );
    await atomicWrite(resolve(packageRoot, rel), webpBuf);
    generated.push({
      path: rel,
      kind: 'state-illustration',
      variant: state.slug,
      format: 'webp',
      width: 640,
      height: 480,
      pack: 'riot-universe',
      domain: 'ui-states',
      status: 'approved',
      license: 'MoonWitness Commissioned Asset (ISC pipeline)',
      source: masterRel,
      sourceAsset: masterRel,
    });
  }

  // 7. 12 Stickers (256x256 .svg + transparent .png)
  stdout.write('Generating 12 comic stickers (.svg + .png)...\n');
  for (const sticker of STICKERS) {
    const svgRel = `illustrations/riot-universe/stickers/sticker-${sticker.slug}.svg`;
    const pngRel = `illustrations/riot-universe/stickers/sticker-${sticker.slug}.png`;
    const svgText = wrapSvg(svgRel, 256, 256, sticker.title, sticker.body);
    await atomicWrite(resolve(packageRoot, svgRel), svgText);
    const pngBuf = await sharp(Buffer.from(svgText, 'utf8')).resize(256, 256).png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer();
    await atomicWrite(resolve(packageRoot, pngRel), pngBuf);
    generated.push(
      {
        path: svgRel,
        kind: 'sticker',
        variant: sticker.slug,
        format: 'svg',
        width: 256,
        height: 256,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'ISC',
        source: 'packages/assets/scripts/generate-riot-universe.mjs',
      },
      {
        path: pngRel,
        kind: 'sticker',
        variant: sticker.slug,
        format: 'png',
        width: 256,
        height: 256,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'ISC',
        source: svgRel,
        sourceAsset: svgRel,
      }
    );
  }

  // 8. 13 Game & Badges (.svg + transparent .png)
  stdout.write('Generating 13 game badges, ranks & avatars (.svg + .png)...\n');
  for (const item of GAME_ASSETS) {
    const svgRel = `illustrations/riot-universe/game/${item.slug}.svg`;
    const pngRel = `illustrations/riot-universe/game/${item.slug}.png`;
    const svgText = wrapSvg(svgRel, item.w, item.h, item.title, item.body);
    await atomicWrite(resolve(packageRoot, svgRel), svgText);

    let pngBuf;
    if (item.avatarKey) {
      const portrait = item.avatarKey === 'kuro' ? kuroPortraitHappyCutout : vesperPortraitCutout;
      const ringSvg = `<circle cx="128" cy="128" r="112" fill="${CHARCOAL}" stroke="${INK}" stroke-width="10"/><circle cx="128" cy="128" r="98" fill="${item.avatarKey === 'kuro' ? CYAN : VIOLET}" fill-opacity="0.22" stroke="${item.avatarKey === 'kuro' ? YELLOW : VIOLET}" stroke-width="6"/>`;
      const faceBuf = await sharp(portrait).resize(184, 184, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const frontRing = `<circle cx="128" cy="128" r="108" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="128" cy="128" r="100" fill="none" stroke="${item.avatarKey === 'kuro' ? YELLOW : VIOLET}" stroke-width="4"/>`;
      pngBuf = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: await svgBuffer(256, 256, ringSvg), left: 0, top: 0 },
          { input: faceBuf, left: 36, top: 44 },
          { input: await svgBuffer(256, 256, frontRing), left: 0, top: 0 },
        ])
        .png({ compressionLevel: 9, palette: true, quality: 92 })
        .toBuffer();
    } else {
      pngBuf = await sharp(Buffer.from(svgText, 'utf8')).resize(item.w, item.h).png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer();
    }

    await atomicWrite(resolve(packageRoot, pngRel), pngBuf);
    generated.push(
      {
        path: svgRel,
        kind: 'game-asset',
        variant: item.slug,
        format: 'svg',
        width: item.w,
        height: item.h,
        pack: 'riot-universe',
        domain: 'gamification',
        status: 'approved',
        license: 'ISC',
        source: 'packages/assets/scripts/generate-riot-universe.mjs',
      },
      {
        path: pngRel,
        kind: 'game-asset',
        variant: item.slug,
        format: 'png',
        width: item.w,
        height: item.h,
        pack: 'riot-universe',
        domain: 'gamification',
        status: 'approved',
        license: 'ISC',
        source: svgRel,
        sourceAsset: svgRel,
      }
    );
  }

  // 9. 8 Kuro Animation Clips (4 x 512x512 PNG frames + 1024x1024 2x2 PNG sheet + clip JSON)
  stdout.write('Generating 8 Kuro animation clips (frames + 2x2 sheets + clip JSON)...\n');
  for (const clipSpec of ANIMATION_CLIPS) {
    const dirRel = `animation/kuro-signal-${clipSpec.id}`;
    const sheetRel = `${dirRel}/kuro-signal-${clipSpec.id}-sheet.png`;
    const clipRel = `${dirRel}/kuro-signal-${clipSpec.id}-clip.json`;
    const clipCutout = expressionCutouts[clipSpec.masterKey];
    const clipSourceRel = EXPRESSION_MASTERS[clipSpec.masterKey];
    const frameBuffers = [];
    const frameEntries = [];

    for (let i = 0; i < 4; i += 1) {
      const frameNum = String(i + 1).padStart(2, '0');
      const frameRel = `${dirRel}/kuro-signal-${clipSpec.id}-frame-${frameNum}.png`;
      const frameBuf = await buildCompositePortrait(clipCutout, {
        size: 512,
        tilt: clipSpec.tilt[i],
        scale: 0.98 + (i % 2 === 1 ? 0.02 : 0),
        offsetY: clipSpec.bob[i],
        overlaySvg: clipSpec.fx(i),
      });
      await atomicWrite(resolve(packageRoot, frameRel), frameBuf);
      frameBuffers.push(frameBuf);
      frameEntries.push({ asset: frameRel, durationMs: clipSpec.durationMs });
      generated.push({
        path: frameRel,
        kind: 'animation-frame',
        variant: `kuro-signal-${clipSpec.id}-frame-${frameNum}`,
        subject: 'kuro-signal',
        format: 'png',
        width: 512,
        height: 512,
        pack: 'riot-universe',
        domain: 'visual-universe',
        status: 'approved',
        license: 'MoonWitness Commissioned Asset (ISC pipeline)',
        source: clipSourceRel,
        sourceAsset: clipSourceRel,
      });
    }

    const sheetBuf = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: frameBuffers[0], left: 0, top: 0 },
        { input: frameBuffers[1], left: 512, top: 0 },
        { input: frameBuffers[2], left: 0, top: 512 },
        { input: frameBuffers[3], left: 512, top: 512 },
      ])
      .png({ compressionLevel: 9, palette: true, quality: 88, effort: 10 })
      .toBuffer();
    await atomicWrite(resolve(packageRoot, sheetRel), sheetBuf);
    generated.push({
      path: sheetRel,
      kind: 'animation-sheet',
      variant: `kuro-signal-${clipSpec.id}-sheet`,
      subject: 'kuro-signal',
      format: 'png',
      width: 1024,
      height: 1024,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'MoonWitness Commissioned Asset (ISC pipeline)',
      source: clipSourceRel,
      sourceAsset: clipSourceRel,
    });

    const clipDoc = {
      schemaVersion: 1,
      clipId: `kuro-signal-${clipSpec.id}`,
      characterId: 'kuro-signal',
      pack: 'riot-universe',
      domain: 'visual-universe',
      description: `Four-frame stepped comic animation clip (${clipSpec.id}) for kuro-signal with 2x2 1024x1024 sprite atlas.`,
      clip: {
        id: `kuro-signal-${clipSpec.id}`,
        loop: true,
        direction: clipSpec.direction,
        pivot: { x: 0.5, y: 0.88 },
        frames: frameEntries,
      },
      spriteSheet: {
        atlas: sheetRel,
        frameWidth: 512,
        frameHeight: 512,
        frameCount: 4,
        frameDurationMs: clipSpec.durationMs,
        columns: 2,
        rows: 2,
        loop: true,
        direction: clipSpec.direction,
        pivot: { x: 0.5, y: 0.88 },
      },
      reducedMotionFallback: frameEntries[0].asset,
      license: 'ISC',
      status: 'approved',
    };
    await atomicWrite(resolve(packageRoot, clipRel), `${JSON.stringify(clipDoc, null, 2)}\n`);
    generated.push({
      path: clipRel,
      kind: 'animation-clip',
      variant: `kuro-signal-${clipSpec.id}-clip`,
      subject: 'kuro-signal',
      format: 'json',
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'ISC',
      source: 'packages/assets/scripts/generate-riot-universe.mjs',
      spriteSheet: clipDoc.spriteSheet,
    });
  }

  // 10. 5-Layer Parallax Scene: 4 SVGs + scenes/riot-alley-scene.json
  stdout.write('Generating 5-layer Riot Alley parallax scene...\n');
  const alleyLayers = [
    {
      path: 'environments/riot-alley-bg.svg',
      title: 'Riot alley distant nocturnal skyline and halftone moon',
      variant: 'riot-alley-bg',
      body: `
        <defs><linearGradient id="__ID__sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090d1c"/><stop offset="1" stop-color="#17172a"/></linearGradient></defs>
        <rect x="0" y="0" width="2048" height="1152" fill="url(#__ID__sky)" fill-opacity="0.55"/>
        <circle cx="1540" cy="270" r="196" fill="${PAPER}" fill-opacity="0.92" stroke="${INK}" stroke-width="6"/>
        ${halftoneDots(10, 6, 1380, 140, 32, 3, CYAN, 0.22)}
        <path d="M 80 1140 V 620 H 240 V 520 H 410 V 680 H 580 V 460 H 780 V 660 H 980 V 500 H 1180 V 700 H 1400 V 440 H 1640 V 620 H 1840 V 540 H 1980 V 1140 Z" fill="#121424" stroke="${INK}" stroke-width="5"/>
      `,
    },
    {
      path: 'environments/riot-alley-mid.svg',
      title: 'Riot alley neon brick walls and transit arches',
      variant: 'riot-alley-mid',
      body: `
        <path d="M 24 1140 V 320 H 460 V 1140 Z" fill="#171720" stroke="${INK}" stroke-width="6"/>
        <path d="M 1560 1140 V 280 H 2024 V 1140 Z" fill="#171720" stroke="${INK}" stroke-width="6"/>
        <path d="M 460 540 Q 1024 380 1560 540 L 1560 600 Q 1024 440 460 600 Z" fill="#1e1e28" stroke="${INK}" stroke-width="6"/>
        <rect x="360" y="420" width="44" height="240" rx="8" fill="${MAGENTA}" stroke="${INK}" stroke-width="5"/>
        <rect x="1630" y="380" width="44" height="260" rx="8" fill="${CYAN}" stroke="${INK}" stroke-width="5"/>
        <rect x="140" y="560" width="160" height="190" fill="${PAPER}" fill-opacity="0.88" stroke="${INK}" stroke-width="5"/>
        <polygon points="170,610 270,610 220,700" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      `,
    },
    {
      path: 'environments/riot-alley-fg.svg',
      title: 'Riot alley wet pavement and foreground rooftop crates',
      variant: 'riot-alley-fg',
      body: `
        <path d="M 20 880 H 2028 V 1140 H 20 Z" fill="#121216" stroke="${INK}" stroke-width="6"/>
        <ellipse cx="760" cy="990" rx="220" ry="26" fill="${MAGENTA}" fill-opacity="0.34" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="1320" cy="1020" rx="240" ry="28" fill="${CYAN}" fill-opacity="0.32" stroke="${INK}" stroke-width="3"/>
        <rect x="1340" y="810" width="180" height="130" rx="10" fill="${CHARCOAL}" stroke="${INK}" stroke-width="6"/>
        <rect x="1380" y="838" width="100" height="26" rx="4" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
      `,
    },
    {
      path: 'environments/riot-alley-decor.svg',
      title: 'Riot alley overhead cables and comic spark motes',
      variant: 'riot-alley-decor',
      body: `
        <path d="M 24 120 Q 1024 310 2024 140 M 24 184 Q 1024 380 2024 204" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
        <path d="${starPath(1720, 320, 22, 8, 4)}" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
        <path d="${starPath(380, 280, 18, 6, 4)}" fill="${CYAN}" stroke="${INK}" stroke-width="3.5"/>
        <circle cx="1180" cy="240" r="8" fill="${MAGENTA}" stroke="${INK}" stroke-width="3"/>
        <circle cx="840" cy="220" r="6" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>
      `,
    },
  ];
  for (const layer of alleyLayers) {
    const svgText = wrapSvg(layer.path, 2048, 1152, layer.title, layer.body);
    await atomicWrite(resolve(packageRoot, layer.path), svgText);
    generated.push({
      path: layer.path,
      kind: 'environment',
      variant: layer.variant,
      format: 'svg',
      width: 2048,
      height: 1152,
      pack: 'riot-universe',
      domain: 'visual-universe',
      status: 'approved',
      license: 'ISC',
      source: 'packages/assets/scripts/generate-riot-universe.mjs',
    });
  }

  const riotScenePath = 'scenes/riot-alley-scene.json';
  const riotSceneBundle = {
    scenes: [
      {
        id: 'riot-alley-hero',
        staticFallback: 'illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp',
        accessibilityFallback: 'illustrations/riot-universe/states/state-welcome.webp',
        clips: ['kuro-signal-idle', 'kuro-signal-wave'],
        layers: [
          {
            id: 'sky-backdrop',
            asset: 'illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp',
            order: 0,
            position: { x: 0.5, y: 0.5 },
            pivot: { x: 0.5, y: 0.5 },
            opacity: 1,
            parallax: { x: 0, y: 0 },
          },
          {
            id: 'alley-bg',
            asset: 'environments/riot-alley-bg.svg',
            order: 10,
            position: { x: 0.5, y: 0.5 },
            pivot: { x: 0.5, y: 0.5 },
            opacity: 0.96,
            parallax: { x: 0.1, y: 0.04 },
          },
          {
            id: 'alley-mid',
            asset: 'environments/riot-alley-mid.svg',
            order: 20,
            position: { x: 0.5, y: 0.52 },
            pivot: { x: 0.5, y: 0.52 },
            opacity: 1,
            parallax: { x: 0.28, y: 0.1 },
          },
          {
            id: 'alley-fg',
            asset: 'environments/riot-alley-fg.svg',
            order: 40,
            position: { x: 0.5, y: 0.88 },
            pivot: { x: 0.5, y: 0.88 },
            opacity: 1,
            parallax: { x: 0.52, y: 0.18 },
          },
          {
            id: 'alley-decor',
            asset: 'environments/riot-alley-decor.svg',
            order: 60,
            position: { x: 0.5, y: 0.24 },
            pivot: { x: 0.5, y: 0.24 },
            opacity: 0.94,
            parallax: { x: 0.72, y: 0.24 },
          },
        ],
        breakpoints: [
          {
            name: 'mobile',
            minWidth: 0,
            maxWidth: 767,
            overlay: 'illustrations/riot-universe/states/state-welcome.webp',
            layerOverrides: [
              { layerId: 'alley-decor', opacity: 0.55, parallax: { x: 0.2, y: 0.08 } },
            ],
          },
          {
            name: 'desktop',
            minWidth: 768,
            overlay: 'illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp',
          },
        ],
      },
    ],
    clips: ['idle', 'wave'].map((clipId) => {
      const spec = ANIMATION_CLIPS.find((c) => c.id === clipId);
      return {
        id: `kuro-signal-${clipId}`,
        loop: true,
        direction: spec.direction,
        pivot: { x: 0.5, y: 0.88 },
        frames: [1, 2, 3, 4].map((n) => ({
          asset: `animation/kuro-signal-${clipId}/kuro-signal-${clipId}-frame-0${n}.png`,
          durationMs: spec.durationMs,
        })),
      };
    }),
  };
  await atomicWrite(resolve(packageRoot, riotScenePath), `${JSON.stringify(riotSceneBundle, null, 2)}\n`);
  generated.push({
    path: riotScenePath,
    kind: 'scene',
    variant: 'canonical-scene-bundle',
    format: 'json',
    pack: 'riot-universe',
    domain: 'visual-universe',
    status: 'approved',
    license: 'ISC',
    source: 'packages/assets/scripts/generate-riot-universe.mjs',
  });

  // Update manifest.json with strict ownership via replaceGeneratedAssets
  const ownedPaths = new Set(generated.map((item) => item.path));
  manifest.assets = replaceGeneratedAssets(manifest.assets, generated, ownedPaths);
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Update licenses.json sourceAssets for every kind === 'source' && pack === 'riot-universe'
  const retainedProvenance = (licenses.sourceAssets ?? []).filter((entry) => !ownedPaths.has(entry.path));
  licenses.sourceAssets = [...retainedProvenance, ...sourceProvenance].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  await atomicWrite(licensesPath, `${JSON.stringify(licenses, null, 2)}\n`);

  stdout.write(
    `Generated riot-universe pack: ${generated.length} manifest entries (${sourceProvenance.length} source masters).\n`
  );
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
