import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { stdout } from 'node:process';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDir = resolve(root, 'materials');
const manifestPath = resolve(root, 'manifest.json');

function wrapSvg(width, height, title, body, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${extra} role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
}

const materialEntries = [
  {
    name: 'torn-edge-top',
    title: 'Torn paper top edge',
    kind: 'material',
    variant: 'paper-edge',
    width: 240,
    height: 16,
    body: '<path d="M0 16V4l18 4 14-6 20 5 16-5 24 6 18-7 22 6 19-5 21 5 17-6 23 6 14-5 14 4v10Z" fill="currentColor"/>',
  },
  {
    name: 'torn-edge-bottom',
    title: 'Torn paper bottom edge',
    kind: 'material',
    variant: 'paper-edge',
    width: 240,
    height: 16,
    body: '<path d="M0 0v12l16-4 18 6 21-5 15 6 24-7 19 6 23-5 17 6 22-6 18 5 21-5 14 4 12-3V0Z" fill="currentColor"/>',
  },
  {
    name: 'torn-edge-left',
    title: 'Torn paper left edge',
    kind: 'material',
    variant: 'paper-edge',
    width: 16,
    height: 240,
    body: '<path d="M16 0H4l4 18-6 14 5 20-5 16 6 24-7 18 6 22-5 19 5 21-6 17 6 23-5 14 4 14h10Z" fill="currentColor"/>',
  },
  {
    name: 'torn-edge-right',
    title: 'Torn paper right edge',
    kind: 'material',
    variant: 'paper-edge',
    width: 16,
    height: 240,
    body: '<path d="M0 0h12l-4 16 6 18-5 21 6 15-7 24 6 19-5 23 6 17-6 22 5 18-5 21 4 14-3 12H0Z" fill="currentColor"/>',
  },
  {
    name: 'torn-corner-tl',
    title: 'Torn paper top-left corner',
    kind: 'material',
    variant: 'paper-corner',
    width: 24,
    height: 24,
    body: '<path d="M24 0v16H16v8H0V12l5-4-2-4 6-1 3-3h12Z" fill="currentColor"/>',
  },
  {
    name: 'torn-corner-tr',
    title: 'Torn paper top-right corner',
    kind: 'material',
    variant: 'paper-corner',
    width: 24,
    height: 24,
    body: '<path d="M0 0h12l3 3 6 1-2 4 5 4v12H8v-8H0V0Z" fill="currentColor"/>',
  },
  {
    name: 'torn-corner-bl',
    title: 'Torn paper bottom-left corner',
    kind: 'material',
    variant: 'paper-corner',
    width: 24,
    height: 24,
    body: '<path d="M0 0h16v8h8v16H12l-3-3-6-1 2-4-5-4V0Z" fill="currentColor"/>',
  },
  {
    name: 'torn-corner-br',
    title: 'Torn paper bottom-right corner',
    kind: 'material',
    variant: 'paper-corner',
    width: 24,
    height: 24,
    body: '<path d="M8 0h16v12l-5 4 2 4-6 1-3 3H0V8h8V0Z" fill="currentColor"/>',
  },
  {
    name: 'brush-strip-short',
    title: 'Short brush stroke strip',
    kind: 'material',
    variant: 'brush-strip',
    width: 160,
    height: 40,
    body: '<path d="M6 10c42-5 98-6 148-2l-5 9 7 8c-48 5-102 6-152 3l6-9-4-9Z" fill="currentColor"/>',
  },
  {
    name: 'brush-strip-long',
    title: 'Long brush stroke ribbon',
    kind: 'material',
    variant: 'brush-strip',
    width: 320,
    height: 44,
    body: '<path d="M8 9c86-6 212-7 304-1l-8 11 9 10c-94 6-220 7-306 2l9-11-8-11Z" fill="currentColor"/>',
  },
  {
    name: 'paper-note',
    title: 'Paper note card frame',
    kind: 'material',
    variant: 'paper-note',
    width: 180,
    height: 120,
    body: '<path d="M6 10h140l28 24v80H6V10Z" fill="#fffdf6" stroke="#0d0d0d" stroke-width="3"/><path d="M146 10v24h28" fill="#e3dfd4" stroke="#0d0d0d" stroke-width="3" stroke-linejoin="round"/><rect x="64" y="2" width="52" height="14" fill="#ffe031" stroke="#0d0d0d" stroke-width="2" transform="rotate(-2 90 9)"/>',
  },
  {
    name: 'tape-strip',
    title: 'Masking tape strip',
    kind: 'material',
    variant: 'tape',
    width: 96,
    height: 28,
    body: '<path d="M4 6 12 3l72 2 8-2-3 10 3 9-12 2-68-2-8 2 3-9-3-9Z" fill="#ffe031" fill-opacity="0.88" stroke="#0d0d0d" stroke-width="2"/>',
  },
  {
    name: 'folded-corner',
    title: 'Folded paper corner',
    kind: 'material',
    variant: 'paper-corner',
    width: 32,
    height: 32,
    body: '<path d="M2 2h28v28Z" fill="#e3dfd4"/><path d="M2 2v28h28L2 2Z" fill="#fffdf6" stroke="#0d0d0d" stroke-width="2.5" stroke-linejoin="round"/>',
  },
  {
    name: 'stamp-outline',
    title: 'Rubber stamp frame',
    kind: 'material',
    variant: 'stamp',
    width: 120,
    height: 48,
    body: '<rect x="3" y="3" width="114" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="14 3 6 2"/><rect x="8" y="8" width="104" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    name: 'ink-splatter-sm',
    title: 'Small ink splatter',
    kind: 'material',
    variant: 'ink-splatter',
    width: 48,
    height: 48,
    body: '<path d="M22 14c4-2 9 1 11 5 2 5-1 10-6 12-5 1-11-2-12-7-1-5 2-9 7-10Z" fill="currentColor"/><circle cx="11" cy="14" r="2.2" fill="currentColor"/><circle cx="37" cy="16" r="1.8" fill="currentColor"/><circle cx="34" cy="35" r="2.6" fill="currentColor"/><circle cx="14" cy="34" r="1.5" fill="currentColor"/>',
  },
  {
    name: 'ink-splatter-md',
    title: 'Medium ink splatter',
    kind: 'material',
    variant: 'ink-splatter',
    width: 84,
    height: 84,
    body: '<path d="M38 22c9-3 18 3 21 11 3 9-2 19-11 22-9 4-20-1-23-10-3-9 3-19 13-23Z" fill="currentColor"/><circle cx="18" cy="24" r="3.4" fill="currentColor"/><circle cx="67" cy="21" r="2.8" fill="currentColor"/><circle cx="68" cy="58" r="4.1" fill="currentColor"/><circle cx="22" cy="62" r="2.5" fill="currentColor"/><circle cx="44" cy="11" r="2.2" fill="currentColor"/><path d="M56 38 72 34m-18 14 14 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  },
  {
    name: 'tile-halftone',
    title: 'Halftone dot tile',
    kind: 'pattern',
    variant: 'tile',
    width: 64,
    height: 64,
    body: '<defs><pattern id="mw-materials-tile-halftone-svg-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.6" fill="currentColor" fill-opacity="0.22"/><circle cx="12" cy="12" r="1.6" fill="currentColor" fill-opacity="0.22"/></pattern></defs><rect width="64" height="64" fill="url(#mw-materials-tile-halftone-svg-dots)"/>',
  },
  {
    name: 'tile-speckle',
    title: 'Paper speckle tile',
    kind: 'pattern',
    variant: 'tile',
    width: 80,
    height: 80,
    body: '<defs><pattern id="mw-materials-tile-speckle-svg-grain" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="7" cy="9" r="1" fill="currentColor" fill-opacity="0.24"/><circle cx="23" cy="5" r="0.9" fill="currentColor" fill-opacity="0.18"/><circle cx="31" cy="19" r="1.2" fill="currentColor" fill-opacity="0.2"/><circle cx="13" cy="28" r="0.8" fill="currentColor" fill-opacity="0.22"/><circle cx="35" cy="34" r="1" fill="currentColor" fill-opacity="0.16"/></pattern></defs><rect width="80" height="80" fill="url(#mw-materials-tile-speckle-svg-grain)"/>',
  },
  {
    name: 'tile-scratch',
    title: 'Ink scratch texture tile',
    kind: 'pattern',
    variant: 'tile',
    width: 80,
    height: 80,
    body: '<g fill="none" stroke="currentColor" stroke-opacity="0.24" stroke-width="1.2" stroke-linecap="round"><path d="M6 14 24 8M44 16l22-5M12 42l28-6M50 48l18-3M8 68l24-7M48 70l22-4"/></g>',
  },
  {
    name: 'scuffed-border',
    title: 'Scuffed ink border',
    kind: 'material',
    variant: 'border',
    width: 240,
    height: 120,
    body: '<path d="M4 4h72m10 0h94m10 0h46v44m0 10v58h-82m-12 0H4V64m0-12V4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/><path d="M10 9h38m142 102h38" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.45"/>',
  },
  {
    name: 'doodle-star',
    title: 'Hand-drawn star doodle',
    kind: 'ornament',
    variant: 'doodle',
    width: 24,
    height: 24,
    body: '<path d="M12 2.5 14.6 8.6l6.6.5-5 4.3 1.6 6.5L12 16.4l-5.8 3.5 1.6-6.5-5-4.3 6.6-.5Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    name: 'doodle-bolt',
    title: 'Hand-drawn lightning bolt doodle',
    kind: 'ornament',
    variant: 'doodle',
    width: 24,
    height: 24,
    body: '<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6Z" fill="#ffe031" stroke="#0d0d0d" stroke-width="2" stroke-linejoin="round"/>',
  },
  {
    name: 'doodle-smiley',
    title: 'Hand-drawn smiley doodle',
    kind: 'ornament',
    variant: 'doodle',
    width: 24,
    height: 24,
    body: '<circle cx="12" cy="12" r="9.2" fill="#ffe031" stroke="#0d0d0d" stroke-width="2"/><circle cx="9" cy="10" r="1.2" fill="#0d0d0d"/><circle cx="15" cy="10" r="1.2" fill="#0d0d0d"/><path d="M8.5 14.2c1.2 2 5.8 2 7 0" fill="none" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>',
  },
  {
    name: 'doodle-arrow',
    title: 'Hand-drawn arrow doodle',
    kind: 'ornament',
    variant: 'doodle',
    width: 24,
    height: 24,
    body: '<path d="M3 18c4-1 8-5 10-11m0 0-4 2m4-2 1.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    name: 'doodle-crown',
    title: 'Hand-sketched crown doodle',
    kind: 'ornament',
    variant: 'doodle',
    width: 28,
    height: 24,
    body: '<path d="M4 17.5 3.5 8.5l5.2 4.5L13.5 5l5.1 7.6 5.4-4.2-1 9.1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20.5c5.5-.8 12.5-.6 18 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="3.5" cy="6.5" r="1.1" fill="currentColor"/><circle cx="13.5" cy="3.3" r="1.2" fill="currentColor"/><circle cx="24" cy="6.3" r="1.1" fill="currentColor"/>',
  },
  {
    name: 'motif-underline',
    title: 'Hand-drawn scribble underline motif',
    kind: 'ornament',
    variant: 'motif',
    width: 200,
    height: 16,
    body: '<path d="M2 10C40 4 80 14 120 7s60-2 78 2M10 13c50-4 110 2 180-2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  },
  {
    name: 'motif-cross-out',
    title: 'Editorial cross-out motif',
    kind: 'ornament',
    variant: 'motif',
    width: 120,
    height: 24,
    body: '<path d="M4 15c34-6 78-7 112-3M8 9c38 4 72 6 106 3" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
  },
  {
    name: 'motif-orbit',
    title: 'Signal orbit motif',
    kind: 'ornament',
    variant: 'motif',
    width: 120,
    height: 120,
    body: '<circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.6" stroke-dasharray="6 4"/><ellipse cx="60" cy="60" rx="52" ry="20" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-24 60 60)"/><circle cx="101" cy="40" r="4.5" fill="#00b8f0" stroke="#0d0d0d" stroke-width="1.5"/>',
  },
  {
    name: 'motif-globe-grid',
    title: 'Editorial globe grid motif',
    kind: 'ornament',
    variant: 'motif',
    width: 96,
    height: 96,
    body: '<circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="48" cy="48" rx="19" ry="40" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 34h76M10 62h76M48 8v80" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    name: 'motif-moon-phases',
    title: 'Moon phases strip motif',
    kind: 'ornament',
    variant: 'motif',
    width: 160,
    height: 32,
    body: '<circle cx="20" cy="16" r="10" fill="currentColor"/><path d="M52 6a10 10 0 1 0 0 20 7.5 10 0 0 1 0-20Z" fill="currentColor"/><path d="M84 6a10 10 0 1 0 0 20V6Z" fill="currentColor"/><circle cx="84" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="116" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M116 6a10 10 0 0 1 0 20 6 10 0 0 0 0-20Z" fill="currentColor"/><circle cx="146" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    name: 'motif-eye-target',
    title: 'Witness eye and target motif',
    kind: 'ornament',
    variant: 'motif',
    width: 64,
    height: 40,
    body: '<path d="M4 20c8-11 18-15 28-15s20 4 28 15c-8 11-18 15-28 15S12 31 4 20Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="32" cy="20" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="20" r="3" fill="currentColor"/><path d="M32 3v5M32 32v5M1 20h6M57 20h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  },
];

await mkdir(outputDir, { recursive: true });
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const generatedEntries = [];

for (const entry of materialEntries) {
  const path = `materials/${entry.name}.svg`;
  const svg = wrapSvg(entry.width, entry.height, entry.title, entry.body);
  await writeFile(resolve(root, path), svg, 'utf8');
  generatedEntries.push({
    path,
    kind: entry.kind,
    variant: entry.variant,
    format: 'svg',
    width: entry.width,
    height: entry.height,
  });
}

const ownedPaths = new Set(generatedEntries.map(({ path }) => path));
manifest.assets = replaceGeneratedAssets(manifest.assets, generatedEntries, ownedPaths);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
stdout.write(`Generated ${generatedEntries.length} material and decorative SVG assets.\n`);
