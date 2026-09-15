import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Service-role client (§23.2). BYPASSES Row Level Security.
 *
 * The key behind it must never be sent to a browser, embedded in a VITE_
 * variable, returned by an API, or logged. `config/env.ts` fails startup if
 * it finds the key in any VITE_ variable, and `lib/logger.ts` redacts it.
 *
 * Legitimate uses in Phase 0, and nothing else:
 *   1. Provisioning staff/admin accounts (seed + provision scripts).
 *   2. Writing audit_logs, which has no client-facing policy at all.
 *   3. Recording verification outcomes, which a farmer must not self-assert.
 *
 * If you reach for this client to "make a query work", the answer is almost
 * always a missing RLS policy, not elevated access.
 */
export const supabaseAdminClient: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-kisansetu-client': 'service-role' } },
  },
);
