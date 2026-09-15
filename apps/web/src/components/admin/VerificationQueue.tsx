import { Link } from 'react-router-dom';
import type { VerificationQueue as Queue, VerificationQueueItem } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';

/**
 * The district admin's farmer verification queue (§10, §11; Phase 14).
 *
 * Cards rather than a table, so triage works on a phone as well as a desktop.
 * Each card shows enough to triage without opening the record.
 *
 * A submission another reviewer is holding is shown but visibly marked, so
 * nobody starts a review that is already under way (§19). In practice a
 * district has one admin, but the claim mechanism holds regardless.
 */
export function VerificationQueue({ queue }: { queue: Queue }): JSX.Element {
  const t = useT();

  if (queue.items.length === 0) {
    return (
      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('verification.queue.title')}</h2>
        <div className="mt-3 rounded-lg bg-stone-50 px-3 py-6 text-center">
          <p className="text-sm text-stone-700">{t('verification.queue.empty')}</p>
          <p className="mt-1 text-xs text-stone-500">{t('verification.queue.emptyHint')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-900">{t('verification.queue.title')}</h2>
        <p className="text-xs text-stone-500">
          {t('verification.queue.counts', {
            awaiting: queue.awaitingReview,
            inReview: queue.inReview,
          })}
        </p>
      </div>

      <ul className="mt-3 space-y-3">
        {queue.items.map((item) => (
          <QueueCard key={item.farmerUserId} item={item} />
        ))}
      </ul>
    </section>
  );
}

function QueueCard({ item }: { item: VerificationQueueItem }): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const submitted = item.submittedAt
    ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(item.submittedAt))
    : null;

  const { heldByAnother } = item;

  return (
    <li
      className={`rounded-lg border p-3 ${
        heldByAnother ? 'border-stone-200 bg-stone-50' : 'border-stone-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">
            {item.name ?? t('common.notProvided')}
          </p>
          <p className="font-mono text-xs text-stone-500">{item.farmerReferenceId}</p>

          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
            {item.village ? <Meta label={t('registration.address.village')} value={item.village} /> : null}
            {item.primaryCrop ? (
              <Meta label={t('dashboard.summary.primaryCrop')} value={item.primaryCrop} />
            ) : null}
            {item.landAreaAcres !== null ? (
              <Meta
                label={t('dashboard.summary.landArea')}
                value={`${item.landAreaAcres} ${t('land.unit.ACRE')}`}
              />
            ) : null}
            <Meta label={t('verification.queue.documents')} value={String(item.documentCount)} />
            {submitted ? <Meta label={t('verification.queue.submitted')} value={submitted} /> : null}
          </dl>

          {/* State is carried by text, not colour alone (§23). */}
          <p className="mt-2 text-xs font-medium">
            {item.claimedByMe ? (
              <span className="text-harvest-800">{t('verification.queue.claimedByYou')}</span>
            ) : heldByAnother ? (
              <span className="text-amber-800">
                {t('verification.queue.claimedBy', {
                  name: item.reviewStartedByName ?? t('verification.queue.anotherReviewer'),
                })}
              </span>
            ) : (
              <span className="text-sky-800">{t('verification.queue.awaiting')}</span>
            )}
          </p>
        </div>

        <Link to={`/district/verification/${item.farmerUserId}`} className="btn-secondary">
          {item.claimedByMe ? t('verification.queue.continueReview') : t('verification.queue.open')}
        </Link>
      </div>
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-1">
      <dt className="text-stone-400">{label}:</dt>
      <dd className="text-stone-700">{value}</dd>
    </div>
  );
}
