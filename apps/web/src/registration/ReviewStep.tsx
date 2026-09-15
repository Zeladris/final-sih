import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { STEP_PATH, toAcres } from '@kisansetu/shared';
import type { RegistrationStep, RegistrationView } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useI18n, useT } from '../i18n/index.js';
import { ErrorPanel } from '../components/AppShell.js';
import { useRegistration } from './useRegistration.js';

/**
 * Review before submission (§19, §41.9).
 *
 * Every section links back to the step that owns it, so correcting something
 * never means starting over. Submit is offered only when the SERVER says the
 * registration is complete — `canSubmit` comes from the API, not from a local
 * guess, and the API re-checks it again on submit.
 */
export function ReviewStep(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const totalAcres = view.landHoldings.reduce(
    (sum, holding) => sum + toAcres(holding.area, holding.areaUnit),
    0,
  );

  async function handleSubmit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const next = await api.post<RegistrationView>('/api/farmer/registration/submit');
      apply(next);
      navigate('/farmer/registration/submitted', { replace: true });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const formatDate = (iso: string | null): string =>
    iso
      ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata',
        }).format(new Date(iso))
      : t('common.notProvided');

  return (
    <section className="space-y-4">
      <div className="card">
        <h2 className="text-xl font-semibold text-stone-900">{t('registration.review.title')}</h2>
        <p className="mt-1 text-sm text-stone-600">{t('registration.review.subtitle')}</p>
      </div>

      <ReviewSection title={t('registration.step.PERSONAL_DETAILS')} step="PERSONAL_DETAILS">
        <Row label={t('registration.personal.fullName')} value={view.profile.fullName} />
        <Row label={t('registration.personal.fullNameLocal')} value={view.farmer.fullNameLocal} />
        <Row
          label={t('registration.personal.dateOfBirth')}
          value={view.farmer.dateOfBirth ? formatDate(view.farmer.dateOfBirth) : null}
        />
        <Row
          label={t('registration.personal.gender')}
          value={view.farmer.gender ? t(`gender.${view.farmer.gender}`) : null}
        />
      </ReviewSection>

      <ReviewSection title={t('registration.step.ADDRESS')} step="ADDRESS">
        <Row label={t('registration.address.village')} value={view.farmer.village} />
        <Row label={t('registration.address.line1')} value={view.farmer.addressLine1} />
        <Row label={t('registration.address.pincode')} value={view.farmer.pincode} />
      </ReviewSection>

      <ReviewSection title={t('registration.step.LAND_DETAILS')} step="LAND_DETAILS">
        {view.landHoldings.length === 0 ? (
          <p className="text-sm text-stone-500">{t('registration.land.empty')}</p>
        ) : (
          <>
            {view.landHoldings.map((holding) => (
              <Row
                key={holding.id}
                label={t(`land.ownership.${holding.ownershipType}`)}
                value={`${holding.area} ${t(`land.unit.${holding.areaUnit}`)}${
                  holding.primaryCrop ? ` · ${holding.primaryCrop}` : ''
                }${holding.village ? ` · ${holding.village}` : ''}`}
              />
            ))}
            <Row
              label={t('registration.land.totalArea')}
              value={`${totalAcres.toFixed(2)} ${t('land.unit.ACRE')}`}
            />
          </>
        )}
      </ReviewSection>

      <ReviewSection title={t('registration.step.DOCUMENTS')} step="DOCUMENTS">
        {view.documents.length === 0 ? (
          <p className="text-sm text-stone-500">{t('registration.documents.notUploaded')}</p>
        ) : (
          view.documents.map((document) => {
            const requirement = view.requirements.find(
              (entry) => entry.documentKind === document.documentKind,
            );
            return (
              <Row
                key={document.id}
                label={requirement ? t(requirement.translationKey) : document.documentKind}
                value={t(`document.status.${document.status}`)}
              />
            );
          })
        )}
      </ReviewSection>

      <ReviewSection title={t('language.switchLabel')} step="PERSONAL_DETAILS">
        <Row
          label={t('language.switchLabel')}
          value={view.profile.preferredLanguage === 'ta' ? 'தமிழ்' : 'English'}
        />
      </ReviewSection>

      <div className="card">
        {!view.canSubmit ? (
          <div className="mb-4 rounded-lg bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">
              {t('registration.review.incomplete')}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-900">
              {view.blockingReasons.map((reason) => (
                <li key={reason}>{t(reason)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4">
            <ErrorPanel error={error} />
          </div>
        ) : null}

        <button
          type="button"
          className="btn-primary"
          disabled={!view.canSubmit || busy}
          onClick={() => void handleSubmit()}
        >
          {busy ? t('registration.review.submitting') : t('registration.review.submit')}
        </button>
      </div>
    </section>
  );
}

function ReviewSection({
  title,
  step,
  children,
}: {
  title: string;
  step: RegistrationStep;
  children: React.ReactNode;
}): JSX.Element {
  const t = useT();

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-stone-900">{title}</h3>
        <Link
          to={`/farmer/registration/${STEP_PATH[step]}`}
          className="text-sm text-harvest-700 underline underline-offset-2"
        >
          {t('common.edit')}
        </Link>
      </div>
      <dl className="mt-3 space-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }): JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-stone-100 pb-2 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-sm text-stone-900">{value || t('common.notProvided')}</dd>
    </div>
  );
}
