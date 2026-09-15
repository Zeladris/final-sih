import { ALL_LANGUAGES, LANGUAGE_ENDONYM } from '@kisansetu/shared';
import type { Language } from '@kisansetu/shared';
import { useI18n } from '../i18n/index.js';
import { useAuth } from '../auth/AuthProvider.js';
import { api } from '../lib/api.js';

/**
 * Switches UI language without losing entered information (§4).
 *
 * It only changes the language in context; it never touches form state, and it
 * never re-renders a farmer's own typed data through a translator. When the
 * user is signed in, the choice is also persisted to their profile — best
 * effort, because failing to save a preference must not interrupt anything.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }): JSX.Element {
  const { language, setLanguage } = useI18n();
  const { session } = useAuth();

  function choose(next: Language): void {
    if (next === language) return;
    setLanguage(next);

    if (session) {
      void api.put('/api/farmer/language', { preferredLanguage: next }).catch(() => undefined);
    }
  }

  return (
    <div
      className={`inline-flex rounded-lg border border-stone-300 bg-white p-0.5 ${compact ? 'text-xs' : 'text-sm'}`}
      role="group"
      aria-label="Language"
    >
      {ALL_LANGUAGES.map((option) => {
        const active = option === language;
        return (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              active ? 'bg-harvest-700 text-white' : 'text-stone-700 hover:bg-stone-100'
            }`}
          >
            {LANGUAGE_ENDONYM[option]}
          </button>
        );
      })}
    </div>
  );
}
