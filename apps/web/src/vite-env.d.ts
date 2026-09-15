/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL?: string;
  // NOTE: there is deliberately no VITE_SUPABASE_SERVICE_ROLE_KEY. The
  // service-role key must never be compiled into the browser bundle (§31).
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.json' {
  const value: Record<string, string>;
  export default value;
}
