import { useEffect, useState } from 'react';
import { useI18n, useT } from '../../../i18n/index.js';
import type { ConnectionState } from '../hooks/useProcurementStatus.js';

/**
 * Connection state and freshness (§16, §26).
 *
 * "Live" is shown only while the realtime channel is actually joined. The
 * freshness line is computed from the server's recorded update time — it is
 * never a client clock pretending to be one.
 */
export function LiveIndicator({
  connection,
  updatedAt,
}: {
  connection: ConnectionState;
  updatedAt: string;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const now = useNow(30_000);

  const dot =
    connection === 'LIVE'
      ? 'bg-harvest-600'
      : connection === 'RECONNECTING'
        ? 'bg-amber-500'
        : 'bg-stone-400';

  const label =
    connection === 'LIVE'
      ? t('liveStatus.live')
      : connection === 'RECONNECTING'
        ? t('liveStatus.reconnecting')
        : t('liveStatus.connecting');

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      {/* Text carries the state; the dot only reinforces it (§14). */}
      <span className="inline-flex items-center gap-1.5 font-medium text-stone-700" role="status">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="text-stone-500">{freshness(updatedAt, now, language, t)}</span>
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function freshness(
  updatedAt: string,
  now: number,
  language: string,
  t: ReturnType<typeof useT>,
): string {
  const seconds = Math.max(0, Math.round((now - new Date(updatedAt).getTime()) / 1000));
  if (seconds < 60) return t('liveStatus.updatedJustNow');

  const rtf = new Intl.RelativeTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
    numeric: 'auto',
  });

  const minutes = Math.round(seconds / 60);
  const when =
    minutes < 60
      ? rtf.format(-minutes, 'minute')
      : minutes < 60 * 24
        ? rtf.format(-Math.round(minutes / 60), 'hour')
        : rtf.format(-Math.round(minutes / (60 * 24)), 'day');

  return t('liveStatus.updatedAgo', { when });
}
