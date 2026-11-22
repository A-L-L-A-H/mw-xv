export type SupportedLocale = 'en-US' | 'id-ID';

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en-US', 'id-ID'];

export type TranslationDictionary = Readonly<Record<string, string>>;

export type LocaleDictionaries = Readonly<Partial<Record<SupportedLocale, TranslationDictionary>>>;

const LOCALE_PREFIX_MAP: Readonly<Record<string, SupportedLocale>> = {
  en: 'en-US',
  'en-us': 'en-US',
  id: 'id-ID',
  'id-id': 'id-ID',
};

/**
 * Resolves a supported locale deterministically from an explicit user locale
 * or an HTTP Accept-Language header, falling back to `en-US`.
 */
export function resolveLocale(
  userLocale?: string | null,
  acceptLanguage?: string | null
): SupportedLocale {
  for (const candidate of [userLocale, acceptLanguage]) {
    if (!candidate) continue;
    const parts = candidate.split(',');
    for (const rawPart of parts) {
      const tag = rawPart.split(';')[0]?.trim().toLowerCase();
      if (!tag) continue;
      if (tag in LOCALE_PREFIX_MAP) {
        return LOCALE_PREFIX_MAP[tag]!;
      }
      const primary = tag.split('-')[0];
      if (primary && primary in LOCALE_PREFIX_MAP) {
        return LOCALE_PREFIX_MAP[primary]!;
      }
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Looks up a translation key in the requested locale dictionary, falling back
 * to `en-US`, then to `fallback`, and finally to the key itself.
 */
export function translate(
  dictionaries: LocaleDictionaries,
  key: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
  fallback?: string
): string {
  const localized = dictionaries[locale]?.[key];
  if (localized !== undefined) return localized;
  const defaultValue = dictionaries[DEFAULT_LOCALE]?.[key];
  if (defaultValue !== undefined) return defaultValue;
  return fallback ?? key;
}

export function createTranslator(
  dictionaries: LocaleDictionaries,
  locale: SupportedLocale = DEFAULT_LOCALE
): (key: string, fallback?: string) => string {
  return (key: string, fallback?: string) => translate(dictionaries, key, locale, fallback);
}
