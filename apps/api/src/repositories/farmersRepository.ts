import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FarmerProfile,
  Gender,
  RegistrationStatus,
  RegistrationStep,
} from '@kisansetu/shared';
import { FARMER_COLUMNS, toFarmerProfile } from './rows.js';
import type { FarmerProfileRow } from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Farmer-owned fields. Deliberately excludes registration_status, submitted_at,
 * reviewed_at, review_notes, verified_at and farmer_reference_id: those are
 * server-owned and a database trigger pins them for non-service-role writers
 * even if this type were widened (§33).
 */
export interface FarmerProfilePatch {
  dateOfBirth?: string | null;
  gender?: Gender | null;
  fullNameLocal?: string | null;
  village?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  stateId?: string | null;
  districtId?: string | null;
  currentStep?: RegistrationStep;
}

function toColumnPatch(patch: FarmerProfilePatch): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const assign = <K extends keyof FarmerProfilePatch>(key: K, column: string): void => {
    if (patch[key] !== undefined) payload[column] = patch[key];
  };

  assign('dateOfBirth', 'date_of_birth');
  assign('gender', 'gender');
  assign('fullNameLocal', 'full_name_local');
  assign('village', 'village');
  assign('addressLine1', 'address_line1');
  assign('addressLine2', 'address_line2');
  assign('pincode', 'pincode');
  assign('latitude', 'latitude');
  assign('longitude', 'longitude');
  assign('stateId', 'state_id');
  assign('districtId', 'district_id');
  assign('currentStep', 'current_step');

  return payload;
}

export async function findFarmerProfile(
  db: SupabaseClient,
  userId: string,
): Promise<FarmerProfile | null> {
  const row = unwrapMaybe<FarmerProfileRow>(
    await db.from('farmer_profiles').select(FARMER_COLUMNS).eq('user_id', userId).maybeSingle(),
    'farmer_profiles.findByUserId',
  );
  return row ? toFarmerProfile(row) : null;
}

export async function insertFarmerProfile(
  db: SupabaseClient,
  userId: string,
  patch: FarmerProfilePatch,
): Promise<FarmerProfile> {
  const row = unwrap<FarmerProfileRow>(
    await db
      .from('farmer_profiles')
      .insert({ user_id: userId, ...toColumnPatch(patch) })
      .select(FARMER_COLUMNS)
      .single(),
    'farmer_profiles.insert',
  );
  return toFarmerProfile(row);
}

export async function updateFarmerProfile(
  db: SupabaseClient,
  userId: string,
  patch: FarmerProfilePatch,
): Promise<FarmerProfile> {
  const payload = toColumnPatch(patch);

  if (Object.keys(payload).length === 0) {
    const existing = await findFarmerProfile(db, userId);
    if (!existing) throw new Error('farmer_profiles.update called for a missing profile');
    return existing;
  }

  const row = unwrap<FarmerProfileRow>(
    await db
      .from('farmer_profiles')
      .update(payload)
      .eq('user_id', userId)
      .select(FARMER_COLUMNS)
      .single(),
    'farmer_profiles.update',
  );
  return toFarmerProfile(row);
}

/**
 * Moves a registration through the state machine.
 *
 * MUST be called with the service-role client. For anyone else the
 * `protect_farmer_registration` trigger silently restores the stored status,
 * so this is the only path that can advance a registration — and the
 * `assert_registration_transition` trigger still refuses an illegal move even
 * here (§33).
 */
export async function updateRegistrationStatus(
  adminDb: SupabaseClient,
  userId: string,
  status: RegistrationStatus,
  options: { reviewNotes?: string | null; reviewedBy?: string | null } = {},
): Promise<FarmerProfile> {
  const payload: Record<string, unknown> = { registration_status: status };
  if (options.reviewNotes !== undefined) payload.review_notes = options.reviewNotes;
  if (options.reviewedBy !== undefined) payload.reviewed_by = options.reviewedBy;

  const row = unwrap<FarmerProfileRow>(
    await adminDb
      .from('farmer_profiles')
      .update(payload)
      .eq('user_id', userId)
      .select(FARMER_COLUMNS)
      .single(),
    'farmer_profiles.updateRegistrationStatus',
  );
  return toFarmerProfile(row);
}
