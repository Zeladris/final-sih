import type { Request, RequestHandler } from 'express';
import { ROLE_LABEL } from '@kisansetu/shared';
import type { Role } from '@kisansetu/shared';
import { forbidden } from '../lib/errors.js';
import { recordAccessDenied } from '../services/audit/auditService.js';
import { authOf } from './auth.js';
import {
  findCentreById,
  findDistrictById,
  listDistrictsByState,
} from '../repositories/centresRepository.js';

/**
 * Reusable role and scope gates (§26).
 *
 * These are the first of the two authorization layers. RLS is the second.
 * Neither is permitted to be the only one: these produce clear 403s and audit
 * entries, RLS guarantees that a mistake here still cannot return another
 * party's rows.
 */

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const auth = authOf(req);

      if (!allowed.includes(auth.role)) {
        recordAccessDenied(req, 'ROLE_MISMATCH', {
          requiredRoles: allowed,
          actualRole: auth.role,
        });
        // §18: reject explicitly rather than silently redirecting the user
        // into whichever area happens to match their role.
        throw forbidden(
          `This area is for ${allowed.map((role) => ROLE_LABEL[role]).join(' or ')} accounts.`,
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Verifies the caller may reach a centre id that appeared in the request. */
export async function requireCentreAccess(req: Request, centreId: string): Promise<void> {
  const auth = authOf(req);

  if (auth.role === 'CENTRE_STAFF') {
    if (auth.scope.centreId !== centreId) {
      recordAccessDenied(req, 'CENTRE_OUT_OF_SCOPE', { centreId });
      throw forbidden('You do not have access to this procurement centre.');
    }
    return;
  }

  // For admins the question is whether the centre sits under their scope. The
  // lookup runs on the caller's RLS-bound client, so a centre outside their
  // district/state simply does not come back.
  const centre = await findCentreById(auth.db, centreId);
  if (!centre) {
    recordAccessDenied(req, 'CENTRE_OUT_OF_SCOPE', { centreId });
    throw forbidden('You do not have access to this procurement centre.');
  }

  if (auth.role === 'DISTRICT_ADMIN' && centre.districtId !== auth.scope.districtId) {
    recordAccessDenied(req, 'CENTRE_OUT_OF_SCOPE', { centreId });
    throw forbidden('You do not have access to this procurement centre.');
  }

  if (auth.role === 'STATE_ADMIN') {
    const district = await findDistrictById(auth.db, centre.districtId);
    if (!district || district.stateId !== auth.scope.stateId) {
      recordAccessDenied(req, 'CENTRE_OUT_OF_SCOPE', { centreId });
      throw forbidden('You do not have access to this procurement centre.');
    }
  }
}

export async function requireDistrictAccess(req: Request, districtId: string): Promise<void> {
  const auth = authOf(req);

  if (auth.role === 'DISTRICT_ADMIN') {
    if (auth.scope.districtId !== districtId) {
      recordAccessDenied(req, 'DISTRICT_OUT_OF_SCOPE', { districtId });
      throw forbidden('You do not have access to this district.');
    }
    return;
  }

  if (auth.role === 'STATE_ADMIN') {
    const districts = await listDistrictsByState(auth.db, auth.scope.stateId ?? '');
    if (!districts.some((district) => district.id === districtId)) {
      recordAccessDenied(req, 'DISTRICT_OUT_OF_SCOPE', { districtId });
      throw forbidden('You do not have access to this district.');
    }
    return;
  }

  recordAccessDenied(req, 'DISTRICT_OUT_OF_SCOPE', { districtId });
  throw forbidden('You do not have access to this district.');
}

export async function requireStateAccess(req: Request, stateId: string): Promise<void> {
  const auth = authOf(req);

  if (auth.scope.stateId !== stateId) {
    recordAccessDenied(req, 'STATE_OUT_OF_SCOPE', { stateId });
    throw forbidden('You do not have access to this state.');
  }
}

/**
 * A farmer may only ever act on their own records.
 *
 * Phase 0 grants no cross-farmer access to anybody, so this refuses for every
 * role when the ids differ. When a later phase gives staff a reason to read a
 * farmer's record, it gets an explicit branch here and a matching RLS policy —
 * not a blanket exemption.
 */
export function requireFarmerSelfAccess(req: Request, farmerUserId: string): void {
  const auth = authOf(req);

  if (auth.userId !== farmerUserId) {
    recordAccessDenied(req, 'FARMER_NOT_SELF', { targetFarmerUserId: farmerUserId });
    // 403 rather than 404: the id came from the caller, so confirming that
    // "some account exists" tells them nothing they did not already supply.
    throw forbidden('You can only access your own records.');
  }
}
