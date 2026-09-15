import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Signs a fixture account in through the REAL Supabase OTP flow.
 *
 * The code is whatever the local Supabase test numbers accept
 * (supabase/config.toml), passed in as TEST_OTP by whoever runs the suite.
 * There is no default: tests/setup.ts skips the integration suites without it,
 * so no OTP value is baked into code anywhere.
 */
function testOtp(): string {
  const code = process.env.TEST_OTP;
  if (!code) throw new Error('TEST_OTP is not set; integration suites should have been skipped.');
  return code;
}

export interface TestSession {
  userId: string;
  accessToken: string;
  client: SupabaseClient;
}

function anonClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function signInWithOtp(phone: string): Promise<TestSession> {
  const client = anonClient();

  const sent = await client.auth.signInWithOtp({ phone });
  if (sent.error) {
    throw new Error(`Could not send OTP to ${phone}: ${sent.error.message}`);
  }

  const verified = await client.auth.verifyOtp({ phone, token: testOtp(), type: 'sms' });
  if (verified.error || !verified.data.session) {
    throw new Error(`Could not verify OTP for ${phone}: ${verified.error?.message}`);
  }

  return {
    userId: verified.data.session.user.id,
    accessToken: verified.data.session.access_token,
    client,
  };
}

/** A client bound to a signed-in user's token, for testing RLS without Express. */
export function userScopedClient(accessToken: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Fixture accounts (tests/fixtures/accounts.ts), split by which suite owns them.
 *
 * Suites that MUTATE a farmer's registration take a farmer of their own and
 * hard-reset it in beforeAll, so no suite depends on the order the files run in.
 */
export const FIXTURE = {
  /** authorization.test.ts */
  farmerA: '+919000000001',
  farmerB: '+919000000002',
  /** registrationFlow.test.ts */
  farmerC: '+919000000003',
  /** rls.test.ts state-machine walk — ends VERIFIED, which is terminal. */
  farmerD: '+919000000004',
  farmerE: '+919000000005',
  staffCentreA: '+919000000011',
  staffCentreB: '+919000000012',
  districtAdminThanjavur: '+919000000021',
  districtAdminTrichy: '+919000000022',
  stateAdmin: '+919000000031',
} as const;
