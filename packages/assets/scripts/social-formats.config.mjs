/**
 * Canonical MoonWitness social media platform format specifications and brand palettes.
 * Palette values stay aligned with `packages/ui/src/styles/tokens.css`.
 */

export const SOCIAL_THEMES = Object.freeze(['light', 'dark']);

export const BRAND_PALETTES = Object.freeze({
  light: Object.freeze({
    paper: '#f3efe4',
    raised: '#fffdf6',
    ink: '#0d0d0d',
    yellow: '#ffe031',
    signalBlue: '#00b8f0',
    magenta: '#ff2e88',
    inkMuted: '#3a3a36',
    inkSubtle: '#6b695f',
    onAccent: '#0d0d0d',
    shadow: '#0d0d0d',
    halftoneOpacity: '0.13',
  }),
  dark: Object.freeze({
    paper: '#0e0e10',
    raised: '#17171a',
    ink: '#f3efe4',
    yellow: '#ffe031',
    signalBlue: '#00b8f0',
    magenta: '#ff2e88',
    inkMuted: '#c4c0b4',
    inkSubtle: '#9c988c',
    onAccent: '#0d0d0d',
    shadow: '#ffe031',
    halftoneOpacity: '0.09',
  }),
});

/** Lowercase 6-digit hex colors approved from `packages/ui/src/styles/tokens.css`. */
export const APPROVED_BRAND_HEX_COLORS = new Set([
  '#f3efe4',
  '#0e0e10',
  '#fffdf6',
  '#17171a',
  '#0d0d0d',
  '#ffe031',
  '#00b8f0',
  '#ff2e88',
  '#3a3a36',
  '#c4c0b4',
  '#6b695f',
  '#9c988c',
  '#59574e',
  '#c9c5b8',
  '#9b988f',
  '#c084fc',
  '#e3dfd4',
  '#cbc7bd',
  '#b6cad7',
  '#e7e2d4',
  '#121216',
  '#232327',
  '#092c49',
  '#421027',
  '#705900',
  '#b20f55',
  '#00749a',
  '#6d28d9',
]);

const KB = 1024;
const MB = 1024 * KB;

