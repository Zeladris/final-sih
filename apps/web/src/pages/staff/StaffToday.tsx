import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isInProgress } from '@kisansetu/shared';
import type { OperationalBooking } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { BookingCard } from '../../components/staff/BookingCard.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

/** No realtime channel publishes booking_operations changes (only `bookings`
 *  and `queue_centre_state` do), so this list — unlike the rest of the app —
 *  has nothing to subscribe to. A short poll plus a refetch whenever the tab
 *  comes back into view keeps it from going stale after another device (or
 *  another staff member) processes an arrival, same fallback pattern already
 *  used by useProcurementStatus for the farmer-facing status page. */
const REFRESH_MS = 15_000;

/**
 * Today's full operational list (§22).
 *
 * Grouped by what the staff member needs to do, not by booking time: farmers
 * in progress first, then those still to arrive, then finished.
 */
export function StaffToday(): JSX.Element {
  const t = useT();
  const [bookings, setBookings] = useState<OperationalBooking[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ bookings: OperationalBooking[] }>('/api/staff/me/bookings/today');
      setBookings(data.bookings);
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // A background refresh failing keeps whatever list is already on screen —
  // only a failure on the very first load (nothing to show yet) blanks the
  // page, same principle as the farmer-facing status page's fallback poll.
  if (error && !bookings) {
    return (
      <Shell>
        <ErrorPanel error={error} />
      </Shell>
    );
  }

  if (!bookings) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  const inProgress = bookings
    .filter((booking) => isInProgress(booking.state))
    .sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999));
  // Earliest slot first, so staff naturally work through arrivals in time
  // order — "YYYY-MM-DD"/"HH:MM" both sort correctly as plain strings.
  const awaiting = bookings
    .filter((booking) => booking.state === 'BOOKED')
    .sort((a, b) => (a.slotDate + a.slotStart).localeCompare(b.slotDate + b.slotStart));
  const done = bookings.filter((booking) =>
    ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(booking.state),
  );

  return (
    <Shell>
      <Link to="/staff/dashboard" className="text-sm text-stone-600 underline underline-offset-2">
        ← {t('dashboard.nav.dashboard')}
      </Link>

      {bookings.length === 0 ? (
        <section className="card">
          <p className="py-6 text-center text-sm text-stone-600">{t('ops.today.empty')}</p>
        </section>
      ) : (
        <>
          <Group title={t('ops.today.inProgress')} bookings={inProgress} />
          <Group title={t('ops.today.awaiting')} bookings={awaiting} />
          <Group title={t('ops.today.done')} bookings={done} />
        </>
      )}
    </Shell>
  );
}

function Group({
  title,
  bookings,
}: {
  title: string;
  bookings: OperationalBooking[];
}): JSX.Element | null {
  if (bookings.length === 0) return null;

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">
        {title} <span className="font-normal text-stone-500">({bookings.length})</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {bookings.map((booking) => (
          <BookingCard key={booking.bookingId} booking={booking} />
        ))}
      </ul>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
