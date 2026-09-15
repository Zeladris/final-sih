import { supabaseAdminClient } from '../../src/lib/supabaseAdmin.js';
import { FIXTURE_FARMER_DETAILS } from '../fixtures/accounts.js';

/**
 * Returns a fixture farmer to a clean DRAFT registration.
 *
 * This DELETES and recreates the farmer_profiles row rather than updating the
 * status, and that is deliberate: VERIFIED is a terminal state, so
 * `assert_registration_transition` refuses to move out of it even for the
 * service role. A suite that drives a farmer to VERIFIED could otherwise never
 * hand it back, and every later suite would fail with 409s that have nothing
 * to do with what they are testing.
 *
 * The delete cascades to land holdings, documents and verification checks, so
 * each suite starts from a state it fully controls regardless of which suites
 * ran before it.
 */
export async function resetFarmerRegistration(userId: string, phone: string): Promise<void> {
  const { error: deleteError } = await supabaseAdminClient
    .from('farmer_profiles')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    throw new Error(`Could not reset farmer ${userId}: ${deleteError.message}`);
  }

  const details = FIXTURE_FARMER_DETAILS[phone];

  const { data: district } = details
    ? await supabaseAdminClient
        .from('districts')
        .select('id, state_id')
        .eq('code', details.districtCode)
        .maybeSingle()
    : { data: null };

  const { error: insertError } = await supabaseAdminClient.from('farmer_profiles').insert({
    user_id: userId,
    village: details?.village ?? null,
    pincode: details?.pincode ?? null,
    district_id: district?.id ?? null,
    state_id: district?.state_id ?? null,
    date_of_birth: '1980-06-15',
    gender: 'PREFER_NOT_TO_SAY',
  });

  if (insertError) {
    throw new Error(`Could not recreate farmer ${userId}: ${insertError.message}`);
  }

  if (details && district) {
    await supabaseAdminClient.from('farmer_land_holdings').insert({
      farmer_user_id: userId,
      ownership_type: 'OWNED',
      area: details.areaAcres,
      area_unit: 'ACRE',
      village: details.village,
      district_id: district.id,
      state_id: district.state_id,
      pincode: details.pincode,
      primary_crop: details.crop,
    });
  }
}
