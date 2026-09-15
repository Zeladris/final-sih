import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isInProgress } from '@kisansetu/shared';
import type { OperationalBooking } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { BookingCard } from '../../components/staff/BookingCard.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

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

  useEffect(() => {
    api
      .get<{ bookings: OperationalBooking[] }>('/api/staff/me/bookings/today')
      .then((data) => setBookings(data.bookings))
      .catch(setError);
  }, []);

  if (error) {
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
  const awaiting = bookings.filter((booking) => booking.state === 'BOOKED');
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
