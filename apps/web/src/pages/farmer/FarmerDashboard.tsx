import { Navigate } from 'react-router-dom';
import { primaryActionFor } from '@kisansetu/shared';
import type { DashboardResponse } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';
import { useFarmerDashboard } from '../../hooks/useFarmerDashboard.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { WelcomeCard } from '../../components/farmer/WelcomeCard.js';
import { VerificationStatusCard } from '../../components/farmer/VerificationStatusCard.js';
import { PrimaryActionCard } from '../../components/farmer/PrimaryActionCard.js';
import { ProcurementSummaryCard } from '../../components/farmer/ProcurementSummaryCard.js';
import { NotificationSummaryCard } from '../../components/farmer/NotificationSummaryCard.js';
import { FarmerProfileSummary } from '../../components/farmer/FarmerProfileSummary.js';
import { ErrorPanel } from '../../components/AppShell.js';

/**
 * The farmer dashboard (§6).
 *
 * The landing page for every farmer who has a registration, whatever its
 * state — the verification card and the primary action adapt rather than the
 * page changing identity. Only an unfinished registration routes away, since
 * that is the one case with nothing useful to show.
 *
 * It answers, in order: who am I, is my account verified, do I need to do
 * anything, do I have a booking, do I have a message (§22).
 */
export function FarmerDashboard(): JSX.Element {
  const t = useT();
  const { state, reload } = useFarmerDashboard();

  if (state.status === 'NO_REGISTRATION') {
    return <Navigate to="/farmer/registration/start" replace />;
  }

  if (state.status === 'INITIALIZING') {
    return <DashboardSkeleton />;
  }

  if (state.status === 'ERROR') {
    return (
      <div className="min-h-screen bg-cream-100">
        <FarmerHeader />
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          <ErrorPanel error={state.error} />
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            {t('common.retry')}
          </button>
        </main>
      </div>
    );
  }

  const data: DashboardResponse = state.data;

  // An unfinished registration belongs in the flow, not here.
  if (data.verification.state === 'REGISTRATION_INCOMPLETE') {
    return <Navigate to="/farmer/welcome" replace />;
  }

  const action = primaryActionFor(data.verification.state, data.bookingSummary);
  const verified = data.verification.state === 'VERIFIED';

  return (
    <div className="min-h-screen bg-cream-100">
      <FarmerHeader unreadCount={data.notificationSummary.unreadCount} />

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {/* A failed refresh keeps the page and explains itself rather than
            replacing everything with an error (§19). */}
        {state.status === 'PARTIAL_ERROR' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-900">{t('dashboard.refreshFailed')}</p>
            <button
              type="button"
              className="btn-secondary mt-2"
              onClick={() => void reload()}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        <WelcomeCard farmer={data.farmer} />

        <div className="grid gap-4 md:grid-cols-5 md:items-start">
          <div className="space-y-4 md:col-span-2">
            <VerificationStatusCard verification={data.verification} />
            <ProcurementSummaryCard summary={data.bookingSummary} eligible={verified} />
          </div>
          <div className="space-y-4 md:col-span-3">
            <PrimaryActionCard action={action} />
            <NotificationSummaryCard summary={data.notificationSummary} />
          </div>
        </div>

        <FarmerProfileSummary farmer={data.farmer} />
      </main>
    </div>
  );
}

/**
 * Section-shaped placeholders rather than a blank page or a bare spinner, so
 * the farmer can see the dashboard arriving (§18).
 */
function DashboardSkeleton(): JSX.Element {
  const t = useT();

  return (
    <div className="min-h-screen bg-cream-100">
      <FarmerHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" aria-busy="true">
        <span className="sr-only" role="status">
          {t('common.loading')}
        </span>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card animate-pulse">
            <div className="h-4 w-1/3 rounded bg-stone-200" />
            <div className="mt-3 h-3 w-2/3 rounded bg-stone-100" />
            <div className="mt-2 h-3 w-1/2 rounded bg-stone-100" />
          </div>
        ))}
      </main>
    </div>
  );
}
