import { createContext, useContext } from 'react';
import type { RegistrationView } from '@kisansetu/shared';

/**
 * The registration view, loaded once by the flow shell and shared by every
 * step. Each step writes through a mutator that returns the fresh view, so the
 * progress indicator and the submit guard always reflect the server's opinion
 * rather than a locally-guessed one (§21, §22).
 */
export interface RegistrationContextValue {
  view: RegistrationView;
  /** Replaces the cached view after a successful write. */
  apply: (view: RegistrationView) => void;
  /** Re-fetches from the server. */
  reload: () => Promise<void>;
}

export const RegistrationContext = createContext<RegistrationContextValue | null>(null);

export function useRegistration(): RegistrationContextValue {
  const context = useContext(RegistrationContext);
  if (!context) throw new Error('useRegistration must be used inside the registration flow.');
  return context;
}
