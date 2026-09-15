import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { FarmerBookingStatus, FarmerProcurementStatus } from '@kisansetu/shared';
import { api } from '../../../lib/api.js';
import { supabase } from '../../../lib/supabase.js';

/**
 * The farmer's live procurement status (Phase 6 §15–§17).
 *
 * Realtime is a SIGNAL, never the source of truth:
 *
 *   1. The status is fetched from the API and rendered.
 *   2. A realtime subscription listens for changes to this one booking row.
 *      Supabase evaluates RLS for the subscriber, so a farmer can only ever
 *      receive their own booking (§10).
 *   3. An event carries the row's `status_version`. Anything not strictly
 *      newer than what is shown is a duplicate or out of order and is dropped.
 *      A newer one triggers a refetch from the API, which is authoritative.
 *   4. On every (re)connection the status is refetched, so a change made while
 *      the connection was down is never missed.
 *
 * While not connected the last known status stays on screen and the page says
 * it is not live. It never claims to be live when it is not (§16).
 */

export type ConnectionState = 'CONNECTING' | 'LIVE' | 'RECONNECTING';

/** While disconnected, the API is asked directly on this interval. */
const FALLBACK_POLL_MS = 30_000;

export interface StatusChange {
  from: FarmerProcurementStatus;
  to: FarmerProcurementStatus;
  at: number;
}

export interface ProcurementStatusState {
  data: FarmerBookingStatus | null;
  error: unknown;
  connection: ConnectionState;
  /** The most recent change observed while this page was open. */
  lastChange: StatusChange | null;
  refresh: () => Promise<void>;
}

export function useProcurementStatus(bookingId: string): ProcurementStatusState {
  const [data, setData] = useState<FarmerBookingStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [connection, setConnection] = useState<ConnectionState>('CONNECTING');
  const [lastChange, setLastChange] = useState<StatusChange | null>(null);

  // Refs, because the realtime callback outlives any single render.
  const versionRef = useRef(0);
  const statusRef = useRef<FarmerProcurementStatus | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await api.get<FarmerBookingStatus>(
        `/api/farmer/bookings/${bookingId}/status`,
      );

      // Two refetches can resolve out of order; never step backwards (§17).
      if (next.version < versionRef.current) return;

      const previous = statusRef.current;
      if (previous !== null && previous !== next.status) {
        setLastChange({ from: previous, to: next.status, at: Date.now() });
      }

      versionRef.current = next.version;
      statusRef.current = next.status;
      setData(next);
      setError(null);
    } catch (cause) {
      // Keep whatever was last shown; the page reports the error alongside it.
      setError(cause);
    }
  }, [bookingId]);

  useEffect(() => {
    let cancelled = false;
    versionRef.current = 0;
    statusRef.current = null;
    setData(null);
    setConnection('CONNECTING');

    void refresh();

    const channel = supabase.channel(`booking-status:${bookingId}`);
    channelRef.current = channel;

    void (async () => {
      // Realtime evaluates RLS with this token; without it the subscription
      // would run as anonymous and receive nothing.
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionData.session) {
        await supabase.realtime.setAuth(sessionData.session.access_token);
      }

      channel
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` },
          (payload) => {
            const row = payload.new as { id?: string; status_version?: number | string };
            // Belt and braces: the filter already scopes this, and RLS scopes
            // the filter. An event for any other row is ignored (§15.1).
            if (row.id !== bookingId) return;

            const version = Number(row.status_version);
            if (!Number.isFinite(version) || version <= versionRef.current) return;

            void refresh();
          },
        )
        .subscribe((state) => {
          if (cancelled) return;

          if (state === 'SUBSCRIBED') {
            setConnection('LIVE');
            // Resynchronise: anything that changed while disconnected (§16).
            void refresh();
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            // realtime-js rejoins on its own with backoff; until then, say so.
            setConnection('RECONNECTING');
          }
        });
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [bookingId, refresh]);

  // Fallback polling, only while realtime is not connected.
  useEffect(() => {
    if (connection === 'LIVE') return undefined;
    const timer = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [connection, refresh]);

  // Phones suspend background tabs and drop sockets. Coming back, or coming
  // back online, is a reason to ask for the truth rather than trust the screen.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = (): void => {
      void refresh();
      // A brief blip may not have dropped the socket at all, in which case no
      // new SUBSCRIBED event will come — report what the channel actually is.
      if (channelRef.current?.state === 'joined') setConnection('LIVE');
    };
    const onOffline = (): void => setConnection('RECONNECTING');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  return { data, error, connection, lastChange, refresh };
}
