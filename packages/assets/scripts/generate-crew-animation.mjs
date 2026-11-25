/**
 * Canonical crew-01 sprite generator.
 *
 * Produces a hand-authored anime/zine sprite pack for the MoonWitness
 * parallax scene. Every frame is a distinct keyframe: the hood, layered hair,
 * jacket, arms and boots all change silhouette. The character remains
 * anonymous and back-facing per character-registry.json (no recognisable
 * face), but reads as an illustrated character rather than a geometric prop.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'manifest.json');

const INK = '#0d0d0d';
const HAIR = '#1a1f2e';
const HAIR_LIGHT = '#2c3448';
const MAGENTA = '#ff2e88';
const MAGENTA_DEEP = '#b81f5d';
const PAPER = '#f3efe4';
const YELLOW = '#ffe031';
const CYAN = '#00b8f0';

const r = (value) => Math.round(value * 100) / 100;

/** Filled trouser + boot. Knee and foot move independently per keyframe. */
function leg(hipX, kneeX, footX, footY, bob) {
  const hy = r(790 + bob);
  const ky = r(858 + bob);
  const fy = r(footY + bob);
  return `<g>
    <path d="M ${hipX - 36} ${hy} L ${hipX + 36} ${hy} L ${kneeX + 32} ${ky} L ${footX + 25} ${fy - 20} L ${footX - 25} ${fy - 20} L ${kneeX - 32} ${ky} Z" fill="#151923" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M ${kneeX - 22} ${ky - 26} l 44 0" stroke="${HAIR_LIGHT}" stroke-width="5" stroke-linecap="round"/>
    <path d="M ${footX - 30} ${fy - 24} L ${footX + 30} ${fy - 24} L ${footX + 34} ${fy + 8} Q ${footX} ${fy + 28} ${footX - 34} ${fy + 8} Z" fill="${INK}" stroke="${INK}" stroke-width="5"/>
    <path d="M ${footX - 26} ${fy + 6} h 52" stroke="${YELLOW}" stroke-width="7" stroke-linecap="round"/>
  </g>`;
}

/** Sleeve with cuff and hand. Drawn before the torso so it tucks under. */
function arm(shoulderX, elbowX, handX, handY, bob) {
  const sy = r(482 + bob);
  const ey = r(620 + bob);
  const hy = r(handY + bob);
  const cuffY = r(hy - 44);
  return `<g>
    <path d="M ${shoulderX - 30} ${sy} L ${shoulderX + 32} ${sy - 8} L ${elbowX + 34} ${ey} L ${handX + 24} ${cuffY} L ${handX - 24} ${cuffY} L ${elbowX - 34} ${ey} Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M ${shoulderX + 10} ${sy + 4} L ${elbowX + 18} ${ey - 10} L ${handX + 12} ${cuffY - 6}" fill="none" stroke="${MAGENTA_DEEP}" stroke-width="8" stroke-linecap="round"/>
    <path d="M ${handX - 26} ${cuffY} L ${handX + 26} ${cuffY}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M ${handX - 22} ${cuffY + 8} q 22 18 44 0 l -2 30 q -20 14 -40 0 z" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  </g>`;
}

/**
 * Back-facing hooded head with layered hair. `angle` rotates the whole head;
 * `sway` curves every strand, so hair frames are visibly different drawings.
 */
