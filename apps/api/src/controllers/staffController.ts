import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { requireCentreAccess } from '../middleware/authorization.js';
import { notFound } from '../lib/errors.js';
import { findStaffProfile } from '../repositories/profilesRepository.js';
import { findCentreById } from '../repositories/centresRepository.js';
import { getStaffContext } from '../services/centres/centreService.js';
import { buildStaffDashboard } from '../services/staff/staffDashboardService.js';

/** GET /api/staff/me */
export async function getStaffMe(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);

  const staff = await findStaffProfile(auth.db, auth.userId);
  if (!staff) throw notFound('No staff record found for this account.');

  res.json({
    user: { id: auth.userId, role: auth.role, name: auth.fullName, phone: auth.phone },
    staff,
    scope: auth.scope,
  });
}

/** GET /api/staff/me/centre — the one centre this account is assigned to. */
export async function getStaffCentre(req: Request, res: Response): Promise<void> {
  res.json(await getStaffContext(authOf(req)));
}

/** GET /api/staff/me/dashboard */
export async function getStaffDashboard(req: Request, res: Response): Promise<void> {
  res.json(await buildStaffDashboard(authOf(req)));
}

/**
 * GET /api/staff/centres/:centreId — deliberately reachable so "try another
 * centre through the API" is a real request and answers 403.
 */
export async function getCentreById(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const centreId = req.params.centreId as string;

  // Explicit scope check first, so the caller gets FORBIDDEN rather than a
  // NOT_FOUND that leaks whether the centre exists.
  await requireCentreAccess(req, centreId);

  const centre = await findCentreById(auth.db, centreId);
  if (!centre) throw notFound('Procurement centre not found.');

  res.json({ centre });
}

// Farmer verification review is NOT here — see the module comment in
// apps/api/src/routes/staff.ts. It moved to the District Admin (Phase 14).
