import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ALL_LANGUAGES, DEFAULT_LANGUAGE, coerceLanguage } from '@kisansetu/shared';
import type { Language } from '@kisansetu/shared';
import en from './en.json';
import ta from './ta.json';
import kn from './kn.json';
import hi from './hi.json';
import ml from './ml.json';

/**
 * Localisation (§4).
 *
 * A deliberately small implementation rather than a framework: the app needs
 * key lookup, `{placeholder}` interpolation and a language switch that keeps
 * form state, and nothing else. Bundles are plain JSON keyed by stable dotted
 * names, so no UI string is hard-coded in a component.
 *
 * English is the reference bundle. A key missing from any other language
 * falls back to English rather than rendering blank or a raw key name — a
 * farmer seeing one English label is recoverable; an empty button is not
 * (Language & Accessibility Rework §97). Kannada, Hindi and Malayalam cover
 * every high-traffic screen (login, dashboard, booking, status, voice,
 * notifications); the rest of the app currently falls back to English in
 * those three languages while translation continues — Tamil remains the one
 * fully translated language alongside English.
 */

type Bundle = Record<string, string>;

const BUNDLES: Record<Language, Bundle> = { en, ta, kn, hi, ml };

const STORAGE_KEY = 'kisansetu.language';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

interface I18nState {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  /** True until the user (or their profile) has chosen — drives the first-run screen. */
  hasChosen: boolean;
}

const I18nContext = createContext<I18nState | null>(null);

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

function readStoredLanguage(): { language: Language; hasChosen: boolean } {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (ALL_LANGUAGES as readonly string[]).includes(stored)) {
      return { language: stored as Language, hasChosen: true };
    }
  } catch {
    // Private browsing or blocked storage: fall through to the default.
  }
  return { language: DEFAULT_LANGUAGE, hasChosen: false };
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const initial = readStoredLanguage();
  const [language, setLanguageState] = useState<Language>(initial.language);
  const [hasChosen, setHasChosen] = useState(initial.hasChosen);

  useEffect(() => {
    // Screen readers and font selection both key off this.
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language): void => {
    setLanguageState(next);
    setHasChosen(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is a convenience; the choice still applies to this session.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, values) => {
      const template = BUNDLES[language][key] ?? BUNDLES.en[key];
      if (template === undefined) {
        // Surfacing the key beats rendering nothing, and it is obvious in review.
        if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
        return key;
      }
      return interpolate(template, values);
    },
    [language],
  );

  const value = useMemo<I18nState>(
    () => ({ language, setLanguage, t, hasChosen }),
    [language, setLanguage, t, hasChosen],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>.');
  return context;
}

/** Convenience for components that only need the translate function. */
export function useT(): Translate {
  return useI18n().t;
}

/**
 * Adopts the language stored on the farmer's profile once it loads, unless the
 * user has already made an explicit choice in this browser. Their in-browser
 * choice wins — switching language must not be undone by a page load (§4).
 */
export function useAdoptProfileLanguage(profileLanguage: Language | null | undefined): void {
  const { setLanguage, hasChosen } = useI18n();

  useEffect(() => {
    if (!profileLanguage || hasChosen) return;
    setLanguage(coerceLanguage(profileLanguage));
  }, [profileLanguage, hasChosen, setLanguage]);
}
