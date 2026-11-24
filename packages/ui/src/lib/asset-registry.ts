import type { SpriteClipMetadata } from '../components/sprite-player.js';

export type CharacterId = 'kuro-signal' | 'vesper-ink';

export const KURO_EXPRESSIONS = [
  'happy',
  'excited',
  'laughing',
  'angry',
  'confused',
  'thinking',
  'surprised',
  'sad',
  'crying',
  'sleepy',
  'curious',
  'celebrating',
  'embarrassed',
  'determined',
  'victory',
  'disappointed',
] as const;

export type KuroExpression = (typeof KURO_EXPRESSIONS)[number];

export const KURO_POSES = [
  'standing',
  'sitting',
  'walking',
  'running',
  'jumping',
  'waving',
  'pointing',
  'reading',
  'gaming',
  'working',
  'holding-objects',
  'celebrating',
] as const;

export type KuroPose = (typeof KURO_POSES)[number];

export const STATE_ILLUSTRATIONS = [
  'empty-dashboard',
  'no-search-results',
  'no-notifications',
  'empty-collection',
  'no-favorites',
  'no-messages',
  'no-activity',
  'first-time',
  'loading',
  'success',
  'error',
  'offline',
  'network-disconnected',
  'maintenance',
  'access-denied',
  'not-found',
  'unexpected-failure',
  'welcome',
  'onboarding',
  'discover',
  'explore',
  'profile',
  'achievement',
  'completion',
  'celebration',
] as const;

export type StateIllustrationSlug = (typeof STATE_ILLUSTRATIONS)[number];

export const STICKER_ASSETS = [
  'speech-bubble-shout',
  'speech-bubble-thought',
  'comic-boom',
  'lightning-bolt',
  'riot-star',
  'street-flame',
  'pixel-heart',
  'hand-arrow',
  'paint-splash',
  'motion-burst',
  'torn-tape-x',
  'graffiti-crown',
] as const;

export type StickerSlug = (typeof STICKER_ASSETS)[number];

export const GAME_ASSETS = [
  'avatar-kuro',
  'avatar-vesper',
  'avatar-frame-riot',
  'badge-signal-scout',
  'badge-archive-keeper',
  'badge-story-architect',
  'badge-zero-drift',
  'rank-rookie',
  'rank-vanguard',
  'rank-legend',
  'quest-banner',
  'reward-crate',
  'level-up-burst',
] as const;

export type GameAssetSlug = (typeof GAME_ASSETS)[number];

export const BACKGROUND_ASSETS = [
  'riot-street-alley',
  'riot-arcade-workbench',
  'halftone-paper-light',
  'halftone-ink-dark',
] as const;

export type BackgroundSlug = (typeof BACKGROUND_ASSETS)[number];

export type BrandMarkVariant = 'lockup' | 'symbol' | 'wordmark';
export type BrandMarkTone = 'dark' | 'light' | 'mono-dark' | 'mono-light';

export const KURO_CLIP_IDS = [
  'idle',
  'blink',
  'wave',
  'celebrate',
  'think',
  'loading',
  'success',
  'error',
] as const;

export type KuroClipId = (typeof KURO_CLIP_IDS)[number];

export const RIOT_ALLEY_SCENE_PATH = 'scenes/riot-alley-scene.json';

export interface UniverseAssetLookupOptions {
  readonly basePath?: string;
  readonly format?: 'webp' | 'png';
}

