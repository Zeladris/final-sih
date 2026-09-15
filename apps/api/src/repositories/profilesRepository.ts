import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DistrictAdminProfile,
  Language,
  Profile,
  Role,
  StaffProfile,
  StateAdminProfile,
} from '@kisansetu/shared';
import {
  PROFILE_COLUMNS,
  toDistrictAdminProfile,
  toProfile,
  toStaffProfile,
  toStateAdminProfile,
} from './rows.js';
import type {
  DistrictAdminProfileRow,
  ProfileRow,
  StaffProfileRow,
  StateAdminProfileRow,
} from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';

export async function findProfileById(db: SupabaseClient, userId: string): Promise<Profile | null> {
  const row = unwrapMaybe<ProfileRow>(
    await db.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
    'profiles.findById',
  );
  return row ? toProfile(row) : null;
}

export async function insertProfile(
  db: SupabaseClient,
  input: { id: string; role: Role; fullName: string | null; preferredLanguage: Language },
): Promise<Profile> {
  // `phone` is intentionally absent: a database trigger copies it from the
  // verified auth identity, so no client-supplied number can land here (§27).
  const row = unwrap<ProfileRow>(
    await db
      .from('profiles')
      .insert({
        id: input.id,
        role: input.role,
        full_name: input.fullName,
        preferred_language: input.preferredLanguage,
      })
      .select(PROFILE_COLUMNS)
      .single(),
    'profiles.insert',
  );
  return toProfile(row);
}

export async function updateProfile(
  db: SupabaseClient,
  userId: string,
  patch: { fullName?: string | null; preferredLanguage?: Language },
): Promise<Profile> {
  const payload: Record<string, unknown> = {};
  if (patch.fullName !== undefined) payload.full_name = patch.fullName;
  if (patch.preferredLanguage !== undefined) payload.preferred_language = patch.preferredLanguage;

  const row = unwrap<ProfileRow>(
    await db.from('profiles').update(payload).eq('id', userId).select(PROFILE_COLUMNS).single(),
    'profiles.update',
  );
  return toProfile(row);
}

export async function findStaffProfile(
  db: SupabaseClient,
  userId: string,
): Promise<StaffProfile | null> {
  const row = unwrapMaybe<StaffProfileRow>(
    await db
      .from('staff_profiles')
      .select('user_id, employee_reference_id, centre_id, designation, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
    'staff_profiles.findByUserId',
  );
  return row ? toStaffProfile(row) : null;
}

export async function findDistrictAdminProfile(
  db: SupabaseClient,
  userId: string,
): Promise<DistrictAdminProfile | null> {
  const row = unwrapMaybe<DistrictAdminProfileRow>(
    await db
      .from('district_admin_profiles')
      .select('user_id, employee_reference_id, district_id, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
    'district_admin_profiles.findByUserId',
  );
  return row ? toDistrictAdminProfile(row) : null;
}

export async function findStateAdminProfile(
  db: SupabaseClient,
  userId: string,
): Promise<StateAdminProfile | null> {
  const row = unwrapMaybe<StateAdminProfileRow>(
    await db
      .from('state_admin_profiles')
      .select('user_id, employee_reference_id, state_id, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
    'state_admin_profiles.findByUserId',
  );
  return row ? toStateAdminProfile(row) : null;
}
