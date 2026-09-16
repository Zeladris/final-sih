/**
 * Registers a phone number as a fixed-OTP Supabase test number (via the
 * Supabase Management API) AND creates a matching, already-VERIFIED farmer
 * account — so that number can log into the real web app with OTP 123456,
 * no real SMS needed, landing straight on a working farmer account instead
 * of the registration wizard.
 *
 * Needs a Supabase Personal Access Token: generate one at
 * https://supabase.com/dashboard/account/tokens and put it in .env as
 * SUPABASE_ACCESS_TOKEN (never pasted into chat — this script reads it from
 * your own .env). Without it, this still creates the farmer account, but
 * skips the Test OTP update — you'd add the number by hand in
 * Authentication -> Providers -> Phone -> Test Phone Numbers and OTPs.
 *
 * Run: npx tsx apps/api/src/scripts/addMyPhoneAsFarmer.ts <phone> ["Full Name"]
 * <phone> can be typed as 9876543210, +919876543210, or 919876543210 —
 * whatever's natural; it's normalised the same way the app itself does.
 */
import { env } from '../config/env.js';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ensureAuthUser } from '../services/provisioning/provisioningService.js';

const FIXED_OTP = '123456';

/** Same rule the app's own MobileInput enforces: real Indian mobiles start
 *  6-9. Returns bare digits with country code (no '+'), matching how both
 *  `profiles.phone` and the Test OTP field store numbers. */
function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  if (!national || !/^[6-9]\d{9}$/.test(national)) return null;
  return `91${national}`;
}

async function addTestOtp(phone: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.log(
      '\nSUPABASE_ACCESS_TOKEN not set — skipping the automatic Test OTP update.\n' +
        'Add this pair by hand in Authentication -> Providers -> Phone -> Test Phone Numbers and OTPs:\n' +
        `  ${phone}=${FIXED_OTP}\n`,
    );
    return;
  }

  const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  const base = `https://api.supabase.com/v1/projects/${ref}/config/auth`;

  const current = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  if (!current.ok) {
    throw new Error(`Could not read auth config (HTTP ${current.status}). Check SUPABASE_ACCESS_TOKEN.`);
  }
  const config = (await current.json()) as {
    sms_test_otp?: string | null;
    sms_test_otp_valid_until?: string | null;
  };

  const pairs = (config.sms_test_otp ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean);

  if (pairs.some((pair) => pair.startsWith(`${phone}=`))) {
    console.log(`\n${phone} is already registered as a test OTP number.`);
    return;
  }

  pairs.push(`${phone}=${FIXED_OTP}`);

  const update = await fetch(base, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sms_test_otp: pairs.join(','),
      sms_test_otp_valid_until: config.sms_test_otp_valid_until ?? '2030-01-01T00:00:00Z',
    }),
  });
  if (!update.ok) {
    throw new Error(`Could not update auth config (HTTP ${update.status}): ${await update.text()}`);
  }

  console.log(`\nAdded ${phone}=${FIXED_OTP} to Supabase's Test Phone Numbers and OTPs.`);
}

async function main(): Promise<void> {
  const rawPhone = process.argv[2];
  const fullName = process.argv[3] ?? 'My Test Farmer';
  if (!rawPhone) {
    console.error('Usage: npx tsx apps/api/src/scripts/addMyPhoneAsFarmer.ts <phone> ["Full Name"]');
    process.exitCode = 1;
    return;
  }

  const phone = normalisePhone(rawPhone);
  if (!phone) {
    console.error('That is not a valid Indian mobile number (must start with 6-9, 10 digits).');
    process.exitCode = 1;
    return;
  }

  await addTestOtp(phone);

  const { userId } = await ensureAuthUser(phone);

  const { error: profileError } = await supabaseAdminClient.from('profiles').upsert(
    { id: userId, role: 'FARMER', full_name: fullName, preferred_language: 'en', status: 'ACTIVE' },
    { onConflict: 'id' },
  );
  if (profileError) throw new Error(`profiles upsert failed: ${profileError.message}`);

  const { data: district, error: districtError } = await supabaseAdminClient
    .from('districts')
    .select('id, state_id, name')
    .limit(1)
    .single();
  if (districtError || !district) throw new Error(`No district found: ${districtError?.message}`);

  const now = new Date().toISOString();
  const { data: existing } = await supabaseAdminClient
    .from('farmer_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const farmerRow = {
    user_id: userId,
    date_of_birth: '1990-01-01',
    gender: 'OTHER',
    village: 'Demo Village',
    pincode: '600001',
    state_id: district.state_id,
    district_id: district.id,
    registration_status: 'VERIFIED',
    current_step: 'REVIEW',
    submitted_at: now,
    reviewed_at: now,
    verified_at: now,
  };

  const { error: farmerError } = existing
    ? await supabaseAdminClient.from('farmer_profiles').update(farmerRow).eq('user_id', userId)
    : await supabaseAdminClient.from('farmer_profiles').insert(farmerRow);
  if (farmerError) throw new Error(`farmer_profiles upsert failed: ${farmerError.message}`);

  console.log(`\n+${phone}  ${fullName}  (VERIFIED, district: ${district.name})`);
  console.log(`Log in with ${phone.slice(2)} and OTP ${FIXED_OTP} (if the Test OTP step above ran).`);
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
