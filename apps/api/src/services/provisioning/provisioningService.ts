import { ROLES } from '@kisansetu/shared';
import type { Role } from '@kisansetu/shared';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { insertAuditLog } from '../../repositories/auditRepository.js';

/**
 * Provisioning for government roles (§40, Step 9).
 *
 * Staff and admin accounts are created HERE, by an operator running a script
 * with the service-role key — never by an anonymous signup. The database
 * enforces the same rule independently: the RLS INSERT policy on
 * public.profiles only accepts role = 'FARMER', so even a compromised signup
 * path cannot mint a STATE_ADMIN.
 *
 * Note there is no password anywhere in this file. Provisioned accounts sign
 * in with the same Supabase phone OTP flow as farmers (§21, §60.7); all this
 * does is create the identity and attach a role and a scope to it.
 */

export interface ProvisionResult {
  userId: string;
  created: boolean;
}

/** Supabase has no "get user by phone", so page the admin list. Seed-scale only. */
async function findUserIdByPhone(phone: string): Promise<string | null> {
  const normalised = phone.replace(/^\+/, '');
  const perPage = 200;

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await supabaseAdminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);

    const match = data.users.find((user) => (user.phone ?? '').replace(/^\+/, '') === normalised);
    if (match) return match.id;

    if (data.users.length < perPage) return null;
  }

  return null;
}

/**
 * Creates (or finds) the Supabase identity for a phone number.
 *
 * `phone_confirm: true` marks the number as verified without sending an OTP.
 * That is correct for provisioning — an operator is asserting the number out
 * of band — and it is not a login shortcut: the account still has to pass a
 * real OTP to obtain a session.
 */
export async function ensureAuthUser(phone: string): Promise<ProvisionResult> {
  const existingId = await findUserIdByPhone(phone);
  if (existingId) return { userId: existingId, created: false };

  const { data, error } = await supabaseAdminClient.auth.admin.createUser({
    phone,
    phone_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Could not create auth user for ${maskPhone(phone)}: ${error?.message}`);
  }

  return { userId: data.user.id, created: true };
}

export interface ProvisionProfileInput {
  phone: string;
  role: Role;
  fullName: string;
  preferredLanguage?: string;
}

export type ScopeAssignment =
  | { kind: 'centre'; centreId: string; employeeReferenceId: string; designation: string }
  | { kind: 'district'; districtId: string; employeeReferenceId: string }
  | { kind: 'state'; stateId: string; employeeReferenceId: string }
  | { kind: 'none' };

/**
 * Creates the auth identity, the application profile and the role-specific
 * scope row as one operation, idempotently.
 */
export async function provisionAccount(
  input: ProvisionProfileInput,
  scope: ScopeAssignment,
): Promise<string> {
  const { userId } = await ensureAuthUser(input.phone);

  const { error: profileError } = await supabaseAdminClient.from('profiles').upsert(
    {
      id: userId,
      role: input.role,
      full_name: input.fullName,
      preferred_language: input.preferredLanguage ?? 'en',
      status: 'ACTIVE',
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    throw new Error(`Could not upsert profile for ${input.fullName}: ${profileError.message}`);
  }

  switch (scope.kind) {
    case 'centre': {
      const { error } = await supabaseAdminClient.from('staff_profiles').upsert(
        {
          user_id: userId,
          employee_reference_id: scope.employeeReferenceId,
          centre_id: scope.centreId,
          designation: scope.designation,
          is_active: true,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(`Could not assign centre: ${error.message}`);

      await insertAuditLog({
        actorUserId: null,
        action: 'STAFF_ASSIGNED',
        entityType: 'staff_profiles',
        entityId: userId,
        centreId: scope.centreId,
        metadata: { employeeReferenceId: scope.employeeReferenceId, source: 'provisioning' },
      });
      break;
    }

    case 'district': {
      const { error } = await supabaseAdminClient.from('district_admin_profiles').upsert(
        {
          user_id: userId,
          employee_reference_id: scope.employeeReferenceId,
          district_id: scope.districtId,
          is_active: true,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(`Could not assign district: ${error.message}`);

      await insertAuditLog({
        actorUserId: null,
        action: 'ADMIN_CREATED',
        entityType: 'district_admin_profiles',
        entityId: userId,
        districtId: scope.districtId,
        metadata: { employeeReferenceId: scope.employeeReferenceId, source: 'provisioning' },
      });
      break;
    }

    case 'state': {
      const { error } = await supabaseAdminClient.from('state_admin_profiles').upsert(
        {
          user_id: userId,
          employee_reference_id: scope.employeeReferenceId,
          state_id: scope.stateId,
          is_active: true,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(`Could not assign state: ${error.message}`);

      await insertAuditLog({
        actorUserId: null,
        action: 'ADMIN_CREATED',
        entityType: 'state_admin_profiles',
        entityId: userId,
        stateId: scope.stateId,
        metadata: { employeeReferenceId: scope.employeeReferenceId, source: 'provisioning' },
      });
      break;
    }

    case 'none':
      if (input.role !== ROLES.FARMER) {
        throw new Error(`Role ${input.role} requires an organizational scope.`);
      }
      break;
  }

  logger.info('provisioned account', {
    role: input.role,
    phone: maskPhone(input.phone),
    scope: scope.kind,
  });

  return userId;
}
