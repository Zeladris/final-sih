import { Link, Navigate } from 'react-router-dom';
import { isEditable } from '@kisansetu/shared';
import type { DashboardFarmer } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';
import { useFarmerDashboard } from '../../hooks/useFarmerDashboard.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

/**
 * Account / profile page (§15).
 *
 * Read-only. It reuses the data Phase 1 already collected rather than
 * duplicating the registration flow, and changes that would affect
 * verification route back through that flow instead of silently editing
 * verified data.
 *
 * Deliberately absent: identity numbers, document contents, storage paths,
 * internal verification metadata (§14).
 */
export function FarmerProfile(): JSX.Element {
  const t = useT();
  const { state, reload } = useFarmerDashboard();

  if (state.status === 'NO_REGISTRATION') {
    return <Navigate to="/farmer/registration/start" replace />;
  }

  if (state.status === 'INITIALIZING') {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  if (state.status === 'ERROR') {
    return (
      <Shell>
        <ErrorPanel error={state.error} />
        <button type="button" className="btn-secondary mt-4" onClick={() => void reload()}>
          {t('common.retry')}
        </button>
      </Shell>
    );
  }

  const { farmer, verification } = state.data;
  const editable = isEditable(verification.registrationStatus);

  return (
    <Shell>
      <section className="card">
        <h1 className="text-xl font-semibold text-stone-900">{t('profile.title')}</h1>
        <p className="mt-1 text-sm text-stone-600">{t('profile.subtitle')}</p>
      </section>

      <Group title={t('profile.personal')}>
        <Field label={t('registration.personal.fullName')} value={farmer.name} />
        <Field label={t('registration.personal.fullNameLocal')} value={farmer.nameLocal} />
        <Field label={t('dashboard.mobile')} value={farmer.phone} />
        <Field
          label={t('registration.personal.gender')}
          value={farmer.gender ? t(`gender.${farmer.gender}`) : null}
        />
        <Field label={t('dashboard.farmerId')} value={farmer.farmerReferenceId} />
      </Group>

      <Group title={t('profile.address')}>
        <Field label={t('registration.address.village')} value={farmer.village} />
        <Field label={t('registration.address.district')} value={farmer.districtName} />
        <Field label={t('registration.address.state')} value={farmer.stateName} />
      </Group>

      <Group title={t('profile.farm')}>
        <Field label={t('dashboard.summary.primaryCrop')} value={farmer.primaryCrop} />
        <Field
          label={t('dashboard.summary.landArea')}
          value={
            farmer.landAreaAcres !== null
              ? `${farmer.landAreaAcres} ${t('land.unit.ACRE')}`
              : null
          }
        />
        <Field
          label={t('profile.holdings')}
          value={farmer.landHoldingCount > 0 ? String(farmer.landHoldingCount) : null}
        />
        <Field
          label={t('profile.farmLocation')}
          value={farmer.hasFarmLocation ? t('profile.locationRecorded') : null}
        />
      </Group>

      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('profile.changes')}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {editable ? t('profile.changesEditable') : t('profile.changesLocked')}
        </p>

        {editable ? (
          <Link to="/farmer/registration/review" className="btn-secondary mt-3 inline-block">
            {t('profile.updateDetails')}
          </Link>
        ) : (
          <Link to="/farmer/status" className="btn-secondary mt-3 inline-block">
            {t('dashboard.verification.viewDetail')}
          </Link>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  const t = useT();

  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className={`text-sm ${value ? 'text-stone-900' : 'text-stone-400'}`}>
        {value ?? t('common.notProvided')}
      </dd>
    </div>
  );
}

/** Re-exported for the route file's convenience. */
export type { DashboardFarmer };
