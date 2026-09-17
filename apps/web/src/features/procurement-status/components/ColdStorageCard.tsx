import { useEffect, useState } from 'react';
import type { ColdStorageBooking, ColdStorageFacility, ColdStorageOffer } from '@kisansetu/shared';
import { api } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';
import { ErrorPanel } from '../../../components/AppShell.js';

/**
 * Cold storage (demo addition, §ColdStorage).
 *
 * A sibling fact about this one booking, fetched separately from the main
 * status so a booking with nothing to offer costs one small, cheap request
 * and renders nothing — never a placeholder, never another farmer's data.
 */
export function ColdStorageCard({ bookingId }: { bookingId: string }): JSX.Element | null {
  const [offer, setOffer] = useState<ColdStorageOffer | null>(null);
  const [reservation, setReservation] = useState<ColdStorageBooking | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ offer: ColdStorageOffer | null; reservation: ColdStorageBooking | null }>(
        `/api/farmer/bookings/${bookingId}/cold-storage`,
      )
      .then((data) => {
        if (cancelled) return;
        setOffer(data.offer);
        setReservation(data.reservation);
      })
      .catch(() => {
        // No offer is not an error worth showing — the normal journey below
        // already explains everything else about this booking.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!loaded || (!offer && !reservation)) return null;

  if (reservation) {
    return <ReservationCard reservation={reservation} />;
  }

  return (
    <OfferCard
      bookingId={bookingId}
      offer={offer!}
      onReserved={(created) => {
        setReservation(created);
        setOffer(null);
      }}
    />
  );
}

function ReservationCard({ reservation }: { reservation: ColdStorageBooking }): JSX.Element {
  const t = useT();

  return (
    <section className="card border-2 border-harvest-200 bg-harvest-50/40">
      <h2 className="font-semibold text-stone-900">{t('coldStorage.reservation.title')}</h2>
      <dl className="mt-3 space-y-2">
        <Row label={t('coldStorage.field.storage')} value={reservation.facilityName} />
        <Row label={t('coldStorage.field.location')} value={reservation.facilityLocation} />
        <Row label={t('coldStorage.field.crop')} value={reservation.cropName} />
        <Row
          label={t('coldStorage.field.quantity')}
          value={`${reservation.quantityKg} ${t('ops.kg')}`}
        />
        <Row
          label={t('coldStorage.field.status')}
          value={t(`coldStorage.status.${reservation.status}`)}
        />
      </dl>
      <p className="mt-3 font-mono text-xs text-stone-500">{reservation.bookingReference}</p>
    </section>
  );
}

function OfferCard({
  bookingId,
  offer,
  onReserved,
}: {
  bookingId: string;
  offer: ColdStorageOffer;
  onReserved: (reservation: ColdStorageBooking) => void;
}): JSX.Element {
  const t = useT();
  const [facilities, setFacilities] = useState<ColdStorageFacility[] | null>(null);
  const [facilitiesError, setFacilitiesError] = useState<unknown>(null);
  const [busyFacilityId, setBusyFacilityId] = useState<string | null>(null);
  const [reserveError, setReserveError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ facilities: ColdStorageFacility[] }>('/api/farmer/cold-storage/facilities')
      .then((data) => setFacilities(data.facilities))
      .catch(setFacilitiesError);
  }, []);

  async function reserve(facilityId: string): Promise<void> {
    setBusyFacilityId(facilityId);
    setReserveError(null);
    try {
      const { reservation } = await api.post<{ reservation: ColdStorageBooking }>(
        `/api/farmer/bookings/${bookingId}/cold-storage`,
        { facilityId },
      );
      onReserved(reservation);
    } catch (cause) {
      setReserveError(cause);
    } finally {
      setBusyFacilityId(null);
    }
  }

  return (
    <section className="card border-2 border-amber-200 bg-amber-50/40">
      <h2 className="font-semibold text-stone-900">{t('coldStorage.full.title')}</h2>
      <p className="mt-1 text-sm text-stone-700">{t('coldStorage.full.body')}</p>

      <div className="mt-3 rounded-lg bg-white/70 px-3 py-2">
        <p className="text-xs text-stone-600">{t('coldStorage.full.remainingLabel')}</p>
        <p className="text-2xl font-semibold text-stone-900">
          {offer.remainingQuantityKg} {t('ops.kg')}
        </p>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-stone-900">{t('coldStorage.options.title')}</h3>

      {facilitiesError ? <ErrorPanel error={facilitiesError} /> : null}

      {!facilities && !facilitiesError ? (
        <p className="mt-2 text-sm text-stone-500">{t('common.loading')}</p>
      ) : null}

      {facilities && facilities.length === 0 ? (
        <p className="mt-2 rounded-lg bg-stone-50 px-3 py-3 text-sm text-stone-600">
          {t('coldStorage.options.none')}
        </p>
      ) : null}

      {reserveError ? <ErrorPanel error={reserveError} /> : null}

      <ul className="mt-3 space-y-2">
        {(facilities ?? []).map((facility) => (
          <li key={facility.id} className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="font-medium text-stone-900">{facility.name}</p>
            <p className="text-xs text-stone-600">{facility.location}</p>
            <p className="mt-1 text-xs text-harvest-800">
              {t('coldStorage.options.available', { kg: facility.availableCapacityKg })}
            </p>
            <button
              type="button"
              className="btn-primary mt-2"
              disabled={busyFacilityId !== null || facility.availableCapacityKg < offer.remainingQuantityKg}
              onClick={() => void reserve(facility.id)}
            >
              {busyFacilityId === facility.id
                ? t('common.saving')
                : t('coldStorage.options.store')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-1.5 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}
