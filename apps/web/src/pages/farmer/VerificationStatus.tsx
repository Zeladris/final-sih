import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALL_VERIFICATION_CHECK_TYPES, isEditable, needsFarmerAction } from '@kisansetu/shared';
import type { VerificationStatusView } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

/**
 * Farmer-facing verification status (§20, §42).
 *
 * Technical state names never reach the screen: every status renders through
 * an i18n key pair (heading + body). A rejection always says what to fix and
 * offers the action that fixes it, rather than a bare "verification failed".
 */
export function VerificationStatus(): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const [status, setStatus] = useState<VerificationStatusView | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<VerificationStatusView>('/api/farmer/verification-status')
      .then(setStatus)
      .catch(setError);
  }, []);

  if (error) {
    return (
      <AppShell title={t('status.title')}>
        <ErrorPanel error={error} />
      </AppShell>
    );
  }

  if (!status) {
    return (
      <AppShell title={t('status.title')}>
        <Spinner label={t('common.loading')} />
      </AppShell>
    );
  }

  const formatDate = (iso: string | null): string =>
    iso
      ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
          dateStyle: 'long',
          timeZone: 'Asia/Kolkata',
        }).format(new Date(iso))
      : '';

  const actionNeeded = needsFarmerAction(status.status);
  const canEdit = isEditable(status.status);

  return (
    <AppShell title={t('status.title')}>
      <section
        className={`card ${
          actionNeeded
            ? 'border-red-200 bg-red-50'
            : status.status === 'VERIFIED'
              ? 'border-harvest-200 bg-harvest-50'
              : ''
        }`}
      >
        <h2 className="text-xl font-semibold text-stone-900">
          {t(`status.${status.status}.heading`)}
        </h2>
        <p className="mt-2 text-sm text-stone-700">{t(`status.${status.status}.body`)}</p>

        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {status.submittedAt ? (
            <p>{t('status.submittedOn', { date: formatDate(status.submittedAt) })}</p>
          ) : null}
          {status.reviewedAt ? (
            <p>{t('status.reviewedOn', { date: formatDate(status.reviewedAt) })}</p>
          ) : null}
        </div>

        {status.reviewNotes ? (
          <div className="mt-4 rounded-lg bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('status.reviewerNote')}
            </p>
            <p className="mt-1 text-sm text-stone-800">{status.reviewNotes}</p>
          </div>
        ) : null}

        {canEdit ? (
          <Link to="/farmer/registration/review" className="btn-primary mt-5 block text-center">
            {actionNeeded ? t('status.resubmit') : t('status.continueRegistration')}
          </Link>
        ) : null}
      </section>

      {status.checks.length > 0 ? (
        <section className="card mt-4">
          <h3 className="font-semibold text-stone-900">{t('status.title')}</h3>
          <ul className="mt-3 space-y-2">
            {ALL_VERIFICATION_CHECK_TYPES.map((checkType) => {
              const check = status.checks.find((entry) => entry.checkType === checkType);
              if (!check) return null;

              return (
                <li
                  key={checkType}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2 last:border-0"
                >
                  <span className="text-sm text-stone-800">{t(`check.${checkType}`)}</span>
                  <span
                    className={`text-xs font-medium ${
                      check.status === 'VERIFIED'
                        ? 'text-harvest-800'
                        : check.status === 'REJECTED'
                          ? 'text-red-700'
                          : 'text-stone-600'
                    }`}
                  >
                    {t(`check.status.${check.status}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {status.actionableDocuments.length > 0 || status.actionableLandHoldings.length > 0 ? (
        <section className="card mt-4 border-red-200">
          <h3 className="font-semibold text-stone-900">{t('status.whatToFix')}</h3>

          <ul className="mt-3 space-y-3">
            {status.actionableDocuments.map((document) => (
              <li key={document.id} className="rounded-lg bg-red-50 p-3">
                <p className="text-sm font-medium text-red-900">
                  {t(`document.kind.${toKindKey(document.documentKind)}`)}
                </p>
                <p className="mt-1 text-sm text-red-800">
                  {document.rejectionReason ?? t(`document.status.${document.status}`)}
                </p>
                <Link
                  to="/farmer/registration/documents"
                  className="mt-2 inline-block text-sm text-red-900 underline underline-offset-2"
                >
                  {t('registration.documents.replace')}
                </Link>
              </li>
            ))}

            {status.actionableLandHoldings.map((holding) => (
              <li key={holding.id} className="rounded-lg bg-red-50 p-3">
                <p className="text-sm font-medium text-red-900">
                  {t('registration.step.LAND_DETAILS')} · {holding.area}{' '}
                  {t(`land.unit.${holding.areaUnit}`)}
                </p>
                <p className="mt-1 text-sm text-red-800">{holding.rejectionReason}</p>
                <Link
                  to="/farmer/registration/land"
                  className="mt-2 inline-block text-sm text-red-900 underline underline-offset-2"
                >
                  {t('common.edit')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AppShell>
  );
}

/** Maps a DocumentKind onto its i18n key suffix (LAND_RECORD -> landRecord). */
function toKindKey(kind: string): string {
  return kind
    .toLowerCase()
    .replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
