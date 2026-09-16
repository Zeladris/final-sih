import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OPERATION_SEQUENCE, operationStep } from '@kisansetu/shared';
import type { OperationalBooking, QualityResult } from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { QualityAiPanel } from '../../components/staff/QualityAiPanel.js';
import { OnHoldPanel, QueuedPanel } from '../../components/staff/QueuedPanel.js';
import { StaffPaymentPanel } from '../../features/payments/StaffPaymentPanel.js';

/**
 * The procurement workflow for one booking (§17–§30).
 *
 * One screen for the whole loop, so an operator never hunts between pages
 * while a farmer stands at the counter. The panel shown is whichever step the
 * SERVER says the booking is at — the client does not decide, and a stale tab
 * gets a conflict rather than skipping a step.
 */
export function StaffBookingWorkflow(): JSX.Element {
  const t = useT();
  const { bookingId = '' } = useParams();

  const [booking, setBooking] = useState<OperationalBooking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ booking: OperationalBooking }>(
        `/api/staff/me/bookings/${bookingId}`,
      );
      setBooking(data.booking);
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every step goes through here, so conflict handling is written once. */
  const act = useCallback(
    async (path: string, body?: unknown): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const data = await api.post<{ booking: OperationalBooking }>(
          `/api/staff/me/bookings/${bookingId}/${path}`,
          body,
        );
        setBooking(data.booking);
      } catch (cause) {
        setError(cause);
        // Somebody else moved it — refresh so the screen matches reality (§41).
        if (cause instanceof ApiRequestError && cause.status === 409) await load();
      } finally {
        setBusy(false);
      }
    },
    [bookingId, load],
  );

  if (error && !booking) {
    return (
      <Shell>
        <ErrorPanel error={error} />
        <Link to="/staff/today" className="btn-secondary mt-4 inline-block">
          {t('ops.backToToday')}
        </Link>
      </Shell>
    );
  }

  if (!booking) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  const heldByAnother = Boolean(booking.claimedByName) && !booking.claimedByMe;

  return (
    <Shell>
      <Link to="/staff/today" className="text-sm text-stone-600 underline underline-offset-2">
        ← {t('ops.backToToday')}
      </Link>

      {/* Sticky operational context: who, what, how much (§53). */}
      <section className="card">
        <h1 className="text-xl font-semibold text-stone-900">
          {booking.farmerName ?? t('common.notProvided')}
        </h1>
        <p className="font-mono text-xs text-stone-500">{booking.bookingReference}</p>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Cell label={t('ops.field.crop')} value={booking.crop} />
          <Cell
            label={t('ops.field.expected')}
            value={`${booking.expectedQuantityKg} ${t('ops.kg')}`}
          />
          <Cell label={t('ops.field.slot')} value={`${booking.slotStart}–${booking.slotEnd}`} />
          <Cell label={t('ops.field.village')} value={booking.village ?? '—'} />
        </dl>

        <ProgressBar state={booking.state} />
      </section>

      {error ? <ErrorPanel error={error} /> : null}

      {heldByAnother ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t('ops.heldBy', { name: booking.claimedByName ?? '' })}
        </div>
      ) : null}

      <StepPanel booking={booking} busy={busy || heldByAnother} act={act} reload={load} />
    </Shell>
  );
}

/** Renders only the step the server says the booking is at. */
function StepPanel({
  booking,
  busy,
  act,
  reload,
}: {
  booking: OperationalBooking;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
  reload: () => Promise<void>;
}): JSX.Element {
  const t = useT();

  switch (booking.state) {
    case 'BOOKED':
      return <ArrivalPanel busy={busy} act={act} />;

    case 'ARRIVED':
      return (
        <Panel title={t('ops.step.checkIn')}>
          <p className="text-sm text-stone-600">{t('ops.step.checkInHint')}</p>
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={busy}
            onClick={() => void act('check-in')}
          >
            {t('ops.action.checkIn')}
          </button>
        </Panel>
      );

    // Phase 7 order: check in → verify produce (opens the quality check) →
    // official quality result (joins the queue) → started from the queue.
    case 'CHECKED_IN':
      return booking.claimedByMe ? (
        <CropVerificationPanel booking={booking} busy={busy} act={act} />
      ) : (
        <Panel title={t('ops.step.claim')}>
          <p className="text-sm text-stone-600">{t('ops.step.claimHint')}</p>
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={busy}
            onClick={() => void act('claim')}
          >
            {t('ops.action.claim')}
          </button>
        </Panel>
      );

    case 'QUALITY_CHECK':
      return (
        <>
          <QualityAiPanel bookingId={booking.bookingId} allowPhoto />
          <QualityPanel booking={booking} busy={busy} act={act} />
        </>
      );

    case 'WAITING':
      return (
        <>
          <QueuedPanel bookingId={booking.bookingId} />
          <QualityAiPanel bookingId={booking.bookingId} allowPhoto={false} />
        </>
      );

    case 'ON_HOLD':
      return <OnHoldPanel bookingId={booking.bookingId} onChanged={reload} />;

    case 'WEIGHING':
      return <WeighingPanel booking={booking} busy={busy} act={act} />;

    case 'PROCUREMENT':
      return <ProcurementPanel booking={booking} busy={busy} act={act} />;

    // Phase 8: payment has its own panel, driven by the payment record.
    case 'PAYMENT_PENDING':
    case 'COMPLETED':
      return booking.procurementId ? (
        <StaffPaymentPanel procurementId={booking.procurementId} onStatusChange={() => void reload()} />
      ) : (
        <Panel title={t('ops.step.payment')}>
          <p className="text-sm text-stone-600">{t('ops.step.noAction')}</p>
        </Panel>
      );

    case 'REJECTED':
      return (
        <Panel title={t('ops.step.rejected')}>
          <p className="text-sm text-red-800">
            {booking.qualityRemarks ?? t('ops.step.rejectedHint')}
          </p>
        </Panel>
      );

    default:
      return (
        <Panel title={t(`ops.state.${booking.state}`)}>
          <p className="text-sm text-stone-600">{t('ops.step.noAction')}</p>
        </Panel>
      );
  }
}

