import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { coerceLanguage } from '@kisansetu/shared';
import type {
  AccessScope,
  AuthenticatedUser,
  FarmerAccountSummary,
  Language,
  Role,
} from '@kisansetu/shared';
import { supabase } from '../lib/supabase.js';
import { api, ApiRequestError } from '../lib/api.js';
import { classifySendError, classifyVerifyError } from '../lib/authErrors.js';

interface SessionStateResponse {
  authenticated: boolean;
  onboarded: boolean;
  user: {
    id: string;
    role?: Role;
    name?: string | null;
    phone?: string | null;
    status?: string;
    preferredLanguage?: Language;
  };
  scope: AccessScope | null;
  account: FarmerAccountSummary | null;
}

export interface AuthState {
  /** Supabase identity: proves the phone, says nothing about the role. */
  user: User | null;
  session: Session | null;
  /** Application identity, as decided by the server. Null until onboarded. */
  profile: AuthenticatedUser | null;
  role: Role | null;
  scope: AccessScope | null;
  /** Farmer registration/verification state, for post-login routing (§14). */
  account: FarmerAccountSummary | null;
  /** True while the initial session restore or a profile fetch is in flight. */
  loading: boolean;
  /** Authenticated with Supabase but no application profile yet. */
  needsOnboarding: boolean;
  /**
   * Authenticated and a profile exists, but the server says it cannot be used
   * (inactive, no valid role, or no active assignment). Nothing is guessed.
   */
  accountNotConfigured: boolean;
  /** The session is valid but the account could not be loaded (e.g. offline). */
  profileLoadFailed: boolean;
  /** Set when a session was rejected, so login can explain why (§16). */
  sessionExpired: boolean;
  signInWithOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The single source of auth state for the whole app (§20).
 *
 * Note what it does NOT do: decide anything. Role, scope and account state are
 * whatever `GET /api/auth/session` says they are. Editing this state in
 * devtools changes which buttons render and nothing else — every API call is
 * re-checked server-side and again by RLS.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthenticatedUser | null>(null);
  const [scope, setScope] = useState<AccessScope | null>(null);
  const [account, setAccount] = useState<FarmerAccountSummary | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [accountNotConfigured, setAccountNotConfigured] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  // Guards against a stale response from a previous session overwriting a
  // newer one when the user signs out and back in quickly.
  const fetchToken = useRef(0);

  const clearApplicationState = useCallback((): void => {
    setProfile(null);
    setScope(null);
    setAccount(null);
    setNeedsOnboarding(false);
    setAccountNotConfigured(false);
    setProfileLoadFailed(false);
  }, []);

  const loadProfile = useCallback(
    async (activeSession: Session | null): Promise<void> => {
      const token = ++fetchToken.current;

      if (!activeSession) {
        clearApplicationState();
        return;
      }

      try {
        const state = await api.get<SessionStateResponse>('/api/auth/session');
        if (token !== fetchToken.current) return;

        setSessionExpired(false);

        if (state.onboarded && state.user.role) {
          setProfile({
            id: state.user.id,
            role: state.user.role,
            name: state.user.name ?? null,
            phone: state.user.phone ?? null,
            status: (state.user.status as AuthenticatedUser['status']) ?? 'ACTIVE',
            preferredLanguage: coerceLanguage(state.user.preferredLanguage),
          });
          setScope(state.scope);
          setAccount(state.account);
          setNeedsOnboarding(false);
          setAccountNotConfigured(false);
          setProfileLoadFailed(false);
        } else {
          clearApplicationState();
          setNeedsOnboarding(true);
        }
      } catch (error) {
        if (token !== fetchToken.current) return;

        // A rejected session means the token is no longer good. Clear it and
        // flag it, so the login screen can say why rather than appearing to
        // have logged the farmer out for no reason (§16).
        if (error instanceof ApiRequestError && error.status === 401) {
          setSessionExpired(true);
          await supabase.auth.signOut();
          clearApplicationState();
          return;
        }

        clearApplicationState();

        // The session is fine but the account is unusable. Keep the session
        // so the screen survives a reload and the user can sign out from it.
        if (error instanceof ApiRequestError && error.code === 'ACCOUNT_NOT_CONFIGURED') {
          setAccountNotConfigured(true);
          return;
        }

        setProfileLoadFailed(true);
      }
    },
    [clearApplicationState],
  );

  useEffect(() => {
    let cancelled = false;

    // Session restoration on load (§15).
    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (!cancelled) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      // TOKEN_REFRESHED fires on a timer; refetching the profile each time
      // would be pointless traffic.
      if (event === 'TOKEN_REFRESHED') return;

      setLoading(true);
      void loadProfile(nextSession).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithOtp = useCallback(async (phone: string): Promise<void> => {
    // Supabase Auth sends and verifies the OTP. Our API never sees the code,
    // and there is no second authentication system (§7, §22).
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw classifySendError(error);
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string): Promise<void> => {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw classifyVerifyError(error);

    setSessionExpired(false);

    // Nothing about a role is sent or checked here. The SIGNED_IN event
    // (handled in the effect above) reloads /api/auth/session, and the
    // server's answer decides where the user goes.

    // Record the sign-in for the audit trail. Best effort: a failed audit
    // write must not block a successful login.
    void api.post('/api/auth/events/signed-in', {}).catch(() => undefined);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    clearApplicationState();
    setSessionExpired(false);
  }, [clearApplicationState]);

  const refreshProfile = useCallback(async (): Promise<void> => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      role: profile?.role ?? null,
      scope,
      account,
      loading,
      needsOnboarding,
      accountNotConfigured,
      profileLoadFailed,
      sessionExpired,
      signInWithOtp,
      verifyOtp,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      scope,
      account,
      loading,
      needsOnboarding,
      accountNotConfigured,
      profileLoadFailed,
      sessionExpired,
      signInWithOtp,
      verifyOtp,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
