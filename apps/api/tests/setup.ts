import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { fixtureTarget } from './fixtures/target.js';

// Tests must never touch a real deployment.
process.env.NODE_ENV = 'test';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Integration tests sign fixture accounts in through the real Supabase OTP
 * flow, which needs three things:
 *
 *   1. SUPABASE_* configured;
 *   2. a fixture target — local Supabase, or a disposable remote project named
 *      in ALLOW_REMOTE_FIXTURES (see fixtures/target.ts);
 *   3. TEST_OTP — the code that target's test numbers accept. It is supplied
 *      by whoever runs the suite and is not hard-coded anywhere in this repo's
 *      code.
 *
 * Without all three the unit suites still run, and the integration suites
 * skip themselves loudly rather than failing with a confusing stack trace.
 */
const target = fixtureTarget(process.env.SUPABASE_URL);
const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const hasTestOtp = Boolean(process.env.TEST_OTP);

export const INTEGRATION_ENABLED = hasSupabase && target.allowed && hasTestOtp;

if (!hasSupabase) {
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ??= 'placeholder-anon-key-for-unit-tests';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service-key-for-unit-tests';
}

if (!INTEGRATION_ENABLED) {
  const why = !hasSupabase
    ? 'SUPABASE_* not configured'
    : !target.allowed
      ? target.reason
      : 'TEST_OTP not set (the code your local test numbers accept)';

  console.warn(
    `\n[tests] integration and RLS suites will SKIP: ${why.replace(/\.$/, '')}.\n` +
      '        Run `supabase start`, `npm run seed:fixtures`, and set TEST_OTP to enable them.\n',
  );
}
