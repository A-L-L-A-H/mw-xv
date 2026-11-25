/**
 * MoonWitness social asset validation pipeline (SM-005).
 *
 * Validates all 16 social formats x 2 themes (light/dark):
 *   - SVG source structure (via validateSvg from ./validate.mjs)
 *   - Dimensions against the canonical platform spec
 *   - Brand-color compliance against tokens.css
 *   - Source byte budget (maxBytes per format)
 *   - Optional rendered PNG + YouTube thumbnail metadata verification
 *
 * Produces a structured JSON completeness matrix consumable by CI.
 *
 * Exports:
 *   extractBrandColorsFromTokensCss(tokensCssPath) -> Set<string>
 *   extractSvgHexColors(svgText) -> Set<string>
 *   validateSocialSvgSource(svgText, filePath, approvedColors) -> { ids, viewBox, width, height, nonCompliantColors, ... }
 *   validateRenderedPng(pngPath, { width, height, maxBytes }) -> { valid, width, height, bytes, error }
 *   validateSocialAssets(options) -> SocialValidationReport
 *
 * CLI flags: --rendered-dir, --thumbnails-dir, --require-rendered, --json, --report
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { validateSvg } from './validate.mjs';
import {
  SOCIAL_THEMES,
  SOCIAL_FORMATS,
  listSocialFormats,
  getSocialFormat,
  APPROVED_BRAND_HEX_COLORS,
} from './social-formats.config.mjs';
import { getTemplateVirtualPath, loadOrBuildSocialSvg } from './social-templates.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultTokensCssPath = resolve(packageRoot, '..', 'ui', 'src', 'styles', 'tokens.css');

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
const HEX_COLOR = /#([0-9a-fA-F]{6})\b/gu;

/** Normalized lowercase approved brand hex colors, sourced from tokens.css at runtime. */
export async function extractBrandColorsFromTokensCss(tokensCssPath = defaultTokensCssPath) {
  const source = await readFile(tokensCssPath, 'utf8');
  const colors = new Set();
  for (const match of source.matchAll(HEX_COLOR)) {
    colors.add(match[1].toLowerCase());
  }
  if (colors.size === 0) {
    throw new Error(`No brand hex colors found in ${tokensCssPath}`);
  }
  return colors;
}

/** Extract every 6-digit hex color referenced in an SVG (fill/stroke/stop-color, etc.). */
export function extractSvgHexColors(svgText) {
  const colors = new Set();
  for (const match of svgText.matchAll(HEX_COLOR)) {
    colors.add(match[1].toLowerCase());
  }
  return colors;
}

