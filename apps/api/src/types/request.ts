import type { AccessScope, Language, ProfileStatus, Role } from '@kisansetu/shared';
import type { UserClient } from '../lib/supabase.js';

/**
 * The trusted request context (§25).
 *
 * Everything here is derived from the verified Supabase access token plus
 * server-side database rows. Nothing here ever comes from a request body,
 * query string or header other than `Authorization`.
 */
export interface AuthContext {
  userId: string;
  /** Verified phone from the Supabase identity, not from the client. */
  phone: string | null;
  role: Role;
  status: ProfileStatus;
  fullName: string | null;
  preferredLanguage: Language;
  scope: AccessScope;
  /** Supabase client bound to this user's token, so queries run under RLS. */
  db: UserClient;
}

/**
 * A caller who holds a valid Supabase session but has no application profile
 * yet — a farmer mid-onboarding. Only the onboarding endpoints accept this.
 */
export interface PendingAuthContext {
  userId: string;
  phone: string | null;
  db: UserClient;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** Present after requireAuth(). */
      auth?: AuthContext;
      /** Present after requireSession(); the superset that includes un-onboarded users. */
      session?: PendingAuthContext;
    }
  }
}

export {};
