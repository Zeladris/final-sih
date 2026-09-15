/**
 * Browser configuration.
 *
 * Only public values belong here. VITE_ variables are compiled into the bundle
 * and served to every visitor, so the service-role key must never appear — the
 * API validates this at startup and vite.config.ts fails the build if it finds
 * one (§31).
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env at the repository root and fill it in.`,
    );
  }
  return value;
}

export const config = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
} as const;

/** Mirrors MAX_UPLOAD_BYTES on the server; used only for the client-side hint. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