function assetSlug(filePath) {
  return filePath
    .replace(/\.svg$/u, '')
    .replace(/[^a-zA-Z\d]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Validate a single social SVG source: structure + brand-color compliance.
 *
 * `filePath` drives the `mw-<assetSlug>-` ID prefix expected by validateSvg:
 *   - file-backed sources use spec.sourceSvg[theme] (e.g. brand/social-card.svg)
 *   - programmatic templates use getTemplateVirtualPath(spec.id, theme)
 */
export function validateSocialSvgSource(svgText, filePath, approvedColors = APPROVED_BRAND_HEX_COLORS) {
  const parsed = validateSvg(svgText, filePath);
  const usedColors = extractSvgHexColors(svgText);
  const normalized = new Set([...approvedColors].map((color) => color.replace(/^#/u, '').toLowerCase()));
  const nonCompliant = [...usedColors].filter((color) => !normalized.has(color));
  return {
    ...parsed,
    usedColors: [...usedColors].sort(),
    nonCompliantColors: nonCompliant.sort(),
    colorCompliant: nonCompliant.length === 0,
  };
}

/**
 * Validate a rendered PNG: magic header, dimensions, optional byte budget.
 */
export async function validateRenderedPng(pngPath, { width, height, maxBytes } = {}) {
  const result = { valid: false, path: pngPath, width: null, height: null, bytes: null, error: null };
  let bytes;
  try {
    bytes = await readFile(pngPath);
  } catch (error) {
    result.error = `missing or unreadable: ${error.code ?? error.message}`;
    return result;
  }
  result.bytes = bytes.length;
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    result.error = 'invalid PNG magic header';
    return result;
  }
  let metadata;
  try {
    metadata = await sharp(pngPath).metadata();
  } catch (error) {
    result.error = `sharp metadata failed: ${error.message}`;
    return result;
  }
  result.width = metadata.width ?? null;
  result.height = metadata.height ?? null;
  if (metadata.format !== 'png') {
    result.error = `unexpected format ${metadata.format}`;
    return result;
  }
  if (typeof width === 'number' && result.width !== width) {
    result.error = `width ${result.width} !== expected ${width}`;
    return result;
  }
  if (typeof height === 'number' && result.height !== height) {
    result.error = `height ${result.height} !== expected ${height}`;
    return result;
  }
  if (typeof maxBytes === 'number' && bytes.length > maxBytes) {
    result.error = `exceeds byte budget ${formatBytes(bytes.length)} > ${formatBytes(maxBytes)}`;
    return result;
  }
  result.valid = true;
  return result;
}

const THEME_LABEL = Object.freeze({ light: 'Light', dark: 'Dark' });

async function readAsset(assetPath) {
  return readFile(resolve(packageRoot, assetPath.replaceAll('/', sep)), 'utf8');
}

function themeVariantPath(spec, theme) {
  return spec.sourceSvg?.[theme] ?? null;
}

function isFileBacked(spec, theme) {
  return Boolean(themeVariantPath(spec, theme));
}

/**
 * Run the full social asset validation and return a completeness report.
 *
 * Options:
 *   renderedDir      directory of rendered PNGs (default brand/rendered)
 *   thumbnailsDir    directory of YouTube thumbnail PNGs (default brand/rendered/youtube-thumbnails)
 *   requireRendered  when true, missing/invalid rendered PNGs fail validation
 *   approvedColors   override set of approved brand hex colors
 */
export async function validateSocialAssets({
  renderedDir = 'brand/rendered',
  thumbnailsDir = 'brand/rendered/youtube-thumbnails',
  requireRendered = false,
  approvedColors = APPROVED_BRAND_HEX_COLORS,
} = {}) {
  const renderedDirAbs = resolve(packageRoot, renderedDir.replaceAll('/', sep));
  const thumbnailsDirAbs = resolve(packageRoot, thumbnailsDir.replaceAll('/', sep));

  const tokenColors = approvedColors;

  const formats = [];
  let totalThemeVariants = 0;
  let validSvg = 0;
  let invalidSvg = 0;
  let completeCount = 0;
  let incompleteCount = 0;

  for (const spec of listSocialFormats()) {
    const formatResult = {
      id: spec.id,
      label: spec.label,
      platform: spec.platform,
      layout: spec.layout,
      width: spec.width,
      height: spec.height,
      aspectRatio: spec.aspectRatio,
      maxBytes: spec.maxBytes,
      themes: [],
      complete: true,
    };

    for (const theme of SOCIAL_THEMES) {
      totalThemeVariants += 1;
      const variant = {
        theme,
        label: THEME_LABEL[theme],
        sourceKind: isFileBacked(spec, theme) ? 'file' : 'template',
        sourcePath: themeVariantPath(spec, theme) ?? null,
        virtualPath: isFileBacked(spec, theme)
          ? null
          : getTemplateVirtualPath(spec.id, theme),
        svgValid: false,
        svgError: null,
        viewBox: null,
        width: null,
        height: null,
        dimensionsMatch: false,
        byteSize: null,
        withinByteBudget: null,
        usedColors: [],
        nonCompliantColors: [],
        colorCompliant: false,
        renderedPng: null,
        thumbnail: null,
        passed: false,
      };

      let svgText;
      try {
        if (isFileBacked(spec, theme)) {
          svgText = await readAsset(variant.sourcePath);
        } else {
          svgText = await loadOrBuildSocialSvg(spec, {
            packageRoot,
            theme,
            preservePlaceholders: true,
          });
        }
      } catch (error) {
        variant.svgError = error.message;
        variant.passed = false;
        formatResult.complete = false;
        invalidSvg += 1;
        formatResult.themes.push(variant);
        continue;
      }

      let parsed;
      try {
        parsed = validateSocialSvgSource(
          svgText,
          variant.sourceKind === 'file' ? variant.sourcePath : variant.virtualPath,
          tokenColors
        );
      } catch (error) {
        variant.svgError = error.message;
        variant.passed = false;
        formatResult.complete = false;
        invalidSvg += 1;
        formatResult.themes.push(variant);
        continue;
      }

      Object.assign(variant, {
        svgValid: true,
        viewBox: parsed.viewBox,
        width: parsed.width,
        height: parsed.height,
        usedColors: parsed.usedColors,
        nonCompliantColors: parsed.nonCompliantColors,
        colorCompliant: parsed.colorCompliant,
      });

      const w = Number(parsed.width);
      const h = Number(parsed.height);
      variant.dimensionsMatch = w === spec.width && h === spec.height;

      let byteSize = 0;
      try {
        const stats = await stat(
          resolve(
            packageRoot,
            (variant.sourceKind === 'file' ? variant.sourcePath : variant.virtualPath).replaceAll(
              '/',
              sep
            )
          )
        );
        byteSize = stats.size;
      } catch {
        byteSize = Buffer.byteLength(svgText, 'utf8');
      }
      variant.byteSize = byteSize;
      variant.withinByteBudget = byteSize <= spec.maxBytes;

      const svgOk =
        variant.svgValid &&
        variant.dimensionsMatch &&
        variant.colorCompliant &&
        variant.withinByteBudget !== false;

      // Rendered PNG check (applies to every format; sourced from renderedDir/<id>.<theme>.png).
      // Light theme uses <id>.png, dark theme uses <id>.dark.png (matching render-social.mjs output).
      const renderedPngFileName = theme === 'light' ? `${spec.id}.png` : `${spec.id}.dark.png`;
      const renderedPngPath = resolve(renderedDirAbs, renderedPngFileName);
      try {
        const pngValidation = await validateRenderedPng(renderedPngPath, {
          width: spec.width,
          height: spec.height,
          maxBytes: spec.maxBytes,
        });
        variant.renderedPng = {
          present: true,
          path: renderedPngPath,
          width: pngValidation.width,
          height: pngValidation.height,
          bytes: pngValidation.bytes,
          valid: pngValidation.valid,
          error: pngValidation.error,
        };
        if (!pngValidation.valid && requireRendered) {
          variant.passed = false;
          formatResult.complete = false;
        }
      } catch {
        variant.renderedPng = {
          present: false,
          path: renderedPngPath,
          width: null,
          height: null,
          bytes: null,
          valid: false,
          error: requireRendered ? 'missing rendered PNG' : null,
        };
        if (requireRendered) {
          variant.passed = false;
          formatResult.complete = false;
        }
      }

      // YouTube thumbnail check (youtube-thumbnail format only).
      if (spec.id === 'youtube-thumbnail') {
        let thumbnailFiles = [];
        try {
          const entries = (await stat(thumbnailsDirAbs)).isDirectory()
            ? await (await import('node:fs/promises')).readdir(thumbnailsDirAbs)
            : [];
          // Thumbnails are named by episode slug (e.g., ep-00-channel-trailer.png), not youtube-thumbnail-*.png
          thumbnailFiles = entries.filter(
            (name) =>
              name.toLowerCase().endsWith('.png') &&
              !name.toLowerCase().includes('manifest')
          );
        } catch {
          thumbnailFiles = [];
        }
        variant.thumbnail = {
          present: thumbnailFiles.length > 0,
          path: thumbnailsDirAbs,
          files: thumbnailFiles,
          count: thumbnailFiles.length,
          error: requireRendered && thumbnailFiles.length === 0 ? 'missing YouTube thumbnail PNGs' : null,
        };
        if (requireRendered && thumbnailFiles.length === 0) {
          variant.passed = false;
          formatResult.complete = false;
        }
      }

      variant.passed =
        svgOk &&
        (!requireRendered ||
          (variant.renderedPng.present &&
            variant.renderedPng.valid &&
            (!variant.thumbnail || variant.thumbnail.present)));
      if (!svgOk) {
        invalidSvg += 1;
        formatResult.complete = false;
      } else {
        validSvg += 1;
      }
      formatResult.themes.push(variant);
    }

    if (formatResult.complete) completeCount += 1;
    else incompleteCount += 1;
    formats.push(formatResult);
  }

  const passed =
    invalidSvg === 0 &&
    incompleteCount === 0 &&
    (!requireRendered || formats.every((f) => f.themes.every((t) => t.passed)));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requireRendered,
    renderedDir: renderedDirAbs,
    thumbnailsDir: thumbnailsDirAbs,
    formats,
    summary: {
      totalFormats: formats.length,
      totalThemeVariants,
      validSvg,
      invalidSvg,
      completeFormats: completeCount,
      incompleteFormats: incompleteCount,
    },
    passed,
  };
}

function renderReport(report) {
  const lines = [
    `MoonWitness social asset validation — ${report.generatedAt}`,
    `  formats: ${report.summary.totalFormats} (${report.summary.completeFormats} complete, ${report.summary.incompleteFormats} incomplete)`,
    `  theme variants: ${report.summary.totalThemeVariants} (${report.summary.validSvg} valid SVG, ${report.summary.invalidSvg} invalid)`,
    `  requireRendered: ${report.requireRendered}`,
    '',
  ];
  for (const format of report.formats) {
    const mark = format.complete ? 'ok' : 'XX';
    lines.push(
      `[${mark}] ${format.id} (${format.platform}) ${format.width}x${format.height} ${format.aspectRatio} budget=${formatBytes(format.maxBytes)}`
    );
    for (const theme of format.themes) {
      const svgMark = theme.svgValid ? 'ok' : 'XX';
      const dimMark = theme.dimensionsMatch ? 'ok' : 'XX';
      const colorMark = theme.colorCompliant ? 'ok' : 'XX';
      const byteMark = theme.withinByteBudget !== false ? 'ok' : 'XX';
      const renderedMark = theme.renderedPng.present
        ? theme.renderedPng.valid
          ? 'ok'
          : 'XX'
        : requireRendered
          ? 'XX'
          : '--';
      lines.push(
        `    ${theme.label}: svg=${svgMark} dims=${dimMark} colors=${colorMark} bytes=${byteMark} rendered=${renderedMark}` +
          (theme.svgError ? ` :: ${theme.svgError}` : '') +
          (theme.nonCompliantColors.length ? ` :: non-compliant ${theme.nonCompliantColors.join(', ')}` : '')
      );
    }
  }
  lines.push('', report.passed ? 'RESULT: all social assets valid' : 'RESULT: validation failed');
  return lines.join('\n');
}

const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1].toLowerCase() === selfPath.toLowerCase()) {
  (async () => {
    const args = process.argv.slice(2);
    const options = {};
    let json = false;
    let reportPath = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--json') json = true;
      else if (arg === '--require-rendered') options.requireRendered = true;
      else if (arg === '--rendered-dir') options.renderedDir = args[++index];
      else if (arg === '--thumbnails-dir') options.thumbnailsDir = args[++index];
      else if (arg === '--report') reportPath = args[++index];
      else {
        stderrWrite(`Unknown argument: ${arg}`);
        process.exitCode = 2;
        return;
      }
    }

    const report = await validateSocialAssets(options);
    const output = json ? JSON.stringify(report, null, 2) : renderReport(report);
    if (reportPath) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(reportPath, output, 'utf8');
      if (!json) stdout.write(`Report written to ${reportPath}\n${output}\n`);
    } else {
      stdout.write(`${output}\n`);
    }
    if (!report.passed) process.exitCode = 1;
  })();
}

function stderrWrite(text) {
  process.stderr.write(`${text}\n`);
}
