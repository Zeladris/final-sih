/**
 * Where test fixtures are allowed to exist.
 *
 * Fixture accounts sign in with a fixed OTP, which only works on a Supabase
 * instance that has those numbers registered as test numbers. That must never
 * be a real deployment, so fixtures default to LOCAL Supabase only
 * (`supabase start`, whose config.toml carries the test numbers).
 *
 * A disposable remote project can be opted in deliberately by naming its host
 * exactly — `ALLOW_REMOTE_FIXTURES=<project-ref>.supabase.co` — so a stray
 * `.env` can never point the seeder or the integration suites at the wrong
 * project by accident.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal']);

export interface FixtureTarget {
  allowed: boolean;
  host: string;
  reason: string;
}

export function fixtureTarget(supabaseUrl: string | undefined): FixtureTarget {
  if (!supabaseUrl) return { allowed: false, host: '', reason: 'SUPABASE_URL is not set' };

  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    return { allowed: false, host: '', reason: 'SUPABASE_URL is not a valid URL' };
  }

  if (LOCAL_HOSTS.has(host)) return { allowed: true, host, reason: 'local Supabase' };

  const optIn = (process.env.ALLOW_REMOTE_FIXTURES ?? '').trim();
  if (optIn && optIn === host) {
    return { allowed: true, host, reason: 'remote project explicitly allowed by ALLOW_REMOTE_FIXTURES' };
  }

  return {
    allowed: false,
    host,
    reason:
      `${host} is not a local Supabase. Fixtures only run against local Supabase; to use a ` +
      `disposable remote project set ALLOW_REMOTE_FIXTURES=${host}.`,
  };
}
