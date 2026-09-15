import { useCallback, useEffect, useState } from 'react';
import type { DashboardResponse } from '@kisansetu/shared';
import { api, ApiRequestError } from '../lib/api.js';

/**
 * Dashboard page state (§32).
 *
 * One enum rather than a handful of independent booleans, so impossible
 * combinations (loading *and* error *and* data) cannot be represented at all.
 */
export type DashboardState =
  | { status: 'INITIALIZING' }
  | { status: 'LOADING'; data: DashboardResponse }
  | { status: 'READY'; data: DashboardResponse }
  /** Data is showable, but a refresh failed — keep the page, surface the problem. */
  | { status: 'PARTIAL_ERROR'; data: DashboardResponse; error: unknown }
  | { status: 'ERROR'; error: unknown }
  /** No registration at all; the caller routes onward. */
  | { status: 'NO_REGISTRATION' };

export interface UseFarmerDashboard {
  state: DashboardState;
  reload: () => Promise<void>;
}

export function useFarmerDashboard(): UseFarmerDashboard {
  const [state, setState] = useState<DashboardState>({ status: 'INITIALIZING' });

  const load = useCallback(async (): Promise<void> => {
    // A refresh keeps the current data on screen rather than blanking the page.
    setState((current) =>
      current.status === 'READY' || current.status === 'PARTIAL_ERROR'
        ? { status: 'LOADING', data: current.data }
        : { status: 'INITIALIZING' },
    );

    try {
      const data = await api.get<DashboardResponse>('/api/farmer/dashboard');
      setState({ status: 'READY', data });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setState({ status: 'NO_REGISTRATION' });
        return;
      }

      // A failed reload must not discard a working page (§19). Authentication
      // failure is handled by AuthProvider; this is only about data.
      setState((current) =>
        current.status === 'LOADING'
          ? { status: 'PARTIAL_ERROR', data: current.data, error }
          : { status: 'ERROR', error },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
