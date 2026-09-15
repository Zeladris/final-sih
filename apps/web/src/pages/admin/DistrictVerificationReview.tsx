import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DOCUMENT_KINDS, REVIEW_DECISIONS, toAcres } from '@kisansetu/shared';
import type { FarmerDocument, ReviewDecision, ReviewSubmission } from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { VerificationDecisionDialog } from '../../components/admin/VerificationDecisionDialog.js';
import { Spinner } from '../../components/Spinner.js';

/**
 * The district admin's review screen (§12, §42; Phase 14).
 *
 * Ordered the way a reviewer actually works: who is this farmer, what did
 * they declare, what did they upload, then the decision. No jumping between
 * screens to understand one submission.
 *
 * Decisions are only enabled once this admin holds the review, so two people
 * cannot both act on the same record (§19, §34) — in practice a district has
 * one admin, but the claim mechanism holds regardless.
 */
export function DistrictVerificationReview(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const navigate = useNavigate();
  const { farmerUserId = '' } = useParams();

  const [submission, setSubmission] = useState<ReviewSubmission | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ReviewDecision | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setSubmission(
        await api.get<ReviewSubmission>(`/api/admin/district/verification/${farmerUserId}`),
      );
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [farmerUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSubmission(
        await api.post<ReviewSubmission>(`/api/admin/district/verification/${farmerUserId}/claim`),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function release(): Promise<void> {
    setBusy(true);
    try {
      setSubmission(
        await api.post<ReviewSubmission>(`/api/admin/district/verification/${farmerUserId}/release`),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(decision: ReviewDecision, reason: string | null): Promise<void> {
    setBusy(true);
    setDialogError(null);
    try {
      await api.post(`/api/admin/district/verification/${farmerUserId}/decision`, {
        decision,
        ...(reason ? { reason } : {}),
      });
      setDialog(null);
      navigate('/district/verification', { replace: true });
    } catch (cause) {
      // A conflict means somebody else decided first — say so plainly and
      // reload, rather than leaving a stale screen that invites a retry (§34).
      const message =
        cause instanceof ApiRequestError ? cause.message : t('error.generic');
      setDialogError(message);
      if (cause instanceof ApiRequestError && cause.status === 409) {
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !submission) {
    return (
      <Shell>
        <ErrorPanel error={error} />
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
          <Link to="/district/verification" className="btn-secondary">
            {t('verification.review.backToQueue')}
          </Link>
        </div>
      </Shell>
    );
  }

  if (!submission) {
    return (
      <Shell>
        <Spinner label={t('verification.review.loading')} />
      </Shell>
    );
  }

  const { farmer } = submission;
  const totalAcres = submission.landHoldings.reduce(
    (sum, holding) => sum + toAcres(holding.area, holding.areaUnit),
    0,
  );

  const formatDate = (iso: string | null): string | null =>
    iso
      ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata',
        }).format(new Date(iso))
      : null;

  const { heldByAnother } = submission;
  // A claim that timed out still carries its holder; say so before taking over.
  const takingOver =
    submission.canClaim &&
    submission.registrationStatus === 'UNDER_REVIEW' &&
    Boolean(submission.reviewStartedAt);
  const decided = !['SUBMITTED', 'UNDER_REVIEW'].includes(submission.registrationStatus);

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/district/verification" className="text-sm text-stone-600 underline underline-offset-2">
          ← {t('verification.review.backToQueue')}
        </Link>
      </div>

      {/* Review ownership banner, before anything else the reviewer might act on. */}
      {decided ? (
        <Banner tone="neutral">
          {t('verification.review.alreadyDecided', {
            status: t(`status.${submission.registrationStatus}.heading`),
          })}
        </Banner>
      ) : heldByAnother ? (
        <Banner tone="warn">
          {t('verification.review.heldBy', {
            name: submission.reviewStartedByName ?? t('verification.queue.anotherReviewer'),
          })}
        </Banner>
      ) : takingOver ? (
        <Banner tone="warn">{t('verification.review.staleClaim')}</Banner>
      ) : submission.claimedByMe ? (
        <Banner tone="ok">{t('verification.review.claimedByYou')}</Banner>
      ) : (
        <Banner tone="neutral">{t('verification.review.notClaimed')}</Banner>
      )}

      {error ? <ErrorPanel error={error} /> : null}

      <Section title={t('verification.review.identity')}>
        <Field label={t('registration.personal.fullName')} value={farmer.name} />
        <Field label={t('registration.personal.fullNameLocal')} value={farmer.nameLocal} />
        <Field label={t('dashboard.farmerId')} value={farmer.farmerReferenceId} />
        <Field label={t('dashboard.mobile')} value={farmer.phoneMasked} />
        <Field
          label={t('registration.personal.gender')}
          value={farmer.gender ? t(`gender.${farmer.gender}`) : null}
        />
        <Field label={t('registration.personal.dateOfBirth')} value={formatDate(farmer.dateOfBirth)} />
      </Section>

      <Section title={t('verification.review.address')}>
        <Field label={t('registration.address.village')} value={farmer.village} />
        <Field label={t('registration.address.line1')} value={farmer.addressLine1} />
        <Field label={t('registration.address.pincode')} value={farmer.pincode} />
        <Field label={t('registration.address.district')} value={farmer.districtName} />
        <Field label={t('registration.address.state')} value={farmer.stateName} />
      </Section>

      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('verification.review.land')}</h2>
        {submission.landHoldings.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">{t('registration.land.empty')}</p>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {submission.landHoldings.map((holding) => (
                <li key={holding.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                  <p className="font-medium text-stone-900">
                    {holding.area} {t(`land.unit.${holding.areaUnit}`)} ·{' '}
                    {t(`land.ownership.${holding.ownershipType}`)}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-600">
                    {[
                      holding.surveyNumber
                        ? `${t('registration.land.surveyNumber')}: ${holding.surveyNumber}`
                        : null,
                      holding.village,
                      holding.primaryCrop,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('common.notProvided')}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-stone-700">
              {t('registration.land.totalArea')}: <strong>{totalAcres.toFixed(2)}</strong>{' '}
              {t('land.unit.ACRE')}
            </p>
          </>
        )}
      </section>

      <DocumentsSection documents={submission.documents} />

      {/* Decision area last, after everything needed to make it (§42). */}
      {!decided ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('verification.review.decision')}</h2>

          {!submission.claimedByMe ? (
            <div className="mt-3">
              <p className="text-sm text-stone-600">
                {heldByAnother ? t('verification.review.heldByHint') : t('verification.review.claimHint')}
              </p>
              <button
                type="button"
                className="btn-primary mt-3"
                onClick={() => void claim()}
                disabled={busy || !submission.canClaim}
              >
                {busy
                  ? t('common.saving')
                  : takingOver
                    ? t('verification.review.takeOver')
                    : t('verification.review.claim')}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setDialog(REVIEW_DECISIONS.APPROVE)}
                disabled={busy}
              >
                {t('verification.decision.approve.action')}
              </button>

              {/* Destructive actions kept apart from the primary one (§41). */}
              <div className="flex flex-col gap-2 border-t border-stone-200 pt-3 sm:flex-row">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => setDialog(REVIEW_DECISIONS.REQUEST_CORRECTION)}
                  disabled={busy}
                >
                  {t('verification.decision.correction.action')}
                </button>
                <button
                  type="button"
                  className="btn-secondary flex-1 text-red-700"
                  onClick={() => setDialog(REVIEW_DECISIONS.REJECT)}
                  disabled={busy}
                >
                  {t('verification.decision.reject.action')}
                </button>
              </div>

              <button
                type="button"
                className="text-sm text-stone-600 underline underline-offset-2"
                onClick={() => void release()}
                disabled={busy}
              >
                {t('verification.review.release')}
              </button>
            </div>
          )}
        </section>
      ) : submission.reviewNotes ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('status.reviewerNote')}</h2>
          <p className="mt-2 text-sm text-stone-800">{submission.reviewNotes}</p>
        </section>
      ) : null}

      {dialog ? (
        <VerificationDecisionDialog
          decision={dialog}
          farmerName={farmer.name ?? farmer.farmerReferenceId}
          busy={busy}
          error={dialogError}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
          onConfirm={(reason) => void submitDecision(dialog, reason)}
        />
      ) : null}
    </Shell>
  );
}