export interface CharacterClipLookupOptions {
  readonly basePath?: string;
  readonly fps?: number;
  readonly durationMs?: number;
  readonly loop?: boolean;
  readonly pingPong?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export interface ResolvedUniverseImage {
  readonly path: string;
  readonly fallbackPath: string;
  readonly src: string;
  readonly fallbackSrc: string;
  readonly alt: string;
}

export interface ResolvedCharacterClip extends SpriteClipMetadata {
  readonly characterId: 'kuro-signal';
  readonly clipId: KuroClipId;
  readonly framePaths: readonly string[];
  readonly fallbackPath: string;
}

const RIOT_DIR = 'illustrations/riot-universe';
const WORDS = (slug: string) => slug.replaceAll('-', ' ');

const buildImage = (
  path: string,
  alt: string,
  basePath = '',
  fallbackPath = path
): ResolvedUniverseImage => {
  const src = resolveUniverseAsset(path, basePath);
  return {
    path,
    fallbackPath,
    src,
    fallbackSrc: fallbackPath === path ? src : resolveUniverseAsset(fallbackPath, basePath),
    alt,
  };
};

/** Resolve a canonical asset path against an optional app basePath (defaults to root '/'). */
export function resolveUniverseAsset(path: string, basePath = ''): string {
  if (/^(?:https?:|data:|blob:)/iu.test(path)) return path;
  const clean = path.replace(/^\/+/u, '');
  return basePath ? `${basePath.replace(/\/+$/u, '')}/${clean}` : `/${clean}`;
}

/** Resolve a character portrait asset (.webp primary with .png fallback). */
export function getCharacterPortrait(
  characterId: CharacterId,
  expression: KuroExpression = 'determined',
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  const isVesper = characterId === 'vesper-ink';
  const stem = `${RIOT_DIR}/characters/${isVesper ? 'vesper-ink-portrait' : `kuro-signal-expression-${expression}`}`;
  const fallback = `${stem}.png`;
  return buildImage(
    opts.format === 'png' ? fallback : `${stem}.webp`,
    isVesper ? 'Vesper Ink character portrait' : `Kuro Signal (${WORDS(expression)})`,
    opts.basePath,
    fallback
  );
}

/** Resolve a character full-body pose asset (.webp primary with .png fallback). */
export function getCharacterPose(
  characterId: CharacterId,
  pose: KuroPose = 'standing',
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  if (characterId === 'vesper-ink') return getCharacterPortrait('vesper-ink', 'determined', opts);
  const stem = `${RIOT_DIR}/characters/kuro-signal-pose-${pose}`;
  const fallback = `${stem}.png`;
  return buildImage(
    opts.format === 'png' ? fallback : `${stem}.webp`,
    `Kuro Signal ${WORDS(pose)} pose`,
    opts.basePath,
    fallback
  );
}

/** Resolve a state illustration asset (.webp). */
export function getStateIllustration(
  state: StateIllustrationSlug,
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  return buildImage(`${RIOT_DIR}/states/state-${state}.webp`, `${WORDS(state)} state illustration`, opts.basePath);
}

/** Resolve a sticker asset (.png). */
export function getStickerAsset(
  sticker: StickerSlug,
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  return buildImage(`${RIOT_DIR}/stickers/sticker-${sticker}.png`, `${WORDS(sticker)} sticker`, opts.basePath);
}

/** Resolve a game badge, rank, avatar, or reward asset (.png). */
export function getBadgeAsset(
  badge: GameAssetSlug,
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  return buildImage(`${RIOT_DIR}/game/${badge}.png`, `${WORDS(badge)} badge`, opts.basePath);
}

/** Resolve a background texture or scene backdrop asset (.webp). */
export function getBackgroundAsset(
  bg: BackgroundSlug,
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  return buildImage(`${RIOT_DIR}/backgrounds/bg-${bg}.webp`, `${WORDS(bg)} background`, opts.basePath);
}

/** Resolve a canonical MoonWitness brand mark (.svg). */
export function getBrandMarkAsset(
  variant: BrandMarkVariant = 'lockup',
  tone: BrandMarkTone = 'dark',
  opts: UniverseAssetLookupOptions = {}
): ResolvedUniverseImage {
  const path = `brand/moonwitness-${variant}-${tone}.svg`;
  const alt = variant === 'symbol' ? 'MoonWitness crown symbol' : 'MoonWitness';
  return buildImage(path, alt, opts.basePath);
}

/** Resolve a 4-frame sprite clip descriptor compatible with SpritePlayer. */
export function getCharacterClip(
  clipId: KuroClipId,
  opts: CharacterClipLookupOptions = {}
): ResolvedCharacterClip {
  const id = `kuro-signal-${clipId}`;
  const framePaths = ['01', '02', '03', '04'].map((f) => `animation/${id}/${id}-frame-${f}.png`);
  const frames = framePaths.map((p) => resolveUniverseAsset(p, opts.basePath));
  return {
    id,
    characterId: 'kuro-signal',
    clipId,
    framePaths,
    frames,
    fallbackPath: framePaths[0],
    fallbackAsset: frames[0],
    fps: opts.fps ?? 8,
    durationMs: opts.durationMs,
    loop: opts.loop ?? true,
    pingPong: opts.pingPong ?? true,
    width: opts.width ?? 512,
    height: opts.height ?? 512,
  };
}