function head(bob, angle, sway) {
  const s = r(sway);
  const s7 = r(sway * 0.7);
  const s5 = r(sway * 0.5);
  return `<g transform="rotate(${angle} 512 ${r(410 + bob)})">
    <path d="M 380 344 Q 380 160 512 148 Q 644 160 644 344 L 632 412 Q 512 462 392 412 Z" fill="${HAIR}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M 508 150 q 4 -38 34 -44 q -12 28 -10 46 z" fill="${HAIR}" stroke="${INK}" stroke-width="5"/>
    <path d="M 412 334 Q 412 204 512 194 Q 612 204 612 334 Q 512 382 412 334 Z" fill="${INK}" opacity="0.8"/>
    <path d="M 384 322 Q 392 176 512 164 Q 632 176 640 322" fill="none" stroke="${MAGENTA}" stroke-width="7" stroke-linecap="round" opacity="0.92"/>
    <path d="M 400 350 Q 396 232 512 216 Q 628 232 624 350" fill="none" stroke="${HAIR_LIGHT}" stroke-width="5" opacity="0.7"/>

    <path d="M 424 206 Q 392 336 ${r(414 + s)} 520 Q ${r(420 + s)} 586 ${r(396 + s)} 654" fill="none" stroke="${HAIR}" stroke-width="30" stroke-linecap="round"/>
    <path d="M 470 180 Q 444 330 ${r(462 + s7)} 542 Q ${r(468 + s7)} 606 ${r(446 + s7)} 668" fill="none" stroke="${HAIR}" stroke-width="24" stroke-linecap="round"/>
    <path d="M 512 172 Q ${r(512 + s5)} 366 ${r(512 + s5)} 566 Q ${r(516 + s5)} 622 ${r(502 + s5)} 676" fill="none" stroke="${HAIR}" stroke-width="36" stroke-linecap="round"/>
    <path d="M 554 180 Q 580 330 ${r(562 + s7)} 542 Q ${r(556 + s7)} 606 ${r(578 + s7)} 668" fill="none" stroke="${HAIR}" stroke-width="24" stroke-linecap="round"/>
    <path d="M 600 206 Q 632 336 ${r(610 + s)} 520 Q ${r(604 + s)} 586 ${r(628 + s)} 654" fill="none" stroke="${HAIR}" stroke-width="30" stroke-linecap="round"/>

    <path d="M 430 232 Q 404 344 ${r(424 + s)} 506" fill="none" stroke="${MAGENTA}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>
    <path d="M 506 214 Q ${r(506 + s5)} 386 ${r(506 + s5)} 552" fill="none" stroke="${CYAN}" stroke-width="5" stroke-linecap="round" opacity="0.78"/>
    <path d="M 594 232 Q 620 344 ${r(600 + s)} 506" fill="none" stroke="${MAGENTA}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>
    <path d="M 398 300 Q 374 396 ${r(388 + s)} 476" fill="none" stroke="${CYAN}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
  </g>`;
}

function torso(bob, badge) {
  const by = r(badge[1] + bob);
  return `<g>
    <path d="M 356 476 Q 512 434 668 476 L 690 662 Q 700 752 646 808 L 378 808 Q 324 752 334 662 Z" fill="${MAGENTA}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M 356 476 Q 420 454 456 468 L 442 802 L 378 808 Q 324 752 334 662 Z" fill="${MAGENTA_DEEP}" stroke="${INK}" stroke-width="4"/>
    <path d="M 438 464 Q 512 524 586 464 L 602 506 Q 512 562 422 506 Z" fill="${INK}" opacity="0.62"/>
    <path d="M 512 520 L 512 800" stroke="${INK}" stroke-width="5"/>
    <path d="M 390 716 h 78 m 88 0 h 78" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 468 482 Q 560 604 624 668" fill="none" stroke="${INK}" stroke-width="16" opacity="0.9"/>
    <rect x="590" y="${r(654 + bob)}" width="82" height="104" rx="10" fill="${HAIR}" stroke="${INK}" stroke-width="6"/>
    <path d="M 590 ${r(686 + bob)} h 82" stroke="${INK}" stroke-width="6"/>
    <circle cx="631" cy="${r(688 + bob)}" r="9" fill="${YELLOW}" stroke="${INK}" stroke-width="4"/>
    <circle cx="${badge[0]}" cy="${by}" r="22" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>
    <path d="M ${badge[0]} ${r(by - 10)} l 4 12 13 1 -10 8 3 13 -10 -7 -10 7 3 -13 -10 -8 13 -1 z" fill="${INK}"/>
    <path d="M 340 540 q -18 92 6 176" fill="none" stroke="${YELLOW}" stroke-width="5" stroke-linecap="round" opacity="0.75"/>
    <path d="M 684 540 q 18 92 -6 176" fill="none" stroke="${CYAN}" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
  </g>`;
}

