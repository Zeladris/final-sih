import { useT } from '../../i18n/index.js';
import type { VoiceBookingState } from './hooks/useVoiceBooking.js';

/**
 * The visible half of the conversation (§6, §34).
 *
 * One tap starts the session (§6); after that, each turn is push-to-talk —
 * the assistant speaks, the mic button lights up once it's done, and the
 * microphone only opens when the farmer taps it (never automatically the
 * instant the prompt finishes). Every control the spec asks for is a real
 * button, not a decoration: Pause and Resume actually stop/restart the
 * recognizer, Repeat replays the last prompt, Stop ends the session outright.
 *
 * This never replaces the visual step below it — it sits above the same
 * crop/quantity/storage inputs the farmer could tap instead (§28).
 */
export function VoiceBookingPanel({ voice }: { voice: VoiceBookingState }): JSX.Element | null {
  const t = useT();

  if (!voice.supported) return null;

  return (
    <section className="card border-2 border-harvest-200 bg-harvest-50/40" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-900">{t('voice.panel.title')}</h2>
        <span aria-hidden="true" className="text-xl">
          🎤
        </span>
      </div>

      {!voice.running ? (
        <button type="button" className="btn-primary mt-3 w-full" onClick={voice.start}>
          {t('voice.panel.start')}
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <StatusBadge voice={voice} />

          {voice.promptText ? (
            <p className="rounded-lg bg-white px-3 py-2 text-sm text-stone-800 shadow-sm">
              {voice.promptText}
            </p>
          ) : null}

          {voice.phase === 'ready' && !voice.paused ? (
            <button
              type="button"
              className="flex w-full animate-pulse items-center justify-center gap-2 rounded-lg bg-harvest-700 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-harvest-800"
              onClick={voice.tapMic}
              aria-label={t('voice.panel.tapMic')}
            >
              <span aria-hidden="true" className="text-xl">
                🎤
              </span>
              {t('voice.panel.yourTurn')}
            </button>
          ) : null}

          {voice.transcript ? (
            <p className="text-sm italic text-stone-600">
              {t('voice.panel.youSaid', { text: voice.transcript })}
            </p>
          ) : null}

          {voice.micDenied ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('voice.panel.micDenied')}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!voice.paused ? (
              <button type="button" className="btn-secondary" onClick={voice.pause}>
                {t('voice.panel.pause')}
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={voice.resume}>
                {t('voice.panel.resume')}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={voice.repeat}>
              {t('voice.panel.repeat')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              onClick={voice.stop}
            >
              {t('voice.panel.stop')}
            </button>
          </div>

          <p className="text-xs text-stone-500">{t('voice.panel.tapInstead')}</p>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ voice }: { voice: VoiceBookingState }): JSX.Element {
  const t = useT();

  if (voice.paused) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-200 px-3 py-1 text-xs font-medium text-stone-700">
        {t('voice.panel.pause')}
      </span>
    );
  }

  const label =
    voice.phase === 'ready'
      ? t('voice.panel.yourTurn')
      : voice.phase === 'listening'
        ? t('voice.panel.listening')
        : voice.phase === 'speaking'
          ? t('voice.panel.speaking')
          : voice.phase === 'thinking'
            ? t('voice.panel.thinking')
            : null;

  if (!label) return <></>;

  const pulse =
    voice.phase === 'listening'
      ? 'animate-pulse bg-red-500'
      : voice.phase === 'ready'
        ? 'animate-pulse bg-harvest-600'
        : 'bg-harvest-600';

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-700 shadow-sm">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${pulse}`} />
      {label}
    </span>
  );
}
