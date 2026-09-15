import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isTerminalFarmerStatus } from '@kisansetu/shared';
import type { FarmerBooking } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

/**
 * All of a farmer's bookings (§34, §53).
 *
 * Upcoming first, because that is the one they are about to act on; past and
 * cancelled bookings stay visible so the record is complete.
 */
export function FarmerBookings(): JSX.Element {
  const t = useT();
  const [bookings, setBookings] = useState<FarmerBooking[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ bookings: FarmerBooking[] }>('/api/farmer/bookings')
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

  // By farmer-facing status: a booking awaiting payment is still in progress,
  // even though the booking row itself already reads COMPLETED.
  const active = bookings.filter((booking) => !isTerminalFarmerStatus(booking.farmerStatus));
  const past = bookings.filter((booking) => isTerminalFarmerStatus(booking.farmerStatus));

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/farmer/dashboard" className="text-sm text-stone-600 underline underline-offset-2">
          ← {t('dashboard.nav.dashboard')}
        </Link>
        <Link to="/farmer/book" className="btn-secondary">
          {t('booking.list.bookAnother')}
        </Link>
      </div>

      {bookings.length === 0 ? (
        <section className="card">
          <p className="py-6 text-center text-sm text-stone-600">{t('booking.list.empty')}</p>
          <Link to="/farmer/book" className="btn-primary block text-center">
            {t('dashboard.action.bookSlot')}
          </Link>
        </section>
      ) : (
        <>
          <Group title={t('booking.list.upcoming')} bookings={active} />
          <Group title={t('booking.list.past')} bookings={past} />
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
  bookings: FarmerBooking[];
}): JSX.Element | null {
  const t = useT();
  const { language } = useI18n();

  if (bookings.length === 0) return null;

  const format = (iso: string): string =>
    new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${iso}T00:00:00+05:30`));

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      <ul className="mt-3 space-y-2">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <Link
              to={`/farmer/bookings/${booking.id}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 p-3 transition hover:bg-stone-50"
            >
              <div className="min-w-0">
                <p className="font-medium text-stone-900">{booking.cropName}</p>
                <p className="font-mono text-xs text-stone-500">{booking.bookingReference}</p>
                <p className="mt-1 text-xs text-stone-600">
                  {booking.centreName} · {format(booking.slotDate)} · {booking.slotStart}–
                  {booking.slotEnd}
                </p>
                <p className="mt-1 text-xs font-medium text-stone-700">
                  {t(`status.farmer.${booking.farmerStatus}.label`)}
                </p>
              </div>
              <span aria-hidden="true" className="text-stone-400">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
