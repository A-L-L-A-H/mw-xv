import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_PALETTES, SOCIAL_THEMES, getSocialFormat } from './social-formats.config.mjs';

const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FONT_DISPLAY = "Anton, Impact, 'Arial Narrow', sans-serif";
const FONT_SANS = "'Space Grotesk', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

export const DEFAULT_TEMPLATE_VARS = Object.freeze({
  TITLE: 'ONE BOARD. EVERY MODEL.',
  EPISODE_TITLE: 'ONE BOARD. EVERY MODEL.',
  SUBTITLE: 'Composable business software with a programmatic addon core.',
  EP: '01',
  EPISODE: 'EP.01',
  LANG: 'EN',
  SKIN: 'light',
});

export function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/gu,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]
  );
}

function assetSlug(filePath) {
  return filePath
    .replace(/\.svg$/u, '')
    .replace(/[^a-zA-Z\d]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

export function getTemplateVirtualPath(formatId, theme = 'light') {
  return `brand/rendered/${formatId}.${theme}.svg`;
}

function assertTheme(theme) {
  if (!SOCIAL_THEMES.includes(theme)) {
    throw new Error(`Unsupported social theme "${theme}". Expected one of: ${SOCIAL_THEMES.join(', ')}`);
  }
  return theme;
}

function resolveTemplateVars(vars = {}, { theme = 'light' } = {}) {
  const input = vars && typeof vars === 'object' ? vars : {};
  const title =
    input.TITLE !== undefined
      ? String(input.TITLE)
      : input.EPISODE_TITLE !== undefined
        ? String(input.EPISODE_TITLE)
        : DEFAULT_TEMPLATE_VARS.TITLE;
  const episodeTitle =
    input.EPISODE_TITLE !== undefined ? String(input.EPISODE_TITLE) : title;
  const subtitle =
    input.SUBTITLE !== undefined ? String(input.SUBTITLE) : DEFAULT_TEMPLATE_VARS.SUBTITLE;

  const rawEp =
    input.EP !== undefined
      ? String(input.EP)
      : input.EPISODE !== undefined
        ? String(input.EPISODE)
        : DEFAULT_TEMPLATE_VARS.EP;
  const ep = rawEp.replace(/^EP\.\s*/iu, '') || DEFAULT_TEMPLATE_VARS.EP;
  const episode = input.EPISODE !== undefined ? String(input.EPISODE) : `EP.${ep}`;

  const lang = input.LANG !== undefined ? String(input.LANG) : DEFAULT_TEMPLATE_VARS.LANG;
  const skin = input.SKIN !== undefined ? String(input.SKIN) : String(theme);

  const resolved = {
    TITLE: title,
    EPISODE_TITLE: episodeTitle,
    SUBTITLE: subtitle,
    EP: ep,
    EPISODE: episode,
    LANG: lang,
    SKIN: skin,
  };

  for (const [key, value] of Object.entries(input)) {
    if (key === 'preservePlaceholders' || key === 'theme' || value === undefined) continue;
    if (/^[A-Z0-9_]+$/u.test(key) && !(key in resolved)) {
      resolved[key] = String(value);
    }
  }

  return resolved;
}

export function injectTemplateVars(svg, vars = {}, options = {}) {
  const preservePlaceholders = Boolean(
    options.preservePlaceholders ?? vars?.preservePlaceholders
  );
  if (preservePlaceholders) return svg;

  const theme = options.theme ?? vars?.SKIN ?? vars?.theme ?? 'light';
  const resolved = resolveTemplateVars(vars, { theme });

  return svg.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (fullMatch, key) => {
    if (!Object.hasOwn(resolved, key)) return fullMatch;
    return escapeXml(resolved[key]);
  });
}

function wrapLines(text, maxChars, maxLines) {
  const normalized = String(text ?? '').trim().replace(/\s+/gu, ' ');
  if (!normalized) return [''];

  const words = normalized.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}…` : word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      lines.push(current);
      if (lines.length === maxLines) {
        const last = lines[maxLines - 1];
        lines[maxLines - 1] =
          last.length >= maxChars
            ? `${last.slice(0, Math.max(1, maxChars - 1))}…`
            : `${last}…`;
        return lines;
      }
      current = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}…` : word;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function renderCrown(x, y, scale, palette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4.5 63 0 16.5 24 40.5 43.5 0 63 40.5 88.5 13.5 82.5 64.5C54 78 28.5 78 4.5 63Z"/><path d="M10.5 67.5 79.5 69 75 78 16.5 79.5ZM21 12 24 0 30 12M39 22.5 43.5 4.5 49.5 22.5M61.5 33 69 18 73.5 34.5"/></g>`;
}

function renderCornerBrackets(x, y, width, height, size, inset, color, strokeWidth = 4) {
  const x1 = Math.round(x + inset);
  const y1 = Math.round(y + inset);
  const x2 = Math.round(x + width - inset);
  const y2 = Math.round(y + height - inset);
  return `<g fill="none" stroke="${color}" stroke-width="${strokeWidth}"><path d="M${x1} ${y1 + size}V${y1}H${x1 + size}M${x2} ${y1 + size}V${y1}H${x2 - size}M${x1} ${y2 - size}V${y2}H${x1 + size}M${x2} ${y2 - size}V${y2}H${x2 - size}"/></g>`;
}

function renderPill({
  x,
  y,
  width,
  height,
  fill,
  text,
  textColor,
  borderColor,
  shadowColor,
  shadowOffset = 4,
  fontFamily = FONT_MONO,
  fontSize = 18,
  fontWeight = 700,
  letterSpacing = 2,
  rx = 4,
  strokeWidth = 2,
}) {
  const rxInt = Math.round(rx);
  const tx = Math.round(x + width / 2);
  const ty = Math.round(y + height / 2 + fontSize * 0.35);
  return [
    `<rect x="${Math.round(x + shadowOffset)}" y="${Math.round(y + shadowOffset)}" width="${Math.round(width)}" height="${Math.round(height)}" rx="${rxInt}" fill="${shadowColor}"/>`,
    `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(width)}" height="${Math.round(height)}" rx="${rxInt}" fill="${fill}" stroke="${borderColor}" stroke-width="${strokeWidth}"/>`,
    `<text x="${tx}" y="${ty}" fill="${textColor}" font-family="${fontFamily}" font-size="${Math.round(fontSize)}" font-weight="${fontWeight}" letter-spacing="${letterSpacing}" text-anchor="middle">${escapeXml(text)}</text>`,
  ].join('');
}

function renderHalftoneDefs(prefix, palette, tile = 40, dotRadius = 2) {
  const half = Math.round(tile / 2);
  const offset = Math.max(4, Math.round(tile * 0.15));
  const id = `${prefix}dots`;
  return {
    id,
    defs: `<defs><pattern id="${id}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><circle cx="${offset}" cy="${offset}" r="${dotRadius}" fill="${palette.ink}" opacity="${palette.halftoneOpacity}"/><circle cx="${offset + half}" cy="${offset + half}" r="${dotRadius}" fill="${palette.ink}" opacity="${palette.halftoneOpacity}"/></pattern></defs>`,
  };
}

function buildCompactBannerBody(spec, palette, prefix, values) {
  const { width: w, height: h, safeArea: sa } = spec;
  const halftone = renderHalftoneDefs(prefix, palette, 28, 1.5);
  const shadowOffset = 5;
  const cardX = sa.x;
  const cardY = sa.y;
  const cardW = sa.width - shadowOffset;
  const cardH = sa.height - shadowOffset;

  const titleText = wrapLines(values.TITLE.toUpperCase(), 26, 1)[0];
  const subtitleText = wrapLines(values.SUBTITLE, 52, 1)[0];
  const metaText = `${values.EPISODE} · ${values.LANG.toUpperCase()}`;

  return [
    halftone.defs,
    `<rect width="${w}" height="${h}" fill="${palette.paper}"/>`,
    `<rect width="${w}" height="${h}" fill="url(#${halftone.id})"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 2H172L116 189H2Z"/>`,
    `<path fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="2" d="M142 2H186L130 189H86Z"/>`,
    `<path fill="${palette.magenta}" stroke="${palette.ink}" stroke-width="2" d="M1092 2H1126V189H1078Z"/>`,
    `<rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="4" fill="${palette.shadow}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="${palette.raised}" stroke="${palette.ink}" stroke-width="3"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="12" rx="2" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2"/>`,
    `<rect x="${cardX + 20}" y="${cardY + 30}" width="84" height="84" rx="4" fill="${palette.shadow}"/>`,
    `<rect x="${cardX + 16}" y="${cardY + 26}" width="84" height="84" rx="4" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2"/>`,
    renderCrown(cardX + 26, cardY + 39, 0.72, palette),
    `<rect x="${cardX + 118}" y="${cardY + 28}" width="510" height="52" rx="3" fill="${palette.yellow}"/>`,
    `<text x="${cardX + 128}" y="${cardY + 68}" fill="${palette.onAccent}" font-family="${FONT_DISPLAY}" font-size="38" font-weight="900" letter-spacing="1.5">${escapeXml(titleText)}</text>`,
    `<path d="M${cardX + 118} ${cardY + 92}H${cardX + 610}" stroke="${palette.magenta}" stroke-width="4" stroke-linecap="round"/>`,
    `<text x="${cardX + 118}" y="${cardY + 122}" fill="${palette.inkMuted}" font-family="${FONT_SANS}" font-size="16" font-weight="700">${escapeXml(subtitleText)}</text>`,
    renderPill({
      x: cardX + cardW - 210,
      y: cardY + 28,
      width: 190,
      height: 40,
      fill: palette.signalBlue,
      text: 'DEV · AI · OPS',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 3,
      fontSize: 15,
      letterSpacing: 2,
    }),
    renderPill({
      x: cardX + cardW - 210,
      y: cardY + 84,
      width: 190,
      height: 38,
      fill: palette.magenta,
      text: metaText,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 3,
      fontSize: 15,
      letterSpacing: 2,
    }),
  ].join('');
}

function buildWideBannerBody(spec, palette, prefix, values) {
  const { width: w, height: h, safeArea: sa } = spec;
  const halftone = renderHalftoneDefs(prefix, palette, 36, 2);
  const shadowOffset = 8;
  const cardX = sa.x;
  const cardY = sa.y;
  const cardW = sa.width - shadowOffset;
  const cardH = sa.height - shadowOffset;
  const compact = cardW < 960;

  const titleLines = wrapLines(values.TITLE.toUpperCase(), compact ? 22 : 28, 2);
  const titleSize = titleLines.length === 1 ? (compact ? 48 : 60) : compact ? 38 : 46;
  const subtitleText = wrapLines(values.SUBTITLE, compact ? 52 : 68, 1)[0];
  const platformTag = spec.platform.toUpperCase();
  const metaLine = `OPEN-SOURCE · EXTENSIBLE · ${values.LANG.toUpperCase()} · ${values.SKIN.toUpperCase()}`;

  const padX = compact ? 32 : 44;
  const innerW = cardW - padX * 2;
  const titleStartY = cardY + (titleLines.length === 1 ? 176 : 156);
  const titleLineStep = Math.round(titleSize * 1.12);
  const highlightH = Math.round(titleSize * 1.24);
  const highlightY = titleStartY - Math.round(titleSize * 0.94);

  const titleNodes = titleLines
    .map((line, index) => {
      const y = titleStartY + index * titleLineStep;
      const fill = index === 0 ? palette.onAccent : palette.ink;
      return `<text x="${cardX + padX + 12}" y="${y}" fill="${fill}" font-family="${FONT_DISPLAY}" font-size="${titleSize}" font-weight="900" letter-spacing="2">${escapeXml(line)}</text>`;
    })
    .join('');

  const ruleY = titleStartY + (titleLines.length - 1) * titleLineStep + 18;
  const subtitleY = ruleY + 34;

  return [
    halftone.defs,
    `<rect width="${w}" height="${h}" fill="${palette.paper}"/>`,
    `<rect width="${w}" height="${h}" fill="url(#${halftone.id})"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 2H${Math.round(w * 0.24)}L${Math.round(w * 0.14)} ${h - 2}H2Z"/>`,
    `<path fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="2" d="M${Math.round(w * 0.78)} 2H${w - 2}V${Math.round(h * 0.56)}Z"/>`,
    `<path fill="${palette.magenta}" stroke="${palette.ink}" stroke-width="2" d="M${Math.round(w * 0.68)} ${h - 2}H${w - 2}V${Math.round(h * 0.54)}Z"/>`,
    `<rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="6" fill="${palette.shadow}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="6" fill="${palette.raised}" stroke="${palette.ink}" stroke-width="4"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="18" rx="3" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2"/>`,
    renderCornerBrackets(cardX, cardY + 18, cardW, cardH - 18, 20, 14, palette.ink, 3),
    renderCrown(cardX + padX, cardY + 38, 0.58, palette),
    `<text x="${cardX + padX + 66}" y="${cardY + 74}" fill="${palette.ink}" font-family="${FONT_DISPLAY}" font-size="34" font-weight="900" letter-spacing="3">MOONWITNESS</text>`,
    renderPill({
      x: cardX + cardW - padX - 284,
      y: cardY + 40,
      width: 146,
      height: 40,
      fill: palette.signalBlue,
      text: platformTag,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 4,
      fontSize: 15,
      letterSpacing: 2,
    }),
    renderPill({
      x: cardX + cardW - padX - 122,
      y: cardY + 40,
      width: 122,
      height: 40,
      fill: palette.yellow,
      text: values.EPISODE,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 4,
      fontFamily: FONT_DISPLAY,
      fontSize: 22,
      fontWeight: 900,
      letterSpacing: 2,
    }),
    `<rect x="${cardX + padX}" y="${highlightY}" width="${Math.min(innerW, Math.round(innerW * 0.88))}" height="${highlightH}" rx="4" fill="${palette.yellow}"/>`,
    titleNodes,
    `<path d="M${cardX + padX} ${ruleY}H${cardX + padX + Math.round(innerW * 0.56)}" stroke="${palette.magenta}" stroke-width="6" stroke-linecap="round"/>`,
    `<text x="${cardX + padX}" y="${subtitleY}" fill="${palette.inkMuted}" font-family="${FONT_SANS}" font-size="${compact ? 20 : 23}" font-weight="700">${escapeXml(subtitleText)}</text>`,
    `<text x="${cardX + padX}" y="${cardY + cardH - 28}" fill="${palette.inkSubtle}" font-family="${FONT_MONO}" font-size="16" font-weight="700" letter-spacing="2">${escapeXml(metaLine)}</text>`,
    renderPill({
      x: cardX + cardW - padX - 184,
      y: cardY + cardH - 54,
      width: 184,
      height: 36,
      fill: palette.magenta,
      text: 'DEV · AI · OPS',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 3,
      fontSize: 15,
      letterSpacing: 2,
    }),
  ].join('');
}

function buildLandscapeBody(spec, palette, prefix, values) {
  const { width: w, height: h, safeArea: sa } = spec;
  const s = sa.height / 512;
  const halftone = renderHalftoneDefs(prefix, palette, Math.round(40 * s), Number((2 * s).toFixed(1)));
  const shadowOffset = Math.round(10 * s);
  const cardX = sa.x;
  const cardY = sa.y;
  const cardW = sa.width - shadowOffset;
  const cardH = sa.height - shadowOffset;
  const padX = Math.round(48 * s);
  const innerW = cardW - padX * 2;
  const ribbonH = Math.round(20 * s);

  const titleLines = wrapLines(values.TITLE.toUpperCase(), 22, 2);
  const titleSize = Math.round((titleLines.length === 1 ? 68 : 54) * s);
  const titleLineStep = Math.round(titleSize * 1.14);
  const titleStartY = cardY + Math.round((titleLines.length === 1 ? 248 : 220) * s);
  const highlightH = Math.round(titleSize * 1.24);
  const highlightY = titleStartY - Math.round(titleSize * 0.94);

  const subtitleLines = wrapLines(values.SUBTITLE, 48, 2);
  const subtitleSize = Math.round(24 * s);
  const ruleY = titleStartY + (titleLines.length - 1) * titleLineStep + Math.round(22 * s);
  const subtitleStartY = ruleY + Math.round(40 * s);

  const titleNodes = titleLines
    .map((line, index) => {
      const y = titleStartY + index * titleLineStep;
      const fill = index === 0 ? palette.onAccent : palette.ink;
      return `<text x="${cardX + padX + Math.round(14 * s)}" y="${y}" fill="${fill}" font-family="${FONT_DISPLAY}" font-size="${titleSize}" font-weight="900" letter-spacing="${Math.round(2 * s)}">${escapeXml(line)}</text>`;
    })
    .join('');

  const subtitleNodes = subtitleLines
    .map(
      (line, index) =>
        `<text x="${cardX + padX}" y="${subtitleStartY + index * Math.round(32 * s)}" fill="${palette.inkMuted}" font-family="${FONT_SANS}" font-size="${subtitleSize}" font-weight="700">${escapeXml(line)}</text>`
    )
    .join('');

  const badgeH = Math.round(46 * s);
  const epW = Math.round(138 * s);
  const platW = Math.round(184 * s);
  const footerY = cardY + cardH - Math.round(74 * s);
  const footerH = Math.round(44 * s);
  const tagText = `${values.LANG.toUpperCase()} · ${values.SKIN.toUpperCase()} · OPEN-SOURCE`;

  return [
    halftone.defs,
    `<rect width="${w}" height="${h}" fill="${palette.paper}"/>`,
    `<rect width="${w}" height="${h}" fill="url(#${halftone.id})"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 ${Math.round(h * 0.68)}L${Math.round(w * 0.56)} 2H${w - 2}V${h - 2}H2Z"/>`,
    `<path fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="2" d="M${w - 2} 2V${Math.round(h * 0.62)}L${Math.round(w * 0.66)} 2Z"/>`,
    `<path fill="${palette.magenta}" stroke="${palette.ink}" stroke-width="2" d="M${w - 2} ${h - 2}H${Math.round(w * 0.36)}L${w - 2} ${Math.round(h * 0.42)}Z"/>`,
    `<rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="${Math.round(8 * s)}" fill="${palette.shadow}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${Math.round(8 * s)}" fill="${palette.raised}" stroke="${palette.ink}" stroke-width="${Math.round(4 * s)}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${ribbonH}" rx="3" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2"/>`,
    renderCornerBrackets(
      cardX,
      cardY + ribbonH,
      cardW,
      cardH - ribbonH,
      Math.round(24 * s),
      Math.round(16 * s),
      palette.ink,
      Math.round(4 * s)
    ),
    renderCrown(cardX + padX, cardY + Math.round(44 * s), Number((0.72 * s).toFixed(2)), palette),
    `<text x="${cardX + padX + Math.round(80 * s)}" y="${cardY + Math.round(88 * s)}" fill="${palette.ink}" font-family="${FONT_DISPLAY}" font-size="${Math.round(38 * s)}" font-weight="900" letter-spacing="${Math.round(3 * s)}">MOONWITNESS</text>`,
    renderPill({
      x: cardX + cardW - padX - epW - platW - Math.round(18 * s),
      y: cardY + Math.round(48 * s),
      width: platW,
      height: badgeH,
      fill: palette.signalBlue,
      text: spec.platform.toUpperCase(),
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: Math.round(4 * s),
      fontSize: Math.round(17 * s),
      letterSpacing: 2,
    }),
    renderPill({
      x: cardX + cardW - padX - epW,
      y: cardY + Math.round(48 * s),
      width: epW,
      height: badgeH,
      fill: palette.yellow,
      text: values.EPISODE,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: Math.round(4 * s),
      fontFamily: FONT_DISPLAY,
      fontSize: Math.round(26 * s),
      fontWeight: 900,
      letterSpacing: 2,
    }),
    `<rect x="${cardX + padX}" y="${highlightY}" width="${Math.round(innerW * 0.86)}" height="${highlightH}" rx="4" fill="${palette.yellow}"/>`,
    titleNodes,
    `<path d="M${cardX + padX} ${ruleY}H${cardX + padX + Math.round(innerW * 0.54)}" stroke="${palette.magenta}" stroke-width="${Math.round(6 * s)}" stroke-linecap="round"/>`,
    subtitleNodes,
    renderPill({
      x: cardX + padX,
      y: footerY,
      width: Math.round(252 * s),
      height: footerH,
      fill: palette.signalBlue,
      text: 'WITNESS THE BUILD',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: Math.round(4 * s),
      fontFamily: FONT_SANS,
      fontSize: Math.round(18 * s),
      fontWeight: 700,
      letterSpacing: 2,
    }),
    renderPill({
      x: cardX + padX + Math.round(270 * s),
      y: footerY,
      width: Math.round(196 * s),
      height: footerH,
      fill: palette.magenta,
      text: 'DEV · AI · OPS',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: Math.round(4 * s),
      fontSize: Math.round(17 * s),
      letterSpacing: 2,
    }),
    `<text x="${cardX + cardW - padX}" y="${footerY + Math.round(29 * s)}" fill="${palette.inkSubtle}" font-family="${FONT_MONO}" font-size="${Math.round(16 * s)}" font-weight="700" letter-spacing="2" text-anchor="end">${escapeXml(tagText)}</text>`,
  ].join('');
}

function buildSquareBody(spec, palette, prefix, values) {
  const { width: w, height: h, safeArea: sa } = spec;
  const halftone = renderHalftoneDefs(prefix, palette, 40, 2);
  const shadowOffset = 12;
  const cardX = sa.x;
  const cardY = sa.y;
  const cardW = sa.width - shadowOffset;
  const cardH = sa.height - shadowOffset;
  const padX = 48;
  const innerW = cardW - padX * 2;

  const subTag = spec.id === 'linkedin-carousel' ? 'LINKEDIN CAROUSEL' : 'INSTAGRAM FEED';
  const titleLines = wrapLines(values.TITLE.toUpperCase(), 16, 3);
  const titleSize = titleLines.length <= 2 ? 76 : 64;
  const titleLineStep = Math.round(titleSize * 1.15);
  const titleStartY = cardY + (titleLines.length === 1 ? 330 : titleLines.length === 2 ? 302 : 278);
  const highlightH = Math.round(titleSize * 1.24);
  const highlightY = titleStartY - Math.round(titleSize * 0.94);

  const titleNodes = titleLines
    .map((line, index) => {
      const y = titleStartY + index * titleLineStep;
      const fill = index === 0 ? palette.onAccent : palette.ink;
      return `<text x="${cardX + padX + 16}" y="${y}" fill="${fill}" font-family="${FONT_DISPLAY}" font-size="${titleSize}" font-weight="900" letter-spacing="2">${escapeXml(line)}</text>`;
    })
    .join('');

  const subtitleLines = wrapLines(values.SUBTITLE, 34, 3);
  const subBoxY = cardY + 558;
  const subBoxH = 166;
  const subLineStep = 38;
  const subStartY =
    subBoxY + Math.round((subBoxH - (subtitleLines.length - 1) * subLineStep) / 2) + 10;

  const subtitleNodes = subtitleLines
    .map(
      (line, index) =>
        `<text x="${cardX + padX + 28}" y="${subStartY + index * subLineStep}" fill="${palette.onAccent}" font-family="${FONT_SANS}" font-size="30" font-weight="700">${escapeXml(line)}</text>`
    )
    .join('');

  const metaChip = `${values.LANG.toUpperCase()} · ${values.SKIN.toUpperCase()} · MW`;

  return [
    halftone.defs,
    `<rect width="${w}" height="${h}" fill="${palette.paper}"/>`,
    `<rect width="${w}" height="${h}" fill="url(#${halftone.id})"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 720L740 2H${w - 2}V${h - 2}H2Z"/>`,
    `<path fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="2" d="M${w - 2} 2V460L620 2Z"/>`,
    `<path fill="${palette.magenta}" stroke="${palette.ink}" stroke-width="2" d="M${w - 2} ${h - 2}H340L${w - 2} 560Z"/>`,
    `<rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="8" fill="${palette.shadow}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="8" fill="${palette.raised}" stroke="${palette.ink}" stroke-width="4"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="24" rx="4" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2"/>`,
    renderCornerBrackets(cardX, cardY + 24, cardW, cardH - 24, 28, 18, palette.ink, 5),
    `<rect x="${cardX + padX + 6}" y="${cardY + 60}" width="104" height="96" rx="4" fill="${palette.shadow}"/>`,
    `<rect x="${cardX + padX}" y="${cardY + 54}" width="104" height="96" rx="4" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="3"/>`,
    renderCrown(cardX + padX + 12, cardY + 66, 0.9, palette),
    `<text x="${cardX + padX + 128}" y="${cardY + 102}" fill="${palette.ink}" font-family="${FONT_DISPLAY}" font-size="44" font-weight="900" letter-spacing="3">MOONWITNESS</text>`,
    `<text x="${cardX + padX + 128}" y="${cardY + 136}" fill="${palette.inkSubtle}" font-family="${FONT_MONO}" font-size="18" font-weight="700" letter-spacing="3">${escapeXml(subTag)}</text>`,
    renderPill({
      x: cardX + cardW - padX - 172,
      y: cardY + 62,
      width: 172,
      height: 64,
      fill: palette.yellow,
      text: values.EPISODE,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontFamily: FONT_DISPLAY,
      fontSize: 34,
      fontWeight: 900,
      letterSpacing: 3,
    }),
    `<rect x="${cardX + padX}" y="${highlightY}" width="${innerW}" height="${highlightH}" rx="4" fill="${palette.yellow}"/>`,
    titleNodes,
    `<path d="M${cardX + padX} ${cardY + 516}H${cardX + padX + Math.round(innerW * 0.72)}" stroke="${palette.magenta}" stroke-width="8" stroke-linecap="round"/>`,
    `<rect x="${cardX + padX + 8}" y="${subBoxY + 8}" width="${innerW}" height="${subBoxH}" rx="6" fill="${palette.shadow}"/>`,
    `<rect x="${cardX + padX}" y="${subBoxY}" width="${innerW}" height="${subBoxH}" rx="6" fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="3"/>`,
    subtitleNodes,
    renderPill({
      x: cardX + padX,
      y: cardY + cardH - 118,
      width: 280,
      height: 64,
      fill: palette.magenta,
      text: 'DEV · AI · OPS',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontSize: 22,
      letterSpacing: 3,
    }),
    renderPill({
      x: cardX + cardW - padX - 310,
      y: cardY + cardH - 118,
      width: 310,
      height: 64,
      fill: palette.paper,
      text: metaChip,
      textColor: palette.ink,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontSize: 20,
      letterSpacing: 2,
    }),
  ].join('');
}

function buildVerticalBody(spec, palette, prefix, values) {
  const { width: w, height: h, safeArea: sa } = spec;
  const halftone = renderHalftoneDefs(prefix, palette, 48, 2.5);
  const shadowOffset = 12;
  const cardX = sa.x;
  const cardY = sa.y;
  const cardW = sa.width - shadowOffset;
  const cardH = sa.height - shadowOffset;
  const padX = 44;
  const innerW = cardW - padX * 2;
  const isTikTok = spec.id === 'tiktok';

  const platformTag = isTikTok ? 'TIKTOK SHORTS' : 'INSTAGRAM REELS';
  const titleLines = wrapLines(values.TITLE.toUpperCase(), isTikTok ? 14 : 16, 4);
  const titleSize = titleLines.length <= 2 ? 78 : 66;
  const titleLineStep = Math.round(titleSize * 1.15);
  const titleStartY = cardY + (titleLines.length <= 2 ? 430 : 390);
  const highlightH = Math.round(titleSize * 1.24);
  const highlightY = titleStartY - Math.round(titleSize * 0.94);

  const titleNodes = titleLines
    .map((line, index) => {
      const y = titleStartY + index * titleLineStep;
      const fill = index === 0 ? palette.onAccent : palette.ink;
      return `<text x="${cardX + padX + 16}" y="${y}" fill="${fill}" font-family="${FONT_DISPLAY}" font-size="${titleSize}" font-weight="900" letter-spacing="2">${escapeXml(line)}</text>`;
    })
    .join('');

  const ruleY = titleStartY + (titleLines.length - 1) * titleLineStep + 36;
  const subBoxY = Math.max(ruleY + 46, cardY + Math.round(cardH * 0.6));
  const subBoxH = 224;
  const subtitleLines = wrapLines(values.SUBTITLE, isTikTok ? 26 : 30, 3);
  const subLineStep = 44;
  const subStartY =
    subBoxY + Math.round((subBoxH - (subtitleLines.length - 1) * subLineStep) / 2) + 12;

  const subtitleNodes = subtitleLines
    .map(
      (line, index) =>
        `<text x="${cardX + padX + 26}" y="${subStartY + index * subLineStep}" fill="${palette.onAccent}" font-family="${FONT_SANS}" font-size="32" font-weight="700">${escapeXml(line)}</text>`
    )
    .join('');

  const footerStripY = cardY + cardH - 168;
  const metaFooter = `DEV · AI · OPS · ${values.LANG.toUpperCase()} · ${values.SKIN.toUpperCase()}`;

  return [
    halftone.defs,
    `<rect width="${w}" height="${h}" fill="${palette.paper}"/>`,
    `<rect width="${w}" height="${h}" fill="url(#${halftone.id})"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 2H${w - 2}V128L2 192Z"/>`,
    `<path fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="2" d="M680 2H${w - 2}V180Z"/>`,
    `<path fill="${palette.magenta}" stroke="${palette.ink}" stroke-width="2" d="M2 1756L${w - 2} 1672V${h - 2}H2Z"/>`,
    `<path fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2" d="M2 1824L520 ${h - 2}H2Z"/>`,
    `<rect x="${cardX + shadowOffset}" y="${cardY + shadowOffset}" width="${cardW}" height="${cardH}" rx="10" fill="${palette.shadow}"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="10" fill="${palette.raised}" stroke="${palette.ink}" stroke-width="5"/>`,
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="28" rx="4" fill="${palette.yellow}" stroke="${palette.ink}" stroke-width="2"/>`,
    renderCornerBrackets(cardX, cardY + 28, cardW, cardH - 28, 32, 20, palette.ink, 5),
    `<rect x="${cardX + padX + 6}" y="${cardY + 72}" width="118" height="108" rx="6" fill="${palette.shadow}"/>`,
    `<rect x="${cardX + padX}" y="${cardY + 66}" width="118" height="108" rx="6" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="3"/>`,
    renderCrown(cardX + padX + 14, cardY + 80, 1.02, palette),
    `<text x="${cardX + padX + 142}" y="${cardY + 120}" fill="${palette.ink}" font-family="${FONT_DISPLAY}" font-size="52" font-weight="900" letter-spacing="3">MOONWITNESS</text>`,
    `<text x="${cardX + padX + 142}" y="${cardY + 158}" fill="${palette.inkSubtle}" font-family="${FONT_MONO}" font-size="20" font-weight="700" letter-spacing="3">${escapeXml(platformTag)}</text>`,
    renderPill({
      x: cardX + padX,
      y: cardY + 210,
      width: 196,
      height: 62,
      fill: palette.yellow,
      text: values.EPISODE,
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontFamily: FONT_DISPLAY,
      fontSize: 34,
      fontWeight: 900,
      letterSpacing: 3,
    }),
    renderPill({
      x: cardX + padX + 216,
      y: cardY + 210,
      width: 148,
      height: 62,
      fill: palette.signalBlue,
      text: values.LANG.toUpperCase(),
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontSize: 24,
      letterSpacing: 3,
    }),
    `<rect x="${cardX + padX}" y="${highlightY}" width="${innerW}" height="${highlightH}" rx="4" fill="${palette.yellow}"/>`,
    titleNodes,
    `<path d="M${cardX + padX} ${ruleY}H${cardX + padX + Math.round(innerW * 0.72)}" stroke="${palette.magenta}" stroke-width="10" stroke-linecap="round"/>`,
    `<rect x="${cardX + padX + 8}" y="${subBoxY + 8}" width="${innerW}" height="${subBoxH}" rx="8" fill="${palette.shadow}"/>`,
    `<rect x="${cardX + padX}" y="${subBoxY}" width="${innerW}" height="${subBoxH}" rx="8" fill="${palette.signalBlue}" stroke="${palette.ink}" stroke-width="4"/>`,
    subtitleNodes,
    renderPill({
      x: cardX + padX,
      y: footerStripY,
      width: innerW,
      height: 70,
      fill: palette.magenta,
      text: 'WITNESS THE BUILD',
      textColor: palette.onAccent,
      borderColor: palette.ink,
      shadowColor: palette.shadow,
      shadowOffset: 6,
      fontFamily: FONT_DISPLAY,
      fontSize: 34,
      fontWeight: 900,
      letterSpacing: 4,
    }),
    `<text x="${Math.round(cardX + cardW / 2)}" y="${cardY + cardH - 46}" fill="${palette.inkSubtle}" font-family="${FONT_MONO}" font-size="20" font-weight="700" letter-spacing="3" text-anchor="middle">${escapeXml(metaFooter)}</text>`,
  ].join('');
}

export function buildSocialTemplateSvg(
  formatSpec,
  { theme = 'light', vars = {}, filePath, preservePlaceholders = false } = {}
) {
  const spec = typeof formatSpec === 'string' ? getSocialFormat(formatSpec) : formatSpec;
  if (!spec || typeof spec.width !== 'number' || typeof spec.height !== 'number') {
    throw new Error('A valid social format specification is required.');
  }
  const activeTheme = assertTheme(theme);
  const palette = BRAND_PALETTES[activeTheme];
  const virtualPath = filePath ?? getTemplateVirtualPath(spec.id, activeTheme);
  const prefix = `mw-${assetSlug(virtualPath)}-`;

  const values = preservePlaceholders
    ? {
        TITLE: '{{TITLE}}',
        EPISODE_TITLE: '{{EPISODE_TITLE}}',
        SUBTITLE: '{{SUBTITLE}}',
        EP: '{{EP}}',
        EPISODE: '{{EPISODE}}',
        LANG: '{{LANG}}',
        SKIN: '{{SKIN}}',
      }
    : resolveTemplateVars(vars, { theme: activeTheme });

  let body;
  if (spec.id === 'linkedin-banner' || spec.height <= 240) {
    body = buildCompactBannerBody(spec, palette, prefix, values);
  } else if (spec.layout === 'banner') {
    body = buildWideBannerBody(spec, palette, prefix, values);
  } else if (spec.layout === 'square') {
    body = buildSquareBody(spec, palette, prefix, values);
  } else if (spec.layout === 'vertical') {
    body = buildVerticalBody(spec, palette, prefix, values);
  } else {
    body = buildLandscapeBody(spec, palette, prefix, values);
  }

  const label = `MoonWitness ${spec.label} (${activeTheme})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}" role="img" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title>${body}</svg>\n`;

  return preservePlaceholders
    ? svg
    : injectTemplateVars(svg, vars, { theme: activeTheme, preservePlaceholders: false });
}

export async function loadOrBuildSocialSvg(
  formatSpec,
  {
    packageRoot = DEFAULT_PACKAGE_ROOT,
    theme = 'light',
    vars = {},
    preservePlaceholders = false,
    filePath,
  } = {}
) {
  const spec = typeof formatSpec === 'string' ? getSocialFormat(formatSpec) : formatSpec;
  const activeTheme = assertTheme(theme);

  if (spec.sourceSvg?.[activeTheme]) {
    const sourcePath = resolve(packageRoot, spec.sourceSvg[activeTheme]);
    const rawSvg = await readFile(sourcePath, 'utf8');
    return injectTemplateVars(rawSvg, vars, {
      theme: activeTheme,
      preservePlaceholders,
    });
  }

  return buildSocialTemplateSvg(spec, {
    theme: activeTheme,
    vars,
    filePath,
    preservePlaceholders,
  });
}
