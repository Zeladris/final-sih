import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ALL_STORAGE_DURATION_BANDS,
  ALL_STORAGE_TYPES,
  cropMatches,
  cropName,
  ELIGIBILITY_DESTINATION,
  isEligibleToBook,
} from '@kisansetu/shared';
import type {
  AvailableDate,
  BookableCentre,
  BookingEligibility,
  Crop,
  FarmerBooking as Booking,
  PreArrivalQualityAssessment,
  ProcurementSlot,
  RegistrationView,
  StorageDurationBand,
  StorageType,
} from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { VoiceBookingPanel } from '../../features/voice-booking/VoiceBookingPanel.js';
import { useVoiceBooking } from '../../features/voice-booking/hooks/useVoiceBooking.js';
import { getActiveVoiceProvider, primeVoiceProvider } from '../../features/voice-booking/providers/activeProvider.js';
import { matchByNameOrOrdinal } from '../../features/voice-booking/utils/voiceCommands.js';
import type { VoiceLanguage, VoiceProvider } from '../../features/voice-booking/types.js';
import { useCurrentLocation } from '../../features/location/hooks/useCurrentLocation.js';
import { LocationSearch } from '../../features/location/components/LocationSearch.js';

/**
 * Farmer crop & slot booking (§6, §7).
 *
 * One page, six steps. A single page rather than six routes because the whole
 * point is not losing what the farmer typed when they go back — and on a phone
 * a page load between every question is the fastest way to lose somebody.
 *
 * Nothing is reserved by selecting it. The booking exists only once the server
 * confirms it (§25, §43).
 */

type Step = 'crop' | 'details' | 'location' | 'photo' | 'centre' | 'date' | 'slot' | 'review';

const STEPS: Step[] = ['crop', 'details', 'location', 'photo', 'centre', 'date', 'slot', 'review'];

interface Draft {
  crop: Crop | null;
  quantityKg: string;
  harvestDate: string;
  storageText: string;
  storageDurationBand: StorageDurationBand | null;
  storageType: StorageType | null;
  coords: { latitude: number; longitude: number } | null;
  /** The pre-arrival assessment, once the photo has been sent (§3). */
  assessment: PreArrivalQualityAssessment | null;
  centre: BookableCentre | null;
  date: string | null;
  slot: ProcurementSlot | null;
}

const EMPTY: Draft = {
  crop: null,
  quantityKg: '',
  harvestDate: '',
  storageText: '',
  storageDurationBand: null,
  storageType: null,
  coords: null,
  assessment: null,
  centre: null,
  date: null,
  slot: null,
};

