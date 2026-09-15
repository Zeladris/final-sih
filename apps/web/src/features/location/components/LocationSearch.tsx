import { useState } from 'react';
import type { LocationSearchResult } from '@kisansetu/shared';
import { useT } from '../../../i18n/index.js';
import { searchLocation } from '../services/locationApi.js';

/**
 * Explicit, submit-triggered location search (Phase 10 §11, §14).
 *
 * Deliberately NOT autocomplete: nothing here fires on keystroke, only on
 * pressing Search — the one request-per-search shape Nominatim's usage
 * policy asks for, enforced by there being no `onChange` fetch to remove.
 */
export function LocationSearch({
  onSelect,
}: {
  onSelect: (result: LocationSearchResult) => void;
}): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function runSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (query.trim().length < 2) return;

    setBusy(true);
    setError(false);
    setResults(null);
    try {
      const found = await searchLocation(query);
      setResults(found);
    } catch {
      // A geocoder outage is not a form error — manual entry is right there.
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={(event) => void runSearch(event)} className="flex gap-2">
        <label htmlFor="location-search" className="sr-only">
          {t('location.search.label')}
        </label>
        <input
          id="location-search"
          type="search"
          className="field-input flex-1"
          placeholder={t('location.search.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={busy || query.trim().length < 2}>
          {busy ? t('location.search.searching') : t('location.search.button')}
        </button>
      </form>

      {error ? <p className="mt-2 text-xs text-amber-700">{t('location.search.error')}</p> : null}

      {results && results.length === 0 && !error ? (
        <p className="mt-2 text-xs text-stone-500">{t('location.search.noResults')}</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {results.map((result, index) => (
            <li key={`${result.latitude},${result.longitude},${index}`}>
              <button
                type="button"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-left text-sm text-stone-800 transition hover:bg-stone-50"
                onClick={() => {
                  onSelect(result);
                  setResults(null);
                  setQuery(result.displayName);
                }}
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
