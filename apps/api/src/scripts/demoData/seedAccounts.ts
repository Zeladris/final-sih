import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { provisionAccount, ensureAuthUser } from '../../services/provisioning/provisioningService.js';
import {
  DEMO_STATES,
  staffForCentre,
  ROLE_LABEL_FOR_LOG,
} from './config.js';
import type { DemoDistrict, DemoFarmer, DemoFarmerStory } from './config.js';

/**
 * Seeds the reference hierarchy (states/districts/centres) and every
 * account (state admin, district admin, staff, farmer) for the demo dataset.
 *
 * Every account is created the way the real application creates one:
 *   - staff / district admin / state admin go through `provisionAccount`,
 *     the exact function `npm run provision` uses for a real government
 *     account — a Supabase Auth identity plus a profile plus a role-scoped
 *     row. Nothing about "who this account is" lives outside those rows.
 *   - farmers get a Supabase Auth identity plus a `profiles` row (role
 *     FARMER) plus a `farmer_profiles` row, which is exactly what a real
 *     farmer's self-registration writes — the seed just writes it directly
 *     instead of driving the multi-step UI, so a variety of registration
 *     states can be demonstrated without one number per state.
 *
 * The server never decides a role from a phone number; these rows ARE the
 * role, the same way a real account's rows are.
 */

export interface SeededIds {
  stateIdByCode: Map<string, string>;
  districtIdByCode: Map<string, string>;
  centreIdByCode: Map<string, string>;
  /** userId of a farmer, by their DEMO_FARMER employeeReferenceId. */
  farmerUserIdByRef: Map<string, string>;
  /** userId of a staff member, by centre code -> [staff userIds]. */
  staffUserIdsByCentre: Map<string, string[]>;
  districtAdminUserIdByDistrict: Map<string, string>;
}

async function seedStates(): Promise<Map<string, string>> {
  const rows = DEMO_STATES.map((s) => ({ code: s.code, name: s.name, is_active: true }));
  const { data, error } = await supabaseAdminClient
    .from('states')
    .upsert(rows, { onConflict: 'code' })
    .select('id, code');
  if (error) throw new Error(`Could not seed states: ${error.message}`);
  return new Map((data as Array<{ id: string; code: string }>).map((r) => [r.code, r.id]));
}

async function seedDistricts(stateIdByCode: Map<string, string>): Promise<Map<string, string>> {
  const rows = DEMO_STATES.flatMap((s) =>
    s.districts.map((d) => ({
      state_id: stateIdByCode.get(s.code)!,
      code: d.code,
      name: d.name,
      is_active: true,
    })),
  );
  const { data, error } = await supabaseAdminClient
    .from('districts')
    .upsert(rows, { onConflict: 'state_id,code' })
    .select('id, code');
  if (error) throw new Error(`Could not seed districts: ${error.message}`);
  return new Map((data as Array<{ id: string; code: string }>).map((r) => [r.code, r.id]));
}

async function seedCentres(districtIdByCode: Map<string, string>): Promise<Map<string, string>> {
  const rows = DEMO_STATES.flatMap((s) =>
    s.districts.flatMap((d) =>
      d.centres.map((c) => ({
        code: c.code,
        name: c.name,
        district_id: districtIdByCode.get(d.code)!,
        village: c.village,
        address_line1: c.addressLine1,
        pincode: c.pincode,
        latitude: c.latitude,
        longitude: c.longitude,
        open_time: c.openTime,
        close_time: c.closeTime,
        daily_capacity_qtl: c.dailyCapacityQtl,
        is_active: true,
      })),
    ),
  );
  const { data, error } = await supabaseAdminClient
    .from('procurement_centres')
    .upsert(rows, { onConflict: 'code' })
    .select('id, code');
  if (error) throw new Error(`Could not seed centres: ${error.message}`);
  return new Map((data as Array<{ id: string; code: string }>).map((r) => [r.code, r.id]));
}

