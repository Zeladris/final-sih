/**
 * Adds a handful of standalone, already-VERIFIED farmer accounts for
 * demoing the booking flow — separate from the generated demo dataset in
 * demoData/ (which drives a whole districts/centres/staff storyline this
 * doesn't need to touch).
 *
 * Phone numbers must pass the app's own validation (apps/web/.../auth/
 * phone.ts): `+91` followed by a digit 6-9, then 9 more digits — real
 * Indian mobile numbers never start with 1-5. (An earlier version of this
 * script picked +911234500001-3, which fails that check outright.)
 *
 * IMPORTANT: this only writes the database rows. Logging into the web app
 * still goes through real Supabase Auth phone OTP — creating the auth user
 * here does not bypass that. To actually sign in with these numbers without
 * a real SMS, add them as "Test phone numbers" (with a fixed OTP) in the
 * Supabase Dashboard: Authentication -> Sign In / Providers -> Phone.
 *
 * Run with: npx tsx apps/api/src/scripts/addDemoFarmers.ts
 */
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ensureAuthUser } from '../services/provisioning/provisioningService.js';

const OLD_INVALID_PHONES = ['911234500001', '911234500002', '911234500003'];

const FARMERS = [
  { phone: '919876500001', fullName: 'Demo Farmer One', village: 'Demo Village' },
  { phone: '919876500002', fullName: 'Demo Farmer Two', village: 'Demo Village' },
  { phone: '919876500003', fullName: 'Demo Farmer Three', village: 'Demo Village' },
];

async function removeInvalidAccounts(): Promise<void> {
  for (const phone of OLD_INVALID_PHONES) {
    const { data } = await supabaseAdminClient.auth.admin.listUsers();
    const user = data.users.find((candidate) => candidate.phone === phone);
    if (!user) continue;
    await supabaseAdminClient.auth.admin.deleteUser(user.id);
    console.log(`  removed invalid demo account +${phone}`);
  }
}

async function main(): Promise<void> {
  await removeInvalidAccounts();

  const { data: district, error: districtError } = await supabaseAdminClient
    .from('districts')
    .select('id, name, state_id')
    .limit(1)
    .single();
  if (districtError || !district) {
    throw new Error(`No district found to attach these farmers to: ${districtError?.message}`);
  }

  console.log(`\nAttaching to district: ${district.name}\n`);

  for (const farmer of FARMERS) {
    const { userId } = await ensureAuthUser(farmer.phone);

    const { error: profileError } = await supabaseAdminClient.from('profiles').upsert(
      { id: userId, role: 'FARMER', full_name: farmer.fullName, preferred_language: 'en', status: 'ACTIVE' },
      { onConflict: 'id' },
    );
    if (profileError) throw new Error(`profiles upsert failed for ${farmer.phone}: ${profileError.message}`);

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
      village: farmer.village,
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
    if (farmerError) throw new Error(`farmer_profiles upsert failed for ${farmer.phone}: ${farmerError.message}`);

    console.log(`  +${farmer.phone}  ${farmer.fullName}  (VERIFIED)`);
  }

  console.log(
    '\nDone. To actually log into the web app with these numbers, add them as Test phone ' +
      'numbers (with a fixed OTP) in the Supabase Dashboard: Authentication -> Sign In / ' +
      'Providers -> Phone. Otherwise these numbers need a real SMS to receive a real OTP.',
  );
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
