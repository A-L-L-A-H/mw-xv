import {
  isColorMode,
  isRecord,
  isSkinDensity,
  type ColorMode,
  type SkinDensity,
  type SkinId,
} from '@moonwitness/types';
import { DEFAULT_SKIN_ID, themeRegistry } from '@moonwitness/ui/themes';

export interface BoardPreferences {
  theme: ColorMode;
  skin: SkinId;
  density: SkinDensity;
  language: string;
  timezone: string;
}

export const PREFERENCES_STORAGE_KEY = 'mw-board-preferences';
export const THEME_STORAGE_KEY = 'mw-theme';

function isSupportedLanguage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function isSupportedTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_PREFERENCES: BoardPreferences = {
  theme: 'light',
  skin: DEFAULT_SKIN_ID,
  density: 'comfortable',
  language: 'en-US',
  timezone: 'UTC',
};

export function applySkinToDocument(skin: SkinId, theme: ColorMode, density: SkinDensity): void {
  if (typeof document === 'undefined') return;
  const normalized = themeRegistry.normalizePreferences({
    skin,
    theme_mode: theme,
    density,
  });
  const root = document.documentElement;
  root.dataset.skin = normalized.skin;
  root.dataset.density = normalized.density;
  root.classList.toggle('dark', normalized.theme_mode === 'dark');
}

export function readPreferences(): BoardPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null'
    );
    const legacyTheme: ColorMode =
      window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    if (!isRecord(value)) {
      return {
        ...DEFAULT_PREFERENCES,
        theme: legacyTheme,
      };
    }
    const normalized = themeRegistry.normalizePreferences({
      skin: typeof value.skin === 'string' ? value.skin : DEFAULT_SKIN_ID,
      theme_mode: isColorMode(value.theme) ? value.theme : legacyTheme,
      density: isSkinDensity(value.density) ? value.density : DEFAULT_PREFERENCES.density,
    });
    return {
      theme: normalized.theme_mode,
      skin: normalized.skin,
      density: normalized.density,
      language: isSupportedLanguage(value.language) ? value.language : DEFAULT_PREFERENCES.language,
      timezone: isSupportedTimezone(value.timezone) ? value.timezone : DEFAULT_PREFERENCES.timezone,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: BoardPreferences): void {
  const normalized = themeRegistry.normalizePreferences({
    skin: preferences.skin,
    theme_mode: preferences.theme,
    density: preferences.density,
  });
  const nextPreferences: BoardPreferences = {
    ...preferences,
    skin: normalized.skin,
    theme: normalized.theme_mode,
    density: normalized.density,
  };
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
    window.localStorage.setItem(THEME_STORAGE_KEY, nextPreferences.theme);
  } catch {
    /* storage unavailable: apply to DOM only */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = nextPreferences.language;
    applySkinToDocument(nextPreferences.skin, nextPreferences.theme, nextPreferences.density);
  }
}
