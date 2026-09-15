import { Link } from 'react-router-dom';
import { operationStep, OPERATION_SEQUENCE } from '@kisansetu/shared';
import type { OperationalBooking } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';
import { formatInr } from '../../features/payments/format.js';

/**
 * One booking in the operational queue.
 *
 * Shows where the farmer is in the workflow and what the next action is —
 * a staff member should not have to open a record to know whether it needs
 * them (§22).
 */
export function BookingCard({ booking }: { booking: OperationalBooking }): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const step = operationStep(booking.state);
  const total = OPERATION_SEQUENCE.length - 1;
  const heldByAnother = Boolean(booking.claimedByName) && !booking.claimedByMe;

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {booking.queuePosition !== null ? (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-800 text-xs font-bold text-white">
                {booking.queuePosition}
              </span>
            ) : null}
            <p className="font-medium text-stone-900">
              {booking.farmerName ?? t('common.notProvided')}
            </p>
          </div>

          <p className="font-mono text-xs text-stone-500">{booking.bookingReference}</p>

          <p className="mt-1 text-xs text-stone-600">
            {booking.crop} · {booking.expectedQuantityKg} {t('ops.kg')} ·{' '}
            {booking.slotStart}–{booking.slotEnd}
            {booking.village ? ` · ${booking.village}` : ''}
          </p>

          {/* State in words, not colour alone. */}
          <p className="mt-1.5 text-xs font-medium text-stone-800">
            {t(`ops.state.${booking.state}`)}
            {step > 0 ? (
              <span className="ml-1 font-normal text-stone-500">
                ({step}/{total})
              </span>
            ) : null}
          </p>

          {heldByAnother ? (
            <p className="mt-1 text-xs text-amber-800">
              {t('ops.heldBy', { name: booking.claimedByName ?? '' })}
            </p>
          ) : null}

          {booking.procurementReference ? (
            <p className="mt-1 text-xs text-harvest-800">
              <span className="font-mono">{booking.procurementReference}</span>
              {booking.totalValue !== null ? ` · ${formatInr(booking.totalValue, language)}` : ''}
              {booking.paymentStatus ? (
                <>
                  {' · '}
                  <span className="font-medium">
                    {t(`payment.status.${booking.paymentStatus}`)}
                    {booking.paymentIsDemo ? ` (${t('payment.demoShort')})` : ''}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <Link to={`/staff/booking/${booking.bookingId}`} className="btn-secondary shrink-0">
          {booking.state === 'BOOKED' ? t('ops.action.open') : t('ops.action.continue')}
        </Link>
      </div>
    </li>
  );
}