export const SOCIAL_FORMATS = Object.freeze({
  og: Object.freeze({
    id: 'og',
    label: 'Open Graph Social Card',
    platform: 'Open Graph',
    layout: 'landscape',
    width: 1200,
    height: 630,
    aspectRatio: '1.91:1',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    sourceSvg: Object.freeze({
      light: 'brand/social-card.svg',
      dark: 'brand/social-card.dark.svg',
    }),
    safeArea: Object.freeze({ x: 60, y: 48, width: 1080, height: 534 }),
  }),
  'youtube-banner': Object.freeze({
    id: 'youtube-banner',
    label: 'YouTube Channel Banner',
    platform: 'YouTube',
    layout: 'banner',
    width: 2560,
    height: 1440,
    aspectRatio: '16:9',
    maxBytes: 6 * MB,
    themes: SOCIAL_THEMES,
    sourceSvg: Object.freeze({
      light: 'brand/moonwitness-youtube-banner.svg',
      dark: 'brand/moonwitness-youtube-banner.dark.svg',
    }),
    safeArea: Object.freeze({
      x: 507,
      y: 508,
      width: 1546,
      height: 423,
      label: 'Desktop & mobile safe area (1546x423)',
    }),
  }),
  'youtube-thumbnail': Object.freeze({
    id: 'youtube-thumbnail',
    label: 'YouTube Video Thumbnail',
    platform: 'YouTube',
    layout: 'landscape',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    sourceSvg: Object.freeze({
      light: 'brand/moonwitness-youtube-thumbnail-template.svg',
      dark: 'brand/moonwitness-youtube-thumbnail-template.dark.svg',
    }),
    safeArea: Object.freeze({
      x: 84,
      y: 84,
      width: 1092,
      height: 532,
      label: 'Main card safe zone',
    }),
  }),
  'youtube-profile': Object.freeze({
    id: 'youtube-profile',
    label: 'YouTube Channel Avatar',
    platform: 'YouTube',
    layout: 'square',
    width: 800,
    height: 800,
    aspectRatio: '1:1',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    sourceSvg: Object.freeze({
      light: 'brand/moonwitness-youtube-logo.svg',
      dark: 'brand/moonwitness-youtube-logo.dark.svg',
    }),
    safeArea: Object.freeze({
      type: 'circle',
      cx: 400,
      cy: 400,
      r: 382,
      label: 'Circular avatar crop',
    }),
  }),
  'youtube-watermark': Object.freeze({
    id: 'youtube-watermark',
    label: 'YouTube Video Watermark',
    platform: 'YouTube',
    layout: 'square',
    width: 150,
    height: 150,
    aspectRatio: '1:1',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    sourceSvg: Object.freeze({
      light: 'brand/moonwitness-youtube-watermark.svg',
      dark: 'brand/moonwitness-youtube-watermark.dark.svg',
    }),
    safeArea: Object.freeze({ x: 10, y: 10, width: 130, height: 130 }),
  }),
  'x-header': Object.freeze({
    id: 'x-header',
    label: 'X / Twitter Profile Header',
    platform: 'X / Twitter',
    layout: 'banner',
    width: 1500,
    height: 500,
    aspectRatio: '3:1',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({
      x: 220,
      y: 60,
      width: 1200,
      height: 340,
      label: 'Avoids bottom-left avatar overlap',
    }),
  }),
  'x-post': Object.freeze({
    id: 'x-post',
    label: 'X / Twitter Feed Image',
    platform: 'X / Twitter',
    layout: 'landscape',
    width: 1600,
    height: 900,
    aspectRatio: '16:9',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 80, y: 64, width: 1440, height: 772 }),
  }),
  linkedin: Object.freeze({
    id: 'linkedin',
    label: 'LinkedIn Feed Post',
    platform: 'LinkedIn',
    layout: 'landscape',
    width: 1200,
    height: 627,
    aspectRatio: '1.91:1',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 72, y: 56, width: 1056, height: 515 }),
  }),
  'linkedin-banner': Object.freeze({
    id: 'linkedin-banner',
    label: 'LinkedIn Company Cover',
    platform: 'LinkedIn',
    layout: 'banner',
    width: 1128,
    height: 191,
    aspectRatio: '5.91:1',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({
      x: 200,
      y: 20,
      width: 880,
      height: 151,
      label: 'Company cover safe zone',
    }),
  }),
  'linkedin-carousel': Object.freeze({
    id: 'linkedin-carousel',
    label: 'LinkedIn Carousel Slide',
    platform: 'LinkedIn',
    layout: 'square',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 72, y: 72, width: 936, height: 936 }),
  }),
  'instagram-square': Object.freeze({
    id: 'instagram-square',
    label: 'Instagram Feed Square',
    platform: 'Instagram',
    layout: 'square',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    maxBytes: 2 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 72, y: 72, width: 936, height: 936 }),
  }),
  'instagram-story': Object.freeze({
    id: 'instagram-story',
    label: 'Instagram Story / Reel',
    platform: 'Instagram',
    layout: 'vertical',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    maxBytes: 4 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({
      x: 80,
      y: 250,
      width: 920,
      height: 1420,
      label: 'Stories/Reels HUD-free safe area',
    }),
  }),
  tiktok: Object.freeze({
    id: 'tiktok',
    label: 'TikTok Vertical Cover',
    platform: 'TikTok',
    layout: 'vertical',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    maxBytes: 4 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({
      x: 80,
      y: 220,
      width: 840,
      height: 1360,
      label: 'Clears right controls & bottom caption',
    }),
  }),
  bluesky: Object.freeze({
    id: 'bluesky',
    label: 'Bluesky Feed Image',
    platform: 'Bluesky',
    layout: 'landscape',
    width: 1600,
    height: 900,
    aspectRatio: '16:9',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 80, y: 64, width: 1440, height: 772 }),
  }),
  'devto-cover': Object.freeze({
    id: 'devto-cover',
    label: 'Dev.to Article Cover',
    platform: 'Dev.to',
    layout: 'banner',
    width: 1000,
    height: 420,
    aspectRatio: '2.38:1',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 56, y: 40, width: 888, height: 340 }),
  }),
  github: Object.freeze({
    id: 'github',
    label: 'GitHub Repository Preview',
    platform: 'GitHub',
    layout: 'landscape',
    width: 1280,
    height: 640,
    aspectRatio: '2:1',
    maxBytes: 1 * MB,
    themes: SOCIAL_THEMES,
    safeArea: Object.freeze({ x: 80, y: 64, width: 1120, height: 512 }),
  }),
});

export function listSocialFormats() {
  return Object.values(SOCIAL_FORMATS);
}

export function getSocialFormat(id) {
  if (typeof id !== 'string' || !Object.hasOwn(SOCIAL_FORMATS, id)) {
    const valid = Object.keys(SOCIAL_FORMATS).join(', ');
    throw new Error(`Unknown social format "${id}". Valid formats: ${valid}`);
  }
  return SOCIAL_FORMATS[id];
}

export function resolveFormatIds(input) {
  const allIds = Object.keys(SOCIAL_FORMATS);
  if (input === undefined || input === null) return [...allIds];

  const rawTokens = Array.isArray(input)
    ? input.flatMap((entry) => String(entry).split(','))
    : String(input).split(',');
  const tokens = rawTokens.map((token) => token.trim()).filter(Boolean);

  if (tokens.length === 0 || tokens.includes('all')) {
    const unknownWithAll = tokens.filter(
      (token) => token !== 'all' && !Object.hasOwn(SOCIAL_FORMATS, token)
    );
    if (unknownWithAll.length > 0) {
      throw new Error(
        `Unknown social format(s): ${unknownWithAll.join(', ')}. Valid formats: all, ${allIds.join(', ')}`
      );
    }
    return [...allIds];
  }

  const unknown = tokens.filter((token) => !Object.hasOwn(SOCIAL_FORMATS, token));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown social format(s): ${unknown.join(', ')}. Valid formats: all, ${allIds.join(', ')}`
    );
  }

  return [...new Set(tokens)];
}
