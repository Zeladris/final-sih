import { useState } from 'react';
import type { RegistrationView } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useI18n, useT } from '../i18n/index.js';
import { ErrorPanel } from '../components/AppShell.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';

/**
 * Creates the registration for a newly-authenticated farmer (§10).
 *
 * Reached only when the server reported no existing registration, so a
 * returning farmer never sees it and cannot create a duplicate.
 */
export function StartStep(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { refreshProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError(new Error(t('registration.personal.fullName')));
      return;
    }

    setBusy(true);
    try {
      await api.post<RegistrationView>('/api/farmer/registration', {
        fullName: fullName.trim(),
        preferredLanguage: language,
      });

      // No navigate() here on purpose. refreshProfile() clears
      // `needsOnboarding`, which makes the layout refetch and route to the
      // right first step itself. Navigating from here too would race that
      // refetch and bounce the farmer through the start screen again.
      await refreshProfile();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="card w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              {t('registration.start.title')}
            </h1>
            <p className="mt-2 text-sm text-stone-600">{t('registration.start.subtitle')}</p>
          </div>
          <LanguageSwitcher compact />
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="fullName" className="field-label">
              {t('registration.personal.fullName')}
            </label>
            <input
              id="fullName"
              className="field-input"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
              minLength={2}
            />
            <p className="mt-1.5 text-xs text-stone-500">
              {t('registration.personal.fullNameHelp')}
            </p>
          </div>

          {error ? <ErrorPanel error={error} /> : null}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('common.saving') : t('registration.start.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
