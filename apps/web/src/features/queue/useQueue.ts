import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueView } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';

export type QueueConnection = 'CONNECTING' | 'LIVE' | 'RECONNECTING';

/**
 * The centre's queue, kept current (§38).
 *
 * Staff subscribe to ONE row — their centre's queue_centre_state — which RLS
 * only lets them read for their own centre. Any change to it (a new ranking,
 * a selection, a station going offline) is the signal to refetch the queue
 * from the API, which is authoritative. The event payload itself is not used.
 */
export function useQueue(): {
  queue: QueueView | null;
  error: unknown;
  connection: QueueConnection;
  refresh: () => Promise<void>;
  setQueue: (queue: QueueView) => void;
} {
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [connection, setConnection] = useState<QueueConnection>('CONNECTING');
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // Collapse bursts of events into one request.
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        setQueue(await api.get<QueueView>('/api/staff/me/queue'));
        setError(null);
      } catch (cause) {
        setError(cause);
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const centreId = queue?.centreId ?? null;

  useEffect(() => {
    if (!centreId) return undefined;
    let cancelled = false;
    const channel = supabase.channel(`queue:${centreId}`);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);

      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'queue_centre_state', filter: `centre_id=eq.${centreId}` },
          () => void refresh(),
        )
        .subscribe((state) => {
          if (cancelled) return;
          if (state === 'SUBSCRIBED') {
            setConnection('LIVE');
            void refresh();
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            setConnection('RECONNECTING');
          }
        });
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [centreId, refresh]);

  // While not live, ask directly now and then; waits keep growing regardless.
  useEffect(() => {
    if (connection === 'LIVE') return undefined;
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [connection, refresh]);

  return { queue, error, connection, refresh, setQueue };
}
