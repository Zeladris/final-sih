import { useCallback, useEffect, useState } from 'react';
import type { StaffDashboardResponse } from '@kisansetu/shared';
import { api } from '../lib/api.js';

/** No realtime channel covers this whole-dashboard summary, so — same
 *  fallback as the farmer-facing status page and the staff "Today" list —
 *  refetch periodically and whenever the tab comes back into view, rather
 *  than showing a single-load snapshot for the rest of the shift. */
const REFRESH_MS = 15_000;

/** Staff dashboard page state (§49). Same explicit model as the farmer side. */
export type StaffDashboardState =
  | { status: 'INITIALIZING' }
  | { status: 'LOADING'; data: StaffDashboardResponse }
  | { status: 'READY'; data: StaffDashboardResponse }
  | { status: 'PARTIAL_ERROR'; data: StaffDashboardResponse; error: unknown }
  | { status: 'ERROR'; error: unknown };

export function useStaffDashboard(): {
  state: StaffDashboardState;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<StaffDashboardState>({ status: 'INITIALIZING' });

  const load = useCallback(async (): Promise<void> => {
    setState((current) =>
      current.status === 'READY' || current.status === 'PARTIAL_ERROR'
        ? { status: 'LOADING', data: current.data }
        : { status: 'INITIALIZING' },
    );

    try {
      const data = await api.get<StaffDashboardResponse>('/api/staff/me/dashboard');
      setState({ status: 'READY', data });
    } catch (error) {
      // A failed refresh keeps the queue on screen; losing it mid-shift would
      // be worse than showing slightly stale counts (§32).
      setState((current) =>
        current.status === 'LOADING'
          ? { status: 'PARTIAL_ERROR', data: current.data, error }
          : { status: 'ERROR', error },
      );
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { state, reload: load };
}