/** Every procurable crop, available at every demo centre — mirrors what the Phase 4 migration does for a real centre. */
async function linkCropsToCentres(centreIdByCode: Map<string, string>): Promise<void> {
  const { data: crops, error: cropError } = await supabaseAdminClient
    .from('crops')
    .select('id')
    .eq('is_procurable', true);
  if (cropError) throw new Error(`Could not read crops: ${cropError.message}`);

  const rows = [...centreIdByCode.values()].flatMap((centreId) =>
    (crops as Array<{ id: string }>).map((crop) => ({ centre_id: centreId, crop_id: crop.id, is_active: true })),
  );
  if (rows.length === 0) return;

  const { error } = await supabaseAdminClient
    .from('centre_crops')
    .upsert(rows, { onConflict: 'centre_id,crop_id', ignoreDuplicates: true });
  if (error) throw new Error(`Could not link crops to centres: ${error.message}`);
}

/** Two workstations per demo centre — mirrors the Phase 7 migration's own seeding for a real centre. */
async function seedWorkstations(centreIdByCode: Map<string, string>): Promise<void> {
  const { data: paddyCrops, error: cropError } = await supabaseAdminClient
    .from('crops')
    .select('id, code')
    .like('code', 'PADDY%');
  if (cropError) throw new Error(`Could not read paddy crops: ${cropError.message}`);
  const paddyCropIds = (paddyCrops as Array<{ id: string }>).map((c) => c.id);

  const rows = [...centreIdByCode.values()].flatMap((centreId) => [
    { centre_id: centreId, code: 'WS-1', name: 'Weighbridge 1 (all crops)', crop_ids: [] as string[] },
    { centre_id: centreId, code: 'WS-2', name: 'Paddy line 2', crop_ids: paddyCropIds },
  ]);

  const { error } = await supabaseAdminClient
    .from('queue_workstations')
    .upsert(rows, { onConflict: 'centre_id,code', ignoreDuplicates: true });
  if (error) throw new Error(`Could not seed workstations: ${error.message}`);
}

async function seedStateAdmins(stateIdByCode: Map<string, string>): Promise<void> {
  for (const state of DEMO_STATES) {
    await provisionAccount(
      { phone: state.admin.phone, role: 'STATE_ADMIN', fullName: state.admin.fullName },
      { kind: 'state', stateId: stateIdByCode.get(state.code)!, employeeReferenceId: state.admin.employeeReferenceId },
    );
  }
}

async function seedDistrictAdmins(
  districtIdByCode: Map<string, string>,
): Promise<Map<string, string>> {
  const userIdByDistrict = new Map<string, string>();
  for (const state of DEMO_STATES) {
    for (const district of state.districts) {
      const userId = await provisionAccount(
        { phone: district.admin.phone, role: 'DISTRICT_ADMIN', fullName: district.admin.fullName },
        { kind: 'district', districtId: districtIdByCode.get(district.code)!, employeeReferenceId: district.admin.employeeReferenceId },
      );
      userIdByDistrict.set(district.code, userId);
    }
  }
  return userIdByDistrict;
}

async function seedStaff(centreIdByCode: Map<string, string>): Promise<Map<string, string[]>> {
  const staffByCentre = new Map<string, string[]>();
  for (const state of DEMO_STATES) {
    for (const district of state.districts) {
      for (const centre of district.centres) {
        const userIds: string[] = [];
        for (const member of staffForCentre(centre)) {
          const userId = await provisionAccount(
            { phone: member.phone, role: 'CENTRE_STAFF', fullName: member.fullName },
            {
              kind: 'centre',
              centreId: centreIdByCode.get(centre.code)!,
              employeeReferenceId: member.employeeReferenceId,
              designation: member.designation,
            },
          );
          userIds.push(userId);
        }
        staffByCentre.set(centre.code, userIds);
      }
    }
  }
  return staffByCentre;
}

// ---------------------------------------------------------------------------
// Farmers — written directly, at the final state their story calls for, the
// same way a real registration/review would have left the rows. Deliberately
// NOT run through the multi-step registration UI: the point of the seed is a
// specific, deterministic outcome, not a simulated user session.
// ---------------------------------------------------------------------------

interface CheckPlan {
  status: 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';
  notes: string | null;
}

