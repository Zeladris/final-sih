import { Link } from 'react-router-dom';
import type { DashboardVerification, FarmerAccountState } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';

/**
 * Verification status, in plain language (§9, §33).
 *
 * Every state maps to an i18n key pair. Raw enum names like UNDER_REVIEW or
 * RESUBMISSION_REQUIRED never reach the screen, and "verified" is shown only
 * when the persisted state genuinely says so.
 */

const TONE: Record<FarmerAccountState, { card: string; dot: string; icon: string }> = {
  NO_PROFILE: { card: 'border-stone-200', dot: 'bg-stone-400', icon: '•' },
  REGISTRATION_INCOMPLETE: { card: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500', icon: '!' },
  AWAITING_REVIEW: { card: 'border-sky-200 bg-sky-50', dot: 'bg-sky-500', icon: '⏳' },
  ACTION_REQUIRED: { card: 'border-red-200 bg-red-50', dot: 'bg-red-500', icon: '!' },
  VERIFIED: { card: 'border-harvest-200 bg-harvest-50', dot: 'bg-harvest-600', icon: '✓' },
};

export function VerificationStatusCard({
  verification,
}: {
  verification: DashboardVerification;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const tone = TONE[verification.state];

  const formatDate = (iso: string | null): string | null =>
    iso
      ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata',
        }).format(new Date(iso))
      : null;

  const submitted = formatDate(verification.submittedAt);
  const verified = formatDate(verification.verifiedAt);

  return (
    <section className={`card border ${tone.card}`}>
      <div className="flex items-start gap-3">
        {/* Meaning is carried by the icon and the text, not colour alone (§23). */}
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${tone.dot}`}
        >
          {tone.icon}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-stone-900">
            {t(`dashboard.verification.${verification.state}.title`)}
          </h2>
          <p className="mt-1 text-sm text-stone-700">
            {t(`dashboard.verification.${verification.state}.body`)}
          </p>

          {verification.state === 'REGISTRATION_INCOMPLETE' &&
          verification.remainingSteps.length > 0 ? (
            <p className="mt-2 text-xs text-stone-600">
              {t('dashboard.verification.remainingCount', {
                count: verification.remainingSteps.length,
              })}
            </p>
          ) : null}

          {verification.state === 'ACTION_REQUIRED' && verification.itemsNeedingAction > 0 ? (
            <p className="mt-2 text-xs font-medium text-red-800">
              {t('dashboard.verification.itemsNeedingAction', {
                count: verification.itemsNeedingAction,
              })}
            </p>
          ) : null}

          {verification.reviewNotes ? (
            <div className="mt-3 rounded-lg bg-white/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {t('status.reviewerNote')}
              </p>
              <p className="mt-1 text-sm text-stone-800">{verification.reviewNotes}</p>
            </div>
          ) : null}

          <div className="mt-2 space-y-0.5 text-xs text-stone-500">
            {submitted ? <p>{t('status.submittedOn', { date: submitted })}</p> : null}
            {verified ? <p>{t('status.verifiedOn', { date: verified })}</p> : null}
          </div>

          {verification.state !== 'NO_PROFILE' ? (
            <Link
              to="/farmer/status"
              className="mt-3 inline-block text-sm font-medium text-harvest-800 underline underline-offset-2"
            >
              {t('dashboard.verification.viewDetail')}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
