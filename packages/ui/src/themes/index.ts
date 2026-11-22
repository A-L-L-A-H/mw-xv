export type ColorMode = 'light' | 'dark';

export type SkinDensity = 'comfortable' | 'compact';

export type BuiltinSkinId = 'moonwitness-ink' | 'moonwitness-compact' | 'moonwitness-high-contrast';

export type SkinId = BuiltinSkinId | (string & {});

export interface SkinSwatchPreview {
  readonly background: string;
  readonly surface: string;
  readonly foreground: string;
  readonly accent: string;
}

export interface SkinMetadata {
  readonly id: SkinId;
  readonly label: string;
  readonly description: string;
  readonly supportedModes: readonly ColorMode[];
  readonly supportedDensities: readonly SkinDensity[];
  readonly defaultMode: ColorMode;
  readonly defaultDensity: SkinDensity;
  readonly swatch: SkinSwatchPreview;
}

export interface UserThemePreferences {
  readonly skin: SkinId;
  readonly theme_mode: ColorMode;
  readonly density: SkinDensity;
}

export interface ThemeRegistry {
  readonly defaultSkinId: SkinId;
  register(skin: SkinMetadata): void;
  get(id: string): SkinMetadata | undefined;
  resolve(id?: string | null): SkinMetadata;
  list(): readonly SkinMetadata[];
  has(id: string): boolean;
  isModeSupported(skinId: string, mode: ColorMode): boolean;
  isDensitySupported(skinId: string, density: SkinDensity): boolean;
  normalizePreferences(preferences?: Partial<UserThemePreferences> | null): UserThemePreferences;
}

export const DEFAULT_SKIN_ID: BuiltinSkinId = 'moonwitness-ink';

export const BUILTIN_SKINS: readonly SkinMetadata[] = Object.freeze([
  Object.freeze({
    id: 'moonwitness-ink',
    label: 'MoonWitness Ink',
    description: 'Signature zine and manga editorial aesthetic with warm paper and bold ink.',
    supportedModes: Object.freeze(['light', 'dark'] as const),
    supportedDensities: Object.freeze(['comfortable', 'compact'] as const),
    defaultMode: 'light',
    defaultDensity: 'comfortable',
    swatch: Object.freeze({
      background: '#f3efe4',
      surface: '#fffdf6',
      foreground: '#0d0d0d',
      accent: '#ffe031',
    }),
  }),
  Object.freeze({
    id: 'moonwitness-compact',
    label: 'MoonWitness Compact',
    description: 'Dense operational skin with crisp neutral surfaces and tighter spacing.',
    supportedModes: Object.freeze(['light', 'dark'] as const),
    supportedDensities: Object.freeze(['compact', 'comfortable'] as const),
    defaultMode: 'light',
    defaultDensity: 'compact',
    swatch: Object.freeze({
      background: '#f0eee9',
      surface: '#ffffff',
      foreground: '#111113',
      accent: '#00b8f0',
    }),
  }),
  Object.freeze({
    id: 'moonwitness-high-contrast',
    label: 'MoonWitness High Contrast',
    description: 'Accessibility-focused skin with maximum contrast and reinforced focus borders.',
    supportedModes: Object.freeze(['light', 'dark'] as const),
    supportedDensities: Object.freeze(['comfortable', 'compact'] as const),
    defaultMode: 'light',
    defaultDensity: 'comfortable',
    swatch: Object.freeze({
      background: '#ffffff',
      surface: '#ffffff',
      foreground: '#000000',
      accent: '#ffd000',
    }),
  }),
]);

const SKIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateSkinMetadata(skin: SkinMetadata): void {
  if (!skin || typeof skin.id !== 'string' || !SKIN_ID_PATTERN.test(skin.id)) {
    throw new Error(`Invalid skin id "${String(skin?.id)}": expected lowercase kebab-case slug.`);
  }
  if (typeof skin.label !== 'string' || skin.label.trim().length === 0) {
    throw new Error(`Skin "${skin.id}" must declare a non-empty label.`);
  }
  if (!Array.isArray(skin.supportedModes) || skin.supportedModes.length === 0) {
    throw new Error(`Skin "${skin.id}" must support at least one color mode.`);
  }
  if (!skin.supportedModes.includes(skin.defaultMode)) {
    throw new Error(
      `Skin "${skin.id}" defaultMode "${skin.defaultMode}" is not in supportedModes.`
    );
  }
  if (!Array.isArray(skin.supportedDensities) || skin.supportedDensities.length === 0) {
    throw new Error(`Skin "${skin.id}" must support at least one density.`);
  }
  if (!skin.supportedDensities.includes(skin.defaultDensity)) {
    throw new Error(
      `Skin "${skin.id}" defaultDensity "${skin.defaultDensity}" is not in supportedDensities.`
    );
  }
}

export function createThemeRegistry(
  initialSkins: readonly SkinMetadata[] = BUILTIN_SKINS,
  defaultSkinId: SkinId = DEFAULT_SKIN_ID
): ThemeRegistry {
  const skins = new Map<string, SkinMetadata>();

  const register = (skin: SkinMetadata): void => {
    validateSkinMetadata(skin);
    if (skins.has(skin.id)) {
      throw new Error(`Duplicate skin id "${skin.id}" cannot be registered twice.`);
    }
    skins.set(skin.id, Object.freeze({ ...skin }));
  };

  for (const skin of initialSkins) {
    register(skin);
  }

  if (!skins.has(defaultSkinId)) {
    throw new Error(`Default skin "${defaultSkinId}" is not registered.`);
  }

  const get = (id: string): SkinMetadata | undefined => skins.get(id);

  const resolve = (id?: string | null): SkinMetadata => {
    if (typeof id === 'string' && skins.has(id)) {
      return skins.get(id)!;
    }
    return skins.get(defaultSkinId)!;
  };

  const list = (): readonly SkinMetadata[] => Array.from(skins.values());

  const has = (id: string): boolean => skins.has(id);

  const isModeSupported = (skinId: string, mode: ColorMode): boolean =>
    resolve(skinId).supportedModes.includes(mode);

  const isDensitySupported = (skinId: string, density: SkinDensity): boolean =>
    resolve(skinId).supportedDensities.includes(density);

  const normalizePreferences = (
    preferences?: Partial<UserThemePreferences> | null
  ): UserThemePreferences => {
    const resolvedSkin = resolve(preferences?.skin);
    const mode =
      preferences?.theme_mode && resolvedSkin.supportedModes.includes(preferences.theme_mode)
        ? preferences.theme_mode
        : resolvedSkin.defaultMode;
    const density =
      preferences?.density && resolvedSkin.supportedDensities.includes(preferences.density)
        ? preferences.density
        : resolvedSkin.defaultDensity;
    return {
      skin: resolvedSkin.id,
      theme_mode: mode,
      density,
    };
  };

  return {
    defaultSkinId,
    register,
    get,
    resolve,
    list,
    has,
    isModeSupported,
    isDensitySupported,
    normalizePreferences,
  };
}

export const themeRegistry: ThemeRegistry = createThemeRegistry(BUILTIN_SKINS, DEFAULT_SKIN_ID);
