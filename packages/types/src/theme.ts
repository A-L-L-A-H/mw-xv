export type ColorMode = 'light' | 'dark';

export type SkinDensity = 'comfortable' | 'compact';

export type BuiltinSkinId =
  'moonwitness-ink' | 'moonwitness-compact' | 'moonwitness-high-contrast' | 'moonwitness-riot';

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

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark';
}

export function isSkinDensity(value: unknown): value is SkinDensity {
  return value === 'comfortable' || value === 'compact';
}

export const SKIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSkinMetadata(value: unknown): value is SkinMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !SKIN_ID_PATTERN.test(candidate.id)) return false;
  if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) return false;
  if (typeof candidate.description !== 'string') return false;
  if (
    !Array.isArray(candidate.supportedModes) ||
    candidate.supportedModes.length === 0 ||
    !candidate.supportedModes.every(isColorMode)
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate.supportedDensities) ||
    candidate.supportedDensities.length === 0 ||
    !candidate.supportedDensities.every(isSkinDensity)
  ) {
    return false;
  }
  if (!isColorMode(candidate.defaultMode)) return false;
  if (!isSkinDensity(candidate.defaultDensity)) return false;
  if (!candidate.supportedModes.includes(candidate.defaultMode)) return false;
  if (!candidate.supportedDensities.includes(candidate.defaultDensity)) return false;
  if (typeof candidate.swatch !== 'object' || candidate.swatch === null) return false;
  const swatch = candidate.swatch as Record<string, unknown>;
  return (
    typeof swatch.background === 'string' &&
    typeof swatch.surface === 'string' &&
    typeof swatch.foreground === 'string' &&
    typeof swatch.accent === 'string'
  );
}
