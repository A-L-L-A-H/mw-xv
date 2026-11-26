import { mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { argv, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { atomicWrite } from './atomic-write.mjs';
import { buildEmbeddedFontCss } from './render-social.mjs';
import { SOCIAL_FORMATS, SOCIAL_THEMES } from './social-formats.config.mjs';
import { escapeXml } from './social-templates.mjs';

const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPOSITORY_ROOT = resolve(DEFAULT_PACKAGE_ROOT, '../..');

export const DEFAULT_SOURCE_PATH = resolve(
  DEFAULT_REPOSITORY_ROOT,
  'docs/operations/youtube-channel.md'
);
export const DEFAULT_OUT_DIR = resolve(DEFAULT_PACKAGE_ROOT, 'brand/rendered/youtube-thumbnails');

const YOUTUBE_SPEC = SOCIAL_FORMATS['youtube-thumbnail'];
export const YOUTUBE_THUMBNAIL_WIDTH = YOUTUBE_SPEC.width;
export const YOUTUBE_THUMBNAIL_HEIGHT = YOUTUBE_SPEC.height;
export const YOUTUBE_THUMBNAIL_MAX_BYTES = YOUTUBE_SPEC.maxBytes;

function toPosix(filePath) {
  return String(filePath).split(sep).join('/');
}

function cleanMarkdownText(value) {
  let text = String(value ?? '');
  // Unescape markdown-escaped pipes and backslashes
  text = text.replace(/\\([|\\*_`[\]])/gu, '$1');
  // Convert markdown images ![alt](url) and links [label](url) to visible text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
  // Strip inline code backticks
  text = text.replace(/`+([^`]*)`+/gu, '$1');
  // Strip simple inline HTML wrapper tags like <code>, <b>, <strong>, <em>, <i>
  text = text.replace(/<\/?(?:code|b|strong|em|i|span)>/giu, '');
  // Strip bold, italic, and strikethrough markers
  text = text.replace(/\*\*([^*\n]+?)\*\*/gu, '$1');
  text = text.replace(/__([^_\n]+?)__/gu, '$1');
  text = text.replace(/~~([^~\n]+?)~~/gu, '$1');
  text = text.replace(/\*([^*\n]+?)\*/gu, '$1');
  text = text.replace(/(^|[\s(["'])_([^_\n]+?)_(?=$|[\s)\].,!?;:"'])/gu, '$1$2');
  return text.replace(/\s+/gu, ' ').trim();
}

function splitMarkdownRow(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed.includes('|')) return null;

  const cells = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length) {
      current += ch + trimmed[i + 1];
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());

  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();

  return cells.length >= 2 ? cells : null;
}

function isSeparatorRow(cells) {
  return (
    Array.isArray(cells) &&
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{2,}:?$/u.test(cell.replace(/\s+/gu, '')))
  );
}

function parseEpisodeIdentity(rawEp) {
  const cleaned = cleanMarkdownText(rawEp);
  if (!cleaned) return null;

  if (/trailer|\btr\b/iu.test(cleaned) || /^0+$/u.test(cleaned)) {
    return { epNumber: 0, epCode: '00', rawEp: cleaned };
  }

  const digitMatch = cleaned.match(/(\d+)/u);
  if (digitMatch) {
    const epNumber = Number.parseInt(digitMatch[1], 10);
    return {
      epNumber,
      epCode: String(epNumber).padStart(2, '0'),
      rawEp: cleaned,
    };
  }

  return null;
}

export function slugifyEpisode(epNumber, title) {
  const identity = parseEpisodeIdentity(String(epNumber ?? '0'));
  const epCode = identity ? identity.epCode : '00';
  const cleanedTitle = cleanMarkdownText(title ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return cleanedTitle ? `ep-${epCode}-${cleanedTitle}` : `ep-${epCode}`;
}

function classifyTableColumns(headers) {
  const normalized = headers.map((h) => cleanMarkdownText(h).toLowerCase());
  const findCol = (pattern) => normalized.findIndex((h) => pattern.test(h));

  const epIdx = findCol(/^(?:#|ep\.?|episode|no\.?)$/u);
  const titleIdx = findCol(/^(?:title|episode\s*title)$/u);
  const codeIdx = findCol(/^(?:code|task(?:\s*id)?|id)$/u);
  const durationIdx = findCol(/^(?:duration|length|runtime)$/u);
  const formatIdx = findCol(/^(?:format|series|type)$/u);
  const subtitleIdx = findCol(/^(?:subtitle|sub-title|tagline|description|summary)$/u);
  const coreDemoIdx = findCol(/^(?:core\s*demo|demo|topic|focus)$/u);
  const thumbnailTextIdx = findCol(/^(?:thumbnail\s*text|thumb(?:nail)?)$/u);
  const audienceIdx = findCol(/^(?:target\s*audience|audience)$/u);
  const statusIdx = findCol(/^status$/u);

  let score = 0;
  if (epIdx !== -1) score += 10;
  if (titleIdx !== -1) score += 10;
  if (formatIdx !== -1) score += 3;
  if (coreDemoIdx !== -1) score += 3;
  if (thumbnailTextIdx !== -1) score += 3;
  if (audienceIdx !== -1) score += 2;
  if (durationIdx !== -1) score += 2;

  return {
    epIdx,
    titleIdx,
    codeIdx,
    durationIdx,
    formatIdx,
    subtitleIdx,
    coreDemoIdx,
    thumbnailTextIdx,
    audienceIdx,
    statusIdx,
    score,
  };
}

export function parseEpisodeTable(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Episode markdown source must be a string.');
  }

  const lines = markdown.split(/\r?\n/u);
  const candidates = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerCells = splitMarkdownRow(lines[i]);
    if (!headerCells) continue;

    const sepCells = splitMarkdownRow(lines[i + 1]);
    if (!sepCells || !isSeparatorRow(sepCells)) continue;

    const rows = [];
    let j = i + 2;
    while (j < lines.length) {
      const rowCells = splitMarkdownRow(lines[j]);
      if (!rowCells || isSeparatorRow(rowCells)) break;
      rows.push(rowCells);
      j += 1;
    }

    if (rows.length > 0) {
      const cols = classifyTableColumns(headerCells);
      if (cols.epIdx !== -1 && cols.titleIdx !== -1) {
        candidates.push({ cols, rows });
      }
    }

    i = j - 1;
  }

  if (candidates.length === 0) {
    throw new Error('No episode plan table found in markdown source.');
  }

  candidates.sort((a, b) => b.cols.score - a.cols.score || b.rows.length - a.rows.length);
  const { cols, rows } = candidates[0];

  const episodes = [];
  for (const cells of rows) {
    if (cells.every((cell) => !cell.trim())) continue;

    const identity = parseEpisodeIdentity(cells[cols.epIdx] ?? '');
    if (!identity) continue;

    const title = cleanMarkdownText(cells[cols.titleIdx] ?? '');
    if (!title) continue;

    const taskCodeRaw = cols.codeIdx >= 0 ? cleanMarkdownText(cells[cols.codeIdx] ?? '') : '';
    const taskCode =
      taskCodeRaw && taskCodeRaw !== '—' && taskCodeRaw !== '-' && taskCodeRaw !== '--'
        ? taskCodeRaw
        : null;

    const duration = cols.durationIdx >= 0 ? cleanMarkdownText(cells[cols.durationIdx] ?? '') : '';
    const formatCell = cols.formatIdx >= 0 ? cleanMarkdownText(cells[cols.formatIdx] ?? '') : '';
    const explicitSubtitle =
      cols.subtitleIdx >= 0 ? cleanMarkdownText(cells[cols.subtitleIdx] ?? '') : '';
    const coreDemo = cols.coreDemoIdx >= 0 ? cleanMarkdownText(cells[cols.coreDemoIdx] ?? '') : '';
    const audience = cols.audienceIdx >= 0 ? cleanMarkdownText(cells[cols.audienceIdx] ?? '') : '';
    const status = cols.statusIdx >= 0 ? cleanMarkdownText(cells[cols.statusIdx] ?? '') : '';

    const rawThumbText =
      cols.thumbnailTextIdx >= 0 ? cleanMarkdownText(cells[cols.thumbnailTextIdx] ?? '') : '';
    const thumbnailText = rawThumbText.replace(/^["“'](.*)["”']$/u, '$1').trim();

    const format = formatCell || duration;
    const subtitle =
      explicitSubtitle || formatCell || coreDemo || audience || duration || thumbnailText || title;
    const slug = slugifyEpisode(identity.epNumber, title);

    episodes.push({
      epNumber: identity.epNumber,
      epCode: identity.epCode,
      ep: identity.epCode,
      rawEp: identity.rawEp,
      taskCode,
      title,
      subtitle,
      format,
      duration,
      coreDemo,
      thumbnailText: thumbnailText || title,
      audience,
      status,
      slug,
    });
  }

  if (episodes.length === 0) {
    throw new Error('Episode plan table contained no valid episode rows.');
  }

  return episodes;
}

function splitBalancedLines(text) {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    if (text.length <= 22) return [text];
    const midpoint = Math.ceil(text.length / 2);
    return [text.slice(0, midpoint), text.slice(midpoint)];
  }

  let bestSplit = 1;
  let bestMax = Number.POSITIVE_INFINITY;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length; i += 1) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    const maxLen = Math.max(left.length, right.length);
    const diff = Math.abs(left.length - right.length);
    if (maxLen < bestMax || (maxLen === bestMax && diff < bestDiff)) {
      bestMax = maxLen;
      bestDiff = diff;
      bestSplit = i;
    }
  }

  return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
}

function upsertSvgAttribute(attrs, name, value) {
  const escaped = escapeXml(String(value));
  const pattern = new RegExp(`(\\s${name}=)(?:"[^"]*"|'[^']*')`, 'iu');
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, `$1"${escaped}"`);
  }
  return `${attrs} ${name}="${escaped}"`;
}

function readSvgAttribute(attrs, name) {
  const pattern = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'iu');
  const match = attrs.match(pattern);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

function computeTitleLayout(title, textX = '640') {
  const normalized = String(title ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  if (normalized.length <= 22) {
    const fontSize = normalized.length <= 14 ? 84 : 68;
    return {
      lines: [normalized],
      fontSize,
      y: 280,
      letterSpacing: 2,
      innerXml: escapeXml(normalized),
    };
  }

  const lines = splitBalancedLines(normalized);
  const maxLineLen = Math.max(lines[0].length, lines[1].length);

  let fontSize;
  if (normalized.length <= 38 && maxLineLen <= 22) {
    fontSize = 58;
  } else if (normalized.length <= 55 && maxLineLen <= 30) {
    fontSize = 48;
  } else {
    fontSize = Math.max(26, Math.min(44, Math.floor(960 / (maxLineLen * 0.56))));
  }

  const letterSpacing = fontSize >= 50 ? 2 : 1.5;
  const lineStep = Math.round(fontSize * 1.15);
  const y = Math.round(265 - lineStep * 0.35);
  const xAttr = escapeXml(String(textX || '640'));

  const innerXml = `<tspan x="${xAttr}" dy="0">${escapeXml(lines[0])}</tspan><tspan x="${xAttr}" dy="${lineStep}">${escapeXml(lines[1])}</tspan>`;

  return {
    lines,
    fontSize,
    y,
    letterSpacing,
    innerXml,
  };
}

function computeSubtitleLayout(subtitle) {
  const normalized = String(subtitle ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  const len = normalized.length;

  let fontSize;
  let letterSpacing;
  if (len <= 36) {
    fontSize = 36;
    letterSpacing = 2;
  } else if (len <= 44) {
    fontSize = 30;
    letterSpacing = 1;
  } else if (len <= 56) {
    fontSize = 24;
    letterSpacing = 0.5;
  } else if (len <= 74) {
    fontSize = 20;
    letterSpacing = 0.5;
  } else {
    fontSize = Math.max(13, Math.floor(860 / (len * 0.58)));
    letterSpacing = 0;
  }

  const y = len <= 36 ? 410 : Math.round(395 + fontSize * 0.36);

  return {
    fontSize,
    letterSpacing,
    y,
    innerXml: escapeXml(normalized),
  };
}

export function fitThumbnailTitleSvg(svg, { epCode = '01', ep, title = '', subtitle = '' } = {}) {
  if (typeof svg !== 'string' || !svg.trim()) {
    throw new TypeError('SVG template must be a non-empty string.');
  }

  const rawEp = epCode ?? ep ?? '01';
  const normalizedEp =
    String(rawEp)
      .trim()
      .replace(/^EP\.\s*/iu, '') || '01';
  const normalizedTitle = String(title ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  const normalizedSubtitle = String(subtitle ?? '')
    .trim()
    .replace(/\s+/gu, ' ');

  let output = svg;

  output = output.replace(
    /<text\b([^>]*)>([^<]*\{\{EPISODE_TITLE\}\}[^<]*)<\/text>/u,
    (fullMatch, attrs, inner) => {
      const textX = readSvgAttribute(attrs, 'x') || '640';
      const layout = computeTitleLayout(normalizedTitle, textX);
      let nextAttrs = upsertSvgAttribute(attrs, 'font-size', layout.fontSize);
      nextAttrs = upsertSvgAttribute(nextAttrs, 'y', layout.y);
      nextAttrs = upsertSvgAttribute(nextAttrs, 'letter-spacing', layout.letterSpacing);
      const nextInner = inner.replace(/\{\{EPISODE_TITLE\}\}/gu, layout.innerXml);
      return `<text${nextAttrs}>${nextInner}</text>`;
    }
  );

  output = output.replace(
    /<text\b([^>]*)>([^<]*\{\{SUBTITLE\}\}[^<]*)<\/text>/u,
    (fullMatch, attrs, inner) => {
      const layout = computeSubtitleLayout(normalizedSubtitle);
      let nextAttrs = upsertSvgAttribute(attrs, 'font-size', layout.fontSize);
      nextAttrs = upsertSvgAttribute(nextAttrs, 'y', layout.y);
      nextAttrs = upsertSvgAttribute(nextAttrs, 'letter-spacing', layout.letterSpacing);
      const nextInner = inner.replace(/\{\{SUBTITLE\}\}/gu, layout.innerXml);
      return `<text${nextAttrs}>${nextInner}</text>`;
    }
  );

  const escapedEp = escapeXml(normalizedEp);
  const escapedEpisode = escapeXml(`EP.${normalizedEp}`);
  const escapedTitle = escapeXml(normalizedTitle);
  const escapedSubtitle = escapeXml(normalizedSubtitle);

  output = output.replace(/\{\{EP\}\}/gu, escapedEp);
  output = output.replace(/\{\{EPISODE\}\}/gu, escapedEpisode);
  output = output.replace(/\{\{EPISODE_TITLE\}\}/gu, escapedTitle);
  output = output.replace(/\{\{TITLE\}\}/gu, escapedTitle);
  output = output.replace(/\{\{SUBTITLE\}\}/gu, escapedSubtitle);

  return output;
}

function normalizeThemeChoice(value) {
  const normalized = String(value ?? 'both')
    .trim()
    .toLowerCase();
  if (normalized === 'both' || normalized === 'light' || normalized === 'dark') {
    return normalized;
  }
  throw new Error(`Unsupported theme "${value}". Expected one of: light, dark, both.`);
}

function resolveThemes(themeChoice) {
  const normalized = normalizeThemeChoice(themeChoice);
  return normalized === 'both' ? [...SOCIAL_THEMES] : [normalized];
}

function matchesEpisodeFilter(episode, filterValue) {
  const raw = String(filterValue ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;

  if (episode.epCode.toLowerCase() === raw) return true;
  if (String(episode.epNumber) === raw) return true;
  if (episode.rawEp.toLowerCase() === raw) return true;
  if (episode.slug.toLowerCase() === raw) return true;
  if (episode.taskCode && episode.taskCode.toLowerCase() === raw) return true;

  const normalizedQuery = raw.replace(/^ep\.?[-_\s]*/iu, '').replace(/^0+(?=\d)/u, '');
  if (normalizedQuery === String(episode.epNumber)) return true;

  if (
    episode.epNumber === 0 &&
    (raw === 'tr' || raw === 'trailer' || normalizedQuery === 'trailer')
  ) {
    return true;
  }

  return false;
}

export function getThumbnailFilename(slug, theme) {
  if (theme === 'light') return `${slug}.png`;
  if (theme === 'dark') return `${slug}.dark.png`;
  throw new Error(`Unsupported theme "${theme}". Expected one of: light, dark.`);
}

function buildRenderHtml(svgText, fontCss) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
${fontCss}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: ${YOUTUBE_THUMBNAIL_WIDTH}px;
  height: ${YOUTUBE_THUMBNAIL_HEIGHT}px;
  overflow: hidden;
  background: transparent;
}
body > svg {
  display: block;
  width: ${YOUTUBE_THUMBNAIL_WIDTH}px;
  height: ${YOUTUBE_THUMBNAIL_HEIGHT}px;
}
</style>
</head>
<body>${svgText}</body>
</html>`;
}

async function renderSvgToPng(browser, svgText, fontCss) {
  const page = await browser.newPage({
    viewport: { width: YOUTUBE_THUMBNAIL_WIDTH, height: YOUTUBE_THUMBNAIL_HEIGHT },
    deviceScaleFactor: 1,
  });

  try {
    await page.setContent(buildRenderHtml(svgText, fontCss), { waitUntil: 'load' });
    await page.evaluate(async () => {
      const doc = globalThis.document;
      await doc.fonts.ready;
      const svg = doc.querySelector('body > svg');
      if (!svg) {
        throw new Error('Rendered thumbnail SVG root element is missing.');
      }
    });

    const rawBuffer = await page.screenshot({
      type: 'png',
      animations: 'disabled',
    });
    const compressed = await sharp(rawBuffer)
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();

    const metadata = await sharp(compressed).metadata();
    if (
      metadata.width !== YOUTUBE_THUMBNAIL_WIDTH ||
      metadata.height !== YOUTUBE_THUMBNAIL_HEIGHT
    ) {
      throw new Error(
        `Rendered thumbnail dimensions ${metadata.width}x${metadata.height} do not match ${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_THUMBNAIL_HEIGHT}.`
      );
    }

    if (compressed.length > YOUTUBE_THUMBNAIL_MAX_BYTES) {
      throw new Error(
        `Rendered thumbnail exceeds YouTube 2MB limit (${compressed.length} bytes > ${YOUTUBE_THUMBNAIL_MAX_BYTES} bytes).`
      );
    }

    return compressed;
  } finally {
    await page.close();
  }
}

export async function renderYoutubeThumbnails({
  sourcePath = DEFAULT_SOURCE_PATH,
  outDir = DEFAULT_OUT_DIR,
  theme = 'both',
  episodeFilter,
  dryRun = false,
  packageRoot = DEFAULT_PACKAGE_ROOT,
} = {}) {
  const resolvedSourcePath = resolve(sourcePath);
  const resolvedOutDir = resolve(outDir);
  const activeThemes = resolveThemes(theme);

  const markdown = await readFile(resolvedSourcePath, 'utf8');
  const allEpisodes = parseEpisodeTable(markdown);

  const episodes =
    episodeFilter !== undefined && episodeFilter !== null && String(episodeFilter).trim() !== ''
      ? allEpisodes.filter((ep) => matchesEpisodeFilter(ep, episodeFilter))
      : allEpisodes;

  if (episodes.length === 0) {
    const available = allEpisodes.map((ep) => `${ep.epCode} (${ep.title})`).join(', ');
    throw new Error(`No episode matched filter "${episodeFilter}". Available: ${available}`);
  }

  const templateSvgs = {};
  for (const activeTheme of activeThemes) {
    const templateRel = YOUTUBE_SPEC.sourceSvg[activeTheme];
    templateSvgs[activeTheme] = await readFile(resolve(packageRoot, templateRel), 'utf8');
  }

  const jobs = [];
  for (const episode of episodes) {
    for (const activeTheme of activeThemes) {
      const svg = fitThumbnailTitleSvg(templateSvgs[activeTheme], {
        epCode: episode.epCode,
        title: episode.title,
        subtitle: episode.subtitle,
      });
      const filename = getThumbnailFilename(episode.slug, activeTheme);
      const outputPath = resolve(resolvedOutDir, filename);
      jobs.push({
        episode,
        theme: activeTheme,
        svg,
        filename,
        outputPath,
      });
    }
  }

  const manifestPath = resolve(resolvedOutDir, 'thumbnails-manifest.json');

  if (dryRun) {
    const dryFiles = jobs.map((job) => ({
      epNumber: job.episode.epNumber,
      epCode: job.episode.epCode,
      taskCode: job.episode.taskCode,
      title: job.episode.title,
      subtitle: job.episode.subtitle,
      slug: job.episode.slug,
      theme: job.theme,
      filename: job.filename,
      relativePath: toPosix(relative(resolvedOutDir, job.outputPath)),
      outputPath: job.outputPath,
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height: YOUTUBE_THUMBNAIL_HEIGHT,
      bytes: null,
      dryRun: true,
    }));

    const manifest = {
      schemaVersion: 1,
      dryRun: true,
      generatedAt: new Date().toISOString(),
      sourcePath: toPosix(resolvedSourcePath),
      outDir: toPosix(resolvedOutDir),
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height: YOUTUBE_THUMBNAIL_HEIGHT,
      maxBytes: YOUTUBE_THUMBNAIL_MAX_BYTES,
      themes: activeThemes,
      totalEpisodes: episodes.length,
      totalFiles: dryFiles.length,
      files: dryFiles.map(({ outputPath: _outputPath, ...rest }) => rest),
    };

    return {
      dryRun: true,
      sourcePath: resolvedSourcePath,
      outDir: resolvedOutDir,
      themes: activeThemes,
      episodes,
      manifestPath,
      manifest,
      files: dryFiles,
      jobs,
    };
  }

  const fontCss = await buildEmbeddedFontCss(packageRoot);
  await mkdir(resolvedOutDir, { recursive: true });

  const renderedFiles = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const job of jobs) {
      const pngBuffer = await renderSvgToPng(browser, job.svg, fontCss);
      await atomicWrite(job.outputPath, pngBuffer);

      renderedFiles.push({
        epNumber: job.episode.epNumber,
        epCode: job.episode.epCode,
        taskCode: job.episode.taskCode,
        title: job.episode.title,
        subtitle: job.episode.subtitle,
        slug: job.episode.slug,
        theme: job.theme,
        filename: job.filename,
        relativePath: toPosix(relative(resolvedOutDir, job.outputPath)),
        width: YOUTUBE_THUMBNAIL_WIDTH,
        height: YOUTUBE_THUMBNAIL_HEIGHT,
        bytes: pngBuffer.length,
        withinYoutubeLimit: pngBuffer.length <= YOUTUBE_THUMBNAIL_MAX_BYTES,
      });
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourcePath: toPosix(resolvedSourcePath),
    outDir: toPosix(resolvedOutDir),
    width: YOUTUBE_THUMBNAIL_WIDTH,
    height: YOUTUBE_THUMBNAIL_HEIGHT,
    maxBytes: YOUTUBE_THUMBNAIL_MAX_BYTES,
    themes: activeThemes,
    totalEpisodes: episodes.length,
    totalFiles: renderedFiles.length,
    files: renderedFiles,
  };

  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    dryRun: false,
    sourcePath: resolvedSourcePath,
    outDir: resolvedOutDir,
    themes: activeThemes,
    episodes,
    manifestPath,
    manifest,
    files: renderedFiles,
  };
}

function readFlagValue(args, index, flag) {
  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return args[index + 1];
}

export function parseThumbnailArgs(
  args = [],
  {
    cwd = process.cwd(),
    defaultSourcePath = DEFAULT_SOURCE_PATH,
    defaultOutDir = DEFAULT_OUT_DIR,
  } = {}
) {
  const tokens = Array.isArray(args) ? args.map((item) => String(item)) : [];

  let sourcePath = defaultSourcePath;
  let outDir = defaultOutDir;
  let theme = 'both';
  let episodeFilter = null;
  let dryRun = false;
  let list = false;
  let help = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === '--list') {
      list = true;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--dark') {
      theme = 'dark';
      continue;
    }

    if (token === '--source' || token.startsWith('--source=')) {
      const value =
        token === '--source'
          ? readFlagValue(tokens, i++, '--source')
          : token.slice('--source='.length);
      if (!value.trim()) {
        throw new Error('Flag --source requires a non-empty file path.');
      }
      sourcePath = resolve(cwd, value);
      continue;
    }

    if (token === '--out-dir' || token.startsWith('--out-dir=')) {
      const value =
        token === '--out-dir'
          ? readFlagValue(tokens, i++, '--out-dir')
          : token.slice('--out-dir='.length);
      if (!value.trim()) {
        throw new Error('Flag --out-dir requires a non-empty directory path.');
      }
      outDir = resolve(cwd, value);
      continue;
    }

    if (token === '--theme' || token.startsWith('--theme=')) {
      const value =
        token === '--theme'
          ? readFlagValue(tokens, i++, '--theme')
          : token.slice('--theme='.length);
      theme = normalizeThemeChoice(value);
      continue;
    }

    if (
      token === '--episode' ||
      token.startsWith('--episode=') ||
      token === '--ep' ||
      token.startsWith('--ep=')
    ) {
      const prefix = token.startsWith('--ep=') || token === '--ep' ? '--ep' : '--episode';
      const value = token.includes('=')
        ? token.slice(`${prefix}=`.length)
        : readFlagValue(tokens, i++, prefix);
      if (!value.trim()) {
        throw new Error(`Flag ${prefix} requires a non-empty episode code or number.`);
      }
      episodeFilter = value.trim();
      continue;
    }

    throw new Error(`Unknown argument "${token}". Pass --help for usage.`);
  }

  return {
    sourcePath,
    outDir,
    theme,
    themes: resolveThemes(theme),
    episodeFilter,
    dryRun,
    list,
    help,
  };
}

export function formatEpisodesList(episodes) {
  const lines = [`Parsed YouTube episodes (${episodes.length}):`];
  for (const ep of episodes) {
    const code = ep.taskCode ? `[${ep.taskCode}]` : '[--]';
    lines.push(
      `  EP.${ep.epCode} ${code.padEnd(8)} ${ep.slug.padEnd(42)} ${ep.title} — ${ep.subtitle}`
    );
  }
  return lines.join('\n');
}

function formatHelpText() {
  return [
    'Usage: node packages/assets/scripts/render-youtube-thumbnails.mjs [options]',
    '',
    'Options:',
    '  --source <path>             Markdown source with episode table (default: docs/operations/youtube-channel.md)',
    '  --out-dir <path>            Output directory (default: packages/assets/brand/rendered/youtube-thumbnails)',
    '  --theme <light|dark|both>   Theme variant(s) to render (default: both)',
    '  --episode <code|number>     Render only a specific episode (e.g. 00, 01, trailer, YT-004)',
    '  --dry-run                   Plan renders and fit SVGs without launching Chromium or writing PNGs',
    '  --list                      List parsed episodes without launching Chromium',
    '  -h, --help                  Show this help message',
  ].join('\n');
}

async function runCli(cliArgs = argv.slice(2)) {
  const parsed = parseThumbnailArgs(cliArgs);

  if (parsed.help) {
    stdout.write(`${formatHelpText()}\n`);
    return;
  }

  if (parsed.list) {
    const markdown = await readFile(parsed.sourcePath, 'utf8');
    const episodes = parseEpisodeTable(markdown);
    const filtered = parsed.episodeFilter
      ? episodes.filter((ep) => matchesEpisodeFilter(ep, parsed.episodeFilter))
      : episodes;
    stdout.write(`${formatEpisodesList(filtered)}\n`);
    return;
  }

  const result = await renderYoutubeThumbnails({
    sourcePath: parsed.sourcePath,
    outDir: parsed.outDir,
    theme: parsed.theme,
    episodeFilter: parsed.episodeFilter,
    dryRun: parsed.dryRun,
  });

  if (result.dryRun) {
    stdout.write(
      `[dry-run] Planned ${result.files.length} YouTube thumbnail(s) across ${result.episodes.length} episode(s) -> ${result.outDir}\n`
    );
    for (const file of result.files) {
      stdout.write(`  EP.${file.epCode} [${file.theme}] -> ${file.filename}\n`);
    }
    return;
  }

  stdout.write(
    `Rendered ${result.files.length} YouTube thumbnail PNG(s) to ${result.outDir} (manifest: ${result.manifestPath}).\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