function buildFrame({ label, bob, sway, angle, legs, arms, badge }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="${label}">
  <title>${label}</title>
  <rect width="1024" height="1024" fill="${PAPER}"/>
  <circle cx="512" cy="500" r="372" fill="none" stroke="${INK}" stroke-opacity="0.06" stroke-width="2" stroke-dasharray="3 15"/>
  <path d="M 206 262 L 288 284 M 190 316 L 262 328 M 736 262 L 818 244 M 752 316 L 822 308" stroke="${MAGENTA}" stroke-width="4" stroke-linecap="round" opacity="0.28"/>
  <ellipse cx="512" cy="956" rx="198" ry="22" fill="${INK}" opacity="0.1"/>
  ${leg(...legs[0], bob)}
  ${leg(...legs[1], bob)}
  ${arm(...arms[0], bob)}
  ${arm(...arms[1], bob)}
  ${torso(bob, badge)}
  ${head(bob, angle, sway)}
</svg>
`;
}

/* Four distinct keyframes per clip. Limb coordinates are the animation. */
const FRAMES = {
  idle: [
    {
      label: 'crew-01 idle frame 1 - neutral stance',
      bob: 0,
      sway: -3,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
    {
      label: 'crew-01 idle frame 2 - inhale',
      bob: 6,
      sway: 9,
      angle: 0,
      badge: [472, 602],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [352, 302, 292, 820],
        [672, 722, 732, 820],
      ],
    },
    {
      label: 'crew-01 idle frame 3 - exhale',
      bob: 2,
      sway: 14,
      angle: 1,
      badge: [473, 605],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [354, 304, 294, 822],
        [670, 720, 730, 822],
      ],
    },
    {
      label: 'crew-01 idle frame 4 - settle',
      bob: 0,
      sway: 2,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
  ],
  walk: [
    {
      label: 'crew-01 walk frame 1 - left foot contact',
      bob: 0,
      sway: 16,
      angle: -2,
      badge: [466, 592],
      legs: [
        [468, 424, 396, 940],
        [556, 596, 616, 896],
      ],
      arms: [
        [356, 372, 336, 792],
        [668, 654, 692, 856],
      ],
    },
    {
      label: 'crew-01 walk frame 2 - passing pose',
      bob: 7,
      sway: 5,
      angle: -1,
      badge: [471, 600],
      legs: [
        [468, 452, 470, 904],
        [556, 558, 554, 922],
      ],
      arms: [
        [356, 318, 300, 824],
        [668, 706, 724, 828],
      ],
    },
    {
      label: 'crew-01 walk frame 3 - right foot contact',
      bob: 0,
      sway: -16,
      angle: 2,
      badge: [474, 592],
      legs: [
        [468, 596, 408, 896],
        [556, 470, 628, 940],
      ],
      arms: [
        [356, 654, 332, 856],
        [668, 372, 688, 792],
      ],
    },
    {
      label: 'crew-01 walk frame 4 - passing pose',
      bob: 7,
      sway: -5,
      angle: 1,
      badge: [471, 600],
      legs: [
        [468, 558, 466, 922],
        [556, 450, 558, 904],
      ],
      arms: [
        [356, 706, 300, 828],
        [668, 318, 724, 824],
      ],
    },
  ],
  turn: [
    {
      label: 'crew-01 turn frame 1 - facing forward',
      bob: 0,
      sway: -3,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
    {
      label: 'crew-01 turn frame 2 - quarter turn',
      bob: 2,
      sway: 10,
      angle: 9,
      badge: [472, 600],
      legs: [
        [468, 446, 436, 934],
        [556, 578, 596, 934],
      ],
      arms: [
        [360, 312, 302, 822],
        [664, 712, 722, 822],
      ],
    },
    {
      label: 'crew-01 turn frame 3 - half profile',
      bob: 4,
      sway: 20,
      angle: 18,
      badge: [474, 603],
      legs: [
        [468, 438, 430, 932],
        [556, 584, 602, 932],
      ],
      arms: [
        [366, 318, 310, 820],
        [658, 706, 716, 820],
      ],
    },
    {
      label: 'crew-01 turn frame 4 - return',
      bob: 1,
      sway: 4,
      angle: 6,
      badge: [471, 598],
      legs: [
        [468, 448, 438, 935],
        [556, 576, 594, 935],
      ],
      arms: [
        [358, 308, 298, 823],
        [666, 716, 726, 823],
      ],
    },
  ],
  hair: [
    {
      label: 'crew-01 hair frame 1 - neutral',
      bob: 0,
      sway: -8,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
    {
      label: 'crew-01 hair frame 2 - wind from left',
      bob: 0,
      sway: 30,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
    {
      label: 'crew-01 hair frame 3 - settle right',
      bob: 0,
      sway: -24,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
    {
      label: 'crew-01 hair frame 4 - calm',
      bob: 0,
      sway: 2,
      angle: 0,
      badge: [470, 596],
      legs: [
        [468, 452, 442, 936],
        [556, 572, 590, 936],
      ],
      arms: [
        [356, 306, 296, 824],
        [668, 718, 728, 824],
      ],
    },
  ],
};

const CLIP_META = {
  idle: {
    id: 'crew-01-idle',
    description:
      'Four-frame anime idle loop for anonymous back-facing crew-01: breathing bob, hood drift and hair sway. Each frame is a distinct drawing with its own silhouette; ping-pong playback keeps the loop seamless. Reduced-motion fallback uses frame 1.',
    durationMs: 720,
  },
  walk: {
    id: 'crew-01-walk',
    description:
      'Four-frame walk cycle for crew-01: left contact, passing, right contact and passing. Knees, boots, arms and hair change every frame with alternating foot contact points. No reused idle pose.',
    durationMs: 480,
  },
  turn: {
    id: 'crew-01-turn',
    description:
      'Four-frame quarter turn for crew-01: hood and layered hair rotate across four distinct angles while boots stay planted. Reduced-motion fallback uses frame 1.',
    durationMs: 560,
  },
  hair: {
    id: 'crew-01-hair-move',
    description:
      'Subtle four-frame hair sway for anonymous back-facing crew-01: neutral, wind from left, settle right and calm. Strand curvature and tips change per frame; ping-pong loop.',
    durationMs: 520,
  },
};

const CLIP_DIR = {
  idle: 'crew-01-idle',
  walk: 'crew-01-walk',
  turn: 'crew-01-turn',
  hair: 'crew-01-hair',
};
const FRAME_FILE = {
  idle: 'crew-01-idle-frame',
  walk: 'crew-01-walk-frame',
  turn: 'crew-01-turn-frame',
  hair: 'crew-01-hair-move-frame',
};
const CLIP_FILE = {
  idle: 'crew-01-idle-clip.json',
  walk: 'crew-01-walk-clip.json',
  turn: 'crew-01-turn-clip.json',
  hair: 'crew-01-hair-move-clip.json',
};

const generated = [];
const owned = new Set();
for (const [key, frames] of Object.entries(FRAMES)) {
  const dir = CLIP_DIR[key];
  const prefix = FRAME_FILE[key];
  for (let index = 0; index < frames.length; index += 1) {
    const frameNumber = String(index + 1).padStart(2, '0');
    const relative = `animation/${dir}/${prefix}-${frameNumber}.svg`;
    const absolute = resolve(root, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buildFrame(frames[index]), 'utf8');
    generated.push({
      path: relative,
      kind: 'source',
      variant: 'canonical-animation-frame',
      format: 'svg',
      width: 1024,
      height: 1024,
      pack: 'moon-city',
      domain: 'visual-universe',
      status: 'review',
      license: 'ISC',
      source: 'MoonWitness contributors',
    });
    owned.add(relative);
  }

  const meta = CLIP_META[key];
  const clipRelative = `animation/${dir}/${CLIP_FILE[key]}`;
  const clip = {
    schemaVersion: 1,
    clipId: meta.id,
    characterId: 'crew-01',
    pack: 'moon-city',
    domain: 'visual-universe',
    description: meta.description,
    clip: {
      id: meta.id,
      loop: true,
      direction: 'ping-pong',
      pivot: { x: 0.5, y: 0.9 },
      frames: frames.map((_, index) => {
        const frameNumber = String(index + 1).padStart(2, '0');
        return {
          asset: `animation/${dir}/${prefix}-${frameNumber}.svg`,
          durationMs: meta.durationMs,
        };
      }),
    },
    reducedMotionFallback: `animation/${dir}/${prefix}-01.svg`,
    license: 'ISC',
    status: 'review',
  };
  await writeFile(resolve(root, clipRelative), `${JSON.stringify(clip, null, 2)}\n`, 'utf8');
  generated.push({
    path: clipRelative,
    kind: 'source',
    variant: 'canonical-animation-clip',
    format: 'json',
    pack: 'moon-city',
    domain: 'visual-universe',
    status: 'review',
    license: 'ISC',
    source: 'MoonWitness contributors',
  });
  owned.add(clipRelative);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.assets = replaceGeneratedAssets(manifest.assets, generated, owned);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/* Keep source provenance in lockstep with the generated asset inventory. */
const licensesPath = resolve(root, 'licenses.json');
const licenses = JSON.parse(await readFile(licensesPath, 'utf8'));
const provenance = generated.map(({ path, variant }) => ({
  path,
  creator: 'MoonWitness contributors',
  source: variant.includes('clip')
    ? 'Original manually authored JSON'
    : 'Original manually authored SVG',
  license: 'ISC',
  modifications:
    'Redrawn four-frame anonymous back-facing crew-01 keyframe; distinct silhouette per frame, no recognisable face.',
  status: 'review',
  distribution: 'source-only pending visual acceptance',
}));
licenses.sourceAssets = [
  ...(licenses.sourceAssets ?? []).filter((entry) => !owned.has(entry.path)),
  ...provenance,
];
await writeFile(licensesPath, `${JSON.stringify(licenses, null, 2)}\n`, 'utf8');

process.stdout.write(
  `crew-01 sprite pack: ${generated.length} files (${Object.keys(FRAMES).length} clips x ${FRAMES.idle.length} frames)\n`
);
