import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export type UserClient = SupabaseClient;

/**
 * A Supabase client bound to ONE end user's access token (§23.1).
 *
 * Every query it makes runs as that user, so Row Level Security applies.
 * This is the client the request path uses for user-owned data — it is what
 * makes RLS a real second layer rather than decoration.
 *
 * Sessions are not persisted or auto-refreshed: the token lives for exactly
 * the length of one HTTP request.
 */
export function createUserClient(accessToken: string): UserClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * An anon-key client with no user attached. Used only to validate a bearer
 * token via auth.getUser(token) before a user client is built.
 */
export const supabaseAnonClient: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