function planFor(story: DemoFarmerStory): {
  registrationStatus: string;
  currentStep: string;
  submittedAt: boolean;
  reviewedAt: boolean;
  reviewStartedBy: boolean;
  land: 'none' | CheckPlan;
  checks: CheckPlan;
} {
  switch (story) {
    case 'VERIFIED_HISTORY':
    case 'VERIFIED_LIVE':
      return {
        registrationStatus: 'VERIFIED',
        currentStep: 'REVIEW',
        submittedAt: true,
        reviewedAt: true,
        reviewStartedBy: true,
        land: { status: 'VERIFIED', notes: null },
        checks: { status: 'VERIFIED', notes: null },
      };
    case 'UNDER_REVIEW':
      return {
        registrationStatus: 'UNDER_REVIEW',
        currentStep: 'REVIEW',
        submittedAt: true,
        reviewedAt: false,
        reviewStartedBy: true,
        land: { status: 'UNDER_REVIEW', notes: null },
        checks: { status: 'UNDER_REVIEW', notes: null },
      };
    case 'SUBMITTED':
      return {
        registrationStatus: 'SUBMITTED',
        currentStep: 'REVIEW',
        submittedAt: true,
        reviewedAt: false,
        reviewStartedBy: false,
        land: { status: 'PENDING', notes: null },
        checks: { status: 'PENDING', notes: null },
      };
    case 'DRAFT':
      return {
        registrationStatus: 'DRAFT',
        currentStep: 'LAND_DETAILS',
        submittedAt: false,
        reviewedAt: false,
        reviewStartedBy: false,
        land: 'none',
        checks: { status: 'PENDING', notes: null },
      };
    case 'REJECTED':
      return {
        registrationStatus: 'REJECTED',
        currentStep: 'REVIEW',
        submittedAt: true,
        reviewedAt: true,
        reviewStartedBy: true,
        land: { status: 'REJECTED', notes: 'Demo: land survey number could not be matched to the declared village.' },
        checks: { status: 'REJECTED', notes: 'Demo: land survey number could not be matched to the declared village.' },
      };
    case 'RESUBMISSION_REQUIRED':
      return {
        registrationStatus: 'RESUBMISSION_REQUIRED',
        currentStep: 'DOCUMENTS',
        submittedAt: true,
        reviewedAt: true,
        reviewStartedBy: true,
        land: { status: 'REJECTED', notes: 'Demo: identity document image was unreadable — please re-upload.' },
        checks: { status: 'REJECTED', notes: 'Demo: identity document image was unreadable — please re-upload.' },
      };
  }
}

const CHECK_TYPES = ['IDENTITY', 'ADDRESS', 'LAND', 'DOCUMENTS', 'PHOTO'] as const;

