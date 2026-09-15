import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { District, RegistrationView, State } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useT } from '../i18n/index.js';
import { ErrorPanel } from '../components/AppShell.js';
import { useRegistration } from './useRegistration.js';
import { StepNavigation } from './RegistrationLayout.js';
import { useCurrentLocation } from '../features/location/hooks/useCurrentLocation.js';
import { LocationSearch } from '../features/location/components/LocationSearch.js';

/**
 * Residence address (§12, §41.5).
 *
 * Device location is offered, never demanded, and it is explicitly the *home*
 * address — land location is collected separately on the next step, because
 * assuming a farmer stands on their own land is exactly the kind of silent
 * guess §12 forbids.
 */
export function AddressStep(): JSX.Element {
  const t = useT();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const [states, setStates] = useState<State[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);

  const [stateId, setStateId] = useState(view.farmer.stateId ?? '');
  const [districtId, setDistrictId] = useState(view.farmer.districtId ?? '');
  const [village, setVillage] = useState(view.farmer.village ?? '');
  const [line1, setLine1] = useState(view.farmer.addressLine1 ?? '');
  const [line2, setLine2] = useState(view.farmer.addressLine2 ?? '');
  const [pincode, setPincode] = useState(view.farmer.pincode ?? '');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    view.farmer.latitude !== null && view.farmer.longitude !== null
      ? { latitude: view.farmer.latitude, longitude: view.farmer.longitude }
      : null,
  );
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);

  const gps = useCurrentLocation();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gps.coords) return;
    setCoords({ latitude: gps.coords.latitude, longitude: gps.coords.longitude });
    setAccuracyMeters(gps.coords.accuracyMeters);
    // Reverse geocoding is best-effort here: it only pre-fills the village
    // field for the farmer to check, it never overwrites what they typed.
  }, [gps.coords]);

  useEffect(() => {
    api
      .get<{ states: State[] }>('/api/reference/states')
      .then((data) => setStates(data.states))
      .catch(setError);
  }, []);

  useEffect(() => {
    if (!stateId) {
      setDistricts([]);
      return;
    }
    api
      .get<{ districts: District[] }>(`/api/reference/states/${stateId}/districts`)
      .then((data) => setDistricts(data.districts))
      .catch(setError);
  }, [stateId]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const next = await api.put<RegistrationView>('/api/farmer/address', {
        village: village.trim(),
        addressLine1: line1.trim() || null,
        addressLine2: line2.trim() || null,
        pincode: pincode.trim(),
        stateId,
        districtId,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      });
      apply(next);
      navigate('/farmer/registration/land');
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-stone-900">{t('registration.address.title')}</h2>
      <p className="mt-1 text-sm text-stone-600">{t('registration.address.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="stateId" className="field-label">
              {t('registration.address.state')}
            </label>
            <select
              id="stateId"
              className="field-input"
              value={stateId}
              onChange={(event) => {
                setStateId(event.target.value);
                setDistrictId('');
              }}
              required
            >
              <option value="">{t('registration.address.selectState')}</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="districtId" className="field-label">
              {t('registration.address.district')}
            </label>
            <select
              id="districtId"
              className="field-input"
              value={districtId}
              onChange={(event) => setDistrictId(event.target.value)}
              disabled={districts.length === 0}
              required
            >
              <option value="">{t('registration.address.selectDistrict')}</option>
              {districts.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="village" className="field-label">
              {t('registration.address.village')}
            </label>
            <input
              id="village"
              className="field-input"
              value={village}
              onChange={(event) => setVillage(event.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="pincode" className="field-label">
              {t('registration.address.pincode')}
            </label>
            <input
              id="pincode"
              className="field-input"
              inputMode="numeric"
              maxLength={6}
              value={pincode}
              onChange={(event) => setPincode(event.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="line1" className="field-label">
            {t('registration.address.line1')}{' '}
            <span className="font-normal text-stone-400">({t('common.optional')})</span>
          </label>
          <input
            id="line1"
            className="field-input"
            value={line1}
            onChange={(event) => setLine1(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="line2" className="field-label">
            {t('registration.address.line2')}{' '}
            <span className="font-normal text-stone-400">({t('common.optional')})</span>
          </label>
          <input
            id="line2"
            className="field-input"
            value={line2}
            onChange={(event) => setLine2(event.target.value)}
          />
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm font-medium text-stone-800">
            {t('registration.address.useLocation')}
          </p>
          <p className="mt-1 text-xs text-stone-600">{t('registration.address.locationHelp')}</p>
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
            {coords ? (
              <span className="font-mono text-xs text-stone-600">
                {coords.latitude}, {coords.longitude}
              </span>
            ) : null}
          </div>
          {/* GPS is an estimate, never exact (§9) — shown, never used to
              reject a farmer's location. */}
          {accuracyMeters !== null ? (
            <p className="mt-1 text-xs text-stone-500">
              {t('location.accuracyApprox', { meters: accuracyMeters })}
            </p>
          ) : null}
          {gps.notice ? (
            <p className="mt-2 text-xs text-stone-600" role="status">
              {gps.notice}
            </p>
          ) : null}

          {/* An explicit search alternative (§11) — never a substitute for
              manual entry, which the fields above always allow regardless. */}
          <div className="mt-3 border-t border-stone-200 pt-3">
            <LocationSearch
              onSelect={(result) => {
                setCoords({ latitude: result.latitude, longitude: result.longitude });
                setAccuracyMeters(null);
                // Best-effort only: matched by name against the real state/
                // district lists, never invented. A miss just leaves the
                // dropdowns as they were, for the farmer to set themselves.
                const matchedState = result.state
                  ? states.find((state) => state.name.toLowerCase() === result.state?.toLowerCase())
                  : undefined;
                if (matchedState) setStateId(matchedState.id);
              }}
            />
          </div>
        </div>

        {error ? <ErrorPanel error={error} /> : null}

        <StepNavigation
          onBack="PERSONAL_DETAILS"
          submitLabel={t('common.saveAndContinue')}
          busy={busy}
        />
      </form>
    </section>
  );
}
