import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

/**
 * The browser's Supabase client.
 *
 * It holds the anon key only. Every query it could make is still subject to
 * Row Level Security, so this client is not a way around the API — it is the
 * OTP flow and the session store, nothing more.
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'kisansetu.auth',
  },
});
