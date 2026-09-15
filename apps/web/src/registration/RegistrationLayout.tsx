import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { STEP_BY_PATH, STEP_PATH, isEditable } from '@kisansetu/shared';
import type { RegistrationStep, RegistrationView } from '@kisansetu/shared';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useAdoptProfileLanguage, useT } from '../i18n/index.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';
import { FullPageSpinner } from '../components/Spinner.js';
import { ErrorPanel } from '../components/AppShell.js';
import { ProgressStepper } from './ProgressStepper.js';
import { RegistrationContext } from './useRegistration.js';

/** The one route valid before a registration exists. */
const START_PATH = '/farmer/registration/start';

/**
 * The registration flow shell (§6, §21).
 *
 * Loads the whole registration once and shares it with every step, so a page
 * refresh, a re-login or a direct URL all land on a correctly-populated screen
 * rather than an empty form. It also persists the resume position each time the
 * step changes, which is what makes "come back tomorrow" work.
 */
export function RegistrationLayout(): JSX.Element {
  const { session, loading: authLoading, needsOnboarding, refreshProfile } = useAuth();
  const t = useT();
  const location = useLocation();

  const [view, setView] = useState<RegistrationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useAdoptProfileLanguage(view?.profile.preferredLanguage);

  const load = useCallback(async (): Promise<void> => {
    try {
      setView(await api.get<RegistrationView>('/api/farmer/registration'));
      setError(null);
    } catch (cause) {
      // 404 is not an error here: it means "no registration yet", which the
      // start screen handles.
      if (cause instanceof ApiRequestError && cause.status === 404) {
        setView(null);
        setError(null);
        return;
      }
      setError(cause);
    }
  }, []);

  useEffect(() => {
    // Without clearing `loading` here, a signed-out visitor would sit on the
    // spinner forever: the loading branch below returns before the redirect.
    if (!session) {
      setLoading(false);
      return;
    }

    // `needsOnboarding` is in the dependency list on purpose. It flips false
    // the moment the start screen creates the registration, and that is what
    // re-runs this fetch so the freshly-created view is available to the first
    // real step.
    //
    // Raising `loading` for the refetch matters: without it the render below
    // briefly sees a null view on a non-start path and bounces the farmer to
    // the start screen and back again.
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [session, needsOnboarding, load]);

  const currentStep: RegistrationStep | null = useMemo(() => {
    const segment = location.pathname.split('/').filter(Boolean).pop() ?? '';
    return STEP_BY_PATH[segment] ?? null;
  }, [location.pathname]);

  const atStart = location.pathname === START_PATH;

  // Persist the resume marker whenever the farmer moves between steps.
  useEffect(() => {
    if (!view || !currentStep || !view.editable) return;
    if (view.farmer.currentStep === currentStep) return;

    void api.put('/api/farmer/registration/step', { currentStep }).catch(() => undefined);
  }, [currentStep, view]);

  const apply = useCallback((next: RegistrationView): void => {
    setView(next);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    await load();
    await refreshProfile();
  }, [load, refreshProfile]);

  const contextValue = useMemo(
    () => (view ? { view, apply, reload } : null),
    [view, apply, reload],
  );

  if (authLoading || loading) return <FullPageSpinner label={t('common.loading')} />;
  if (!session) return <Navigate to="/" replace />;

  // Checked before the `!view` branch below: a failed load also leaves `view`
  // null, and silently redirecting to the start screen would hide the error
  // and look like the flow had reset itself.
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <ErrorPanel error={error} />
        <button type="button" className="btn-secondary mt-4" onClick={() => void reload()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  // No registration yet — the start screen is the only valid place to be.
  // Note this must NOT redirect when already there: navigating a route to
  // itself re-renders into the same branch and loops forever.
  if (!view) {
    return atStart ? <Outlet /> : <Navigate to={START_PATH} replace />;
  }

  // A registration exists, so the start screen no longer applies. This is the
  // step immediately after the start screen creates one, and without it the
  // farmer is bounced back to "let's get started" and a duplicate submit.
  if (atStart) {
    return <Navigate to={`/farmer/registration/${STEP_PATH[view.farmer.currentStep]}`} replace />;
  }

  // A submitted registration is read-only; the status screen is the right place
  // for it, not a form (§19).
  if (!isEditable(view.farmer.registrationStatus) && currentStep !== null) {
    return <Navigate to="/farmer/status" replace />;
  }

  const photoRequired = view.requirements.some(
    (requirement) => requirement.documentKind === 'FARMER_PHOTO' && requirement.isRequired,
  );

  return (
    <RegistrationContext.Provider value={contextValue}>
      <div className="min-h-screen bg-stone-50">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-harvest-700">
                {t('app.name')}
              </p>
              <h1 className="text-lg font-semibold text-stone-900">{t('registration.title')}</h1>
            </div>
            <LanguageSwitcher compact />
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-6">
          {currentStep ? (
            <ProgressStepper
              currentStep={currentStep}
              completedSteps={view.completedSteps}
              photoRequired={photoRequired}
            />
          ) : null}

          <Outlet />

          <p className="mt-6 text-center text-xs text-stone-400">
            {t('registration.savedAt', {
              time: new Date(view.farmer.lastSavedAt).toLocaleTimeString(),
            })}
          </p>
        </main>
      </div>
    </RegistrationContext.Provider>
  );
}

/** Shared next/back controls so every step navigates identically. */
export function StepNavigation({
  onBack,
  submitLabel,
  busy,
  disabled,
}: {
  onBack?: string;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
}): JSX.Element {
  const t = useT();
  const navigate = useNavigate();

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {onBack ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate(`/farmer/registration/${STEP_PATH[onBack as RegistrationStep]}`)}
        >
          {t('common.back')}
        </button>
      ) : null}

      <button type="submit" className="btn-primary flex-1" disabled={busy || disabled}>
        {busy ? t('common.saving') : submitLabel}
      </button>
    </div>
  );
}