/**
 * Documents open through a signed URL fetched per click. The storage path is
 * never in the page (§13).
 */
function DocumentsSection({ documents }: { documents: FarmerDocument[] }): JSX.Element {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  async function open(documentId: string): Promise<void> {
    setError(null);
    try {
      const { signedUrl } = await api.get<{ signedUrl: string }>(
        `/api/admin/district/documents/${documentId}/url`,
      );
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('verification.review.documentFailed'));
    }
  }

  const kindKey = (kind: string): string =>
    kind.toLowerCase().replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{t('verification.review.documents')}</h2>

      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t('registration.documents.notUploaded')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">
                  {t(`document.kind.${kindKey(document.documentKind)}`)}
                </p>
                <p className="truncate text-xs text-stone-500">
                  {document.originalFilename} ·{' '}
                  {t(`document.status.${document.status}`)}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => void open(document.id)}>
                {t('registration.documents.view')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {documents.length > 0 && !documents.some((d) => d.documentKind === DOCUMENT_KINDS.LAND_RECORD) ? (
        <p className="mt-3 text-xs text-amber-800">{t('verification.review.noLandRecord')}</p>
      ) : null}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const t = useT();
  return (
    <AppShell title={t('verification.review.title')}>
      <div className="space-y-4">{children}</div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  const t = useT();
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className={`text-sm ${value ? 'text-stone-900' : 'text-stone-400'}`}>
        {value ?? t('common.notProvided')}
      </dd>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'neutral';
  children: React.ReactNode;
}): JSX.Element {
  const classes =
    tone === 'ok'
      ? 'border-harvest-200 bg-harvest-50 text-harvest-900'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-stone-200 bg-stone-50 text-stone-700';

  return (
    <div role="status" className={`rounded-xl border p-3 text-sm ${classes}`}>
      {children}
    </div>
  );
}
