import { Link } from 'react-router-dom';
import type { DashboardFarmer } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';

/**
 * Compact farm summary (§14).
 *
 * Only what Phase 1 actually collected. No identity numbers, no document
 * contents, no storage paths, no internal verification metadata — and no
 * "N/A" placeholders: a missing optional field renders localized fallback text
 * (§20).
 */
export function FarmerProfileSummary({ farmer }: { farmer: DashboardFarmer }): JSX.Element {
  const t = useT();

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-stone-900">{t('dashboard.summary.title')}</h2>
        <Link
          to="/farmer/profile"
          className="text-sm font-medium text-harvest-800 underline underline-offset-2"
        >
          {t('dashboard.summary.viewAll')}
        </Link>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label={t('dashboard.summary.primaryCrop')} value={farmer.primaryCrop} />
        <Field
          label={t('dashboard.summary.landArea')}
          value={
            farmer.landAreaAcres !== null
              ? `${farmer.landAreaAcres} ${t('land.unit.ACRE')}`
              : null
          }
          hint={
            farmer.landHoldingCount > 1
              ? t('dashboard.summary.acrossHoldings', { count: farmer.landHoldingCount })
              : undefined
          }
        />
        <Field label={t('registration.address.village')} value={farmer.village} />
        <Field label={t('registration.address.district')} value={farmer.districtName} />
      </dl>
    </section>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}): JSX.Element {
  const t = useT();

  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className={`text-sm ${value ? 'text-stone-900' : 'text-stone-400'}`}>
        {value ?? t('common.notProvided')}
      </dd>
      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}
