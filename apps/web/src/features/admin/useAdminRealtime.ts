import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase.js';

/**
 * Scoped live refresh (§33, §34).
 *
 * Subscribes to centre_activity_signals — one counter per centre, bumped by
 * material events (arrival, queue movement, procurement, payment, session).
 * Row-level security delivers only centres inside this admin's district or
 * state; there is no global stream. The payload carries nothing but "centre X
 * changed": the dashboard re-asks the API, which remains the source of truth.
 *
 * Bursts are collapsed (a busy centre can emit several events a second), and
 * a slow periodic refresh covers anything realtime misses.
 */
export function useAdminRealtime(onChange: () => void, options: { debounceMs?: number; fallbackMs?: number } = {}): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  const debounceMs = options.debounceMs ?? 3000;
  const fallbackMs = options.fallbackMs ?? 60_000;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const schedule = (): void => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (!cancelled) callback.current();
      }, debounceMs);
    };

    const channel = supabase.channel('admin-activity');
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'centre_activity_signals' }, schedule).subscribe();
    })();

    const fallback = window.setInterval(() => callback.current(), fallbackMs);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [debounceMs, fallbackMs]);
}
