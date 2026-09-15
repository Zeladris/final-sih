import type { DashboardFarmer } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';

/**
 * Greeting and location context (§8).
 *
 * Uses the farmer's real name, and shows only location parts that actually
 * exist — no invented village, district or state, and no "N/A" filler (§20).
 */
export function WelcomeCard({ farmer }: { farmer: DashboardFarmer }): JSX.Element {
  const t = useT();

  // Just the given name: "Welcome, Ramesh" reads better than the full legal name.
  const firstName = farmer.name?.trim().split(/\s+/)[0] ?? null;

  const place = [farmer.village, farmer.districtName, farmer.stateName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' • ');

  return (
    <section className="card">
      <h1 className="text-2xl font-semibold text-stone-900">
        {firstName ? t('dashboard.welcomeNamed', { name: firstName }) : t('dashboard.welcome')}
      </h1>

      {place ? <p className="mt-1 text-sm text-stone-600">{place}</p> : null}

      <p className="mt-2 font-mono text-xs text-stone-500">
        {t('dashboard.farmerId')} {farmer.farmerReferenceId}
      </p>
    </section>
  );
}
