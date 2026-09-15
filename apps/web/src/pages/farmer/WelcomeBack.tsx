import { Navigate, useNavigate } from 'react-router-dom';
import { FARMER_ACCOUNT_DESTINATION, STEP_PATH } from '@kisansetu/shared';
import type { RegistrationStep } from '@kisansetu/shared';
import { useAuth } from '../../auth/AuthProvider.js';
import { useT } from '../../i18n/index.js';
import { FullPageSpinner } from '../../components/Spinner.js';
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js';

/**
 * The resume screen a returning farmer sees when they left registration
 * unfinished (§12).
 *
 * It exists so "log back in" does not dump somebody into the middle of a form
 * with no explanation. It shows what is already saved and what is left, then
 * takes them to exactly the step the server says to resume at — never back to
 * the beginning.
 *
 * Completed and remaining come from `account`, which the server derived; the
 * client does not recompute them.
 */
export function WelcomeBack(): JSX.Element {
  const { account, profile, loading, signOut } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  if (loading) return <FullPageSpinner label={t('common.loading')} />;

  // Only meaningful mid-registration; any other state has its own screen.
  if (!account) return <Navigate to="/" replace />;
  if (account.state !== 'REGISTRATION_INCOMPLETE' && account.state !== 'ACTION_REQUIRED') {
    return <Navigate to={FARMER_ACCOUNT_DESTINATION[account.state]} replace />;
  }

  const resumePath = account.resumeStep
    ? `/farmer/registration/${STEP_PATH[account.resumeStep]}`
    : '/farmer/registration/review';

  const nothingLeft = account.remainingSteps.length === 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher compact />
        </div>

        <div className="card">
          <h1 className="text-2xl font-semibold text-stone-900">
            {t('welcome.title')}
            {profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}
          </h1>

          <p className="mt-2 text-sm text-stone-600">
            {account.state === 'ACTION_REQUIRED'
              ? t('welcome.actionRequired')
              : t('welcome.incomplete')}
          </p>

          {account.completedSteps.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {t('welcome.completed')}
              </h2>
              <ul className="mt-2 space-y-1.5">
                {account.completedSteps
                  .filter((step) => step !== 'REVIEW')
                  .map((step) => (
                    <StepRow key={step} step={step} done />
                  ))}
              </ul>
            </section>
          ) : null}

          {!nothingLeft ? (
            <section className="mt-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {t('welcome.remaining')}
              </h2>
              <ul className="mt-2 space-y-1.5">
                {account.remainingSteps.map((step) => (
                  <StepRow key={step} step={step} done={false} />
                ))}
              </ul>
            </section>
          ) : null}

          <p className="mt-5 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {t('welcome.savedNote')}
          </p>

          <button
            type="button"
            className="btn-primary mt-5"
            onClick={() => navigate(nothingLeft ? '/farmer/registration/review' : resumePath)}
          >
            {nothingLeft ? t('welcome.reviewAndSubmit') : t('welcome.continue')}
          </button>

          <button
            type="button"
            className="btn-secondary mt-3 w-full"
            onClick={() => void signOut()}
          >
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, done }: { step: RegistrationStep; done: boolean }): JSX.Element {
  const t = useT();

  return (
    <li className="flex items-center gap-2.5 text-sm">
      {/* Status is carried by the glyph and the text, not by colour alone (§27). */}
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          done ? 'bg-harvest-600 text-white' : 'border border-stone-300 text-stone-400'
        }`}
      >
        {done ? '✓' : '○'}
      </span>
      <span className={done ? 'text-stone-900' : 'text-stone-600'}>
        {t(`registration.step.${step}`)}
      </span>
      <span className="sr-only">
        {done ? t('welcome.completed') : t('welcome.remaining')}
      </span>
    </li>
  );
}
