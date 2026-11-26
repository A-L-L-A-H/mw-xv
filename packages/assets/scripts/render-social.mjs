import { readFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SOCIAL_FORMATS, SOCIAL_THEMES, getSocialFormat } from './social-formats.config.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const brandRoot = resolve(packageRoot, 'brand');
const FONTS_DIR = resolve(packageRoot, 'fonts');
const FONT_FILES = [
  { family: 'Anton', file: 'Anton-latin.woff2' },
  { family: 'Space Grotesk', file: 'SpaceGrotesk-latin.woff2' },
  { family: 'JetBrains Mono', file: 'JetBrainsMono-latin.woff2' },
];

function requireValue(value, flag) {
  if (value === undefined || value === null) {
    throw new Error(`Missing value for ${flag}`);
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error(`${flag} requires a non-empty string`);
  }
  return trimmed;
}
const proofPath = resolve(repositoryRoot, 'docs/design/assets/brand-identity-contact-sheet.png');
const socialPath = resolve(brandRoot, 'social-card.png');
const docsSocialPath = resolve(repositoryRoot, 'docs/assets/moonwitness/brand/social-card.png');

function dataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function renderLegacy() {
  const browser = await chromium.launch({ headless: true });
  try {
    const socialSvg = await readFile(resolve(brandRoot, 'social-card.svg'), 'utf8');
    const socialPage = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await socialPage.setContent(
      `<html><body style="margin:0;width:1200px;height:630px;overflow:hidden"><img alt="MoonWitness social card" style="display:block;width:1200px;height:630px" src="${dataUrl(socialSvg)}"></body></html>`
    );
    await socialPage.locator('img').evaluate((image) => image.decode());
    await socialPage.screenshot({ path: socialPath, animations: 'disabled' });
    await mkdir(dirname(docsSocialPath), { recursive: true });
    await copyFile(socialPath, docsSocialPath);
    await socialPage.close();

    const previews = await Promise.all(
      [
        'moonwitness-symbol-light.svg',
        'moonwitness-symbol-dark.svg',
        'moonwitness-symbol-mono-light.svg',
        'moonwitness-symbol-mono-dark.svg',
        'moonwitness-wordmark-light.svg',
        'moonwitness-wordmark-dark.svg',
        'moonwitness-wordmark-mono-light.svg',
        'moonwitness-wordmark-mono-dark.svg',
        'moonwitness-lockup-light.svg',
        'moonwitness-lockup-dark.svg',
        'moonwitness-lockup-mono-light.svg',
        'moonwitness-lockup-mono-dark.svg',
        'favicon.svg',
      ].map(async (filename) => {
        const svg = await readFile(resolve(brandRoot, filename), 'utf8');
        return { filename, src: dataUrl(svg) };
      })
    );
    const rows = previews
      .map(({ filename, src }) => {
        const scaleSamples = filename.includes('symbol') || filename === 'favicon.svg';
        const samples = scaleSamples
          ? `<div><img src="${src}" style="width:16px;height:16px" alt=""><span>16px</span></div>
             <div><img src="${src}" style="width:24px;height:24px" alt=""><span>24px</span></div>
             <div><img src="${src}" style="width:32px;height:32px" alt=""><span>32px</span></div>
             <div><img src="${src}" style="width:48px;height:48px" alt=""><span>48px</span></div>`
          : '<span>native proportions</span>';
        return `<article><h2>${filename}</h2><div class="samples">${samples}
        <img class="large" src="${src}" alt="${filename}">
      </div></article>`;
      })
      .join('\n');
    const previewPage = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
      deviceScaleFactor: 1,
    });
    await previewPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#e8e4d9;color:#0d0d0d;font:14px Arial,sans-serif}
    h1{margin:0 0 18px;font-size:22px}main{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    article{min-height:124px;padding:10px 12px;border:2px solid #0d0d0d;background:#fffdf6;box-shadow:3px 3px #0d0d0d}
    article:nth-child(even){background:#0e0e10;color:#fffdf6}.samples{display:flex;align-items:center;gap:18px;height:64px}
    .samples div{display:flex;align-items:center;gap:4px;font-size:10px}.samples .large{max-width:240px;max-height:42px;margin-left:auto}
    </style></head><body><h1>MoonWitness brand assets — scale and theme check</h1><main>${rows}</main></body></html>`);
    await previewPage.locator('main article').last().waitFor();
    await previewPage
      .locator('img')
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    const imageStates = await previewPage.locator('img').evaluateAll((images) =>
      images.map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.naturalWidth,
        bounds: Math.round(image.getBoundingClientRect().width),
      }))
    );
    if (imageStates.some(({ loaded }) => !loaded)) {
      throw new Error(`Brand preview has broken SVGs: ${JSON.stringify(imageStates)}`);
    }
    stdout.write(`Rendered ${imageStates.length} preview images.\n`);
    await mkdir(dirname(proofPath), { recursive: true });
    await previewPage.screenshot({ path: proofPath, fullPage: true, animations: 'disabled' });
    await previewPage.close();
  } finally {
    await browser.close();
  }
}

export function getSocialOutputFilename(formatId, theme) {
  if (!SOCIAL_THEMES.includes(theme)) {
    throw new Error(`Unsupported social theme "${theme}". Expected one of: ${SOCIAL_THEMES.join(', ')}`);
  }
  const spec = typeof formatId === 'string' ? getSocialFormat(formatId) : formatId;
  const base = `${spec.id}.png`;
  return theme === 'dark' ? base.replace(/\.png$/u, '.dark.png') : base;
}

export function formatSocialFormatsList() {
  const lines = Object.values(SOCIAL_FORMATS).map(
    (spec) => `${spec.id} — ${spec.label} (${spec.platform}): ${spec.width}x${spec.height}`
  );
  return `Supported social formats:\n${lines.join('\n')}`;
}

export async function buildEmbeddedFontCss(rootDir) {
  const fontsDir = resolve(rootDir, 'fonts');
  let entries;
  try {
    entries = await readdir(fontsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }

  const css = [];
  for (const { family, file } of FONT_FILES) {
    const fontPath = resolve(fontsDir, file);
    let buffer;
    try {
      buffer = await readFile(fontPath);
    } catch {
      continue;
    }
    const base64 = buffer.toString('base64');
    css.push(
      `@font-face { font-family: '${family}'; src: url('data:font/woff2;base64,${base64}') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }`
    );
  }
  return css.join('\n');
}

// CLI dispatch: only run legacy rendering when invoked directly (not imported).
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  const parsed = parseSocialRenderArgs(process.argv.slice(2));
  if (parsed.mode === 'list') {
    stdout.write(formatSocialFormatsList() + '\n');
    process.exit(0);
  }
  if (parsed.mode === 'help') {
    stdout.write(formatSocialFormatsList() + '\n');
    process.exit(0);
  }
  stdout.write(`Rendered ${socialPath} and ${proofPath}.\n`);
  await import('./render-icons.mjs');
  const { generateContactSheets } = await import('./generate-contact-sheets.mjs');
  const { index, sheetOutputs } = await generateContactSheets({ renderPng: true });
  stdout.write(
    `Generated ${sheetOutputs.length} pack contact sheet(s) across ${index.totalGroups} groups.\n`
  );
}
export function parseSocialRenderArgs(args, { cwd = packageRoot } = {}) {

  const result = {
    mode: 'legacy',
    legacy: true,
    list: false,
    help: false,
    formats: [],
    theme: 'both',
    themes: ['light', 'dark'],
    lang: 'EN',
    outDir: resolve(cwd, 'brand/rendered'),
    vars: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--list') {
      result.mode = 'list';
      result.legacy = false;
      result.list = true;
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      result.mode = 'help';
      result.help = true;
      result.legacy = false;
      i++;
      continue;
    }
    if (arg === '--dark') {
      result.theme = 'dark';
      result.themes = ['dark'];
      result.mode = 'render';
      result.legacy = false;
      i++;
      continue;
    }
    if (arg === '--format' || arg.startsWith('--format=')) {
      result.mode = 'render';
      result.legacy = false;
      const values = requireValue(
        arg.startsWith('--format=') ? arg.slice('--format='.length) : args[++i],
        '--format'
      );
      for (const token of values.split(',')) {
        const id = token.trim();
        if (!id) throw new Error('Format value requires a non-empty string');
        if (id === 'all') {
          result.formats = Object.keys(SOCIAL_FORMATS);
          continue;
        }
        if (!Object.hasOwn(SOCIAL_FORMATS, id)) {
          throw new Error(`Unknown social format "${id}". Valid formats: ${Object.keys(SOCIAL_FORMATS).join(', ')}`);
        }
        result.formats.push(id);
      }
      i++;
      continue;
    }
    if (arg === '--theme' || arg.startsWith('--theme=')) {
      const value = requireValue(
        arg.startsWith('--theme=') ? arg.slice('--theme='.length) : args[++i],
        '--theme'
      );
      if (!SOCIAL_THEMES.includes(value) && value !== 'both') {
        throw new Error(`Unsupported theme "${value}". Expected one of: ${SOCIAL_THEMES.join(', ')}`);
      }
      result.theme = value;
      result.themes = value === 'both' ? [...SOCIAL_THEMES] : [value];
      result.mode = 'render';
      result.legacy = false;
      i++;
      continue;
    }
    if (arg === '--title' || arg.startsWith('--title=')) {
      result.vars.TITLE = requireValue(
        arg.startsWith('--title=') ? arg.slice('--title='.length) : args[++i],
        '--title'
      );
      i++;
      continue;
    }
    if (arg === '--subtitle' || arg.startsWith('--subtitle=')) {
      result.vars.SUBTITLE = requireValue(
        arg.startsWith('--subtitle=') ? arg.slice('--subtitle='.length) : args[++i],
        '--subtitle'
      );
      i++;
      continue;
    }
    if (arg === '--episode' || arg.startsWith('--episode=')) {
      result.vars.EPISODE = requireValue(
        arg.startsWith('--episode=') ? arg.slice('--episode='.length) : args[++i],
        '--episode'
      );
      i++;
      continue;
    }
    if (arg === '--ep' || arg.startsWith('--ep=')) {
      result.vars.EP = requireValue(
        arg.startsWith('--ep=') ? arg.slice('--ep='.length) : args[++i],
        '--ep'
      );
      i++;
      continue;
    }
    if (arg === '--lang' || arg.startsWith('--lang=')) {
      const lang = requireValue(
        arg.startsWith('--lang=') ? arg.slice('--lang='.length) : args[++i],
        '--lang'
      );
      if (!['EN', 'ID'].includes(lang.toUpperCase())) {
        throw new Error(`Unsupported language "${lang}". Supported languages: EN, ID`);
      }
      result.lang = lang;
      result.vars.LANG = lang.toUpperCase();
      i++;
      continue;
    }
    if (arg === '--skin' || arg.startsWith('--skin=')) {
      result.vars.SKIN = requireValue(
        arg.startsWith('--skin=') ? arg.slice('--skin='.length) : args[++i],
        '--skin'
      );
      i++;
      continue;
    }
    if (arg === '--out-dir' || arg.startsWith('--out-dir=')) {
      const outDir = requireValue(
        arg.startsWith('--out-dir=') ? arg.slice('--out-dir='.length) : args[++i],
        '--out-dir'
      );
      result.outDir = resolve(cwd, outDir);
      i++;
      continue;
    }
    throw new Error(`Unknown argument "${arg}"`);
  }

  if (result.formats.length === 0 && result.mode === 'render') {
    result.formats = Object.keys(SOCIAL_FORMATS);
  }

  return result;
}
