import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ALL_GENDERS } from '@kisansetu/shared';
import type { Gender, RegistrationView } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useI18n, useT } from '../i18n/index.js';
import { ErrorPanel } from '../components/AppShell.js';
import { useRegistration } from './useRegistration.js';
import { StepNavigation } from './RegistrationLayout.js';

/** Personal details (§41.4). */
export function PersonalDetailsStep(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(view.profile.fullName ?? '');
  const [fullNameLocal, setFullNameLocal] = useState(view.farmer.fullNameLocal ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(view.farmer.dateOfBirth ?? '');
  const [gender, setGender] = useState<Gender | ''>(view.farmer.gender ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const next = await api.put<RegistrationView>('/api/farmer/profile', {
        fullName: fullName.trim(),
        fullNameLocal: fullNameLocal.trim() || null,
        dateOfBirth: dateOfBirth || null,
        gender: gender || null,
        preferredLanguage: language,
      });
      apply(next);
      navigate('/farmer/registration/address');
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-stone-900">{t('registration.personal.title')}</h2>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
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
          <p className="mt-1 text-xs text-stone-500">{t('registration.personal.fullNameHelp')}</p>
        </div>

        <div>
          <label htmlFor="fullNameLocal" className="field-label">
            {t('registration.personal.fullNameLocal')}{' '}
            <span className="font-normal text-stone-400">({t('common.optional')})</span>
          </label>
          <input
            id="fullNameLocal"
            className="field-input"
            value={fullNameLocal}
            onChange={(event) => setFullNameLocal(event.target.value)}
            lang="ta"
          />
          <p className="mt-1 text-xs text-stone-500">
            {t('registration.personal.fullNameLocalHelp')}
          </p>
        </div>

        <div>
          <label htmlFor="dateOfBirth" className="field-label">
            {t('registration.personal.dateOfBirth')}
          </label>
          <input
            id="dateOfBirth"
            type="date"
            className="field-input"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            required
          />
          <p className="mt-1 text-xs text-stone-500">
            {t('registration.personal.dateOfBirthHelp')}
          </p>
        </div>

        <div>
          <label htmlFor="gender" className="field-label">
            {t('registration.personal.gender')}{' '}
            <span className="font-normal text-stone-400">({t('common.optional')})</span>
          </label>
          <select
            id="gender"
            className="field-input"
            value={gender}
            onChange={(event) => setGender(event.target.value as Gender | '')}
          >
            <option value="">—</option>
            {ALL_GENDERS.map((option) => (
              <option key={option} value={option}>
                {t(`gender.${option}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{t('registration.personal.genderHelp')}</p>
        </div>

        {error ? <ErrorPanel error={error} /> : null}

        <StepNavigation submitLabel={t('common.saveAndContinue')} busy={busy} />
      </form>
    </section>
  );
}
