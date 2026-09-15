import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase.js';

/**
 * Live updates on the caller's own notifications (§20).
 *
 * Filtered to `user_id=eq.<userId>` — combined with RLS's own
 * `notifications_select_own` policy, a client can never subscribe to
 * anyone else's row even if this filter were somehow bypassed client-side.
 *
 * Realtime is an enhancement, never the source of truth (§42): `onInsert`
 * just triggers a normal refetch through the existing API, so a dropped
 * connection degrades to "not live until the next fetch," not to stale data
 * the farmer has no way to refresh.
 */
export function useNotificationRealtime(userId: string | null, onChange: () => void): void {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => onChange(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // Deliberately not depending on `onChange`: a fresh closure each render
    // must not tear down and resubscribe the channel every render.
  }, [userId]);
}
