import { ROLES, isRole } from '@kisansetu/shared';
import type { AccessScope } from '@kisansetu/shared';
import {
  findDistrictAdminProfile,
  findProfileById,
  findStaffProfile,
  findStateAdminProfile,
} from '../../repositories/profilesRepository.js';
import { findCentreById, findDistrictById } from '../../repositories/centresRepository.js';
import { accountNotConfigured } from '../../lib/errors.js';
import type { AuthContext, PendingAuthContext } from '../../types/request.js';

const EMPTY_SCOPE: AccessScope = { centreId: null, districtId: null, stateId: null };

/**
 * Resolves the caller's organizational scope from role-specific profile rows
 * (§7, §25).
 *
 * Note what this function never reads: request bodies, query strings, headers
 * or JWT app_metadata. Scope comes from the database rows that provisioning
 * wrote, so a client cannot claim a centre, district or state it was not
 * assigned.
 *
 * Each role's scope is also widened *upwards* — a staff member's centre
 * implies their district and state — because a dashboard needs to name the
 * district it belongs to. It is never widened downwards.
 */
async function resolveScope(
  session: PendingAuthContext,
  role: (typeof ROLES)[keyof typeof ROLES],
): Promise<AccessScope> {
  switch (role) {
    case ROLES.CENTRE_STAFF: {
      const staff = await findStaffProfile(session.db, session.userId);
      if (!staff || !staff.isActive) {
        throw accountNotConfigured('Your staff account is not assigned to an active procurement centre.', {
          userId: session.userId,
          role,
        });
      }
      const centre = await findCentreById(session.db, staff.centreId);
      const district = centre ? await findDistrictById(session.db, centre.districtId) : null;
      return {
        centreId: staff.centreId,
        districtId: centre?.districtId ?? null,
        stateId: district?.stateId ?? null,
      };
    }

    case ROLES.DISTRICT_ADMIN: {
      const admin = await findDistrictAdminProfile(session.db, session.userId);
      if (!admin || !admin.isActive) {
        throw accountNotConfigured('Your district admin account is not assigned to an active district.', {
          userId: session.userId,
          role,
        });
      }
      const district = await findDistrictById(session.db, admin.districtId);
      return {
        centreId: null,
        districtId: admin.districtId,
        stateId: district?.stateId ?? null,
      };
    }

    case ROLES.STATE_ADMIN: {
      const admin = await findStateAdminProfile(session.db, session.userId);
      if (!admin || !admin.isActive) {
        throw accountNotConfigured('Your state admin account is not assigned to an active state.', {
          userId: session.userId,
          role,
        });
      }
      return { centreId: null, districtId: null, stateId: admin.stateId };
    }

    case ROLES.FARMER:
    default:
      // A farmer's scope is themselves. Their state/district are attributes of
      // their profile, not an authorization boundary, so they stay out of here.
      return EMPTY_SCOPE;
  }
}

/**
 * Builds the trusted request context for an authenticated caller, or returns
 * null when the Supabase identity exists but has no application profile yet
 * (a farmer who has verified OTP and not yet onboarded).
 *
 * This is where the single sign-in screen gets its answer: the role comes from
 * the profile row, never from the request. A profile that exists but cannot
 * be used — inactive, an unrecognised role, or a government role without an
 * active assignment — is refused with ACCOUNT_NOT_CONFIGURED rather than being
 * guessed into some other role's app.
 */
export async function loadAuthContext(session: PendingAuthContext): Promise<AuthContext | null> {
  const profile = await findProfileById(session.db, session.userId);
  if (!profile) return null;

  if (!isRole(profile.role)) {
    throw accountNotConfigured('This account has no valid role. Contact your administrator.', {
      userId: session.userId,
      role: profile.role,
    });
  }

  if (profile.status !== 'ACTIVE') {
    throw accountNotConfigured('This account is not active. Contact your administrator.', {
      userId: session.userId,
      status: profile.status,
    });
  }

  const scope = await resolveScope(session, profile.role);

  return {
    userId: profile.id,
    phone: profile.phone ?? session.phone,
    role: profile.role,
    status: profile.status,
    fullName: profile.fullName,
    preferredLanguage: profile.preferredLanguage,
    scope,
    db: session.db,
  };
}
