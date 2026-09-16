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
    <section className="relative overflow-hidden rounded-2xl bg-harvest-900 p-6 shadow-sm sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-harvest-700/60"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 -right-14 h-44 w-44 rounded-full border border-harvest-700/60"
      />

      <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
        {t('app.name')}
      </p>

      <h1 className="relative mt-2 text-2xl font-semibold text-cream-50 sm:text-3xl">
        {firstName ? t('dashboard.welcomeNamed', { name: firstName }) : t('dashboard.welcome')}
      </h1>

      {place ? <p className="relative mt-1 text-sm text-harvest-200">{place}</p> : null}

      <p className="relative mt-4 text-xs text-harvest-200">
        {t('dashboard.farmerId')} {farmer.farmerReferenceId}
      </p>
    </section>
  );
}
