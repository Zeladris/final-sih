import { useNavigate } from 'react-router-dom';
import { ALL_LANGUAGES, LANGUAGE_ENDONYM } from '@kisansetu/shared';
import type { Language } from '@kisansetu/shared';
import { useI18n } from '../i18n/index.js';

/**
 * First-run language choice (§7, §41.1).
 *
 * Each language is named in its own script, never translated into the current
 * UI language — a Tamil speaker looks for "தமிழ்", not for "Tamil". Returning
 * users never see this screen: the choice is remembered locally and, once they
 * sign in, on their profile.
 */
export function LanguageSelection(): JSX.Element {
  const { language, setLanguage } = useI18n();
  const navigate = useNavigate();

  function choose(next: Language): void {
    setLanguage(next);
    navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-harvest-700">
            {language === 'ta' ? 'கிசான்சேது' : 'KisanSetu'}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-stone-900">
            Choose your language
          </h1>
          <p className="mt-1 text-lg text-stone-700">உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்</p>
        </div>

        <div className="mt-8 space-y-3">
          {ALL_LANGUAGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              className="flex w-full items-center justify-between rounded-xl border-2 border-stone-200 bg-white px-5 py-5 text-left transition hover:border-harvest-500 hover:bg-harvest-50"
            >
              <span className="text-xl font-semibold text-stone-900">
                {LANGUAGE_ENDONYM[option]}
              </span>
              <span aria-hidden="true" className="text-2xl text-harvest-700">
                →
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-stone-500">
          You can change this at any time · இதை எப்போது வேண்டுமானாலும் மாற்றலாம்
        </p>
      </div>
    </div>
  );
}