export function FarmerBooking(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const navigate = useNavigate();

  const [eligibility, setEligibility] = useState<BookingEligibility | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('crop');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // Set only by "Edit" from the Review step (§ toggle back and forth without
  // re-answering what's already answered). A step that invalidates later
  // answers (crop, centre) clears it, because those genuinely do need
  // re-collecting; a step that doesn't (details, location, photo) honours it
  // by returning straight to Review instead of continuing the normal chain.
  const [returnToReview, setReturnToReview] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Crops are fetched once here, not inside CropStep, because the voice
  // session (below) needs the same real list to match spoken answers
  // against — never a second, invented catalogue (§9).
  const [crops, setCrops] = useState<Crop[] | null>(null);
  const [cropsError, setCropsError] = useState<unknown>(null);

  // Voice booking (Phase 9). `voiceMode` is chosen once from the entry
  // banner (§35) and persists across step changes — unlike the per-step
  // components below, this hook lives at the top of the page so the session
  // survives the visual step actually changing under it.
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDone, setVoiceDone] = useState(false);
  // Starts as the browser's own speech engine; becomes BhashiniProvider once
  // the backend confirms it is configured (§43) — see activeProvider.ts.
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(() => getActiveVoiceProvider());
  useEffect(() => {
    let cancelled = false;
    void primeVoiceProvider().then((provider) => {
      if (!cancelled) setVoiceProvider(provider);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // VoiceLanguage is now exactly Language (§34) — kept as its own local so
  // the voice hook's dependency is explicit rather than reading `language`
  // through three layers of prop-drilling.
  const voiceLanguage: VoiceLanguage = language;

  useEffect(() => {
    api
      .get<{ eligibility: BookingEligibility; idempotencyKey: string }>(
        '/api/farmer/booking/eligibility',
      )
      .then((data) => {
        setEligibility(data.eligibility);
        // Minted once for this attempt, so a retried Confirm reuses it (§51).
        setIdempotencyKey(data.idempotencyKey);
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    api
      .get<{ crops: Crop[] }>('/api/farmer/booking/crops')
      .then((data) => setCrops(data.crops))
      .catch(setCropsError);
  }, []);

  // Reuses the farmer's registered address — the one stable answer they've
  // already given — so the location step doesn't start blank every single
  // time ("don't ask again unless they need to change"). Only when
  // registration has no address at all does this fall back to whatever was
  // typed for their last booking. Purely additive: on any failure this just
  // leaves the step starting blank, same as before this existed, so it never
  // blocks booking.
  const [locationPrefillSource, setLocationPrefillSource] = useState<'lastBooking' | 'profile' | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;

    api
      .get<RegistrationView>('/api/farmer/registration')
      .then((view) => {
        if (cancelled) return true;
        const address = [view.farmer.village, view.farmer.addressLine1, view.farmer.addressLine2]
          .filter(Boolean)
          .join(', ');
        if (!address) return false;

        setDraft((current) =>
          current.storageText
            ? current
            : {
                ...current,
                storageText: address,
                coords:
                  view.farmer.latitude !== null && view.farmer.longitude !== null
                    ? { latitude: view.farmer.latitude, longitude: view.farmer.longitude }
                    : current.coords,
              },
        );
        setLocationPrefillSource('profile');
        return true;
      })
      .then((filled) => {
        if (cancelled || filled) return; // unmounted, or already prefilled from the profile
        return api.get<{ bookings: Booking[] }>('/api/farmer/bookings').then((data) => {
          if (cancelled) return;
          const last = data.bookings[0];
          if (!last?.storageLocationText) return;

          setDraft((current) =>
            current.storageText || current.coords
              ? current
              : {
                  ...current,
                  storageText: last.storageLocationText as string,
                  storageDurationBand: last.storageDurationBand,
                  storageType: last.storageType,
                  coords:
                    last.storageLatitude !== null && last.storageLongitude !== null
                      ? { latitude: last.storageLatitude, longitude: last.storageLongitude }
                      : current.coords,
                },
          );
          setLocationPrefillSource('lastBooking');
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));

  // Called unconditionally, before any early return below, because it is a
  // hook (Rules of Hooks) — even on the loading/ineligible screens it is
  // live, just never started until the farmer taps "Voice booking".
  const voice = useVoiceBooking({
    provider: voiceProvider,
    language: voiceLanguage,
    t,
    crops,
    onCropSelected: (crop) => {
      update({ crop, centre: null, date: null, slot: null });
      setStep('details');
    },
    onQuantity: (kg) => {
      update({ quantityKg: String(kg) });
      setStep('location');
    },
    onStorageDuration: (band) => update({ storageDurationBand: band }),
    onStorageType: (type) => update({ storageType: type }),
    onStorageLocation: (text) => update({ storageText: text }),
    onHandoff: () => {
      setStep('photo');
      setVoiceDone(true);
    },
  });

  if (error && eligibility === null) {
    return (
      <Shell>
        <ErrorPanel error={error} />
      </Shell>
    );
  }

  if (eligibility === null) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  // The server refuses an ineligible booking anyway; this just stops the
  // farmer filling in six steps before finding out (§4).
  if (!isEligibleToBook(eligibility)) {
    return (
      <Shell>
        <IneligibleNotice eligibility={eligibility} />
      </Shell>
    );
  }

  const index = STEPS.indexOf(step);

  async function confirm(): Promise<void> {
    if (!draft.crop || !draft.slot || !idempotencyKey) return;

    setBusy(true);
    setError(null);
    try {
      const { booking } = await api.post<{ booking: Booking }>('/api/farmer/bookings', {
        cropId: draft.crop.id,
        expectedQuantityKg: Number.parseFloat(draft.quantityKg),
        harvestDate: draft.harvestDate || null,
        storageLocationText: draft.storageText.trim(),
        storageLatitude: draft.coords?.latitude ?? null,
        storageLongitude: draft.coords?.longitude ?? null,
        storageDurationBand: draft.storageDurationBand,
        storageType: draft.storageType,
        // Null when the assessment failed or was skipped — the booking is
        // made either way and the centre assesses on arrival (§13).
        qualityAssessmentId: draft.assessment?.assessmentId ?? null,
        slotId: draft.slot.id,
        idempotencyKey,
        // Observability only (§46) — never a queue or eligibility advantage
        // (§39). The server records it and nothing else.
        bookingMethod: voiceMode ? 'voice' : 'standard',
      });

      navigate(`/farmer/bookings/${booking.id}?created=1`, { replace: true });
    } catch (cause) {
      setError(cause);
      // The slot filled while they were reviewing — send them back to pick
      // another rather than leaving a dead Confirm button (§40).
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setDraft((current) => ({ ...current, slot: null }));
        setStep('slot');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Link to="/farmer/dashboard" className="text-sm text-stone-600 underline underline-offset-2">
        ← {t('dashboard.nav.dashboard')}
      </Link>

      <Progress current={index} />

      {error ? <ErrorPanel error={error} /> : null}

      {/* Entry choice (§35): offered once, before the crop is picked either
          way, and never in place of the standard form below it (§28). */}
      {step === 'crop' && !draft.crop && !voiceMode && voice.supported && crops !== null ? (
        <VoiceEntryChoice onChooseVoice={() => setVoiceMode(true)} />
      ) : null}

      {voiceMode && !voiceDone ? <VoiceBookingPanel voice={voice} /> : null}

      {step === 'crop' ? (
        <CropStep
          crops={crops}
          error={cropsError}
          selected={draft.crop}
          onSelect={(crop) => {
            // Changing crop invalidates everything downstream: a centre may
            // not accept the new one, so the rest genuinely does need
            // re-collecting — this can't shortcut back to Review.
            update({ crop, centre: null, date: null, slot: null });
            setReturnToReview(false);
            setStep('details');
          }}
        />
      ) : null}

      {step === 'details' ? (
        <DetailsStep
          draft={draft}
          onChange={update}
          onBack={() => setStep('crop')}
          onNext={() => {
            if (returnToReview) {
              setReturnToReview(false);
              setStep('review');
            } else {
              setStep('location');
            }
          }}
        />
      ) : null}

      {step === 'location' ? (
        <LocationStep
          draft={draft}
          prefillSource={locationPrefillSource}
          onClearPrefillSource={() => setLocationPrefillSource(null)}
          onChange={update}
          onBack={() => setStep('details')}
          onNext={() => {
            if (returnToReview) {
              setReturnToReview(false);
              setStep('review');
            } else {
              setStep('photo');
            }
          }}
        />
      ) : null}

      {step === 'photo' ? (
        <ProducePhotoStep
          draft={draft}
          onChange={update}
          onBack={() => setStep('location')}
          onNext={() => {
            if (returnToReview) {
              setReturnToReview(false);
              setStep('review');
            } else {
              setStep('centre');
            }
          }}
        />
      ) : null}

      {step === 'centre' ? (
        <CentreStep
          crop={draft.crop!}
          coords={draft.coords}
          selected={draft.centre}
          voiceActive={voiceMode}
          voiceLanguage={voiceLanguage}
          onBack={() => setStep('photo')}
          onSelect={(centre) => {
            // Changing centre invalidates date and slot the same way —
            // those two also can't shortcut back to Review.
            update({ centre, date: null, slot: null });
            setReturnToReview(false);
            setStep('date');
          }}
        />
      ) : null}

      {step === 'date' ? (
        <DateStep
          crop={draft.crop!}
          centre={draft.centre!}
          onBack={() => setStep('centre')}
          onSelect={(date) => {
            update({ date, slot: null });
            setStep('slot');
          }}
        />
      ) : null}

      {step === 'slot' ? (
        <SlotStep
          crop={draft.crop!}
          centre={draft.centre!}
          date={draft.date!}
          onBack={() => setStep('date')}
          onSelect={(slot) => {
            update({ slot });
            setStep('review');
          }}
        />
      ) : null}

      {step === 'review' ? (
        <ReviewStep
          draft={draft}
          busy={busy}
          onBack={() => setStep('slot')}
          onEdit={(target) => {
            setReturnToReview(true);
            setStep(target);
          }}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </Shell>
  );
}

function IneligibleNotice({ eligibility }: { eligibility: BookingEligibility }): JSX.Element {
  const t = useT();
  const destination = ELIGIBILITY_DESTINATION[eligibility];

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.ineligible.title')}</h1>
      <p className="mt-2 text-sm text-stone-700">{t(`booking.ineligible.${eligibility}`)}</p>

      {destination ? (
        <Link to={destination} className="btn-primary mt-4 block text-center">
          {t(`booking.ineligible.action.${eligibility}`)}
        </Link>
      ) : null}
    </section>
  );
}

function Progress({ current }: { current: number }): JSX.Element {
  const t = useT();

  return (
    <nav aria-label={t('booking.progress')} className="card">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {t('booking.stepCount', { current: current + 1, total: STEPS.length })}
      </p>
      <p className="mt-1 text-sm font-medium text-stone-900">
        {t(`booking.step.${STEPS[current]}`)}
      </p>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {STEPS.map((entry, index) => (
          <div
            key={entry}
            className={`h-1.5 flex-1 rounded-full ${
              index <= current ? 'bg-harvest-600' : 'bg-stone-200'
            }`}
          />
        ))}
      </div>
    </nav>
  );
}

/**
 * The discoverable, non-hidden entry point voice booking requires (§35). A
 * plain choice, not an icon to notice — and choosing standard here changes
 * nothing: it is simply not showing this banner again this session.
 */
function VoiceEntryChoice({ onChooseVoice }: { onChooseVoice: () => void }): JSX.Element {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return <></>;

  return (
    <section className="card border-2 border-harvest-200 bg-harvest-50/40">
      <h2 className="font-semibold text-stone-900">{t('voice.entry.heading')}</h2>

      {/* Which language voice booking listens/speaks in is exactly the site
          language (§34) — surfaced here, not hidden in the header, since this
          is the moment it actually matters most: pick it BEFORE tapping
          "Voice booking" below, since that's what the session starts with. */}
      <div className="mt-3 rounded-lg border border-harvest-300 bg-white px-3 py-2.5">
        <span className="block text-sm font-semibold text-stone-900">
          🌐 {t('language.title')}
        </span>
        <div className="mt-2">
          <LanguageSwitcher />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="flex flex-col items-start gap-0.5 rounded-lg border border-harvest-500 bg-white px-4 py-3 text-left transition hover:bg-harvest-50"
          onClick={onChooseVoice}
        >
          <span className="flex items-center gap-2 font-medium text-stone-900">
            <span aria-hidden="true">🎤</span>
            {t('voice.entry.voiceLabel')}
          </span>
          <span className="text-xs text-stone-600">{t('voice.entry.voiceHint')}</span>
        </button>
        <button
          type="button"
          className="flex flex-col items-start gap-0.5 rounded-lg border border-stone-300 bg-white px-4 py-3 text-left transition hover:bg-stone-50"
          onClick={() => setDismissed(true)}
        >
          <span className="flex items-center gap-2 font-medium text-stone-900">
            <span aria-hidden="true">📝</span>
            {t('voice.entry.standardLabel')}
          </span>
          <span className="text-xs text-stone-600">{t('voice.entry.standardHint')}</span>
        </button>
      </div>
    </section>
  );
}

function CropStep({
  crops,
  error,
  selected,
  onSelect,
}: {
  /** Fetched once at the page level — the voice session needs the same real
   *  list, so there is exactly one source of truth for it (§9). */
  crops: Crop[] | null;
  error: unknown;
  selected: Crop | null;
  onSelect: (crop: Crop) => void;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const [query, setQuery] = useState('');

  if (error) return <ErrorPanel error={error} />;
  if (!crops) return <Spinner label={t('booking.loading.crops')} />;

  // Matches English or Tamil, so a Tamil speaker can type "நெல்" (§10).
  const visible = crops.filter((crop) => cropMatches(crop, query));

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.crop.title')}</h1>

      <input
        type="search"
        className="field-input mt-3"
        placeholder={t('booking.crop.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t('booking.crop.search')}
      />

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">{t('booking.crop.noMatch')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((crop) => (
            <li key={crop.id}>
              <button
                type="button"
                onClick={() => onSelect(crop)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  selected?.id === crop.id
                    ? 'border-harvest-500 bg-harvest-50'
                    : 'border-stone-300 hover:bg-stone-50'
                }`}
              >
                <span>
                  <span className="block font-medium text-stone-900">
                    {cropName(crop, language)}
                  </span>
                  {/* Crop names only ever exist in English and Tamil (§ no
                      Kannada/Hindi/Malayalam translation exists to show) — a
                      second line only makes sense when the chosen language IS
                      one of those two; otherwise it would show a stray Tamil
                      name no matter which language was actually picked. */}
                  {language === 'en' ? (
                    <span className="block text-xs text-stone-500">{crop.nameTa}</span>
                  ) : language === 'ta' ? (
                    <span className="block text-xs text-stone-500">{crop.nameEn}</span>
                  ) : null}
                </span>
                <span aria-hidden="true" className="text-harvest-700">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DetailsStep({
  draft,
  onChange,
  onBack,
  onNext,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const t = useT();
  const quantity = Number.parseFloat(draft.quantityKg);
  const valid = Number.isFinite(quantity) && quantity > 0;

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.details.title')}</h1>

      <div className="mt-4">
        <label htmlFor="quantity" className="field-label">
          {t('booking.details.quantity')}
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="quantity"
            type="text"
            inputMode="decimal"
            className="field-input text-lg"
            value={draft.quantityKg}
            onChange={(event) => onChange({ quantityKg: event.target.value.replace(/[^\d.]/g, '') })}
            autoFocus
          />
          {/* Controlled unit, not free text (§12). */}
          <span className="flex items-center rounded-lg border border-stone-300 bg-stone-50 px-4 text-base text-stone-700">
            {t('ops.kg')}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="harvest" className="field-label">
          {t('booking.details.harvestDate')}{' '}
          <span className="font-normal text-stone-400">({t('common.optional')})</span>
        </label>
        <input
          id="harvest"
          type="date"
          className="field-input"
          value={draft.harvestDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(event) => onChange({ harvestDate: event.target.value })}
        />
        <p className="mt-1 text-xs text-stone-500">{t('booking.details.harvestHelp')}</p>
      </div>

      <Nav onBack={onBack} onNext={onNext} nextDisabled={!valid} />
    </section>
  );
}

function LocationStep({
  draft,
  prefillSource,
  onClearPrefillSource,
  onChange,
  onBack,
  onNext,
}: {
  draft: Draft;
  prefillSource: 'lastBooking' | 'profile' | null;
  onClearPrefillSource: () => void;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const t = useT();
  const gps = useCurrentLocation();
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);

  useEffect(() => {
    if (!gps.coords) return;
    onChange({ coords: { latitude: gps.coords.latitude, longitude: gps.coords.longitude } });
    setAccuracyMeters(gps.coords.accuracyMeters);
    // Deliberately not depending on `onChange`: it is a fresh closure every
    // render, and this should fire once per GPS fix, not once per render.
  }, [gps.coords]);

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.location.title')}</h1>
      {/* Stated explicitly: this is not the farm and not their home (§14). */}
      <p className="mt-1 text-sm text-stone-600">{t('booking.location.subtitle')}</p>

      <div className="mt-4">
        <label htmlFor="storage" className="field-label">
          {t('booking.location.where')}
        </label>
        <input
          id="storage"
          className="field-input"
          value={draft.storageText}
          onChange={(event) => {
            onChange({ storageText: event.target.value });
            // The hint below describes where the PREVIOUS text came from —
            // stale and misleading the moment the farmer changes it (§ "don't
            // ask again unless they need to change" cuts both ways: once
            // they've changed it, the app should stop implying it didn't).
            if (prefillSource) onClearPrefillSource();
          }}
          placeholder={t('booking.location.placeholder')}
          autoFocus
        />
        {prefillSource ? (
          <p className="mt-1 text-xs text-stone-500">
            {t(
              prefillSource === 'lastBooking'
                ? 'booking.location.prefillLastBooking'
                : 'booking.location.prefillProfile',
            )}
          </p>
        ) : null}
      </div>

      {/* Storage duration and kind (§6). Bands, not a number to work out —
          and both optional, because a farmer who does not know moves on. */}
      <fieldset className="mt-5">
        <legend className="field-label">{t('booking.storage.durationLabel')}</legend>
        <p className="text-xs text-stone-500">{t('booking.storage.durationHelp')}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ALL_STORAGE_DURATION_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              aria-pressed={draft.storageDurationBand === band}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                draft.storageDurationBand === band
                  ? 'border-harvest-600 bg-harvest-50 text-harvest-900'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-50'
              }`}
              onClick={() =>
                onChange({ storageDurationBand: draft.storageDurationBand === band ? null : band })
              }
            >
              {t(`booking.storage.band.${band}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="field-label">
          {t('booking.storage.typeLabel')}{' '}
          <span className="font-normal text-stone-500">({t('common.optional')})</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_STORAGE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.storageType === type}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                draft.storageType === type
                  ? 'border-harvest-600 bg-harvest-50 text-harvest-900'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-50'
              }`}
              onClick={() => onChange({ storageType: draft.storageType === type ? null : type })}
            >
              {t(`booking.storage.type.${type}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs text-stone-600">{t('booking.location.coordsHelp')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={gps.request}
            disabled={gps.locating}
          >
            {gps.locating
              ? t('registration.address.locating')
              : t('registration.address.useLocation')}
          </button>
          {draft.coords ? (
            <span className="font-mono text-xs text-stone-600">
              {draft.coords.latitude}, {draft.coords.longitude}
            </span>
          ) : null}
        </div>
        {accuracyMeters !== null ? (
          <p className="mt-1 text-xs text-stone-500">
            {t('location.accuracyApprox', { meters: accuracyMeters })}
          </p>
        ) : null}
        {gps.notice ? (
          <p role="status" className="mt-2 text-xs text-stone-600">
            {gps.notice}
          </p>
        ) : null}

        {/* An explicit search alternative (§11, §22) — the produce storage
            point is frequently not where the farmer is standing right now. */}
        <div className="mt-3 border-t border-stone-200 pt-3">
          <LocationSearch
            onSelect={(result) => {
              onChange({ coords: { latitude: result.latitude, longitude: result.longitude } });
              setAccuracyMeters(null);
              if (!draft.storageText.trim()) onChange({ storageText: result.displayName });
            }}
          />
        </div>
      </div>

      <Nav onBack={onBack} onNext={onNext} nextDisabled={draft.storageText.trim().length < 2} />
    </section>
  );
}

function CentreStep({
  crop,
  coords,
  selected,
  voiceActive,
  voiceLanguage,
  onBack,
  onSelect,
}: {
  crop: Crop;
  coords: Draft['coords'];
  selected: BookableCentre | null;
  /** Whether this booking is being done by voice (§35) — used only to decide
   *  whether to also announce+listen here, never anything about eligibility. */
  voiceActive: boolean;
  voiceLanguage: VoiceLanguage;
  onBack: () => void;
  onSelect: (centre: BookableCentre) => void;
}): JSX.Element {
  const t = useT();
  const [centres, setCentres] = useState<BookableCentre[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const query = new URLSearchParams({ cropId: crop.id });
    if (coords) {
      query.set('lat', String(coords.latitude));
      query.set('lon', String(coords.longitude));
    }

    api
      .get<{ centres: BookableCentre[] }>(`/api/farmer/booking/centres?${query.toString()}`)
      .then((data) => setCentres(data.centres))
      .catch(setError);
  }, [crop.id, coords]);

  /**
   * §8/§19's worked example: "I found three procurement centres... say the
   * name, or tap one below." One announce, one listen, then it steps aside —
   * the tap list underneath is what actually renders and is always usable,
   * voice or not (§28). A miss here is silent: nothing is selected, and nothing
   * tells the farmer they "failed," because tapping was always the plan B.
   */
  useEffect(() => {
    if (!voiceActive || centres === null) return;
    if (centres.length === 0) return;

    let cancelled = false;
    const provider = getActiveVoiceProvider();

    void (async () => {
      if (!provider.isSupported()) return;
      await provider.speak(t('voice.prompt.centreList', { count: centres.length }), voiceLanguage);
      if (cancelled) return;
      const result = await provider.listenOnce(voiceLanguage, 6000);
      if (cancelled || !result) return;
      const match = matchByNameOrOrdinal(result.transcript, centres, (centre) => centre.name);
      if (match && match.availableSlotCount > 0) onSelect(match);
    })();

    return () => {
      cancelled = true;
      provider.stopListening();
      provider.cancelSpeech();
    };
    // Deliberately not depending on `onSelect`/`t`: both are recreated each
    // render, and re-running this on every render would restart the
    // announce/listen loop constantly rather than once per centre list.
  }, [voiceActive, centres, voiceLanguage]);

  if (error) return <ErrorPanel error={error} />;
  if (!centres) return <Spinner label={t('booking.loading.centres')} />;

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.centre.title')}</h1>

      {centres.length === 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-4 text-sm text-stone-600">
          {t('booking.centre.none')}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {centres.map((centre) => (
            <li key={centre.id}>
              <button
                type="button"
                onClick={() => onSelect(centre)}
                disabled={centre.availableSlotCount === 0}
                className={`w-full rounded-lg border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 ${
                  selected?.id === centre.id
                    ? 'border-harvest-500 bg-harvest-50'
                    : 'border-stone-300 hover:bg-stone-50'
                }`}
              >
                <span className="block font-medium text-stone-900">{centre.name}</span>
                <span className="block text-xs text-stone-600">
                  {[centre.village, centre.districtName].filter(Boolean).join(', ')}
                  {/* Only shown when we actually measured it (§15). */}
                  {centre.distanceKm !== null ? ` · ${centre.distanceKm} km` : ''}
                </span>
                <span className="mt-1 block text-xs font-medium text-harvest-800">
                  {centre.availableSlotCount > 0
                    ? t('booking.centre.slotsAvailable', { count: centre.availableSlotCount })
                    : t('booking.centre.noSlots')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Nav onBack={onBack} />
    </section>
  );
}

function DateStep({
  crop,
  centre,
  onBack,
  onSelect,
}: {
  crop: Crop;
  centre: BookableCentre;
  onBack: () => void;
  onSelect: (date: string) => void;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [dates, setDates] = useState<AvailableDate[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ dates: AvailableDate[] }>(
        `/api/farmer/booking/dates?cropId=${crop.id}&centreId=${centre.id}`,
      )
      .then((data) => setDates(data.dates))
      .catch(setError);
  }, [crop.id, centre.id]);

  if (error) return <ErrorPanel error={error} />;
  if (!dates) return <Spinner label={t('booking.loading.dates')} />;

  const format = (iso: string): string =>
    new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${iso}T00:00:00+05:30`));

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.date.title')}</h1>
      <p className="mt-1 text-sm text-stone-600">{centre.name}</p>

      {dates.length === 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-4 text-sm text-stone-600">
          {t('booking.date.none')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {dates.map((entry) => (
            <li key={entry.date}>
              <button
                type="button"
                onClick={() => onSelect(entry.date)}
                className="w-full rounded-lg border border-stone-300 px-4 py-3 text-left transition hover:bg-stone-50"
              >
                <span className="block font-medium text-stone-900">{format(entry.date)}</span>
                <span className="block text-xs text-harvest-800">
                  {t('booking.date.placesLeft', { count: entry.remainingCapacity })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Nav onBack={onBack} />
    </section>
  );
}

function SlotStep({
  crop,
  centre,
  date,
  onBack,
  onSelect,
}: {
  crop: Crop;
  centre: BookableCentre;
  date: string;
  onBack: () => void;
  onSelect: (slot: ProcurementSlot) => void;
}): JSX.Element {
  const t = useT();
  const [slots, setSlots] = useState<ProcurementSlot[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback((): void => {
    api
      .get<{ slots: ProcurementSlot[] }>(
        `/api/farmer/booking/slots?cropId=${crop.id}&centreId=${centre.id}&date=${date}`,
      )
      .then((data) => setSlots(data.slots))
      .catch(setError);
  }, [crop.id, centre.id, date]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorPanel error={error} />;
  if (!slots) return <Spinner label={t('booking.loading.slots')} />;

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.slot.title')}</h1>

      {slots.length === 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-4 text-sm text-stone-600">
          {t('booking.slot.none')}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {slots.map((slot) => (
            <li key={slot.id}>
              <button
                type="button"
                onClick={() => onSelect(slot)}
                disabled={slot.isFull}
                className="w-full rounded-lg border border-stone-300 px-4 py-3 text-left transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
              >
                <span className="block font-mono font-medium text-stone-900">
                  {slot.startTime}–{slot.endTime}
                </span>
                {/* The count is informational; the server decides (§23). */}
                <span
                  className={`block text-xs ${slot.isFull ? 'text-stone-400' : 'text-harvest-800'}`}
                >
                  {slot.isFull
                    ? t('booking.slot.full')
                    : t('booking.slot.remaining', { count: slot.remainingCapacity })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('common.back')}
        </button>
        <button type="button" className="btn-secondary" onClick={load}>
          {t('booking.slot.refresh')}
        </button>
      </div>
    </section>
  );
}

/**
 * The produce photo and the AI's pre-arrival indication (§3, §15).
 *
 * Three things this screen is careful about:
 *   - It is OPTIONAL. "Skip" is a real, visible choice, and a failed
 *     assessment leaves the farmer exactly where a skipped one does (§13).
 *   - It never claims grading. The wording says an indication, from a
 *     development model, and that the centre checks on arrival (§3, §8).
 *   - It never blocks. Every outcome leads to "Continue".
 */
function ProducePhotoStep({
  draft,
  onChange,
  onBack,
  onNext,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function upload(file: File): Promise<void> {
    if (!draft.crop) return;
    setBusy(true);
    setFailed(false);

    const form = new FormData();
    form.append('photo', file);
    form.append('cropId', draft.crop.id);
    form.append('expectedQuantityKg', draft.quantityKg);
    if (draft.storageDurationBand) form.append('storageDurationBand', draft.storageDurationBand);
    if (draft.storageType) form.append('storageType', draft.storageType);
    if (draft.coords) {
      form.append('storageLatitude', String(draft.coords.latitude));
      form.append('storageLongitude', String(draft.coords.longitude));
    }

    try {
      const { assessment } = await api.upload<{ assessment: PreArrivalQualityAssessment }>(
        '/api/farmer/bookings/quality-assessment',
        form,
      );
      onChange({ assessment });
    } catch {
      // The upload itself failed (offline, too large, server down). Same
      // outcome as a model that could not answer: booking carries on.
      setFailed(true);
      onChange({ assessment: null });
    } finally {
      setBusy(false);
    }
  }

  const assessment = draft.assessment;
  const usable = assessment?.status === 'COMPLETED';

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.photo.title')}</h1>
      <p className="mt-1 text-sm text-stone-600">{t('booking.photo.subtitle')}</p>

      {busy ? (
        <p role="status" className="mt-4 rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-700">
          {t('booking.photo.analyzing')}
        </p>
      ) : null}

      {!busy && !assessment && !failed ? (
        <div className="mt-4">
          <label className="btn-primary block cursor-pointer text-center">
            {t('booking.photo.choose')}
            <input
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-stone-500">{t('booking.photo.help')}</p>
        </div>
      ) : null}

      {!busy && usable ? <AssessmentCard assessment={assessment!} /> : null}

      {!busy && (failed || (assessment && !usable)) ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">{t('booking.photo.unavailable.title')}</p>
          <p className="mt-1 text-sm text-amber-800">{t('booking.photo.unavailable.body')}</p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={busy}>
          {t('common.back')}
        </button>
        <button type="button" className="btn-primary flex-1" onClick={onNext} disabled={busy}>
          {assessment || failed ? t('common.continue') : t('booking.photo.skip')}
        </button>
      </div>
    </section>
  );
}

/** The advisory result, worded as an indication and never as a grade (§3, §15). */
function AssessmentCard({
  assessment,
}: {
  assessment: PreArrivalQualityAssessment;
}): JSX.Element {
  const t = useT();
  const score = assessment.qualityScore;
  const risk = assessment.qualityRisk ?? 'MEDIUM';

  const tone =
    risk === 'LOW'
      ? 'border-harvest-200 bg-harvest-50 text-harvest-900'
      : risk === 'HIGH'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-stone-200 bg-stone-50 text-stone-800';

  return (
    <div className={`mt-4 rounded-xl border p-4 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{t('booking.photo.result.title')}</p>

      {score !== null ? (
        <p className="mt-1 text-2xl font-semibold">
          {t('booking.photo.result.score', { score: Math.round(score) })}
        </p>
      ) : null}

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="opacity-70">{t('quality.risk')}:</dt>
          <dd className="font-medium">{t(`quality.risk.${risk}`)}</dd>
        </div>
        {assessment.confidence !== null ? (
          <div className="flex gap-1">
            <dt className="opacity-70">{t('quality.confidence')}:</dt>
            <dd className="font-medium">
              {assessment.lowConfidence
                ? t('quality.confidence.low')
                : `${Math.round(assessment.confidence * 100)}%`}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* The sentence that keeps this honest: it is an indication, and the
          centre performs the real check (§3). */}
      <p className="mt-3 text-sm">{t('booking.photo.result.advisory')}</p>

      {assessment.weatherContext?.available && assessment.weatherContext.relevance !== 'NONE' ? (
        <p className="mt-2 text-xs opacity-80">{t('booking.photo.result.context')}</p>
      ) : null}

      {assessment.trainingData ? (
        <p className="mt-2 text-xs opacity-70">
          {t('quality.provenance', {
            model: assessment.modelVersion ?? '',
            data: assessment.trainingData,
          })}
        </p>
      ) : null}
    </div>
  );
}

function ReviewStep({
  draft,
  busy,
  onBack,
  onEdit,
  onConfirm,
}: {
  draft: Draft;
  busy: boolean;
  onBack: () => void;
  onEdit: (step: Step) => void;
  onConfirm: () => void;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const dateLabel = draft.slot
    ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
        dateStyle: 'long',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(`${draft.slot.slotDate}T00:00:00+05:30`))
    : '';

  return (
    <section className="card">
      <h1 className="text-xl font-semibold text-stone-900">{t('booking.review.title')}</h1>

      <dl className="mt-4 space-y-3">
        <Row
          label={t('booking.step.crop')}
          value={draft.crop ? cropName(draft.crop, language) : ''}
          onEdit={() => onEdit('crop')}
        />
        <Row
          label={t('booking.details.quantity')}
          value={`${draft.quantityKg} ${t('ops.kg')}`}
          onEdit={() => onEdit('details')}
        />
        <Row
          label={t('booking.location.where')}
          value={draft.storageText}
          onEdit={() => onEdit('location')}
        />
        {draft.storageDurationBand ? (
          <Row
            label={t('booking.storage.durationLabel')}
            value={t(`booking.storage.band.${draft.storageDurationBand}`)}
            onEdit={() => onEdit('location')}
          />
        ) : null}
        <Row
          label={t('booking.photo.reviewLabel')}
          value={
            draft.assessment?.status === 'COMPLETED' && draft.assessment.qualityScore !== null
              ? t('booking.photo.result.score', {
                  score: Math.round(draft.assessment.qualityScore),
                })
              : t('booking.photo.reviewNone')
          }
          onEdit={() => onEdit('photo')}
        />
        <Row
          label={t('dashboard.procurement.centre')}
          value={draft.centre?.name ?? ''}
          onEdit={() => onEdit('centre')}
        />
        <Row label={t('ops.field.date')} value={dateLabel} onEdit={() => onEdit('date')} />
        <Row
          label={t('ops.field.slot')}
          value={draft.slot ? `${draft.slot.startTime}–${draft.slot.endTime}` : ''}
          onEdit={() => onEdit('slot')}
        />
      </dl>

      {/* Review is a step like any other — Back works here too, not just a
          per-field Edit jump (§ toggle back and forth through every step). */}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={busy}>
          {t('common.back')}
        </button>
        {/* Unambiguous final action — not "Continue" or "Submit" (§28). */}
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={onConfirm}>
          {busy ? t('booking.review.confirming') : t('booking.review.confirm')}
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-stone-500">{t('booking.review.note')}</p>
    </section>
  );
}

function Row({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}): JSX.Element {
  const t = useT();

  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 pb-2 last:border-0">
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
        <dd className="text-sm text-stone-900">{value || t('common.notProvided')}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-sm text-harvest-700 underline underline-offset-2"
      >
        {t('common.edit')}
      </button>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
}): JSX.Element {
  const t = useT();

  return (
    <div className="mt-5 flex gap-2">
      <button type="button" className="btn-secondary" onClick={onBack}>
        {t('common.back')}
      </button>
      {onNext ? (
        <button type="button" className="btn-primary flex-1" disabled={nextDisabled} onClick={onNext}>
          {t('common.continue')}
        </button>
      ) : null}
    </div>
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
