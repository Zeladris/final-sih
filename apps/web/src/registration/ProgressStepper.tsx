import { Link } from 'react-router-dom';
import { STEP_PATH, STEP_SEQUENCE, stepIndex } from '@kisansetu/shared';
import type { RegistrationStep } from '@kisansetu/shared';
import { useT } from '../i18n/index.js';

/**
 * Progress indicator (§22).
 *
 * Shows complete / current / upcoming without ever printing a technical state
 * name — each step renders through an i18n key. Completed steps are links so a
 * farmer can go back and correct something; upcoming ones are not, because
 * skipping ahead past required information helps nobody.
 */
export function ProgressStepper({
  currentStep,
  completedSteps,
  photoRequired,
}: {
  currentStep: RegistrationStep;
  completedSteps: readonly RegistrationStep[];
  photoRequired: boolean;
}): JSX.Element {
  const t = useT();

  const steps = STEP_SEQUENCE.filter((step) => photoRequired || step !== 'PHOTO');
  const currentIndex = stepIndex(currentStep);

  return (
    <nav aria-label={t('registration.progressLabel')} className="mb-6">
      <ol className="flex flex-wrap gap-x-1 gap-y-2">
        {steps.map((step) => {
          const done = completedSteps.includes(step);
          const current = step === currentStep;
          // Anything at or before the current step is reachable; so is anything
          // already satisfied.
          const reachable = done || stepIndex(step) <= currentIndex;

          const label = t(`registration.step.${step}`);
          const content = (
            <span
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                current
                  ? 'bg-harvest-700 font-semibold text-white'
                  : done
                    ? 'bg-harvest-50 text-harvest-800 hover:bg-harvest-100'
                    : 'text-stone-500'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  current
                    ? 'bg-white text-harvest-700'
                    : done
                      ? 'bg-harvest-600 text-white'
                      : 'border border-stone-300 text-stone-400'
                }`}
              >
                {done && !current ? '✓' : ''}
              </span>
              {label}
            </span>
          );

          return (
            <li key={step} aria-current={current ? 'step' : undefined}>
              {/* Status is conveyed by text too, not colour alone (§36). */}
              <span className="sr-only">
                {label}: {done ? '✓' : current ? '●' : '○'}
              </span>
              {reachable && !current ? (
                <Link to={`/farmer/registration/${STEP_PATH[step]}`}>{content}</Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