function CropVerificationPanel({
  booking,
  busy,
  act,
}: {
  booking: OperationalBooking;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [mismatch, setMismatch] = useState(false);
  const [issue, setIssue] = useState('');

  return (
    <Panel title={t('ops.step.cropVerification')}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Cell label={t('ops.field.bookedCrop')} value={booking.crop} />
        <Cell
          label={t('ops.field.expected')}
          value={`${booking.expectedQuantityKg} ${t('ops.kg')}`}
        />
      </dl>

      {!mismatch ? (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void act('verify-crop', { matches: true })}
          >
            {t('ops.action.cropMatches')}
          </button>
          <button
            type="button"
            className="btn-secondary w-full text-red-700"
            onClick={() => setMismatch(true)}
          >
            {t('ops.action.reportIssue')}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <label htmlFor="issue" className="field-label">
            {t('ops.field.issue')}
          </label>
          <textarea
            id="issue"
            rows={3}
            className="field-input"
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            placeholder={t('ops.field.issuePlaceholder')}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setMismatch(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={busy || issue.trim().length < 5}
              onClick={() => void act('verify-crop', { matches: false, issue: issue.trim() })}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function QualityPanel({
  booking,
  busy,
  act,
}: {
  booking: OperationalBooking;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [result, setResult] = useState<QualityResult>('PASSED');
  const [remarks, setRemarks] = useState('');

  const needsRemarks = result !== 'PASSED';

  return (
    <Panel title={t('ops.step.quality')}>
      {booking.cropIssue ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('ops.field.issue')}: {booking.cropIssue}
        </p>
      ) : null}

      <fieldset>
        <legend className="field-label">{t('ops.field.qualityResult')}</legend>
        <div className="mt-1 space-y-2">
          {(['PASSED', 'CONDITIONAL', 'FAILED'] as QualityResult[]).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                result === option ? 'border-harvest-500 bg-harvest-50' : 'border-stone-300'
              }`}
            >
              <input
                type="radio"
                name="quality"
                value={option}
                checked={result === option}
                onChange={() => setResult(option)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-stone-900">
                {t(`ops.quality.${option}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {needsRemarks ? (
        <div className="mt-4">
          <label htmlFor="remarks" className="field-label">
            {t('ops.field.remarks')}
          </label>
          <textarea
            id="remarks"
            rows={3}
            className="field-input"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
          />
          <p className="mt-1 text-xs text-stone-500">{t('ops.field.remarksHelp')}</p>
        </div>
      ) : null}

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || (needsRemarks && remarks.trim().length < 5)}
        onClick={() =>
          void act('quality', {
            result,
            ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
          })
        }
      >
        {result === 'FAILED' ? t('ops.action.recordFailure') : t('ops.action.addToQueue')}
      </button>
    </Panel>
  );
}

/**
 * Weighing (Phase 8 §2): what arrived, what was rejected at the scale and
 * why. Accepted = received − rejected is shown as it will be paid — the
 * server recomputes it exactly; this is only a preview.
 */
function WeighingPanel({
  booking,
  busy,
  act,
}: {
  booking: OperationalBooking;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [received, setReceived] = useState('');
  const [rejected, setRejected] = useState('');
  const [reason, setReason] = useState('');

  const receivedKg = Number.parseFloat(received);
  const rejectedKg = rejected.trim() === '' ? 0 : Number.parseFloat(rejected);
  const receivedOk = Number.isFinite(receivedKg) && receivedKg > 0;
  const rejectedOk = Number.isFinite(rejectedKg) && rejectedKg >= 0 && (!receivedOk || rejectedKg < receivedKg);
  const reasonOk = rejectedKg === 0 || reason.trim().length >= 5;
  const valid = receivedOk && rejectedOk && reasonOk;

  const clean = (value: string): string => value.replace(/[^\d.]/g, '');

  return (
    <Panel title={t('ops.step.weighing')}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Cell label={t('ops.field.expected')} value={`${booking.expectedQuantityKg} ${t('ops.kg')}`} />
        <Cell label={t('ops.field.crop')} value={booking.crop} />
      </dl>

      <div className="mt-4">
        <label htmlFor="weight" className="field-label">
          {t('ops.field.actualWeight')}
        </label>
        <input
          id="weight"
          type="text"
          inputMode="decimal"
          className="field-input text-lg"
          value={received}
          onChange={(event) => setReceived(clean(event.target.value))}
          autoFocus
        />
        {/* The booked quantity is never used as the purchased one (§24). */}
        <p className="mt-1 text-xs text-stone-500">{t('ops.field.actualWeightHelp')}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="rejected" className="field-label">
          {t('payment.rejectedAtScale')} <span className="font-normal text-stone-500">({t('common.optional')})</span>
        </label>
        <input
          id="rejected"
          type="text"
          inputMode="decimal"
          className="field-input"
          value={rejected}
          onChange={(event) => setRejected(clean(event.target.value))}
        />
      </div>

      {rejectedKg > 0 ? (
        <div className="mt-3">
          <label htmlFor="reject-reason" className="field-label">
            {t('payment.rejectionReason')}
          </label>
          <textarea
            id="reject-reason"
            rows={2}
            className="field-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}

      {receivedOk && rejectedOk ? (
        <p className="mt-3 rounded-lg bg-harvest-50 px-3 py-2 text-sm text-harvest-900">
          {t('payment.acceptedPreview', { kg: Math.round((receivedKg - rejectedKg) * 1000) / 1000 })}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || !valid}
        onClick={() =>
          void act('weigh', {
            receivedQuantityKg: receivedKg,
            ...(rejectedKg > 0 ? { rejectedQuantityKg: rejectedKg, rejectionReason: reason.trim() } : {}),
          })
        }
      >
        {t('ops.action.confirmWeight')}
      </button>
    </Panel>
  );
}

function ProcurementPanel({
  booking,
  busy,
  act,
}: {
  booking: OperationalBooking;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}): JSX.Element {
  const t = useT();

  return (
    <Panel title={t('ops.step.procurement')}>
      <p className="text-sm text-stone-600">{t('ops.step.procurementHint')}</p>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Cell label={t('ops.field.crop')} value={booking.crop} />
        <Cell label={t('ops.field.actualWeight')} value={`${booking.actualQuantityKg ?? '—'} ${t('ops.kg')}`} />
        <Cell label={t('payment.rejected')} value={`${booking.rejectedQuantityKg ?? 0} ${t('ops.kg')}`} />
        <Cell label={t('payment.accepted')} value={`${booking.acceptedQuantityKg ?? '—'} ${t('ops.kg')}`} />
        <Cell
          label={t('ops.field.qualityResult')}
          value={booking.qualityResult ? t(`ops.quality.${booking.qualityResult}`) : '—'}
        />
      </dl>

      {/* The MSP rate and the value are resolved and computed by the server
          when you confirm; nothing about money is sent from here (§9). */}
      <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">{t('ops.step.valueNote')}</p>

      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void act('procure')}>
        {t('ops.action.confirmProcurement')}
      </button>
    </Panel>
  );
}

function ProgressBar({ state }: { state: OperationalBooking['state'] }): JSX.Element {
  const t = useT();
  const step = operationStep(state);
  const total = OPERATION_SEQUENCE.length - 1;

  return (
    <div className="mt-4">
      <div className="flex gap-1" aria-hidden="true">
        {OPERATION_SEQUENCE.slice(1).map((entry, index) => (
          <div
            key={entry}
            className={`h-1.5 flex-1 rounded-full ${
              index < step ? 'bg-harvest-600' : 'bg-stone-200'
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-stone-600">
        {t(`ops.state.${state}`)} ({step}/{total})
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card border-2 border-harvest-200">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Arrival now requires the farmer's own code, read aloud by them — a click
 * alone is no longer proof anyone is actually standing at the centre. A
 * wrong code surfaces through the parent's own `ErrorPanel` (act() already
 * routes every failure there), so this only needs the input and the ask.
 */
function ArrivalPanel({
  busy,
  act,
}: {
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [otp, setOtp] = useState('');

  return (
    <Panel title={t('ops.step.arrival')}>
      <p className="text-sm text-stone-600">{t('ops.step.arrivalHint')}</p>
      <label htmlFor="arrival-otp" className="field-label mt-3 block">
        {t('ops.field.arrivalOtp')}
      </label>
      <input
        id="arrival-otp"
        className="field-input mt-1 font-mono text-lg tracking-widest"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={otp}
        onChange={(event) => setOtp(event.target.value)}
        placeholder={t('ops.field.arrivalOtpPlaceholder')}
        autoFocus
      />
      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || otp.trim().length === 0}
        onClick={() => void act('arrive', { otp: otp.trim() })}
      >
        {t('ops.action.markArrived')}
      </button>
    </Panel>
  );
}

function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
