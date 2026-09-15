import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { requireDistrictAccess } from '../middleware/authorization.js';
import {
  getDistrictContext,
  getStateContext,
  listCentresForDistrictAdmin,
  listCentresForStateAdmin,
  listDistrictsForStateAdmin,
} from '../services/centres/centreService.js';
import { listCentresByDistrict } from '../repositories/centresRepository.js';
import {
  findDistrictAdminProfile,
  findStateAdminProfile,
} from '../repositories/profilesRepository.js';
import { notFound } from '../lib/errors.js';

// --- District admin --------------------------------------------------------

/** GET /api/admin/district/me */
export async function getDistrictMe(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);

  const admin = await findDistrictAdminProfile(auth.db, auth.userId);
  if (!admin) throw notFound('No district admin record found for this account.');

  const context = await getDistrictContext(auth);

  res.json({
    user: { id: auth.userId, role: auth.role, name: auth.fullName, phone: auth.phone },
    admin,
    ...context,
    scope: auth.scope,
  });
}

/** GET /api/admin/district/centres — centres in the admin's own district only. */
export async function getDistrictCentres(req: Request, res: Response): Promise<void> {
  res.json({ centres: await listCentresForDistrictAdmin(authOf(req)) });
}

/**
 * GET /api/admin/districts/:districtId/centres — the cross-district probe from
 * §59 C.4. A district admin asking about a neighbouring district gets 403;
 * a state admin asking about a district in their own state gets the list.
 */
export async function getCentresForDistrict(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const districtId = req.params.districtId as string;

  await requireDistrictAccess(req, districtId);

  res.json({ centres: await listCentresByDistrict(auth.db, districtId) });
}

// --- State admin -----------------------------------------------------------

/** GET /api/admin/state/me */
export async function getStateMe(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);

  const admin = await findStateAdminProfile(auth.db, auth.userId);
  if (!admin) throw notFound('No state admin record found for this account.');

  const context = await getStateContext(auth);

  res.json({
    user: { id: auth.userId, role: auth.role, name: auth.fullName, phone: auth.phone },
    admin,
    ...context,
    scope: auth.scope,
  });
}

/** GET /api/admin/state/districts */
export async function getStateDistricts(req: Request, res: Response): Promise<void> {
  res.json({ districts: await listDistrictsForStateAdmin(authOf(req)) });
}

/** GET /api/admin/state/centres — every centre across the admin's own state. */
export async function getStateCentres(req: Request, res: Response): Promise<void> {
  res.json({ centres: await listCentresForStateAdmin(authOf(req)) });
}
