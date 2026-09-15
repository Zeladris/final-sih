import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ALL_LAND_AREA_UNITS,
  ALL_LAND_OWNERSHIP_TYPES,
  toAcres,
} from '@kisansetu/shared';
import type {
  District,
  LandAreaUnit,
  LandHolding,
  LandOwnershipType,
  RegistrationView,
} from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useT } from '../i18n/index.js';
import { ErrorPanel } from '../components/AppShell.js';
import { useRegistration } from './useRegistration.js';

/**
 * Land and agricultural information (§13, §41.6).
 *
 * Multiple parcels are supported because farmers commonly work several under
 * different arrangements. Note the note at the bottom: adding land here records
 * a declaration, it does not verify anything (§14).
 */
export function LandStep(): JSX.Element {
  const t = useT();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<LandHolding | null>(null);
  const [adding, setAdding] = useState(view.landHoldings.length === 0);
  const [error, setError] = useState<unknown>(null);

  const totalAcres = view.landHoldings.reduce(
    (sum, holding) => sum + toAcres(holding.area, holding.areaUnit),
    0,
  );

  async function remove(holdingId: string): Promise<void> {
    setError(null);
    try {
      apply(await api.del<RegistrationView>(`/api/farmer/land/${holdingId}`));
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-stone-900">{t('registration.land.title')}</h2>
      <p className="mt-1 text-sm text-stone-600">{t('registration.land.subtitle')}</p>

      {view.landHoldings.length === 0 && !adding ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-4 text-sm text-stone-600">
          {t('registration.land.empty')}
        </p>
      ) : null}

      {view.landHoldings.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {view.landHoldings.map((holding) => (
            <li key={holding.id} className="rounded-lg border border-stone-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-stone-900">
                    {holding.area} {t(`land.unit.${holding.areaUnit}`)} ·{' '}
                    {t(`land.ownership.${holding.ownershipType}`)}
                  </p>
                  <p className="text-xs text-stone-600">
                    {[holding.village, holding.primaryCrop, holding.surveyNumber]
                      .filter(Boolean)
                      .join(' · ') || t('common.notProvided')}
                  </p>
                  {holding.rejectionReason ? (
                    <p className="mt-1 text-xs text-red-700">{holding.rejectionReason}</p>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditing(holding);
                      setAdding(false);
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-red-700"
                    onClick={() => void remove(holding.id)}
                  >
                    {t('common.remove')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {view.landHoldings.length > 0 ? (
        <p className="mt-3 text-sm text-stone-700">
          {t('registration.land.totalArea')}: <strong>{totalAcres.toFixed(2)}</strong>{' '}
          {t('land.unit.ACRE')}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorPanel error={error} />
        </div>
      ) : null}

      {adding || editing ? (
        <LandForm
          holding={editing}
          defaultVillage={view.farmer.village}
          defaultDistrictId={view.farmer.districtId}
          defaultStateId={view.farmer.stateId}
          onDone={(next) => {
            apply(next);
            setAdding(false);
            setEditing(null);
          }}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : (
        <button type="button" className="btn-secondary mt-4" onClick={() => setAdding(true)}>
          + {t('registration.land.addButton')}
        </button>
      )}

      <p className="mt-5 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
        {t('registration.land.notVerifiedNote')}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/farmer/registration/address')}
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={view.landHoldings.length === 0}
          onClick={() => navigate('/farmer/registration/documents')}
        >
          {t('common.continue')}
        </button>
      </div>
    </section>
  );
}

function LandForm({
  holding,
  defaultVillage,
  defaultDistrictId,
  defaultStateId,
  onDone,
  onCancel,
}: {
  holding: LandHolding | null;
  defaultVillage: string | null;
  defaultDistrictId: string | null;
  defaultStateId: string | null;
  onDone: (view: RegistrationView) => void;
  onCancel: () => void;
}): JSX.Element {
  const t = useT();

  const [ownershipType, setOwnershipType] = useState<LandOwnershipType>(
    holding?.ownershipType ?? 'OWNED',
  );
  const [area, setArea] = useState(holding ? String(holding.area) : '');
  const [areaUnit, setAreaUnit] = useState<LandAreaUnit>(holding?.areaUnit ?? 'ACRE');
  const [surveyNumber, setSurveyNumber] = useState(holding?.surveyNumber ?? '');
  const [primaryCrop, setPrimaryCrop] = useState(holding?.primaryCrop ?? '');
  const [sameVillage, setSameVillage] = useState(
    holding ? holding.village === defaultVillage : true,
  );
  const [village, setVillage] = useState(holding?.village ?? defaultVillage ?? '');
  const [districtId, setDistrictId] = useState(holding?.districtId ?? defaultDistrictId ?? '');
  const [districts, setDistricts] = useState<District[]>([]);

  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!defaultStateId) return;
    api
      .get<{ districts: District[] }>(`/api/reference/states/${defaultStateId}/districts`)
      .then((data) => setDistricts(data.districts))
      .catch(() => undefined);
  }, [defaultStateId]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const parsedArea = Number.parseFloat(area);
    if (!Number.isFinite(parsedArea) || parsedArea <= 0) {
      setError(new Error(t('registration.land.area')));
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ownershipType,
        area: parsedArea,
        areaUnit,
        surveyNumber: surveyNumber.trim() || null,
        primaryCrop: primaryCrop.trim() || null,
        village: (sameVillage ? defaultVillage : village.trim()) || null,
        districtId: districtId || null,
        stateId: defaultStateId,
      };

      const next = holding
        ? await api.put<RegistrationView>(`/api/farmer/land/${holding.id}`, payload)
        : await api.post<RegistrationView>('/api/farmer/land', payload);

      onDone(next);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-4 rounded-lg border border-harvest-200 bg-harvest-50/40 p-4"
      noValidate
    >
      <h3 className="font-semibold text-stone-900">
        {holding ? t('registration.land.editTitle') : t('registration.land.addTitle')}
      </h3>

      <div>
        <label htmlFor="ownershipType" className="field-label">
          {t('registration.land.ownership')}
        </label>
        <select
          id="ownershipType"
          className="field-input"
          value={ownershipType}
          onChange={(event) => setOwnershipType(event.target.value as LandOwnershipType)}
        >
          {ALL_LAND_OWNERSHIP_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`land.ownership.${option}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="area" className="field-label">
            {t('registration.land.area')}
          </label>
          <input
            id="area"
            className="field-input"
            inputMode="decimal"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="areaUnit" className="field-label">
            {t('registration.land.areaUnit')}
          </label>
          <select
            id="areaUnit"
            className="field-input"
            value={areaUnit}
            onChange={(event) => setAreaUnit(event.target.value as LandAreaUnit)}
          >
            {ALL_LAND_AREA_UNITS.map((option) => (
              <option key={option} value={option}>
                {t(`land.unit.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="surveyNumber" className="field-label">
          {t('registration.land.surveyNumber')}{' '}
          <span className="font-normal text-stone-400">({t('common.optional')})</span>
        </label>
        <input
          id="surveyNumber"
          className="field-input"
          value={surveyNumber}
          onChange={(event) => setSurveyNumber(event.target.value)}
        />
        <p className="mt-1 text-xs text-stone-500">
          {t('registration.land.surveyNumberHelp')}
        </p>
      </div>

      <div>
        <label htmlFor="primaryCrop" className="field-label">
          {t('registration.land.primaryCrop')}
        </label>
        <input
          id="primaryCrop"
          className="field-input"
          value={primaryCrop}
          onChange={(event) => setPrimaryCrop(event.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={sameVillage}
          onChange={(event) => setSameVillage(event.target.checked)}
          className="h-4 w-4 rounded border-stone-300"
        />
        {t('registration.land.sameAsAddress')}
      </label>

      {!sameVillage ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="landVillage" className="field-label">
              {t('registration.land.village')}
            </label>
            <input
              id="landVillage"
              className="field-input"
              value={village}
              onChange={(event) => setVillage(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="landDistrict" className="field-label">
              {t('registration.land.district')}
            </label>
            <select
              id="landDistrict"
              className="field-input"
              value={districtId}
              onChange={(event) => setDistrictId(event.target.value)}
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
      ) : null}

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex gap-3">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