async function seedFarmer(
  farmer: DemoFarmer,
  district: DemoDistrict,
  stateId: string,
  districtId: string,
  reviewerUserId: string,
): Promise<string> {
  const { userId } = await ensureAuthUser(farmer.phone);
  const plan = planFor(farmer.story);
  const now = new Date().toISOString();

  const { error: profileError } = await supabaseAdminClient.from('profiles').upsert(
    {
      id: userId,
      role: 'FARMER',
      full_name: farmer.fullName,
      preferred_language: farmer.preferredLanguage ?? 'en',
      status: 'ACTIVE',
    },
    { onConflict: 'id' },
  );
  if (profileError) throw new Error(`Could not upsert farmer profile for ${maskPhone(farmer.phone)}: ${profileError.message}`);

  const { data: existingFarmer } = await supabaseAdminClient
    .from('farmer_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const farmerRow = {
    user_id: userId,
    date_of_birth: farmer.dateOfBirth,
    gender: farmer.gender,
    village: farmer.village,
    pincode: farmer.pincode,
    state_id: stateId,
    district_id: districtId,
    registration_status: plan.registrationStatus,
    current_step: plan.currentStep,
    submitted_at: plan.submittedAt ? now : null,
    reviewed_at: plan.reviewedAt ? now : null,
    reviewed_by: plan.reviewedAt ? reviewerUserId : null,
    review_started_by: plan.reviewStartedBy ? reviewerUserId : null,
    review_started_at: plan.reviewStartedBy ? now : null,
    review_notes:
      farmer.story === 'REJECTED' || farmer.story === 'RESUBMISSION_REQUIRED'
        ? plan.checks.notes
        : null,
    verified_at: plan.registrationStatus === 'VERIFIED' ? now : null,
  };

  if (existingFarmer) {
    const { error } = await supabaseAdminClient.from('farmer_profiles').update(farmerRow).eq('user_id', userId);
    if (error) throw new Error(`Could not update farmer_profiles for ${maskPhone(farmer.phone)}: ${error.message}`);
  } else {
    const { error } = await supabaseAdminClient.from('farmer_profiles').insert(farmerRow);
    if (error) throw new Error(`Could not insert farmer_profiles for ${maskPhone(farmer.phone)}: ${error.message}`);
  }

  // Land holding — every story except DRAFT (stopped before reaching it).
  if (plan.land !== 'none') {
    const { data: existingLand } = await supabaseAdminClient
      .from('farmer_land_holdings')
      .select('id')
      .eq('farmer_user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!existingLand) {
      const { error } = await supabaseAdminClient.from('farmer_land_holdings').insert({
        farmer_user_id: userId,
        ownership_type: 'OWNED',
        area: farmer.landAcres,
        area_unit: 'ACRE',
        survey_number: `${district.code}/${farmer.employeeReferenceId}`,
        village: farmer.village,
        district_id: districtId,
        state_id: stateId,
        pincode: farmer.pincode,
        primary_crop: farmer.primaryCrop,
        verification_status: plan.land.status,
        reviewed_by: plan.land.status !== 'PENDING' ? reviewerUserId : null,
        reviewed_at: plan.land.status !== 'PENDING' ? now : null,
        rejection_reason: plan.land.status === 'REJECTED' ? plan.land.notes : null,
      });
      if (error) throw new Error(`Could not insert land holding for ${maskPhone(farmer.phone)}: ${error.message}`);
    }
  }

  // Verification checks — one row per check type, same status across the
  // board for a given farmer (a real review can differ per type; the demo
  // keeps one coherent story per farmer legible at a glance).
  const checkRows = CHECK_TYPES.map((checkType) => ({
    farmer_user_id: userId,
    check_type: checkType,
    status: plan.checks.status,
    reviewed_by: plan.checks.status !== 'PENDING' ? reviewerUserId : null,
    reviewed_at: plan.checks.status !== 'PENDING' ? now : null,
    notes: plan.checks.status === 'REJECTED' ? plan.checks.notes : null,
  }));
  const { error: checksError } = await supabaseAdminClient
    .from('farmer_verification_checks')
    .upsert(checkRows, { onConflict: 'farmer_user_id,check_type' });
  if (checksError) throw new Error(`Could not seed verification checks for ${maskPhone(farmer.phone)}: ${checksError.message}`);

  return userId;
}

export async function seedAccountsAndReferenceData(): Promise<SeededIds> {
  const stateIdByCode = await seedStates();
  const districtIdByCode = await seedDistricts(stateIdByCode);
  const centreIdByCode = await seedCentres(districtIdByCode);
  await linkCropsToCentres(centreIdByCode);
  await seedWorkstations(centreIdByCode);

  await seedStateAdmins(stateIdByCode);
  const districtAdminUserIdByDistrict = await seedDistrictAdmins(districtIdByCode);
  const staffUserIdsByCentre = await seedStaff(centreIdByCode);

  const farmerUserIdByRef = new Map<string, string>();
  for (const state of DEMO_STATES) {
    const stateId = stateIdByCode.get(state.code)!;
    for (const district of state.districts) {
      const districtId = districtIdByCode.get(district.code)!;
      const reviewerUserId = districtAdminUserIdByDistrict.get(district.code)!;
      for (const farmer of district.farmers) {
        const userId = await seedFarmer(farmer, district, stateId, districtId, reviewerUserId);
        farmerUserIdByRef.set(farmer.employeeReferenceId, userId);
      }
    }
  }

  logger.info('demo accounts seeded', {
    states: stateIdByCode.size,
    districts: districtIdByCode.size,
    centres: centreIdByCode.size,
    staff: [...staffUserIdsByCentre.values()].reduce((n, arr) => n + arr.length, 0),
    districtAdmins: districtAdminUserIdByDistrict.size,
    farmers: farmerUserIdByRef.size,
  });

  void ROLE_LABEL_FOR_LOG;

  return {
    stateIdByCode,
    districtIdByCode,
    centreIdByCode,
    farmerUserIdByRef,
    staffUserIdsByCentre,
    districtAdminUserIdByDistrict,
  };
}
