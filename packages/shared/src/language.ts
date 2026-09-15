/**
 * Supported UI languages (§4).
 *
 * Language is a user preference, never an account type: a farmer may switch at
 * any time without losing entered information, and switching never alters the
 * data they typed.
 */
export const LANGUAGES = {
  en: 'en',
  ta: 'ta',
  kn: 'kn',
  hi: 'hi',
  ml: 'ml',
} as const;

export type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES];

export const ALL_LANGUAGES: readonly Language[] = Object.values(LANGUAGES);

export const DEFAULT_LANGUAGE: Language = LANGUAGES.en;

/** Each language named in itself — never translated into the current UI language. */
export const LANGUAGE_ENDONYM: Record<Language, string> = {
  en: 'English',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
  hi: 'हिन्दी',
  ml: 'മലയാളം',
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (ALL_LANGUAGES as readonly string[]).includes(value);
}

/** Falls back to the default rather than throwing: a bad stored value must not break the app. */
export function coerceLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}
