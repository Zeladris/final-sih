import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, businessToday } from '@kisansetu/shared';
import type { ProcurementSlot } from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

interface SlotGroups {
  today: ProcurementSlot[];
  tomorrow: ProcurementSlot[];
  upcoming: ProcurementSlot[];
}

/**
 * Slot management (§12, §13).
 *
 * Staff create and adjust slots for their own centre. Capacity cannot be cut
 * below confirmed bookings — the database refuses, and the message here says
 * why rather than showing a generic failure.
 */
export function StaffSlots(): JSX.Element {
  const t = useT();
  const [groups, setGroups] = useState<SlotGroups | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setGroups(await api.get<SlotGroups>('/api/staff/me/slots'));
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(input: {
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
  }): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/staff/me/slots', input);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function changeCapacity(slotId: string, capacity: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/staff/me/slots/${slotId}`, { capacity });
      await load();
    } catch (cause) {
      setError(cause);
      if (cause instanceof ApiRequestError && cause.status === 409) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Link to="/staff/dashboard" className="text-sm text-stone-600 underline underline-offset-2">
          ← {t('dashboard.nav.dashboard')}
        </Link>

        <CreateSlotForm busy={busy} onCreate={(input) => void create(input)} />

        {error ? <ErrorPanel error={error} /> : null}

        {!groups ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <>
            <SlotGroup
              title={t('ops.slots.today')}
              slots={groups.today}
              busy={busy}
              onCapacity={changeCapacity}
            />
            <SlotGroup
              title={t('ops.slots.tomorrowPlain')}
              slots={groups.tomorrow}
              busy={busy}
              onCapacity={changeCapacity}
            />
            <SlotGroup
              title={t('ops.slots.upcoming')}
              slots={groups.upcoming}
              busy={busy}
              onCapacity={changeCapacity}
            />
          </>
        )}
      </main>
    </div>
  );
}

function CreateSlotForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: {
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
  }) => void;
}): JSX.Element {
  const t = useT();
  const tomorrow = addDays(businessToday('Asia/Kolkata'), 1);

  const [slotDate, setSlotDate] = useState(tomorrow);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [capacity, setCapacity] = useState('10');

  const capacityNumber = Number.parseInt(capacity, 10);
  const valid =
    startTime < endTime && Number.isInteger(capacityNumber) && capacityNumber > 0 && slotDate !== '';

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{t('ops.slots.create')}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="slotDate" className="field-label">
            {t('ops.field.date')}
          </label>
          <input
            id="slotDate"
            type="date"
            className="field-input"
            value={slotDate}
            min={businessToday('Asia/Kolkata')}
            onChange={(event) => setSlotDate(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="capacity" className="field-label">
            {t('ops.field.capacity')}
          </label>
          <input
            id="capacity"
            type="text"
            inputMode="numeric"
            className="field-input"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div>
          <label htmlFor="startTime" className="field-label">
            {t('ops.field.startTime')}
          </label>
          <input
            id="startTime"
            type="time"
            className="field-input"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="endTime" className="field-label">
            {t('ops.field.endTime')}
          </label>
          <input
            id="endTime"
            type="time"
            className="field-input"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || !valid}
        onClick={() =>
          onCreate({ slotDate, startTime, endTime, capacity: capacityNumber })
        }
      >
        {t('ops.slots.createAction')}
      </button>
    </section>
  );
}

function SlotGroup({
  title,
  slots,
  busy,
  onCapacity,
}: {
  title: string;
  slots: ProcurementSlot[];
  busy: boolean;
  onCapacity: (slotId: string, capacity: number) => Promise<void>;
}): JSX.Element {
  const t = useT();

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{title}</h2>

      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">{t('ops.slots.none')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {slots.map((slot) => (
            <li
              key={slot.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2"
            >
              <div>
                <p className="font-mono text-sm font-medium text-stone-900">
                  {slot.startTime}–{slot.endTime}
                </p>
                <p className="text-xs text-stone-600">
                  {t('ops.slots.booked', { booked: slot.bookedCount, capacity: slot.capacity })}
                  {slot.isFull ? ` · ${t('ops.slots.full')}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-secondary px-2"
                  disabled={busy || slot.capacity <= slot.bookedCount}
                  title={t('ops.slots.decrease')}
                  onClick={() => void onCapacity(slot.id, slot.capacity - 1)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  disabled={busy}
                  title={t('ops.slots.increase')}
                  onClick={() => void onCapacity(slot.id, slot.capacity + 1)}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
