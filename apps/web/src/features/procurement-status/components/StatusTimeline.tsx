import type { StatusTimelineStep } from '@kisansetu/shared';
import { useI18n, useT } from '../../../i18n/index.js';

/**
 * The procurement journey (§14).
 *
 * Every step carries a glyph AND a text state, so it reads correctly without
 * colour and to a screen reader. Times come from recorded history only; a step
 * with no recorded time shows none rather than an invented one.
 */
export function StatusTimeline({ steps }: { steps: StatusTimelineStep[] }): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const time = (iso: string): string =>
    new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));

  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const glyph = step.state === 'DONE' ? '✓' : step.state === 'CURRENT' ? '●' : '○';
        const circle =
          step.state === 'DONE'
            ? 'bg-harvest-600 text-white'
            : step.state === 'CURRENT'
              ? 'bg-white text-harvest-700 ring-2 ring-harvest-600'
              : 'bg-stone-100 text-stone-400';

        return (
          <li
            key={step.status}
            className="relative flex gap-3 pb-4 last:pb-0"
            aria-current={step.state === 'CURRENT' ? 'step' : undefined}
          >
            {!last ? (
              <span
                aria-hidden="true"
                className={`absolute left-[0.9rem] top-8 h-[calc(100%-2rem)] w-0.5 ${
                  step.state === 'DONE' ? 'bg-harvest-600' : 'bg-stone-200'
                }`}
              />
            ) : null}

            <span
              aria-hidden="true"
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${circle}`}
            >
              {glyph}
            </span>

            <div className="min-w-0 pt-0.5">
              <p
                className={`text-sm ${
                  step.state === 'CURRENT'
                    ? 'font-semibold text-stone-900'
                    : step.state === 'DONE'
                      ? 'font-medium text-stone-800'
                      : 'text-stone-500'
                }`}
              >
                {t(`status.farmer.${step.status}.label`)}
              </p>
              <p className="text-xs text-stone-500">
                <span className="sr-only">{t(`liveStatus.step.${step.state}`)}. </span>
                {step.reachedAt
                  ? time(step.reachedAt)
                  : step.state === 'CURRENT'
                    ? t('liveStatus.step.CURRENT')
                    : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
